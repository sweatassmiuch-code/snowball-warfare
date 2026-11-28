// The little radio under the HUD: ten light-hearted tracks streamed through
// one <audio> element. Streaming instead of decoding keeps ten files out of
// memory and makes skip instant; the element's volume rides the game's volume
// slider. The list alternates goofy numbers with mellow ones, so skipping
// never lands on two clowns in a row.
// Every track: "Kevin MacLeod (incompetech.com)", CC BY 4.0.
export const RADIO_TRACKS = [
  { title: 'Monkeys Spinning Monkeys', file: '../assets/music/radio/monkeys-spinning-monkeys.mp3' },
  { title: 'Life of Riley', file: '../assets/music/radio/life-of-riley.mp3' },
  { title: 'Sneaky Snitch', file: '../assets/music/radio/sneaky-snitch.mp3' },
  { title: 'Cattails', file: '../assets/music/radio/cattails.mp3' },
  { title: 'Fluffing a Duck', file: '../assets/music/radio/fluffing-a-duck.mp3' },
  { title: 'Wallpaper', file: '../assets/music/radio/wallpaper.mp3' },
  { title: 'Happy Happy Game Show', file: '../assets/music/radio/happy-happy-game-show.mp3' },
  { title: 'Pamgaea', file: '../assets/music/radio/pamgaea.mp3' },
  { title: 'Funin and Sunin', file: '../assets/music/radio/funin-and-sunin.mp3' },
  { title: 'Bumbly March', file: '../assets/music/radio/bumbly-march.mp3' }
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
