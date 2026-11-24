// Winter world: terrain, frozen pond, pine forest, cabin, atmosphere.
import * as THREE from '../vendor/three.module.js';
import {
  WORLD, POND, OBSTACLES, CABIN, SPAWNS, terrainHeight, fbm, smoothstep
} from '../shared/world.js';

const SUN_DIR = new THREE.Vector3(-0.42, 0.34, -0.72).normalize();

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------
function makeSnowNormal(size = 256) {
  const height = new Float32Array(size * size);
  const s = 9;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      height[y * size + x] =
        fbm(x / size * s, y / size * s, 4) * 0.75 +
        fbm(x / size * s * 4.1 + 12, y / size * s * 4.1 - 7, 2) * 0.25;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const strength = 2.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const d = height[((y - 1 + size) % size) * size + x];
      const u = height[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(112, 112);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function makeSnowColor(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(9);
  for (let i = 0; i < 5000; i++) {
    const x = rnd() * size, y = rnd() * size;
    const v = 220 + rnd() * 35;
    ctx.fillStyle = `rgba(${v - 12},${v - 6},${v + 4},${0.05 + rnd() * 0.1})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + rnd() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(80, 80);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeIceTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#a9c9d8');
  g.addColorStop(0.45, '#c8e0e8');
  g.addColorStop(1, '#93b8ca');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(21);
  // milky patches
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.09})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * size, rnd() * size, 12 + rnd() * 90, 6 + rnd() * 40, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // cracks
  for (let i = 0; i < 22; i++) {
    let x = rnd() * size, y = rnd() * size;
    ctx.strokeStyle = `rgba(70,110,130,${0.1 + rnd() * 0.24})`;
    ctx.lineWidth = 0.5 + rnd() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let ang = rnd() * Math.PI * 2;
    const segs = 6 + rnd() * 16;
    for (let j = 0; j < segs; j++) {
      ang += (rnd() - 0.5) * 0.9;
      x += Math.cos(ang) * (8 + rnd() * 22);
      y += Math.sin(ang) * (8 + rnd() * 22);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.6);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeWoodTexture(w = 512, h = 512) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(33);
  ctx.fillStyle = '#5d4230';
  ctx.fillRect(0, 0, w, h);
  const planks = 9;
  const pw = w / planks;
  for (let i = 0; i < planks; i++) {
    const base = 72 + rnd() * 26;
    ctx.fillStyle = `rgb(${base + 24},${base - 2},${base - 22})`;
    ctx.fillRect(i * pw + 1, 0, pw - 2, h);
    // grain
    for (let g = 0; g < 22; g++) {
      ctx.strokeStyle = `rgba(${30 + rnd() * 30},${20 + rnd() * 22},${12 + rnd() * 16},${0.08 + rnd() * 0.18})`;
      ctx.lineWidth = 0.6 + rnd() * 1.4;
      ctx.beginPath();
      const x = i * pw + 3 + rnd() * (pw - 6);
      ctx.moveTo(x, 0);
      let xx = x;
      for (let y = 0; y < h; y += 24) {
        xx += (rnd() - 0.5) * 3;
        ctx.lineTo(xx, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(20,12,8,0.55)';
    ctx.fillRect(i * pw, 0, 1.5, h);
    // knots
    if (rnd() < 0.6) {
      const kx = i * pw + 8 + rnd() * (pw - 16), ky = rnd() * h;
      ctx.strokeStyle = 'rgba(40,25,15,0.4)';
      ctx.lineWidth = 1.2;
      for (let k = 1; k < 5; k++) {
        ctx.beginPath();
        ctx.ellipse(kx, ky, k * 2.4, k * 1.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeStoneTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(44);
  ctx.fillStyle = '#6d6e6b';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 120; i++) {
    const v = 70 + rnd() * 70;
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 6},0.9)`;
    const w = 10 + rnd() * 34, h = 8 + rnd() * 20;
    const x = rnd() * size, y = rnd() * size;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(35,35,38,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------
const skyVert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const skyFrag = /* glsl */`
  uniform vec3 uSunDir;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.15, 1.0);

    vec3 zenith  = vec3(0.028, 0.085, 0.22);
    vec3 upper   = vec3(0.13, 0.30, 0.55);
    vec3 horizon = vec3(0.62, 0.74, 0.85);
    vec3 low     = vec3(0.52, 0.64, 0.76);

    vec3 col = mix(low, horizon, smoothstep(-0.12, 0.02, h));
    col = mix(col, upper, smoothstep(0.02, 0.34, h));
    col = mix(col, zenith, smoothstep(0.30, 0.95, h));

    // Sun disk + bloom
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += vec3(1.0, 0.80, 0.55) * pow(sd, 1400.0) * 9.0;
    col += vec3(1.0, 0.75, 0.48) * pow(sd, 26.0) * 0.30;
    col += vec3(1.0, 0.84, 0.64) * pow(sd, 6.0) * 0.07;

    // Thin cirrus bands
    vec2 cuv = vec2(atan(d.z, d.x) * 1.6, d.y * 5.2);
    float cl = fbm(cuv * 1.3 + vec2(uTime * 0.003, 0.0));
    cl = smoothstep(0.52, 0.85, cl) * smoothstep(0.02, 0.30, d.y);
    col = mix(col, vec3(0.88, 0.92, 0.97), cl * 0.22);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: {
      uSunDir: { value: SUN_DIR.clone() },
      uTime: { value: 0 }
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
}

// ---------------------------------------------------------------------------
// Main world builder
// ---------------------------------------------------------------------------
export function createWorld(renderer, quality = 'high') {
  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0xaebfce);
  scene.fog = new THREE.FogExp2(fogColor, 0.0033);

  const q = quality === 'low' ? 0 : quality === 'mid' ? 1 : 2;

  // Sky
  const skyMat = makeSkyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 40, 24), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // Environment reflections from the sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 16), makeSkyMaterial()));
  const envRT = pmrem.fromScene(envScene, 0.02, 0.1, 200);
  scene.environment = envRT.texture;
  pmrem.dispose();

  // Lights
  const hemi = new THREE.HemisphereLight(0xa8caee, 0xaebfcd, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffeacb, 2.55);
  sun.position.copy(SUN_DIR).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q === 0 ? 1024 : q === 1 ? 2048 : 2048, q === 0 ? 1024 : 2048);
  sun.shadow.camera.left = -46; sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46; sun.shadow.camera.bottom = -46;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.09;
  scene.add(sun);
  scene.add(sun.target);

  // Fill light from the snow
  const bounce = new THREE.DirectionalLight(0xcfe2f7, 0.18);
  bounce.position.set(30, 18, 40);
  scene.add(bounce);

  // -------------------------------------------------------------------------
  // Terrain
  // -------------------------------------------------------------------------
  const snowNormal = makeSnowNormal();
  const snowColor = makeSnowColor();

  const TERRAIN_SIZE = 620;
  const seg = q === 0 ? 180 : 300;
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    const pd = Math.hypot(x - POND.x, z - POND.z);
    const pondT = 1 - smoothstep(POND.r * 0.85, POND.r * 1.45, pd);
    const n = fbm(x * 0.18, z * 0.18, 3);
    const shade = 0.80 + n * 0.14 - Math.min(0.10, Math.max(0, -y) * 0.014);
    let r = shade * 0.945, g = shade * 0.975, b = shade * 1.02;
    // wind-packed, slightly blue shading in hollows
    if (n < 0.35) { r *= 0.965; g *= 0.975; b *= 0.995; }
    // dirty snow near the cabin
    const cd = Math.hypot(x - CABIN.x, z - CABIN.z);
    if (cd < 12) {
      const dirt = (1 - cd / 12) * 0.10 * (0.4 + fbm(x * 0.7, z * 0.7, 2));
      r -= dirt * 0.6; g -= dirt * 0.55; b -= dirt * 0.4;
    }
    if (pondT > 0.98) { r *= 0.9; g *= 0.95; b *= 1.0; }
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: snowColor,
    normalMap: snowNormal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.88,
    metalness: 0.0,
    vertexColors: true,
    envMapIntensity: 0.28
  });
  const terrain = new THREE.Mesh(geo, snowMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // -------------------------------------------------------------------------
  // Frozen pond
  // -------------------------------------------------------------------------
  const iceMat = new THREE.MeshStandardMaterial({
    color: 0xb6d2dd,
    map: makeIceTexture(),
    roughness: 0.10,
    metalness: 0.06,
    envMapIntensity: 1.5,
    transparent: true,
    opacity: 0.98
  });
  const ice = new THREE.Mesh(new THREE.CircleGeometry(POND.r * 0.93, 72), iceMat);
  ice.rotation.x = -Math.PI / 2;
  ice.position.set(POND.x, POND.level + 0.04, POND.z);
  ice.receiveShadow = true;
  scene.add(ice);

  // Snow drifts on the pond edge (low, irregular berms)
  const driftTex = makeSoftDisc();
  const driftMat = new THREE.MeshStandardMaterial({
    color: 0xf6fbff, roughness: 0.9, transparent: true, opacity: 0.82,
    alphaMap: driftTex, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1
  });
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + Math.random() * 0.25;
    const r = POND.r * (0.94 + Math.random() * 0.1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2 + Math.random() * 4.2, 1.2 + Math.random() * 2.6), driftMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI;
    m.position.set(POND.x + Math.cos(a) * r, POND.level + 0.055, POND.z + Math.sin(a) * r);
    m.receiveShadow = true;
    scene.add(m);
  }

  // -------------------------------------------------------------------------
  // Pine forest
  // -------------------------------------------------------------------------
  const rnd = mulberry32(1337);
  const trees = [];
  const targetTrees = q === 0 ? 60 : q === 1 ? 110 : 160;
  let guard = 0;
  while (trees.length < targetTrees && guard++ < 14000) {
    let x, z;
    if (trees.length > 8 && rnd() < 0.6) {
      const b = trees[(rnd() * trees.length) | 0];
      const a = rnd() * Math.PI * 2;
      const rr = 2.5 + rnd() * 13;
      x = b.x + Math.cos(a) * rr;
      z = b.z + Math.sin(a) * rr;
    } else {
      const a = rnd() * Math.PI * 2;
      const rr = 22 + Math.pow(rnd(), 0.58) * 116;
      x = Math.cos(a) * rr;
      z = Math.sin(a) * rr;
    }
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 5) continue;
    if (Math.hypot(x - CABIN.x, z - CABIN.z) < 11) continue;
    let bad = false;
    for (const s of SPAWNS) if (Math.hypot(x - s.x, z - s.z) < 6.5) { bad = true; break; }
    if (bad) continue;
    for (const o of OBSTACLES) if (Math.abs(x - o.x) < o.w / 2 + 2 && Math.abs(z - o.z) < o.d / 2 + 2) { bad = true; break; }
    if (bad) continue;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < 3.1) { bad = true; break; }
    if (bad) continue;
    trees.push({ x, z, h: 7.2 + Math.pow(rnd(), 1.35) * 12.5, r: 0.78 + rnd() * 0.52, seed: rnd() * 100 });
  }

  const layers = q === 0 ? 6 : q === 1 ? 8 : 9;
  const radial = q === 0 ? 8 : 12;
  const foliageGeo = new THREE.ConeGeometry(1, 1, radial, 1);
  foliageGeo.translate(0, 0.5, 0);
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.94, metalness: 0, flatShading: false, envMapIntensity: 0.15
  });
  const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, trees.length * layers);
  foliage.castShadow = true;
  foliage.receiveShadow = true;

  const snowCapGeo = new THREE.ConeGeometry(1, 1, radial, 1);
  snowCapGeo.translate(0, 0.5, 0);
  const snowCapMat = new THREE.MeshStandardMaterial({
    color: 0xf4f9ff, roughness: 0.72, metalness: 0, envMapIntensity: 0.45
  });
  const snowCaps = new THREE.InstancedMesh(snowCapGeo, snowCapMat, trees.length * layers);
  snowCaps.castShadow = true;

  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.21, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1f, roughness: 0.95 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  trunks.castShadow = true;

  const moundGeo = new THREE.IcosahedronGeometry(1, 1);
  const mounds = new THREE.InstancedMesh(moundGeo, snowCapMat, trees.length);
  mounds.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let fi = 0;
  trees.forEach((t, ti) => {
    const groundY = terrainHeight(t.x, t.z);
    const trunkH = t.h * 0.28;
    dummy.position.set(t.x, groundY - 0.2, t.z);
    dummy.rotation.set(0, rnd() * Math.PI, 0);
    dummy.scale.set(0.85 + t.r * 0.4, trunkH + 0.6, 0.85 + t.r * 0.4);
    dummy.updateMatrix();
    trunks.setMatrixAt(ti, dummy.matrix);

    // snow drift at the root
    dummy.position.set(t.x + (rnd() - 0.5) * 0.8, groundY + 0.02, t.z + (rnd() - 0.5) * 0.8);
    dummy.rotation.set(0, rnd() * 6.28, 0);
    dummy.scale.set(1.6 + rnd() * 1.4, 0.32 + rnd() * 0.25, 1.6 + rnd() * 1.4);
    dummy.updateMatrix();
    mounds.setMatrixAt(ti, dummy.matrix);

    for (let l = 0; l < layers; l++) {
      const k = l / (layers - 1);
      const y = groundY + trunkH * 0.82 + k * (t.h - trunkH * 0.82) * 0.93 + (rnd() - 0.5) * 0.22;
      const rad = (2.25 * (1 - k * 0.72)) * t.r * (0.9 + rnd() * 0.22);
      const layerH = (t.h * 0.235) * (1 - k * 0.25) * (0.85 + rnd() * 0.35);
      dummy.position.set(t.x + (rnd() - 0.5) * 0.4, y, t.z + (rnd() - 0.5) * 0.4);
      dummy.rotation.set(0, t.seed + l * 1.1, 0);
      dummy.scale.set(rad, layerH, rad);
      dummy.updateMatrix();
      foliage.setMatrixAt(fi, dummy.matrix);
      const v = 0.55 + rnd() * 0.55;
      tint.setRGB(0.052 * v, 0.115 * v, 0.072 * v);
      foliage.setColorAt(fi, tint);

      dummy.position.y = y + layerH * 0.72;
      dummy.scale.set(rad * 0.97, layerH * 0.19, rad * 0.97);
      dummy.updateMatrix();
      snowCaps.setMatrixAt(fi, dummy.matrix);
      fi++;
    }
  });
  foliage.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  snowCaps.instanceMatrix.needsUpdate = true;
  trunks.instanceMatrix.needsUpdate = true;
  mounds.instanceMatrix.needsUpdate = true;
  scene.add(foliage, snowCaps, trunks, mounds);

  // -------------------------------------------------------------------------
  // Rocks
  // -------------------------------------------------------------------------
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const p = rockGeo.attributes.position;
    const r2 = mulberry32(77);
    for (let i = 0; i < p.count; i++) {
      const f = 0.82 + r2() * 0.36;
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.85, p.getZ(i) * f);
    }
    rockGeo.computeVertexNormals();
  }
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x565c60, roughness: 0.88, flatShading: true });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xf7fbff, roughness: 0.7, flatShading: true });

  const rockObstacles = OBSTACLES.filter(o => o.kind === 'rock');
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockObstacles.length + 10);
  const caps = new THREE.InstancedMesh(rockGeo, capMat, rockObstacles.length + 10);
  rocks.castShadow = rocks.receiveShadow = true;
  caps.castShadow = true;
  let ri = 0;

  function addRock(x, z, sx, sy, sz, rot) {
    const y = terrainHeight(x, z);
    dummy.position.set(x, y + sy * 0.22, z);
    dummy.rotation.set(rot * 0.3, rot, rot * 0.2);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    rocks.setMatrixAt(ri, dummy.matrix);

    dummy.position.y = y + sy * 0.62;
    dummy.scale.set(sx * 0.96, sy * 0.42, sz * 0.96);
    dummy.updateMatrix();
    caps.setMatrixAt(ri, dummy.matrix);
    ri++;
  }

  for (const o of rockObstacles) addRock(o.x, o.z, o.w / 2, o.h / 2, o.d / 2, rnd() * 6);
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2, r = 30 + rnd() * 75;
    addRock(Math.cos(a) * r, Math.sin(a) * r, 0.7 + rnd() * 2.2, 0.6 + rnd() * 1.4, 0.7 + rnd() * 2.2, rnd() * 6);
  }
  rocks.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  scene.add(rocks, caps);

  // -------------------------------------------------------------------------
  // Cabin
  // -------------------------------------------------------------------------
  const cabin = new THREE.Group();
  const baseY = CABIN.y;
  cabin.position.set(CABIN.x, baseY, CABIN.z);

  const woodMat = new THREE.MeshStandardMaterial({
    map: makeWoodTexture(), roughness: 0.9, metalness: 0, envMapIntensity: 0.2
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a3a30, roughness: 0.85 });
  const stoneMat = new THREE.MeshStandardMaterial({ map: makeStoneTexture(), roughness: 0.95 });

  const walls = new THREE.Mesh(new THREE.BoxGeometry(CABIN.w, 3.1, CABIN.d), woodMat);
  walls.position.y = 1.55;
  walls.castShadow = true; walls.receiveShadow = true;
  cabin.add(walls);

  // corner beams
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.25, 0.22), new THREE.MeshStandardMaterial({ color: 0x37251a, roughness: 0.9 }));
    beam.position.set(sx * (CABIN.w / 2 - 0.05), 1.62, sz * (CABIN.d / 2 - 0.05));
    beam.castShadow = true;
    cabin.add(beam);
  }

  // roof — two slabs + snow
  const roofAngle = 0.62;
  for (const side of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(CABIN.w + 1.3, 0.2, CABIN.d * 0.72), roofMat);
    slab.position.set(0, 3.5, side * CABIN.d * 0.24);
    slab.rotation.x = side * roofAngle;
    slab.castShadow = true; slab.receiveShadow = true;
    cabin.add(slab);

    const snowSlab = new THREE.Mesh(new THREE.BoxGeometry(CABIN.w + 1.35, 0.18, CABIN.d * 0.72), snowCapMat);
    snowSlab.position.set(0, 3.62, side * CABIN.d * 0.24);
    snowSlab.rotation.x = side * roofAngle;
    snowSlab.castShadow = true;
    cabin.add(snowSlab);
  }

  // gable triangles (simple boxes)
  const gableMat = woodMat;
  for (const side of [-1, 1]) {
    const gable = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.3, CABIN.d * 0.82), gableMat);
    gable.position.set(side * CABIN.w / 2, 3.15, 0);
    gable.castShadow = true;
    cabin.add(gable);
  }

  // chimney
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.5, 0.85), stoneMat);
  chimney.position.set(CABIN.w * 0.28, 4.35, -CABIN.d * 0.2);
  chimney.castShadow = true;
  cabin.add(chimney);
  const chimneySnow = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.16, 1.02), snowCapMat);
  chimneySnow.position.set(chimney.position.x, 5.62, chimney.position.z);
  cabin.add(chimneySnow);

  // door + windows
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a1b12, roughness: 0.8 }));
  door.position.set(0.6, 1.05, CABIN.d / 2 + 0.03);
  cabin.add(door);

  const winMat = new THREE.MeshStandardMaterial({
    color: 0xffd9a0, emissive: 0xff9d45, emissiveIntensity: 2.4, roughness: 0.35,
    transparent: true, opacity: 0.94
  });
  const windows = [];
  for (const wx of [-1.9, 2.7]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.1), new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 0.9 }));
    frame.position.set(wx, 1.85, CABIN.d / 2 + 0.02);
    cabin.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.75), winMat);
    glass.position.set(wx, 1.85, CABIN.d / 2 + 0.085);
    cabin.add(glass);
    windows.push(glass);
  }
  // side window
  const sideGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), winMat);
  sideGlass.position.set(CABIN.w / 2 + 0.06, 1.85, 0.4);
  sideGlass.rotation.y = Math.PI / 2;
  cabin.add(sideGlass);

  const warmLight = new THREE.PointLight(0xffab5e, 26, 26, 2);
  warmLight.position.set(0.5, 2.0, CABIN.d / 2 + 1.4);
  cabin.add(warmLight);

  const porch = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 1.4), woodMat);
  porch.position.set(0.6, 0.12, CABIN.d / 2 + 0.62);
  porch.receiveShadow = true;
  cabin.add(porch);

  // icicles
  const icicleMat = new THREE.MeshStandardMaterial({
    color: 0xdff4ff, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.8, envMapIntensity: 1.5
  });
  for (let i = 0; i < 16; i++) {
    const len = 0.18 + Math.random() * 0.5;
    const ic = new THREE.Mesh(new THREE.ConeGeometry(0.055, len, 5), icicleMat);
    ic.rotation.x = Math.PI;
    ic.position.set(
      -CABIN.w / 2 - 0.4 + Math.random() * (CABIN.w + 0.8),
      3.32,
      CABIN.d / 2 + 0.42 + Math.random() * 0.1
    );
    cabin.add(ic);
  }

  scene.add(cabin);

  // -------------------------------------------------------------------------
  // Fence
  // -------------------------------------------------------------------------
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.95 });
  const fence = new THREE.Group();
  const fenceStart = new THREE.Vector2(CABIN.x + 7, CABIN.z + 3);
  const fenceEnd = new THREE.Vector2(CABIN.x + 26, CABIN.z - 6);
  const posts = 16;
  for (let i = 0; i < posts; i++) {
    const t = i / (posts - 1);
    const x = fenceStart.x + (fenceEnd.x - fenceStart.x) * t;
    const z = fenceStart.y + (fenceEnd.y - fenceStart.y) * t;
    const y = terrainHeight(x, z);
    const h = 1.25 + Math.sin(i * 1.7) * 0.06;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.13, h, 0.13), fenceMat);
    post.position.set(x, y + h / 2 - 0.1, z);
    post.rotation.y = t * 0.2;
    post.castShadow = true;
    fence.add(post);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.2), snowCapMat);
    cap.position.set(x, y + h - 0.06, z);
    cap.castShadow = true;
    fence.add(cap);
  }
  for (let i = 0; i < posts - 1; i++) {
    const t0 = i / (posts - 1), t1 = (i + 1) / (posts - 1);
    const x0 = fenceStart.x + (fenceEnd.x - fenceStart.x) * t0;
    const z0 = fenceStart.y + (fenceEnd.y - fenceStart.y) * t0;
    const x1 = fenceStart.x + (fenceEnd.x - fenceStart.x) * t1;
    const z1 = fenceStart.y + (fenceEnd.y - fenceStart.y) * t1;
    const mid = new THREE.Vector3((x0 + x1) / 2, terrainHeight((x0 + x1) / 2, (z0 + z1) / 2) + 0.75, (z0 + z1) / 2);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.07), fenceMat);
    rail.position.copy(mid);
    rail.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    rail.castShadow = true;
    fence.add(rail);
    const railSnow = new THREE.Mesh(new THREE.BoxGeometry(len, 0.045, 0.1), snowCapMat);
    railSnow.position.copy(mid).add(new THREE.Vector3(0, 0.07, 0));
    railSnow.rotation.copy(rail.rotation);
    fence.add(railSnow);
  }
  scene.add(fence);

  // -------------------------------------------------------------------------
  // Distant mountains
  // -------------------------------------------------------------------------
  const mountains = new THREE.Group();
  const mtMat = new THREE.MeshStandardMaterial({ color: 0x8ca7c2, roughness: 1, flatShading: true });
  const mtSnow = new THREE.MeshStandardMaterial({ color: 0xe4eef9, roughness: 0.9, flatShading: true });
  const mr = mulberry32(555);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + mr() * 0.25;
    const r = 300 + mr() * 150;
    const h = 90 + mr() * 170;
    const rad = 90 + mr() * 130;
    const mt = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 5 + (mr() * 3 | 0)), mtMat);
    mt.position.set(Math.cos(a) * r, h / 2 - 40, Math.sin(a) * r);
    mt.rotation.y = mr() * Math.PI;
    mountains.add(mt);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.45, h * 0.42, 5), mtSnow);
    cap.position.set(mt.position.x, mt.position.y + h * 0.29, mt.position.z);
    cap.rotation.y = mt.rotation.y;
    mountains.add(cap);
  }
  scene.add(mountains);

  // -------------------------------------------------------------------------
  // Snowfall
  // -------------------------------------------------------------------------
  const snowCount = q === 0 ? 1800 : q === 1 ? 4500 : 7500;
  const snowGeo = new THREE.BufferGeometry();
  const base = new Float32Array(snowCount * 3);
  const phase = new Float32Array(snowCount);
  const size = new Float32Array(snowCount);
  const fall = new Float32Array(snowCount);
  for (let i = 0; i < snowCount; i++) {
    base[i * 3] = (Math.random() - 0.5) * 72;
    base[i * 3 + 1] = (Math.random() - 0.5) * 44;
    base[i * 3 + 2] = (Math.random() - 0.5) * 72;
    phase[i] = Math.random() * Math.PI * 2;
    size[i] = 0.6 + Math.random() * 1.8;
    fall[i] = 0.9 + Math.random() * 1.8;
  }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(base, 3));
  snowGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  snowGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  snowGeo.setAttribute('aFall', new THREE.BufferAttribute(fall, 1));

  const snowU = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) }
  };
  const snowShader = new THREE.ShaderMaterial({
    uniforms: snowU,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aPhase;
      attribute float aSize;
      attribute float aFall;
      uniform float uTime;
      uniform vec3 uCenter;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = uTime;
        p.y -= t * aFall;
        p.x += sin(t * 0.55 + aPhase) * 1.4 + t * 1.1;
        p.z += cos(t * 0.43 + aPhase * 1.7) * 1.1 + t * 0.25;
        vec3 rel = mod(p - uCenter + vec3(36.0, 22.0, 36.0), vec3(72.0, 44.0, 72.0)) - vec3(36.0, 22.0, 36.0);
        vec3 wp = uCenter + rel;
        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        float dist = -mv.z;
        vAlpha = smoothstep(46.0, 16.0, dist) * smoothstep(0.4, 2.5, dist);
        gl_PointSize = clamp(aSize * uPixelRatio * (11.0 / max(dist, 0.7)), 1.2, 8.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.08, d) * vAlpha * 0.85;
        gl_FragColor = vec4(0.96, 0.985, 1.0, a);
      }
    `
  });
  const snowfall = new THREE.Points(snowGeo, snowShader);
  snowfall.frustumCulled = false;
  scene.add(snowfall);

  // -------------------------------------------------------------------------
  // Sparkling snow crystals
  // -------------------------------------------------------------------------
  const sparkCount = q === 0 ? 800 : q === 1 ? 2200 : 3800;
  const sparkGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(sparkCount * 3);
  const sph = new Float32Array(sparkCount);
  for (let i = 0; i < sparkCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 70;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    sp[i * 3] = x; sp[i * 3 + 1] = terrainHeight(x, z) + 0.035; sp[i * 3 + 2] = z;
    sph[i] = Math.random() * Math.PI * 2;
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sparkGeo.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1));
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aPhase;
      uniform float uTime;
      uniform vec3 uCenter;
      varying float vAlpha;
      void main() {
        vec3 wp = position;
        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        float dist = -mv.z;
        float tw = pow(max(0.0, sin(uTime * 2.2 + aPhase)), 12.0);
        vAlpha = tw * smoothstep(70.0, 8.0, dist) * smoothstep(0.5, 3.0, dist);
        gl_PointSize = (1.6 + tw * 2.4) * (70.0 / max(dist, 1.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(1.0, 0.98, 0.92, a);
      }
    `
  });
  const sparkles = new THREE.Points(sparkGeo, sparkMat);
  sparkles.frustumCulled = false;
  scene.add(sparkles);

  // -------------------------------------------------------------------------
  // Low ground mist
  // -------------------------------------------------------------------------
  const mistTex = makeSoftDisc(true);
  const mists = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.SpriteMaterial({
      map: mistTex, transparent: true, opacity: 0.05 + Math.random() * 0.05,
      depthWrite: false, color: 0xdfeaf7, fog: true
    });
    const s = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.random() * 55;
    s.position.set(Math.cos(a) * r, terrainHeight(Math.cos(a) * r, Math.sin(a) * r) + 1.4, Math.sin(a) * r);
    s.scale.set(26 + Math.random() * 30, 9 + Math.random() * 9, 1);
    s.userData = { a, r, speed: 0.008 + Math.random() * 0.012, phase: Math.random() * 10 };
    scene.add(s);
    mists.push(s);
  }

  // -------------------------------------------------------------------------
  // Chimney smoke
  // -------------------------------------------------------------------------
  const smokeTex = makeSoftDisc(true);
  const smoke = [];
  for (let i = 0; i < 26; i++) {
    const mat = new THREE.SpriteMaterial({
      map: smokeTex, transparent: true, opacity: 0, depthWrite: false,
      color: 0xd8dde3, fog: true
    });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    scene.add(s);
    smoke.push({ sprite: s, t: Math.random() * 6, speed: 0.5 + Math.random() * 0.4, drift: Math.random() * 2 - 1 });
  }
  const chimneyWorld = new THREE.Vector3(CABIN.x + CABIN.w * 0.28, baseY + 5.8, CABIN.z - CABIN.d * 0.2);

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------
  const clock = { t: 0 };
  const tmpV = new THREE.Vector3();

  function update(dt, camera, playerPos) {
    clock.t += dt;
    const t = clock.t;

    sky.position.copy(camera.position);
    skyMat.uniforms.uTime.value = t;

    if (playerPos) {
      // Shadow frustum follows the player, snapped to reduce shimmering
      const sx = Math.round(playerPos.x / 2) * 2;
      const sz = Math.round(playerPos.z / 2) * 2;
      sun.target.position.set(sx, terrainHeight(sx, sz), sz);
      sun.position.set(sx + SUN_DIR.x * 120, terrainHeight(sx, sz) + SUN_DIR.y * 120, sz + SUN_DIR.z * 120);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    }

    snowU.uTime.value = t;
    snowU.uCenter.value.copy(camera.position);
    sparkMat.uniforms.uTime.value = t;

    for (const m of mists) {
      const u = m.userData;
      u.a += u.speed * dt;
      const x = Math.cos(u.a) * u.r + Math.sin(t * 0.1 + u.phase) * 4;
      const z = Math.sin(u.a) * u.r + Math.cos(t * 0.08 + u.phase) * 4;
      m.position.x = x;
      m.position.z = z;
      m.position.y = terrainHeight(x, z) + 1.6;
    }

    // Smoke puffs
    for (const p of smoke) {
      p.t += dt * p.speed;
      if (p.t > 6.5) p.t -= 6.5;
      const life = p.t / 6.5;
      const s = p.sprite;
      s.visible = true;
      const rise = p.t * 1.5;
      s.position.set(
        chimneyWorld.x + Math.sin(p.t * 0.8 + p.drift) * 0.5 + p.t * 0.35,
        chimneyWorld.y + rise,
        chimneyWorld.z + Math.cos(p.t * 0.5 + p.drift) * 0.4
      );
      const scale = 0.8 + p.t * 0.9;
      s.scale.set(scale, scale, 1);
      s.material.opacity = Math.max(0, Math.sin(life * Math.PI)) * 0.22;
      s.material.rotation += dt * 0.1 * p.drift;
    }
  }

  function setSnowQuality(level) {
    snowU.uPixelRatio.value = level;
  }

  return { scene, sun, sky, terrain, update, setSnowQuality, sunDir: SUN_DIR, fogColor };
}

// Soft radial disc used for mist, smoke and drifts
function makeSoftDisc(soft = false) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(soft ? 0.35 : 0.55, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
