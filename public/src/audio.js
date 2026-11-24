// All sound is synthesized with the Web Audio API — no audio files needed.
export function createAudio() {
  let ctx = null;
  let master = null;
  let sfx = null;
  let windGain = null;
  let windFilter = null;
  let windHissGain = null;
  let muted = false;
  let volume = 0.8;
  let windStarted = false;
  let noiseBuffer = null;
  let brownBuffer = null;

  function makeNoiseBuffer(seconds, brown) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.2;
      } else {
        d[i] = white;
      }
    }
    return buf;
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;

    master.connect(comp);
    comp.connect(ctx.destination);

    sfx = ctx.createGain();
    sfx.gain.value = 1;
    sfx.connect(master);

    noiseBuffer = makeNoiseBuffer(2, false);
    brownBuffer = makeNoiseBuffer(4, true);

    startWind();
  }

  function startWind() {
    if (windStarted || !ctx) return;
    windStarted = true;

    const src = ctx.createBufferSource();
    src.buffer = brownBuffer;
    src.loop = true;

    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.6;

    windGain = ctx.createGain();
    windGain.gain.value = 0.20;

    src.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    src.start();

    // slow gusts
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.055;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 110;
    lfo.connect(lfoGain);
    lfoGain.connect(windFilter.frequency);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.033;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.07;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(windGain.gain);
    lfo2.start();

    // thin high hiss
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuffer;
    hiss.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 2100;
    hissFilter.Q.value = 0.7;
    windHissGain = ctx.createGain();
    windHissGain.gain.value = 0.022;
    hiss.connect(hissFilter);
    hissFilter.connect(windHissGain);
    windHissGain.connect(master);
    hiss.start();
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master && !muted) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
  }

  function isMuted() { return muted; }

  function noiseBurst({ dur = 0.2, freq = 1200, q = 0.9, gain = 0.25, type = 'bandpass', pan = 0, delay = 0, sweepTo = null }) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f); f.connect(g); g.connect(p); p.connect(sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  function tone({ freq = 200, to = 60, dur = 0.25, gain = 0.3, type = 'sine', pan = 0, delay = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(g); g.connect(p); p.connect(sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function spatial(pos, camera) {
    if (!pos || !camera) return { vol: 1, pan: 0 };
    const dx = pos.x - camera.position.x;
    const dy = pos.y - camera.position.y;
    const dz = pos.z - camera.position.z;
    const dist = Math.hypot(dx, dy, dz);
    const vol = 1 / (1 + dist * 0.14);
    // pan relative to camera yaw
    const yaw = Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]);
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    const pan = dist > 0.5 ? Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / dist)) * 0.8 : 0;
    return { vol, pan };
  }

  const audio = {
    init,
    setVolume,
    setMuted,
    isMuted: () => muted,
    get ready() { return !!ctx; },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },

    footstep(sprint = false) {
      if (!ctx) return;
      const crunch = sprint ? 0.34 : 0.26;
      noiseBurst({ dur: 0.10 + Math.random() * 0.05, freq: 900 + Math.random() * 1500, q: 0.8, gain: crunch, pan: (Math.random() - 0.5) * 0.3 });
      noiseBurst({ dur: 0.055, freq: 2600 + Math.random() * 1400, q: 1.1, gain: crunch * 0.5, pan: (Math.random() - 0.5) * 0.4 });
      tone({ freq: 95 + Math.random() * 25, to: 55, dur: 0.09, gain: 0.15, type: 'sine' });
    },

    throwWhoosh() {
      if (!ctx) return;
      noiseBurst({ dur: 0.26, freq: 650, sweepTo: 2400, q: 1.4, gain: 0.30 });
      noiseBurst({ dur: 0.2, freq: 300, sweepTo: 900, q: 1.0, gain: 0.16, delay: 0.02 });
    },

    impact(pos, camera, kind = 'ground') {
      if (!ctx) return;
      const { vol, pan } = spatial(pos, camera);
      if (kind === 'body') {
        noiseBurst({ dur: 0.22, freq: 700, q: 0.7, gain: 0.5 * vol, pan });
        tone({ freq: 140, to: 50, dur: 0.22, gain: 0.5 * vol, pan });
        noiseBurst({ dur: 0.3, freq: 2600, q: 0.6, gain: 0.18 * vol, pan });
      } else if (kind === 'object') {
        noiseBurst({ dur: 0.16, freq: 520, q: 0.8, gain: 0.32 * vol, pan });
        tone({ freq: 110, to: 60, dur: 0.14, gain: 0.22 * vol, pan });
      } else {
        noiseBurst({ dur: 0.24, freq: 950, q: 0.5, gain: 0.42 * vol, pan });
        noiseBurst({ dur: 0.16, freq: 2200, q: 0.7, gain: 0.16 * vol, pan });
        tone({ freq: 110, to: 55, dur: 0.16, gain: 0.2 * vol, pan });
      }
    },

    hitmarker() {
      if (!ctx) return;
      tone({ freq: 1750, to: 1500, dur: 0.06, gain: 0.16, type: 'triangle' });
      tone({ freq: 260, to: 120, dur: 0.12, gain: 0.24, type: 'sine', delay: 0.01 });
      noiseBurst({ dur: 0.1, freq: 1800, q: 0.8, gain: 0.18 });
    },

    killConfirm() {
      if (!ctx) return;
      tone({ freq: 880, to: 1320, dur: 0.12, gain: 0.12, type: 'triangle' });
      tone({ freq: 1320, to: 1760, dur: 0.16, gain: 0.09, type: 'triangle', delay: 0.07 });
    },

    death() {
      if (!ctx) return;
      tone({ freq: 220, to: 55, dur: 0.7, gain: 0.45, type: 'sine' });
      noiseBurst({ dur: 1.2, freq: 380, q: 0.4, gain: 0.4, type: 'lowpass' });
      noiseBurst({ dur: 0.35, freq: 900, q: 0.6, gain: 0.25 });
      // wind swell
      if (windGain) {
        const t = ctx.currentTime;
        windGain.gain.cancelScheduledValues(t);
        windGain.gain.setValueAtTime(windGain.gain.value, t);
        windGain.gain.linearRampToValueAtTime(0.6, t + 0.6);
        windGain.gain.linearRampToValueAtTime(0.2, t + 3.2);
      }
    },

    respawn() {
      if (!ctx) return;
      tone({ freq: 300, to: 520, dur: 0.25, gain: 0.12, type: 'sine' });
      noiseBurst({ dur: 0.4, freq: 1200, q: 0.5, gain: 0.12 });
    },

    matchEnd() {
      if (!ctx) return;
      [0, 0.14, 0.3].forEach((d, i) => tone({ freq: [392, 523, 659][i], to: [392, 523, 659][i], dur: 0.5, gain: 0.14, type: 'triangle', delay: d }));
    },

    ui() {
      if (!ctx) return;
      noiseBurst({ dur: 0.05, freq: 2600, q: 1.5, gain: 0.12 });
    },

    hitSnow() {
      if (!ctx) return;
      noiseBurst({ dur: 0.08, freq: 1600, q: 0.7, gain: 0.14 });
    }
  };

  return audio;
}
