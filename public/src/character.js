// Player characters + first-person viewmodel.
// Everything is procedural: anatomy, layered winter gear, cloth/leather/knit
// micro-detail from canvas bump maps, snow dusting and articulated animation.
import * as THREE from '../vendor/three.module.js';

// The default look is the reference character: royal-blue jacket and beanie,
// white knit trim, warm light skin and brown hair. The other slots are the
// same design in different colours.
const JACKETS = [0x2d5cd8, 0xd0453a, 0x2f8a63, 0x6b46a8, 0xe0a02c, 0x2b8f9c, 0xd2588c, 0x3a4d72];
const SCARVES = [0xf4f7fb, 0xe9dcc4, 0xd6e7f6, 0xd9edd9, 0xf4d6dd, 0xdfe4ec];
const SKIN_TONES = [0xf2bd96, 0xe3ac84, 0xc78f68, 0xa46f4d, 0x7c5036, 0xf0d5b8];
const HAIR_COLORS = [0x6d4527, 0x452c1b, 0x8b5a30, 0x2a1a11, 0xb07a45, 0x52331f];
const IRIS_COLORS = [0x3a2a1e, 0x2d3a44, 0x3d3222, 0x2a2018, 0x4a3a28, 0x33302c];
// Hats get their own rack: knit colours that read apart from the trim.
const HAT_COLORS = [0x2d5cd8, 0xd0453a, 0xe0a02c, 0x2f8a63, 0x8e97a3, 0x6b46a8];

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
// Loose snow: crumbs and grain, used by the viewmodel snowball
const snowH = (x, y) => {
  const crumb = fbm2(x * 0.55, y * 0.55, 3) * 74;
  const grain = (hash2(x * 2.3, y * 2.3) - 0.5) * 20;
  return 96 + crumb + grain;
};
const skinH = (x, y) => {
  const pores = fbm2(x * 0.5, y * 0.5, 3) * 46;
  const fine = (hash2(x * 2, y * 2) - 0.5) * 14;
  return 108 + pores + fine;
};
// Hair is drawn as fine strands running down the skull: the shell alone reads
// as a leather cap, the normal map is what turns it into hair.
const hairH = (x, y) => {
  const strand = Math.sin(x * 0.46 + Math.sin(y * 0.05) * 1.6) * 26;
  const fine = Math.sin(x * 1.7 + fbm2(x * 0.05, y * 0.02, 2) * 4) * 12;
  const grain = (hash2(x, y) - 0.5) * 16;
  return 128 + strand + fine + grain;
};

const fabricBump = () => bumpTexture('fabric', 256, fabricH);
const knitBump = () => bumpTexture('knit', 256, knitH);
const leatherBump = () => bumpTexture('leather', 256, leatherH);
const denimBump = () => bumpTexture('denim', 256, denimH);
const skinBump = () => bumpTexture('skin', 128, skinH);
const snowNormal = () => normalTexture('snow', 128, snowH, 1.1);

// ---------------------------------------------------------------------------
// Head
// A head built from stacked primitives always reads as glued-on blobs, so this
// one is a single sphere displaced into skull, brow, cheeks, jaw, nose and
// mouth. Eyes and mouth are separate high-resolution decals that follow the
// sculpted surface, which keeps them crisp without a 4k albedo texture.
// ---------------------------------------------------------------------------
const HEAD_W = 0.097;   // half width  (19.4 cm across)
const HEAD_H = 0.117;   // half height (23.4 cm crown to chin)
const HEAD_D = 0.101;   // half depth  (20.2 cm face to occiput)

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
  // Cartoon faces are smooth: no carved sockets, no nostril dents and no
  // mouth trough. Only the soft volumes that read from across the map stay.
  let d = 0;
  for (const s of [-1, 1]) {
    d += g(s * 0.048, -0.020, -0.070, 0.036, 0.030, 0.044) * 0.0060;  // cheek apple
    d += g(s * 0.062, -0.066, -0.048, 0.026, 0.026, 0.040) * 0.0030;  // jaw corner
    d += g(s * 0.082, 0.030, -0.004, 0.024, 0.034, 0.040) * -0.0028;  // temple
  }
  d += g(0, 0.052, -0.070, 0.076, 0.046, 0.044) * 0.0022;  // forehead
  d += g(0, -0.010, -0.098, 0.014, 0.020, 0.018) * 0.0040; // nose bridge
  d += g(0, -0.036, -0.100, 0.022, 0.020, 0.024) * 0.0090; // button nose
  d += g(0, -0.098, -0.080, 0.022, 0.020, 0.028) * 0.0040; // chin
  d += g(0, 0.010, 0.078, 0.072, 0.080, 0.044) * 0.0030;   // occiput
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
    p.x *= 1 - 0.30 * t * t;
    p.z *= 1 - 0.04 * t * t;
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
    blob(s * 0.054, -0.030, -0.066, 0.040, 0.032, [232, 132, 118], 0.36); // rosy cheek
    blob(s * 0.082, 0.052, -0.020, 0.026, 0.034, [148, 106, 94], 0.10);   // temple
  }
  blob(0, -0.040, -0.100, 0.022, 0.016, [232, 128, 112], 0.22);  // rosy nose tip
  blob(0, 0.068, -0.062, 0.066, 0.018, [130, 94, 84], 0.10);     // hairline, front
  for (const s of [-1, 1]) {
    blob(s * 0.076, 0.030, -0.030, 0.022, 0.024, [126, 90, 82], 0.10); // hairline, side
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

// Cartoon eye: the reference's plain black oval. No iris, no sclera and no
// catchlight -- at this head size the solid shape is what reads as a face,
// and the tall aspect is what keeps it from looking like two buttons.
function eyeTexture(idx, open) {
  const key = 'eye3:' + (open ? 1 : 0);
  if (texCache.has(key)) return texCache.get(key);
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const cx = W / 2, cy = H / 2;

  ctx.fillStyle = '#0f1116';
  ctx.beginPath();
  if (open) ctx.ellipse(cx, cy, 62, 104, 0, 0, Math.PI * 2);
  else ctx.ellipse(cx, cy + 22, 62, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// Eyebrow: a soft tapered arc, placed as its own decal so it follows the brow
// curve of the sculpted head instead of floating in front of it.
function browTexture(flip) {
  const key = 'brow2:' + (flip ? 1 : 0);
  if (texCache.has(key)) return texCache.get(key);
  const W = 256, H = 72;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.lineCap = 'round';
  const g = ctx.createLinearGradient(22, 0, 236, 0);
  g.addColorStop(0, 'rgba(52,32,22,0.42)');
  g.addColorStop(0.22, 'rgba(52,32,22,0.92)');
  g.addColorStop(0.7, 'rgba(52,32,22,0.98)');
  g.addColorStop(1, 'rgba(52,32,22,0.78)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.moveTo(24, 46);
  ctx.quadraticCurveTo(128, 30, 234, 44);
  ctx.stroke();
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
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(38, 58);
  ctx.quadraticCurveTo(128, 132, 218, 58);
  ctx.stroke();

  // a soft lower lip keeps the line from reading as a scratch
  ctx.strokeStyle = 'rgba(214,140,124,0.26)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(62, 88);
  ctx.quadraticCurveTo(128, 138, 194, 88);
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
  const COLS = 72, ROWS = 12;
  const RX = HEAD_W + 0.0110, RY = HEAD_H + 0.0125, RZ = HEAD_D + 0.0110;
  const pos = [], idx = [], uvs = [];
  for (let i = 0; i <= COLS; i++) {
    const phi = (i / COLS) * Math.PI * 2;
    let a = phi - Math.PI * 1.5;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    const s = Math.abs(a) / Math.PI;                     // 0 front, 1 back
    // Hairline: a soft, side-swept fringe over the brow, lifted clear of the
    // ears and dropping to the nape. One smooth wave instead of spikes.
    let yBot = 0.052 - 0.051 * s - 0.086 * s * s - 0.011 * Math.sin(a);
    yBot += 0.020 * Math.exp(-Math.pow((Math.abs(a) - 1.5) / 0.32, 2));
    // soft scallops along the fringe: a wavy hairline instead of a cut edge
    yBot += 0.0055 * Math.sin(phi * 5.0) * (1 - s) * (1 - s);
    yBot = Math.max(-0.078, Math.min(0.070, yBot));
    const thetaBot = Math.acos(Math.max(-1, Math.min(1, yBot / RY)));
    const thetaTop = Math.acos(0.106 / RY);
    for (let j = 0; j <= ROWS; j++) {
      const t = j / ROWS;
      const theta = thetaTop + (thetaBot - thetaTop) * t;
      // hair gains volume on the way down, then the last row tucks under so the
      // edge is a soft roll rather than a cut line
      let grow = 1 + 0.030 * Math.min(1, t * 1.6);
      let lift = 0;
      if (t > 0.86) {
        const k = (t - 0.86) / 0.14;
        grow -= 0.075 * k * k;
        lift = 0.006 * k * k;
      }
      const st = Math.sin(theta);
      pos.push(-Math.cos(phi) * st * RX * grow, Math.cos(theta) * RY + lift, Math.sin(phi) * st * RZ * grow);
      uvs.push(i / COLS, 1 - t);
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
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// A soft lock of hair: a tapered tube bent along a quadratic curve and
// flattened against the skull. A few of these break up the hairline without the
// old spikes, which read as a crown of horns.
function lockGeometry(a, b, c, r0, r1, flat = 0.6) {
  const RINGS = 13, RAD = 9;
  const pos = [], uvs = [], idx = [];
  const p = new THREE.Vector3(), tan = new THREE.Vector3(), tmp = new THREE.Vector3();
  const out = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i <= RINGS; i++) {
    const s = i / RINGS, u = 1 - s;
    p.copy(a).multiplyScalar(u * u).addScaledVector(b, 2 * u * s).addScaledVector(c, s * s);
    tan.copy(b).sub(a).multiplyScalar(2 * u).addScaledVector(tmp.copy(c).sub(b), 2 * s).normalize();
    out.copy(p).normalize();
    out.addScaledVector(tan, -out.dot(tan)).normalize();
    side.crossVectors(out, tan).normalize();
    const r = (r0 + (r1 - r0) * s) * Math.sin(Math.PI * (0.20 + 0.72 * s));
    for (let j = 0; j <= RAD; j++) {
      const ang = (j / RAD) * Math.PI * 2;
      const cs = Math.cos(ang) * r, sn = Math.sin(ang) * r * flat;
      pos.push(p.x + side.x * cs + out.x * sn, p.y + side.y * cs + out.y * sn, p.z + side.z * cs + out.z * sn);
      uvs.push(j / RAD, s);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < RAD; j++) {
      const i0 = i * (RAD + 1) + j, i1 = i0 + RAD + 1;
      idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// Point on the sculpted face at (x, y), pushed out along the normal by `out`.
function faceSurface(x, y, out = 0) {
  const nx = x / HEAD_W, ny = y / HEAD_H;
  const k = Math.max(0.001, 1 - nx * nx - ny * ny);
  const z = -HEAD_D * Math.sqrt(k);
  const n = new THREE.Vector3(x / (HEAD_W * HEAD_W), y / (HEAD_H * HEAD_H), z / (HEAD_D * HEAD_D)).normalize();
  return new THREE.Vector3(x, y, z).addScaledVector(n, out);
}

// A tapered clump: wide at the scalp, pointed at the tip.
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

// The jacket's high collar, pulled up over nose and mouth. Its top edge sits
// just under the eyes at the front and climbs at the sides and back until it
// meets the beanie, so the only bare skin left is the narrow band with the
// eyes. Built as an open shell (no caps): the face has to stay visible inside.
function gaiterGeometry() {
  const COLS = 72, ROWS = 18;
  // radius profile in head units: y, half width, half depth
  const rings = [
    [-0.185, 0.0620, 0.0690], [-0.172, 0.0660, 0.0730],
    [-0.158, 0.0740, 0.0810], [-0.144, 0.0830, 0.0900],
    [-0.130, 0.0890, 0.0960], [-0.114, 0.0940, 0.1010],
    [-0.096, 0.0980, 0.1050], [-0.076, 0.1010, 0.1090],
    [-0.056, 0.1030, 0.1115], [-0.036, 0.1040, 0.1130],
    [-0.016, 0.1040, 0.1135], [0.004, 0.1036, 0.1132],
    [0.022, 0.1030, 0.1126]
  ];
  const at = (y) => {
    if (y <= rings[0][0]) return [rings[0][1], rings[0][2]];
    for (let i = 1; i < rings.length; i++) {
      const a = rings[i - 1], b = rings[i];
      if (y <= b[0]) {
        const t = (y - a[0]) / (b[0] - a[0] || 1);
        return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
    }
    const l = rings[rings.length - 1];
    return [l[1], l[2]];
  };
  const smooth = (edge0, edge1, x) => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };
  // cloth bulge over nose and mouth: a plain tube reads as a mask, this reads
  // as fabric pulled over a face
  const pushAt = (y, a) => {
    const front = Math.exp(-Math.pow(a / 0.9, 4));
    return (0.0055 * Math.exp(-Math.pow((y + 0.070) / 0.045, 2))
      + 0.0034 * Math.exp(-Math.pow((y + 0.125) / 0.034, 2))) * front;
  };
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= COLS; i++) {
    const phi = (i / COLS) * Math.PI * 2;
    let a = phi;
    while (a > Math.PI) a -= Math.PI * 2;
    const s = Math.abs(a) / Math.PI;              // 0 front, 1 nape
    const topY = -0.040 + 0.056 * smooth(0.26, 0.56, s);
    for (let j = 0; j <= ROWS; j++) {
      const t = j / ROWS;
      const y = -0.170 + (topY + 0.170) * t;
      const [rx, rz] = at(y);
      const push = pushAt(y, a);
      pos.push(-Math.sin(phi) * (rx + push), y, -Math.cos(phi) * (rz + push));
      uvs.push(i / COLS, t);
    }
  }
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const a = i * (ROWS + 1) + j, b = a + ROWS + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // Flat white piping sewn along the mask's top edge. A tube rolled around the
  // edge floats on the skin from the front; a flat band sits on the cloth.
  const tp = [], tu = [], ti = [];
  for (let i = 0; i <= COLS; i++) {
    const phi = (i / COLS) * Math.PI * 2;
    let a = phi;
    while (a > Math.PI) a -= Math.PI * 2;
    const s = Math.abs(a) / Math.PI;
    const topY = -0.040 + 0.050 * smooth(0.26, 0.56, s);
    for (let row = 0; row < 2; row++) {
      const y = row === 0 ? topY + 0.0005 : topY - 0.0086;
      const [rx, rz] = at(Math.min(y, topY));
      // taper the lift at the temples so the piping tucks under the beanie
      // instead of sticking out like a glasses arm
      const push = pushAt(Math.min(y, topY), a) + 0.0004 + 0.0013 * (1 - smooth(0.30, 0.52, s));
      tp.push(-Math.sin(phi) * (rx + push), y, -Math.cos(phi) * (rz + push));
      tu.push(i / COLS, 1 - row);
    }
  }
  for (let i = 0; i < COLS; i++) {
    const a = i * 2, b = a + 2;
    ti.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const trim = new THREE.BufferGeometry();
  trim.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  trim.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2));
  trim.setIndex(ti);
  trim.computeVertexNormals();
  trim.computeBoundingSphere();
  return { geometry: geo, trim };
}

const fabricNormal = () => normalTexture('fabric', 256, fabricH, 2.6);
const knitNormal = () => normalTexture('knit', 256, knitH, 3.0);
const hairNormal = () => normalTexture('hair', 256, hairH, 2.4);
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
      // a faint self-light keeps the shoulder crease and the armpits blue in
      // shadow instead of crushing them to black
      emissive: new THREE.Color(jacketColor).multiplyScalar(0.11),
      normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.16, 0.16),
      sheen: 0.22, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xa9c2e0),
      envMapIntensity: 0.55
    }),
    jacketDark: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(jacketColor).multiplyScalar(0.92), roughness: 0.9, metalness: 0,
      emissive: new THREE.Color(jacketColor).multiplyScalar(0.08),
      normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.38, 0.38),
      sheen: 0.24, sheenRoughness: 0.9, envMapIntensity: 0.42
    }),
    // panel and sleeve seams: darker than the shell so the cut lines read at
    // menu distance without turning into black stripes
    seam: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(jacketColor).multiplyScalar(0.74), roughness: 0.92, metalness: 0,
      normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.5, 0.5),
      sheen: 0.2, sheenRoughness: 0.9, envMapIntensity: 0.34
    }),
    pants: new THREE.MeshStandardMaterial({
      color: 0x2b3350, roughness: 0.92, metalness: 0,
      emissive: new THREE.Color(0x2b3350).multiplyScalar(0.10),
      normalMap: denimNormal(), normalScale: new THREE.Vector2(0.18, 0.18), envMapIntensity: 0.3
    }),
    scarf: new THREE.MeshPhysicalMaterial({
      color: scarfColor, roughness: 0.97, metalness: 0,
      normalMap: knitNormal(), normalScale: new THREE.Vector2(0.85, 0.85),
      sheen: 0.42, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xd6dee6), envMapIntensity: 0.3
    }),
    beanie: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(HAT_COLORS[h % HAT_COLORS.length]).multiplyScalar(0.98),
      emissive: new THREE.Color(HAT_COLORS[h % HAT_COLORS.length]).multiplyScalar(0.08),
      roughness: 0.98, metalness: 0,
      normalMap: knitNormal(), normalScale: new THREE.Vector2(0.5, 0.5),
      sheen: 0.36, sheenRoughness: 0.92, sheenColor: new THREE.Color(0xd6dee6), envMapIntensity: 0.26
    }),
    beanieDark: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(HAT_COLORS[h % HAT_COLORS.length]).multiplyScalar(0.86),
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
      map: eyeTexture(k, true), transparent: true, roughness: 0.42, metalness: 0,
      envMapIntensity: 0.35,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide
    }),
    eyeClosed: new THREE.MeshStandardMaterial({
      map: eyeTexture(k, false), transparent: true, roughness: 0.5, metalness: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide
    }),
    browDecal: new THREE.MeshStandardMaterial({
      map: browTexture(false), transparent: true, roughness: 0.8, metalness: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide
    }),
    browDecalL: new THREE.MeshStandardMaterial({
      map: browTexture(true), transparent: true, roughness: 0.8, metalness: 0,
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
    hair: new THREE.MeshPhysicalMaterial({
      color: hairColor, roughness: 0.7, metalness: 0,
      normalMap: hairNormal(), normalScale: new THREE.Vector2(0.55, 0.4),
      sheen: 0.55, sheenRoughness: 0.55,
      sheenColor: new THREE.Color(hairColor).lerp(new THREE.Color(0xffd9b0), 0.5),
      envMapIntensity: 0.6
    }),
    // Smooth knitted mittens: no leather normal map, so the small hand does
    // not read as a cracked stone at menu distance.
    mitten: new THREE.MeshPhysicalMaterial({
      color: 0x24272f, roughness: 0.74, metalness: 0,
      sheen: 0.34, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x7b8598), envMapIntensity: 0.8
    }),
    leather: new THREE.MeshPhysicalMaterial({
      color: 0x1d2126, roughness: 0.58, metalness: 0.04,
      normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.7, 0.7),
      clearcoat: 0.35, clearcoatRoughness: 0.55, envMapIntensity: 0.9
    }),
    boot: new THREE.MeshPhysicalMaterial({
      color: 0x36415f, roughness: 0.88, metalness: 0.02,
      normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.26, 0.26),
      clearcoat: 0, clearcoatRoughness: 0.8, envMapIntensity: 0.35
    }),
    // the reference sneaker's light steel-blue toe box
    bootToe: new THREE.MeshPhysicalMaterial({
      color: 0x8299b3, roughness: 0.62, metalness: 0.02, side: THREE.DoubleSide,
      normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.2, 0.2),
      clearcoat: 0.10, clearcoatRoughness: 0.7, envMapIntensity: 0.8
    }),
    // white rubber sole, also reused for the zip slider and the badges
    sole: new THREE.MeshStandardMaterial({ color: 0xf1f5fa, roughness: 0.72, metalness: 0 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x171e27, roughness: 0.9, metalness: 0 }),
    logo: new THREE.MeshStandardMaterial({
      color: 0xf8fafd, roughness: 0.44, metalness: 0, envMapIntensity: 0.8, side: THREE.DoubleSide
    }),
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

// Merge transformed geometries that share one material into one mesh. The
// boot's cuff, piping and laces are six tiny parts per foot; six draw calls
// per foot is exactly the overhead phones feel, so they become one.
function mergeParts(parts) {
  const geos = parts.map((part) => {
    const g = part.geo.clone();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rot || [0, 0, 0])));
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...(part.pos || [0, 0, 0])), q,
      new THREE.Vector3(...(part.scale || [1, 1, 1]))
    ));
    return g;
  });
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const first = geos[0].getAttribute(name);
    if (!first) continue;
    let count = 0;
    for (const g of geos) count += g.getAttribute(name).count;
    const out = new Float32Array(count * first.itemSize);
    let offset = 0;
    for (const g of geos) {
      const attr = g.getAttribute(name);
      out.set(attr.array, offset);
      offset += attr.array.length;
    }
    merged.setAttribute(name, new THREE.Float32BufferAttribute(out, first.itemSize));
  }
  const indices = [];
  let base = 0;
  for (const g of geos) {
    const idx = g.index;
    if (idx) for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + base);
    else for (let i = 0; i < g.getAttribute('position').count; i++) indices.push(i + base);
    base += g.getAttribute('position').count;
    g.dispose();
  }
  merged.setIndex(indices);
  merged.computeBoundingSphere();
  return merged;
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

// The reference's white mountain badge: two peaks with a gap between them.
// Built flat in the XY plane, then bent onto the garment so it follows the
// curve instead of hovering over it like a sticker.
function mountainLogoGeometry(width, height) {
  const pos = [], uvs = [], idx = [];
  const peak = (x0, x1, apexX, apexY) => {
    const base = pos.length / 3;
    pos.push(x0, 0, 0, apexX, apexY, 0, x1, 0, 0);
    uvs.push(0, 0, 0.5, 1, 1, 0);
    idx.push(base, base + 1, base + 2);
  };
  peak(-width * 0.50, width * 0.005, -width * 0.25, height);
  peak(-width * 0.005, width * 0.50, width * 0.26, height * 0.66);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// Bend a flat decal onto the ellipse (rx, rz) at height y, centred on the
// azimuth thetaC and lifted off the cloth by `offset` along the surface normal.
function bendPatch(geo, y, rx, rz, thetaC, offset = 0.0028, cz = 0) {
  const p = geo.attributes.position;
  const arc = Math.hypot(rx * Math.cos(thetaC), rz * Math.sin(thetaC)) || 0.15;
  for (let i = 0; i < p.count; i++) {
    const th = thetaC + p.getX(i) / arc;
    const nx = Math.sin(th) / rx, nz = -Math.cos(th) / rz;
    const nl = Math.hypot(nx, nz) || 1;
    p.setXYZ(i,
      Math.sin(th) * rx + nx / nl * offset,
      y + p.getY(i),
      -Math.cos(th) * rz + nz / nl * offset + cz);
  }
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
  return loftRings(rings, radial, 0, Math.PI * 2, true);
}

// Open arc of a ring loft, used for panels such as the sneaker's toe box.
function ringLoftArc(rings, radial, a0, a1) {
  return loftRings(rings, radial, a0, a1, false);
}

function loftRings(rings, radial, a0, a1, closed) {
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i < rings.length; i++) {
    const [y, cz, rx, rz] = rings[i];
    for (let j = 0; j <= radial; j++) {
      const a = closed ? (j / radial) * Math.PI * 2 : a0 + (a1 - a0) * (j / radial);
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
  if (closed) {
    const capLo = pos.length / 3;
    pos.push(0, rings[0][0], rings[0][1]); uvs.push(0.5, 0);
    const capHi = capLo + 1;
    pos.push(0, rings[rings.length - 1][0], rings[rings.length - 1][1]); uvs.push(0.5, 1);
    const ringLo = 0, ringHi = (rings.length - 1) * (radial + 1);
    for (let j = 0; j < radial; j++) {
      idx.push(capLo, ringLo + j + 1, ringLo + j);
      idx.push(capHi, ringHi + j, ringHi + j + 1);
    }
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
      // wound outward: the sleeve must be solid from the outside, not a shell
      // whose normals point into the arm
      idx.push(a, a + 1, b, b, a + 1, b + 1);
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

// A tube that follows a curve and can change radius along it: the viewmodel
// fingers taper and swell at the joints instead of reading as equal sausages.
function taperedTube(curve, radiusAt, segs = 16, radial = 10) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPoint(t);
    const r = radiusAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a), sy = Math.sin(a);
      pos.push(
        p.x + (N.x * cx + B.x * sy) * r,
        p.y + (N.y * cx + B.y * sy) * r,
        p.z + (N.z * cx + B.z * sy) * r
      );
      uvs.push(j / radial, t);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      // same outward winding as the limb tubes
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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
// The viewer's sleeve profile. The first-person arm uses the same function,
// so the sleeve and hand in game are literally the lobby character's shapes.
const sleeveProfile = (t) => {
  let r;
  if (t < 0.05) r = 0.036 + (t / 0.05) * 0.040;         // cap inside the shell
  else if (t < 0.17) r = 0.0760 - (t - 0.05) * 0.0270;   // deltoid puff
  else if (t < 0.38) r = 0.0728 - (t - 0.17) * 0.0305;   // upper arm
  else if (t < 0.53) r = 0.0664 - (t - 0.38) * 0.0390;   // elbow crease
  else if (t < 0.85) r = 0.0606 + (t - 0.53) * 0.0125;   // forearm swell
  else r = 0.0646 - ((t - 0.85) / 0.15) * 0.0170;        // wrist
  // Five chunky quilted lobes: wide enough to shade, tight enough to read
  // as a puffer sleeve. They fade out under the cuff.
  const ramp = Math.min(1, Math.max(0, (t - 0.10) / 0.07));
  const fade = Math.min(1, Math.max(0, (1 - t) / 0.12));
  const w = Math.abs(Math.sin((t - 0.17) * 6.4 * Math.PI));
  const puffed = Math.pow(w, 0.55);
  return r + (0.0080 * puffed - 0.0022 * (1 - puffed)) * ramp * fade;
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
  // The reference is wide and compact. The rig on its own reads long and
  // narrow at menu distance, so the whole character is built a little wider
  // and shorter. This is applied before the limbs are bound, so the skinning
  // matrices include it and nothing tears at the joints.
  root.scale.set(1.06, 0.94, 1.06);

  const hips = new THREE.Group();
  hips.position.y = 0.84;
  root.add(hips);

  // ---- body: one lofted jacket shell ------------------------------------
  // Hem, waist, chest, shoulders and collar are cross sections of a single
  // surface, so the silhouette is continuous from the hips to the neck.
  const torsoGroup = new THREE.Group();
  torsoGroup.position.y = 0.02;
  hips.add(torsoGroup);

  // Boxier puffer silhouette: nearly straight sides from hem to chest, real
  // shoulder width and a collar opening the head sits in. This is the shape in
  // the reference, where the jacket is wider than the hips.
  const jacketSections = [
    [-0.132, 0.209, 0.161], [-0.104, 0.208, 0.160], [-0.060, 0.205, 0.158],
    [0.000, 0.202, 0.155], [0.070, 0.203, 0.156], [0.150, 0.207, 0.159],
    [0.235, 0.213, 0.162], [0.315, 0.220, 0.165], [0.390, 0.227, 0.169],
    [0.435, 0.224, 0.167], [0.470, 0.211, 0.159], [0.500, 0.188, 0.149],
    [0.528, 0.158, 0.133], [0.552, 0.124, 0.116], [0.570, 0.104, 0.105]
  ];
  const jacketAt = (y) => {
    if (y <= jacketSections[0][0]) return [jacketSections[0][1], jacketSections[0][2]];
    for (let k = 1; k < jacketSections.length; k++) {
      const a = jacketSections[k - 1], b = jacketSections[k];
      if (y <= b[0]) {
        const t = (y - a[0]) / (b[0] - a[0] || 1);
        return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
    }
    const last = jacketSections[jacketSections.length - 1];
    return [last[1], last[2]];
  };
  // Deep marshmallow channels instead of a faint ripple: +6.8 mm on the bulge
  // and a pinched seam between them. The crease heights are reused below for
  // the stitch lines, which is what makes the jacket read as a puffer.
  const QUILT_PERIOD = 0.152;
  const QUILT_OFFSET = -0.052;
  const quiltAt = (y) => {
    const t = (y + 0.132) / 0.702;
    const env = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, t)))), 0.18);
    const w = Math.abs(Math.sin(((y - QUILT_OFFSET) / QUILT_PERIOD) * Math.PI));
    const puffed = Math.pow(w, 0.62);
    return (0.0082 * puffed - 0.0022 * (1 - puffed)) * env;
  };
  const quiltedSections = [];
  for (let i = 0; i < 68; i++) {
    const y = -0.132 + 0.702 * (i / 67);
    const base = jacketAt(y);
    const q = quiltAt(y);
    quiltedSections.push([y, base[0] + q, base[1] + q]);
  }
  const torso = add(torsoGroup, loftGeometry(quiltedSections, 36), m.jacket, [0, 0, 0]);
  torso.castShadow = true;
  // stitch seams sunk into the creases
  for (const y of [-0.052, 0.100, 0.252, 0.404]) {
    const base = jacketAt(y);
    const q = quiltAt(y);
    add(torsoGroup, loftGeometry([
      [y - 0.0016, base[0] + q + 0.0002, base[1] + q + 0.0002],
      [y, base[0] + q + 0.0010, base[1] + q + 0.0010],
      [y + 0.0016, base[0] + q + 0.0002, base[1] + q + 0.0002]
    ], 36), m.seam, [0, 0, 0]);
  }

  // ribbed hem: a darker band ends the jacket, so the torso does not read as
  // one endless blue box
  add(torsoGroup, loftGeometry([
    [-0.136, 0.212, 0.164], [-0.118, 0.213, 0.165], [-0.098, 0.208, 0.160]
  ], 36), m.jacketDark);


    // White zip, like the reference: a wide tape from hem to collar, a dark
  // tooth groove and a white slider with a hanging pull.
  const zipPts = [];
  for (let i = 0; i <= 30; i++) {
    const y = -0.124 + (0.508 + 0.124) * (i / 30);
    const d = jacketAt(y)[1] + quiltAt(y);
    zipPts.push(new THREE.Vector3(0, y, -(d + 0.0026)));
  }
  add(torsoGroup, ribbonGeometry(zipPts, 0.0060), m.scarf);
  add(torsoGroup, ribbonGeometry(zipPts.map((p) => new THREE.Vector3(p.x, p.y, p.z - 0.0008)), 0.0021), m.jacketDark);
  const zipTop = zipPts[zipPts.length - 1];

  add(torsoGroup, new THREE.BoxGeometry(0.014, 0.021, 0.007), m.sole,
    [0, zipTop.y - 0.018, zipTop.z - 0.003]);
  add(torsoGroup, new THREE.CapsuleGeometry(0.0042, 0.019, 3, 8), m.sole,
    [0, zipTop.y - 0.038, zipTop.z - 0.005]);

  // ---- neck / head ------------------------------------------------------
  // One sculpted head. Every feature sits at a measured position: eyes at the
  // socket dents, mouth in the trough, ears at the widest point of the skull.
  const neck = add(hips, new THREE.CylinderGeometry(0.050, 0.058, 0.17, 16), m.skin, [0, 0.500, -0.006]);
  neck.castShadow = false;

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.766, -0.006);
  headGroup.scale.setScalar(1.74);      // stylised, but no longer a bobblehead
  hips.add(headGroup);

  const headMesh = add(headGroup, headGeometry(), m.face, [0, 0, 0]);
  headMesh.castShadow = true;

  // Beanie on the brows, collar over nose and mouth: the only decals left are
  // the eyes. A mouth or brow decal here would sit under the knit anyway.
  const blinkers = [];
  for (const side of [-1, 1]) {
    // one patch for both open and shut, so the blink cannot slip
    const patch = decalGeometry(side * 0.0385, -0.010, -0.085, 0.046, 0.050, 24, 26);
    const openEye = new THREE.Mesh(patch, m.eyeOpen);
    openEye.renderOrder = 3;
    headGroup.add(openEye);
    const shutEye = new THREE.Mesh(patch, m.eyeClosed);
    shutEye.renderOrder = 4;
    shutEye.visible = false;
    headGroup.add(shutEye);
    blinkers.push({ open: openEye, shut: shutEye });

    // no ears: the beanie is pulled down over them, so they only risked
    // poking through the knit from a three-quarter view
  }

  // Collar pulled up over nose and mouth. It covers chin, mouth and nose,
  // meets the beanie at the temples and at the nape, and leaves exactly one
  // window open: the eye band.
  const wrap = gaiterGeometry();
  const gaiter = add(headGroup, wrap.geometry, m.jacket, [0, 0, 0]);
  gaiter.name = 'gaiter';
  gaiter.castShadow = true;
  const gaiterTrim = add(headGroup, wrap.trim, m.scarf, [0, 0, 0]);
  gaiterTrim.castShadow = false;



  // Beanie with a deep folded brim, a round crown and a fat pom. The brim is
  // wider than the dome and sits just above the black eyes; the seam under the
  // fold is the only dark line, so the hat reads as one knitted piece.
  const hatRings = [
    [0.0172, 0.0040, 0.1030, 0.1068], [0.0196, 0.0040, 0.1082, 0.1122],
    [0.0230, 0.0040, 0.1106, 0.1148], [0.0320, 0.0042, 0.1116, 0.1158],
    [0.0420, 0.0046, 0.1116, 0.1158], [0.0520, 0.0050, 0.1110, 0.1150],
    [0.0610, 0.0056, 0.1096, 0.1136], [0.0700, 0.0070, 0.1070, 0.1108],
    [0.0810, 0.0090, 0.1036, 0.1072], [0.0920, 0.0115, 0.0986, 0.1022],
    [0.1030, 0.0145, 0.0920, 0.0954], [0.1130, 0.0180, 0.0834, 0.0866],
    [0.1220, 0.0220, 0.0726, 0.0754], [0.1290, 0.0260, 0.0620, 0.0644],
    [0.1345, 0.0300, 0.0500, 0.0520], [0.1390, 0.0335, 0.0360, 0.0374],
    [0.1420, 0.0360, 0.0200, 0.0208], [0.1432, 0.0375, 0.0008, 0.0008]
  ];
  const beanie = add(headGroup, ringLoft(hatRings, 44), m.beanie, [0, 0, 0]);
  beanie.name = 'beanie';
  beanie.castShadow = true;
  // groove where the folded cuff meets the dome
  add(headGroup, loftGeometry([
    [0.0600, 0.1100, 0.1140], [0.0622, 0.1104, 0.1144], [0.0646, 0.1092, 0.1132]
  ], 44), m.beanieDark, [0, 0, 0.0052]);
  // white mountain badge on the folded brim
  const hatLogo = new THREE.Mesh(
    bendPatch(mountainLogoGeometry(0.056, 0.032), 0, 0.1108, 0.1148, -0.46, 0.0030, 0.0045),
    m.logo
  );
  hatLogo.position.y = 0.0195;
  hatLogo.castShadow = false;
  headGroup.add(hatLogo);
  // fluffy pom: a displaced ball gets the uneven silhouette a smooth sphere
  // never has
  const pomGeo = new THREE.IcosahedronGeometry(0.0365, 3);
  {
    const p = pomGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      const n = fbm2(v.x * 60 + 3, v.y * 60 + 11, 3) * 0.6 + fbm2(v.z * 95 + 7, v.x * 95 + 19, 2) * 0.4;
      v.multiplyScalar(1 + (n - 0.5) * 0.26);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    pomGeo.computeVertexNormals();
    pomGeo.computeBoundingSphere();
  }
  const pom = add(headGroup, pomGeo, m.scarf, [0, 0.1615, 0.0420], [0.15, 0, 0.1], [1.02, 0.98, 1.02]);
  pom.castShadow = true;

  // ---- collar / hood / drawstrings -------------------------------------
  // Narrow white hood lining around the jacket opening, the reference's white
  // edge between the blue hood and the mask.
  // flared so the white lining actually shows around the blue balaclava
  const collarSections = [
    [0.502, 0.193, 0.155], [0.516, 0.181, 0.147], [0.530, 0.164, 0.136],
    [0.544, 0.148, 0.124], [0.556, 0.128, 0.112], [0.568, 0.106, 0.100]
  ];
  const collar = add(torsoGroup, loftGeometry(collarSections, 30), m.scarf, [0, 0, 0]);
  collar.castShadow = true;

  // hood bunched on the shoulders behind the head
  add(torsoGroup, new THREE.SphereGeometry(1, 24, 16), m.jacket,
    [0, 0.520, 0.142], [-0.24, 0, 0], [0.156, 0.098, 0.112]);


  // white drawstrings with their cord locks, one on each side of the zip
  for (const side of [-1, 1]) {
    const cord = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.055, 0.546, -0.112),
      new THREE.Vector3(side * 0.070, 0.518, -0.160),
      new THREE.Vector3(side * 0.078, 0.478, -0.177),
      new THREE.Vector3(side * 0.075, 0.438, -0.182)
    ]);
    add(torsoGroup, new THREE.TubeGeometry(cord, 18, 0.0042, 9, false), m.scarf);
    add(torsoGroup, new THREE.CylinderGeometry(0.0104, 0.0092, 0.031, 14), m.scarf,
      [side * 0.077, 0.492, -0.172], [0.12, 0, side * 0.05]);
    add(torsoGroup, new THREE.SphereGeometry(0.0050, 9, 7), m.scarf,
      [side * 0.075, 0.453, -0.180]);
  }

  // white mountain badge on the character's left chest (screen right)
  const chestLogo = new THREE.Mesh(
    bendPatch(mountainLogoGeometry(0.068, 0.042), 0, jacketAt(0.318)[0],
      jacketAt(0.318)[1] + quiltAt(0.318) + 0.0020, -0.42, 0.0030),
    m.logo
  );
  chestLogo.position.y = 0.318;
  chestLogo.castShadow = false;
  torsoGroup.add(chestLogo);

  // ---- arms -------------------------------------------------------------
  // One continuous, skinned sleeve from shoulder to wrist. The old arm was two
  // separate tubes with a cap at the elbow, which read as a hard ring and left
  // a gap when it folded. A single tube with a weight blend across the joint
  // bends like cloth.
  // A sleeve has to read as a sleeve at menu distance: round shoulder puff,
  // upper arm, elbow crease, forearm, then the white cuff. The old profile was
  // a thin tube whose top half sat inside the jacket, so from the front only
  // the mitten showed and the arm looked like a trick drawing.
  function makeArm(side) {
    const shoulder = new THREE.Bone();
    // Pivot at the outer third of the shell and let the sleeve hang slightly
    // away from the body, so the whole arm stays outside the jacket outline
    // instead of vanishing into it at the chest.
    shoulder.position.set(side * 0.209, 0.402, 0);
    shoulder.rotation.z = side * 0.12;
    torsoGroup.add(shoulder);

    const elbow = new THREE.Bone();
    elbow.position.y = -0.30;
    shoulder.add(elbow);

    const armGeo = limbGeometry(0, 0, 0, 0.30, 0.30, sleeveProfile, { rings: 48, radial: 20, blend: 0.075 });
    const arm = new THREE.SkinnedMesh(armGeo, m.jacket);
    arm.castShadow = true; arm.receiveShadow = true;
    shoulder.add(arm);
    root.updateMatrixWorld(true);
    arm.bind(new THREE.Skeleton([shoulder, elbow]), arm.matrixWorld.clone());

    // Padded deltoid over the open top of the sleeve: it rounds off the
    // shoulder and hides the step where the arm leaves the jacket side.
    add(shoulder, new THREE.SphereGeometry(1, 22, 16), m.jacket,
      [side * 0.004, -0.055, 0], [0, 0, side * -0.08], [0.079, 0.087, 0.076]);

    // A wide ribbed knit cuff, thicker than the sleeve, then one soft mitten.
    add(elbow, new THREE.CylinderGeometry(0.0655, 0.0690, 0.064, 22), m.scarf, [0, -0.272, 0]);
    add(elbow, new THREE.TorusGeometry(0.0658, 0.0048, 8, 24), m.scarf,
      [0, -0.240, 0], [Math.PI / 2, 0, 0]);
    add(elbow, new THREE.TorusGeometry(0.0692, 0.0046, 8, 24), m.scarf,
      [0, -0.304, 0], [Math.PI / 2, 0, 0]);
    const hand = new THREE.Group();
    hand.position.y = -0.296;
    elbow.add(hand);
    add(hand, new THREE.CapsuleGeometry(0.056, 0.056, 10, 24), m.mitten,
      [0, -0.056, -0.006], [0.06, 0, 0], [1.03, 1.04, 0.92]);
    add(hand, new THREE.CapsuleGeometry(0.024, 0.044, 8, 18), m.mitten,
      [side * -0.040, -0.050, -0.014], [0.32, 0, side * 0.95], [1, 1, 0.96]);
    return { shoulder, elbow, hand };
  }
  const armR = makeArm(1);
  const armL = makeArm(-1);

  // ---- legs -------------------------------------------------------------
  // A boot sole as a real extruded footprint: flat on the snow, rounded edges
  // and a little wider than the upper. The old ring read as a white stripe.
  function soleGeometry(depth = 0.020, bevel = 0.010) {
    const s = new THREE.Shape();
    const hw = 0.078;
    s.moveTo(-hw * 0.70, 0.064);
    s.quadraticCurveTo(-hw, 0.056, -hw, 0.014);
    s.quadraticCurveTo(-hw - 0.001, -0.024, -hw * 0.92, -0.062);
    s.quadraticCurveTo(-0.058, -0.116, -0.044, -0.144);
    s.quadraticCurveTo(0, -0.162, 0.044, -0.144);
    s.quadraticCurveTo(0.058, -0.116, hw * 0.92, -0.062);
    s.quadraticCurveTo(hw + 0.001, -0.024, hw, 0.014);
    s.quadraticCurveTo(hw, 0.056, hw * 0.70, 0.064);
    s.quadraticCurveTo(0, 0.074, -hw * 0.70, 0.064);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 4, curveSegments: 16
    });
    geo.rotateX(Math.PI / 2);
    // A little toe spring: a completely flat slab reads as a skateboard, the
    // lifted front edge lets the sneaker roll off instead of clomping.
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      if (z < -0.095) {
        const t = Math.min(1, (-z - 0.095) / 0.067);
        p.setY(i, p.getY(i) + t * t * 0.007);
      }
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  // one trouser leg over a hip and a knee bone: the knee folds smoothly instead
  // of showing the seam between two separate tubes
  const legProfile = (t) => {
    if (t < 0.10) return 0.083 + t * 0.135;
    if (t < 0.42) return 0.1030 - (t - 0.10) * 0.046;
    if (t < 0.58) return 0.0883 - (t - 0.42) * 0.021;
    if (t < 0.88) return 0.0849 - (t - 0.58) * 0.030;
    return 0.0759 - (t - 0.88) * 0.072;
  };

  function makeLeg(side) {
    const hip = new THREE.Bone();
    hip.position.set(side * 0.112, -0.015, 0);
    hips.add(hip);
    const knee = new THREE.Bone();
    knee.position.y = -0.375;
    hip.add(knee);

    // The trouser leg stops inside the boot cuff. Letting the skinned tube run
    // all the way to the ankle swallowed the whole sneaker, so only the shaft
    // below the cuff was visible and the shoe read as a sock.
    const legGeo = limbGeometry(0, 0, 0, 0.375, 0.140, legProfile, { rings: 30, radial: 18, blend: 0.055 });
    const legMesh = new THREE.SkinnedMesh(legGeo, m.pants);
    legMesh.castShadow = true; legMesh.receiveShadow = true;
    hip.add(legMesh);
    root.updateMatrixWorld(true);
    legMesh.bind(new THREE.Skeleton([hip, knee]), legMesh.matrixWorld.clone());

    // Winter sneaker: high navy shaft, a light steel-blue toe box and tongue,
    // white laces, a padded white cuff and a two-layer sole. The old boot was
    // one bulbous loft on a flat white slab, with a sock band for an ankle.
    const foot = new THREE.Group();
    foot.position.y = -0.300;
    knee.add(foot);
    const bootRings = [
      [0.132, 0.000, 0.062, 0.060], [0.108, 0.000, 0.066, 0.064],
      [0.080, 0.000, 0.070, 0.070], [0.048, -0.002, 0.073, 0.077],
      [0.014, -0.008, 0.075, 0.085], [-0.020, -0.018, 0.076, 0.091],
      [-0.048, -0.034, 0.074, 0.097], [-0.072, -0.054, 0.069, 0.099],
      [-0.092, -0.076, 0.060, 0.092], [-0.105, -0.094, 0.049, 0.079],
      [-0.112, -0.106, 0.038, 0.060]
    ];
    // The tongue shares the navy upper material, so the white laces sit on
    // cloth instead of on a bright blue plaque; merging it into the shaft
    // also keeps it at zero extra draw calls.
    const boot = new THREE.Mesh(mergeParts([
      { geo: ringLoft(bootRings, 26) },
      { geo: new THREE.CapsuleGeometry(0.023, 0.062, 4, 12),
        pos: [0, 0.100, -0.083], rot: [-0.20, 0, 0], scale: [1.05, 1.08, 0.30] }
    ]), m.boot);
    boot.castShadow = true; boot.receiveShadow = true;
    foot.add(boot);

    // light-blue toe box: a cap over the lower front only, so the navy upper
    // keeps the height of the shoe instead of turning into a blue blob
    const toe = add(foot, ringLoftArc([
      [-0.060, -0.042, 0.0728, 0.0991], [-0.075, -0.058, 0.0665, 0.0998],
      [-0.092, -0.076, 0.0608, 0.0930], [-0.105, -0.094, 0.0498, 0.0800],
      [-0.112, -0.106, 0.0388, 0.0610]
    ], 22, -Math.PI / 2 - 1.02, -Math.PI / 2 + 1.02), m.bootToe, [0, 0, 0]);
    toe.castShadow = false;

    // padded white cuff with a rounded lip instead of the old flat sock band
    const trimParts = [
      { geo: new THREE.CylinderGeometry(0.0735, 0.0705, 0.052, 24), pos: [0, 0.143, 0.000] },
      { geo: new THREE.TorusGeometry(0.0695, 0.0105, 8, 24), pos: [0, 0.169, 0.000], rot: [Math.PI / 2, 0, 0] },
      { geo: new THREE.TorusGeometry(0.0715, 0.0065, 8, 24), pos: [0, 0.118, 0.000], rot: [Math.PI / 2, 0, 0] }
    ];

    // laces give the shoe a real front instead of a smooth blob; the tongue
    // is merged into the navy shaft above, so it costs no extra draw call
    for (let i = 0; i < 3; i++) {
      trimParts.push({
        geo: new THREE.CylinderGeometry(0.0028, 0.0028, 0.044, 7),
        pos: [0, 0.106 - i * 0.023, -0.0945], rot: [0, 0, Math.PI / 2]
      });
    }
    const trim = new THREE.Mesh(mergeParts(trimParts), m.scarf);
    trim.castShadow = false; trim.receiveShadow = true;
    foot.add(trim);

    // white midsole over a dark rubber outsole
    const midsole = new THREE.Mesh(soleGeometry(), m.sole);
    midsole.position.y = -0.102;
    midsole.castShadow = true; midsole.receiveShadow = true;
    foot.add(midsole);
    const outsole = new THREE.Mesh(soleGeometry(0.008, 0.003), m.rubber);
    outsole.position.y = -0.132;
    outsole.scale.set(0.992, 1, 0.992);
    outsole.castShadow = false; outsole.receiveShadow = true;
    foot.add(outsole);
    return { hip, knee, foot };
  }
  const legR = makeLeg(1);
  const legL = makeLeg(-1);

  // snowball held during the wind-up
  const heldBall = new THREE.Group();
  heldBall.visible = false;
  armR.hand.add(heldBall);
  // the ball sits in front of the mitten instead of swallowing it whole
  heldBall.position.set(0, -0.106, -0.050);
  const ballCore = add(heldBall, new THREE.IcosahedronGeometry(0.078, 2), m.snow, [0, 0, 0]);
  ballCore.castShadow = true;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.050 + Math.random() * 0.034;
    add(heldBall, new THREE.SphereGeometry(0.019 + Math.random() * 0.014, 6, 5), m.snow,
      [Math.cos(a) * r, (Math.random() - 0.5) * 0.09, Math.sin(a) * r]);
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
  // The character faces -Z, so a positive shoulder rotation swings the arm
  // forward and a positive elbow rotation folds the forearm forward. The old
  // keys had both signs inverted, which is why the arm threw itself backwards.
  const THROW_KEYS = [
    { t: 0.00, ty: 0.00, tx: 0.00, rx: 0.05, rz: 0.12, re: 0.22, rw: 0.00, lx: 0.05, lz: -0.12, dip: 0.000 },
    { t: 0.20, ty: -0.38, tx: 0.06, rx: -2.35, rz: 0.28, re: 1.25, rw: -0.30, lx: 0.52, lz: -0.26, dip: -0.035 },
    { t: 0.34, ty: 0.30, tx: -0.12, rx: 2.05, rz: 0.02, re: 0.18, rw: 0.40, lx: -0.30, lz: -0.14, dip: 0.012 },
    { t: 0.58, ty: 0.22, tx: -0.16, rx: 1.32, rz: -0.12, re: 0.34, rw: 0.18, lx: -0.16, lz: -0.08, dip: 0.004 },
    { t: 1.00, ty: 0.00, tx: 0.00, rx: 0.05, rz: 0.12, re: 0.22, rw: 0.00, lx: 0.05, lz: -0.12, dip: 0.000 }
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
      armR.shoulder.rotation.x = ease * 0.85;
      armR.shoulder.rotation.z = -ease * 0.5;
      armL.shoulder.rotation.x = ease * 0.55;
      armL.shoulder.rotation.z = ease * 0.7;
      armR.elbow.rotation.x = 0.30 + ease * 0.45;
      armL.elbow.rotation.x = 0.30;
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
    torsoGroup.rotation.x = -(0.04 + 0.09 * amp) * amp;
    torsoGroup.rotation.z = -lean * 0.14;
    torsoGroup.position.y = 0.02 + Math.sin(state.time * 1.7) * 0.004 * (1 - amp);

    // arms swing opposite the legs; elbows fold forwards as they come forward
    armL.shoulder.rotation.x = 0.05 - sp * (0.50 + 0.60 * amp) * amp;
    armR.shoulder.rotation.x = 0.05 + sp * (0.50 + 0.60 * amp) * amp;
    armL.shoulder.rotation.z = -0.12 - 0.05 * amp;
    armR.shoulder.rotation.z = 0.12 + 0.05 * amp;
    armL.elbow.rotation.x = 0.22 + Math.max(0, -sp) * 0.55 * amp;
    armR.elbow.rotation.x = 0.22 + Math.max(0, sp) * 0.55 * amp;

    // idle: a live stance instead of a mannequin — the chest fills and drops,
    // the weight shifts from foot to foot and the arms settle out of phase
    const idle = 1 - Math.min(1, amp / 0.15);
    const sway = Math.sin(state.time * 0.52);
    const breathe = Math.sin(state.time * 1.55);
    hips.position.x = sway * 0.006 * idle;
    if (idle > 0.001) {
      const settle = Math.sin(state.time * 0.52 + 1.1);
      torsoGroup.position.y += breathe * 0.006 * idle;
      torsoGroup.rotation.x += (-0.012 - breathe * 0.008) * idle;
      torsoGroup.rotation.z += sway * 0.024 * idle;
      hips.position.y += breathe * 0.003 * idle;
      hips.rotation.z += sway * 0.014 * idle;
      hips.rotation.y += sway * 0.020 * idle;
      armL.shoulder.rotation.x += (-breathe * 0.05 + settle * 0.02) * idle;
      armR.shoulder.rotation.x += (-breathe * 0.05 - settle * 0.02) * idle;
      armL.shoulder.rotation.z += (-0.01 - breathe * 0.02) * idle;
      armR.shoulder.rotation.z += (0.01 + breathe * 0.02) * idle;
      armL.elbow.rotation.x += (0.06 + breathe * 0.035) * idle;
      armR.elbow.rotation.x += (0.08 + breathe * 0.04) * idle;
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
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xe9f1fb, roughness: 0.95, metalness: 0, envMapIntensity: 0.35,
    normalMap: snowNormal(), normalScale: new THREE.Vector2(0.9, 0.9)
  });

  const group = new THREE.Group();

  // The arm enters from the lower right. Sleeve, cuff, mitten and ball are all
  // built along one local axis so the hand reads as a single limb instead of
  // the old palm blob, floating knuckle bar and separate thumb.
  const armPivot = new THREE.Group();
  armPivot.position.set(0.42, -0.56, -0.92);
  armPivot.rotation.set(0.05, -0.06, 0.30);
  group.add(armPivot);

  // The lobby arm, copied 1:1: same quilted skinned sleeve, same ribbed cuff,
  // same two-capsule mitten and thumb. It is turned upside down so the hand
  // sits at the viewmodel wrist while the shoulder runs off the bottom edge.
  const armRoot = new THREE.Group();
  armRoot.position.set(0, -0.386, 0);
  armRoot.rotation.x = Math.PI;
  armPivot.add(armRoot);

  const shoulder = new THREE.Bone();
  armRoot.add(shoulder);
  const elbow = new THREE.Bone();
  elbow.position.y = -0.30;
  shoulder.add(elbow);

  const armGeo = limbGeometry(0, 0, 0, 0.30, 0.30, sleeveProfile,
    { rings: 48, radial: 20, blend: 0.075 });
  const armMesh = new THREE.SkinnedMesh(armGeo, sleeve);
  armMesh.castShadow = false;
  shoulder.add(armMesh);
  armRoot.updateMatrixWorld(true);
  armMesh.bind(new THREE.Skeleton([shoulder, elbow]), armMesh.matrixWorld.clone());

  // Padded deltoid over the open top of the sleeve (off-screen, but it keeps
  // the sleeve closed when the arm swings).
  add(shoulder, new THREE.SphereGeometry(1, 22, 16), sleeve,
    [0.004, -0.055, 0], [0, 0, -0.08], [0.079, 0.087, 0.076]);

  // wide knit cuff with the same two rolled lips as the lobby character
  add(elbow, new THREE.CylinderGeometry(0.0655, 0.0690, 0.064, 22), trim, [0, -0.272, 0]);
  add(elbow, new THREE.TorusGeometry(0.0658, 0.0048, 8, 24), trim,
    [0, -0.240, 0], [Math.PI / 2, 0, 0]);
  add(elbow, new THREE.TorusGeometry(0.0692, 0.0046, 8, 24), trim,
    [0, -0.304, 0], [Math.PI / 2, 0, 0]);

  const hand = new THREE.Group();
  hand.position.y = -0.296;
  elbow.add(hand);
  add(hand, new THREE.CapsuleGeometry(0.056, 0.056, 10, 24), m.mitten,
    [0, -0.056, -0.006], [0.06, 0, 0], [1.03, 1.04, 0.92]);
  add(hand, new THREE.CapsuleGeometry(0.024, 0.044, 8, 18), m.mitten,
    [-0.040, -0.050, -0.014], [0.32, 0, 0.95], [1, 1, 0.96]);

  // snowball: a lumpy packed lump of snow sitting in the curl of the mitten,
  // not a white billiard ball with croutons stuck to it
  const ball = new THREE.Group();
  ball.position.set(0, 0.316, -0.026);
  armPivot.add(ball);
  const snowGeo = new THREE.IcosahedronGeometry(0.084, 4);
  {
    const pos = snowGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const n = fbm2(v.x * 18 + 17, v.y * 18 + 5, 3) * 0.65
        + fbm2(v.z * 40 + 9, v.y * 38 + 23, 2) * 0.35;
      v.multiplyScalar(1 + (n - 0.5) * 0.20);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    snowGeo.computeVertexNormals();
    snowGeo.computeBoundingSphere();
  }
  const core = add(ball, snowGeo, snowMat, [0, 0, 0]);
  core.castShadow = false;
  ball.visible = false;

  let throwT = 0;
  let bobPhase = 0;
  let charge = 0;
  let chargeTarget = 0;

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
      bobX + swayX * 0.0045 - chargePull * 0.22 - throwX + tremble,
      -bobY + swayY * 0.0040 + breathe + throwY - chargePull * 0.7,
      chargePull * 0.55 + throwZ + bobZ
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

    ball.visible = !(throwT > 0.26 && throwT < 0.82);
    const s = 0.85 + charge * 0.25;
    // squeeze the snow as the grip tightens, stretch it on release
    const stretch = throwT > 0.26 && throwT < 0.5 ? (1 - (throwT - 0.26) / 0.24) * 0.10 : 0;
    ball.scale.set(s * (1 - charge * 0.04 - stretch * 0.3), s * (1 + charge * 0.06 + stretch), s * (1 - charge * 0.04));
    ball.position.z = -0.026 - charge * 0.010;
    ball.position.y = 0.316 - charge * 0.008;
    ball.rotation.set(charge * 2.6, charge * 1.7, 0);

    // the arm coils in as the throw charges; the pivot moves towards the middle
    // on narrow screens so the hand never leaves the frame
    armPivot.rotation.set(0.05 + charge * 0.08, -0.06, 0.30);
    armPivot.position.set(
      (0.42 - charge * 0.030 + swayX * 0.002) * spread * spread,
      -0.56 - charge * 0.030 + swayY * 0.002,
      -0.92 + charge * 0.035
    );

  }

  function setVisible(v) { group.visible = v; }

  return { group, update, throwBall, setVisible };
}
