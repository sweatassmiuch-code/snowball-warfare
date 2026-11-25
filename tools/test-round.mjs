// Headless test round for the authoritative simulation:
// verifies throw -> hit -> kill -> respawn, plus a rejected throw.
// Run with: node tools/test-round.mjs
import { GameSim } from '../public/shared/sim.js';
import { terrainHeight, RESPAWN_MS, PLAYER } from '../public/shared/world.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const events = [];
const sim = new GameSim({ botCount: 0, onEvent: (m) => events.push(m) });
sim.addPlayer('a', 'Shooter');
sim.addPlayer('b', 'Target');

const a = sim.players.get('a');
const b = sim.players.get('b');

// fixed positions: A at origin, B six metres straight ahead (-Z), both vulnerable
a.pos = { x: 0, y: terrainHeight(0, 0), z: 0 };
b.pos = { x: 0, y: terrainHeight(0, -6), z: -6 };
a.spawnProtect = 0;
b.spawnProtect = 0;
a.lastThrow = 0;

const t0 = Date.now();
const dt = 1 / 60;

// --- 1. a legal throw spawns a projectile -------------------------------
// aim at the chest, compensating for the height difference and gravity
function chestAim(shooter, victim) {
  const dist = Math.hypot(victim.pos.x - shooter.pos.x, victim.pos.z - shooter.pos.z);
  const flight = dist / 22;
  const dy = (victim.pos.y + 1.15) - (shooter.pos.y + 1.45);
  return [0, dy / flight + 0.5 * 9.2 * flight, -22];
}

const origin = [0, a.pos.y + 1.45, -0.5];
const velocity = chestAim(a, b);
const accepted = sim.throwBall('a', 1, origin, velocity, t0);
check('throw accepted at the right position', accepted === true);
check('projectile spawned', sim.projectiles.length === 1);

// --- 2. the ball hits and kills in one hit -------------------------------
let now = t0;
for (let i = 0; i < 60 && !b.dead; i++) {
  now += dt * 1000;
  sim.step(dt, now);
}
const kill = events.find((e) => e.t === 'kill' && e.v === 'b');
check('body hit registers a kill', !!kill, kill ? `killer=${kill.s}` : 'no kill event');
check('shooter credited', a.kills === 1, `kills=${a.kills}`);
check('victim counted death', b.deaths === 1, `deaths=${b.deaths}`);
check('victim is dead', b.dead === true);
check('impact event fired', events.some((e) => e.t === 'impact' && e.k === 'body'));

// --- 3. respawn after the timer ----------------------------------------
const deadAt = b.deadAt;
for (let i = 0; i < 260 && b.dead; i++) {
  now += dt * 1000;
  sim.step(dt, now);
}
const respawns = events.filter((e) => e.t === 'respawn' && e.id === 'b');
check('respawn event emitted', respawns.length >= 1);
check('respawn waits for the timer', now - deadAt >= RESPAWN_MS, `${(now - deadAt).toFixed(0)} ms`);
check('player is alive again', b.dead === false);
check('respawn inside the arena', Math.hypot(b.pos.x, b.pos.z) <= 100);
check('respawn has protection', b.spawnProtect > now);

// --- 4. invalid throws are rejected ------------------------------------
const before = sim.projectiles.length;
check('throw from far away rejected', sim.throwBall('a', 2, [40, a.pos.y + 1.4, 40], [0, 0, -20], now) === false);
check('no projectile added', sim.projectiles.length === before);
check('throw during respawn protection rejected',
  sim.throwBall('b', 3, [b.pos.x, b.pos.y + 1.4, b.pos.z - 0.5], [0, 0.6, -20], now) === false);

// --- 5. a second shot after protection expires still kills ---------------
// Place the fresh victim in front of the shooter's muzzle and clear protection.
b.spawnProtect = 0;
b.pos = { x: 0, y: terrainHeight(0, -6), z: -6 };
a.pos = { x: 0, y: terrainHeight(0, 0), z: 0 };
a.lastThrow = 0;
const eventsBefore = events.length;
check('second throw accepted', sim.throwBall('a', 4, [0, a.pos.y + 1.45, -0.5], chestAim(a, b), now) === true);
for (let i = 0; i < 60 && !b.dead; i++) {
  now += dt * 1000;
  sim.step(dt, now);
}
check('second hit kills again', events.slice(eventsBefore).some((e) => e.t === 'kill' && e.v === 'b'));
check('kills accumulate', a.kills === 2, `kills=${a.kills}`);
check('shooter stayed alive', a.dead === false);
check('eye height matches model', Math.abs(PLAYER.eye - 1.62) < 0.001);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
