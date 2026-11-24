// Shared world definition — used by the server (authoritative physics) and the client (rendering).
// Everything here must stay deterministic so both sides agree on terrain and collision.

export const WORLD = {
  size: 300,          // visual terrain size
  half: 150,
  playRadius: 98,     // players are kept inside this radius
  spawnSafeTime: 1500 // ms of spawn protection
};

export const PLAYER = {
  radius: 0.36,
  height: 1.82,
  eye: 1.62,
  walk: 5.0,
  sprint: 7.6,
  jump: 5.0,
  accel: 34,
  friction: 11
};

export const BALL = {
  radius: 0.105,
  minSpeed: 14,
  maxSpeed: 34,
  gravity: 7.6,      // slightly reduced gravity for readable arcs
  maxLife: 7
};

export const POND = { x: 8, z: -30, r: 20, level: -0.9 };

export const WIN_SCORE = 15;
export const RESPAWN_MS = 3200;

// ---------------------------------------------------------------------------
// Deterministic value noise
// ---------------------------------------------------------------------------
function hash2(ix, iy) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

export function fbm(x, y, octaves = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += amp * vnoise(x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
export const SPAWNS = [
  { x: 0, z: 58 }, { x: 62, z: 22 }, { x: -58, z: 34 }, { x: 48, z: -62 },
  { x: -44, z: -58 }, { x: 78, z: -18 }, { x: -76, z: -8 }, { x: 16, z: 84 }
];

function terrainBase(x, z) {
  let h = 0;
  h += fbm(x * 0.010, z * 0.010, 5) * 9.5;
  h += fbm(x * 0.036 + 5.2, z * 0.036 - 3.1, 3) * 1.9;
  h += Math.sin(x * 0.045 + z * 0.031) * 0.35;
  return h - 5.1;
}

const spawnLevels = SPAWNS.map(s => terrainBase(s.x, s.z));

export function terrainHeight(x, z) {
  let h = terrainBase(x, z);

  // Frozen pond: flatten to a clean ice level with a soft bank
  const pd = Math.hypot(x - POND.x, z - POND.z);
  const pt = smoothstep(POND.r * 0.88, POND.r * 1.5, pd);
  h = lerp(POND.level, h, pt);

  // Flat pads at spawn points
  for (let i = 0; i < SPAWNS.length; i++) {
    const s = SPAWNS[i];
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < 9) {
      const t = smoothstep(3.5, 9, d);
      h = lerp(spawnLevels[i], h, t);
    }
  }
  return h;
}

export function terrainNormal(x, z, eps = 0.6) {
  const hL = terrainHeight(x - eps, z), hR = terrainHeight(x + eps, z);
  const hD = terrainHeight(x, z - eps), hU = terrainHeight(x, z + eps);
  const nx = hL - hR, nz = hD - hU, ny = 2 * eps;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

// ---------------------------------------------------------------------------
// Static obstacles (also rendered by the client)
// ---------------------------------------------------------------------------
const rawObstacles = [
  { kind: 'cabin', x: -38, z: 4, w: 8.2, d: 6.0, h: 3.9 },
  { kind: 'crate', x: -30.2, z: 9.8, w: 1.2, d: 1.2, h: 1.2, rot: 0.3 },
  { kind: 'crate', x: -31.6, z: 8.2, w: 1.0, d: 1.0, h: 1.0, rot: -0.5 },
  { kind: 'crate', x: -29.0, z: 7.0, w: 1.4, d: 1.0, h: 1.6, rot: 0.9 },
  { kind: 'rock', x: 28, z: 16, w: 4.2, d: 3.6, h: 2.4 },
  { kind: 'rock', x: 34, z: 21, w: 3.0, d: 2.6, h: 1.7 },
  { kind: 'rock', x: -18, z: -62, w: 3.6, d: 3.0, h: 2.0 },
  { kind: 'rock', x: 58, z: 48, w: 3.2, d: 3.2, h: 1.8 }
];

export const OBSTACLES = rawObstacles.map(o => {
  const hs = [
    terrainHeight(o.x - o.w / 2, o.z - o.d / 2),
    terrainHeight(o.x + o.w / 2, o.z - o.d / 2),
    terrainHeight(o.x - o.w / 2, o.z + o.d / 2),
    terrainHeight(o.x + o.w / 2, o.z + o.d / 2)
  ];
  return { ...o, y: Math.min(...hs) - 0.25 };
});

export const CABIN = OBSTACLES[0];

export function pointInObstacle(x, y, z) {
  for (const o of OBSTACLES) {
    if (y > o.y + o.h + 0.35) continue;
    if (x > o.x - o.w / 2 && x < o.x + o.w / 2 && z > o.z - o.d / 2 && z < o.z + o.d / 2) return o;
  }
  return null;
}

// Push a player circle out of the static boxes. Mutates pos {x,z}.
export function resolvePlayerCollision(pos, radius = PLAYER.radius) {
  for (const o of OBSTACLES) {
    const minX = o.x - o.w / 2 - radius, maxX = o.x + o.w / 2 + radius;
    const minZ = o.z - o.d / 2 - radius, maxZ = o.z + o.d / 2 + radius;
    if (pos.x <= minX || pos.x >= maxX || pos.z <= minZ || pos.z >= maxZ) continue;
    // Circle vs AABB — find the closest point on the box, push out along the shortest axis
    const cx = clamp(pos.x, o.x - o.w / 2, o.x + o.w / 2);
    const cz = clamp(pos.z, o.z - o.d / 2, o.z + o.d / 2);
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // Inside the box: push out to the nearest face
      const left = pos.x - minX, right = maxX - pos.x;
      const down = pos.z - minZ, up = maxZ - pos.z;
      const m = Math.min(left, right, down, up);
      if (m === left) pos.x = minX;
      else if (m === right) pos.x = maxX;
      else if (m === down) pos.z = minZ;
      else pos.z = maxZ;
    }
  }
  return pos;
}

export function clampToWorld(pos) {
  const r = Math.hypot(pos.x, pos.z);
  if (r > WORLD.playRadius) {
    const k = WORLD.playRadius / r;
    pos.x *= k;
    pos.z *= k;
  }
  return pos;
}

export function pickSpawn(players, forId) {
  let best = SPAWNS[0], bestScore = -Infinity;
  for (const s of SPAWNS) {
    let nearest = 999;
    for (const p of players) {
      if (p.id === forId || p.dead) continue;
      nearest = Math.min(nearest, Math.hypot(p.pos.x - s.x, p.pos.z - s.z));
    }
    const score = nearest + Math.random() * 12;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

export function makePlayerState(id, name, bot, spawn) {
  return {
    id, name, bot,
    pos: { x: spawn.x, y: terrainHeight(spawn.x, spawn.z), z: spawn.z },
    yaw: Math.random() * Math.PI * 2,
    pitch: 0,
    dead: false,
    deadAt: 0,
    kills: 0,
    deaths: 0,
    lastThrow: 0,
    spawnProtect: 0,
    anim: 0,
    moving: false,
    sprinting: false
  };
}
