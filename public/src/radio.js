// The little radio under the HUD: ten lo-fi tracks streamed through one
// <audio> element. Streaming instead of decoding keeps ten files out of memory
// and makes skip instant; the element's volume rides the game's volume slider.
// All of it is mellow lo-fi, no jokes in it.
// Every track: "Loyalty Freak Music", CC0 (public domain).
export const RADIO_TRACKS = [
  { title: 'Drowning in Your Smile', file: '../assets/music/radio/drowning-in-your-smile.mp3' },
  { title: 'Sugar and Coffee', file: '../assets/music/radio/sugar-and-coffee.mp3' },
  { title: 'Aeroplane', file: '../assets/music/radio/aeroplane.mp3' },
  { title: "Where I'm High", file: '../assets/music/radio/where-im-high.mp3' },
  { title: 'Dancing in the Street', file: '../assets/music/radio/dancing-in-the-street.mp3' },
  { title: 'Soft as a Dry Pillow', file: '../assets/music/radio/soft-as-a-dry-pillow.mp3' },
  { title: "I'm Glad You Are Here with Me", file: '../assets/music/radio/glad-you-are-here.mp3' },
  { title: 'Crying Those Tears I Kept So Long', file: '../assets/music/radio/crying-those-tears.mp3' },
  { title: "I Hope You're Happy", file: '../assets/music/radio/i-hope-youre-happy.mp3' },
  { title: 'This Pain Is Soft but Here', file: '../assets/music/radio/this-pain-is-soft.mp3' }
];

const ARTIST = 'Loyalty Freak Music';

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
