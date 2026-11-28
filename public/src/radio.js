// The little radio under the HUD: ten Christmas pieces streamed through one
// <audio> element. Streaming instead of decoding keeps ten files out of memory
// and makes skip instant; the element's volume rides the game's volume slider.
// Carols alternate with quieter arrangements, so the room never gets shouty.
// Kevin MacLeod tracks: CC BY 4.0. Band tracks: public domain (US military
// bands, released as public-domain recordings).
export const RADIO_TRACKS = [
  { title: 'Deck the Halls', artist: 'The United States Air Force Band', file: '../assets/music/radio/deck-the-halls.mp3' },
  { title: 'Jingle Bells', artist: 'Kevin MacLeod', file: '../assets/music/radio/jingle-bells.mp3' },
  { title: 'Angels We Have Heard on High', artist: 'Kevin MacLeod', file: '../assets/music/radio/angels-we-have-heard.mp3' },
  { title: 'Dance of the Sugar Plum Fairy', artist: 'Kevin MacLeod', file: '../assets/music/radio/sugar-plum-fairy.mp3' },
  { title: 'We Wish You a Merry Christmas', artist: 'The United States Navy Band', file: '../assets/music/radio/we-wish-you-a-merry-christmas.mp3' },
  { title: 'Silent Night', artist: 'Kevin MacLeod', file: '../assets/music/radio/silent-night.mp3' },
  { title: 'Go Tell It on the Mountain', artist: 'The United States Navy Band', file: '../assets/music/radio/go-tell-it-on-the-mountain.mp3' },
  { title: 'It Came Upon a Midnight Clear', artist: 'Kevin MacLeod', file: '../assets/music/radio/it-came-upon-a-midnight-clear.mp3' },
  { title: 'Joy to the World', artist: 'The United States Navy Band', file: '../assets/music/radio/joy-to-the-world.mp3' },
  { title: 'Holiday Weasel', artist: 'Kevin MacLeod', file: '../assets/music/radio/holiday-weasel.mp3' }
];

const ARTIST = 'Christmas Radio';

export function createRadio({ volume = 0.28, onTrack, onState } = {}) {
  const el = new Audio();
  el.preload = 'metadata';
  el.volume = Math.max(0, Math.min(1, volume));

  let index = 0;
  let muted = false;
  let started = false;

  const emitTrack = () => {
    const track = RADIO_TRACKS[index];
    onTrack?.({
      ...track,
      artist: track.artist || ARTIST,
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
