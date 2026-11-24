// Snow FX: particles, powder puffs, footprints, impact splats, trails.
import * as THREE from '../vendor/three.module.js';
import { terrainHeight } from '../shared/world.js';

function softDiscTexture(size = 128, hardness = 0.0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35 + hardness, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function footprintTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  // sole
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.roundRect(size * 0.30, size * 0.10, size * 0.40, size * 0.78, size * 0.16);
  ctx.fill();
  // tread lines
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(size * 0.32, size * (0.20 + i * 0.10), size * 0.36, size * 0.035);
  }
  ctx.globalCompositeOperation = 'source-over';
  // toe/heel pressure
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(size * 0.5, size * 0.82, size * 0.18, size * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function splatTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.44);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2);
  ctx.fill();
  // ejecta blobs
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = size * (0.30 + Math.random() * 0.17);
    const rad = size * (0.02 + Math.random() * 0.055);
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createEffects(scene, quality = 'high') {
  const q = quality === 'low' ? 0 : quality === 'mid' ? 1 : 2;
  const MAX_PARTICLES = q === 0 ? 420 : q === 1 ? 900 : 1500;

  // -------------------------------------------------------------------------
  // Snow particles
  // -------------------------------------------------------------------------
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pAlpha = new Float32Array(MAX_PARTICLES);
  const pSize = new Float32Array(MAX_PARTICLES);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  pGeo.setDrawRange(0, 0);

  const particleMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: softDiscTexture(64, 0.1) }, uScale: { value: 500 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aAlpha;
      attribute float aSize;
      uniform float uScale;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, aSize * uScale / max(0.2, -mv.z));
        gl_Position = projectionMatrix * mv;
        vAlpha = aAlpha;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      varying float vAlpha;
      void main() {
        vec4 t = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(0.95, 0.975, 1.0, t.a * vAlpha);
        if (gl_FragColor.a < 0.01) discard;
      }
    `
  });
  const particles = new THREE.Points(pGeo, particleMat);
  particles.frustumCulled = false;
  particles.renderOrder = 4;
  scene.add(particles);

  const pool = [];
  const active = [];
  for (let i = 0; i < MAX_PARTICLES; i++) pool.push({ i, life: 0, max: 1, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, size: 0.06, drag: 1.6, gravity: 5 });

  function spawnParticle(x, y, z, vx, vy, vz, size, life, gravity = 5, drag = 1.8) {
    if (pool.length === 0) return;
    const p = pool.pop();
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size; p.life = life; p.max = life;
    p.gravity = gravity; p.drag = drag;
    active.push(p);
  }

  function burst(x, y, z, { count = 16, speed = 2.4, up = 1.6, size = 0.05, life = 0.9, gravity = 6, spread = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.25 + Math.random() * 0.75);
      const vy = up * (0.35 + Math.random() * 0.9);
      spawnParticle(
        x + (Math.random() - 0.5) * 0.12 * spread,
        y + (Math.random() - 0.5) * 0.1 * spread,
        z + (Math.random() - 0.5) * 0.12 * spread,
        Math.cos(a) * s, vy, Math.sin(a) * s,
        size * (0.5 + Math.random() * 1.2),
        life * (0.5 + Math.random() * 0.8),
        gravity, 2.4
      );
    }
  }

  // -------------------------------------------------------------------------
  // Puff sprites
  // -------------------------------------------------------------------------
  const puffTex = softDiscTexture(128);
  const puffs = [];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.SpriteMaterial({
      map: puffTex, transparent: true, opacity: 0, depthWrite: false,
      color: 0xf3f9ff, fog: true
    });
    const s = new THREE.Sprite(m);
    s.visible = false;
    s.renderOrder = 3;
    scene.add(s);
    puffs.push({ s, life: 0, max: 1, scale: 1, rise: 0.4 });
  }

  function spawnPuff(x, y, z, scale = 0.8, life = 0.85, opacity = 0.55, rise = 0.5) {
    let slot = puffs.find(p => p.life <= 0);
    if (!slot) slot = puffs[0];
    slot.life = life; slot.max = life;
    slot.scale = scale; slot.rise = rise;
    slot.s.visible = true;
    slot.s.position.set(x, y, z);
    slot.s.material.opacity = opacity;
    slot.s.scale.set(scale * 0.4, scale * 0.4, 1);
  }

  // -------------------------------------------------------------------------
  // Footprints
  // -------------------------------------------------------------------------
  const MAX_PRINTS = q === 0 ? 70 : 160;
  const printGeo = new THREE.PlaneGeometry(0.34, 0.46);
  printGeo.rotateX(-Math.PI / 2);
  const printMat = new THREE.MeshStandardMaterial({
    color: 0x9fb4c8,
    alphaMap: footprintTexture(),
    transparent: true,
    opacity: 0.5,
    roughness: 0.95,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const prints = new THREE.InstancedMesh(printGeo, printMat, MAX_PRINTS);
  prints.receiveShadow = true;
  prints.frustumCulled = false;
  const dummy = new THREE.Object3D();
  let printIdx = 0;
  dummy.scale.set(0, 0, 0);
  dummy.updateMatrix();
  for (let i = 0; i < MAX_PRINTS; i++) prints.setMatrixAt(i, dummy.matrix);
  prints.instanceMatrix.needsUpdate = true;
  scene.add(prints);

  function addFootprint(x, z, yaw, side) {
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    const px = x + rightX * side * 0.13;
    const pz = z + rightZ * side * 0.13;
    const y = terrainHeight(px, pz) + 0.018;
    dummy.position.set(px, y, pz);
    dummy.rotation.set(0, yaw + (Math.random() - 0.5) * 0.12, 0);
    const sc = 0.85 + Math.random() * 0.2;
    dummy.scale.set(sc, 1, sc);
    dummy.updateMatrix();
    prints.setMatrixAt(printIdx, dummy.matrix);
    prints.instanceMatrix.needsUpdate = true;
    printIdx = (printIdx + 1) % MAX_PRINTS;
  }

  // -------------------------------------------------------------------------
  // Impact splats
  // -------------------------------------------------------------------------
  const MAX_SPLATS = 28;
  const splatGeo = new THREE.PlaneGeometry(1, 1);
  splatGeo.rotateX(-Math.PI / 2);
  const splatMat = new THREE.MeshStandardMaterial({
    color: 0xeaf4ff, alphaMap: splatTexture(), transparent: true, opacity: 0.85,
    roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3
  });
  const splats = new THREE.InstancedMesh(splatGeo, splatMat, MAX_SPLATS);
  splats.frustumCulled = false;
  let splatIdx = 0;
  for (let i = 0; i < MAX_SPLATS; i++) {
    dummy.position.set(0, -999, 0); dummy.scale.set(0.001, 1, 0.001); dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix(); splats.setMatrixAt(i, dummy.matrix);
  }
  scene.add(splats);

  function addSplat(x, z, scale = 1) {
    const y = terrainHeight(x, z) + 0.025;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.set(scale * (0.7 + Math.random() * 0.5), 1, scale * (0.7 + Math.random() * 0.5));
    dummy.updateMatrix();
    splats.setMatrixAt(splatIdx, dummy.matrix);
    splats.instanceMatrix.needsUpdate = true;
    splatIdx = (splatIdx + 1) % MAX_SPLATS;
  }

  // -------------------------------------------------------------------------
  // Snowball mesh factory
  // -------------------------------------------------------------------------
  const ballGeo = new THREE.IcosahedronGeometry(0.105, 2);
  {
    const p = ballGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const f = 0.94 + Math.random() * 0.12;
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
    }
    ballGeo.computeVertexNormals();
  }
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xf5faff, roughness: 0.72, metalness: 0, envMapIntensity: 0.65
  });

  function createBallMesh() {
    const m = new THREE.Mesh(ballGeo, ballMat);
    m.castShadow = true;
    return m;
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------
  let writeIdx = 0;

  function update(dt, camera) {
    writeIdx = 0;
    for (let k = active.length - 1; k >= 0; k--) {
      const p = active[k];
      p.life -= dt;
      if (p.life <= 0) {
        active.splice(k, 1);
        pool.push(p);
        continue;
      }
      const dragF = Math.max(0, 1 - p.drag * dt);
      p.vx *= dragF; p.vz *= dragF;
      p.vy = p.vy * dragF - p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

      const ground = terrainHeight(p.x, p.z);
      if (p.y < ground + 0.01) {
        p.y = ground + 0.01;
        p.vy = 0; p.vx *= 0.5; p.vz *= 0.5;
        p.life = Math.min(p.life, 0.25);
      }

      const idx = writeIdx++;
      pPos[idx * 3] = p.x;
      pPos[idx * 3 + 1] = p.y;
      pPos[idx * 3 + 2] = p.z;
      pAlpha[idx] = Math.min(1, (p.life / p.max) * 1.4);
      pSize[idx] = p.size;
    }

    pGeo.setDrawRange(0, writeIdx);
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aAlpha.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;

    for (const p of puffs) {
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.life -= dt;
      const t = 1 - p.life / p.max;
      const sc = p.scale * (0.35 + t * 1.35);
      p.s.scale.set(sc, sc, 1);
      p.s.position.y += p.rise * dt * (1 - t);
      p.s.material.opacity = Math.max(0, (1 - t) * (1 - t)) * 0.6;
      if (p.life <= 0) p.s.visible = false;
    }
  }

  function impact(x, y, z, kind) {
    if (kind === 'body') {
      burst(x, y, z, { count: 30, speed: 3.1, up: 2.0, size: 0.07, life: 1.0, gravity: 7, spread: 1.6 });
      spawnPuff(x, y, z, 1.4, 0.9, 0.7, 0.8);
    } else if (kind === 'object') {
      burst(x, y, z, { count: 18, speed: 2.2, up: 1.4, size: 0.05, life: 0.8, gravity: 6 });
      spawnPuff(x, y, z, 0.8, 0.6, 0.45, 0.3);
    } else {
      burst(x, y, z, { count: 20, speed: 2.0, up: 1.6, size: 0.055, life: 0.9, gravity: 6 });
      spawnPuff(x, y, z, 0.7, 0.7, 0.4, 0.5);
      addSplat(x, z, 0.9);
    }
  }

  function deathBurst(x, y, z) {
    burst(x, y + 1.0, z, { count: 46, speed: 2.8, up: 2.4, size: 0.07, life: 1.4, gravity: 5.5, spread: 2 });
    spawnPuff(x, y + 1.0, z, 1.9, 1.3, 0.75, 1.1);
    spawnPuff(x, y + 0.4, z, 1.4, 1.0, 0.5, 0.7);
  }

  function footstep(x, z, yaw, side) {
    addFootprint(x, z, yaw, side);
    burst(x, z === undefined ? 0 : terrainHeight(x, z) + 0.04, z, {
      count: 3, speed: 0.6, up: 0.9, size: 0.04, life: 0.5, gravity: 3.2, spread: 0.6
    });
  }

  function trail(x, y, z) {
    spawnParticle(x, y, z, (Math.random() - 0.5) * 0.15, 0.1 + Math.random() * 0.2, (Math.random() - 0.5) * 0.15, 0.022 + Math.random() * 0.02, 0.4, 0.4, 1.2);
  }

  function breath(x, y, z, dx, dz) {
    spawnPuff(x, y, z, 0.45, 1.1, 0.3, 0.6);
    burst(x, y, z, { count: 2, speed: 0.5, up: 0.3, size: 0.05, life: 0.7, gravity: -0.2, spread: 0.4 });
  }

  return {
    update, burst, spawnPuff, impact, deathBurst, footstep, trail, breath,
    createBallMesh, addFootprint, addSplat
  };
}
