// Multiplayer transport: WebRTC data channels via PeerJS, host-authoritative.
// Works on any static host (Vercel) because only a public signalling service is used.
import { GameSim } from '../shared/sim.js';

const PeerCtor = (...args) => new window.Peer(...args);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    let peer;
    try { peer = id ? PeerCtor(id, { debug: 0 }) : PeerCtor({ debug: 0 }); }
    catch (e) { reject(e); return; }

    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { peer.destroy(); } catch {}
      reject(new Error('Signalling is not responding. Check your internet connection.'));
    }, 16000);

    peer.on('open', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { peer.destroy(); } catch {}
      reject(err);
    });
  });
}

function waitForOpen(conn, timeout = 14000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { conn.close(); } catch {}
      reject(new Error('Could not connect to the host.'));
    }, timeout);
    conn.on('open', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    });
    conn.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function friendly(err) {
  const type = err?.type || '';
  if (type === 'peer-unavailable') return 'Room not found. Check the code.';
  if (type === 'unavailable-id') return 'Room code already in use. Please try again.';
  if (type === 'network' || type === 'server-error') return 'Signalling server unreachable.';
  if (type === 'browser-incompatible') return 'This browser does not support WebRTC.';
  return err?.message || 'Unknown network error.';
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------
export class HostSession {
  constructor({ name, bots = 3, look = null, onState, onEvent, onRoster, onError, onClosed }) {
    this.isHost = true;
    this.look = look;
    this.selfId = 'host';
    this.handlers = { onState, onEvent, onRoster, onError, onClosed };
    this.connections = new Map();
    this.peer = null;
    this.code = null;
    this.closed = false;
    this.lastState = 0;

    this.sim = new GameSim({ botCount: bots, onEvent: (msg) => this.handleSimEvent(msg) });
    this.sim.addPlayer('host', name, look);
    this.handlers.onRoster?.(this.sim.roster());
  }

  async start() {
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeCode(5);
      try {
        const peer = await openPeer('sbw-' + code);
        this.peer = peer;
        this.code = code;
        peer.on('connection', (conn) => this.acceptConnection(conn));
        peer.on('error', (err) => {
          if (err?.type === 'network' || err?.type === 'server-error') {
            this.handlers.onError?.(friendly(err));
          }
        });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
        return code;
      } catch (err) {
        lastErr = err;
        if (err?.type !== 'unavailable-id') break;
      }
    }
    throw new Error(friendly(lastErr));
  }

  acceptConnection(conn) {
    if (this.closed) { try { conn.close(); } catch {} return; }
    const humans = [...this.sim.players.values()].filter(p => !p.bot).length;
    if (humans >= 8) {
      conn.on('open', () => {
        try { conn.send({ t: 'full' }); } catch {}
        setTimeout(() => { try { conn.close(); } catch {} }, 250);
      });
      return;
    }

    const name = String(conn.metadata?.name || 'Guest').slice(0, 14) || 'Guest';
    const look = conn.metadata?.look || null;
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.sim.addPlayer(conn.peer, name, look);
      try {
        conn.send({
          t: 'welcome',
          id: conn.peer,
          name,
          players: this.sim.roster(),
          winScore: 15,
          bots: this.sim.botCount
        });
        conn.send({ t: 'state', ...this.sim.snapshot() });
      } catch (e) { console.error(e); }
      this.handlers.onRoster?.(this.sim.roster());
    });

    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      const id = conn.peer;
      if (msg.t === 's') this.sim.setInput(id, msg);
      else if (msg.t === 'throw') this.sim.throwBall(id, msg.seq, msg.o, msg.v);
      else if (msg.t === 'respawn') this.sim.requestRespawn(id);
      else if (msg.t === 'ping') {
        try { conn.send({ t: 'pong', ts: msg.ts }); } catch {}
      }
    });

    const drop = () => {
      if (!this.connections.has(conn.peer)) return;
      this.connections.delete(conn.peer);
      this.sim.removePlayer(conn.peer);
      this.handlers.onRoster?.(this.sim.roster());
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  handleSimEvent(msg) {
    // Forward events to guests (they apply their own FX)
    for (const [, conn] of this.connections) {
      if (conn.open) {
        try { conn.send(msg); } catch {}
      }
    }
    if (msg.t === 'join' || msg.t === 'leave') {
      this.handlers.onRoster?.(this.sim.roster());
    }
    this.handlers.onEvent?.(msg);
  }

  tick(dt) {
    if (this.closed) return;
    const now = performance.now();
    this.sim.step(dt, Date.now());
    if (now - this.lastState >= 50) {
      this.lastState = now;
      const snap = this.sim.snapshot();
      if (this.connections.size) {
        for (const [, conn] of this.connections) {
          if (conn.open) { try { conn.send(snap); } catch {} }
        }
      }
      this.handlers.onState?.(snap);
    }
  }

  input(msg) { this.sim.setInput('host', msg); }
  throwBall(seq, o, v) { this.sim.throwBall('host', seq, o, v); }
  respawn() { this.sim.requestRespawn('host'); }
  ping() { return 0; }

  close() {
    this.closed = true;
    for (const [, conn] of this.connections) { try { conn.close(); } catch {} }
    this.connections.clear();
    try { this.peer?.destroy(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Guest
// ---------------------------------------------------------------------------
export class GuestSession {
  constructor({ code, name, look = null, onState, onEvent, onRoster, onError, onClosed, onReady }) {
    this.look = look;
    this.isHost = false;
    this.selfId = null;
    this.code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    this.name = name;
    this.handlers = { onState, onEvent, onRoster, onError, onClosed, onReady };
    this.peer = null;
    this.conn = null;
    this.pingMs = 0;
    this.lastPing = 0;
    this.lastPingSent = 0;
    this.closed = false;
  }

  async start() {
    this.peer = await openPeer(null);
    this.peer.on('error', (err) => {
      if (this.closed) return;
      if (err?.type === 'peer-unavailable') {
        this.handlers.onError?.('Room not found. Check the code.');
      }
    });

    const conn = this.peer.connect('sbw-' + this.code, {
      reliable: true,
      metadata: { name: this.name, look: this.look }
    });
    this.conn = conn;

    const welcome = new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error('No response from the host.'));
      }, 16000);
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'welcome' && !done) {
          done = true;
          clearTimeout(timer);
          resolve(msg);
          return;
        }
        if (msg.t === 'full') {
          done = true;
          clearTimeout(timer);
          reject(new Error('Room is full (max. 8 players).'));
          return;
        }
        this.onData(msg);
      });
      conn.on('close', () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(new Error('Connection refused.'));
        }
      });
    });

    await waitForOpen(conn);
    const w = await welcome;

    this.selfId = w.id;
    this.handlers.onRoster?.(w.players || []);
    this.handlers.onReady?.({ id: w.id, name: w.name, players: w.players, winScore: w.winScore });

    conn.on('close', () => {
      if (this.closed) return;
      this.handlers.onClosed?.('The host left the game.');
    });
    conn.on('error', () => {
      if (this.closed) return;
      this.handlers.onClosed?.('Lost connection to the host.');
    });

    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch {} });
  }

  onData(msg) {
    if (msg.t === 'state') { this.handlers.onState?.(msg); return; }
    if (msg.t === 'pong') {
      if (msg.ts === this.lastPingSent) this.pingMs = Math.round(performance.now() - msg.ts);
      return;
    }
    if (msg.t === 'welcome') return;
    this.handlers.onEvent?.(msg);
  }

  tick() {
    if (this.closed) return;
    const now = performance.now();
    if (now - this.lastPing > 2000 && this.conn?.open) {
      this.lastPing = now;
      this.lastPingSent = now;
      try { this.conn.send({ t: 'ping', ts: now }); } catch {}
    }
  }

  input(msg) {
    if (this.conn?.open) { try { this.conn.send(msg); } catch {} }
  }

  throwBall(seq, o, v) {
    if (this.conn?.open) {
      try { this.conn.send({ t: 'throw', seq, o, v }); } catch {}
    }
  }

  respawn() {
    if (this.conn?.open) { try { this.conn.send({ t: 'respawn' }); } catch {} }
  }

  ping() { return this.pingMs; }

  close() {
    this.closed = true;
    try { this.conn?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
  }
}

export function hostGame(opts) { return new HostSession(opts); }
export function joinGame(opts) { return new GuestSession(opts); }
