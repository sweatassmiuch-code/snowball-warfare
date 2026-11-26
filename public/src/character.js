// Player characters + first-person viewmodel.
// Everything is procedural: anatomy, layered winter gear, cloth/leather/knit
// micro-detail from canvas bump maps, snow dusting and articulated animation.
import * as THREE from '../vendor/three.module.js';

// The default look is the reference character: royal-blue jacket and beanie,
// white knit trim, warm light skin and brown hair. The other slots are the
// same design in different colours.
const JACKETS = [0x2f6bd6, 0xd0453a, 0x2f8a63, 0x6b46a8, 0xe0a02c, 0x2b8f9c, 0xd2588c, 0x3a4d72];
const SCARVES = [0xf4f7fb, 0xe9dcc4, 0xd6e7f6, 0xd9edd9, 0xf4d6dd, 0xdfe4ec];
const SKIN_TONES = [0xf4c7a1, 0xe3ac84, 0xc78f68, 0xa46f4d, 0x7c5036, 0xf0d5b8];
const HAIR_COLORS = [0x6d4527, 0x452c1b, 0x8b5a30, 0x2a1a11, 0xb07a45, 0x52331f];
const IRIS_COLORS = [0x3a2a1e, 0x2d3a44, 0x3d3222, 0x2a2018, 0x4a3a28, 0x33302c];
// Hats get their own rack: knit colours that read apart from the trim.
const HAT_COLORS = [0x2f6bd6, 0xd0453a, 0xe0a02c, 0x2f8a63, 0x8e97a3, 0x6b46a8];

export const LOOK_PALETTES = {
  jacket: JACKETS, scarf: SCARVES, hat: HAT_COLORS, skin: SKIN_TONES,
  names: {
    jacket: ['Blau', 'Rot', 'Wald', 'Violett', 'Gelb', 'Petrol', 'Pink', 'Nacht'],
    scarf: ['Weiss', 'Creme', 'Eis', 'Mint', 'Rose', 'Grau'],
    hat: ['Blau', 'Rot', 'Gelb', 'Gruen', 'Grau', 'Violett'],
    skin: ['Hell', 'Warm', 'Braun', 'Dunkel', 'Tief', 'Creme']
  }
};

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
const HEAD_W = 0.100;   // half width  (20.0 cm across)
const HEAD_H = 0.118;   // half height (23.6 cm crown to chin)
const HEAD_D = 0.104;   // half depth  (20.8 cm face to occiput)

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
    p.x *= 1 - 0.26 * t * t;
    p.z *= 1 - 0.06 * t * t;
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

// Cartoon eye: one tall black oval with a wet catchlight. Sclera, iris and
// lashes read as a realistic doll at arm's length; the reference character's
// solid ovals stay readable across the whole map.
function eyeTexture(idx, open) {
  const key = 'eye:' + (open ? 1 : 0);
  if (texCache.has(key)) return texCache.get(key);
  const W = 256, H = 320;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const cx = W / 2, cy = H / 2;

  if (!open) {
    ctx.strokeStyle = '#1b151b';
    ctx.lineCap = 'round';
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(cx - 62, cy + 4);
    ctx.quadraticCurveTo(cx, cy + 30, cx + 62, cy + 4);
    ctx.stroke();
  } else {
    // soft contact shadow so the oval sits inside the face instead of on it
    ctx.save();
    ctx.filter = 'blur(12px)';
    ctx.fillStyle = 'rgba(60,32,26,0.34)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 82, 118, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const g = ctx.createLinearGradient(cx, cy - 116, cx, cy + 116);
    g.addColorStop(0, '#2a2430');
    g.addColorStop(0.42, '#121019');
    g.addColorStop(1, '#05060a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 76, 114, 0, 0, Math.PI * 2);
    ctx.fill();

    // catchlight: the one highlight that makes a flat oval feel wet
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(cx - 24, cy - 46, 13, 19, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// Mouth decal: the small closed smile from the reference sheet.
function mouthTexture() {
  const key = 'mouth:cartoon';
  if (texCache.has(key)) return texCache.get(key);
  const W = 256, H = 160;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.strokeStyle = 'rgba(74,36,30,0.92)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(58, 66);
  ctx.quadraticCurveTo(128, 112, 198, 66);
  ctx.stroke();

  // a soft lower lip keeps the line from reading as a scratch
  ctx.strokeStyle = 'rgba(214,140,124,0.28)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(72, 86);
  ctx.quadraticCurveTo(128, 118, 184, 86);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// Hair cap: one surface wrapped onto the skull from the fringe line to the
// nape. The bottom edge dips at the back and sits high at the front so the
// beanie can hold the fringe down without clipping into the eyes.
function hairGeometry() {
  const COLS = 56, ROWS = 9;
  const RX = HEAD_W + 0.0060, RY = HEAD_H + 0.0074, RZ = HEAD_D + 0.0064;
  const pos = [], idx = [];
  for (let i = 0; i <= COLS; i++) {
    const phi = (i / COLS) * Math.PI * 2;
    const back = (1 - Math.cos(phi - Math.PI * 1.5)) / 2;      // 0 front, 1 back
    const yBot = 0.060 - 0.108 * Math.pow(back, 0.72);
    const thetaBot = Math.acos(Math.max(-1, Math.min(1, yBot / RY)));
    const thetaTop = Math.acos(0.114 / RY);
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
  geo.computeBoundingSphere();
  return geo;
}

// A tapered clump: wide at the scalp, pointed at the tip. Tufts are placed
// around the hairline instead of modelling strands, which keeps the silhouette
// crisp and the mesh count low.
const tuftGeoCache = new Map();
function tuftGeometry(len, rad) {
  const key = len.toFixed(3) + ':' + rad.toFixed(3);
  if (tuftGeoCache.has(key)) return tuftGeoCache.get(key);
  const pts = [];
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = rad * Math.pow(1 - t, 0.72) * (0.86 + 0.14 * Math.sin(t * Math.PI));
    pts.push(new THREE.Vector2(Math.max(0.0008, r), t * len));
  }
  const geo = new THREE.LatheGeometry(pts, 9);
  tuftGeoCache.set(key, geo);
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

function materialsFor(idx, look) {
  // a look overrides single palette slots; anything omitted falls back to the
  // hash index, so old call sites and bots keep working untouched
  const j = look && Number.isInteger(look.j) ? look.j : idx;
  const s = look && Number.isInteger(look.s) ? look.s : idx;
  const k = look && Number.isInteger(look.k) ? look.k : idx;
  const h = look && Number.isInteger(look.h) ? look.h : idx;
  const key = `${j % JACKETS.length}:${s % SCARVES.length}:${k % SKIN_TONES.length}:${h % HAIR_COLORS.length}`;
  if (matCache.has(key)) return matCache.get(key);
  const jacketColor = JACKETS[j % JACKETS.length];
  const scarfColor = SCARVES[s % SCARVES.length];
  const skinColor = SKIN_TONES[k % SKIN_TONES.length];
  const hairColor = HAIR_COLORS[h % HAIR_COLORS.length];

  const m = {
    jacket: new THREE.MeshPhysicalMaterial({
      color: jacketColor, roughness: 0.8, metalness: 0,
      normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.16, 0.16),
      sheen: 0.22, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xa9c2e0),
      envMapIntensity: 0.55
    }),
    jacketDark: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(jacketColor).multiplyScalar(0.92), roughness: 0.9, metalness: 0,
      normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.38, 0.38),
      sheen: 0.24, sheenRoughness: 0.9, envMapIntensity: 0.42
    }),
    pants: new THREE.MeshStandardMaterial({
      color: 0x2b2f42, roughness: 0.9, metalness: 0,
      normalMap: denimNormal(), normalScale: new THREE.Vector2(0.18, 0.18), envMapIntensity: 0.35
    }),
    scarf: new THREE.MeshPhysicalMaterial({
      color: scarfColor, roughness: 0.97, metalness: 0,
      normalMap: knitNormal(), normalScale: new THREE.Vector2(0.85, 0.85),
      sheen: 0.42, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xd6dee6), envMapIntensity: 0.3
    }),
    beanie: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(HAT_COLORS[h % HAT_COLORS.length]).multiplyScalar(0.94),
      roughness: 0.98, metalness: 0,
      normalMap: knitNormal(), normalScale: new THREE.Vector2(0.9, 0.9),
      sheen: 0.36, sheenRoughness: 0.92, sheenColor: new THREE.Color(0xd6dee6), envMapIntensity: 0.26
    }),
    beanieDark: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(HAT_COLORS[h % HAT_COLORS.length]).multiplyScalar(0.8),
      roughness: 0.98, metalness: 0,
      normalMap: knitNormal(), normalScale: new THREE.Vector2(0.9, 0.9),
      sheen: 0.3, sheenRoughness: 0.92, sheenColor: new THREE.Color(0xd6dee6), envMapIntensity: 0.24
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
      map: faceAlbedo(k),
      normalMap: skinNormal(), normalScale: new THREE.Vector2(0.09, 0.09),
      sheen: 0.16, sheenRoughness: 0.82, sheenColor: new THREE.Color(0xf3bcab),
      envMapIntensity: 0.3
    }),
    eyeOpen: new THREE.MeshStandardMaterial({
      map: eyeTexture(k, true), transparent: true, roughness: 0.55, metalness: 0,
      envMapIntensity: 0.25,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide
    }),
    eyeClosed: new THREE.MeshStandardMaterial({
      map: eyeTexture(k, false), transparent: true, roughness: 0.6, metalness: 0,
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
      color: new THREE.Color(hairColor).offsetHSL(0, 0.10, 0.15),
      roughness: 0.85, metalness: 0
    }),
    hair: new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.85, metalness: 0 }),
    mitten: new THREE.MeshPhysicalMaterial({
      color: 0x30333e, roughness: 0.72, metalness: 0,
      normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.18, 0.18),
      sheen: 0.25, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x6f7686), envMapIntensity: 0.5
    }),
    leather: new THREE.MeshPhysicalMaterial({
      color: 0x1d2126, roughness: 0.58, metalness: 0.04,
      normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.7, 0.7),
      clearcoat: 0.35, clearcoatRoughness: 0.55, envMapIntensity: 0.9
    }),
    boot: new THREE.MeshPhysicalMaterial({
      color: 0x2b3040, roughness: 0.7, metalness: 0.03,
      normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.2, 0.2), envMapIntensity: 0.6
    }),
    sole: new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.82, metalness: 0 }),
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
  matCache.set(key, m);
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
// Body construction
// A body assembled from capsules always shows its seams. These two builders
// give one continuous surface instead: a lofted shell for the jacket and
// skinned tubes for the limbs, so an elbow folds the cloth rather than pulling
// two caps apart at a joint ball.
// ---------------------------------------------------------------------------
// A flat strip that follows a curve in the XZ plane: the jacket's white zip.
function ribbonGeometry(points, halfWidth) {
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    pos.push(p.x - halfWidth, p.y, p.z, p.x + halfWidth, p.y, p.z);
    uvs.push(0, i / (points.length - 1), 1, i / (points.length - 1));
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function loftGeometry(sections, radial = 30) {
  const pos = [], uvs = [], idx = [];
  const rows = sections.length;
  for (let i = 0; i < rows; i++) {
    const [y, rx, rz] = sections[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(Math.cos(a) * rx, y, Math.sin(a) * rz);
      uvs.push(j / radial, i / (rows - 1));
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // flat end caps so the shell is watertight from any angle
  const capLo = pos.length / 3;
  pos.push(0, sections[0][0], 0); uvs.push(0.5, 0);
  const capHi = capLo + 1;
  pos.push(0, sections[rows - 1][0], 0); uvs.push(0.5, 1);
  const ringLo = 0, ringHi = (rows - 1) * (radial + 1);
  for (let j = 0; j < radial; j++) {
    idx.push(capLo, ringLo + j + 1, ringLo + j);
    idx.push(capHi, ringHi + j, ringHi + j + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// A loft whose rings can drift sideways: used for boots, where the shaft is
// vertical but the foot has to curve forward.
function ringLoft(rings, radial = 20) {
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i < rings.length; i++) {
    const [y, cz, rx, rz] = rings[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(Math.cos(a) * rx, y, cz + Math.sin(a) * rz);
      uvs.push(j / radial, i / (rings.length - 1));
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const capLo = pos.length / 3;
  pos.push(0, rings[0][0], rings[0][1]); uvs.push(0.5, 0);
  const capHi = capLo + 1;
  pos.push(0, rings[rings.length - 1][0], rings[rings.length - 1][1]); uvs.push(0.5, 1);
  const ringLo = 0, ringHi = (rings.length - 1) * (radial + 1);
  for (let j = 0; j < radial; j++) {
    idx.push(capLo, ringLo + j + 1, ringLo + j);
    idx.push(capHi, ringHi + j, ringHi + j + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// A limb as one tube with a taper, weighted to two bones. The weight ramps
// across the joint so the surface bends smoothly instead of hinging.
function limbGeometry(baseX, baseY, baseZ, upperLen, lowerLen, radiusAt, opts = {}) {
  const rings = opts.rings || 26;
  const radial = opts.radial || 16;
  const blend = opts.blend || 0.05;
  const total = upperLen + lowerLen;
  const pos = [], uvs = [], idx = [], si = [], sw = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const d = total * t;
    const r = radiusAt(t);
    let w = (d - (upperLen - blend)) / (blend * 2);
    w = Math.max(0, Math.min(1, w));
    w = w * w * (3 - 2 * w);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(baseX + Math.cos(a) * r, baseY - d, baseZ + Math.sin(a) * r);
      uvs.push(j / radial, t);
      si.push(0, 1, 0, 0);
      sw.push(1 - w, w, 0, 0);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

const armRadius = (t) => {
  if (t < 0.05) return 0.030 + t / 0.05 * 0.042;   // cap tucked inside the body
  if (t < 0.20) return 0.072 - (t - 0.05) * 0.02;
  if (t < 0.50) return 0.069 - (t - 0.20) * 0.035;
  if (t < 0.56) return 0.059 - (t - 0.50) * 0.01;
  if (t < 0.95) return 0.058 - (t - 0.56) * 0.018;
  return 0.051 - (t - 0.95) / 0.05 * 0.024;
};
const legRadius = (t) => {
  if (t < 0.06) return 0.045 + t / 0.06 * 0.060;
  if (t < 0.22) return 0.105 - (t - 0.06) * 0.03;
  if (t < 0.50) return 0.100 - (t - 0.22) * 0.045;
  if (t < 0.58) return 0.0874 - (t - 0.50) * 0.02;
  if (t < 0.94) return 0.0858 - (t - 0.58) * 0.045;
  return 0.0696 - (t - 0.94) / 0.06 * 0.030;
};

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------
export function createCharacter(colorIdx, look) {
  const m = materialsFor(colorIdx, look);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  const hips = new THREE.Group();
  hips.position.y = 0.84;
  root.add(hips);

  // ---- body: one lofted jacket shell ------------------------------------
  // Hem, waist, chest, shoulders and collar are cross sections of a single
  // surface, so the silhouette is continuous from the hips to the neck.
  const torsoGroup = new THREE.Group();
  torsoGroup.position.y = 0.02;
  hips.add(torsoGroup);

  const jacketSections = [
    [-0.074, 0.190, 0.128], [-0.030, 0.192, 0.130], [0.040, 0.186, 0.129],
    [0.120, 0.180, 0.126], [0.200, 0.182, 0.128], [0.280, 0.190, 0.133],
    [0.350, 0.202, 0.140], [0.420, 0.218, 0.148], [0.470, 0.230, 0.152],
    [0.505, 0.227, 0.147], [0.535, 0.207, 0.137], [0.560, 0.168, 0.124],
    [0.582, 0.122, 0.108], [0.600, 0.104, 0.100]
  ];
  const torso = add(torsoGroup, loftGeometry(jacketSections, 32), m.jacket, [0, 0, 0]);
  torso.castShadow = true;

  // zip: sampled along the shell profile so the tape hugs the chest instead of
  // cutting a straight box through the curve
  const zipPts = [];
  for (let i = 0; i <= 26; i++) {
    const y = -0.064 + (0.588 + 0.064) * (i / 26);
    let d = jacketSections[jacketSections.length - 1][2];
    for (let k = 1; k < jacketSections.length; k++) {
      const a = jacketSections[k - 1], b = jacketSections[k];
      if (y >= a[0] && y <= b[0]) {
        const t = (y - a[0]) / (b[0] - a[0] || 1);
        d = a[2] + (b[2] - a[2]) * t;
        break;
      }
      if (y < jacketSections[0][0]) { d = jacketSections[0][2]; break; }
    }
    zipPts.push(new THREE.Vector3(0, y, -(d + 0.0032)));
  }
  // the reference's wide white zip band, laid on the chest curve
  add(torsoGroup, ribbonGeometry(zipPts, 0.0140), m.scarf);
  const zipTop = zipPts[zipPts.length - 1];
  add(torsoGroup, new THREE.BoxGeometry(0.028, 0.026, 0.011), m.scarf, [0, 0.574, zipTop.z - 0.002]);
  add(torsoGroup, new THREE.BoxGeometry(0.011, 0.036, 0.006), m.scarf, [0, 0.550, zipTop.z - 0.006], [0.12, 0, 0]);
  // ---- neck / head ------------------------------------------------------
  // One sculpted head. Every feature sits at a measured position: eyes at the
  // socket dents, mouth in the trough, ears at the widest point of the skull.
  const neck = add(hips, new THREE.CylinderGeometry(0.050, 0.058, 0.17, 16), m.skin, [0, 0.500, -0.006]);
  neck.castShadow = false;

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.766, -0.006);
  headGroup.scale.setScalar(1.98);      // the reference's chibi head-to-body ratio
  hips.add(headGroup);

  const headMesh = add(headGroup, headGeometry(), m.face, [0, 0, 0]);
  headMesh.castShadow = true;

  add(headGroup, decalGeometry(0, -0.086, -0.088, 0.078, 0.040, 18, 12), m.mouth);

  const blinkers = [];
  for (const side of [-1, 1]) {
    // eye decal: open and shut share one surface patch so the blink cannot slip
    const patch = decalGeometry(side * 0.038, -0.020, -0.082, 0.060, 0.104, 20, 24);
    const openEye = new THREE.Mesh(patch, m.eyeOpen);
    openEye.renderOrder = 3;
    headGroup.add(openEye);
    const shutEye = new THREE.Mesh(patch, m.eyeClosed);
    shutEye.renderOrder = 4;
    shutEye.visible = false;
    headGroup.add(shutEye);
    blinkers.push({ open: openEye, shut: shutEye });

    // ear: shell pinched against the skull, shaded bowl inside. The reference
    // ears are big and stick out, so they are half again the old size.
    add(headGroup, new THREE.SphereGeometry(0.0235, 16, 14), m.skin,
      [side * 0.1040, 0.002, 0.006], [0.08, side * -0.42, side * 0.06], [0.42, 1.12, 0.84]);
    add(headGroup, new THREE.SphereGeometry(0.0118, 12, 10), m.skinShadow,
      [side * 0.1105, 0.002, -0.006], [0.08, side * -0.42, side * 0.06], [0.38, 0.92, 0.54]);
  }

  add(headGroup, hairGeometry(), m.hair, [0, 0.000, 0]);

  // spiky fringe and side tufts: the silhouette that reads as hair from across
  // the map, instead of a smooth helmet
  const UP = new THREE.Vector3(0, 1, 0);
  const tuft = (px, py, pz, dx, dy, dz, len, rad) => {
    const mesh = new THREE.Mesh(tuftGeometry(len, rad), m.hair);
    mesh.position.set(px, py, pz);
    mesh.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize());
    mesh.castShadow = true;
    headGroup.add(mesh);
  };
  for (let i = 0; i < 8; i++) {
    const a = -0.95 + i * 0.2714;
    const px = Math.sin(a) * (HEAD_W + 0.002);
    const pz = -Math.cos(a) * (HEAD_D + 0.002);
    const py = 0.066 - Math.abs(a) * 0.006;
    tuft(px, py, pz, Math.sin(a) * 0.42, -0.94, -Math.cos(a) * 0.34,
      0.028 + (i % 3) * 0.005 + (i === 4 ? 0.004 : 0), 0.032);
  }
  // temple tufts point outwards, leaving the cheeks clear
  for (const side of [-1, 1]) {
    tuft(side * (HEAD_W + 0.001), 0.048, -0.030, side * 1.0, 0.16, -0.12, 0.056, 0.024);
  }
  for (let i = 0; i < 5; i++) {
    const a = -0.62 + i * 0.31;
    tuft(Math.sin(a) * (HEAD_W + 0.002), -0.050, Math.cos(a) * (HEAD_D + 0.002),
      Math.sin(a) * 0.45, -0.60, Math.cos(a) * 0.65, 0.058, 0.023);
  }

  // beanie fitted to the skull: dome from the brow line to the crown
  // One lathed profile: rolled brim, soft fold and a dome that clears the
  // skull by a few millimetres at every height.
  // brim pulled down over the forehead: worn high, the beanie read as a cap
  // perched on top of the skull
  const hatProfile = [
    [0.0970, 0.0660], [0.1044, 0.0748], [0.1072, 0.0900], [0.1064, 0.1052],
    [0.1028, 0.1148], [0.1012, 0.1260], [0.0990, 0.1420], [0.0945, 0.1580],
    [0.0850, 0.1720], [0.0650, 0.1820], [0.0350, 0.1880], [0.0002, 0.1900]
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  add(headGroup, new THREE.LatheGeometry(hatProfile, 40), m.beanie, [0, 0, 0]);
  // rolled brim: a darker knit ring so the hat reads as a folded band
  add(headGroup, new THREE.TorusGeometry(0.1035, 0.0095, 8, 34), m.beanieDark,
    [0, 0.0885, 0], [Math.PI / 2, 0, 0], [1, 1, 1]);
  // oversized pom, like the reference: the hat's white full stop
  add(headGroup, new THREE.SphereGeometry(0.0315, 18, 14), m.snow, [0, 0.1890, 0], null, [1, 0.9, 1]);

  // ---- scarf ------------------------------------------------------------
  // lives on the neck, not on the head, so scaling the head leaves it alone
  // White fur collar around the jacket's neck opening. It is a short loft over
  // the top sections of the shell, so it wraps the neck like real trim instead
  // of floating as a torus. The head hides the middle; the sides stay white.
  const collarSections = [
    [0.500, 0.220, 0.152], [0.524, 0.216, 0.149], [0.548, 0.203, 0.141],
    [0.568, 0.178, 0.131], [0.584, 0.144, 0.119], [0.598, 0.112, 0.106]
  ];
  const collar = add(torsoGroup, loftGeometry(collarSections, 30), m.scarf, [0, 0, 0]);
  collar.castShadow = true;

  // ---- arms -------------------------------------------------------------
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.179, 0.494, 0);
    shoulder.rotation.z = side * 0.06;
    torsoGroup.add(shoulder);

    // upper sleeve: starts wide inside the shoulder and tapers into the elbow
    const upperGeo = limbGeometry(0, 0, 0, 0.325, 0, (t) => {
      if (t < 0.12) return 0.058 + t * 0.075;
      if (t < 0.50) return 0.0670 - (t - 0.12) * 0.020;
      if (t < 0.90) return 0.0594 - (t - 0.50) * 0.022;
      return 0.0506 - (t - 0.90) * 0.120;
    }, { rings: 18, radial: 18 });
    const upper = new THREE.Mesh(upperGeo, m.jacket);
    upper.castShadow = true; upper.receiveShadow = true;
    shoulder.add(upper);
    // shoulder of the jacket: a soft cap that carries the sleeve into the body
    const deltoid = add(shoulder, new THREE.SphereGeometry(1, 20, 16), m.jacket,
      [side * -0.010, -0.014, 0], [0, 0, side * 0.13], [0.074, 0.061, 0.070]);

    const elbow = new THREE.Group();
    elbow.position.y = -0.30;
    shoulder.add(elbow);
    // forearm starts slightly wider than the upper sleeve ends, hiding the seam
    const foreGeo = limbGeometry(0, 0, 0, 0.30, 0, (t) => {
      if (t < 0.06) return 0.0570 - t * 0.14;
      if (t < 0.55) return 0.0486 + (t - 0.06) * 0.005;
      if (t < 0.92) return 0.0510 - (t - 0.55) * 0.016;
      return 0.0451 - (t - 0.92) * 0.22;
    }, { rings: 18, radial: 18 });
    const fore = new THREE.Mesh(foreGeo, m.jacket);
    fore.castShadow = true; fore.receiveShadow = true;
    elbow.add(fore);
    // white knit cuff: the reference's sleeve ends in a bright band
    add(elbow, new THREE.CylinderGeometry(0.053, 0.059, 0.058, 18), m.scarf, [0, -0.246, 0]);
    // mitten: one soft palm, a thumb and a knit cuff — cleaner than four fingers
    const hand = new THREE.Group();
    hand.position.y = -0.285;
    elbow.add(hand);
    add(hand, new THREE.CylinderGeometry(0.046, 0.051, 0.034, 18), m.scarf, [0, 0.004, 0]);
    add(hand, new THREE.SphereGeometry(1, 20, 16), m.mitten, [0, -0.056, -0.008], [0.08, 0, 0], [0.058, 0.080, 0.046]);
    add(hand, new THREE.SphereGeometry(1, 14, 12), m.mitten, [0, -0.120, -0.006], null, [0.038, 0.026, 0.038]);
    add(hand, new THREE.CapsuleGeometry(0.0180, 0.036, 4, 10), m.mitten,
      [side * -0.046, -0.060, -0.020], [0.25, 0, side * 0.95]);
    return { shoulder, elbow, hand };
  }
  const armR = makeArm(1);
  const armL = makeArm(-1);

  // ---- legs -------------------------------------------------------------
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.088, -0.015, 0);
    hips.add(hip);
    const thighGeo = limbGeometry(0, 0, 0, 0.400, 0, (t) => {
      if (t < 0.08) return 0.082 + t * 0.13;
      if (t < 0.55) return 0.0924 - (t - 0.08) * 0.026;
      if (t < 0.90) return 0.0860 - (t - 0.55) * 0.030;
      return 0.0755 - (t - 0.90) * 0.180;
    }, { rings: 20, radial: 18 });
    const thigh = new THREE.Mesh(thighGeo, m.pants);
    thigh.castShadow = true; thigh.receiveShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.375;
    hip.add(knee);
    const shinGeo = limbGeometry(0, 0, 0, 0.300, 0, (t) => {
      if (t < 0.07) return 0.0778 - t * 0.10;
      if (t < 0.50) return 0.0708 - (t - 0.07) * 0.010;
      if (t < 0.90) return 0.0665 - (t - 0.50) * 0.052;
      return 0.0457 - (t - 0.90) * 0.200;
    }, { rings: 18, radial: 18 });
    const shin = new THREE.Mesh(shinGeo, m.pants);
    shin.castShadow = true; shin.receiveShadow = true;
    knee.add(shin);
    // boot: shaft, rounded toe, thick sole, instep strap
    const foot = new THREE.Group();
    foot.position.y = -0.300;
    knee.add(foot);
    // one shell: shaft, ankle, instep and toe curves out of a single loft
    const bootRings = [
      [0.046, 0.004, 0.058, 0.060], [0.014, 0.000, 0.061, 0.063],
      [-0.016, -0.008, 0.060, 0.068], [-0.042, -0.024, 0.058, 0.084],
      [-0.066, -0.046, 0.057, 0.106], [-0.084, -0.068, 0.056, 0.124],
      [-0.097, -0.090, 0.054, 0.132], [-0.104, -0.110, 0.048, 0.130],
      [-0.108, -0.124, 0.038, 0.116]
    ];
    const boot = new THREE.Mesh(ringLoft(bootRings, 20), m.boot);
    boot.castShadow = true; boot.receiveShadow = true;
    foot.add(boot);
    const soleRings = [
      [-0.100, -0.052, 0.062, 0.128], [-0.117, -0.054, 0.064, 0.132], [-0.127, -0.056, 0.050, 0.116]
    ];
    const sole = new THREE.Mesh(ringLoft(soleRings, 20), m.sole);
    sole.castShadow = true; sole.receiveShadow = true;
    foot.add(sole);
    // white fur band at the boot top, matching the reference's cuffs
    add(foot, new THREE.CylinderGeometry(0.068, 0.070, 0.042, 20), m.scarf, [0, 0.040, 0.004]);
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
    armR, armL, legR, legL
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
      hips.position.y = 0.84 - buckle * 0.34;
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
    hips.position.y = 0.84 + (0.5 - 0.5 * Math.cos(state.phase * 2)) * 0.032 * amp;
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
  sprite.position.y = 2.14;
  sprite.renderOrder = 5;
  return sprite;
}

// ---------------------------------------------------------------------------
// First-person viewmodel: the reference's black mitten on a blue sleeve with a
// white knit cuff, holding the snowball in the palm.
// ---------------------------------------------------------------------------
export function createViewModel(look) {
  const m = materialsFor(0, look);
  const sleeve = m.jacket;
  const trim = m.scarf;
  const glove = m.mitten;
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xf8fbff, roughness: 0.6, metalness: 0, envMapIntensity: 0.9
  });

  const group = new THREE.Group();

  // throwing arm: short sleeve from the bottom corner, wrist, mitten
  const armPivot = new THREE.Group();
  armPivot.position.set(0.46, -0.30, -0.78);
  group.add(armPivot);

  const forearm = add(armPivot, new THREE.CapsuleGeometry(0.072, 0.22, 4, 16), sleeve,
    [0, -0.09, -0.03], [-1.02, 0.16, 0.16]);
  forearm.castShadow = false;
  const cuff = add(armPivot, new THREE.CylinderGeometry(0.082, 0.090, 0.074, 16), trim,
    [-0.022, 0.002, -0.132], [-1.02, 0.16, 0.16]);
  cuff.castShadow = false;

  const hand = new THREE.Group();
  hand.position.set(-0.035, 0.020, -0.150);
  hand.rotation.set(0.12, 0, 0);
  armPivot.add(hand);

  const mitten = new THREE.Group();
  hand.add(mitten);
  // one rounded mitten: palm, curled finger mass and thumb, no separate fingers
  const palm = add(mitten, new THREE.SphereGeometry(1, 20, 16), glove, [0, 0, 0],
    [0.08, 0, 0.05], [0.076, 0.096, 0.064]);
  palm.castShadow = false;
  add(mitten, new THREE.SphereGeometry(1, 16, 12), glove, [0.002, -0.062, -0.040],
    [0.55, 0, 0], [0.068, 0.058, 0.056]);
  const thumb = add(mitten, new THREE.CapsuleGeometry(0.026, 0.046, 4, 12), glove,
    [-0.066, 0.004, -0.030], [0.35, 0, 0.95]);
  thumb.castShadow = false;
  add(hand, new THREE.TorusGeometry(0.062, 0.010, 6, 16), trim, [0, 0.030, -0.004],
    [Math.PI / 2, 0, 0], [1, 0.9, 1]);

  // snowball with clumps, resting in the palm
  const ball = new THREE.Group();
  hand.add(ball);
  ball.position.set(0, 0.105, -0.085);
  const core = add(ball, new THREE.IcosahedronGeometry(0.094, 2), snowMat, [0, 0, 0]);
  core.castShadow = false;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.055 + Math.random() * 0.045;
    add(ball, new THREE.SphereGeometry(0.020 + Math.random() * 0.018, 7, 6), snowMat,
      [Math.cos(a) * r, (Math.random() - 0.5) * 0.10, Math.sin(a) * r]);
  }
  ball.visible = false;

  let throwT = 0;
  let bobPhase = 0;
  let charge = 0;
  let chargeTarget = 0;
  let openAmount = 0;

  function throwBall() { throwT = 0.001; }

  function update(dt, { speed = 0, sprinting = false, charging = 0, swayX = 0, swayY = 0, grounded = true, spread = 1 } = {}) {
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

    // the mitten squeezes the snow while charging and opens as the ball leaves
    const releaseOpen = throwT > 0.3 && throwT < 0.7 ? 1 : 0;
    openAmount += ((releaseOpen ? 1 : 0) - openAmount) * Math.min(1, dt * 16);
    mitten.rotation.x = 0.22 + 0.10 * charge - 0.30 * openAmount;
    mitten.scale.setScalar(1 + charge * 0.03 - openAmount * 0.05);

    ball.visible = !(throwT > 0.26 && throwT < 0.82);
    const s = 0.62 + charge * 0.46;
    // squeeze the snow as the grip tightens, stretch it on release
    const stretch = throwT > 0.26 && throwT < 0.5 ? (1 - (throwT - 0.26) / 0.24) * 0.10 : 0;
    ball.scale.set(s * (1 - charge * 0.04 - stretch * 0.3), s * (1 + charge * 0.06 + stretch), s * (1 - charge * 0.04));
    ball.position.z = -0.085 - charge * 0.03;
    ball.position.y = 0.105 - charge * 0.012;
    ball.rotation.set(charge * 2.6, charge * 1.7, 0);

    // arm pulls back and down as the throw charges; the pivot itself moves
    // towards the middle on narrow screens so the hand never leaves the frame
    armPivot.rotation.set(charge * 0.10, 0, 0);
    armPivot.position.set(
      (0.46 - charge * 0.035 + swayX * 0.002) * spread * spread,
      -0.30 - charge * 0.035 + swayY * 0.002,
      -0.78 + charge * 0.045
    );

  }

  function setVisible(v) { group.visible = v; }

  return { group, update, throwBall, setVisible };
}
