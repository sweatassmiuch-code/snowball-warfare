// The little radio under the HUD: ten calm winter tracks streamed through one
// <audio> element. Streaming instead of decoding keeps ten files out of memory
// and makes skip instant; the element's volume rides the game's volume slider.
// Every track: "Kevin MacLeod (incompetech.com)", CC BY 4.0.
export const RADIO_TRACKS = [
  { title: 'Winter Chimes', file: '../assets/music/radio/winter-chimes.mp3' },
  { title: 'Winter Reflections', file: '../assets/music/radio/winter-reflections.mp3' },
  { title: 'Snowdrop', file: '../assets/music/radio/snowdrop.mp3' },
  { title: 'Clear Waters', file: '../assets/music/radio/clear-waters.mp3' },
  { title: 'Avec Soin', file: '../assets/music/radio/avec-soin.mp3' },
  { title: 'Friday Morning', file: '../assets/music/radio/friday-morning.mp3' },
  { title: 'Immersed', file: '../assets/music/radio/immersed.mp3' },
  { title: 'Dreamy Flashback', file: '../assets/music/radio/dreamy-flashback.mp3' },
  { title: 'Peaceful Desolation', file: '../assets/music/radio/peaceful-desolation.mp3' },
  { title: 'Dreamer', file: '../assets/music/radio/dreamer.mp3' }
];

const ARTIST = 'Kevin MacLeod';

export function createRadio({ volume = 0.28, onTrack, onState } = {}) {
  const el = new Audio();
  el.preload = 'metadata';
  el.volume = Math.max(0, Math.min(1, volume));

  let index = 0;
  let muted = false;
  let started = false;

  const emitTrack = () => {
    onTrack?.({
      ...RADIO_TRACKS[index],
      artist: ARTIST,
      index,
      count: RADIO_TRACKS.length
    });
  };
  const emitState = () => onState?.({ playing: !el.paused, muted });

  function load(autoplay) {
    el.src = new URL(RADIO_TRACKS[index].file, import.meta.url).href;
    emitTrack();
    if (autoplay) play();
    else emitState();
  }

  function play() {
    started = true;
    const p = el.play();
    if (p && p.catch) p.catch(() => emitState());
    emitState();
  }

  function pause() {
    el.pause();
    emitState();
  }

  function toggle() {
    if (el.paused) play();
    else pause();
  }

  function step(dir) {
    index = (index + dir + RADIO_TRACKS.length) % RADIO_TRACKS.length;
    load(started);
  }

  // A missing or unreadable file must not stall the radio: skip it.
  el.addEventListener('ended', () => step(1));
  el.addEventListener('play', emitState);
  el.addEventListener('pause', emitState);
  el.addEventListener('error', () => {
    if (!started) { emitState(); return; }
    setTimeout(() => step(1), 400);
  });

  load(false);

  return {
    el,
    play,
    pause,
    toggle,
    next: () => step(1),
    prev: () => step(-1),
    setVolume(v) { el.volume = Math.max(0, Math.min(1, v)); },
    setMuted(m) { muted = !!m; el.muted = muted; emitState(); },
    get playing() { return !el.paused; },
    get started() { return started; },
    get track() { return RADIO_TRACKS[index]; }
  };
}
