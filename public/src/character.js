// Player characters + first-person viewmodel.
// Everything is procedural: anatomy, layered winter gear, cloth/leather/knit
// micro-detail from canvas bump maps, snow dusting and articulated animation.
import * as THREE from '../vendor/three.module.js';

const JACKETS = [
  0x2c4660, 0x6e2f33, 0x33513f, 0x5b4429, 0x39406e, 0x74451f, 0x2f5b5e, 0x512f52
];
const SCARVES = [0xb4452f, 0xd8b24a, 0x4a7d8c, 0x9c3f4f, 0x6f8f4a, 0xc26a2c];
const SKIN_TONES = [0xd9b49a, 0xc19a7e, 0xa87e62, 0xe4c6ac, 0x8c654c, 0xcbab92];
const HAIR_COLORS = [0x1b1310, 0x3a2718, 0x6b4f2c, 0x120e0b, 0x53341f, 0x8a6a44];
const IRIS_COLORS = [0x5d7f72, 0x5b7f96, 0x6f8a5a, 0x7d5a48, 0x4d5f78, 0x8a6a3c];

export function characterColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % JACKETS.length;
}

// ---------------------------------------------------------------------------
// Procedural micro-detail textures (bump maps, shared between all characters)
// ---------------------------------------------------------------------------
function hash2(ix, iy) {
  let n = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function fbm2(x, y, oct = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += amp * valueNoise(x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

function bumpCanvas(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = fn(x, y, size);
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const texCache = new Map();

// Tangent-space normal map derived from the same height field as the bump map.
// Gives fabric, knit, leather and skin a crisp lit relief instead of a soft blur.
function normalTexture(key, size, fn, strength = 2) {
  const cacheKey = 'n:' + key;
  if (texCache.has(cacheKey)) return texCache.get(cacheKey);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) h[y * size + x] = fn(x, y, size) / 255;
  }
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  texCache.set(cacheKey, tex);
  return tex;
}

function bumpTexture(key, size, fn) {
  if (texCache.has(key)) return texCache.get(key);
  const c = bumpCanvas(size, fn);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// Height fields shared by the bump and normal map builders
const fabricH = (x, y) => {
  const weave = Math.sin(x * 1.9) * Math.cos(y * 1.9) * 12;
  const slub = (fbm2(x * 0.06, y * 0.06, 3) - 0.5) * 40;
  const grain = (hash2(x, y) - 0.5) * 22;
  return 128 + weave + slub + grain;
};
const knitH = (x, y) => {
  const rib = Math.sin(x * 0.62) * 34;
  const stitch = Math.sin(y * 1.35 + Math.sin(x * 0.62) * 1.4) * 20;
  const fuzz = (hash2(x * 3, y * 3) - 0.5) * 26;
  return 128 + rib + stitch + fuzz;
};
const leatherH = (x, y) => {
  const pebble = fbm2(x * 0.24, y * 0.24, 3) * 70;
  const pores = (hash2(x * 1.7, y * 1.7) - 0.5) * 30;
  return 96 + pebble + pores;
};
const denimH = (x, y) => {
  const twill = Math.sin((x + y) * 1.05) * 24;
  const slub = (fbm2(x * 0.09, y * 0.09, 2) - 0.5) * 26;
  return 128 + twill + slub;
};
const skinH = (x, y) => {
  const pores = fbm2(x * 0.5, y * 0.5, 3) * 46;
  const fine = (hash2(x * 2, y * 2) - 0.5) * 14;
  return 108 + pores + fine;
};

const fabricBump = () => bumpTexture('fabric', 256, fabricH);
const knitBump = () => bumpTexture('knit', 256, knitH);
const leatherBump = () => bumpTexture('leather', 256, leatherH);
const denimBump = () => bumpTexture('denim', 256, denimH);
const skinBump = () => bumpTexture('skin', 128, skinH);

// ---------------------------------------------------------------------------
// Head
// A head built from stacked primitives always reads as glued-on blobs, so this
// one is a single sphere displaced into skull, brow, cheeks, jaw, nose and
// mouth. Eyes and mouth are separate high-resolution decals that follow the
// sculpted surface, which keeps them crisp without a 4k albedo texture.
// ---------------------------------------------------------------------------
const HEAD_W = 0.093;   // half width  (18.6 cm across)
const HEAD_H = 0.126;   // half height (25.2 cm crown to chin)
const HEAD_D = 0.105;   // half depth  (21.0 cm face to occiput)

// soft ellipsoidal falloff used by every sculpted feature
function headGauss(x, y, z, cx, cy, cz, rx, ry, rz) {
  const dx = (x - cx) / rx, dy = (y - cy) / ry, dz = (z - cz) / rz;
  const q = dx * dx + dy * dy + dz * dz;
  return q >= 1 ? 0 : Math.exp(-3.0 * q) * (1 - q);
}

// Signed displacement in metres, applied along the ellipsoid normal.
// Positive pushes out, negative carves in. Coordinates: x right, y up, z back.
function headSculpt(x, y, z) {
  const g = (cx, cy, cz, rx, ry, rz) => headGauss(x, y, z, cx, cy, cz, rx, ry, rz);
  let d = 0;
  for (const s of [-1, 1]) {
    d += g(s * 0.030, 0.026, -0.080, 0.048, 0.014, 0.042) * 0.0055;   // brow ridge
    d += g(s * 0.037, 0.008, -0.084, 0.030, 0.024, 0.034) * -0.0052;  // eye socket
    d += g(s * 0.050, -0.020, -0.068, 0.032, 0.030, 0.042) * 0.0072;  // cheek apple
    d += g(s * 0.045, -0.052, -0.078, 0.022, 0.018, 0.030) * -0.0022; // cheek to jaw hollow
    d += g(s * 0.060, -0.070, -0.050, 0.024, 0.026, 0.040) * 0.0040;  // jaw corner
    d += g(s * 0.080, 0.030, -0.004, 0.022, 0.032, 0.038) * -0.0042;  // temple
    d += g(s * 0.010, -0.038, -0.099, 0.008, 0.008, 0.016) * -0.0038; // nostril dent
  }
  d += g(0, 0.060, -0.072, 0.072, 0.042, 0.042) * 0.0030;   // forehead dome
  d += g(0, -0.004, -0.097, 0.013, 0.026, 0.020) * 0.0072;  // nose bridge
  d += g(0, -0.034, -0.098, 0.019, 0.017, 0.026) * 0.0150;  // nose tip
  d += g(0, -0.063, -0.092, 0.024, 0.006, 0.020) * -0.0052; // mouth trough
  d += g(0, -0.076, -0.092, 0.018, 0.009, 0.020) * 0.0032;  // lower lip
  d += g(0, -0.101, -0.082, 0.020, 0.018, 0.028) * 0.0058;  // chin
  d += g(0, 0.010, 0.078, 0.072, 0.080, 0.044) * 0.0042;    // occiput
  return d;
}

let headGeoCache = null;
function headGeometry() {
  if (headGeoCache) return headGeoCache;
  const geo = new THREE.SphereGeometry(1, 72, 54);
  const pos = geo.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    p.set(px * HEAD_W, py * HEAD_H, pz * HEAD_D);
    // narrow the jaw towards the chin: a childlike, readable silhouette
    const t = Math.max(0, Math.min(1, (-p.y - 0.004) / 0.104));
    p.x *= 1 - 0.36 * t * t;
    p.z *= 1 - 0.08 * t * t;
    const d = headSculpt(p.x, p.y, p.z);
    const nx = p.x / (HEAD_W * HEAD_W), ny = p.y / (HEAD_H * HEAD_H), nz = p.z / (HEAD_D * HEAD_D);
    const nl = Math.hypot(nx, ny, nz) || 1;
    pos.setXYZ(i, p.x + nx / nl * d, p.y + ny / nl * d, p.z + nz / nl * d);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  headGeoCache = geo;
  return geo;
}

// Head point -> sphere UV (u = 0.75 faces -Z, v = 1 at the crown).
function headUV(x, y, z) {
  const nx = x / HEAD_W, ny = y / HEAD_H, nz = z / HEAD_D;
  const l = Math.hypot(nx, ny, nz) || 1;
  const u = ((Math.atan2(nz / l, -nx / l) / (Math.PI * 2)) + 1) % 1;
  const v = 1 - Math.acos(Math.max(-1, Math.min(1, ny / l))) / Math.PI;
  return [u, v];
}

// A flat grid wrapped onto the sculpted head: used for the eye and mouth decals
// so a 512 px texture covers a few centimetres instead of an entire skull.
function decalGeometry(cx, cy, cz, w, h, segX = 18, segY = 12) {
  const dir = new THREE.Vector3(cx / (HEAD_W * HEAD_W), cy / (HEAD_H * HEAD_H), cz / (HEAD_D * HEAD_D)).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  const geo = new THREE.PlaneGeometry(w, h, segX, segY);
  const pos = geo.attributes.position;
  const p = new THREE.Vector3();
  const R = 0.100;
  for (let i = 0; i < pos.count; i++) {
    p.copy(dir)
      .addScaledVector(right, pos.getX(i) / R)
      .addScaledVector(up, pos.getY(i) / R)
      .normalize();
    const ex = p.x * HEAD_W, ey = p.y * HEAD_H, ez = p.z * HEAD_D;
    const d = headSculpt(ex, ey, ez) + 0.0012;
    const nx = p.x / HEAD_W, ny = p.y / HEAD_H, nz = p.z / HEAD_D;
    const nl = Math.hypot(nx, ny, nz) || 1;
    pos.setXYZ(i, ex + nx / nl * d, ey + ny / nl * d, ez + nz / nl * d);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// Skin albedo: low-frequency tone changes and baked occlusion only. Eyes and
// mouth are decals, so this map never has to be huge.
function faceAlbedo(idx) {
  const key = 'albedo:' + (idx % SKIN_TONES.length);
  if (texCache.has(key)) return texCache.get(key);
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7efe9';
  ctx.fillRect(0, 0, W, H);

  // soft elliptical patch in head space (metres)
  const blob = (x, y, z, w, h, rgb, alpha) => {
    const [u, v] = headUV(x, y, z);
    const rx = Math.max(2, w * 1700), ry = Math.max(2, h * 1520);
    ctx.save();
    ctx.translate(u * W, (1 - v) * H);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`);
    g.addColorStop(0.6, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha * 0.4})`);
    g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  };

  for (const s of [-1, 1]) {
    blob(s * 0.036, 0.011, -0.082, 0.034, 0.024, [118, 78, 70], 0.34);  // socket shadow
    blob(s * 0.034, 0.024, -0.084, 0.026, 0.007, [104, 66, 58], 0.26);  // lid crease
    blob(s * 0.052, -0.026, -0.070, 0.036, 0.030, [226, 128, 112], 0.32); // rosy cheek
    blob(s * 0.012, -0.028, -0.095, 0.008, 0.026, [120, 78, 68], 0.26);  // nose side
    blob(s * 0.010, -0.039, -0.096, 0.005, 0.004, [116, 80, 72], 0.34);  // nostril
    blob(s * 0.078, 0.052, -0.020, 0.026, 0.034, [148, 106, 94], 0.16);  // temple
    blob(s * 0.058, -0.074, -0.062, 0.020, 0.020, [140, 96, 86], 0.18);  // jaw hollow
  }
  blob(0, -0.032, -0.100, 0.017, 0.014, [230, 124, 108], 0.26);  // rosy nose
  blob(0, -0.098, -0.082, 0.024, 0.014, [132, 94, 86], 0.10);    // under the chin
  blob(0, 0.068, -0.062, 0.066, 0.018, [130, 94, 84], 0.14);     // hairline, front
  for (const s of [-1, 1]) {
    blob(s * 0.074, 0.030, -0.030, 0.022, 0.024, [126, 90, 82], 0.16); // hairline, side
  }

  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = ctx.createPattern(skinGrainPattern(), 'repeat');
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

let grainCanvas = null;
function skinGrainPattern() {
  if (grainCanvas) return grainCanvas;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = 0.6 * tileNoise(x * 0.05, y * 0.05, 16) + 0.3 * tileNoise(x * 0.16, y * 0.16, 40) + 0.1 * hash2(x, y);
      const v = Math.max(0, Math.min(255, 128 + (n - 0.5) * 66));
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  grainCanvas = c;
  return grainCanvas;
}

function tileNoise(x, y, p) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const wrap = (a) => ((a % p) + p) % p;
  const h = (a, b) => hash2(wrap(a), wrap(b));
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

// Eye decal: sclera, limbal ring, iris fibres, pupil, lashes and lid shadow.
function eyeTexture(idx, open) {
  const key = `eye:${idx % SKIN_TONES.length}:${open ? 1 : 0}`;
  if (texCache.has(key)) return texCache.get(key);
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const cx = 256, cy = 128, hw = 176, hh = 74;

  const almond = () => {
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy + 8);
    ctx.bezierCurveTo(cx - hw * 0.60, cy - hh * 1.00, cx + hw * 0.55, cy - hh * 1.04, cx + hw, cy - 12);
    ctx.bezierCurveTo(cx + hw * 0.58, cy + hh * 0.96, cx - hw * 0.55, cy + hh * 0.98, cx - hw, cy + 8);
    ctx.closePath();
  };

  if (!open) {
    ctx.fillStyle = '#ffffff';
    almond();
    ctx.fill();
    ctx.save();
    almond();
    ctx.clip();
    const g = ctx.createLinearGradient(cx, cy - hh, cx, cy + hh);
    g.addColorStop(0, 'rgba(252,242,238,0.95)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(150,108,98,0.32)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.strokeStyle = 'rgba(26,18,14,0.88)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.97, cy + 6);
    ctx.bezierCurveTo(cx - hw * 0.60, cy - hh * 0.96, cx + hw * 0.55, cy - hh * 0.98, cx + hw * 0.99, cy - 12);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    texCache.set(key, tex);
    return tex;
  }

  ctx.save();
  almond();
  ctx.clip();
  const sclera = ctx.createLinearGradient(cx, cy - hh, cx, cy + hh);
  sclera.addColorStop(0, '#a9b1ba');
  sclera.addColorStop(0.30, '#e3e7ea');
  sclera.addColorStop(0.66, '#f6f4f1');
  sclera.addColorStop(1, '#d8cec8');
  ctx.fillStyle = sclera;
  ctx.fillRect(0, 0, W, H);

  const base = new THREE.Color(IRIS_COLORS[idx % IRIS_COLORS.length]);
  const light = base.clone().offsetHSL(0, 0.05, 0.20);
  const dark = base.clone().offsetHSL(0, 0, -0.12);
  const ir = 82;
  const ig = ctx.createRadialGradient(cx, cy + 2, ir * 0.15, cx, cy + 2, ir);
  ig.addColorStop(0, `#${light.getHexString()}`);
  ig.addColorStop(0.48, `#${base.getHexString()}`);
  ig.addColorStop(0.84, `#${dark.getHexString()}`);
  ig.addColorStop(0.97, '#0b1116');
  ig.addColorStop(1, 'rgba(8,12,16,0.1)');
  ctx.beginPath();
  ctx.arc(cx, cy + 2, ir, 0, Math.PI * 2);
  ctx.fillStyle = ig;
  ctx.fill();

  ctx.globalAlpha = 0.26;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    ctx.strokeStyle = i % 2 ? `#${light.getHexString()}` : `#${dark.getHexString()}`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * ir * 0.32, cy + 2 + Math.sin(a) * ir * 0.32);
    ctx.lineTo(cx + Math.cos(a) * ir * 0.94, cy + 2 + Math.sin(a) * ir * 0.94);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const pg = ctx.createRadialGradient(cx, cy + 2, 3, cx, cy + 2, 33);
  pg.addColorStop(0, '#05070a');
  pg.addColorStop(0.84, '#05070a');
  pg.addColorStop(1, 'rgba(10,14,20,0)');
  ctx.beginPath();
  ctx.arc(cx, cy + 2, 33, 0, Math.PI * 2);
  ctx.fillStyle = pg;
  ctx.fill();

  const lidShadow = ctx.createLinearGradient(cx, cy - hh, cx, cy - hh * 0.1);
  lidShadow.addColorStop(0, 'rgba(22,16,22,0.58)');
  lidShadow.addColorStop(0.6, 'rgba(28,22,28,0.16)');
  lidShadow.addColorStop(1, 'rgba(28,22,28,0)');
  ctx.fillStyle = lidShadow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // wet catchlights
  ctx.beginPath();
  ctx.ellipse(cx - 28, cy - 24, 16, 12, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + 32, cy + 28, 8, 6, 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.fill();

  // upper lash line, heavier towards the outer corner
  ctx.save();
  almond();
  ctx.clip();
  ctx.strokeStyle = 'rgba(20,14,12,0.94)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const x0 = cx - hw + t * hw * 2;
    const lidY = cy - hh * (0.16 + Math.sin(t * Math.PI) * 0.90) - (t - 0.5) * 20;
    ctx.lineWidth = 3 + Math.sin(t * Math.PI) * 8 + t * 3;
    ctx.beginPath();
    ctx.moveTo(x0, lidY - 6);
    ctx.lineTo(x0 + 6, lidY + 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(22,15,12,0.85)';
  for (let i = 0; i < 13; i++) {
    const t = 0.08 + (i / 12) * 0.86;
    const x0 = cx - hw + t * hw * 2;
    const lidY = cy - hh * (0.16 + Math.sin(t * Math.PI) * 0.90) - (t - 0.5) * 20;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x0, lidY);
    ctx.quadraticCurveTo(x0 + 8, lidY - 11, x0 + 18, lidY - 17);
    ctx.stroke();
  }
  // lower lash margin
  ctx.strokeStyle = 'rgba(70,44,40,0.40)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.92, cy + hh * 0.34);
  ctx.bezierCurveTo(cx - hw * 0.5, cy + hh * 0.94, cx + hw * 0.45, cy + hh * 0.92, cx + hw * 0.94, cy);
  ctx.stroke();
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// Mouth decal: a soft closed smile with shaded lips, transparent elsewhere.
function mouthTexture() {
  const key = 'mouth';
  if (texCache.has(key)) return texCache.get(key);
  const W = 512, H = 288;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const cx = W / 2, cy = H * 0.56;

  // upper lip
  ctx.beginPath();
  ctx.moveTo(cx - 190, cy - 2);
  ctx.bezierCurveTo(cx - 120, cy - 44, cx - 40, cy - 46, cx - 6, cy - 20);
  ctx.bezierCurveTo(cx - 2, cy - 16, cx + 2, cy - 16, cx + 6, cy - 20);
  ctx.bezierCurveTo(cx + 40, cy - 46, cx + 120, cy - 44, cx + 190, cy - 2);
  ctx.bezierCurveTo(cx + 120, cy + 4, cx - 120, cy + 4, cx - 190, cy - 2);
  ctx.closePath();
  const upGrad = ctx.createLinearGradient(0, cy - 48, 0, cy + 4);
  upGrad.addColorStop(0, 'rgba(196,124,112,0.34)');
  upGrad.addColorStop(0.7, 'rgba(178,104,94,0.52)');
  upGrad.addColorStop(1, 'rgba(150,78,72,0.62)');
  ctx.fillStyle = upGrad;
  ctx.fill();

  // lower lip
  ctx.beginPath();
  ctx.moveTo(cx - 186, cy + 2);
  ctx.bezierCurveTo(cx - 110, cy + 30, cx + 110, cy + 30, cx + 186, cy + 2);
  ctx.bezierCurveTo(cx + 110, cy + 74, cx - 110, cy + 74, cx - 186, cy + 2);
  ctx.closePath();
  const lowGrad = ctx.createLinearGradient(0, cy + 2, 0, cy + 72);
  lowGrad.addColorStop(0, 'rgba(158,86,80,0.62)');
  lowGrad.addColorStop(0.55, 'rgba(212,140,126,0.46)');
  lowGrad.addColorStop(1, 'rgba(196,124,112,0.08)');
  ctx.fillStyle = lowGrad;
  ctx.fill();

  // smile line
  ctx.strokeStyle = 'rgba(78,38,32,0.82)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 5.5;
  ctx.beginPath();
  ctx.moveTo(cx - 186, cy - 6);
  ctx.bezierCurveTo(cx - 110, cy + 22, cx + 110, cy + 22, cx + 186, cy - 6);
  ctx.stroke();

  // corner dimples
  for (const s of [-1, 1]) {
    ctx.fillStyle = 'rgba(96,48,44,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx + s * 190, cy + 2, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// Hair cap: a grid wrapped onto the skull that opens for the face. The bottom
// edge rises at the temples and drops at the nape, so the hairline is a curve
// rather than the rectangular patch a sphere segment leaves behind.
function hairGeometry() {
  const COLS = 46, ROWS = 12;
  const GAP = Math.PI * 1.28;                 // short hair: the back of the head only
  const start = Math.PI * 1.5 + GAP / 2;
  const span = Math.PI * 2 - GAP;
  const RX = HEAD_W + 0.0040, RY = HEAD_H + 0.0052, RZ = HEAD_D + 0.0046;
  const pos = [], idx = [];
  for (let i = 0; i <= COLS; i++) {
    const u = i / COLS;
    const phi = start + u * span;
    // The edge runs down exactly behind the ears, so the ear covers the seam,
    // and the hair sinks to the nape at the back of the head.
    const t = Math.abs(u - 0.5) * 2;                       // 0 nape .. 1 edge
    const yBot = -0.028 - 0.030 * Math.pow(1 - t, 1.2);
    const thetaBot = Math.acos(Math.max(-1, Math.min(1, yBot / RY)));
    const thetaTop = Math.acos(0.098 / RY);   // tucked inside the hat
    for (let j = 0; j <= ROWS; j++) {
      const theta = thetaTop + (thetaBot - thetaTop) * (j / ROWS);
      const st = Math.sin(theta);
      pos.push(-Math.cos(phi) * st * RX, Math.cos(theta) * RY, Math.sin(phi) * st * RZ);
    }
  }
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const a = i * (ROWS + 1) + j, b = a + ROWS + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const fabricNormal = () => normalTexture('fabric', 256, fabricH, 2.6);
const knitNormal = () => normalTexture('knit', 256, knitH, 3.0);
const leatherNormal = () => normalTexture('leather', 256, leatherH, 2.2);
const denimNormal = () => normalTexture('denim', 256, denimH, 2.0);
const skinNormal = () => normalTexture('skin', 128, skinH, 1.1);

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
const matCache = new Map();

function materialsFor(idx) {
  if (matCache.has(idx)) return matCache.get(idx);
  const jacketColor = JACKETS[idx % JACKETS.length];
  const scarfColor = SCARVES[idx % SCARVES.length];
  const skinColor = SKIN_TONES[idx % SKIN_TONES.length];
  const hairColor = HAIR_COLORS[idx % HAIR_COLORS.length];

  const m = {
    jacket: new THREE.MeshPhysicalMaterial({
      color: jacketColor, roughness: 0.88, metalness: 0,
      normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.42, 0.42),
      sheen: 0.3, sheenRoughness: 0.86, sheenColor: new THREE.Color(0x8d9baa),
      envMapIntensity: 0.5
    }),
    jacketDark: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(jacketColor).multiplyScalar(0.92), roughness: 0.9, metalness: 0,
      normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.38, 0.38),
      sheen: 0.24, sheenRoughness: 0.9, envMapIntensity: 0.42
    }),
    pants: new THREE.MeshStandardMaterial({
      color: 0x2a3340, roughness: 0.93, metalness: 0,
      normalMap: denimNormal(), normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 0.35
    }),
    scarf: new THREE.MeshPhysicalMaterial({
      color: scarfColor, roughness: 0.97, metalness: 0,
      normalMap: knitNormal(), normalScale: new THREE.Vector2(0.85, 0.85),
      sheen: 0.42, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xd6dee6), envMapIntensity: 0.3
    }),
    beanie: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(scarfColor).multiplyScalar(0.86),
      roughness: 0.98, metalness: 0,
      normalMap: knitNormal(), normalScale: new THREE.Vector2(0.9, 0.9),
      sheen: 0.36, sheenRoughness: 0.92, sheenColor: new THREE.Color(0xd6dee6), envMapIntensity: 0.26
    }),
    // Skin reads much more human with a touch of sheen and a warm subsurface tint
    skin: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(skinColor).multiplyScalar(0.94), roughness: 0.62, metalness: 0,
      normalMap: skinNormal(), normalScale: new THREE.Vector2(0.06, 0.06),
      sheen: 0.5, sheenRoughness: 0.72, sheenColor: new THREE.Color(0xf0b49c),
      clearcoat: 0.05, clearcoatRoughness: 0.7, envMapIntensity: 0.42
    }),
    // the sculpted head carries its own albedo; decals add eyes and mouth
    face: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(skinColor).multiplyScalar(0.98), roughness: 0.6, metalness: 0,
      map: faceAlbedo(idx),
      normalMap: skinNormal(), normalScale: new THREE.Vector2(0.09, 0.09),
      sheen: 0.16, sheenRoughness: 0.82, sheenColor: new THREE.Color(0xf3bcab),
      envMapIntensity: 0.3
    }),
    eyeOpen: new THREE.MeshPhysicalMaterial({
      map: eyeTexture(idx, true), transparent: true, roughness: 0.25, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.9,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide
    }),
    eyeClosed: new THREE.MeshStandardMaterial({
      map: eyeTexture(idx, false), transparent: true, roughness: 0.6, metalness: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide
    }),
    mouth: new THREE.MeshStandardMaterial({
      map: mouthTexture(), transparent: true, roughness: 0.45, metalness: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide
    }),
    skinShadow: new THREE.MeshStandardMaterial({
      color: new THREE.Color(skinColor).multiplyScalar(0.78), roughness: 0.7, metalness: 0,
      envMapIntensity: 0.2
    }),
    skinRed: new THREE.MeshStandardMaterial({
      color: new THREE.Color(skinColor).lerp(new THREE.Color(0xd0664f), 0.24),
      roughness: 0.6, metalness: 0, envMapIntensity: 0.3
    }),
    brow: new THREE.MeshStandardMaterial({
      color: new THREE.Color(HAIR_COLORS[idx % HAIR_COLORS.length]).offsetHSL(0, 0.10, 0.15),
      roughness: 0.85, metalness: 0
    }),
    hair: new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.85, metalness: 0 }),
    leather: new THREE.MeshPhysicalMaterial({
      color: 0x1d2126, roughness: 0.58, metalness: 0.04,
      normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.7, 0.7),
      clearcoat: 0.35, clearcoatRoughness: 0.55, envMapIntensity: 0.9
    }),
    boot: new THREE.MeshPhysicalMaterial({
      color: 0x191d21, roughness: 0.66, metalness: 0.03,
      normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.6
    }),
    sole: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.85, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.32, metalness: 0.9, envMapIntensity: 1.2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.62, metalness: 0.08, envMapIntensity: 0.6 }),
    lens: new THREE.MeshPhysicalMaterial({
      color: 0x8fc6e6, roughness: 0.06, metalness: 0.2,
      clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.0,
      transparent: true, opacity: 0.85
    }),
    snow: new THREE.MeshStandardMaterial({ color: 0xf7fbff, roughness: 0.7, metalness: 0, envMapIntensity: 0.75 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.25, metalness: 0 }),
    iris: new THREE.MeshStandardMaterial({ color: 0x3b4d59, roughness: 0.12, metalness: 0.1, envMapIntensity: 1.6 }),
    pupil: new THREE.MeshStandardMaterial({ color: 0x05080b, roughness: 0.2, metalness: 0 }),
    lip: new THREE.MeshStandardMaterial({ color: new THREE.Color(skinColor).lerp(new THREE.Color(0x7a332c), 0.82), roughness: 0.48 }),
    lipDark: new THREE.MeshStandardMaterial({ color: 0x5c2a26, roughness: 0.55 })
  };
  matCache.set(idx, m);
  return m;
}

function add(parent, geo, material, pos, rot, scale) {
  const mesh = new THREE.Mesh(geo, material);
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.geometry.computeBoundingSphere();
  // only chunky parts cast shadows — tiny rivets and fingers would just cost frames
  mesh.castShadow = mesh.geometry.boundingSphere.radius > 0.055;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------
export function createCharacter(colorIdx) {
  const m = materialsFor(colorIdx);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  // ---- pelvis / trousers -----------------------------------------------
  add(hips, new THREE.CapsuleGeometry(0.145, 0.12, 4, 14), m.pants, [0, 0.01, 0], null, [1.12, 1, 0.82]);
  add(hips, new THREE.BoxGeometry(0.30, 0.07, 0.20), m.leather, [0, 0.10, 0.01]);

  // ---- torso: jacket shell with a tailored silhouette -------------------
  const torsoGroup = new THREE.Group();
  torsoGroup.position.y = 0.02;
  hips.add(torsoGroup);

  const profile = [
    [0.172, -0.06], [0.186, 0.02], [0.191, 0.12], [0.197, 0.24],
    [0.212, 0.34], [0.226, 0.44], [0.221, 0.51], [0.190, 0.56], [0.128, 0.59]
  ].map(p => new THREE.Vector2(p[0], p[1]));
  const torsoGeo = new THREE.LatheGeometry(profile, 20);
  const torso = add(torsoGroup, torsoGeo, m.jacket, [0, 0, 0], null, [1, 1, 0.74]);
  torso.castShadow = true;

  // quilted chest panels
  add(torsoGroup, new THREE.BoxGeometry(0.155, 0.20, 0.03), m.jacketDark, [-0.085, 0.31, -0.155], [0.03, 0, -0.04]);
  add(torsoGroup, new THREE.BoxGeometry(0.155, 0.20, 0.03), m.jacketDark, [0.085, 0.31, -0.155], [0.03, 0, 0.04]);
  // zip
  add(torsoGroup, new THREE.BoxGeometry(0.012, 0.52, 0.012), m.metal, [0, 0.30, -0.163]);
  add(torsoGroup, new THREE.BoxGeometry(0.022, 0.028, 0.014), m.metal, [0, 0.44, -0.172]);
  // hem band + waist drawcord
  add(torsoGroup, new THREE.CylinderGeometry(0.182, 0.178, 0.05, 18, 1, true), m.jacketDark, [0, -0.03, 0], null, [1, 1, 0.78]);
  add(torsoGroup, new THREE.CylinderGeometry(0.186, 0.186, 0.018, 18), m.dark, [0, 0.02, 0], null, [1, 1, 0.78]);
  // collar
  add(torsoGroup, new THREE.CylinderGeometry(0.108, 0.122, 0.075, 16, 1, true), m.jacketDark, [0, 0.575, 0], null, [1, 1, 0.9]);
  // hood bunched behind the neck
  const hood = add(torsoGroup, new THREE.SphereGeometry(0.165, 16, 12), m.jacket, [0, 0.545, 0.115], [0.25, 0, 0], [1.05, 0.86, 0.72]);
  hood.receiveShadow = true;
  // backpack + straps
  add(torsoGroup, new THREE.BoxGeometry(0.24, 0.28, 0.11), m.jacketDark, [0, 0.29, 0.165], [0.05, 0, 0]);
  add(torsoGroup, new THREE.BoxGeometry(0.20, 0.045, 0.10), m.leather, [0, 0.415, 0.17], [0.05, 0, 0]);
  // shoulder straps of the pack
  add(torsoGroup, new THREE.BoxGeometry(0.045, 0.03, 0.22), m.dark, [-0.10, 0.50, 0.02]);
  add(torsoGroup, new THREE.BoxGeometry(0.045, 0.03, 0.22), m.dark, [0.10, 0.50, 0.02]);
  // snow settled on the shoulders and pack
  const dust = [
    [-0.14, 0.545, 0.02, 0.075, 0.02, 0.06],
    [0.13, 0.548, 0.01, 0.065, 0.018, 0.055],
    [0, 0.425, 0.215, 0.075, 0.014, 0.045],
    [0.05, 0.52, 0.12, 0.05, 0.016, 0.045]
  ];
  for (const d of dust) add(torsoGroup, new THREE.SphereGeometry(1, 8, 6), m.snow, [d[0], d[1], d[2]], null, [d[3], d[4], d[5]]);

  // ---- neck / head ------------------------------------------------------
  // One sculpted head. Every feature sits at a measured position: eyes at the
  // socket dents, mouth in the trough, ears at the widest point of the skull.
  const neck = add(hips, new THREE.CylinderGeometry(0.050, 0.058, 0.17, 16), m.skin, [0, 0.680, -0.006]);
  neck.castShadow = false;

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.760, -0.008);
  hips.add(headGroup);

  const headMesh = add(headGroup, headGeometry(), m.face, [0, 0, 0]);
  headMesh.castShadow = true;

  add(headGroup, decalGeometry(0, -0.061, -0.092, 0.076, 0.044, 18, 12), m.mouth);

  const blinkers = [];
  for (const side of [-1, 1]) {
    // eye decal: open and shut share one surface patch so the blink cannot slip
    const patch = decalGeometry(side * 0.037, 0.012, -0.086, 0.054, 0.031, 20, 14);
    const openEye = new THREE.Mesh(patch, m.eyeOpen);
    openEye.renderOrder = 3;
    headGroup.add(openEye);
    const shutEye = new THREE.Mesh(patch, m.eyeClosed);
    shutEye.renderOrder = 4;
    shutEye.visible = false;
    headGroup.add(shutEye);
    blinkers.push({ open: openEye, shut: shutEye });

    // brow: overlapping clumps read as one soft arch, not separate beads
    // brow: one smooth tube following the skull, never a row of beads
    const browPts = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const bx = side * (0.0125 + t * 0.0395);
      const by = 0.0250 + Math.sin(t * Math.PI) * 0.0030 - t * 0.0022;
      const bz = -HEAD_D * Math.sqrt(Math.max(0, 1 - (bx / HEAD_W) ** 2 - (by / HEAD_H) ** 2)) - 0.0020;
      browPts.push(new THREE.Vector3(bx, by, bz));
    }
    add(headGroup, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(browPts), 20, 0.0029, 7, false), m.brow);

    // ear: shell pinched against the skull, shaded bowl inside
    add(headGroup, new THREE.SphereGeometry(0.0210, 14, 12), m.skin,
      [side * 0.1000, 0.001, 0.008], [0.10, side * -0.40, side * 0.05], [0.34, 1.0, 0.78]);
    add(headGroup, new THREE.SphereGeometry(0.0105, 10, 8), m.skinShadow,
      [side * 0.1055, 0.001, -0.003], [0.10, side * -0.40, side * 0.05], [0.34, 0.86, 0.50]);
  }

  add(headGroup, hairGeometry(), m.hair, [0, 0.000, 0]);

  // beanie fitted to the skull: dome from the brow line to the crown
  // One lathed profile: rolled brim, soft fold and a dome that clears the
  // skull by a few millimetres at every height.
  const hatProfile = [
    [0.0900, 0.0612], [0.0924, 0.0634], [0.0932, 0.0694], [0.0920, 0.0787],
    [0.0898, 0.0834], [0.0882, 0.0932], [0.0806, 0.1132], [0.0648, 0.1312],
    [0.0402, 0.1352], [0.0180, 0.1390], [0.0002, 0.1400]
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  add(headGroup, new THREE.LatheGeometry(hatProfile, 34), m.beanie, [0, 0, 0]);
  add(headGroup, new THREE.SphereGeometry(0.0265, 14, 12), m.snow, [0, 0.1382, 0], null, [1, 0.9, 1]);
  // goggles pushed up onto the brim
  add(headGroup, new THREE.TorusGeometry(0.0942, 0.0045, 8, 26), m.dark, [0, 0.0922, 0],
    [Math.PI / 2, 0, 0], [1, 1, 1.04]);
  add(headGroup, new THREE.BoxGeometry(0.070, 0.020, 0.014), m.dark, [0, 0.0907, -0.0900], [-0.26, 0, 0]);
  for (const side of [-1, 1]) {
    add(headGroup, new THREE.CylinderGeometry(0.0185, 0.0185, 0.011, 16), m.lens,
      [side * 0.0225, 0.0917, -0.0945], [Math.PI / 2 - 0.26, 0, 0], [1, 1, 0.94]);
    add(headGroup, new THREE.TorusGeometry(0.0185, 0.0038, 8, 16), m.dark,
      [side * 0.0225, 0.0917, -0.0952], [Math.PI / 2 - 0.26, 0, 0]);
  }

  // ---- scarf ------------------------------------------------------------
  add(headGroup, new THREE.TorusGeometry(0.072, 0.020, 10, 28), m.scarf, [0, -0.126, 0],
    [Math.PI / 2, 0, 0], [1.04, 0.86, 0.94]);
  const scarfTail = new THREE.Group();
  scarfTail.position.set(0.052, -0.148, -0.036);
  headGroup.add(scarfTail);
  add(scarfTail, new THREE.BoxGeometry(0.082, 0.19, 0.034), m.scarf, [0.01, -0.095, 0], [0.06, 0, 0.10]);
  add(scarfTail, new THREE.BoxGeometry(0.074, 0.15, 0.030), m.scarf, [0.028, -0.245, 0.012], [0.02, 0.1, 0.18]);
  add(scarfTail, new THREE.BoxGeometry(0.058, 0.028, 0.028), m.scarf, [0.042, -0.325, 0.020], [0, 0.1, 0.2]);

  // ---- arms -------------------------------------------------------------
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.208, 0.502, 0);
    shoulder.rotation.z = side * 0.06;
    torsoGroup.add(shoulder);

    // shoulder pad
    add(shoulder, new THREE.SphereGeometry(0.058, 16, 12), m.jacket, [side * 0.002, -0.024, 0], null, [1.04, 0.88, 0.96]);
    // upper arm
    add(shoulder, new THREE.CapsuleGeometry(0.059, 0.178, 4, 14), m.jacket, [0, -0.155, 0], null, [1, 1, 0.96]);

    const elbow = new THREE.Group();
    elbow.position.y = -0.30;
    shoulder.add(elbow);
    add(elbow, new THREE.SphereGeometry(0.053, 12, 10), m.jacket, [0, 0, 0], null, [1, 1, 0.96]);
    add(elbow, new THREE.CapsuleGeometry(0.052, 0.168, 4, 14), m.jacket, [0, -0.135, 0], null, [1, 1, 0.94]);
    // knit cuff
    add(elbow, new THREE.CylinderGeometry(0.050, 0.055, 0.052, 14), m.scarf, [0, -0.245, 0]);
    // mitten: one soft palm, a thumb and a knit cuff — cleaner than four fingers
    const hand = new THREE.Group();
    hand.position.y = -0.285;
    elbow.add(hand);
    add(hand, new THREE.CylinderGeometry(0.040, 0.045, 0.032, 16), m.scarf, [0, 0.004, 0]);
    add(hand, new THREE.SphereGeometry(1, 16, 12), m.leather, [0, -0.048, -0.006], [0.06, 0, 0], [0.046, 0.062, 0.036]);
    add(hand, new THREE.SphereGeometry(1, 12, 10), m.leather, [0, -0.098, -0.004], null, [0.030, 0.020, 0.030]);
    add(hand, new THREE.CapsuleGeometry(0.0145, 0.030, 4, 10), m.leather,
      [side * -0.038, -0.052, -0.018], [0.25, 0, side * 0.95]);
    add(hand, new THREE.SphereGeometry(1, 8, 6), m.snow, [0, 0.016, -0.020], null, [0.032, 0.010, 0.020]);
    return { shoulder, elbow, hand };
  }
  const armR = makeArm(1);
  const armL = makeArm(-1);

  // ---- legs -------------------------------------------------------------
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.098, -0.015, 0);
    hips.add(hip);
    add(hip, new THREE.SphereGeometry(0.095, 14, 11), m.pants, [0, 0, 0], null, [1, 1, 0.98]);
    add(hip, new THREE.CapsuleGeometry(0.092, 0.235, 4, 12), m.pants, [0, -0.195, 0], null, [1, 1, 0.95]);

    const knee = new THREE.Group();
    knee.position.y = -0.415;
    hip.add(knee);
    // a full joint ball keeps the knee sealed at any bend angle
    add(knee, new THREE.SphereGeometry(0.086, 14, 11), m.pants, [0, 0.004, -0.004], null, [1, 0.96, 0.98]);
    add(knee, new THREE.CapsuleGeometry(0.075, 0.205, 4, 12), m.pants, [0, -0.155, 0], null, [1, 1, 0.94]);
    // boot: shaft, rounded toe, thick sole, instep strap
    const foot = new THREE.Group();
    foot.position.y = -0.315;
    knee.add(foot);
    add(foot, new THREE.CylinderGeometry(1, 1.06, 0.105, 16), m.boot, [0, -0.028, -0.004], null, [0.056, 1, 0.062]);
    add(foot, new THREE.SphereGeometry(1, 16, 12), m.boot, [0, -0.060, -0.035], null, [0.062, 0.048, 0.105]);
    add(foot, new THREE.SphereGeometry(1, 14, 10), m.boot, [0, -0.062, -0.120], null, [0.054, 0.040, 0.050]);
    add(foot, new THREE.BoxGeometry(0.120, 0.034, 0.255), m.sole, [0, -0.098, -0.058]);
    add(foot, new THREE.BoxGeometry(0.110, 0.026, 0.062), m.sole, [0, -0.092, -0.184]);
    add(foot, new THREE.CylinderGeometry(0.060, 0.064, 0.046, 16), m.leather, [0, 0.014, 0]);
    add(foot, new THREE.BoxGeometry(0.106, 0.014, 0.044), m.leather, [0, -0.038, -0.056], [0.35, 0, 0]);
    add(foot, new THREE.BoxGeometry(0.092, 0.014, 0.050), m.snow, [0, -0.048, -0.152], [0.1, 0, 0]);
    return { hip, knee, foot };
  }
  const legR = makeLeg(1);
  const legL = makeLeg(-1);

  // snowball held during the wind-up
  const heldBall = new THREE.Group();
  heldBall.visible = false;
  armR.hand.add(heldBall);
  heldBall.position.set(0, -0.10, -0.02);
  const ballCore = add(heldBall, new THREE.IcosahedronGeometry(0.092, 2), m.snow, [0, 0, 0]);
  ballCore.castShadow = true;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.055 + Math.random() * 0.04;
    add(heldBall, new THREE.SphereGeometry(0.022 + Math.random() * 0.016, 6, 5), m.snow,
      [Math.cos(a) * r, (Math.random() - 0.5) * 0.10, Math.sin(a) * r]);
  }

  const state = {
    root, colorIdx,
    phase: Math.random() * 10,
    time: Math.random() * 20,
    blinkT: 1.2 + Math.random() * 4,
    blinkPhase: 0,
    throwT: 0,
    deadProgress: 0,
    deadSide: Math.random() < 0.5 ? -1 : 1,
    moveBlend: 0,
    yawPrev: 0,
    turnVel: 0,
    hitT: 0,
    hitK: 1,
    heldBall,
    torsoGroup, headGroup,
    armR, armL, legR, legL,
    scarfTail
  };

  function triggerThrow() { state.throwT = 0.0001; }
  function setHeldBall(v) { heldBall.visible = !!v; }
  // flinch when a snowball connects
  function hit(strength = 1) {
    state.hitT = 0.0001;
    state.hitK = Math.min(1.5, Math.max(0.4, strength));
  }

  // Throw animation as key poses: coil away from the target, snap through,
  // then overshoot and settle. Poses are blended instead of switched, so the
  // motion keeps its weight at any frame rate.
  const THROW_KEYS = [
    { t: 0.00, ty: 0.00, tx: 0.00, rx: 0.00, rz: 0.00, re: -0.32, rw: 0.00, lx: 0.00, lz: 0.00, dip: 0.000 },
    { t: 0.16, ty: -0.46, tx: -0.07, rx: 1.45, rz: 0.36, re: -1.75, rw: -0.58, lx: -0.42, lz: -0.20, dip: -0.040 },
    { t: 0.33, ty: 0.36, tx: 0.18, rx: -2.10, rz: -0.12, re: -0.22, rw: 0.64, lx: 0.62, lz: 0.32, dip: 0.014 },
    { t: 0.56, ty: 0.25, tx: 0.24, rx: -1.32, rz: -0.30, re: -0.54, rw: 0.30, lx: 0.34, lz: 0.42, dip: 0.008 },
    { t: 1.00, ty: 0.00, tx: 0.00, rx: 0.00, rz: 0.00, re: -0.32, rw: 0.00, lx: 0.00, lz: 0.00, dip: 0.000 }
  ];
  const throwPose = { ty: 0, tx: 0, rx: 0, rz: 0, re: 0, rw: 0, lx: 0, lz: 0, dip: 0 };
  function sampleThrow(t) {
    let a = THROW_KEYS[0], b = THROW_KEYS[1];
    for (let i = 0; i < THROW_KEYS.length - 1; i++) {
      if (t >= THROW_KEYS[i].t && t <= THROW_KEYS[i + 1].t) { a = THROW_KEYS[i]; b = THROW_KEYS[i + 1]; break; }
    }
    let k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    k = k * k * (3 - 2 * k);
    for (const key of ['ty', 'tx', 'rx', 'rz', 're', 'rw', 'lx', 'lz', 'dip']) {
      throwPose[key] = a[key] + (b[key] - a[key]) * k;
    }
    return throwPose;
  }

  function update(dt, opts) {
    const { yaw = 0, pitch = 0, moving = false, sprinting = false, dead = false } = opts || {};
    state.time += dt;

    // occasional blink keeps the face alive instead of staring
    if (!dead) {
      state.blinkT -= dt;
      if (state.blinkT <= 0) { state.blinkT = 2.2 + Math.random() * 4.8; state.blinkPhase = 0.0001; }
      if (state.blinkPhase > 0) {
        state.blinkPhase += dt / 0.16;
        const shut = state.blinkPhase < 0.8;
        for (const b of blinkers) { b.shut.visible = shut; b.open.visible = !shut; }
        if (state.blinkPhase >= 1) state.blinkPhase = 0;
      }
    }

    // eased locomotion blend so walking in and out of a run never pops
    const target = dead ? 0 : (moving ? (sprinting ? 1 : 0.58) : 0);
    state.moveBlend += (target - state.moveBlend) * Math.min(1, dt * 8);
    const amp = state.moveBlend;

    // lean into turns
    let dYaw = yaw - state.yawPrev;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    state.yawPrev = yaw;
    const turnVel = dt > 0.0001 ? dYaw / dt : 0;
    state.turnVel += (turnVel - state.turnVel) * Math.min(1, dt * 6);
    const lean = Math.max(-1, Math.min(1, state.turnVel * 0.10));

    root.rotation.y = yaw;
    headGroup.rotation.x = Math.max(-0.5, Math.min(0.5, pitch * 0.6));

    if (dead) {
      state.deadProgress = Math.min(1, state.deadProgress + dt * 1.9);
      const p = state.deadProgress;
      const ease = 1 - Math.pow(1 - p, 3);
      // knees buckle first, then the body tips over sideways
      const buckle = Math.min(1, p * 2.2);
      root.rotation.x = ease * 0.95;
      root.rotation.z = ease * 0.55 * state.deadSide;
      hips.position.y = 0.92 - buckle * 0.34;
      legL.hip.rotation.x = -buckle * 0.85;
      legR.hip.rotation.x = -buckle * 0.55;
      legL.knee.rotation.x = buckle * 1.15;
      legR.knee.rotation.x = buckle * 0.75;
      armR.shoulder.rotation.x = -ease * 1.5;
      armR.shoulder.rotation.z = -ease * 0.5;
      armL.shoulder.rotation.x = -ease * 0.8;
      armL.shoulder.rotation.z = ease * 0.7;
      armR.elbow.rotation.x = -0.4 + ease * 0.5;
      armL.elbow.rotation.x = -0.4;
      torsoGroup.rotation.y = ease * 0.25 * state.deadSide;
      headGroup.rotation.x = ease * 0.35;
      headGroup.rotation.y = 0;
      return;
    }

    state.deadProgress = 0;
    root.rotation.x = 0;
    root.rotation.z = 0;

    // --- gait -------------------------------------------------------------
    state.phase += dt * (sprinting ? 13.6 : 9.4) * Math.max(0.28, amp);
    const sp = Math.sin(state.phase);
    const cp = Math.cos(state.phase);
    const stride = (0.60 + 0.20 * amp) * amp;

    legL.hip.rotation.x = sp * stride;
    legR.hip.rotation.x = -sp * stride;
    // knees fold on the swing leg and straighten into the plant
    const fold = (1.0 + 0.5 * amp) * amp;
    legL.knee.rotation.x = -Math.max(0, -Math.sin(state.phase - 0.5)) * fold;
    legR.knee.rotation.x = -Math.max(0, Math.sin(state.phase - 0.5)) * fold;
    // heel strike, flat plant, toe off
    legL.foot.rotation.x = (Math.max(0, cp) * 0.26 - Math.max(0, -cp) * 0.30) * amp;
    legR.foot.rotation.x = (Math.max(0, -cp) * 0.26 - Math.max(0, cp) * 0.30) * amp;

    // hips: two bounces per stride, rolled towards the planted leg
    hips.position.y = 0.92 + (0.5 - 0.5 * Math.cos(state.phase * 2)) * 0.032 * amp;
    hips.rotation.y = sp * 0.13 * amp;
    hips.rotation.z = sp * 0.045 * amp - lean * 0.10;

    // torso counter-rotates against the hips and leans into the run
    torsoGroup.rotation.y = -sp * 0.20 * amp;
    torsoGroup.rotation.x = (0.05 + 0.10 * amp) * amp;
    torsoGroup.rotation.z = -lean * 0.14;
    torsoGroup.position.y = 0.02 + Math.sin(state.time * 1.7) * 0.004 * (1 - amp);

    // arms swing opposite the legs; elbows fold as they come forward
    armL.shoulder.rotation.x = -sp * (0.50 + 0.60 * amp) * amp;
    armR.shoulder.rotation.x = sp * (0.50 + 0.60 * amp) * amp;
    armL.shoulder.rotation.z = -0.07 - 0.05 * amp;
    armR.shoulder.rotation.z = 0.07 + 0.05 * amp;
    armL.elbow.rotation.x = -0.30 - Math.max(0, -sp) * 0.90 * amp;
    armR.elbow.rotation.x = -0.30 - Math.max(0, sp) * 0.90 * amp;

    // idle: breathing, a slow weight shift and an occasional glance
    const idle = 1 - Math.min(1, amp / 0.15);
    if (idle > 0.001) {
      const breathe = Math.sin(state.time * 1.7) * idle;
      torsoGroup.position.y += breathe * 0.004;
      torsoGroup.rotation.z += Math.sin(state.time * 0.7) * 0.014 * idle;
      hips.position.y += breathe * 0.002;
      armL.shoulder.rotation.x += -breathe * 0.03;
      armR.shoulder.rotation.x += -breathe * 0.03;
      armL.shoulder.rotation.z += breathe * 0.02;
      armR.shoulder.rotation.z -= breathe * 0.02;
    }
    const glance = Math.sin(state.time * 0.31) * Math.sin(state.time * 0.17 + 1.3);
    headGroup.rotation.y = -sp * 0.06 * amp - lean * 0.10 + glance * 0.18 * idle;
    headGroup.rotation.z = sp * 0.03 * amp + lean * 0.05;

    // --- throw ------------------------------------------------------------
    let throwing = false;
    if (state.throwT > 0) {
      state.throwT += dt / 0.60;
      const p = sampleThrow(Math.min(1, state.throwT));
      throwing = true;
      torsoGroup.rotation.y = p.ty;
      torsoGroup.rotation.x = p.tx;
      torsoGroup.rotation.z = 0;
      armR.shoulder.rotation.x = p.rx;
      armR.shoulder.rotation.z = p.rz;
      armR.elbow.rotation.x = p.re;
      armR.hand.rotation.x = p.rw;
      armL.shoulder.rotation.x = p.lx;
      armL.shoulder.rotation.z = p.lz;
      hips.position.y += p.dip;
      hips.rotation.y = p.ty * 0.4;
      if (state.throwT >= 1) { state.throwT = 0; armR.hand.rotation.x = 0; }
    }
    if (!throwing) armR.hand.rotation.x *= Math.max(0, 1 - dt * 14);

    // --- hit flinch -------------------------------------------------------
    if (state.hitT > 0) {
      state.hitT += dt / 0.36;
      const k = Math.sin(Math.min(1, state.hitT) * Math.PI) * state.hitK;
      torsoGroup.rotation.x -= 0.38 * k;
      torsoGroup.rotation.y += 0.22 * k;
      headGroup.rotation.x -= 0.32 * k;
      armL.shoulder.rotation.x -= 0.55 * k;
      armR.shoulder.rotation.x -= 0.45 * k;
      hips.position.y -= 0.03 * k;
      if (state.hitT >= 1) state.hitT = 0;
    }

    // scarf flutter follows speed, turns and the throw
    const flutter = Math.sin(state.time * 3.4) * 0.06 + Math.sin(state.time * 7.1) * 0.02;
    state.scarfTail.rotation.x = -0.05 - (sprinting ? 0.55 : 0.32) * amp - flutter * (0.4 + amp) - lean * 0.15;
    state.scarfTail.rotation.z = flutter * 0.8 + lean * 0.35;
  }

  return { ...state, update, triggerThrow, setHeldBall, hit };
}

// ---------------------------------------------------------------------------
// Name tags
// ---------------------------------------------------------------------------
export function makeNameTag(name, colorIdx) {
  const w = 512, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const label = name.length > 16 ? name.slice(0, 15) + '…' : name;
  ctx.font = '600 50px "Segoe UI", system-ui, sans-serif';
  const tw = Math.min(w - 96, ctx.measureText(label).width);
  const bw = tw + 84, bh = 72;
  const x = (w - bw) / 2, y = (h - bh) / 2;
  const r = 22;

  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, r);
  const grad = ctx.createLinearGradient(x, y, x, y + bh);
  grad.addColorStop(0, 'rgba(12,20,30,0.72)');
  grad.addColorStop(1, 'rgba(6,12,20,0.54)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(214,234,255,0.26)';
  ctx.stroke();

  const col = new THREE.Color(JACKETS[colorIdx % JACKETS.length]).getStyle();
  ctx.beginPath();
  ctx.arc(x + 30, y + bh / 2, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(240,248,255,0.96)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 50, y + bh / 2 + 2, tw);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: true, fog: false, opacity: 0.92
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.02, 0.255, 1);
  sprite.position.y = 1.90;
  sprite.renderOrder = 5;
  return sprite;
}

// ---------------------------------------------------------------------------
// First-person viewmodel: gloved throwing hand + off hand
// ---------------------------------------------------------------------------
export function createViewModel() {
  const m = materialsFor(0);
  const sleeve = new THREE.MeshPhysicalMaterial({
    color: 0x2b3f55, roughness: 0.84, metalness: 0,
    bumpMap: fabricBump(), bumpScale: 0.9,
    sheen: 0.7, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x9fb4c8),
    envMapIntensity: 0.55
  });
  const knit = new THREE.MeshPhysicalMaterial({
    color: 0xb4482f, roughness: 0.94, metalness: 0,
    bumpMap: knitBump(), bumpScale: 1.5,
    sheen: 1, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xffffff)
  });
  const glove = new THREE.MeshPhysicalMaterial({
    color: 0x22272d, roughness: 0.6, metalness: 0.03,
    bumpMap: leatherBump(), bumpScale: 1.1,
    clearcoat: 0.4, clearcoatRoughness: 0.5, envMapIntensity: 0.9
  });
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xf7fbff, roughness: 0.62, metalness: 0, envMapIntensity: 0.9
  });
  const frostMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, transparent: true, opacity: 0.7 });

  const group = new THREE.Group();

  // throwing arm
  const armPivot = new THREE.Group();
  armPivot.position.set(0.52, -0.58, -0.82);
  group.add(armPivot);

  const forearm = add(armPivot, new THREE.CapsuleGeometry(0.072, 0.30, 4, 14), sleeve,
    [0, -0.10, -0.05], [-1.18, 0.22, 0.22]);
  forearm.castShadow = false;
  const cuff = add(armPivot, new THREE.CylinderGeometry(0.076, 0.082, 0.055, 14), knit,
    [-0.035, 0.015, -0.185], [-1.05, 0.18, 0.18]);
  cuff.castShadow = false;
  add(armPivot, new THREE.SphereGeometry(0.010, 6, 6), frostMat, [-0.055, 0.06, -0.22]);

  const hand = new THREE.Group();
  hand.position.set(-0.052, 0.055, -0.235);
  armPivot.add(hand);

  const palm = add(hand, new THREE.CapsuleGeometry(0.060, 0.082, 4, 14), glove, [0, 0, -0.02], [-1.22, 0.10, 0.16]);
  palm.castShadow = false;
  add(hand, new THREE.SphereGeometry(0.056, 14, 12), glove, [0.006, 0.026, -0.058], null, [1.05, 0.68, 0.95]);
  // knuckle ridge + tendon bumps so the glove reads as a real hand
  for (let i = 0; i < 4; i++) {
    add(hand, new THREE.SphereGeometry(0.0135, 8, 6), glove, [0.040 - i * 0.024, 0.030, -0.086], null, [1.1, 0.85, 1]);
  }
  const thumb = add(hand, new THREE.CapsuleGeometry(0.026, 0.050, 4, 10), glove,
    [-0.074, 0.014, -0.030], [0.35, 0, 0.75]);
  thumb.castShadow = false;
  add(hand, new THREE.CapsuleGeometry(0.021, 0.026, 3, 8), glove, [-0.090, 0.036, -0.054], [0.9, 0.2, 0.6]);
  // fingers wrap around the ball: two phalanges each with a rounded pad
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.position.set(0.042 - i * 0.024, -0.020 - i * 0.003, -0.076 + i * 0.007);
    g.rotation.set(1.15, 0, 0.10);
    hand.add(g);
    add(g, new THREE.CapsuleGeometry(0.0165, 0.032, 3, 8), glove, [0, -0.026, 0]);
    add(g, new THREE.CapsuleGeometry(0.0145, 0.022, 3, 8), glove, [0, -0.060, 0.010], [0.55, 0, 0]);
    add(g, new THREE.SphereGeometry(0.0135, 8, 6), glove, [0, -0.076, 0.016], null, [1, 0.9, 1]);
    fingers.push(g);
  }

  // snowball with clumps
  const ball = new THREE.Group();
  hand.add(ball);
  ball.position.set(0, 0.055, -0.115);
  const core = add(ball, new THREE.IcosahedronGeometry(0.094, 2), snowMat, [0, 0, 0]);
  core.castShadow = false;
  const clumps = [];
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.055 + Math.random() * 0.045;
    clumps.push(add(ball, new THREE.SphereGeometry(0.020 + Math.random() * 0.018, 7, 6), snowMat,
      [Math.cos(a) * r, (Math.random() - 0.5) * 0.10, Math.sin(a) * r]));
  }
  ball.visible = false;

  // off hand, low and open for balance
  const left = new THREE.Group();
  left.position.set(-0.60, -0.62, -0.88);
  left.rotation.set(-0.42, 0.55, -0.30);
  group.add(left);
  const lPalm = add(left, new THREE.CapsuleGeometry(0.056, 0.062, 4, 14), glove, [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 0.78]);
  lPalm.castShadow = false;
  add(left, new THREE.SphereGeometry(0.050, 12, 10), glove, [0, -0.006, -0.038], null, [1.1, 0.72, 1]);
  for (let i = 0; i < 4; i++) {
    add(left, new THREE.CapsuleGeometry(0.017, 0.045, 3, 8), glove,
      [-0.045 + i * 0.030, -0.012, -0.105], [0.55, 0, 0]);
  }
  add(left, new THREE.CapsuleGeometry(0.024, 0.045, 3, 8), glove, [0.078, 0.006, -0.055], [0.2, 0, -0.7]);
  add(left, new THREE.CapsuleGeometry(0.070, 0.30, 4, 14), sleeve, [-0.005, -0.10, 0.115], [-0.62, 0, 0.08]);
  add(left, new THREE.CylinderGeometry(0.074, 0.080, 0.05, 12), knit, [0.004, 0.012, 0.038], [-0.55, 0, 0.08]);
  add(left, new THREE.SphereGeometry(0.009, 6, 6), frostMat, [0.02, 0.055, -0.02]);

  let throwT = 0;
  let bobPhase = 0;
  let charge = 0;
  let chargeTarget = 0;
  let openAmount = 0;

  function throwBall() { throwT = 0.001; }

  function update(dt, { speed = 0, sprinting = false, charging = 0, swayX = 0, swayY = 0, grounded = true } = {}) {
    chargeTarget = charging;
    charge += (chargeTarget - charge) * Math.min(1, dt * 12);

    bobPhase += dt * (sprinting ? 12.6 : 7.6) * Math.min(1, speed / 4);
    const bobAmt = Math.min(1, speed / 5.2);
    const bobX = Math.sin(bobPhase) * 0.019 * bobAmt;
    const bobY = Math.abs(Math.cos(bobPhase)) * 0.021 * bobAmt;
    const bobZ = Math.sin(bobPhase * 2) * 0.012 * bobAmt;

    throwT = throwT > 0 ? throwT + dt / 0.44 : 0;
    if (throwT > 1) throwT = 0;

    // wind-up, snap, then let the arm keep travelling past neutral
    let throwX = 0, throwY = 0, throwZ = 0, throwRoll = 0, throwPitch = 0;
    const ease = (a, b, k) => a + (b - a) * Math.min(1, Math.max(0, k * k * (3 - 2 * k)));
    if (throwT > 0) {
      const t = throwT;
      if (t < 0.22) {
        const k = t / 0.22;
        throwZ = ease(0, 0.10, k); throwY = ease(0, 0.05, k); throwPitch = ease(0, 0.38, k);
      } else if (t < 0.45) {
        const k = 1 - Math.pow(1 - (t - 0.22) / 0.23, 2.2);
        throwZ = 0.10 - 0.44 * k; throwY = 0.05 + 0.27 * k;
        throwX = 0.17 * k; throwRoll = -0.55 * k; throwPitch = 0.38 - 1.05 * k;
      } else {
        const k = (t - 0.45) / 0.55;
        const e = k * k * (3 - 2 * k);
        throwZ = -0.34 * (1 - e); throwY = 0.32 * (1 - e);
        throwX = 0.17 * (1 - e); throwRoll = -0.55 * (1 - e); throwPitch = -0.67 * (1 - e);
      }
    }

    const tremble = charge > 0.9 ? (Math.random() - 0.5) * 0.006 * (charge - 0.9) * 10 : 0;
    const chargePull = charge * 0.095;
    const breathe = Math.sin(performance.now() * 0.0015) * 0.004;

    group.position.set(
      bobX + swayX * 0.0055 - chargePull * 0.32 - throwX + tremble,
      -bobY + swayY * 0.0048 + breathe + throwY - chargePull,
      chargePull * 0.85 + throwZ + bobZ
    );
    group.rotation.set(
      -swayY * 0.018 - charge * 0.045 + throwY * 0.38 + throwPitch,
      swayX * 0.028,
      charge * 0.11 + throwX * 0.75 + throwRoll
    );

    if (!grounded) {
      group.position.y -= 0.028;
      group.rotation.x += 0.028;
    }

    // hand opens on release, fingers curl while charging
    const releaseOpen = throwT > 0.3 && throwT < 0.7 ? 1 : 0;
    openAmount += ((releaseOpen ? 1 : 0) - openAmount) * Math.min(1, dt * 16);
    const curl = 1.15 - charge * 0.25 + openAmount * 0.75;
    for (const f of fingers) f.rotation.x = curl;

    ball.visible = !(throwT > 0.26 && throwT < 0.82);
    const s = 0.62 + charge * 0.46;
    // squeeze the snow as the grip tightens, stretch it on release
    const stretch = throwT > 0.26 && throwT < 0.5 ? (1 - (throwT - 0.26) / 0.24) * 0.10 : 0;
    ball.scale.set(s * (1 - charge * 0.04 - stretch * 0.3), s * (1 + charge * 0.06 + stretch), s * (1 - charge * 0.04));
    ball.position.z = -0.115 - charge * 0.03;
    ball.position.y = 0.055 - charge * 0.012;
    ball.rotation.set(charge * 2.6, charge * 1.7, 0);

    // arm pulls back and down as the throw charges
    armPivot.rotation.set(charge * 0.10, 0, 0);
    armPivot.position.set(
      0.52 - charge * 0.035 + swayX * 0.002,
      -0.58 - charge * 0.035 + swayY * 0.002,
      -0.82 + charge * 0.045
    );

    // off hand braces slightly during the wind-up, drops away on release
    left.rotation.z = -0.30 + Math.sin(bobPhase * 0.5) * 0.02 * bobAmt + charge * 0.14;
    left.rotation.x = -0.42 + charge * 0.10 - (throwT > 0.2 ? 0.18 * Math.sin(Math.min(1, throwT) * Math.PI) : 0);
    left.position.y = -0.62 + bobY * 0.4 + charge * 0.035;
    left.position.x = -0.60 + charge * 0.025;
  }

  function setVisible(v) { group.visible = v; }

  return { group, update, throwBall, setVisible };
}
