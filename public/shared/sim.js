// Shared, host-authoritative game simulation.
// Runs inside the browser of the host (or any Node server) and produces the
// exact same state stream for every connected player.

import {
  WORLD, PLAYER, BALL, WIN_SCORE, RESPAWN_MS,
  terrainHeight, pointInObstacle, resolvePlayerCollision, clampToWorld,
  pickSpawn, makePlayerState
} from './world.js';

const BOT_DEFS = [
  { name: 'Frost', skill: 0.80 },
  { name: 'Yeti', skill: 0.62 },
  { name: 'Eiswolf', skill: 0.72 }
];

export class GameSim {
  constructor({ botCount = 3, onEvent = () => {} } = {}) {
    this.players = new Map();
    this.projectiles = [];
    this.onEvent = onEvent;
    this.botCount = botCount;
    this.matchEndAt = 0;
    this.matchWinner = null;
    this.nextBotId = 1;
    this.nextProjectileSeq = 1;
    this.startedAt = Date.now();

    for (let i = 0; i < botCount; i++) this.addBot(BOT_DEFS[i % BOT_DEFS.length]);
  }

  emit(msg) { try { this.onEvent(msg); } catch (e) { console.error(e); } }

  addBot(def) {
    const id = 'bot' + (this.nextBotId++);
    const spawn = pickSpawn(this.players.values(), id);
    const p = makePlayerState(id, def.name, true, spawn);
    p.skill = def.skill;
    p.think = Math.random() * 1.5;
    p.target = null;
    p.strafe = 1;
    p.desiredDist = 16;
    p.botThrowAt = Date.now() + 1800 + Math.random() * 2600;
    p.vel = { x: 0, z: 0 };
    this.players.set(id, p);
    this.emit({ t: 'join', id, name: p.name, bot: true });
    return p;
  }

  addPlayer(id, name) {
    const clean = String(name || 'Gast').replace(/[^\w\u00c0-\u024f .-]/g, '').trim().slice(0, 14) || 'Gast';
    const spawn = pickSpawn(this.players.values(), id);
    const p = makePlayerState(id, clean, false, spawn);
    p.spawnProtect = Date.now() + 2000;
    this.players.set(id, p);
    this.emit({ t: 'join', id, name: clean, bot: false });
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.emit({ t: 'leave', id, name: p.name });
  }

  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    const pos = msg.p;
    if (Array.isArray(pos) && pos.length >= 3) {
      const nx = Number(pos[0]), ny = Number(pos[1]), nz = Number(pos[2]);
      if ([nx, ny, nz].every(Number.isFinite)) {
        const dx = nx - p.pos.x, dz = nz - p.pos.z;
        if (Math.hypot(dx, dz) <= 3.5) { p.pos.x = nx; p.pos.z = nz; }
        const ground = terrainHeight(p.pos.x, p.pos.z);
        p.pos.y = Math.min(Math.max(ny, ground), ground + 4);
        p.vel = { x: dx, z: dz };
        p.moving = Number(msg.m) === 1;
        p.sprinting = Number(msg.sp) === 1;
      }
    }
    if (Number.isFinite(msg.y)) p.yaw = msg.y;
    if (Number.isFinite(msg.pitch)) p.pitch = Math.max(-1.5, Math.min(1.5, msg.pitch));
    if (typeof msg.a === 'number') p.anim = Math.max(0, Math.min(2, msg.a | 0));
  }

  throwBall(id, seq, o, v, now = Date.now()) {
    const p = this.players.get(id);
    if (!p || p.dead || now < p.spawnProtect) return false;
    if (this.matchEndAt && now < this.matchEndAt) return false;
    if (now - p.lastThrow < 240) return false;
    if (!Array.isArray(o) || !Array.isArray(v)) return false;

    let ox = Number(o[0]), oy = Number(o[1]), oz = Number(o[2]);
    let vx = Number(v[0]), vy = Number(v[1]), vz = Number(v[2]);
    if (![ox, oy, oz, vx, vy, vz].every(Number.isFinite)) return false;
    const speed = Math.hypot(vx, vy, vz);
    if (speed < 4 || speed > BALL.maxSpeed + 2) return false;
    if (Math.hypot(ox - p.pos.x, oz - p.pos.z) > 2.6) return false;

    p.lastThrow = now;
    const pid = `${id}:${seq | 0}`;
    this.spawnProjectile(p, pid, [ox, oy, oz], [vx, vy, vz]);
    return true;
  }

  spawnProjectile(owner, id, o, v) {
    this.projectiles.push({
      id, owner: owner.id, p: [o[0], o[1], o[2]], v: [v[0], v[1], v[2]], life: 0
    });
    this.emit({ t: 'throw', id, o: [o[0], o[1], o[2]], v: [v[0], v[1], v[2]], own: owner.id });
  }

  requestRespawn(id, now = Date.now()) {
    const p = this.players.get(id);
    if (p && p.dead && now - p.deadAt > 800) this.respawn(p, now);
  }

  respawn(p, now) {
    const spawn = pickSpawn(this.players.values(), p.id);
    p.pos = { x: spawn.x, y: terrainHeight(spawn.x, spawn.z), z: spawn.z };
    p.dead = false;
    p.deadAt = 0;
    p.spawnProtect = now + WORLD.spawnSafeTime;
    p.yaw = Math.random() * Math.PI * 2;
    p.pitch = 0;
    p.anim = 0;
    this.emit({ t: 'respawn', id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw });
  }

  step(dt, now = Date.now()) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    this.updateBots(dt, now);
    this.updateProjectiles(dt, now);

    for (const p of this.players.values()) {
      if (p.dead && now - p.deadAt > RESPAWN_MS) this.respawn(p, now);
    }

    if (this.matchEndAt && now >= this.matchEndAt) {
      this.matchEndAt = 0;
      this.matchWinner = null;
      for (const p of this.players.values()) {
        p.kills = 0;
        p.deaths = 0;
        if (p.dead) this.respawn(p, now);
      }
      this.emit({ t: 'reset' });
    }
  }

  circleHit(px, py, pz, victim) {
    const baseY = victim.pos.y + 0.28;
    const topY = victim.pos.y + PLAYER.height - 0.18;
    const cy = Math.max(baseY, Math.min(topY, py));
    const dx = px - victim.pos.x;
    const dy = py - cy;
    const dz = pz - victim.pos.z;
    const rad = PLAYER.radius + BALL.radius;
    return dx * dx + dy * dy + dz * dz <= rad * rad;
  }

  updateProjectiles(dt, now) {
    const steps = 2;
    const h = dt / steps;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      let hit = null;

      for (let s = 0; s < steps && !hit; s++) {
        pr.v[1] -= BALL.gravity * h;
        pr.p[0] += pr.v[0] * h;
        pr.p[1] += pr.v[1] * h;
        pr.p[2] += pr.v[2] * h;
        const [x, y, z] = pr.p;

        for (const victim of this.players.values()) {
          if (victim.id === pr.owner || victim.dead) continue;
          if (now < victim.spawnProtect) continue;
          if (this.circleHit(x, y, z, victim)) { hit = { kind: 'body', victim, x, y, z }; break; }
        }
        if (hit) break;
        if (pointInObstacle(x, y, z)) { hit = { kind: 'object', x, y, z }; break; }
        if (y <= terrainHeight(x, z) + BALL.radius * 0.6) { hit = { kind: 'ground', x, y, z }; break; }
        if (Math.hypot(x, z) > WORLD.half) { hit = { kind: 'ground', x, y, z }; break; }
      }

      pr.life += dt;
      if (hit) {
        this.projectiles.splice(i, 1);
        this.emit({ t: 'impact', id: pr.id, x: hit.x, y: hit.y, z: hit.z, k: hit.kind, own: pr.owner });
        if (hit.kind === 'body') this.registerHit(this.players.get(pr.owner), hit.victim, hit, now);
      } else if (pr.life > BALL.maxLife) {
        this.projectiles.splice(i, 1);
        this.emit({ t: 'impact', id: pr.id, x: pr.p[0], y: pr.p[1], z: pr.p[2], k: 'ground', own: pr.owner });
      }
    }
  }

  registerHit(shooter, victim, hit, now) {
    if (!victim || victim.dead) return;
    victim.dead = true;
    victim.deadAt = now;
    victim.deaths++;
    if (shooter && shooter.id !== victim.id) shooter.kills = (shooter.kills || 0) + 1;

    this.emit({
      t: 'kill',
      v: victim.id, vn: victim.name,
      s: shooter ? shooter.id : null, sn: shooter ? shooter.name : 'Welt',
      k: shooter ? shooter.kills : 0,
      x: hit.x, y: hit.y, z: hit.z
    });

    if (shooter && shooter.kills >= WIN_SCORE && !this.matchEndAt) {
      this.matchEndAt = now + 8000;
      this.matchWinner = { id: shooter.id, name: shooter.name };
      this.emit({ t: 'matchEnd', winner: this.matchWinner, score: shooter.kills });
    }
  }

  updateBots(dt, now) {
    if (this.matchEndAt && now < this.matchEndAt) return;

    for (const b of this.players.values()) {
      if (!b.bot) continue;

      if (b.dead) {
        if (now - b.deadAt > RESPAWN_MS + 400) this.respawn(b, now);
        continue;
      }

      b.think -= dt;
      if (b.think <= 0) {
        b.think = 1.4 + Math.random() * 2.2;
        b.strafe = Math.random() < 0.5 ? -1 : 1;
        b.desiredDist = 13 + Math.random() * 15;
        let best = null, bestScore = Infinity;
        for (const p of this.players.values()) {
          if (p.id === b.id || p.dead) continue;
          const d = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
          const score = d * (p.bot ? 1.6 : 1.0);
          if (score < bestScore) { bestScore = score; best = p; }
        }
        b.target = best;
      }

      const t = b.target;
      let moveX = 0, moveZ = 0, speed = 4.0;

      if (t && !t.dead) {
        const dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z;
        const dist = Math.hypot(dx, dz) || 1;
        const ux = dx / dist, uz = dz / dist;
        b.yaw = Math.atan2(-ux, -uz);
        b.pitch = Math.atan2((t.pos.y + 1.15) - (b.pos.y + PLAYER.eye), dist);

        if (dist > b.desiredDist + 4) { moveX += ux; moveZ += uz; speed = 4.5; }
        else if (dist < b.desiredDist - 5) { moveX -= ux; moveZ -= uz; speed = 4.2; }
        else { moveX += -uz * b.strafe; moveZ += ux * b.strafe; speed = 3.4; }

        if (now >= b.botThrowAt && dist < 36 && dist > 4 && !this.matchEndAt) {
          const flight = dist / 26;
          const aimX = t.pos.x + (t.vel?.x || 0) * flight * 2.2;
          const aimY = t.pos.y + 1.15 + 0.5 * BALL.gravity * flight * flight;
          const aimZ = t.pos.z + (t.vel?.z || 0) * flight * 2.2;
          const ox = b.pos.x, oy = b.pos.y + PLAYER.eye, oz = b.pos.z;
          let vx = aimX - ox, vy = aimY - oy, vz = aimZ - oz;
          const len = Math.hypot(vx, vy, vz) || 1;
          const speedBall = 21 + Math.random() * 7;
          vx = vx / len * speedBall; vy = vy / len * speedBall; vz = vz / len * speedBall;

          const err = (1 - b.skill) * 0.09 + 0.02;
          vx += (Math.random() - 0.5) * err * speedBall;
          vy += (Math.random() - 0.5) * err * speedBall * 0.7;
          vz += (Math.random() - 0.5) * err * speedBall;

          this.spawnProjectile(b, `bot:${this.nextProjectileSeq++}`, [ox, oy, oz], [vx, vy, vz]);
          b.lastThrow = now;
          b.botThrowAt = now + 1900 + Math.random() * 3200 + (1 - b.skill) * 1200;
        }
      } else {
        const ang = Math.sin(now * 0.0002 + b.id.length * 3.1) * Math.PI * 2;
        moveX = Math.cos(ang) * 0.5;
        moveZ = Math.sin(ang) * 0.5;
        speed = 1.8;
      }

      const ml = Math.hypot(moveX, moveZ);
      if (ml > 0.001) {
        moveX /= ml; moveZ /= ml;
        b.pos.x += moveX * speed * dt;
        b.pos.z += moveZ * speed * dt;
        resolvePlayerCollision(b.pos);
        clampToWorld(b.pos);
        b.pos.y = terrainHeight(b.pos.x, b.pos.z);
        b.anim = 1;
      } else {
        b.anim = 0;
      }
    }
  }

  roster() {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, bot: p.bot }));
  }

  snapshot() {
    const ps = [];
    for (const p of this.players.values()) {
      ps.push([
        p.id,
        Math.round(p.pos.x * 100) / 100,
        Math.round(p.pos.y * 100) / 100,
        Math.round(p.pos.z * 100) / 100,
        Math.round(p.yaw * 1000) / 1000,
        Math.round(p.pitch * 1000) / 1000,
        p.dead ? 1 : 0,
        p.anim | 0
      ]);
    }
    const sc = [];
    for (const p of this.players.values()) sc.push([p.id, p.kills, p.deaths]);
    return {
      t: 'state',
      ps,
      sc,
      n: [...this.players.values()].filter(p => !p.bot).length,
      end: this.matchEndAt ? Math.max(0, this.matchEndAt - Date.now()) : 0
    };
  }
}
