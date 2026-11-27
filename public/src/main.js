import * as THREE from '../vendor/three.module.js';
import {
  PLAYER, BALL, WORLD, RESPAWN_MS, WIND,
  terrainHeight, terrainNormal, terrainSlope, resolvePlayerCollision, clampToWorld
} from '../shared/world.js';
import { createWorld } from './scene.js';
import { createEffects } from './fx.js';
import { createAudio } from './audio.js';
import { createCharacter, makeNameTag, createViewModel, characterColor, createLockerItem, LOOK_PALETTES } from './character.js';
import { hostGame, joinGame } from './net.js';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const isTypingTarget = (el) => el instanceof Element &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
// rendering budget only: a phone keeps the lower pixel ratio even though the
// touch layout itself waits for a real finger
const touchCapable = (navigator.maxTouchPoints || 0) > 0 ||
  (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false);
// A handheld is a coarse-pointer touch device. It gets the landscape gate
// immediately, not only after the first finger touch.
const coarsePointer = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
const handheld = coarsePointer && (navigator.maxTouchPoints || 0) > 0;
// Every start is desktop, on every device. The touch layout appears only when
// a finger really touches the screen, so nobody boots into a joystick.
let isTouch = false;
document.body.classList.toggle('is-touch', isTouch);
document.body.classList.toggle('touch-device', handheld);
const hasMouse = () => document.pointerLockElement === canvas || (DEBUG && !!window.__sbw?.forceInput);

function syncOrientation() {
  document.body.classList.toggle('portrait', handheld && window.innerHeight > window.innerWidth);
}
syncOrientation();
window.addEventListener('resize', syncOrientation);
window.addEventListener('orientationchange', () => setTimeout(syncOrientation, 140));
document.addEventListener('fullscreenchange', syncOrientation);
window.visualViewport?.addEventListener('resize', syncOrientation);
if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', syncOrientation);

async function goImmersive() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {}
  try {
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch {}
  syncOrientation();
}

// Fullscreen on a handheld: browsers may only enter fullscreen straight after
// a gesture, so ask right away on load (an installed PWA and some Android
// builds allow that) and again on the very first tap or key, portrait or
// landscape. Leaving fullscreen with the FULLSCREEN button is respected.
let gestureTried = false;
let fullscreenOptOut = false;
async function tryHandheldFullscreen() {
  if (gestureTried || fullscreenOptOut || !handheld || document.fullscreenElement) return;
  gestureTried = true;
  await goImmersive();
}
window.addEventListener('click', tryHandheldFullscreen);
window.addEventListener('keydown', tryHandheldFullscreen);
// best effort only: no gesture yet, so most browsers refuse and the first tap
// above does the real work. It must not consume that attempt.
if (handheld) goImmersive();
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
  preview: $('preview'), lookSummary: $('lookSummary'), lookDots: $('lookDots'),
  customizeBtn: $('customizeBtn'), customize: $('customize'), customizeClose: $('customizeClose'),
  lockerMain: $('lockerMain'), lockerDetail: $('lockerDetail'), lockerGrid: $('lockerGrid'),
  lockerDetailTitle: $('lockerDetailTitle'), lockerDetailBody: $('lockerDetailBody'),
  lockerBack: $('lockerBack'), lockerSpinL: $('lockerSpinL'), lockerSpinR: $('lockerSpinR'),
  fpsToggle: $('fpsToggle'), optionsBtn: $('optionsBtn'),
  optionsPanel: $('optionsPanel'), optionsClose: $('optionsClose'),
  eventPlay: $('eventPlay'), joinToggle: $('joinToggle'), joinPanel: $('joinPanel'),
  infoPanel: $('infoPanel'), infoClose: $('infoClose'), fullscreenBtn: $('fullscreenBtn'),
  stick: $('stick'), stickKnob: $('stickKnob'),
  touchSprint: $('touchSprint'), touchDuck: $('touchDuck'), touchJump: $('touchJump'),
  touchThrow: $('touchThrow'), touchScore: $('touchScore'),
  rotateGo: $('rotateGo')
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const defaults = { name: '', sens: 1, vol: 0.8, quality: 'high', bots: 3, showFps: false, lookVersion: 2, look: { j: 0, s: 0, k: 0, h: 0, b: 0, g: 0, p: 0 } };
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
  document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#fff">WebGL is required to start this game.</div>';
  throw e;
}

const dprCap = () => Math.min(window.devicePixelRatio || 1, touchCapable ? 1.6 : 2);
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
  touchX: 0,
  touchY: 0,
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
  focus: 0,
  sprintToggle: false,
  crouchToggle: false,
  sliding: false,
  slideT: 0,
  slideDur: 0.92,
  slideSpeed: 0,
  slideDirX: 0,
  slideDirZ: 0,
  slideFx: 0,
  crouchBlend: 0,
  slideBlend: 0
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
  const shooter = shooterName || 'World';
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
  return G.roster.get(id)?.name || 'Player';
}

function setRoomCode(code) {
  ui.roomCode.textContent = code || '-----';
  ui.pauseCode.textContent = code || '-----';
}

function copyCode() {
  const code = ui.roomCode.textContent;
  if (!code || code === '-----') return;
  navigator.clipboard?.writeText(code).then(() => {
    showToast('Room code copied: ' + code);
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
  addFeed(s ? nameOf(s) : 'World', nameOf(v), mine);
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
  ui.muteBtn.textContent = audio.isMuted() ? 'SOUND OFF' : 'SOUND ON';
});
ui.roomChip.addEventListener('click', copyCode);
ui.copyCode.addEventListener('click', copyCode);
ui.menuBtn.addEventListener('click', () => {
  if (document.pointerLockElement) document.exitPointerLock();
  else openPause();
});
ui.leaveBtn.addEventListener('click', () => leaveGame());
ui.resumeBtn.addEventListener('click', resumeGame);

function setMenuStatus(text, cls = '') {
  ui.menuStatus.textContent = text;
  ui.menuStatus.className = 'c7-status ' + cls;
}

function setLoading(on, text = 'Connecting…') {
  ui.loading.classList.toggle('hidden', !on);
  ui.loadingText.textContent = text;
  ui.hostBtn.disabled = on;
  ui.joinBtn.disabled = on;
}


// ---------------------------------------------------------------------------
// Locker: category tiles on the left, the live rider on the right
// ---------------------------------------------------------------------------
const LOCKER_SLOTS = [
  { key: 'b', label: 'SHOES', item: 'WINTER SNEAKER', list: LOOK_PALETTES.boots, names: LOOK_PALETTES.names.boots, icon: 'shoe' },
  { key: 'h', label: 'HEADWEAR', item: 'BEANIE', list: LOOK_PALETTES.hat, names: LOOK_PALETTES.names.hat, icon: 'beanie' },
  { key: 'j', label: 'JACKET', item: 'SNOW SHELL', list: LOOK_PALETTES.jacket, names: LOOK_PALETTES.names.jacket, icon: 'jacket' },
  { key: 'g', label: 'GLOVES', item: 'SNOW MITTEN', list: LOOK_PALETTES.gloves, names: LOOK_PALETTES.names.gloves, icon: 'mitten' },
  { key: 'p', label: 'PANTS', item: 'RIPSTOP', list: LOOK_PALETTES.pants, names: LOOK_PALETTES.names.pants, icon: 'pants' }
];
let lockerSlotKey = null;
const slotOf = (key) => LOCKER_SLOTS.find((s) => s.key === key) || LOCKER_SLOTS[0];
const colorHex = (color) => '#' + new THREE.Color(color).getHexString();
const colorShade = (color, k) => colorHex(new THREE.Color(color).multiplyScalar(k));
const tintVars = (color) => `--i1:${colorHex(color)};--i2:${colorShade(color, 0.58)};--i3:${colorHex(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.44))}`;
const lookIndex = (slot) => Math.max(0, settings.look[slot.key] || 0) % slot.list.length;

// Real 3D item renders for the locker tiles. One small off-screen renderer
// serves all cards; every tile is a snapshot of the same materials the rider
// wears, cached per item and colour.
const lockerThumbs = (() => {
  const LOOK_KEY = { shoe: 'b', beanie: 'h', jacket: 'j', mitten: 'g', pants: 'p' };
  const YAW = {
    shoe: Math.PI + 1.05,
    beanie: Math.PI + 0.35,
    jacket: Math.PI + 0.30,
    mitten: Math.PI + 0.55,
    pants: Math.PI + 0.35
  };
  const CAM = {
    shoe: { p: [2.95, 1.30, 3.30], t: [0, 0.60, 0] },
    default: { p: [2.55, 1.85, 3.35], t: [0, 0.72, 0] }
  };
  const cache = new Map();
  let renderer = null, scene = null, camera = null;

  function dispose(obj) {
    obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  function ensure() {
    if (renderer) return true;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power'
      });
    } catch { renderer = null; return false; }
    renderer.setPixelRatio(1);
    renderer.setSize(480, 360, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.05, 30);
    scene.add(new THREE.HemisphereLight(0xd8ecff, 0x1a2c34, 1.5));
    const key = new THREE.DirectionalLight(0xfff3e2, 2.6);
    key.position.set(-2.2, 3.6, 2.8);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.left = -2.5;
    key.shadow.camera.right = 2.5;
    key.shadow.camera.top = 3.0;
    key.shadow.camera.bottom = -1.5;
    key.shadow.camera.near = 0.2;
    key.shadow.camera.far = 12;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa8d8ff, 2.0);
    rim.position.set(2.8, 2.2, -2.0);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffe0c8, 0.8);
    fill.position.set(2.2, 0.8, 2.4);
    scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.ShadowMaterial({ color: 0x04121a, opacity: 0.32 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    return true;
  }

  function thumb(kind, colorIdx) {
    const key = `${kind}:${colorIdx}`;
    if (cache.has(key)) return cache.get(key);
    if (!ensure()) return '';
    const look = { ...settings.look, [LOOK_KEY[kind]]: colorIdx };
    const item = createLockerItem(kind, look);
    const box = new THREE.Box3().setFromObject(item);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    item.position.sub(center);
    const max = Math.max(size.x, size.y, size.z) || 1;
    const inner = new THREE.Group();
    inner.scale.setScalar(1.35 / max);
    inner.add(item);
    const pivot = new THREE.Group();
    pivot.add(inner);
    pivot.rotation.y = YAW[kind] || Math.PI;
    scene.add(pivot);
    pivot.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(pivot);
    pivot.position.y -= worldBox.min.y;
    pivot.updateMatrixWorld(true);
    const cam = CAM[kind] || CAM.default;
    camera.position.set(cam.p[0], cam.p[1], cam.p[2]);
    camera.lookAt(cam.t[0], cam.t[1], cam.t[2]);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(pivot);
    dispose(item);
    cache.set(key, url);
    return url;
  }

  return { thumb };
})();

function lookSummary() {
  const j = LOOK_PALETTES.names.jacket[settings.look.j % LOOK_PALETTES.jacket.length] || 'Blue';
  const h = LOOK_PALETTES.names.hat[settings.look.h % LOOK_PALETTES.hat.length] || 'Grey';
  const k = LOOK_PALETTES.names.skin[settings.look.k % LOOK_PALETTES.skin.length] || 'Light';
  return `${j} · ${h} · ${k}`;
}

function paintLook() {
  if (ui.lookSummary) ui.lookSummary.textContent = lookSummary();
  if (ui.lookDots) {
    ui.lookDots.innerHTML = '';
    for (const slot of LOCKER_SLOTS) {
      const chip = document.createElement('i');
      chip.style.background = colorHex(slot.list[lookIndex(slot)]);
      ui.lookDots.appendChild(chip);
    }
  }
}

function lockerCard(slot) {
  const idx = lookIndex(slot);
  const color = slot.list[idx];
  const name = slot.key === 'h' ? `${slot.names[idx]} BEANIE` : slot.item;
  return `<button type="button" class="locker-card" data-slot="${slot.key}" aria-label="${slot.label}: ${name}, ${slot.names[idx]}">
    <span class="locker-card-art"><img src="${lockerThumbs.thumb(slot.icon, idx)}" alt="" draggable="false" /></span>
    <span class="locker-card-swat" style="background:${colorHex(color)}"></span>
    <span class="locker-card-copy"><span class="locker-card-tag">${slot.label}</span><span class="locker-card-name">${name}</span></span>
  </button>`;
}

function renderLockerGrid() {
  if (!ui.lockerGrid) return;
  ui.lockerGrid.innerHTML = LOCKER_SLOTS.map(lockerCard).join('');
}

function lockerSwatches(slot, attr = 'data-color') {
  const idx = lookIndex(slot);
  return slot.list.map((color, i) => `<button type="button" class="locker-sw${i === idx ? ' is-on' : ''}" ${attr}="${i}" style="--sw:${colorHex(color)}" aria-label="${slot.names[i] || String(i + 1)}" aria-pressed="${i === idx}"></button>`).join('');
}

function shopTile() {
  return `<div class="locker-item is-shop" aria-hidden="true">
    <span class="locker-shop-icon"><svg viewBox="0 0 24 24"><path d="M5.5 8.5h13l1 11.5h-15l1-11.5Z"/><path d="M9 8.5V6.4a3 3 0 0 1 6 0v2.1"/></svg></span>
    <span class="locker-shop-label">MORE IN THE<br />ITEM SHOP</span>
  </div>`;
}

function renderLockerDetail(slot) {
  if (!slot || !ui.lockerDetailBody) return;
  ui.lockerDetailTitle.textContent = slot.label;
  if (slot.key === 'h') {
    const skinSlot = { key: 'k', list: LOOK_PALETTES.skin, names: LOOK_PALETTES.names.skin };
    const skinIdx = lookIndex(skinSlot);
    const hatIdx = lookIndex(slot);
    ui.lockerDetailBody.innerHTML = `
      <div class="locker-block">
        <div class="locker-block-head"><span>SKIN TONE</span><b>${skinSlot.names[skinIdx]}</b></div>
        <div class="locker-swatches">${lockerSwatches(skinSlot, 'data-skin')}</div>
      </div>
      <div class="locker-block">
        <div class="locker-block-head"><span>HEADWEAR</span><b>${slot.names[hatIdx]} BEANIE</b></div>
        <div class="locker-item-grid">
          ${slot.list.map((color, i) => `<button type="button" class="locker-item${i === hatIdx ? ' is-on' : ''}" data-hat="${i}" style="${tintVars(color)}" aria-pressed="${i === hatIdx}" aria-label="${slot.names[i]} Beanie">
            <span class="locker-item-art"><img src="${lockerThumbs.thumb('beanie', i)}" alt="" draggable="false" /></span>
            ${i === hatIdx ? '<span class="locker-item-check" aria-hidden="true">&#10003;</span>' : ''}
            <span class="locker-item-copy"><small>STANDARD</small><b>${slot.names[i]} BEANIE</b><em>FREE</em></span>
          </button>`).join('')}
          ${shopTile()}
        </div>
      </div>`;
    return;
  }
  const idx = lookIndex(slot);
  const color = slot.list[idx];
  ui.lockerDetailBody.innerHTML = `
    <div class="locker-block">
      <div class="locker-block-head"><span>ITEM</span><b>${slot.item}</b></div>
      <div class="locker-item-grid">
        <div class="locker-item is-on">
          <span class="locker-item-art"><img src="${lockerThumbs.thumb(slot.icon, idx)}" alt="" draggable="false" /></span>
          <span class="locker-item-check" aria-hidden="true">&#10003;</span>
          <span class="locker-item-copy"><small>STANDARD</small><b>${slot.item}</b><em>FREE</em></span>
        </div>
        ${shopTile()}
      </div>
    </div>
    <div class="locker-block">
      <div class="locker-block-head"><span>COLOR</span><b>${slot.names[idx]}</b></div>
      <div class="locker-swatches">${lockerSwatches(slot)}</div>
    </div>`;
}

function openLockerSlot(key) {
  lockerSlotKey = key;
  if (!ui.lockerMain || !ui.lockerDetail) return;
  ui.lockerMain.classList.add('hidden');
  ui.lockerDetail.classList.remove('hidden');
  renderLockerDetail(slotOf(key));
  const body = ui.lockerDetail.parentElement;
  if (body) body.scrollTop = 0;
}

function showLockerMain() {
  lockerSlotKey = null;
  if (!ui.lockerMain || !ui.lockerDetail) return;
  ui.lockerDetail.classList.add('hidden');
  ui.lockerMain.classList.remove('hidden');
  renderLockerGrid();
  paintLook();
  const body = ui.lockerDetail.parentElement;
  if (body) body.scrollTop = 0;
}

function applyLockerColor(key, index) {
  if (!Number.isInteger(index)) return;
  const lengths = { j: LOOK_PALETTES.jacket.length, h: LOOK_PALETTES.hat.length, k: LOOK_PALETTES.skin.length, b: LOOK_PALETTES.boots.length, g: LOOK_PALETTES.gloves.length, p: LOOK_PALETTES.pants.length };
  if (!(key in lengths)) return;
  if (settings.look[key] === index) return;
  settings.look[key] = index % lengths[key];
  saveSettings();
  paintLook();
  preview.refresh();
  if (lockerSlotKey) renderLockerDetail(slotOf(lockerSlotKey));
}

function setCustomizer(open) {
  if (!ui.customize) return;
  ui.customize.classList.toggle('hidden', !open);
  document.body.classList.toggle('locker-open', open);
  ui.customizeBtn?.setAttribute('aria-expanded', String(open));
  if (!open) { lockerSlotKey = null; return; }
  setMenuTab('look');
  showLockerMain();
}

const preview = (() => {
  const canvas = ui.preview;
  if (!canvas) return { refresh() {}, show() {}, hide() {} };
  let renderer = null, scene = null, camera = null, ch = null;
  let raf = 0, last = 0, running = false, clock = 0;
  // The showcase never spins by itself: the visitor drags to turn it and the
  // angle stays where the mitten let go. A little inertia, no spring-back.
  let yaw = Math.PI, yawVel = 0, dragging = false, dragX = 0;

  function ensure() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    // real shadows: they carve the sleeve out of the jacket and put the boots
    // on the snow instead of letting the character float
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(31, 1, 0.05, 20);
    camera.position.set(0, 1.0, 4.02);
    camera.lookAt(0, 0.92, 0);

    scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x22303b, 1.45));
    const key = new THREE.DirectionalLight(0xfff1dd, 2.9);
    key.position.set(-2.0, 3.0, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1.9;
    key.shadow.camera.right = 1.9;
    key.shadow.camera.top = 2.4;
    key.shadow.camera.bottom = -1.4;
    key.shadow.camera.near = 0.2;
    key.shadow.camera.far = 10;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd2ff, 2.1);
    rim.position.set(2.4, 1.9, -2.4);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffd9c2, 0.7);
    fill.position.set(2.2, 0.6, 1.8);
    scene.add(fill);
    // candle-warm backlight: a thin gold edge on the beanie and shoulders,
    // the way the moon in the lobby art sits behind the rider
    const warmth = new THREE.DirectionalLight(0xffcf9a, 0.9);
    warmth.position.set(-1.5, 1.7, -2.3);
    scene.add(warmth);
    // soft frontal fill keeps the sleeve tubes from reading as dark slabs
    const front = new THREE.DirectionalLight(0xeaf4ff, 0.55);
    front.position.set(0.5, 1.3, 3.4);
    scene.add(front);

    // the key light casts a real silhouette onto this invisible catcher; the
    // sprite below only adds the soft ambient occlusion at the feet
    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4),
      new THREE.ShadowMaterial({ color: 0x07131c, opacity: 0.38 })
    );
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.002;
    catcher.receiveShadow = true;
    scene.add(catcher);

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
      map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55
    }));
    shadow.scale.set(1.32, 0.42, 1);
    shadow.position.set(0, 0.012, 0);
    scene.add(shadow);
  }

  function build() {
    if (!scene) return;
    if (ch) scene.remove(ch.root);
    ch = createCharacter(characterColor(settings.name || 'du'), settings.look);
    ch.root.position.set(0, 0, 0);
    ch.setHeldBall?.(true);
    scene.add(ch.root);
    pose(0);
  }

  function pose(dt) {
    if (!ch) return;
    // the character owns its root yaw, so the turn goes through update() --
    // that keeps the idle lean and turn smoothing in one place
    ch.update(dt, { speed: 0, grounded: true, yaw });
    // Relaxed stance: both sleeves hang beside the jacket and the right mitten
    // carries the snowball at hip height. Keep the character's own breathing,
    // weight shift and glance, and only offset the arms enough for the pose --
    // the old override froze them into a mannequin.
    const sway = Math.sin(clock * 1.3) * 0.012;
    ch.armR.shoulder.rotation.x += 0.02 + sway * 0.6;
    ch.armR.shoulder.rotation.z += 0.02;
    ch.armR.elbow.rotation.x = 0.15 + Math.sin(clock * 1.55 + 0.5) * 0.02;
    ch.armL.shoulder.rotation.x -= 0.02 + sway * 0.6;
    ch.armL.shoulder.rotation.z -= 0.005;
    ch.armL.elbow.rotation.x = 0.11 + Math.sin(clock * 1.55 + 1.4) * 0.018;
    ch.headGroup.rotation.y += Math.sin(clock * 0.37) * 0.05;
    ch.headGroup.rotation.x += Math.sin(clock * 0.9) * 0.01;
  }

  // drag the character to turn it; nothing rotates him on its own
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    dragX = e.clientX;
    yawVel = 0;
    canvas.classList.add('is-grabbing');
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragX;
    dragX = e.clientX;
    yaw += dx * 0.0095;
    yawVel = dx * 0.30;
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('is-grabbing');
    try { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch {}
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

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
    if (!dragging && yawVel !== 0) {
      yaw += yawVel * dt;
      yawVel *= Math.exp(-8 * dt);
      if (Math.abs(yawVel) < 0.15) yawVel = 0;
    }
    resize();
    pose(dt);
    renderer.render(scene, camera);
  }

  return {
    refresh() { ensure(); build(); },
    spin(step) {
      ensure();
      yaw += step * 0.52;
      yawVel = 0;
    },
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

ui.customizeBtn?.addEventListener('click', () => setCustomizer(true));
ui.customizeClose?.addEventListener('click', () => setCustomizer(false));
ui.lockerBack?.addEventListener('click', () => showLockerMain());
ui.lockerGrid?.addEventListener('click', (e) => {
  const card = e.target instanceof Element ? e.target.closest('[data-slot]') : null;
  if (card instanceof HTMLElement && card.dataset.slot) openLockerSlot(card.dataset.slot);
});
ui.lockerDetailBody?.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  const color = target.closest('[data-color]');
  if (color instanceof HTMLElement && lockerSlotKey) {
    applyLockerColor(lockerSlotKey, Number(color.dataset.color));
    return;
  }
  const hat = target.closest('[data-hat]');
  if (hat instanceof HTMLElement) { applyLockerColor('h', Number(hat.dataset.hat)); return; }
  const skin = target.closest('[data-skin]');
  if (skin instanceof HTMLElement) applyLockerColor('k', Number(skin.dataset.skin));
});
ui.lockerSpinL?.addEventListener('click', () => preview.spin(-1));
ui.lockerSpinR?.addEventListener('click', () => preview.spin(1));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (ui.infoPanel && !ui.infoPanel.classList.contains('hidden')) {
    e.stopPropagation();
    ui.infoPanel.classList.add('hidden');
    return;
  }
  if (ui.optionsPanel && !ui.optionsPanel.classList.contains('hidden')) {
    e.stopPropagation();
    ui.optionsPanel.classList.add('hidden');
    return;
  }
  if (!ui.customize || ui.customize.classList.contains('hidden')) return;
  e.stopPropagation();
  if (lockerSlotKey) {
    showLockerMain();
    ui.lockerGrid?.querySelector('[data-slot]')?.focus({ preventScroll: true });
    return;
  }
  setCustomizer(false);
  ui.customizeBtn?.focus({ preventScroll: true });
});

function setMenuTab(name) {
  document.querySelectorAll('.c7-tab').forEach((tab) => {
    tab.classList.toggle('is-on', tab.dataset.menuTab === name);
  });
}
function closeInfo() { ui.infoPanel?.classList.add('hidden'); }

document.querySelectorAll('[data-menu-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.menuTab;
    if (btn.classList.contains('c7-tab')) setMenuTab(tab);
    // the locker is a full screen layer; any other lobby tab leaves it first
    if (tab !== 'look') setCustomizer(false);
    if (tab === 'look') {
      closeInfo();
      ui.optionsPanel?.classList.add('hidden');
      setCustomizer(true);
    } else if (tab === 'modes') {
      closeInfo();
      ui.optionsPanel?.classList.remove('hidden');
      ui.botsSel?.focus();
    } else if (tab === 'options') {
      closeInfo();
      ui.optionsPanel?.classList.toggle('hidden');
    } else if (tab === 'info') {
      ui.optionsPanel?.classList.add('hidden');
      ui.infoPanel?.classList.remove('hidden');
    } else {
      closeInfo();
      ui.optionsPanel?.classList.add('hidden');
      setCustomizer(false);
    }
  });
});

ui.optionsBtn?.addEventListener('click', () => {
  setCustomizer(false);
  ui.optionsPanel.classList.toggle('hidden');
});
ui.optionsClose?.addEventListener('click', () => ui.optionsPanel.classList.add('hidden'));
ui.infoClose?.addEventListener('click', closeInfo);
ui.infoPanel?.addEventListener('click', (e) => { if (e.target === ui.infoPanel) closeInfo(); });
ui.joinToggle?.addEventListener('click', () => {
  ui.joinPanel.classList.toggle('hidden');
  if (!ui.joinPanel.classList.contains('hidden')) ui.joinCode.focus();
});
ui.eventPlay?.addEventListener('click', () => ui.hostBtn.click());
ui.fullscreenBtn?.addEventListener('click', async () => {
  if (document.fullscreenElement) {
    fullscreenOptOut = true;
    document.exitFullscreen?.();
  } else {
    fullscreenOptOut = false;
    gestureTried = true;
    await goImmersive();
  }
});
ui.rotateGo?.addEventListener('click', async () => { await goImmersive(); syncOrientation(); });
ui.nameInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); ui.hostBtn.click(); }
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !ui.menu || ui.menu.classList.contains('hidden')) return;
  if (!ui.customize.classList.contains('hidden') || !ui.infoPanel.classList.contains('hidden') || !ui.optionsPanel.classList.contains('hidden')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
  ui.hostBtn.click();
});

ui.fpsToggle?.addEventListener('change', () => {
  settings.showFps = ui.fpsToggle.checked;
  saveSettings();
  ui.perfChip.classList.toggle('hidden', !settings.showFps);
});

renderLockerGrid();
paintLook();
preview.refresh();

// The menu is toggled by class in several places, so follow the class instead
// of sprinkling show/hide calls through the session code.
if (ui.menu) {
  new MutationObserver(() => {
    if (ui.menu.classList.contains('hidden')) { setCustomizer(false); preview.hide(); }
    else preview.show();
  }).observe(ui.menu, { attributes: true, attributeFilter: ['class'] });
}
preview.show();

ui.hostBtn.addEventListener('click', async () => {
  audio.init();
  audio.setVolume(settings.vol);
  if (isTouch) goImmersive();
  const name = (ui.nameInput.value.trim() || 'Guest').slice(0, 14);
  settings.name = name;
  saveSettings();
  setMenuStatus('Creating room…');
  setLoading(true, 'Creating room…');
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
    setMenuStatus('Ready.', 'ok');
    G.mode = 'paused';
    openPause(true);
    showToast('Room created — share code ' + code);
  } catch (err) {
    console.error(err);
    setLoading(false);
    setMenuStatus(err.message || 'Could not create the room.', 'err');
  }
});

ui.joinBtn.addEventListener('click', async () => {
  audio.init();
  audio.setVolume(settings.vol);
  if (isTouch) goImmersive();
  const code = (ui.joinCode.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) {
    setMenuStatus('Please enter a valid room code.', 'err');
    return;
  }
  const name = (ui.nameInput.value.trim() || 'Guest').slice(0, 14);
  settings.name = name;
  saveSettings();
  setMenuStatus('Joining room ' + code + '…');
  setLoading(true, 'Joining room ' + code + '…');
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
        leaveGame(msg);
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
    setMenuStatus('Connected.', 'ok');
  } catch (err) {
    console.error(err);
    setLoading(false);
    setMenuStatus(err.message || 'Connection failed.', 'err');
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
    else if (dead && !G.dead) dieSelf(G.killer || 'Unknown');
  }

  if (snap.end > 0 && !G.matchEnd) {
    G.matchEnd = true;
  }
  updateScoreboardVisibility();
}

function updateRemote(id, p) {
  let r = G.remotes.get(id);
  if (!r) {
    const info = G.roster.get(id) || { name: 'Player', bot: false };
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
      G.killer = msg.sn || 'Unknown';
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
    ui.matchText.textContent = msg.winner.name + ' WINS';
    ui.matchSub.textContent = `${msg.score} eliminations · next round in a few seconds`;
    ui.matchBanner.classList.remove('hidden');
    audio.matchEnd();
    return;
  }

  if (msg.t === 'reset') {
    G.matchEnd = false;
    G.scores.clear();
    ui.matchBanner.classList.add('hidden');
    showToast('New round — good luck');
    return;
  }

  if (msg.t === 'join') {
    G.roster.set(msg.id, { name: msg.name, bot: msg.bot });
    if (!msg.bot && msg.id !== G.selfId) showToast(msg.name + ' joined');
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
    if (!msg.bot) showToast(msg.name + ' left');
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
  G.sprintToggle = false;
  G.crouchToggle = false;
  G.sliding = false;
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
  G.sprintToggle = false;
  G.crouchToggle = false;
  G.sliding = false;
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
  ui.respawnText.textContent = remain > 0 ? `RESPAWNING IN ${remain.toFixed(1)} s` : 'RESPAWNING…';
  G.desat = Math.min(1, G.desat + dt * 2.2);
}

// ---------------------------------------------------------------------------
// Pause / pointer lock
// ---------------------------------------------------------------------------
function openPause(first = false) {
  ui.pause.classList.remove('hidden');
  ui.resumeBtn.textContent = first ? 'START MATCH' : 'RESUME';
  ui.pause.querySelector('h2').textContent = first ? 'READY' : 'PAUSE';
  ui.pause.querySelector('p').textContent = first
    ? 'Click to capture the mouse. Esc opens the pause menu later.'
    : 'The match keeps running. You are vulnerable.';
  ui.scoreboard.classList.add('hidden');
}

function closePause() {
  ui.pause.classList.add('hidden');
}

function resumeGame() {
  audio.init();
  audio.setVolume(settings.vol);
  closePause();
  if (isTouch) {
    G.mode = 'playing';
    goImmersive();
    return;
  }
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
  if (isTouch) return;
  if (G.session && G.mode === 'playing' && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});

// Back to the lobby without a page reload. A reload here meant a black flash
// and a fresh PeerJS handshake every time someone quit; clearing the match in
// place is immediate and the menu preview is already running.
function leaveGame(message = '') {
  // Set the mode first: leaving pointer lock fires pointerlockchange, and that
  // handler would otherwise reopen the pause card behind the menu.
  G.mode = 'menu';
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}

  const session = G.session;
  G.session = null;
  try { session?.close(); } catch {}

  G.selfId = null;
  G.spawned = false;
  G.dead = false;
  G.deathT = 0;
  G.killer = '';
  G.matchEnd = false;
  G.charging = false;
  G.charge = 0;
  G.cooldown = 0;
  G.flash = 0;
  G.desat = 0;
  G.focus = 0;
  G.shake = 0;
  G.vy = 0;
  G.grounded = true;
  G.stamina = 1;
  G.staminaLock = 0;
  G.jumpBuf = 0;
  G.coyote = 0;
  G.sprintToggle = false;
  G.crouchToggle = false;
  G.sliding = false;
  G.touchX = 0;
  G.touchY = 0;
  G.keys.clear();
  G.scores.clear();
  G.roster.clear();

  // Other players and snowballs belong to the match that just ended.
  for (const [, r] of G.remotes) { scene.remove(r.root); disposeObject(r.root); }
  G.remotes.clear();
  for (const [, pr] of G.projectiles) scene.remove(pr.mesh);
  G.projectiles.clear();

  // Drop every in-match layer before the lobby reappears.
  viewmodel.setVisible(false);
  ui.hud.classList.add('hidden');
  ui.pause.classList.add('hidden');
  ui.death.classList.add('hidden');
  ui.matchBanner.classList.add('hidden');
  ui.scoreboard.classList.add('hidden');
  ui.loading.classList.add('hidden');
  ui.chargeRing.classList.remove('active');
  ui.chargeLabel.classList.remove('show');
  ui.chargeWrap.classList.remove('full');
  ui.stick?.classList.remove('active');
  if (ui.stickKnob) ui.stickKnob.style.transform = '';
  ui.killfeed.innerHTML = '';
  ui.toast.innerHTML = '';
  ui.scoreRows.innerHTML = '';
  ui.respawnBar.style.width = '0%';
  ui.onlineCount.textContent = '1';
  ui.pingVal.textContent = '0';
  setRoomCode(null);
  setMenuStatus(message || 'Ready.', message ? 'err' : '');

  // A clean play tab, then the main screen.
  setMenuTab('play');
  closeInfo();
  setCustomizer(false);
  ui.optionsPanel?.classList.add('hidden');
  ui.joinPanel?.classList.add('hidden');
  ui.menu.classList.remove('hidden');
  ui.menu.scrollTop = 0;
  preview.show();

  setLoading(false);
}

window.addEventListener('beforeunload', () => {
  try { G.session?.close(); } catch {}
});

// ---------------------------------------------------------------------------
// Stance: sprint and crouch are taps, not holds. One tap flips the state, so
// both hands stay free for aiming. Tapping crouch while sprinting turns the
// run into a slide and leaves you crouched when the skid ends.
// ---------------------------------------------------------------------------
function stanceReady() {
  return !!G.session && G.mode === 'playing' && !G.dead && G.spawned;
}

function syncTouchStance() {
  ui.touchSprint?.classList.toggle('is-on', G.sprintToggle);
  ui.touchDuck?.classList.toggle('is-on', G.crouchToggle);
}

function toggleSprint() {
  if (!stanceReady()) return;
  G.sprintToggle = !G.sprintToggle;
  if (G.sprintToggle) {
    G.crouchToggle = false;
    G.sliding = false;
    G.slideT = 0;
  }
  syncTouchStance();
}

function toggleCrouch() {
  if (!stanceReady()) return;
  if (G.sliding) {
    G.sliding = false;
    G.crouchToggle = true;
    syncTouchStance();
    return;
  }
  const speed = Math.hypot(moveDir.x, moveDir.z);
  if (G.sprintToggle && G.grounded && speed > PLAYER.walk * 0.8) {
    startSlide(speed);
    syncTouchStance();
    return;
  }
  G.crouchToggle = !G.crouchToggle;
  if (G.crouchToggle) G.sprintToggle = false;
  syncTouchStance();
}

function startSlide(speed) {
  if (speed > 0.6) {
    G.slideDirX = moveDir.x / speed;
    G.slideDirZ = moveDir.z / speed;
  } else {
    G.slideDirX = -Math.sin(G.yaw);
    G.slideDirZ = -Math.cos(G.yaw);
  }
  G.sliding = true;
  G.slideT = 0;
  G.slideSpeed = Math.max(PLAYER.sprint, speed) * 1.12;
  G.slideFx = 0;
  G.crouchToggle = true;
  G.sprintToggle = false;
  G.shake = Math.max(G.shake, 0.02);
  effects.spray(G.pos.x, G.pos.z, -G.slideDirX, -G.slideDirZ, 1.1);
  audio.footstep(true);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const key = e.code;
  // any real keyboard key means desktop play; typing in a field is not a
  // hardware-keyboard signal (a phone's soft keyboard fires keydown too)
  const pressed = key || e.key;
  if (isTouch && pressed && pressed !== 'Unidentified' && !isTypingTarget(e.target)) setTouchMode(false);
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
    ui.muteBtn.textContent = audio.isMuted() ? 'SOUND OFF' : 'SOUND ON';
    return;
  }
  if (key === 'KeyF') {
    settings.showFps = !settings.showFps;
    saveSettings();
    ui.perfChip.classList.toggle('hidden', !settings.showFps);
    showToast(settings.showFps ? 'FPS display on' : 'FPS display off');
    return;
  }
  if (key === 'ShiftLeft' || key === 'ShiftRight') {
    toggleSprint();
    return;
  }
  if (key === 'ControlLeft' || key === 'ControlRight') {
    toggleCrouch();
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
  G.sprintToggle = false;
  G.sliding = false;
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

function beginCharge() {
  if (G.mode !== 'playing' || !G.session || G.dead) return;
  if (G.cooldown > 0 || G.charging) return;
  G.charging = true;
  G.charge = 0;
  ui.chargeRing.classList.add('active');
  ui.chargeLabel.classList.add('show');
}

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  audio.init();
  if (!hasMouse()) return;
  beginCharge();
});

document.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  if (!G.charging) return;
  G.charging = false;
  throwSnowball();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Touch input: left stick, drag-to-look, hold-to-throw and stance buttons.
// ---------------------------------------------------------------------------
let stickId = null;
function updateStick(e) {
  if (!ui.stick) return;
  const r = ui.stick.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = (e.clientX - cx) / (r.width / 2);
  let dy = (e.clientY - cy) / (r.height / 2);
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  if (Math.hypot(dx, dy) < 0.16) { dx = 0; dy = 0; }
  G.touchX = dx;
  G.touchY = dy;
  const knob = ui.stickKnob;
  const travel = Math.max(0, (r.width - (knob?.offsetWidth || 0)) / 2 - 4);
  if (knob) knob.style.transform = `translate(${dx * travel}px, ${dy * travel}px)`;
}
function endStick(e) {
  if (e.pointerId !== stickId) return;
  stickId = null;
  G.touchX = 0;
  G.touchY = 0;
  ui.stick?.classList.remove('active');
  if (ui.stickKnob) ui.stickKnob.style.transform = '';
}
ui.stick?.addEventListener('pointerdown', (e) => {
  if (!isTouch) return;
  e.preventDefault();
  stickId = e.pointerId;
  ui.stick.classList.add('active');
  try { ui.stick.setPointerCapture(e.pointerId); } catch {}
  updateStick(e);
});
ui.stick?.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) updateStick(e); });
ui.stick?.addEventListener('pointerup', endStick);
ui.stick?.addEventListener('pointercancel', endStick);

let lookId = null, lookX = 0, lookY = 0;
let throwAimId = null, throwAimX = 0, throwAimY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (!isTouch || e.pointerType === 'mouse') return;
  if (!G.session || G.mode !== 'playing' || G.dead) return;
  lookId = e.pointerId;
  lookX = e.clientX;
  lookY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});
function applyLook(dx, dy) {
  const s = 0.0034 * settings.sens;
  G.yaw -= dx * s;
  G.pitch = Math.max(-1.5, Math.min(1.5, G.pitch - dy * s));
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lookId) return;
  const dx = e.clientX - lookX, dy = e.clientY - lookY;
  lookX = e.clientX;
  lookY = e.clientY;
  applyLook(dx, dy);
});
function endLook(e) { if (e.pointerId === lookId) lookId = null; }
canvas.addEventListener('pointerup', endLook);
canvas.addEventListener('pointercancel', endLook);

// Switching input while the match runs: park the virtual stick and the touch
// look, and hand the controls back to mouse and keyboard (or the other way).
function setTouchMode(on) {
  if (isTouch === on) return;
  isTouch = on;
  document.body.classList.toggle('is-touch', on);
  G.touchX = 0;
  G.touchY = 0;
  stickId = null;
  lookId = null;
  throwAimId = null;
  ui.stick?.classList.remove('active');
  if (ui.stickKnob) ui.stickKnob.style.transform = '';
  if (on && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch {}
  }
  syncOrientation();
}

// A real finger brings the touch layout; a mouse movement or click leaves it
// immediately, without waiting for a key press.
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && !isTouch) setTouchMode(true);
  else if (e.pointerType === 'mouse' && isTouch) setTouchMode(false);
}, true);
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && isTouch) setTouchMode(false);
}, { passive: true });

ui.touchThrow?.addEventListener('pointerdown', (e) => {
  if (!isTouch) return;
  e.preventDefault();
  audio.init();
  try { ui.touchThrow.setPointerCapture(e.pointerId); } catch {}
  throwAimId = e.pointerId;
  throwAimX = e.clientX;
  throwAimY = e.clientY;
  beginCharge();
});
// The throw finger also aims: keep holding, drag to turn, release to throw.
ui.touchThrow?.addEventListener('pointermove', (e) => {
  if (e.pointerId !== throwAimId) return;
  const dx = e.clientX - throwAimX;
  const dy = e.clientY - throwAimY;
  throwAimX = e.clientX;
  throwAimY = e.clientY;
  applyLook(dx, dy);
});
ui.touchThrow?.addEventListener('pointerup', (e) => {
  if (!isTouch) return;
  e.preventDefault();
  if (e.pointerId === throwAimId) throwAimId = null;
  if (G.charging) { G.charging = false; throwSnowball(); }
});
ui.touchThrow?.addEventListener('pointercancel', () => {
  throwAimId = null;
  if (G.charging) {
    G.charging = false;
    G.charge = 0;
    ui.chargeRing.classList.remove('active');
    ui.chargeLabel.classList.remove('show');
  }
});
ui.touchJump?.addEventListener('click', () => { if (stanceReady()) G.jumpBuf = 0.16; });
ui.touchDuck?.addEventListener('click', () => { toggleCrouch(); syncTouchStance(); });
ui.touchSprint?.addEventListener('click', () => { toggleSprint(); syncTouchStance(); });
ui.touchScore?.addEventListener('click', () => {
  if (!G.session) return;
  const nowHidden = ui.scoreboard.classList.toggle('hidden');
  if (!nowHidden) renderScoreboard(true);
});
ui.scoreboard?.addEventListener('pointerdown', () => { if (isTouch) ui.scoreboard.classList.add('hidden'); });

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
  if (alive && G.mode === 'playing' && (hasMouse() || isTouch)) {
    let fwd = 0, side = 0;
    if (isTouch && Math.hypot(G.touchX, G.touchY) > 0.12) {
      fwd = -G.touchY;
      side = G.touchX;
    } else {
      fwd = (G.keys.has('KeyW') ? 1 : 0) - (G.keys.has('KeyS') ? 1 : 0);
      side = (G.keys.has('KeyD') ? 1 : 0) - (G.keys.has('KeyA') ? 1 : 0);
    }
    if (fwd || side) {
      const sin = Math.sin(G.yaw), cos = Math.cos(G.yaw);
      wishX = -sin * fwd + cos * side;
      wishZ = -cos * fwd - sin * side;
      const len = Math.hypot(wishX, wishZ) || 1;
      wishX /= len; wishZ /= len;
    }
  }

  // --- stance: sprint and crouch are toggles ------------------------------
  const wantsToMove = Math.hypot(wishX, wishZ) > 0.01;
  const sprinting = G.sprintToggle && wantsToMove && alive && G.mode === 'playing' &&
    !G.crouchToggle && !G.sliding && G.stamina > 0.02 && G.staminaLock <= 0;

  if (sprinting) {
    G.stamina = Math.max(0, G.stamina - dt * 0.29);
    if (G.stamina <= 0) { G.staminaLock = 1.1; G.sprintToggle = false; }
  } else {
    G.stamina = Math.min(1, G.stamina + dt * (wantsToMove ? 0.16 : 0.32));
  }
  G.staminaLock = Math.max(0, G.staminaLock - dt);

  // --- slide --------------------------------------------------------------
  // Tapping crouch while sprinting converts the run into a skid: the momentum
  // stays, the body drops, and A/D carve the line instead of steering it.
  let slideLean = 0;
  if (G.sliding) {
    G.slideT += dt;
    const k = Math.min(1, G.slideT / G.slideDur);
    if (!alive || G.mode !== 'playing' || !G.grounded || G.slideT >= G.slideDur) {
      G.sliding = false;
    } else {
      const speed = G.slideSpeed * (1 - 0.62 * k * k);
      const steer = ((G.keys.has('KeyD') ? 1 : 0) - (G.keys.has('KeyA') ? 1 : 0)) ||
        (isTouch && Math.abs(G.touchX) > 0.2 ? Math.sign(G.touchX) : 0);
      if (steer) {
        const a = steer * dt * 1.45;
        const c = Math.cos(a), s = Math.sin(a);
        const dx = G.slideDirX * c - G.slideDirZ * s;
        const dz = G.slideDirX * s + G.slideDirZ * c;
        G.slideDirX = dx; G.slideDirZ = dz;
        slideLean = steer;
      }
      moveDir.x = G.slideDirX * speed;
      moveDir.z = G.slideDirZ * speed;
      G.slideFx -= dt;
      if (G.slideFx <= 0) {
        G.slideFx = 0.055;
        effects.spray(G.pos.x, G.pos.z, -G.slideDirX, -G.slideDirZ, 0.85);
        audio.footstep(true);
      }
    }
  }

  const maxSpeed = G.crouchToggle ? PLAYER.crouch : (sprinting ? PLAYER.sprint : PLAYER.walk);
  const accel = G.grounded ? 32 : 7.5;

  // steep ground pulls you downhill instead of letting you stand on a wall
  if (alive && G.grounded && !G.sliding) {
    const slope = terrainSlope(G.pos.x, G.pos.z);
    if (slope > 0.26) {
      const n = terrainNormal(G.pos.x, G.pos.z);
      const pull = (slope - 0.26) * 26;
      moveDir.x += n.x * pull * dt;
      moveDir.z += n.z * pull * dt;
    }
  }

  if (!G.sliding) {
    moveDir.x += (wishX * maxSpeed - moveDir.x) * Math.min(1, accel * dt);
    moveDir.z += (wishZ * maxSpeed - moveDir.z) * Math.min(1, accel * dt);

    if (G.grounded && !wantsToMove) {
      const f = Math.max(0, 1 - dt * 9);
      moveDir.x *= f;
      moveDir.z *= f;
    }
  }

  G.coyote = G.grounded ? 0.12 : Math.max(0, G.coyote - dt);
  G.jumpBuf = Math.max(0, G.jumpBuf - dt);

  if (alive) {
    G.pos.x += moveDir.x * dt;
    G.pos.z += moveDir.z * dt;
    resolvePlayerCollision(G.pos);
    clampToWorld(G.pos);

    if (G.jumpBuf > 0 && G.coyote > 0 && G.mode === 'playing') {
      // jumping stands you up out of a crouch or a slide
      G.sliding = false;
      G.crouchToggle = false;
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
  // crouch and slide are smoothed so a tap never pops the view
  const crouchTarget = (G.crouchToggle || G.sliding) && alive ? 1 : 0;
  G.crouchBlend += (crouchTarget - G.crouchBlend) * Math.min(1, dt * 12);
  G.slideBlend += ((G.sliding ? 1 : 0) - G.slideBlend) * Math.min(1, dt * 10);
  const stanceDrop = 0.60 * G.crouchBlend + 0.10 * G.slideBlend;
  const bobScale = 1 - 0.55 * G.crouchBlend;

  const bobY = Math.sin(G.bobT * 2) * 0.028 * speedFactor * bobScale;
  const bobRoll = Math.sin(G.bobT) * 0.008 * speedFactor * bobScale;

  G.recoil *= Math.max(0, 1 - dt * 9);
  G.shake *= Math.max(0, 1 - dt * 6);

  G.landDip *= Math.max(0, 1 - dt * 7);
  let eye = PLAYER.eye - G.landDip - stanceDrop;

  if (G.dead) {
    G.deathT = Math.min(1, G.deathT + dt * 1.8);
    const k = 1 - Math.pow(1 - G.deathT, 3);
    eye = PLAYER.eye + (0.42 - PLAYER.eye) * k;
    camera.rotation.z = 0.6 * k;
    G.pitch += (Math.min(1.2, G.pitch + 0.9) - G.pitch) * Math.min(1, dt * 3);
  } else {
    const rollTarget = bobRoll - G.slideBlend * (0.055 - slideLean * 0.035);
    camera.rotation.z += (rollTarget - camera.rotation.z) * Math.min(1, dt * 10);
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
  const targetFov = 76 + sprintFov + (G.dead ? 8 : 0) + G.fovKick - G.focus * 2.6
    + G.slideBlend * 6.5 - G.crouchBlend * 1.5;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
  camera.updateProjectionMatrix();

  // footprints + crunch
  if (alive && G.grounded && speed > 0.8 && G.mode === 'playing' && !G.sliding) {
    G.footAccum += speed * dt;
    const stepDist = G.crouchToggle ? 0.78 : (sprinting ? 1.45 : 1.05);
    if (G.footAccum >= stepDist) {
      G.footAccum = 0;
      G.footSide *= -1;
      effects.footstep(G.pos.x, G.pos.z, G.yaw + Math.PI, G.footSide);
      if (sprinting) effects.spray(G.pos.x, G.pos.z, -moveDir.x, -moveDir.z, 0.45);
      audio.footstep(sprinting && !G.crouchToggle);
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
    swayX, swayY, grounded: G.grounded, spread: vmScale,
    crouch: G.crouchBlend, sliding: G.slideBlend
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

    const animId = b.anim | 0;
    r.ch.root.position.set(x, y, z);
    r.ch.update(dt, {
      yaw,
      pitch,
      moving: animId === 1 || animId === 2 || animId === 4,
      sprinting: animId === 2,
      crouching: animId === 3 || animId === 4,
      sliding: animId === 5,
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
  const speed = Math.hypot(moveDir.x, moveDir.z);
  const moving = speed > 0.6;
  let anim = 0;
  if (G.sliding) anim = 5;
  else if (G.crouchToggle) anim = moving ? 4 : 3;
  else if (moving) anim = (G.sprintToggle && speed > PLAYER.walk * 1.02) ? 2 : 1;
  G.session.input({
    t: 's',
    p: [Number(G.pos.x.toFixed(2)), Number(G.pos.y.toFixed(2)), Number(G.pos.z.toFixed(2))],
    y: Number(G.yaw.toFixed(3)),
    pitch: Number(G.pitch.toFixed(3)),
    a: anim,
    m: moving ? 1 : 0,
    sp: anim === 2 || anim === 5 ? 1 : 0
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
    ui.chargeLabel.textContent = power;
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

  // Charging a throw only sets the power and the ring: the match keeps its
  // normal speed, so aiming never freezes the fight around you.
  G.focus = 0;
  const worldDt = dt;

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
  // keep full quality on software renderers). Only step down -- switching back
  // up reallocated the post buffers every few seconds on phones, which showed
  // up as a regular hitch; quality recovers on the next settings change/reload.
  fpsAccum += dt;
  fpsFrames++;
  if (!DEBUG && fpsAccum > 1.5) {
    const fps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
    if (fps < 50 && renderScale > 0.61) applyRenderScale(renderScale - 0.1);
    else if (fps < 43 && renderScale <= 0.61 && !G.lowFx) {
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
    G.sprintToggle = false;
    G.sliding = false;
    ui.chargeRing.classList.remove('active');
  }
});
