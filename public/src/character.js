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

function bumpTexture(key, size, fn) {
  if (texCache.has(key)) return texCache.get(key);
  const c = bumpCanvas(size, fn);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// Tight woven shell fabric
const fabricBump = () => bumpTexture('fabric', 256, (x, y) => {
  const weave = Math.sin(x * 1.9) * Math.cos(y * 1.9) * 12;
  const slub = (fbm2(x * 0.06, y * 0.06, 3) - 0.5) * 40;
  const grain = (hash2(x, y) - 0.5) * 22;
  return 128 + weave + slub + grain;
});

// Ribbed knit for scarves, beanies and cuffs
const knitBump = () => bumpTexture('knit', 256, (x, y) => {
  const rib = Math.sin(x * 0.62) * 34;
  const stitch = Math.sin(y * 1.35 + Math.sin(x * 0.62) * 1.4) * 20;
  const fuzz = (hash2(x * 3, y * 3) - 0.5) * 26;
  return 128 + rib + stitch + fuzz;
});

// Pebbled leather for gloves and boots
const leatherBump = () => bumpTexture('leather', 256, (x, y) => {
  const pebble = fbm2(x * 0.24, y * 0.24, 3) * 70;
  const pores = (hash2(x * 1.7, y * 1.7) - 0.5) * 30;
  return 96 + pebble + pores;
});

// Twill denim for trousers
const denimBump = () => bumpTexture('denim', 256, (x, y) => {
  const twill = Math.sin((x + y) * 1.05) * 24;
  const slub = (fbm2(x * 0.09, y * 0.09, 2) - 0.5) * 26;
  return 128 + twill + slub;
});

// Fine pores for skin
const skinBump = () => bumpTexture('skin', 128, (x, y) => {
  const pores = fbm2(x * 0.5, y * 0.5, 3) * 46;
  const fine = (hash2(x * 2, y * 2) - 0.5) * 14;
  return 108 + pores + fine;
});

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
      bumpMap: fabricBump(), bumpScale: 0.7,
      sheen: 0.22, sheenRoughness: 0.9, sheenColor: new THREE.Color(0x7d8b99),
      envMapIntensity: 0.4
    }),
    jacketDark: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(jacketColor).multiplyScalar(0.92), roughness: 0.9, metalness: 0,
      bumpMap: fabricBump(), bumpScale: 0.7, sheen: 0.18, sheenRoughness: 0.92, envMapIntensity: 0.35
    }),
    pants: new THREE.MeshStandardMaterial({
      color: 0x2a3340, roughness: 0.93, metalness: 0,
      bumpMap: denimBump(), bumpScale: 1.0, envMapIntensity: 0.35
    }),
    scarf: new THREE.MeshPhysicalMaterial({
      color: scarfColor, roughness: 0.97, metalness: 0,
      bumpMap: knitBump(), bumpScale: 1.4,
      sheen: 0.28, sheenRoughness: 0.95, sheenColor: new THREE.Color(0xc9d2da), envMapIntensity: 0.25
    }),
    beanie: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(scarfColor).multiplyScalar(0.86),
      roughness: 0.98, metalness: 0, bumpMap: knitBump(), bumpScale: 1.5,
      sheen: 0.24, sheenRoughness: 0.96, sheenColor: new THREE.Color(0xc9d2da), envMapIntensity: 0.22
    }),
    skin: new THREE.MeshStandardMaterial({
      color: skinColor, roughness: 0.62, metalness: 0,
      bumpMap: skinBump(), bumpScale: 0.35, envMapIntensity: 0.35
    }),
    skinRed: new THREE.MeshStandardMaterial({
      color: new THREE.Color(skinColor).lerp(new THREE.Color(0xd0664f), 0.32),
      roughness: 0.6, metalness: 0, envMapIntensity: 0.3
    }),
    hair: new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.85, metalness: 0 }),
    leather: new THREE.MeshPhysicalMaterial({
      color: 0x1d2126, roughness: 0.58, metalness: 0.04,
      bumpMap: leatherBump(), bumpScale: 1.2,
      clearcoat: 0.35, clearcoatRoughness: 0.55, envMapIntensity: 0.8
    }),
    boot: new THREE.MeshPhysicalMaterial({
      color: 0x191d21, roughness: 0.66, metalness: 0.03,
      bumpMap: leatherBump(), bumpScale: 1.4, envMapIntensity: 0.55
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
    iris: new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.15, metalness: 0.1, envMapIntensity: 1.4 }),
    lip: new THREE.MeshStandardMaterial({ color: new THREE.Color(skinColor).lerp(new THREE.Color(0xa5564a), 0.55), roughness: 0.55 })
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
    [0.176, -0.06], [0.190, 0.02], [0.196, 0.12], [0.203, 0.24],
    [0.222, 0.34], [0.238, 0.44], [0.232, 0.51], [0.196, 0.56], [0.130, 0.59]
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
  add(torsoGroup, new THREE.BoxGeometry(0.055, 0.30, 0.02), m.dark, [-0.095, 0.36, -0.155], [0, 0, 0.06]);
  add(torsoGroup, new THREE.BoxGeometry(0.055, 0.30, 0.02), m.dark, [0.095, 0.36, -0.155], [0, 0, -0.06]);
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
  headGroup.position.set(0, 0.735, -0.01);
  hips.add(headGroup);

  // skull + jaw
  add(headGroup, new THREE.SphereGeometry(0.107, 22, 18), m.skin, [0, 0.02, 0], null, [1.0, 1.10, 1.03]);
  add(headGroup, new THREE.SphereGeometry(0.090, 18, 14), m.skin, [0, -0.040, -0.030], null, [0.86, 0.80, 0.92]);
  // ears
  add(headGroup, new THREE.SphereGeometry(0.026, 10, 8), m.skin, [-0.106, 0.004, 0.002], null, [0.55, 1, 0.8]);
  add(headGroup, new THREE.SphereGeometry(0.026, 10, 8), m.skin, [0.106, 0.004, 0.002], null, [0.55, 1, 0.8]);
  // nose: bridge + tip standing proud of the face plane
  add(headGroup, new THREE.BoxGeometry(0.020, 0.058, 0.030), m.skin, [0, 0.008, -0.098], [0.18, 0, 0]);
  add(headGroup, new THREE.ConeGeometry(0.021, 0.055, 8), m.skin, [0, -0.010, -0.108], [-1.32, 0, 0]);
  add(headGroup, new THREE.SphereGeometry(0.020, 10, 8), m.skin, [0, -0.030, -0.112], null, [1, 0.85, 0.9]);
  // brows
  add(headGroup, new THREE.BoxGeometry(0.046, 0.012, 0.014), m.hair, [-0.042, 0.058, -0.099], [0, 0.06, 0.14]);
  add(headGroup, new THREE.BoxGeometry(0.046, 0.012, 0.014), m.hair, [0.042, 0.058, -0.099], [0, -0.06, -0.14]);
  // eyes, sitting just proud of the skull so they read at range
  for (const side of [-1, 1]) {
    add(headGroup, new THREE.SphereGeometry(0.0175, 14, 12), m.eyeWhite, [side * 0.040, 0.020, -0.100], null, [1, 0.78, 0.45]);
    add(headGroup, new THREE.SphereGeometry(0.0080, 10, 8), m.iris, [side * 0.040, 0.019, -0.109], null, [1, 1, 0.45]);
    add(headGroup, new THREE.SphereGeometry(0.0032, 8, 6), m.snow, [side * 0.043, 0.023, -0.114], null, [1, 1, 0.5]);
    // cold-flushed cheeks
    add(headGroup, new THREE.SphereGeometry(0.030, 10, 8), m.skinRed, [side * 0.060, -0.028, -0.084], null, [1, 0.55, 0.28]);
  }
  // mouth
  add(headGroup, new THREE.BoxGeometry(0.042, 0.011, 0.012), m.lip, [0, -0.070, -0.092], [0.12, 0, 0]);
  // hair: a shell around the back and sides of the skull, open at the face
  add(headGroup, new THREE.SphereGeometry(0.111, 18, 14, 0, Math.PI, 0, Math.PI * 0.72), m.hair, [0, 0.02, 0], null, [1.0, 1.08, 1.03]);
  add(headGroup, new THREE.SphereGeometry(0.109, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.34), m.hair, [0, 0.045, 0], null, [1.0, 1.0, 1.02]);

  // beanie, worn above the brow line
  add(headGroup, new THREE.SphereGeometry(0.116, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), m.beanie, [0, 0.070, 0], null, [1.02, 1.06, 1.03]);
  add(headGroup, new THREE.CylinderGeometry(0.118, 0.118, 0.055, 20, 1, true), m.beanie, [0, 0.080, 0], null, [1.02, 1, 1.03]);
  add(headGroup, new THREE.SphereGeometry(0.030, 12, 10), m.snow, [0, 0.198, 0], null, [1, 0.85, 1]);
  add(headGroup, new THREE.SphereGeometry(0.018, 8, 6), m.beanie, [0.03, 0.184, -0.01]);
  // goggles pushed up on the hat
  add(headGroup, new THREE.TorusGeometry(0.118, 0.011, 8, 24), m.dark, [0, 0.100, 0], [Math.PI / 2, 0, 0], [1.02, 1, 1.03]);
  add(headGroup, new THREE.BoxGeometry(0.105, 0.046, 0.028), m.dark, [0, 0.122, -0.092], [-0.32, 0, 0]);
  add(headGroup, new THREE.BoxGeometry(0.088, 0.032, 0.010), m.lens, [0, 0.124, -0.106], [-0.32, 0, 0]);
  // frost on the brows
  add(headGroup, new THREE.SphereGeometry(0.016, 8, 6), m.snow, [-0.052, 0.072, -0.100], null, [1.4, 0.35, 0.35]);
  add(headGroup, new THREE.SphereGeometry(0.012, 8, 6), m.snow, [0.050, 0.074, -0.100], null, [1.4, 0.35, 0.35]);

  // ---- scarf ------------------------------------------------------------
  add(headGroup, new THREE.TorusGeometry(0.098, 0.042, 10, 20), m.scarf, [0, -0.108, 0], [Math.PI / 2, 0, 0], [1, 1, 0.85]);
  const scarfTail = new THREE.Group();
  scarfTail.position.set(0.055, -0.135, -0.035);
  headGroup.add(scarfTail);
  add(scarfTail, new THREE.BoxGeometry(0.085, 0.20, 0.036), m.scarf, [0.01, -0.10, 0], [0.06, 0, 0.10]);
  add(scarfTail, new THREE.BoxGeometry(0.078, 0.16, 0.032), m.scarf, [0.03, -0.26, 0.012], [0.02, 0.1, 0.18]);
  add(scarfTail, new THREE.BoxGeometry(0.062, 0.03, 0.03), m.scarf, [0.045, -0.345, 0.02], [0, 0.1, 0.2]);

  // ---- arms -------------------------------------------------------------
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.228, 0.500, 0);
    shoulder.rotation.z = side * 0.06;
    torsoGroup.add(shoulder);

    // shoulder pad
    add(shoulder, new THREE.SphereGeometry(0.079, 14, 10), m.jacket, [side * 0.004, -0.020, 0], null, [1.02, 0.92, 0.96]);
    // upper arm
    add(shoulder, new THREE.CapsuleGeometry(0.067, 0.175, 4, 12), m.jacket, [0, -0.155, 0], null, [1, 1, 0.96]);

    const elbow = new THREE.Group();
    elbow.position.y = -0.30;
    shoulder.add(elbow);
    add(elbow, new THREE.CapsuleGeometry(0.060, 0.165, 4, 12), m.jacket, [0, -0.135, 0], null, [1, 1, 0.94]);
    // knit cuff
    add(elbow, new THREE.CylinderGeometry(0.058, 0.063, 0.055, 12), m.scarf, [0, -0.245, 0]);
    // glove
    const hand = new THREE.Group();
    hand.position.y = -0.285;
    elbow.add(hand);
    add(hand, new THREE.BoxGeometry(0.070, 0.095, 0.055), m.leather, [0, -0.035, -0.004], [0.1, 0, 0]);
    add(hand, new THREE.BoxGeometry(0.062, 0.045, 0.048), m.leather, [0, 0.012, 0]);
    for (let f = 0; f < 4; f++) {
      add(hand, new THREE.CapsuleGeometry(0.0115, 0.032, 3, 8), m.leather,
        [-0.024 + f * 0.016, -0.083, -0.012], [0.45, 0, 0]);
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
    add(hip, new THREE.CapsuleGeometry(0.092, 0.235, 4, 12), m.pants, [0, -0.195, 0], null, [1, 1, 0.95]);

    const knee = new THREE.Group();
    knee.position.y = -0.415;
    hip.add(knee);
    // knee reinforcement hides the joint seam and reads as fabric padding
    add(knee, new THREE.SphereGeometry(0.080, 12, 8), m.pants, [0, 0.005, -0.006], null, [1, 0.62, 0.95]);
    add(knee, new THREE.CapsuleGeometry(0.075, 0.205, 4, 12), m.pants, [0, -0.155, 0], null, [1, 1, 0.94]);
    // boot
    const foot = new THREE.Group();
    foot.position.y = -0.315;
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
    throwT: 0,
    deadProgress: 0,
    deadSide: Math.random() < 0.5 ? -1 : 1,
    heldBall,
    torsoGroup, headGroup,
    armR, armL, legR, legL,
    scarfTail
  };

  function triggerThrow() { state.throwT = 0.0001; }
  function setHeldBall(v) { heldBall.visible = !!v; }

  function update(dt, opts) {
    const { yaw = 0, pitch = 0, moving = false, sprinting = false, dead = false } = opts || {};
    state.time += dt;
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
      return;
    }

    state.deadProgress = 0;
    root.rotation.x = 0;
    root.rotation.z = 0;
    hips.position.y = 0.92;

    const amp = moving ? (sprinting ? 1 : 0.7) : 0;
    if (amp > 0.001) state.phase += dt * (sprinting ? 13.2 : 9.0);
    else state.phase += dt * 1.4;
    const swing = Math.sin(state.phase) * (sprinting ? 0.78 : 0.58) * amp;

    // legs with knee flexion on the backswing
    legL.hip.rotation.x = swing;
    legR.hip.rotation.x = -swing;
    legL.knee.rotation.x = -Math.max(0, -Math.sin(state.phase + 0.5)) * (sprinting ? 1.25 : 0.95) * amp;
    legR.knee.rotation.x = -Math.max(0, Math.sin(state.phase + 0.5)) * (sprinting ? 1.25 : 0.95) * amp;
    legL.foot.rotation.x = Math.max(0, Math.sin(state.phase)) * 0.35 * amp;
    legR.foot.rotation.x = Math.max(0, -Math.sin(state.phase)) * 0.35 * amp;

    // hips bob and counter-rotation
    const bob = Math.abs(Math.sin(state.phase)) * 0.026 * amp;
    hips.position.y = 0.92 + bob;
    hips.rotation.y = swing * 0.10;

    // torso twist + lean into the run
    torsoGroup.rotation.y = -swing * 0.16;
    torsoGroup.rotation.x = (moving ? 0.06 + (sprinting ? 0.07 : 0) : 0) + Math.sin(state.time * 1.6) * 0.006;
    headGroup.rotation.y = swing * 0.10;

    // arms counter-swing, elbows always slightly bent
    const armAmp = moving ? (sprinting ? 1.15 : 0.8) : 0;
    armL.shoulder.rotation.x = -swing * armAmp;
    armR.shoulder.rotation.x = swing * armAmp;
    armL.shoulder.rotation.z = -0.06 - Math.sin(state.phase) * 0.03 * armAmp;
    armR.shoulder.rotation.z = 0.06 + Math.sin(state.phase) * 0.03 * armAmp;
    armL.elbow.rotation.x = -0.32 - (sprinting ? 0.55 : 0.18) * armAmp;
    armR.elbow.rotation.x = -0.32 - (sprinting ? 0.55 : 0.18) * armAmp;

    // idle breathing + weight shift
    if (!moving) {
      const breathe = Math.sin(state.time * 1.7);
      torsoGroup.position.y = 0.02 + breathe * 0.004;
      torsoGroup.rotation.z = Math.sin(state.time * 0.8) * 0.012;
      armL.shoulder.rotation.x += breathe * 0.02;
      armR.shoulder.rotation.x -= breathe * 0.02;
    } else {
      torsoGroup.position.y = 0.02;
      torsoGroup.rotation.z = 0;
    }

    // throw animation
    if (state.throwT > 0) {
      state.throwT += dt / 0.52;
      const t = Math.min(1, state.throwT);
      let angle, elbow, wrist;
      if (t < 0.32) {
        const k = t / 0.32;
        angle = 1.05 * k; elbow = -0.32 - 1.15 * k; wrist = -0.2 * k;
      } else if (t < 0.58) {
        const k = (t - 0.32) / 0.26;
        angle = 1.05 - 2.55 * k; elbow = -1.47 + 1.30 * k; wrist = -0.2 + 0.5 * k;
      } else {
        const k = (t - 0.58) / 0.42;
        angle = -1.5 + 1.5 * k; elbow = -0.17 - 0.15 * k; wrist = 0.3 * (1 - k);
      }
      armR.shoulder.rotation.x = angle;
      armR.shoulder.rotation.z = 0.06 + 0.22 * Math.sin(t * Math.PI);
      armR.elbow.rotation.x = elbow;
      armR.hand.rotation.x = wrist;
      torsoGroup.rotation.y = 0.22 * Math.sin(t * Math.PI) - 0.16 * Math.max(0, (t - 0.5) / 0.5);
      if (t >= 1) { state.throwT = 0; armR.hand.rotation.x = 0; }
    }

    // scarf tail flutter
    const flutter = Math.sin(state.time * 3.4) * 0.06 + Math.sin(state.time * 7.1) * 0.02;
    state.scarfTail.rotation.x = -0.05 - (moving ? (sprinting ? 0.55 : 0.3) : 0) - flutter * (0.4 + amp);
    state.scarfTail.rotation.z = flutter * 0.8;
  }

  return { ...state, update, triggerThrow, setHeldBall };
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

  const palm = add(hand, new THREE.CapsuleGeometry(0.062, 0.085, 4, 12), glove, [0, 0, -0.02], [-1.22, 0.10, 0.16]);
  palm.castShadow = false;
  add(hand, new THREE.SphereGeometry(0.058, 12, 10), glove, [0.006, 0.026, -0.058], null, [1.05, 0.7, 0.95]);
  const thumb = add(hand, new THREE.CapsuleGeometry(0.028, 0.055, 4, 8), glove,
    [-0.078, 0.012, -0.028], [0.35, 0, 0.75]);
  thumb.castShadow = false;
  // fingers wrap around the ball
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    fingers.push(add(hand, new THREE.CapsuleGeometry(0.019, 0.050, 3, 8), glove,
      [0.044 - i * 0.004, -0.028 - i * 0.004, -0.070 + i * 0.008], [1.15, 0, 0.12]));
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
  const lPalm = add(left, new THREE.BoxGeometry(0.140, 0.088, 0.175), glove, [0, 0, 0]);
  lPalm.castShadow = false;
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

    bobPhase += dt * (sprinting ? 12 : 7.4) * Math.min(1, speed / 4);
    const bobAmt = Math.min(1, speed / 5.2);
    const bobX = Math.sin(bobPhase) * 0.014 * bobAmt;
    const bobY = Math.abs(Math.cos(bobPhase)) * 0.016 * bobAmt;

    throwT = throwT > 0 ? throwT + dt / 0.46 : 0;
    if (throwT > 1) throwT = 0;

    let throwX = 0, throwY = 0, throwZ = 0;
    if (throwT > 0) {
      const t = throwT;
      if (t < 0.3) {
        const k = t / 0.3;
        throwZ = 0.20 * k; throwX = 0.11 * k;
      } else if (t < 0.62) {
        const k = 1 - (t - 0.3) / 0.32;
        throwZ = 0.20 * k - 0.34 * (1 - k);
        throwX = 0.11 * k;
        throwY = 0.24 * (1 - k);
      } else {
        const k = (t - 0.62) / 0.38;
        throwZ = -0.34 * (1 - k);
        throwY = 0.24 * (1 - k);
      }
    }

    const tremble = charge > 0.9 ? (Math.random() - 0.5) * 0.006 * (charge - 0.9) * 10 : 0;
    const chargePull = charge * 0.095;
    const breathe = Math.sin(performance.now() * 0.0015) * 0.004;

    group.position.set(
      bobX + swayX * 0.0055 - chargePull * 0.32 - throwX + tremble,
      -bobY + swayY * 0.0048 + breathe + throwY - chargePull,
      chargePull * 0.85 + throwZ
    );
    group.rotation.set(
      -swayY * 0.018 - charge * 0.045 + throwY * 0.38,
      swayX * 0.028,
      charge * 0.11 + throwX * 0.75
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

    ball.visible = !(throwT > 0.28 && throwT < 0.8);
    const s = 0.62 + charge * 0.46;
    ball.scale.setScalar(s);
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

    left.rotation.z = -0.30 + Math.sin(bobPhase * 0.5) * 0.02 * bobAmt;
    left.position.y = -0.62 + bobY * 0.4;
  }

  function setVisible(v) { group.visible = v; }

  return { group, update, throwBall, setVisible };
}
