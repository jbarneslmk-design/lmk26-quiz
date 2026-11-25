// LMK 26 — sound effects and background music, all made live with Web Audio
// (no audio files, nothing to download, nothing copyrighted).
//
// Sync: the host writes shared cues to `fx` as {n, name, at} where `at` is server time a
// little in the future; every phone schedules the sound for that moment on the shared
// clock (Backend.now()), so the room hears it together. Countdown ticks are worked out
// from the question's own server-time deadline, so they line up too. The music loop's
// bars are counted from the shared clock, so phones that turn it on play in step.
window.SFX = (() => {
  const ST_SFX = "nn_sfx_on", ST_MUSIC = "nn_music_on";
  let ctx = null, master, sfxBus, musicBus, noiseBuf = null;
  let sfxOn = localStorage.getItem(ST_SFX) !== "0";
  let musicOn = localStorage.getItem(ST_MUSIC) === "1";
  const listeners = new Set();
  const changed = () => listeners.forEach(f => f());

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 0.55 : 0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  const unlocked = () => !!ctx && ctx.state === "running";
  // browsers only allow sound after a tap: any tap on the page unlocks it
  function unlock() {
    if (!ensure()) return;
    if (ctx.state !== "running") ctx.resume().then(() => { changed(); if (musicOn) startMusic(); });
    else if (musicOn) startMusic();
  }
  ["pointerdown", "touchend", "keydown"].forEach(ev => document.addEventListener(ev, unlock, { capture: true, passive: true }));

  // ---------- tiny synth ----------
  function tone(f, t, dur, { type = "sine", vol = 0.3, a = 0.005, out = sfxBus, f2 = null, detune = 0, filter = null, q = 1 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const bq = ctx.createBiquadFilter(); bq.type = "lowpass"; bq.frequency.value = filter; bq.Q.value = q; o.connect(bq); node = bq; }
    node.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, { vol = 0.2, type = "bandpass", f = 3000, f2 = null, q = 1, out = sfxBus, a = 0.005 } = {}) {
    const s = ctx.createBufferSource(), bq = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; bq.type = type; bq.frequency.setValueAtTime(f, t); bq.Q.value = q;
    if (f2) bq.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bq); bq.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  const N = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI note → Hz
  const bell = (n, t, vol = 0.18, dur = 1.2, out = sfxBus) => { tone(N(n), t, dur, { vol, out }); tone(N(n) * 2.01, t, dur * 0.6, { vol: vol * 0.35, out }); tone(N(n) * 3.98, t, dur * 0.3, { vol: vol * 0.12, out }); };
  const brass = (n, t, dur, vol = 0.16) => { tone(N(n), t, dur, { type: "sawtooth", vol, a: 0.03, filter: 2200, q: 2 }); tone(N(n), t, dur, { type: "sawtooth", vol: vol * 0.6, a: 0.03, detune: 9, filter: 1800 }); };
  const sleigh = (t, vol = 0.07) => { for (let i = 0; i < 3; i++) noise(t + i * 0.035, 0.09, { vol, type: "highpass", f: 7000 }); };
  const cymbal = (t, vol = 0.22, dur = 1.6) => noise(t, dur, { vol, type: "highpass", f: 5500, a: 0.002 });
  const drumroll = (t, dur, vol = 0.12) => { const n = Math.floor(dur / 0.045); for (let i = 0; i < n; i++) noise(t + i * 0.045, 0.06, { vol: vol * (0.5 + i / n), type: "bandpass", f: 900, q: 0.8 }); };
  const kick = (t, vol = 0.5, out = sfxBus) => tone(120, t, 0.3, { vol, f2: 40, out });

  // ---------- the sounds ----------
  const SOUNDS = {
    tap: t => tone(1200, t, 0.05, { vol: 0.08 }),
    join: t => { tone(500, t, 0.15, { vol: 0.25, f2: 1100 }); bell(84, t + 0.08, 0.1, 0.5); },
    lock: t => { bell(88, t, 0.22, 0.8); bell(95, t + 0.07, 0.14, 0.9); },
    tick: t => tone(1500, t, 0.05, { type: "square", vol: 0.06, filter: 3000 }),
    tickHi: t => tone(1900, t, 0.06, { type: "square", vol: 0.09, filter: 4000 }),
    timeup: t => { tone(196, t, 0.5, { type: "square", vol: 0.18, filter: 900 }); tone(147, t + 0.12, 0.6, { type: "square", vol: 0.16, filter: 700 }); },
    allin: t => { [72, 76, 79].forEach((n, i) => bell(n, t + i * 0.06, 0.12, 0.7)); },
    start: t => { noise(t, 0.5, { vol: 0.12, f: 400, f2: 4000, q: 2 }); bell(79, t + 0.35, 0.2); bell(84, t + 0.5, 0.2); sleigh(t + 0.5); },
    draw: t => { [60, 64, 67, 72, 76].forEach((n, i) => tone(N(n), t + i * 0.07, 0.25, { type: "triangle", vol: 0.16 })); for (let i = 0; i < 6; i++) noise(t + 0.45 + i * 0.09, 0.07, { vol: 0.05, f: 2500, q: 3 }); },
    pencils: t => { tone(880, t, 0.25, { type: "triangle", vol: 0.2 }); tone(660, t + 0.2, 0.4, { type: "triangle", vol: 0.2 }); },
    reveal: t => { drumroll(t, 0.5, 0.08); cymbal(t + 0.5, 0.1, 0.8); },
    correct: t => { [72, 76, 79, 84].forEach((n, i) => tone(N(n), t + i * 0.08, 0.35, { type: "triangle", vol: 0.22 })); bell(96, t + 0.34, 0.12); sleigh(t + 0.3, 0.06); },
    wrong: t => { [62, 61, 60].forEach((n, i) => tone(N(n), t + i * 0.28, 0.32, { type: "sawtooth", vol: 0.2, filter: 1100, a: 0.02 })); tone(N(59), t + 0.84, 0.8, { type: "sawtooth", vol: 0.2, filter: 900, f2: N(55) }); },
    miss: t => { kick(t, 0.35); tone(110, t, 0.5, { type: "triangle", vol: 0.15, f2: 70 }); },
    art: t => { [67, 71, 74, 79].forEach((n, i) => bell(n, t + i * 0.09, 0.14, 0.8)); },
    board: t => { drumroll(t, 0.7, 0.08); [60, 64, 67].forEach(n => brass(n, t + 0.7, 0.5, 0.08)); },
    up: t => { [76, 81].forEach((n, i) => tone(N(n), t + i * 0.09, 0.2, { type: "triangle", vol: 0.16 })); },
    final: t => { drumroll(t, 1.6, 0.22); cymbal(t + 1.6, 0.12, 1.2); },
    podium: t => { drumroll(t, 1.1, 0.12); cymbal(t + 1.1, 0.18); [55, 60, 64, 67].forEach(n => brass(n, t + 1.1, 0.9, 0.07)); },
    winner: t => {
      drumroll(t, 1.4, 0.14); cymbal(t + 1.4, 0.3, 2.4); kick(t + 1.4);
      const s = t + 1.4, m = [[67, 0, .18], [67, .18, .18], [67, .36, .18], [72, .54, .9], [76, 1.5, .25], [79, 1.75, .25], [84, 2.0, 1.4]];
      m.forEach(([n, o, d]) => brass(n, s + o, d + 0.1, 0.14));
      [48, 55].forEach(n => tone(N(n), s + 2.0, 1.6, { type: "triangle", vol: 0.2 }));
      for (let i = 0; i < 10; i++) sleigh(s + 2.0 + i * 0.16, 0.05);
    },
    winnerMe: t => {
      SOUNDS.winner(t);
      const s = t + 1.4; // crowd-ish cheer
      for (let i = 0; i < 4; i++) noise(s + 0.2 + i * 0.5, 1.2, { vol: 0.16, type: "bandpass", f: 1400 + i * 300, q: 0.6, a: 0.15 });
      [84, 88, 91, 96].forEach((n, i) => bell(n, s + 3.4 + i * 0.1, 0.16, 1.2));
    },
    place: t => { [72, 76, 79].forEach((n, i) => brass(n, t + i * 0.12, 0.4, 0.1)); sleigh(t + 0.36); },
    awards: t => { [67, 72, 76].forEach((n, i) => bell(n, t + i * 0.12, 0.16)); },
    gallery: t => { [72, 74, 76, 79, 81, 84].forEach((n, i) => bell(n, t + i * 0.1, 0.1, 0.9)); }
  };

  // play `name` at server time `atMs` (Backend.now() clock); late by more than 1.5 s → skip
  function playAt(name, atMs, nowMs) {
    if (!sfxOn || !SOUNDS[name] || !ensure() || ctx.state !== "running") return;
    const delay = (atMs - nowMs) / 1000;
    if (delay < -1.5) return;
    SOUNDS[name](ctx.currentTime + Math.max(0.01, delay));
  }
  // play straight away (for your own taps: lock-in, sending a drawing, joining)
  function play(name) { if (sfxOn && SOUNDS[name] && ensure() && ctx.state === "running") SOUNDS[name](ctx.currentTime + 0.01); }

  // ---------- background music: quiet, original, festive lo-fi ----------
  // 108 bpm, 4 bars of 4 beats: C · Am7 · F · G, soft pad, bouncy bass, light kick/clap,
  // sleigh shaker and a twinkly bell arpeggio.
  const BPM = 108, BEAT = 60 / BPM, BAR = BEAT * 4, LOOP = BAR * 4;
  const CHORDS = [[48, [64, 67, 72, 76]], [45, [64, 67, 69, 72]], [41, [65, 69, 72, 77]], [43, [62, 67, 71, 74]]];
  const ARP = [0, 2, 1, 3, 2, 3, 1, 2];
  const BASS = { 0: 0, 3: 12, 4: 7, 6: 0, 7: 12 }; // which eighths get a bass note, and how far above the root
  let musicTimer = null, nextBeat = null, clock = () => Date.now();
  function scheduleMusic() {
    if (!ctx || ctx.state !== "running") return;
    const nowS = clock() / 1000, ahead = 0.6;
    if (nextBeat == null || nextBeat < nowS) nextBeat = Math.ceil(nowS / (BEAT / 2)) * (BEAT / 2);
    while (nextBeat < nowS + ahead) {
      const inLoop = ((nextBeat % LOOP) + LOOP) % LOOP;
      musicStep(ctx.currentTime + (nextBeat - nowS), Math.floor(inLoop / BAR), Math.round((inLoop % BAR) / (BEAT / 2)) % 8);
      nextBeat += BEAT / 2;
    }
  }
  function musicStep(at, bar, half) { // half = which eighth of the bar, 0..7
      const [root, ch] = CHORDS[bar];
      if (half === 0) ch.forEach(n => { tone(N(n), at, BAR * 1.02, { type: "triangle", vol: 0.04, a: 0.25, out: musicBus, filter: 1600 }); tone(N(n), at, BAR, { type: "sine", vol: 0.03, a: 0.25, detune: 7, out: musicBus }); });
      if (BASS[half] != null) tone(N(root + BASS[half]), at, BEAT * 0.45, { type: "triangle", vol: 0.17, a: 0.01, out: musicBus, filter: 900 });
      if (half === 0 || half === 4) kick(at, 0.14, musicBus);
      if (half === 2 || half === 6) noise(at, 0.12, { vol: 0.06, type: "bandpass", f: 1700, q: 0.9, out: musicBus, a: 0.003 }); // clap
      noise(at, 0.05, { vol: half % 2 ? 0.035 : 0.018, type: "highpass", f: 8500, out: musicBus }); // shaker on every eighth
      const n = ch[ARP[half]] + 12;
      bell(n, at, 0.05, 0.7, musicBus);
      if (half === 7 && bar % 2 === 1) bell(ch[3] + 24, at + BEAT / 4, 0.03, 0.6, musicBus); // sparkle
  }
  function startMusic() {
    if (!ensure() || ctx.state !== "running") return;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(0.5, ctx.currentTime, 0.8);
    if (!musicTimer) { nextBeat = null; musicTimer = setInterval(scheduleMusic, 150); scheduleMusic(); }
  }
  function stopMusic() {
    if (!ctx) return;
    musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    clearInterval(musicTimer); musicTimer = null;
  }

  // ---------- switches ----------
  function setSfx(on) { sfxOn = on; localStorage.setItem(ST_SFX, on ? "1" : "0"); if (ctx) sfxBus.gain.value = on ? 0.55 : 0; unlock(); changed(); }
  function setMusic(on) { musicOn = on; localStorage.setItem(ST_MUSIC, on ? "1" : "0"); unlock(); on ? startMusic() : stopMusic(); changed(); }
  // quieter music while people are answering or drawing
  function duck(on) { if (ctx && musicOn && musicTimer) musicBus.gain.setTargetAtTime(on ? 0.22 : 0.5, ctx.currentTime, 0.5); }
  function useClock(fn) { clock = fn; }
  // the 🔊 / 🎵 buttons (rendered by the pages)
  const buttons = () => `<span class="sndbtns">
      ${sfxOn && !unlocked() ? `<button class="sndbtn wake" data-snd="wake" title="Tap to turn sound on">🔇 Tap for sound</button>`
        : `<button class="sndbtn ${sfxOn ? "on" : ""}" data-snd="sfx" title="Sound effects">${sfxOn ? "🔊" : "🔇"}</button>`}
      <button class="sndbtn ${musicOn ? "on" : ""}" data-snd="music" title="Background music">🎵</button></span>`;
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-snd]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.snd;
    if (k === "wake") { unlock(); setTimeout(changed, 50); }
    if (k === "sfx") setSfx(!sfxOn);
    if (k === "music") setMusic(!musicOn);
  }, true);

  // dev: render a timeline of sounds (and optionally music) into an AudioBuffer
  async function _offline(seconds, timeline, withMusic) {
    const keep = { ctx, master, sfxBus, musicBus, noiseBuf };
    const rate = 44100, oc = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate);
    ctx = oc; master = oc.createGain(); master.gain.value = 0.9; master.connect(oc.destination);
    sfxBus = oc.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
    musicBus = oc.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
    noiseBuf = oc.createBuffer(1, rate * 2, rate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    try {
      for (const [t, name] of timeline) SOUNDS[name](t);
      if (withMusic) for (let e = 0; e * BEAT / 2 < withMusic.dur; e++) musicStep(withMusic.at + e * BEAT / 2, Math.floor(e / 8) % 4, e % 8);
      return await oc.startRendering();
    } finally { ({ ctx, master, sfxBus, musicBus, noiseBuf } = keep); }
  }

  return { playAt, play, _offline, setSfx, setMusic, duck, useClock, buttons, onChange: f => listeners.add(f), unlocked,
    get sfxOn() { return sfxOn; }, get musicOn() { return musicOn; }, _sounds: SOUNDS };
})();
