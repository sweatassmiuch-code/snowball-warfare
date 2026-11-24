// Player characters + first-person hands.
import * as THREE from '../vendor/three.module.js';

const JACKETS = [
  0x2c4660, 0x6e2f33, 0x33513f, 0x5b4429, 0x39406e, 0x74451f, 0x2f5b5e, 0x512f52
];
const SCARVES = [0xb4452f, 0xd8b24a, 0x4a7d8c, 0x9c3f4f, 0x6f8f4a, 0xc26a2c];

export function characterColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % JACKETS.length;
}

function mat(color, rough = 0.85, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02, envMapIntensity: 0.4, ...extra });
}

export function createCharacter(colorIdx) {
  const jacketColor = JACKETS[colorIdx % JACKETS.length];
  const scarfColor = SCARVES[colorIdx % SCARVES.length];

  const jacket = mat(jacketColor, 0.9);
  const pants = mat(0x232a33, 0.92);
  const skin = mat(0xc99a7b, 0.75);
  const scarf = mat(scarfColor, 0.95);
  const beanie = mat(scarfColor, 0.95);
  const dark = mat(0x14181d, 0.6);
  const leather = mat(0x1b1f24, 0.62);
  const boot = mat(0x15181b, 0.7);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  const hips = new THREE.Group();
  hips.position.y = 0.88;
  root.add(hips);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.46, 4, 12), jacket);
  torso.position.y = 0.34;
  torso.scale.set(1.08, 1, 0.92);
  torso.castShadow = true; torso.receiveShadow = true;
  hips.add(torso);

  // hood bunched behind the neck
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.235, 14, 10), jacket);
  hood.position.set(0, 0.74, 0.12);
  hood.scale.set(1, 0.9, 0.85);
  hood.castShadow = true;
  hips.add(hood);

  // backpack
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.42, 0.18), mat(0x2a3138, 0.9));
  pack.position.set(0, 0.4, 0.27);
  pack.castShadow = true;
  hips.add(pack);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.02), dark);
  strap.position.set(-0.10, 0.34, -0.235);
  hips.add(strap);

  // head
  const headGroup = new THREE.Group();
  headGroup.position.y = 0.86;
  hips.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), skin);
  head.castShadow = true;
  headGroup.add(head);

  const beanieMesh = new THREE.Mesh(new THREE.SphereGeometry(0.172, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), beanie);
  beanieMesh.position.y = 0.02;
  beanieMesh.castShadow = true;
  headGroup.add(beanieMesh);
  const beanieBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.055, 16), beanie);
  beanieBrim.position.y = 0.035;
  headGroup.add(beanieBrim);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mat(0xe8eef4, 0.95));
  pom.position.y = 0.19;
  headGroup.add(pom);

  // goggles
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.245, 0.085, 0.07), dark);
  goggles.position.set(0, 0.015, -0.135);
  goggles.castShadow = true;
  headGroup.add(goggles);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.06, 0.015), new THREE.MeshStandardMaterial({
    color: 0x74b6d8, roughness: 0.12, metalness: 0.7, envMapIntensity: 1.6
  }));
  lens.position.set(0, 0.015, -0.172);
  headGroup.add(lens);

  // scarf
  const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.055, 8, 16), scarf);
  scarfRing.rotation.x = Math.PI / 2;
  scarfRing.position.y = -0.145;
  scarfRing.castShadow = true;
  headGroup.add(scarfRing);
  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.055), scarf);
  scarfTail.position.set(0.09, -0.31, -0.1);
  scarfTail.rotation.z = 0.12;
  scarfTail.castShadow = true;
  headGroup.add(scarfTail);

  // arms
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.305, 0.72, 0);
    pivot.rotation.z = side * 0.08;
    hips.add(pivot);

    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.34, 4, 10), jacket);
    arm.position.y = -0.22;
    arm.castShadow = true;
    pivot.add(arm);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.06, 10), dark);
    cuff.position.y = -0.42;
    pivot.add(cuff);

    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), leather);
    glove.scale.set(0.9, 1.05, 1.15);
    glove.position.y = -0.5;
    glove.castShadow = true;
    pivot.add(glove);

    return { pivot, glove };
  }
  const armR = makeArm(1);
  const armL = makeArm(-1);

  // legs
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.115, 0.02, 0);
    root.add(pivot);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.52, 4, 10), pants);
    leg.position.y = -0.32;
    leg.castShadow = true;
    pivot.add(leg);

    const bootMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.28), boot);
    bootMesh.position.set(0, -0.7, -0.04);
    bootMesh.castShadow = true;
    pivot.add(bootMesh);

    return pivot;
  }
  const legR = makeLeg(1);
  const legL = makeLeg(-1);

  // snowball in the right hand, shown while winding up
  const heldBall = new THREE.Mesh(new THREE.IcosahedronGeometry(0.095, 1), new THREE.MeshStandardMaterial({
    color: 0xf4f9ff, roughness: 0.7, envMapIntensity: 0.6
  }));
  heldBall.visible = false;
  heldBall.castShadow = true;
  armR.pivot.add(heldBall);
  heldBall.position.y = -0.52;

  const state = {
    root, colorIdx,
    phase: Math.random() * 10,
    throwT: 0,
    deadProgress: 0,
    heldBall,
    armR: armR.pivot, armL: armL.pivot,
    legR, legL, headGroup, torso
  };

  function triggerThrow() { state.throwT = 0.001; }
  function setHeldBall(v) { heldBall.visible = !!v; }

  function update(dt, opts) {
    const { yaw = 0, pitch = 0, moving = false, sprinting = false, dead = false, speed = 0 } = opts || {};
    root.rotation.y = yaw;
    headGroup.rotation.x = Math.max(-0.5, Math.min(0.5, -pitch * 0.55));

    if (dead) {
      state.deadProgress = Math.min(1, state.deadProgress + dt * 2.4);
      const p = state.deadProgress;
      const ease = 1 - Math.pow(1 - p, 3);
      root.rotation.x = ease * 1.42;
      root.rotation.z = ease * 0.15;
      root.position.y = -ease * 0.18;
      state.armR.rotation.x = 0.4;
      state.armL.rotation.x = -0.5;
      state.legR.rotation.x = 0.25;
      state.legL.rotation.x = -0.15;
      return;
    }

    state.deadProgress = 0;
    root.rotation.x = 0;
    root.rotation.z = 0;
    root.position.y = 0;

    const amp = moving ? (sprinting ? 1 : 0.72) : 0;
    if (amp > 0.01) state.phase += dt * (sprinting ? 12 : 8.4);
    const swing = Math.sin(state.phase) * 0.62 * amp;
    state.legR.rotation.x = swing;
    state.legL.rotation.x = -swing;

    // idle breathing
    const breathe = Math.sin(performance.now() * 0.0018) * 0.012;
    state.torso.position.y = 0.34 + breathe;

    if (state.throwT > 0) {
      state.throwT += dt / 0.55;
      const t = Math.min(1, state.throwT);
      let angle;
      if (t < 0.35) angle = 0.95 * (t / 0.35);              // wind up
      else if (t < 0.6) angle = 0.95 - 2.85 * ((t - 0.35) / 0.25); // snap forward
      else angle = -1.9 + 1.9 * ((t - 0.6) / 0.4);
      state.armR.rotation.x = angle;
      state.armL.rotation.x = -0.25;
      if (t >= 1) state.throwT = 0;
    } else {
      state.armR.rotation.x = -swing * 0.75;
      state.armL.rotation.x = swing * 0.75;
    }

    state.armR.rotation.z = 0.08;
    state.armL.rotation.z = -0.08;
  }

  return { ...state, update, triggerThrow, setHeldBall };
}

export function makeNameTag(name, colorIdx) {
  const w = 512, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const label = name.length > 16 ? name.slice(0, 15) + '…' : name;
  ctx.font = '600 52px "Segoe UI", system-ui, sans-serif';
  const tw = Math.min(w - 90, ctx.measureText(label).width);
  const bw = tw + 86, bh = 76;
  const x = (w - bw) / 2, y = (h - bh) / 2;
  const r = 24;

  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, r);
  ctx.fillStyle = 'rgba(8,14,22,0.62)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(220,236,255,0.28)';
  ctx.stroke();

  const col = new THREE.Color(JACKETS[colorIdx % JACKETS.length]).getStyle();
  ctx.beginPath();
  ctx.arc(x + 30, y + bh / 2, 8, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();

  ctx.fillStyle = 'rgba(240,248,255,0.96)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 50, y + bh / 2 + 2, tw);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: true, fog: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.55, 0.39, 1);
  sprite.position.y = 2.16;
  sprite.renderOrder = 5;
  return sprite;
}

// ---------------------------------------------------------------------------
// First-person viewmodel
// ---------------------------------------------------------------------------
export function createViewModel() {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);

  const sleeve = mat(0x2a3c50, 0.92);
  const gloveMat = mat(0x23272c, 0.55, { envMapIntensity: 0.6 });
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xf6fbff, roughness: 0.68, metalness: 0, envMapIntensity: 0.7
  });

  const armPivot = new THREE.Group();
  armPivot.position.set(0.30, -0.32, -0.30);
  group.add(armPivot);

  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.30, 4, 10), sleeve);
  forearm.rotation.set(-1.15, 0.25, 0.25);
  forearm.position.set(0.0, -0.12, -0.06);
  armPivot.add(forearm);

  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.086, 0.05, 10), gloveMat);
  cuff.position.set(-0.04, 0.01, -0.19);
  cuff.rotation.set(-1.0, 0.2, 0.2);
  armPivot.add(cuff);

  const hand = new THREE.Group();
  hand.position.set(-0.055, 0.06, -0.24);
  armPivot.add(hand);

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.10, 0.20), gloveMat);
  palm.rotation.set(-0.25, 0.12, 0.22);
  palm.castShadow = false;
  hand.add(palm);

  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.08, 4, 8), gloveMat);
  thumb.position.set(-0.085, 0.01, -0.03);
  thumb.rotation.set(0.4, 0, 0.8);
  hand.add(thumb);

  const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.075, 0.115), gloveMat);
  fingers.position.set(0.006, -0.035, -0.085);
  fingers.rotation.set(0.2, 0, 0.22);
  hand.add(fingers);

  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.095, 2), snowMat);
  {
    const p = ball.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const f = 0.93 + Math.random() * 0.14;
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
    }
    ball.geometry.computeVertexNormals();
  }
  ball.position.set(0, 0.055, -0.12);
  ball.visible = false;
  hand.add(ball);

  // left glove, resting low
  const left = new THREE.Group();
  left.position.set(-0.34, -0.42, -0.36);
  left.rotation.set(-0.5, 0.5, -0.35);
  group.add(left);
  const lPalm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.10, 0.19), gloveMat);
  left.add(lPalm);
  const lThumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.07, 4, 8), gloveMat);
  lThumb.position.set(0.075, 0.02, -0.04);
  lThumb.rotation.z = -0.7;
  left.add(lThumb);
  const lSleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 10), sleeve);
  lSleeve.position.set(-0.02, -0.16, 0.10);
  lSleeve.rotation.set(-0.7, 0, 0.1);
  left.add(lSleeve);

  let throwT = 0;
  let bobPhase = 0;
  let charge = 0;
  let chargeTarget = 0;

  function throwBall() { throwT = 0.001; }

  function update(dt, { speed = 0, sprinting = false, charging = 0, swayX = 0, swayY = 0, grounded = true } = {}) {
    chargeTarget = charging;
    charge += (chargeTarget - charge) * Math.min(1, dt * 14);

    bobPhase += dt * (sprinting ? 11 : 7) * Math.min(1, speed / 4);
    const bobAmt = Math.min(1, speed / 5);
    const bobX = Math.sin(bobPhase) * 0.012 * bobAmt;
    const bobY = Math.abs(Math.cos(bobPhase)) * 0.014 * bobAmt;

    throwT = throwT > 0 ? throwT + dt / 0.5 : 0;
    if (throwT > 1) throwT = 0;

    let throwX = 0, throwZ = 0, throwY = 0;
    if (throwT > 0) {
      const t = throwT;
      if (t < 0.3) { throwZ = 0.18 * (t / 0.3); throwX = 0.10 * (t / 0.3); }
      else if (t < 0.62) { const k = 1 - (t - 0.3) / 0.32; throwZ = 0.18 * k - 0.30 * (1 - k); throwX = 0.10 * k; throwY = 0.22 * (1 - k); }
      else { const k = (t - 0.62) / 0.38; throwZ = -0.30 * (1 - k); throwY = 0.22 * (1 - k); }
    }

    const chargePull = charge * 0.10;
    const breathe = Math.sin(performance.now() * 0.0015) * 0.004;

    group.position.set(
      bobX + swayX * 0.006 - chargePull * 0.35 - throwX,
      -bobY + swayY * 0.005 + breathe + throwY - chargePull,
      chargePull * 0.9 + throwZ
    );
    group.rotation.set(
      -swayY * 0.02 - charge * 0.05 + throwY * 0.4,
      swayX * 0.03,
      charge * 0.12 + throwX * 0.8
    );

    if (!grounded) {
      group.position.y -= 0.03;
      group.rotation.x += 0.03;
    }

    ball.visible = charge > 0.02 || (throwT > 0 && throwT < 0.45);
    const s = 0.55 + charge * 0.5;
    ball.scale.setScalar(s);
    ball.position.z = -0.12 - charge * 0.04;
    ball.rotation.set(charge * 3, charge * 2, 0);

    // wind-up pulls the arm back a touch more
    armPivot.rotation.set(0, 0, 0);
    armPivot.position.x = 0.30 - charge * 0.03;
    armPivot.position.z = -0.30 + charge * 0.03;
  }

  function setVisible(v) { group.visible = v; }

  return { group, update, throwBall, setVisible };
}
