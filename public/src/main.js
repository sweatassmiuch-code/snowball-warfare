import * as THREE from '../vendor/three.module.js';
import {
  PLAYER, BALL, WORLD, RESPAWN_MS, WIND,
  terrainHeight, terrainNormal, terrainSlope, resolvePlayerCollision, clampToWorld
} from '../shared/world.js';
import { createWorld } from './scene.js';
import { createEffects } from './fx.js';
import { createAudio } from './audio.js';
import { createCharacter, makeNameTag, createViewModel, characterColor, LOOK_PALETTES } from './character.js';
import { hostGame, joinGame } from './net.js';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const DEBUG = new URLSearchParams(location.search).has('debug');
const hasMouse = () => document.pointerLockElement === canvas || (DEBUG && !!window.__sbw?.forceInput);
const ui = {
  hud: $('hud'), menu: $('menu'), loading: $('loading'), loadingText: $('loadingText'),
  nameInput: $('nameInput'), hostBtn: $('hostBtn'), joinBtn: $('joinBtn'), joinCode: $('joinCode'),
  qualitySel: $('qualitySel'), botsSel: $('botsSel'), sensRange: $('sensRange'), volRange: $('volRange'),
  sensVal: $('sensVal'), volVal: $('volVal'), menuStatus: $('menuStatus'),
  roomCode: $('roomCode'), pauseCode: $('pauseCode'), onlineCount: $('onlineCount'), pingVal: $('pingVal'),
  killfeed: $('killfeed'), chargeRing: $('chargeRing'), chargeArc: $('chargeArc'), chargeWrap: $('chargeWrap'),
  chargeLabel: $('chargeLabel'), hitmarker: $('hitmarker'), scoreboard: $('scoreboard'), scoreRows: $('scoreRows'),
  pause: $('pause'), resumeBtn: $('resumeBtn'), leaveBtn: $('leaveBtn'), death: $('death'),
  deathKiller: $('deathKiller'), respawnBar: $('respawnBar'), respawnText: $('respawnText'),
  matchBanner: $('matchBanner'), matchText: $('matchText'), matchSub: $('matchSub'),
  muteBtn: $('muteBtn'), menuBtn: $('menuBtn'), toast: $('toast'), copyCode: $('copyCode'),
  roomChip: $('roomChip'), staminaFill: $('staminaFill'), staminaWrap: $('staminaWrap'),
  perfChip: $('perfChip'), fpsVal: $('fpsVal'), fpsScale: $('fpsScale'),
  preview: $('preview'), lookSummary: $('lookSummary'), randomLook: $('randomLook'),
  fpsToggle: $('fpsToggle'), swJacket: $('swJacket'), swScarf: $('swScarf'),
  swHat: $('swHat'), swSkin: $('swSkin'), optionsBtn: $('optionsBtn'),
  optionsPanel: $('optionsPanel'), optionsClose: $('optionsClose')
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const defaults = { name: '', sens: 1, vol: 0.8, quality: 'high', bots: 3, showFps: false, lookVersion: 2, look: { j: 0, s: 0, k: 0, h: 0 } };
let settings = { ...defaults };
try {
  settings = { ...defaults, ...JSON.parse(localStorage.getItem('sbw.settings') || '{}') };
} catch {}
function saveSettings() {
  try { localStorage.setItem('sbw.settings', JSON.stringify(settings)); } catch {}
}
// Palette v2: saved looks point at colours that no longer exist, so reset them
// once instead of showing a character nobody picked.
if (settings.lookVersion !== 2) {
  settings.look = { ...defaults.look };
  settings.lookVersion = 2;
  saveSettings();
} else {
  settings.look = { ...defaults.look, ...(settings.look || {}) };
}
ui.nameInput.value = settings.name;
ui.sensRange.value = settings.sens;
ui.volRange.value = settings.vol;
ui.qualitySel.value = settings.quality;
ui.botsSel.value = String(settings.bots);
ui.sensVal.textContent = Number(settings.sens).toFixed(2);
ui.volVal.textContent = Math.round(settings.vol * 100) + '%';
ui.perfChip.classList.toggle('hidden', !settings.showFps);
ui.fpsToggle.checked = !!settings.showFps;

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, stencil: false, powerPreference: 'high-performance',
    preserveDrawingBuffer: DEBUG
  });
} catch (e) {
  document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#fff">WebGL wird benötigt, um dieses Spiel zu starten.</div>';
  throw e;
}

const dprCap = () => Math.min(window.devicePixelRatio || 1, 2);
let dpr = dprCap();
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.04, 1400);
camera.rotation.order = 'YXZ';

// ---------------------------------------------------------------------------
// Post-processing (HDR scene → bloom → ACES grade)
// ---------------------------------------------------------------------------
const post = (() => {
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.frustumCulled = false;
  quadScene.add(mesh);

  const opts = { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false };
  const rtScene = new THREE.WebGLRenderTarget(1, 1, { ...opts, samples: 2 });
  const rtA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const rtB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

  const threshold = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uThreshold: { value: 1.25 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uThreshold; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = max(c.r, max(c.g, c.b));
        float k = smoothstep(uThreshold, uThreshold + 0.55, l);
        gl_FragColor = vec4(c * k, 1.0);
      }`
  });

  const blur = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uTexel; varying vec2 vUv;
      void main(){
        float w[5];
        w[0] = 0.227027; w[1] = 0.1945946; w[2] = 0.1216216; w[3] = 0.054054; w[4] = 0.016216;
        vec3 sum = texture2D(tDiffuse, vUv).rgb * w[0];
        for (int i = 1; i < 5; i++) {
          vec2 off = uDir * uTexel * float(i) * 1.05;
          sum += texture2D(tDiffuse, vUv + off).rgb * w[i];
          sum += texture2D(tDiffuse, vUv - off).rgb * w[i];
        }
        gl_FragColor = vec4(sum, 1.0);
      }`
  });

  const composite = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null }, tBloom: { value: null },
      uTime: { value: 0 }, uExposure: { value: 0.78 }, uBloom: { value: 0.34 },
      uDesat: { value: 0 }, uFlash: { value: 0 }, uGrain: { value: 1 }, uFrost: { value: 0.55 },
      uFocus: { value: 0 }
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tScene; uniform sampler2D tBloom;
      uniform float uTime, uExposure, uBloom, uDesat, uFlash, uGrain, uFrost, uFocus;
      varying vec2 vUv;

      vec3 aces(vec3 x) {
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

      void main() {
        vec2 uv = vUv;
        vec2 d = uv - vec2(0.5);
        float r2 = dot(d, d);

        float ca = 0.0008 + 0.0045 * r2;
        vec3 col;
        col.r = texture2D(tScene, uv + d * ca).r;
        col.g = texture2D(tScene, uv).g;
        col.b = texture2D(tScene, uv - d * ca).b;

        vec3 bloom = texture2D(tBloom, uv).rgb;
        col += bloom * uBloom;

        col *= uExposure;
        col = aces(col);

        // cold cinematic grade
        col = mix(col, col * vec3(0.90, 0.97, 1.07), 0.45);
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, col * vec3(0.72, 0.86, 1.08), (1.0 - l) * 0.35);
        col = mix(col, col * vec3(1.08, 1.01, 0.90), l * 0.4);
        col = mix(col, col * col * (3.0 - 2.0 * col), 0.28);
        float l2 = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(l2), col, 1.12);

        // focus freeze: cold tunnel vision with the bloom pushed forward
        col = mix(col, col * vec3(0.86, 0.96, 1.12), uFocus * 0.55);
        col += bloom * uFocus * 0.22;

        float vig = smoothstep(1.0, 0.15, r2 * (1.85 + uFocus * 1.35));
        col *= mix(0.42 - 0.16 * uFocus, 1.0, vig);

        // faint breath of frost right at the corners of the lens
        float fn2 = hash(floor(uv * vec2(70.0, 44.0)) + 11.0);
        float frost = smoothstep(0.68, 0.98, fn2);
        float edge = smoothstep(0.42, 0.68, r2);
        col = mix(col, vec3(0.90, 0.96, 1.0), frost * edge * uFrost * 0.22);

        float g = hash(uv * vec2(1931.0, 1087.0) + vec2(uTime * 9.0, uTime * 5.0)) - 0.5;
        col += g * 0.028 * uGrain;

        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(lum) * vec3(0.85, 0.93, 1.04), uDesat);
        col = mix(col, vec3(0.78, 0.88, 0.98), uFlash * 0.5);

        col = max(col, 0.0);
        col = pow(col, vec3(1.0 / 2.2));
        gl_FragColor = vec4(col, 1.0);
      }`
  });

  let bloomOn = true;
  let W = 1, H = 1;

  function resize(w, h, pixelRatio) {
    W = Math.max(1, Math.floor(w * pixelRatio));
    H = Math.max(1, Math.floor(h * pixelRatio));
    rtScene.setSize(W, H);
    const bw = Math.max(1, Math.floor(W / 6)), bh = Math.max(1, Math.floor(H / 6));
    rtA.setSize(bw, bh);
    rtB.setSize(bw, bh);
    blur.uniforms.uTexel.value.set(1 / bw, 1 / bh);
  }

  function render(scene, cam, time) {
    renderer.setRenderTarget(rtScene);
    renderer.clear();
    renderer.render(scene, cam);

    if (bloomOn) {
      mesh.material = threshold;
      threshold.uniforms.tDiffuse.value = rtScene.texture;
      renderer.setRenderTarget(rtA);
      renderer.render(quadScene, quadCam);

      mesh.material = blur;
      blur.uniforms.tDiffuse.value = rtA.texture;
      blur.uniforms.uDir.value.set(1, 0);
      renderer.setRenderTarget(rtB);
      renderer.render(quadScene, quadCam);

      blur.uniforms.tDiffuse.value = rtB.texture;
      blur.uniforms.uDir.value.set(0, 1);
      renderer.setRenderTarget(rtA);
      renderer.render(quadScene, quadCam);
    }

    composite.uniforms.tScene.value = rtScene.texture;
    composite.uniforms.tBloom.value = rtA.texture;
    composite.uniforms.uTime.value = time;

    mesh.material = composite;
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
  }

  return {
    resize, render, composite,
    setBloom(v) { bloomOn = v; if (!v) composite.uniforms.uBloom.value = 0; else composite.uniforms.uBloom.value = 0.30; },
    get size() { return { W, H }; }
  };
})();

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
if (settings.quality === 'low') dpr = 1;
else if (settings.quality === 'mid') dpr = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight);

const world = createWorld(renderer, settings.quality);
const scene = world.scene;
scene.add(camera);
const effects = createEffects(scene, settings.quality);
const audio = createAudio();

const viewmodel = createViewModel(settings.look);
camera.add(viewmodel.group);
viewmodel.setVisible(false);

let baseDpr = 1;
let renderScale = 1;

function applyQuality(q) {
  const base = window.devicePixelRatio || 1;
  dpr = q === 'low' ? 1 : q === 'mid' ? Math.min(base, 1.35) : Math.min(base, 1.5);
  baseDpr = dpr;
  post.setBloom(q !== 'low');
  post.composite.uniforms.uGrain.value = q === 'low' ? 0.6 : 1;
  applyRenderScale(renderScale);
}

// Holds the frame budget by scaling render resolution only — simulation,
// network rate and gameplay timing stay untouched.
function applyRenderScale(s) {
  renderScale = Math.max(0.6, Math.min(1, s));
  const ratio = Math.max(0.55, baseDpr * renderScale);
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.resize(window.innerWidth, window.innerHeight, ratio);
  world.setSnowQuality(ratio);
}
applyQuality(settings.quality);

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const G = {
  mode: 'menu',
  session: null,
  selfId: null,
  roster: new Map(),
  scores: new Map(),
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  vy: 0,
  grounded: true,
  yaw: 0,
  pitch: 0,
  keys: new Set(),
  spawned: false,
  dead: false,
  deadAt: 0,
  killer: '',
  deathT: 0,
  charging: false,
  charge: 0,
  cooldown: 0,
  throwSeq: 0,
  lastState: 0,
  lastInput: 0,
  remotes: new Map(),
  projectiles: new Map(),
  footAccum: 0,
  footSide: 1,
  bobT: 0,
  recoil: 0,
  shake: 0,
  flash: 0,
  desat: 0,
  fovKick: 0,
  menuT: Math.random() * 20,
  matchEnd: false,
  toastTimer: 0,
  mouseSwayX: 0,
  mouseSwayY: 0,
  lastFrame: performance.now(),
  ping: 0,
  lastPingUpdate: 0,
  breathTimer: 2,
  lastScoreRender: 0,
  stamina: 1,
  staminaLock: 0,
  coyote: 0,
  jumpBuf: 0,
  landDip: 0,
  spread: 0,
  lastNear: 0,
  lowFx: false,
  focus: 0
};

const isPlaying = () => G.session && !G.dead && G.mode === 'playing';
const nowMs = () => performance.now();

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function showToast(text) {
  const line = document.createElement('div');
  line.className = 'toast-line';
  line.textContent = text;
  ui.toast.appendChild(line);
  setTimeout(() => { line.style.opacity = '0'; }, 3600);
  setTimeout(() => { line.remove(); }, 4000);
}

function addFeed(shooterName, victimName, isMine) {
  const el = document.createElement('div');
  el.className = 'feed';
  const shooter = shooterName || 'Welt';
  el.innerHTML = `<b>${escapeHtml(shooter)}</b><span class="skull">✦</span><b>${escapeHtml(victimName)}</b>`;
  if (isMine) el.style.borderRightColor = '#ffd08a';
  ui.killfeed.prepend(el);
  setTimeout(() => { el.classList.add('out'); }, 5000);
  setTimeout(() => { el.remove(); }, 5400);
  while (ui.killfeed.children.length > 6) ui.killfeed.lastChild.remove();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nameOf(id) {
  return G.roster.get(id)?.name || 'Spieler';
}

function setRoomCode(code) {
  ui.roomCode.textContent = code || '-----';
  ui.pauseCode.textContent = code || '-----';
}

function copyCode() {
  const code = ui.roomCode.textContent;
  if (!code || code === '-----') return;
  navigator.clipboard?.writeText(code).then(() => {
    showToast('Raumcode kopiert: ' + code);
    audio.ui();
  }).catch(() => showToast('Code: ' + code));
}

function showHitmarker(kill) {
  ui.hitmarker.classList.remove('show');
  void ui.hitmarker.offsetWidth;
  ui.hitmarker.classList.toggle('kill', !!kill);
  ui.hitmarker.classList.add('show');
}

function pushFeedNames(s, v, mine) {
  addFeed(s ? nameOf(s) : 'Welt', nameOf(v), mine);
}

// ---------------------------------------------------------------------------
// Menu wiring
// ---------------------------------------------------------------------------
ui.nameInput.addEventListener('input', () => {
  settings.name = ui.nameInput.value;
  saveSettings();
});
ui.sensRange.addEventListener('input', () => {
  settings.sens = Number(ui.sensRange.value);
  ui.sensVal.textContent = settings.sens.toFixed(2);
  saveSettings();
});
ui.volRange.addEventListener('input', () => {
  settings.vol = Number(ui.volRange.value);
  ui.volVal.textContent = Math.round(settings.vol * 100) + '%';
  audio.setVolume(settings.vol);
  saveSettings();
});
ui.qualitySel.addEventListener('change', () => {
  settings.quality = ui.qualitySel.value;
  applyQuality(settings.quality);
  saveSettings();
});
ui.botsSel.addEventListener('change', () => {
  settings.bots = Number(ui.botsSel.value);
  saveSettings();
});
ui.muteBtn.addEventListener('click', () => {
  audio.init();
  audio.setMuted(!audio.isMuted());
  ui.muteBtn.textContent = audio.isMuted() ? 'TON AUS' : 'TON AN';
});
ui.roomChip.addEventListener('click', copyCode);
ui.copyCode.addEventListener('click', copyCode);
ui.menuBtn.addEventListener('click', () => {
  if (document.pointerLockElement) document.exitPointerLock();
  else openPause();
});
ui.leaveBtn.addEventListener('click', leaveGame);
ui.resumeBtn.addEventListener('click', resumeGame);

function setMenuStatus(text, cls = '') {
  ui.menuStatus.textContent = text;
  ui.menuStatus.className = 'status ' + cls;
}

function setLoading(on, text = 'Verbinde …') {
  ui.loading.classList.toggle('hidden', !on);
  ui.loadingText.textContent = text;
  ui.hostBtn.disabled = on;
  ui.joinBtn.disabled = on;
}


// ---------------------------------------------------------------------------
// Palette swatches + live character preview
// ---------------------------------------------------------------------------
const LOOK_SLOTS = [
  { key: 'j', box: ui.swJacket, list: LOOK_PALETTES.jacket },
  { key: 's', box: ui.swScarf, list: LOOK_PALETTES.scarf },
  { key: 'h', box: ui.swHat, list: LOOK_PALETTES.hat },
  { key: 'k', box: ui.swSkin, list: LOOK_PALETTES.skin }
];

function lookSummary() {
  const j = LOOK_PALETTES.names.jacket[settings.look.j % LOOK_PALETTES.jacket.length] || 'Jacke';
  const s = LOOK_PALETTES.names.scarf[settings.look.s % LOOK_PALETTES.scarf.length] || 'Schal';
  const k = LOOK_PALETTES.names.skin[settings.look.k % LOOK_PALETTES.skin.length] || 'Haut';
  return `${j} · ${s} · ${k}`;
}

function paintSwatches() {
  for (const slot of LOOK_SLOTS) {
    if (!slot.box) continue;
    [...slot.box.children].forEach((b, i) => b.classList.toggle('is-on', settings.look[slot.key] === i));
  }
  if (ui.lookSummary) ui.lookSummary.textContent = lookSummary();
}

function buildSwatches() {
  for (const slot of LOOK_SLOTS) {
    if (!slot.box) continue;
    slot.box.innerHTML = '';
    slot.list.forEach((color, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = '#' + new THREE.Color(color).getHexString();
      b.title = slot.key.toUpperCase() + ' ' + (i + 1);
      b.addEventListener('click', () => {
        if (settings.look[slot.key] === i) return;
        settings.look[slot.key] = i;
        saveSettings();
        paintSwatches();
        preview.refresh();
      });
      slot.box.appendChild(b);
    });
  }
  paintSwatches();
}

const preview = (() => {
  const canvas = ui.preview;
  if (!canvas) return { refresh() {}, show() {}, hide() {} };
  let renderer = null, scene = null, camera = null, ch = null;
  let raf = 0, last = 0, running = false, clock = 0;

  function ensure() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(31, 1, 0.05, 20);
    camera.position.set(0, 1.05, 4.35);
    camera.lookAt(0, 1.05, 0);

    scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x2a3742, 1.9));
    const key = new THREE.DirectionalLight(0xfff3e4, 2.5);
    key.position.set(-1.8, 2.6, 2.6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd2ff, 2.0);
    rim.position.set(2.4, 1.9, -2.4);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffd9c2, 0.9);
    fill.position.set(2.2, 0.6, 1.8);
    scene.add(fill);

    // soft contact shadow only: no pedestal, no frame, so the character floats
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext('2d');
    const grad = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(3,10,18,0.55)');
    grad.addColorStop(0.55, 'rgba(3,10,18,0.24)');
    grad.addColorStop(1, 'rgba(3,10,18,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 128, 128);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: shadowTex, transparent: true, depthWrite: false, opacity: 0.9
    }));
    shadow.scale.set(1.55, 0.52, 1);
    shadow.position.set(0, 0.03, 0);
    scene.add(shadow);
  }

  function build() {
    if (!scene) return;
    if (ch) scene.remove(ch.root);
    ch = createCharacter(characterColor(settings.name || 'du'), settings.look);
    ch.root.position.set(0, 0, 0);
    scene.add(ch.root);
    pose(0);
  }

  function pose(dt) {
    if (!ch) return;
    // the character owns its root yaw, so the turn goes through update() --
    // that keeps the idle lean and turn smoothing in one place
    ch.update(dt, { speed: 0, grounded: true, yaw: Math.PI + Math.sin(clock * 0.42) * 0.72 });
  }

  function resize() {
    if (!renderer) return;
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function frame(t) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    clock += dt;
    resize();
    pose(dt);
    renderer.render(scene, camera);
  }

  return {
    refresh() { ensure(); build(); },
    show() {
      ensure();
      if (!ch) build();
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    hide() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  };
})();

ui.randomLook?.addEventListener('click', () => {
  const pick = (n) => Math.floor(Math.random() * n);
  settings.look = {
    j: pick(LOOK_PALETTES.jacket.length),
    s: pick(LOOK_PALETTES.scarf.length),
    k: pick(LOOK_PALETTES.skin.length),
    h: pick(LOOK_PALETTES.hat.length)
  };
  saveSettings();
  paintSwatches();
  preview.refresh();
});

ui.optionsBtn?.addEventListener('click', () => ui.optionsPanel.classList.toggle('hidden'));
ui.optionsClose?.addEventListener('click', () => ui.optionsPanel.classList.add('hidden'));

ui.fpsToggle?.addEventListener('change', () => {
  settings.showFps = ui.fpsToggle.checked;
  saveSettings();
  ui.perfChip.classList.toggle('hidden', !settings.showFps);
});

buildSwatches();
preview.refresh();

// The menu is toggled by class in several places, so follow the class instead
// of sprinkling show/hide calls through the session code.
if (ui.menu) {
  new MutationObserver(() => {
    if (ui.menu.classList.contains('hidden')) preview.hide();
    else preview.show();
  }).observe(ui.menu, { attributes: true, attributeFilter: ['class'] });
}
preview.show();

ui.hostBtn.addEventListener('click', async () => {
  audio.init();
  audio.setVolume(settings.vol);
  const name = (ui.nameInput.value.trim() || 'Gast').slice(0, 14);
  settings.name = name;
  saveSettings();
  setMenuStatus('Raum wird erstellt …');
  setLoading(true, 'Raum wird erstellt …');
  try {
    const session = hostGame({
      name,
      bots: settings.bots,
      look: settings.look,
      onState: handleState,
      onEvent: handleEvent,
      onRoster: handleRoster,
      onError: (msg) => {
        setMenuStatus(msg, 'err');
        showToast(msg);
      },
      onClosed: () => {}
    });
    const code = await session.start();
    G.session = session;
    G.selfId = 'host';
    setRoomCode(code);
    ui.hud.classList.remove('hidden');
    ui.menu.classList.add('hidden');
    setLoading(false);
    setMenuStatus('Bereit.', 'ok');
    G.mode = 'paused';
    openPause(true);
    showToast('Raum erstellt — Code ' + code + ' teilen');
  } catch (err) {
    console.error(err);
    setLoading(false);
    setMenuStatus(err.message || 'Raum konnte nicht erstellt werden.', 'err');
  }
});

ui.joinBtn.addEventListener('click', async () => {
  audio.init();
  audio.setVolume(settings.vol);
  const code = (ui.joinCode.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) {
    setMenuStatus('Bitte einen gültigen Raumcode eingeben.', 'err');
    return;
  }
  const name = (ui.nameInput.value.trim() || 'Gast').slice(0, 14);
  settings.name = name;
  saveSettings();
  setMenuStatus('Verbinde mit Raum ' + code + ' …');
  setLoading(true, 'Verbinde mit Raum ' + code + ' …');
  try {
    const session = joinGame({
      code,
      name,
      look: settings.look,
      onState: handleState,
      onEvent: handleEvent,
      onRoster: handleRoster,
      onError: (msg) => {
        setMenuStatus(msg, 'err');
        showToast(msg);
      },
      onClosed: (msg) => {
        showToast(msg);
        leaveGame(true);
      },
      onReady: (info) => {
        G.selfId = info.id;
        setRoomCode(code);
        ui.hud.classList.remove('hidden');
        ui.menu.classList.add('hidden');
        G.mode = 'paused';
        openPause(true);
      }
    });
    await session.start();
    G.session = session;
    setLoading(false);
    setMenuStatus('Verbunden.', 'ok');
  } catch (err) {
    console.error(err);
    setLoading(false);
    setMenuStatus(err.message || 'Verbindung fehlgeschlagen.', 'err');
  }
});

ui.joinCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ui.joinBtn.click();
});

// ---------------------------------------------------------------------------
// Session handlers
// ---------------------------------------------------------------------------
function handleRoster(players) {
  G.roster.clear();
  for (const p of players) G.roster.set(p.id, { name: p.name, bot: p.bot });
  // refresh existing name tags
  for (const [id, r] of G.remotes) {
    const info = G.roster.get(id);
    if (info && r.tag) {
      r.tag.material.map.dispose();
      r.tag.material.dispose();
      r.root.remove(r.tag);
      r.tag = makeNameTag(info.name, characterColor(id));
      r.root.add(r.tag);
    }
  }
}

function handleState(snap) {
  if (!snap || !snap.ps) return;
  G.scores.clear();
  for (const [id, k, d] of snap.sc || []) G.scores.set(id, { k, d });
  ui.onlineCount.textContent = snap.n ?? 0;

  const seen = new Set();
  let meEntry = null;

  for (const p of snap.ps) {
    const id = p[0];
    seen.add(id);
    if (id === G.selfId) { meEntry = p; continue; }
    updateRemote(id, p);
  }

  // drop stale remote players
  for (const [id, r] of G.remotes) {
    if (!seen.has(id)) {
      scene.remove(r.root);
      disposeObject(r.root);
      G.remotes.delete(id);
    }
  }

  if (meEntry) {
    const dead = !!meEntry[6];
    if (!G.spawned) {
      G.pos.set(meEntry[1], meEntry[2], meEntry[3]);
      G.spawned = true;
      G.yaw = meEntry[4];
      G.pitch = meEntry[5];
    }
    if (!dead && G.dead) reviveSelf(meEntry);
    else if (dead && !G.dead) dieSelf(G.killer || 'Unbekannt');
  }

  if (snap.end > 0 && !G.matchEnd) {
    G.matchEnd = true;
  }
  updateScoreboardVisibility();
}

function updateRemote(id, p) {
  let r = G.remotes.get(id);
  if (!r) {
    const info = G.roster.get(id) || { name: 'Spieler', bot: false };
    const ch = createCharacter(characterColor(id), info.look);
    const tag = makeNameTag(info.name, characterColor(id));
    ch.root.add(tag);
    scene.add(ch.root);
    r = {
      root: ch.root, ch, tag, buf: [], dead: false, deadFrames: 0,
      lastPos: new THREE.Vector3(), foot: 0, side: 1, yaw: 0, pitch: 0
    };
    r.lastPos.set(p[1], p[2], p[3]);
    G.remotes.set(id, r);
  }
  r.buf.push({ t: nowMs(), x: p[1], y: p[2], z: p[3], yaw: p[4], pitch: p[5], dead: !!p[6], anim: p[7] });
  if (r.buf.length > 18) r.buf.shift();
  r.dead = !!p[6];
}

function handleEvent(msg) {
  if (!msg || !msg.t) return;

  if (msg.t === 'throw') {
    if (msg.own !== G.selfId) {
      spawnProjectileVisual(msg.id, msg.o, msg.v);
      const r = G.remotes.get(msg.own);
      if (r) { r.ch.triggerThrow(); }
      audio.throwWhoosh();
    }
    return;
  }

  if (msg.t === 'impact') {
    const pr = G.projectiles.get(msg.id);
    if (pr) {
      scene.remove(pr.mesh);
      G.projectiles.delete(msg.id);
    }
    effects.impact(msg.x, msg.y, msg.z, msg.k);
    audio.impact({ x: msg.x, y: msg.y, z: msg.z }, camera, msg.k);
    if (msg.k === 'body') {
      // whoever took the hit flinches
      for (const [, r] of G.remotes) {
        if (Math.hypot(r.root.position.x - msg.x, r.root.position.z - msg.z) < 1.5) {
          r.ch.hit(1);
          break;
        }
      }
    }
    if (msg.k === 'body' && msg.own === G.selfId) {
      showHitmarker(false);
      audio.hitmarker();
      G.shake = Math.max(G.shake, 0.12);
    } else if (msg.k === 'body' && Math.hypot(msg.x - camera.position.x, msg.z - camera.position.z) < 3) {
      G.shake = Math.max(G.shake, 0.2);
    }
    return;
  }

  if (msg.t === 'near') {
    // a ball whistled past: small flinch + whoosh
    if (nowMs() - G.lastNear > 90) {
      G.lastNear = nowMs();
      const d = Math.hypot(msg.x - camera.position.x, msg.z - camera.position.z);
      if (d < 14) {
        G.shake = Math.max(G.shake, 0.05 * (1 - d / 14));
        audio.throwWhoosh();
      }
    }
    return;
  }

  if (msg.t === 'kill') {
    pushFeedNames(msg.s, msg.v, msg.s === G.selfId || msg.v === G.selfId);
    if (msg.v === G.selfId) {
      G.killer = msg.sn || 'Unbekannt';
      dieSelf(G.killer);
    }
    if (msg.s === G.selfId) {
      showHitmarker(true);
      audio.killConfirm();
    }
    if (msg.k >= 15) {
      // match end event follows
    }
    updateScoreboardVisibility();
    return;
  }

  if (msg.t === 'respawn') {
    if (msg.id === G.selfId) {
      G.pos.set(msg.x, msg.y, msg.z);
      G.yaw = msg.yaw || 0;
      G.pitch = 0;
      reviveSelf(null);
    } else {
      const r = G.remotes.get(msg.id);
      if (r) {
        r.buf.length = 0;
        r.root.position.set(msg.x, msg.y, msg.z);
        r.dead = false;
      }
    }
    return;
  }

  if (msg.t === 'matchEnd') {
    G.matchEnd = true;
    ui.matchText.textContent = msg.winner.name + ' GEWINNT';
    ui.matchSub.textContent = `${msg.score} Eliminierungen · neue Runde in wenigen Sekunden`;
    ui.matchBanner.classList.remove('hidden');
    audio.matchEnd();
    return;
  }

  if (msg.t === 'reset') {
    G.matchEnd = false;
    G.scores.clear();
    ui.matchBanner.classList.add('hidden');
    showToast('Neue Runde — viel Erfolg');
    return;
  }

  if (msg.t === 'join') {
    G.roster.set(msg.id, { name: msg.name, bot: msg.bot });
    if (!msg.bot && msg.id !== G.selfId) showToast(msg.name + ' ist beigetreten');
    return;
  }

  if (msg.t === 'leave') {
    G.roster.delete(msg.id);
    const r = G.remotes.get(msg.id);
    if (r) {
      scene.remove(r.root);
      disposeObject(r.root);
      G.remotes.delete(msg.id);
    }
    if (!msg.bot) showToast(msg.name + ' hat verlassen');
    return;
  }
}

function disposeObject(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose?.();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.map?.dispose?.();
        m.alphaMap?.dispose?.();
        m.normalMap?.dispose?.();
        m.dispose?.();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Death / respawn
// ---------------------------------------------------------------------------
function dieSelf(killer) {
  if (G.dead) return;
  G.dead = true;
  G.deadAt = nowMs();
  G.deathT = 0;
  G.killer = killer;
  G.charging = false;
  G.charge = 0;
  G.desat = 0;
  G.flash = 0.8;
  viewmodel.setVisible(false);
  ui.death.classList.remove('hidden');
  ui.deathKiller.textContent = killer;
  ui.chargeRing.classList.remove('active');
  ui.chargeLabel.classList.remove('show');
  audio.death();
  effects.deathBurst(G.pos.x, G.pos.y, G.pos.z);
}

function reviveSelf(entry) {
  if (!G.dead && !entry) return;
  G.dead = false;
  G.deathT = 0;
  G.killer = '';
  ui.death.classList.add('hidden');
  viewmodel.setVisible(true);
  G.vy = 0;
  G.grounded = true;
  if (entry) {
    G.pos.set(entry[1], entry[2], entry[3]);
    G.yaw = entry[4];
    G.pitch = entry[5];
  }
  audio.respawn();
}

function updateDeathUI(dt) {
  if (!G.dead) return;
  const elapsed = (nowMs() - G.deadAt) / 1000;
  const p = Math.min(1, elapsed / (RESPAWN_MS / 1000));
  ui.respawnBar.style.width = (p * 100) + '%';
  const remain = Math.max(0, RESPAWN_MS / 1000 - elapsed);
  ui.respawnText.textContent = remain > 0 ? `NEUER EINSATZ IN ${remain.toFixed(1)} s` : 'NEUER EINSATZ …';
  G.desat = Math.min(1, G.desat + dt * 2.2);
}

// ---------------------------------------------------------------------------
// Pause / pointer lock
// ---------------------------------------------------------------------------
function openPause(first = false) {
  ui.pause.classList.remove('hidden');
  ui.resumeBtn.textContent = first ? 'EINSATZ STARTEN' : 'WEITERSPIELEN';
  ui.pause.querySelector('h2').textContent = first ? 'BEREIT' : 'PAUSE';
  ui.pause.querySelector('p').textContent = first
    ? 'Klicke, um die Maus zu steuern. Esc öffnet später die Pause.'
    : 'Das Match läuft weiter. Du bist verwundbar.';
  ui.scoreboard.classList.add('hidden');
}

function closePause() {
  ui.pause.classList.add('hidden');
}

function resumeGame() {
  audio.init();
  audio.setVolume(settings.vol);
  closePause();
  const p = canvas.requestPointerLock();
  if (p && p.catch) p.catch(() => { /* fallback below */ });
  setTimeout(() => {
    if (document.pointerLockElement !== canvas) {
      // Browser blockiert Pointer Lock in seltenen Fällen – ohne Lock weiterspielen.
      G.mode = 'playing';
    }
  }, 250);
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    G.mode = 'playing';
    closePause();
  } else if (G.mode === 'playing' && !G.dead) {
    G.mode = 'paused';
    openPause(false);
  }
});

canvas.addEventListener('click', () => {
  if (G.session && G.mode === 'playing' && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});

function leaveGame(silent = false) {
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}
  G.session?.close();
  G.session = null;
  if (!silent) {
    location.reload();
  }
}

window.addEventListener('beforeunload', () => {
  try { G.session?.close(); } catch {}
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const key = e.code;
  if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(key)) e.preventDefault();

  if (key === 'Tab') {
    if (G.session && !G.dead) {
      ui.scoreboard.classList.remove('hidden');
      renderScoreboard(true);
    }
    return;
  }
  if (key === 'Escape') {
    if (G.session && G.mode === 'playing') document.exitPointerLock?.();
    return;
  }
  if (key === 'KeyM') {
    audio.init();
    audio.setMuted(!audio.isMuted());
    ui.muteBtn.textContent = audio.isMuted() ? 'TON AUS' : 'TON AN';
    return;
  }
  if (key === 'KeyF') {
    settings.showFps = !settings.showFps;
    saveSettings();
    ui.perfChip.classList.toggle('hidden', !settings.showFps);
    showToast(settings.showFps ? 'FPS-Anzeige an' : 'FPS-Anzeige aus');
    return;
  }
  if (key === 'Space') G.jumpBuf = 0.16;
  G.keys.add(key);
});

window.addEventListener('keyup', (e) => {
  G.keys.delete(e.code);
  if (e.code === 'Tab') {
    ui.scoreboard.classList.add('hidden');
    updateScoreboardVisibility();
  }
});

window.addEventListener('blur', () => {
  G.keys.clear();
  G.charging = false;
  G.charge = 0;
});

document.addEventListener('mousemove', (e) => {
  if (!hasMouse()) return;
  if (G.mode !== 'playing') return;
  const s = 0.0021 * settings.sens;
  G.yaw -= e.movementX * s;
  G.pitch -= e.movementY * s;
  G.pitch = Math.max(-1.5, Math.min(1.5, G.pitch));
  G.mouseSwayX = THREE.MathUtils.clamp(G.mouseSwayX + e.movementX * 0.05, -12, 12);
  G.mouseSwayY = THREE.MathUtils.clamp(G.mouseSwayY + e.movementY * 0.05, -12, 12);
});

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  audio.init();
  if (G.mode !== 'playing' || !G.session || G.dead) return;
  if (!hasMouse()) return;
  if (G.cooldown > 0) return;
  G.charging = true;
  G.charge = 0;
  ui.chargeRing.classList.add('active');
  ui.chargeLabel.classList.add('show');
});

document.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  if (!G.charging) return;
  G.charging = false;
  throwSnowball();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Throw
// ---------------------------------------------------------------------------
function throwSnowball() {
  const power = Math.min(1, G.charge);
  G.charge = 0;
  ui.chargeRing.classList.remove('active');
  ui.chargeLabel.classList.remove('show');
  ui.chargeWrap.classList.remove('full');
  if (!G.session || G.dead || G.mode !== 'playing') return;

  // a rushed throw is weaker and less accurate than a full wind-up
  const speed = 15 + power * 19;
  const moveSpread = Math.min(1, Math.hypot(moveDir.x, moveDir.z) / PLAYER.sprint);
  const spread = 0.004 + moveSpread * 0.017 + (1 - power) * 0.011 + (G.grounded ? 0 : 0.008);

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread * 0.7;
  dir.z += (Math.random() - 0.5) * spread;
  dir.normalize();

  const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
  const origin = camera.position.clone()
    .add(dir.clone().multiplyScalar(0.46))
    .add(right.clone().multiplyScalar(0.15))
    .add(new THREE.Vector3(0, -0.10, 0));

  const vel = dir.clone().multiplyScalar(speed);
  vel.x += WIND.x * 0.25;
  vel.z += WIND.z * 0.25;

  G.throwSeq++;
  const id = `${G.selfId}:${G.throwSeq}`;
  spawnProjectileVisual(id, origin.toArray(), vel.toArray());
  G.session.throwBall(G.throwSeq, origin.toArray(), vel.toArray());

  viewmodel.throwBall();
  G.cooldown = 0.30 + (1 - power) * 0.14;
  G.fovKick = 2.6 + power * 1.2;
  G.recoil += 0.005 + power * 0.013;
  G.shake = Math.max(G.shake, 0.028 + power * 0.012);
  audio.throwWhoosh();
}

function spawnProjectileVisual(id, o, v) {
  if (G.projectiles.has(id)) return;
  const mesh = effects.createBallMesh();
  mesh.position.set(o[0], o[1], o[2]);
  scene.add(mesh);
  G.projectiles.set(id, {
    id, mesh,
    p: new THREE.Vector3(o[0], o[1], o[2]),
    v: new THREE.Vector3(v[0], v[1], v[2]),
    life: 0, trailT: 0,
    spin: new THREE.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4)
  });
}

// ---------------------------------------------------------------------------
// Aim arc: while the world is frozen for a throw, draw where the snowball will
// actually go (gravity, drag and wind included) plus a landing ring.
// ---------------------------------------------------------------------------
const aim = (() => {
  const N = 64;
  const geo = new THREE.BufferGeometry();
  const pts = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  // a dotted glow reads far better than a hairline in a snowstorm
  const dotC = document.createElement('canvas');
  dotC.width = dotC.height = 64;
  const dctx = dotC.getContext('2d');
  const dg = dctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  dg.addColorStop(0, 'rgba(255,255,255,1)');
  dg.addColorStop(0.35, 'rgba(210,240,255,0.85)');
  dg.addColorStop(1, 'rgba(180,225,255,0)');
  dctx.fillStyle = dg;
  dctx.fillRect(0, 0, 64, 64);
  const dotTex = new THREE.CanvasTexture(dotC);
  const mat = new THREE.PointsMaterial({
    map: dotTex, color: 0xbfe9ff, size: 6.5, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false, alphaTest: 0.02,
    blending: THREE.AdditiveBlending, fog: false
  });
  const line = new THREE.Points(geo, mat);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.26, 0.36, 40),
    new THREE.MeshBasicMaterial({
      color: 0xcdeeff, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  const p = new THREE.Vector3(), v = new THREE.Vector3(), dir = new THREE.Vector3();
  let fade = 0;

  function update(dt, charge) {
    const targetFade = (charge > 0.10 && !G.dead && G.mode === 'playing') ? Math.min(1, (charge - 0.1) * 3.4) : 0;
    fade += (targetFade - fade) * Math.min(1, dt * 16);
    if (fade < 0.02) { line.visible = false; ring.visible = false; return; }

    const power = Math.min(1, charge);
    camera.updateMatrixWorld();
    camera.getWorldDirection(dir);
    p.copy(camera.position).addScaledVector(dir, 0.46);
    p.y -= 0.10;
    v.copy(dir).multiplyScalar(15 + power * 19);
    v.x += WIND.x * 0.25;
    v.z += WIND.z * 0.25;

    const step = 0.032;
    let n = 0;
    for (let i = 0; i < N; i++) {
      pts[i * 3] = p.x; pts[i * 3 + 1] = p.y; pts[i * 3 + 2] = p.z;
      n = i;
      v.y -= BALL.gravity * step;
      const dragF = Math.max(0, 1 - BALL.drag * step);
      v.x *= dragF; v.y *= dragF; v.z *= dragF;
      v.x += WIND.x * step;
      v.z += WIND.z * step;
      p.addScaledVector(v, step);
      const g = terrainHeight(p.x, p.z) + 0.06;
      if (p.y <= g) { p.y = g; n = i + 1; break; }
    }
    for (let i = n + 1; i < N; i++) {
      pts[i * 3] = p.x; pts[i * 3 + 1] = p.y; pts[i * 3 + 2] = p.z;
    }
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, Math.min(N, n + 2));
    line.visible = true;
    mat.opacity = 0.85 * fade;

    ring.position.set(p.x, p.y + 0.04, p.z);
    ring.visible = true;
    ring.material.opacity = 0.45 * fade;
    ring.scale.setScalar(1 + (1 - fade) * 0.5);
  }

  return { update };
})();

function updateProjectiles(dt) {
  for (const [id, pr] of G.projectiles) {
    pr.life += dt;
    pr.v.y -= BALL.gravity * dt;
    const dragF = Math.max(0, 1 - BALL.drag * dt);
    pr.v.x *= dragF; pr.v.y *= dragF; pr.v.z *= dragF;
    pr.v.x += WIND.x * dt;
    pr.v.z += WIND.z * dt;
    pr.p.addScaledVector(pr.v, dt);
    pr.mesh.position.copy(pr.p);
    pr.mesh.rotation.x += pr.spin.x * dt;
    pr.mesh.rotation.y += pr.spin.y * dt;

    pr.trailT += dt;
    if (pr.trailT > 0.016) {
      pr.trailT = 0;
      effects.trail(pr.p.x, pr.p.y, pr.p.z);
    }

    const ground = terrainHeight(pr.p.x, pr.p.z);
    if (pr.p.y < ground - 0.25 || pr.life > 9 || Math.hypot(pr.p.x, pr.p.z) > WORLD.half) {
      scene.remove(pr.mesh);
      G.projectiles.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Local movement
// ---------------------------------------------------------------------------
const moveDir = new THREE.Vector3();
const wishDir = new THREE.Vector3();

function updateLocalPlayer(dt, realDt = dt) {
  if (!G.spawned || !G.session) return;

  const alive = !G.dead;
  let wishX = 0, wishZ = 0;
  if (alive && G.mode === 'playing' && hasMouse()) {
    const f = G.keys.has('KeyW') ? 1 : 0;
    const b = G.keys.has('KeyS') ? 1 : 0;
    const l = G.keys.has('KeyA') ? 1 : 0;
    const r = G.keys.has('KeyD') ? 1 : 0;
    const fwd = f - b;
    const side = r - l;
    if (fwd || side) {
      const sin = Math.sin(G.yaw), cos = Math.cos(G.yaw);
      wishX = -sin * fwd + cos * side;
      wishZ = -cos * fwd - sin * side;
      const len = Math.hypot(wishX, wishZ) || 1;
      wishX /= len; wishZ /= len;
    }
  }

  // --- sprint stamina -----------------------------------------------------
  const wantSprint = (G.keys.has('ShiftLeft') || G.keys.has('ShiftRight')) && alive && G.mode === 'playing';
  const wantsToMove = Math.hypot(wishX, wishZ) > 0.01;
  const sprinting = wantSprint && wantsToMove && G.stamina > 0.02 && G.staminaLock <= 0;

  if (sprinting) {
    G.stamina = Math.max(0, G.stamina - dt * 0.29);
    if (G.stamina <= 0) G.staminaLock = 1.1;
  } else {
    G.stamina = Math.min(1, G.stamina + dt * (wantsToMove ? 0.16 : 0.32));
  }
  G.staminaLock = Math.max(0, G.staminaLock - dt);

  const maxSpeed = sprinting ? PLAYER.sprint : PLAYER.walk;
  const accel = G.grounded ? 32 : 7.5;

  // steep ground pulls you downhill instead of letting you stand on a wall
  if (alive && G.grounded) {
    const slope = terrainSlope(G.pos.x, G.pos.z);
    if (slope > 0.26) {
      const n = terrainNormal(G.pos.x, G.pos.z);
      const pull = (slope - 0.26) * 26;
      moveDir.x += n.x * pull * dt;
      moveDir.z += n.z * pull * dt;
    }
  }

  moveDir.x += (wishX * maxSpeed - moveDir.x) * Math.min(1, accel * dt);
  moveDir.z += (wishZ * maxSpeed - moveDir.z) * Math.min(1, accel * dt);

  if (G.grounded && !wantsToMove) {
    const f = Math.max(0, 1 - dt * 9);
    moveDir.x *= f;
    moveDir.z *= f;
  }

  G.coyote = G.grounded ? 0.12 : Math.max(0, G.coyote - dt);
  G.jumpBuf = Math.max(0, G.jumpBuf - dt);

  if (alive) {
    G.pos.x += moveDir.x * dt;
    G.pos.z += moveDir.z * dt;
    resolvePlayerCollision(G.pos);
    clampToWorld(G.pos);

    if (G.jumpBuf > 0 && G.coyote > 0 && G.mode === 'playing') {
      G.vy = 6.1;
      G.grounded = false;
      G.coyote = 0;
      G.jumpBuf = 0;
      effects.spray(G.pos.x, G.pos.z, moveDir.x, moveDir.z, 0.8);
    }

    G.vy -= 24 * dt;
    G.pos.y += G.vy * dt;
    const ground = terrainHeight(G.pos.x, G.pos.z);
    if (G.pos.y <= ground) {
      const impact = Math.max(0, -G.vy);
      if (!G.grounded && impact > 1.5) {
        const force = Math.min(1.7, impact / 9);
        G.landDip = Math.min(0.17, 0.04 + force * 0.13);
        G.shake = Math.max(G.shake, 0.015 + force * 0.07);
        effects.landing(G.pos.x, ground, G.pos.z, force);
        audio.footstep(force > 0.8);
      }
      G.pos.y = ground;
      G.vy = 0;
      G.grounded = true;
    } else {
      G.grounded = false;
    }
    if (G.pos.y < -30) { G.pos.y = terrainHeight(G.pos.x, G.pos.z) + 1; }
  } else {
    moveDir.multiplyScalar(0.9);
  }

  // camera
  const speed = Math.hypot(moveDir.x, moveDir.z);
  const speedFactor = Math.min(1, speed / PLAYER.walk);
  G.bobT += dt * (2.2 + speed * 1.45);
  const bobY = Math.sin(G.bobT * 2) * 0.028 * speedFactor;
  const bobRoll = Math.sin(G.bobT) * 0.008 * speedFactor;

  G.recoil *= Math.max(0, 1 - dt * 9);
  G.shake *= Math.max(0, 1 - dt * 6);

  G.landDip *= Math.max(0, 1 - dt * 7);
  let eye = PLAYER.eye - G.landDip;

  if (G.dead) {
    G.deathT = Math.min(1, G.deathT + dt * 1.8);
    const k = 1 - Math.pow(1 - G.deathT, 3);
    eye = PLAYER.eye + (0.42 - PLAYER.eye) * k;
    camera.rotation.z = 0.6 * k;
    G.pitch += (Math.min(1.2, G.pitch + 0.9) - G.pitch) * Math.min(1, dt * 3);
  } else {
    camera.rotation.z += (bobRoll - camera.rotation.z) * Math.min(1, dt * 10);
  }

  const shakeX = (Math.random() - 0.5) * G.shake;
  const shakeY = (Math.random() - 0.5) * G.shake;

  camera.position.set(
    G.pos.x + shakeX,
    G.pos.y + eye + (G.dead ? 0 : bobY) + shakeY,
    G.pos.z
  );
  camera.rotation.set(
    G.pitch + G.recoil + shakeY * 0.6,
    G.yaw + shakeX * 0.3,
    camera.rotation.z,
    'YXZ'
  );

  // FOV
  const sprintFov = (sprinting && speed > 1 && !G.dead) ? 2.5 : 0;
  G.fovKick *= Math.max(0, 1 - dt * 6);
  const targetFov = 76 + sprintFov + (G.dead ? 8 : 0) + G.fovKick - G.focus * 2.6;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
  camera.updateProjectionMatrix();

  // footprints + crunch
  if (alive && G.grounded && speed > 0.8 && G.mode === 'playing') {
    G.footAccum += speed * dt;
    const stepDist = sprinting ? 1.45 : 1.05;
    if (G.footAccum >= stepDist) {
      G.footAccum = 0;
      G.footSide *= -1;
      effects.footstep(G.pos.x, G.pos.z, G.yaw + Math.PI, G.footSide);
      if (sprinting) effects.spray(G.pos.x, G.pos.z, -moveDir.x, -moveDir.z, 0.45);
      audio.footstep(sprinting);
    }
  } else if (G.footAccum > 0) {
    G.footAccum = Math.max(0, G.footAccum - dt);
  }

  // breath vapor
  if (!G.dead && G.mode === 'playing') {
    G.breathTimer -= realDt;
    if (G.breathTimer <= 0) {
      G.breathTimer = 2.8 + Math.random() * 1.6;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      effects.breath(
        camera.position.x + dir.x * 0.28 + 0.06,
        camera.position.y - 0.12,
        camera.position.z + dir.z * 0.28,
        dir.x, dir.z
      );
    }
  }

  // viewmodel
  const swayX = THREE.MathUtils.clamp(G.mouseSwayX, -14, 14);
  const swayY = THREE.MathUtils.clamp(G.mouseSwayY, -14, 14);
  G.mouseSwayX *= Math.max(0, 1 - realDt * 7);
  G.mouseSwayY *= Math.max(0, 1 - realDt * 7);

  // The arm sits at a fixed distance from the eye, so a narrow window makes it
  // read as a tree trunk. Scale the pivots with the field of view instead of
  // pushing them back, which would drag the hand into the middle of the screen.
  const vmScale = THREE.MathUtils.clamp(camera.aspect / 1.62, 0.60, 1.0) * 1.10;
  for (const part of viewmodel.group.children) {
    if (part.scale.x !== vmScale) part.scale.setScalar(vmScale);
  }
  viewmodel.update(realDt, {
    speed, sprinting, charging: G.charge,
    swayX, swayY, grounded: G.grounded, spread: vmScale
  });
  viewmodel.setVisible(!G.dead && G.mode !== 'menu');
  aim.update(realDt, G.charging ? G.charge : 0);
}

// ---------------------------------------------------------------------------
// Remote players
// ---------------------------------------------------------------------------
function updateRemotes(dt) {
  const renderTime = nowMs() - 115;

  for (const [, r] of G.remotes) {
    const buf = r.buf;
    if (buf.length === 0) continue;

    let a = buf[0], b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].t <= renderTime && buf[i + 1].t >= renderTime) { a = buf[i]; b = buf[i + 1]; break; }
    }
    if (renderTime >= b.t) { a = b = buf[buf.length - 1]; }

    const span = Math.max(1, b.t - a.t);
    const k = Math.max(0, Math.min(1, (renderTime - a.t) / span));

    const x = a.x + (b.x - a.x) * k;
    const y = a.y + (b.y - a.y) * k;
    const z = a.z + (b.z - a.z) * k;

    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const yaw = a.yaw + dy * k;
    const pitch = a.pitch + (b.pitch - a.pitch) * k;

    r.ch.root.position.set(x, y, z);
    r.ch.update(dt, {
      yaw,
      pitch,
      moving: (b.anim | 0) > 0,
      sprinting: (b.anim | 0) > 1,
      dead: !!b.dead
    });
    if (r.tag) r.tag.visible = !b.dead;

    // collapse puff for remote players
    if (b.dead && !r.wasDead) {
      r.wasDead = true;
      effects.deathBurst(x, y, z);
      audio.impact({ x, y: y + 1, z }, camera, 'body');
    } else if (!b.dead) {
      r.wasDead = false;
    }

    // cold breath vapour
    if (!b.dead) {
      r.breathT = (r.breathT || 0) - dt;
      if (r.breathT <= 0) {
        r.breathT = 3.2 + Math.random() * 3.2;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        effects.breath(x + fx * 0.30, y + 1.48, z + fz * 0.30, fx, fz);
      }
    }

    // footprints + powder for moving players
    const moved = Math.hypot(x - r.lastPos.x, z - r.lastPos.z);
    r.lastPos.set(x, y, z);
    if (!b.dead && moved > 0.02 && moved < 2) {
      r.foot += moved;
      if (r.foot > 1.15) {
        r.foot = 0;
        r.side *= -1;
        effects.addFootprint(x, z, yaw + Math.PI, r.side);
      }
    }
    r.yaw = yaw; r.pitch = pitch;
  }
}

// ---------------------------------------------------------------------------
// Networking loop
// ---------------------------------------------------------------------------
function sendState() {
  if (!G.session || !G.spawned) return;
  const now = nowMs();
  if (now - G.lastInput < 50) return;
  G.lastInput = now;
  const moving = Math.hypot(moveDir.x, moveDir.z) > 0.6;
  const sprinting = G.keys.has('ShiftLeft') || G.keys.has('ShiftRight');
  G.session.input({
    t: 's',
    p: [Number(G.pos.x.toFixed(2)), Number(G.pos.y.toFixed(2)), Number(G.pos.z.toFixed(2))],
    y: Number(G.yaw.toFixed(3)),
    pitch: Number(G.pitch.toFixed(3)),
    a: moving ? (sprinting ? 2 : 1) : 0,
    m: moving ? 1 : 0,
    sp: sprinting ? 1 : 0
  });
}

// Optional FPS readout (key F) with the current adaptive render scale.
function updateFpsChip() {
  if (!settings.showFps) return;
  const t = performance.now();
  if (t - (G.lastFpsUpdate || 0) < 250) return;
  G.lastFpsUpdate = t;
  const fps = fpsFrames > 0 ? fpsFrames / Math.max(0.001, fpsAccum) : 0;
  ui.fpsVal.textContent = fps > 0 ? fps.toFixed(0) : '–';
  ui.fpsVal.classList.toggle('warn', fps > 0 && fps < 50);
  ui.fpsScale.textContent = renderScale.toFixed(2) + '×';
}

function updateHud(dt) {
  if (G.session) {
    const now = nowMs();
    if (now - G.lastPingUpdate > 1000) {
      G.lastPingUpdate = now;
      G.ping = G.session.ping();
      ui.pingVal.textContent = G.ping;
    }
  }

  // stamina bar + dynamic crosshair spread
  if (ui.staminaFill) {
    ui.staminaFill.style.width = (G.stamina * 100).toFixed(1) + '%';
    ui.staminaWrap.classList.toggle('empty', G.stamina < 0.22);
    ui.staminaWrap.classList.toggle('sprinting', G.staminaLock > 0);
  }
  const speedNow = Math.hypot(moveDir.x, moveDir.z);
  const targetSpread = (speedNow / PLAYER.sprint) * 0.55 + (G.charging ? G.charge * 0.5 : 0) + (G.grounded ? 0 : 0.45);
  G.spread += (targetSpread - G.spread) * Math.min(1, dt * 9);
  ui.chargeWrap.style.setProperty('--spread', G.spread.toFixed(3));

  if (G.charging && G.mode === 'playing') {
    G.charge = Math.min(1, G.charge + dt / 0.85);
    const c = 276.5 * (1 - G.charge);
    ui.chargeArc.style.strokeDashoffset = String(c);
    ui.chargeWrap.classList.toggle('full', G.charge > 0.985);
    const power = G.charge > 0.985 ? 'MAXIMALE WUCHT' : 'WUCHT ' + Math.round(G.charge * 100) + '%';
    G.chargeLabel.textContent = power + ' · ZEITLUPE';
  }
  post.composite.uniforms.uFocus.value = G.focus;

  if (G.cooldown > 0) G.cooldown = Math.max(0, G.cooldown - dt);

  updateDeathUI(dt);
  if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 1.7);
  post.composite.uniforms.uDesat.value = G.dead ? Math.min(0.85, G.desat) : Math.max(0, post.composite.uniforms.uDesat.value - dt * 2);
  post.composite.uniforms.uFlash.value = G.flash;

  if (!ui.scoreboard.classList.contains('hidden')) {
    if (nowMs() - G.lastScoreRender > 300) {
      G.lastScoreRender = nowMs();
      renderScoreboard(false);
    }
  }
}

function renderScoreboard(force) {
  if (!G.session) return;
  const rows = [];
  for (const [id, info] of G.roster) {
    const sc = G.scores.get(id) || { k: 0, d: 0 };
    rows.push({ id, name: info.name, bot: info.bot, ...sc });
  }
  rows.sort((a, b) => b.k - a.k || a.d - b.d || a.name.localeCompare(b.name));
  ui.scoreRows.innerHTML = rows.map((r, i) => {
    const col = '#' + new THREE.Color(0x2c4660).getHexString();
    const color = ['#2c4660', '#6e2f33', '#33513f', '#5b4429', '#39406e', '#74451f', '#2f5b5e', '#512f52'][characterColor(r.id)];
    return `<div class="score-row ${r.id === G.selfId ? 'me' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="name"><i class="swatch" style="background:${color}"></i>${escapeHtml(r.name)}${r.bot ? '<span class="bot-tag">BOT</span>' : ''}</span>
      <span class="k">${r.k}</span>
      <span class="d">${r.d}</span>
    </div>`;
  }).join('');
}

function updateScoreboardVisibility() {
  if (!ui.scoreboard.classList.contains('hidden')) renderScoreboard(false);
}

function updateRoomInfo() {
  if (!G.session) return;
  ui.onlineCount.textContent = Math.max(1, [...G.roster.values()].filter(r => !r.bot).length);
}

// ---------------------------------------------------------------------------
// Menu camera
// ---------------------------------------------------------------------------
function menuCamera(dt) {
  G.menuT += dt * 0.055;
  const t = G.menuT;
  const radius = 46 + Math.sin(t * 0.6) * 6;
  const cx = 4 + Math.cos(t) * radius;
  const cz = -8 + Math.sin(t) * radius;
  const cy = Math.max(terrainHeight(cx, cz) + 9, 11) + Math.sin(t * 0.8) * 2.5;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 0.7));
  camera.lookAt(new THREE.Vector3(0, terrainHeight(0, -8) + 2.5, -8));
  camera.rotation.z = Math.sin(t * 0.4) * 0.015;
  camera.fov += (68 - camera.fov) * Math.min(1, dt * 2);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  post.resize(w, h, renderer.getPixelRatio());
  world.setSnowQuality(renderer.getPixelRatio());
}
window.addEventListener('resize', onResize);
onResize();

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let elapsed = 0;
let fpsAccum = 0;
let fpsFrames = 0;

function loop(fixedDt) {
  const now = performance.now();
  let dt = fixedDt ?? (now - G.lastFrame) / 1000;
  G.lastFrame = now;
  if (!Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 0.05);
  elapsed += dt;

  // Focus freeze: while a throw is wound up the whole world holds still,
  // then snaps back into motion the moment the ball leaves the hand.
  const wantFocus = G.charging && !!G.session && G.mode === 'playing' && !G.dead;
  G.focus += ((wantFocus ? 1 : 0) - G.focus) * Math.min(1, dt * (wantFocus ? 16 : 9));
  if (G.focus < 0.002) G.focus = 0;
  const worldDt = dt * (1 - G.focus * 0.97);

  if (G.session) {
    G.session.tick(worldDt);
    updateLocalPlayer(worldDt, dt);
    updateRemotes(worldDt);
    updateProjectiles(worldDt);
    sendState();
    updateHud(dt);
    world.update(worldDt, camera, G.pos);
  } else {
    menuCamera(dt);
    world.update(dt, camera, camera.position);
  }

  effects.update(worldDt, camera);
  audio.setMuted?.(audio.isMuted());

  post.render(scene, camera, elapsed);
  updateFpsChip();

  // frame-time governor: aim for a steady 60 fps (off in debug so captures
  // keep full quality on software renderers)
  fpsAccum += dt;
  fpsFrames++;
  if (!DEBUG && fpsAccum > 1.5) {
    const fps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
    if (fps < 52 && renderScale > 0.61) applyRenderScale(renderScale - 0.1);
    else if (fps > 57.5 && renderScale < 1) applyRenderScale(renderScale + 0.05);
    else if (fps < 45 && renderScale <= 0.61 && !G.lowFx) {
      G.lowFx = true;
      post.setBloom(false);
      world.setLowFx(true);
    }
  }
}

// Start the render loop and the menu scene
G.lastFrame = performance.now();
renderer.setAnimationLoop(() => loop());

// Warm the pointer-lock gesture path and audio on first interaction
window.addEventListener('pointerdown', () => {
  audio.init();
  audio.setVolume(settings.vol);
}, { once: true });

// Keep audio volume in sync
audio.setVolume(settings.vol);

// Update online count from roster changes
setInterval(updateRoomInfo, 1000);

// Debug / automated test hooks (only with ?debug)
if (DEBUG) {
  window.__sbw = {
    G, camera, world, scene, renderer,
    forceInput: false,
    get session() { return G.session; },
    startHost: () => ui.hostBtn.click(),
    startJoin: (code) => { ui.joinCode.value = code; ui.joinBtn.click(); },
    step: (dt = 1 / 60) => loop(dt),
    get renderScale() { return renderScale; },
    get fps() { return fpsFrames / Math.max(0.001, fpsAccum); }
  };
  window.__capture = (w = 720, q = 0.72) => {
    const c = document.createElement('canvas');
    const k = w / window.innerWidth;
    c.width = w;
    c.height = Math.round(window.innerHeight * k);
    c.getContext('2d').drawImage(renderer.domElement, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  };
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    G.keys.clear();
    G.charging = false;
    G.charge = 0;
    ui.chargeRing.classList.remove('active');
  }
});
