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
    skinShadow: new THREE.MeshStandardMaterial({
      color: new THREE.Color(skinColor).multiplyScalar(0.78), roughness: 0.7, metalness: 0,
      envMapIntensity: 0.2
    }),
    skinRed: new THREE.MeshStandardMaterial({
      color: new THREE.Color(skinColor).lerp(new THREE.Color(0xd0664f), 0.24),
      roughness: 0.6, metalness: 0, envMapIntensity: 0.3
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
    sole: new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.9, metalness: 0 }),
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
  const neck = add(hips, new THREE.CylinderGeometry(0.052, 0.06, 0.10, 12), m.skin, [0, 0.655, -0.005]);
  neck.castShadow = false;

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.758, -0.01);
  // exaggerated head size: instantly reads as a stylised character, not a mannequin
  headGroup.scale.setScalar(1.18);
  hips.add(headGroup);

  // skull + jaw
  add(headGroup, new THREE.SphereGeometry(0.107, 22, 18), m.skin, [0, 0.02, 0], null, [1.0, 1.10, 1.03]);
  add(headGroup, new THREE.SphereGeometry(0.090, 18, 14), m.skin, [0, -0.040, -0.030], null, [0.86, 0.80, 0.92]);
  // ears with a shaded inner shell
  for (const side of [-1, 1]) {
    add(headGroup, new THREE.SphereGeometry(0.028, 12, 10), m.skin, [side * 0.104, 0.004, 0.002], null, [0.5, 1.02, 0.78]);
    add(headGroup, new THREE.SphereGeometry(0.015, 8, 6), m.skinShadow, [side * 0.110, 0.002, -0.006], null, [0.34, 0.72, 0.5]);
  }
  // brow ridge and cheekbones break up the sphere of the skull
  add(headGroup, new THREE.SphereGeometry(0.101, 18, 12), m.skin, [0, 0.030, -0.020], null, [1.0, 0.46, 0.96]);
  for (const side of [-1, 1]) {
    add(headGroup, new THREE.SphereGeometry(0.028, 12, 10), m.skin, [side * 0.058, -0.008, -0.066], null, [1, 0.62, 0.4]);
  }
  // jaw and chin
  add(headGroup, new THREE.SphereGeometry(0.042, 14, 10), m.skin, [0, -0.066, -0.056], null, [0.96, 0.72, 0.68]);
  // nose: soft bridge, rounded tip, alae and nostrils
  add(headGroup, new THREE.CapsuleGeometry(0.0098, 0.036, 3, 8), m.skin, [0, 0.014, -0.0970], [-0.12, 0, 0], [1, 1, 0.8]);
  add(headGroup, new THREE.SphereGeometry(0.0142, 12, 10), m.skin, [0, -0.0125, -0.1020], null, [1.02, 0.92, 1.0]);
  for (const side of [-1, 1]) {
    add(headGroup, new THREE.SphereGeometry(0.0102, 8, 6), m.skin, [side * 0.0155, -0.0195, -0.0995], null, [1, 0.8, 0.9]);
    add(headGroup, new THREE.SphereGeometry(0.0046, 6, 5), m.skinShadow, [side * 0.0095, -0.0265, -0.1050], null, [1, 0.66, 0.5]);
  }
  // eyes: shallow sockets, open globes with irises, lids and a warm highlight
  const lids = [];
  for (const side of [-1, 1]) {
    const ex = side * 0.041;
    add(headGroup, new THREE.SphereGeometry(0.0232, 14, 12), m.skinShadow, [ex, 0.0198, -0.0892], null, [1.06, 0.82, 0.36]);
    add(headGroup, new THREE.SphereGeometry(0.0168, 16, 14), m.eyeWhite, [ex, 0.0198, -0.0978], null, [1, 0.66, 0.52]);
    add(headGroup, new THREE.SphereGeometry(0.0106, 14, 12), m.iris, [ex + side * 0.0014, 0.0188, -0.1073], null, [1, 1, 0.55]);
    add(headGroup, new THREE.SphereGeometry(0.0048, 10, 8), m.pupil, [ex + side * 0.0014, 0.0186, -0.1102], null, [1, 1, 0.55]);
    add(headGroup, new THREE.SphereGeometry(0.0029, 8, 6), m.eyeWhite, [ex + side * 0.0048, 0.0234, -0.1110], null, [1, 1, 0.6]);
    // dark lash line dominates the upper edge so the eye reads almond-shaped
    add(headGroup, new THREE.BoxGeometry(0.026, 0.0018, 0.005), m.skinShadow, [ex, 0.0262, -0.1012], [0, 0, side * 0.07]);
    // upper lid with a hooded crease, lower lid and a soft lash line
    const upperLid = add(headGroup, new THREE.SphereGeometry(0.0186, 14, 10), m.skin, [ex, 0.0296, -0.0952], [-0.24, 0, 0], [1.05, 0.56, 0.62]);
    upperLid.userData.baseY = 0.56;
    lids.push(upperLid);
    const lowerLid = add(headGroup, new THREE.SphereGeometry(0.0174, 12, 8), m.skin, [ex, 0.0106, -0.0958], [0.24, 0, 0], [1.02, 0.32, 0.55]);
    lowerLid.userData.baseY = 0.32;
    lids.push(lowerLid);
    add(headGroup, new THREE.BoxGeometry(0.029, 0.0018, 0.005), m.skinShadow, [ex, 0.0242, -0.1018], [0, 0, side * 0.06]);
    // brows follow the ridge, thicker towards the nose
    add(headGroup, new THREE.BoxGeometry(0.042, 0.0062, 0.010), m.hair, [ex, 0.0510, -0.0970], [0.06, side * 0.12, side * 0.12]);
  }
  // mouth: upper and lower lip with a soft, closed smile
  add(headGroup, new THREE.CapsuleGeometry(0.0072, 0.028, 3, 8), m.lip, [0, -0.0625, -0.0935], [0, 0, Math.PI / 2], [1, 1, 0.85]);
  add(headGroup, new THREE.CapsuleGeometry(0.0094, 0.024, 3, 8), m.lip, [0, -0.0748, -0.0915], [-0.06, 0, Math.PI / 2], [1, 1, 0.95]);
  // a curved mouth line reads as a smile instead of a flat slot
  add(headGroup, new THREE.TorusGeometry(0.030, 0.0019, 6, 18, Math.PI * 0.55), m.lipDark,
    [0, -0.0385, -0.0958], [0, 0, -Math.PI / 2 - Math.PI * 0.275]);
  for (const side of [-1, 1]) {
    add(headGroup, new THREE.SphereGeometry(0.0042, 6, 5), m.lip, [side * 0.0175, -0.0685, -0.0910], null, [1, 0.9, 0.7]);
  }
  // hair: a shell around the back and sides of the skull, open at the face
  add(headGroup, new THREE.SphereGeometry(0.111, 18, 14, 0, Math.PI, 0, Math.PI * 0.72), m.hair, [0, 0.02, 0], null, [1.0, 1.08, 1.03]);
  add(headGroup, new THREE.SphereGeometry(0.109, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.34), m.hair, [0, 0.045, 0], null, [1.0, 1.0, 1.02]);
  // loose strands peeking out under the beanie
  for (let i = 0; i < 5; i++) {
    const t = (i - 2) / 2;
    add(headGroup, new THREE.CapsuleGeometry(0.0095, 0.026, 3, 6), m.hair,
      [t * 0.048, 0.0655 - Math.abs(t) * 0.005, -0.0935], [0.42, 0, t * 0.5], [1, 1, 0.62]);
  }

  // beanie, worn above the brow line
  add(headGroup, new THREE.SphereGeometry(0.114, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), m.beanie, [0, 0.086, 0], null, [1.02, 1.02, 1.03]);
  add(headGroup, new THREE.CylinderGeometry(0.112, 0.114, 0.048, 20, 1, true), m.beanie, [0, 0.088, 0], null, [1.02, 1, 1.03]);
  add(headGroup, new THREE.SphereGeometry(0.030, 12, 10), m.snow, [0, 0.198, 0], null, [1, 0.85, 1]);
  add(headGroup, new THREE.SphereGeometry(0.018, 8, 6), m.beanie, [0.03, 0.184, -0.01]);
  // goggles pushed up on the hat: strap, frame and two round lenses
  add(headGroup, new THREE.TorusGeometry(0.1165, 0.0075, 8, 26), m.dark, [0, 0.100, 0], [Math.PI / 2, 0, 0], [1.02, 1, 1.03]);
  add(headGroup, new THREE.BoxGeometry(0.098, 0.036, 0.020), m.dark, [0, 0.1135, -0.0905], [-0.34, 0, 0]);
  for (const side of [-1, 1]) {
    add(headGroup, new THREE.CylinderGeometry(0.0295, 0.0295, 0.014, 18), m.lens, [side * 0.0295, 0.117, -0.1005], [Math.PI / 2 - 0.34, 0, 0], [1, 1, 0.9]);
    add(headGroup, new THREE.TorusGeometry(0.0295, 0.0048, 8, 18), m.dark, [side * 0.0295, 0.117, -0.1015], [Math.PI / 2 - 0.34, 0, 0]);
  }
  // frost on the brows
  add(headGroup, new THREE.SphereGeometry(0.016, 8, 6), m.snow, [-0.052, 0.072, -0.100], null, [1.4, 0.35, 0.35]);
  add(headGroup, new THREE.SphereGeometry(0.012, 8, 6), m.snow, [0.050, 0.074, -0.100], null, [1.4, 0.35, 0.35]);

  // ---- scarf ------------------------------------------------------------
  add(headGroup, new THREE.TorusGeometry(0.096, 0.036, 10, 20), m.scarf, [0, -0.118, 0], [Math.PI / 2, 0, 0], [1, 1, 0.85]);
  const scarfTail = new THREE.Group();
  scarfTail.position.set(0.055, -0.135, -0.035);
  headGroup.add(scarfTail);
  add(scarfTail, new THREE.BoxGeometry(0.085, 0.20, 0.036), m.scarf, [0.01, -0.10, 0], [0.06, 0, 0.10]);
  add(scarfTail, new THREE.BoxGeometry(0.078, 0.16, 0.032), m.scarf, [0.03, -0.26, 0.012], [0.02, 0.1, 0.18]);
  add(scarfTail, new THREE.BoxGeometry(0.062, 0.03, 0.03), m.scarf, [0.045, -0.345, 0.02], [0, 0.1, 0.2]);

  // ---- arms -------------------------------------------------------------
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.208, 0.502, 0);
    shoulder.rotation.z = side * 0.06;
    torsoGroup.add(shoulder);

    // shoulder pad
    add(shoulder, new THREE.SphereGeometry(0.062, 16, 12), m.jacket, [side * 0.003, -0.018, 0], null, [1.02, 0.94, 0.96]);
    // upper arm
    add(shoulder, new THREE.CapsuleGeometry(0.059, 0.178, 4, 14), m.jacket, [0, -0.155, 0], null, [1, 1, 0.96]);

    const elbow = new THREE.Group();
    elbow.position.y = -0.30;
    shoulder.add(elbow);
    add(elbow, new THREE.SphereGeometry(0.053, 12, 10), m.jacket, [0, 0, 0], null, [1, 1, 0.96]);
    add(elbow, new THREE.CapsuleGeometry(0.052, 0.168, 4, 14), m.jacket, [0, -0.135, 0], null, [1, 1, 0.94]);
    // knit cuff
    add(elbow, new THREE.CylinderGeometry(0.050, 0.055, 0.052, 14), m.scarf, [0, -0.245, 0]);
    // glove: chunky cartoon mitt
    const hand = new THREE.Group();
    hand.position.y = -0.285;
    hand.scale.setScalar(1.12);
    elbow.add(hand);
    add(hand, new THREE.CapsuleGeometry(0.030, 0.055, 4, 12), m.leather, [0, -0.035, -0.004], [0.1, 0, 0], [1.12, 1, 0.85]);
    add(hand, new THREE.SphereGeometry(0.032, 12, 10), m.leather, [0, 0.012, 0], null, [1.05, 0.8, 0.95]);
    for (let f = 0; f < 4; f++) {
      add(hand, new THREE.CapsuleGeometry(0.0105, 0.020, 3, 8), m.leather,
        [-0.023 + f * 0.0155, -0.078, -0.012], [0.45, 0, 0]);
      add(hand, new THREE.CapsuleGeometry(0.0085, 0.014, 3, 6), m.leather,
        [-0.023 + f * 0.0155, -0.095, -0.020], [0.9, 0, 0]);
    }
    add(hand, new THREE.CapsuleGeometry(0.014, 0.030, 3, 8), m.leather, [side * -0.040, -0.045, -0.018], [0.3, 0, side * 0.7]);
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
    // boot: oversized cartoon boot
    const foot = new THREE.Group();
    foot.position.y = -0.315;
    foot.scale.setScalar(1.13);
    knee.add(foot);
    add(foot, new THREE.BoxGeometry(0.105, 0.095, 0.135), m.boot, [0, -0.035, -0.012]);
    add(foot, new THREE.BoxGeometry(0.098, 0.072, 0.115), m.boot, [0, -0.052, -0.105], [0.08, 0, 0]);
    add(foot, new THREE.BoxGeometry(0.112, 0.032, 0.265), m.sole, [0, -0.086, -0.050]);
    add(foot, new THREE.BoxGeometry(0.100, 0.016, 0.052), m.snow, [0, -0.068, -0.160], [0.1, 0, 0]);
    add(foot, new THREE.CylinderGeometry(0.058, 0.062, 0.045, 12), m.leather, [0, 0.012, 0]);
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
        state.blinkPhase += dt / 0.15;
        const k = Math.sin(Math.min(1, state.blinkPhase) * Math.PI);
        for (const l of lids) l.scale.y = l.userData.baseY * (1 - k * 0.9);
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
  sprite.position.y = 1.96;
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
