/**
 * Music scheduler (ART_UX 9.3): a look-ahead scheduler run from the `audio` frame phase turns the bars of the
 * pure generator (logic/music.js) into buffer-source notes with a 150 ms horizon. Notes are pre-rendered
 * instrument samples played with `playbackRate` (two nodes per sounding note). The exploration and combat layers
 * crossfade over 2 s; entering combat lands on the next beat, leaving it keeps a 4 s tail that ends on a bar.
 * Stingers play over everything on their own route and hush the exploration phrases for a moment.
 * @module audio/music
 */

import { createMusicGen, stingerNotes, PALETTES, DENSITY, FORM_SHIFT } from './logic/music.js';
import { INSTRUMENTS, sampleFor } from './logic/instruments.js';

/** Scheduling horizon (s). */
const HORIZON = 0.15;
/** Pending note pool size. */
const PENDING = 128;
/** Music voices per tier. */
const MUSIC_VOICES = { low: 10, high: 16 };
/** Layer gains: music -9 dB exploring, -6 dB in combat (ART_UX 9.1). */
const EXPLORE_GAIN = 0.355;
const COMBAT_GAIN = 0.5;
/** Crossfade time constant (2 s fades). */
const XFADE_TC = 0.6;
/** Combat tail before returning to exploration (s). */
const COMBAT_TAIL = 4;

/** @typedef {{ t:number, dur:number, inst:string, midi:number, vel:number, layer:number, used:boolean }} Pending */
/** @typedef {{ src:any, gain:any, end:number, layer:number }} MusicVoice */

/**
 * @param {any} ctx @param {any} engine
 */
export function createMusic(ctx, engine) {
  const seed = (ctx.flags && Number.isFinite(ctx.flags.seed) ? ctx.flags.seed : 1) ^ 0x6d757369;
  const gen = createMusicGen(seed);
  /** What the game asked for (setMusic). */
  const req = { mode: 'explore', palette: 'warm', intensity: 0, formId: /** @type {string|null} */ (null), settlement: false };
  /** What the generator plays now. */
  const st = { mode: 'explore', palette: 'warm', intensity: 0, density: 0.7, night: false, settlement: false, keyShift: 0, lydian: false, parts: 4 };
  let nextBar = 0;
  let leaveAskedAt = -1;
  let bossPhase = 0;
  let hushUntil = 0;
  /** @type {Pending[]} */
  const pending = [];
  for (let i = 0; i < PENDING; i++) pending.push({ t: 0, dur: 0, inst: '', midi: 0, vel: 0, layer: 0, used: false });
  /** @type {MusicVoice[]} */
  const voices = [];
  for (let i = 0; i < MUSIC_VOICES.high; i++) voices.push({ src: null, gain: null, end: 0, layer: -1 });
  const pick = { index: 0, rate: 1 };
  const stingerBuf = [];
  for (let i = 0; i < 32; i++) stingerBuf.push({ t: 0, dur: 0, inst: '', midi: 0, vel: 0 });
  let lastBarLen = 2;
  let lastBeatLen = 0.5;

  function nVoices() {
    return MUSIC_VOICES[engine.tier] || MUSIC_VOICES.low;
  }

  /** Shared onended handler; `this` is the source. */
  function onEnded() {
    const src = this;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (v.src === src) {
        freeVoice(v);
        return;
      }
    }
  }

  /** @param {MusicVoice} v */
  function freeVoice(v) {
    if (!v.src) return;
    v.src.onended = null;
    try { v.src.stop(); } catch (err) { /* already stopped */ }
    v.src.disconnect();
    v.src = null;
    engine.addNodes(-1);
  }

  /** @param {number} layer @returns {any} */
  function layerNode(layer) {
    const b = engine.bus;
    return layer === 0 ? b.explore : layer === 1 ? b.combat : b.duck;
  }

  /**
   * Start one note now-ish on a pooled music voice.
   * @param {Pending} p
   */
  function startNote(p) {
    const ac = engine.ac;
    const list = engine.samples[p.inst];
    if (!list) return;
    sampleFor(p.inst, p.midi, pick);
    const buf = list[pick.index];
    if (!buf) return;
    const t = Math.max(p.t, ac.currentTime);
    const n = nVoices();
    let v = null;
    let oldest = null;
    for (let i = 0; i < n; i++) {
      const c = voices[i];
      if (!c.src || c.end <= t) { v = c; break; }
      if (!oldest || c.end < oldest.end) oldest = c;
    }
    if (!v) v = oldest;
    if (!v) return;
    const need = (v.src ? 0 : 1) + (v.gain ? 0 : 1);
    if (!engine.canAfford(need)) return;
    if (v.src) freeVoice(v);
    if (!v.gain) {
      v.gain = ac.createGain();
      engine.addNodes(1);
      v.layer = -1;
    }
    if (v.layer !== p.layer) {
      v.gain.disconnect();
      v.gain.connect(layerNode(p.layer));
      v.layer = p.layer;
    }
    const ins = INSTRUMENTS[p.inst];
    const rate = pick.rate;
    const natural = buf.duration / rate;
    const vel = p.vel * ins.gain;
    const g = v.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(vel, t);
    let end = t + natural;
    if (p.dur < natural) {
      g.setValueAtTime(vel, t + p.dur);
      g.linearRampToValueAtTime(0.0001, t + p.dur + ins.release);
      end = Math.min(end, t + p.dur + ins.release);
    }
    const src = ac.createBufferSource();
    engine.addNodes(1);
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(v.gain);
    src.onended = onEnded;
    src.start(t);
    src.stop(end + 0.02);
    v.src = src;
    v.end = end;
  }

  /** @param {number} t @param {number} dur @param {string} inst @param {number} midi @param {number} vel @param {number} layer */
  function queueNote(t, dur, inst, midi, vel, layer) {
    for (let i = 0; i < PENDING; i++) {
      const p = pending[i];
      if (p.used) continue;
      p.used = true;
      p.t = t; p.dur = dur; p.inst = inst; p.midi = midi; p.vel = vel; p.layer = layer;
      return;
    }
  }

  /** Refresh the environment-driven parts of the state. */
  function readWorld() {
    const env = ctx.env;
    const phase = env && typeof env.phase === 'string' ? env.phase : 'day';
    st.density = DENSITY[phase] !== undefined ? DENSITY[phase] : 0.7;
    st.night = phase === 'night';
    st.parts = engine.tier === 'high' ? 8 : 4;
    st.settlement = req.settlement;
    st.palette = PALETTES[req.palette] ? req.palette : 'warm';
    st.intensity = req.intensity;
  }

  /** @param {number} T context time of the switch @param {string} mode */
  function crossfade(T, mode) {
    const b = engine.bus;
    const toCombat = mode === 'combat' || mode === 'boss';
    const silent = mode === 'silent';
    b.explore.gain.cancelScheduledValues(T);
    b.combat.gain.cancelScheduledValues(T);
    b.explore.gain.setTargetAtTime(toCombat || silent ? 0 : EXPLORE_GAIN, T, XFADE_TC);
    b.combat.gain.setTargetAtTime(toCombat && !silent ? COMBAT_GAIN : 0, T, XFADE_TC);
  }

  /** Generate and queue one bar starting at `nextBar`. */
  function scheduleBar() {
    const ac = engine.ac;
    readWorld();
    // mode changes land on this bar boundary
    let want = req.mode;
    const inFight = st.mode === 'combat' || st.mode === 'boss';
    if (inFight && want === 'explore') {
      if (leaveAskedAt < 0) leaveAskedAt = ac.currentTime;
      if (ac.currentTime - leaveAskedAt < COMBAT_TAIL) want = st.mode;
    } else leaveAskedAt = -1;
    if (want !== st.mode) {
      st.mode = want;
      crossfade(nextBar, want);
    }
    const fight = st.mode === 'combat' || st.mode === 'boss';
    st.keyShift = fight ? (req.formId && FORM_SHIFT[req.formId] !== undefined ? FORM_SHIFT[req.formId] : 0) + bossPhase * 3 : 0;
    st.lydian = fight && req.formId === 'zenith';
    const spb = 60 / gen.bpm(st);
    const count = gen.next(st);
    const layer = fight ? 1 : 0;
    for (let i = 0; i < count; i++) {
      const n = gen.notes[i];
      const t = nextBar + n.t * spb;
      if (!fight && t < hushUntil && n.inst !== 'pad' && n.inst !== 'drone') continue;
      queueNote(t, n.dur * spb, n.inst, n.midi, n.vel, layer);
    }
    lastBeatLen = spb;
    lastBarLen = 4 * spb;
    nextBar += lastBarLen;
  }

  const music = {
    /** @param {object} s partial MusicState from setMusic */
    set(s) {
      if (!s) return;
      const o = /** @type {any} */ (s);
      if (o.mode === 'explore' || o.mode === 'combat' || o.mode === 'boss' || o.mode === 'silent') {
        if (o.mode !== 'boss' && req.mode === 'boss') bossPhase = 0;
        req.mode = o.mode;
      }
      if (o.palette === 'warm' || o.palette === 'cold' || o.palette === 'corrupted') req.palette = o.palette;
      if (typeof o.intensity === 'number') req.intensity = Math.max(0, Math.min(3, o.intensity));
      if (o.formId !== undefined) req.formId = o.formId;
      if (typeof o.settlement === 'boolean') req.settlement = o.settlement;
      // entering a fight lands on the next beat instead of the next (long) exploration bar
      const ac = engine.ac;
      if (ac && nextBar > 0 && (req.mode === 'combat' || req.mode === 'boss') && st.mode === 'explore') {
        const t = ac.currentTime + 0.05;
        const barStart = nextBar - lastBarLen;
        const beat = Math.ceil((t - barStart) / lastBeatLen);
        const nb = barStart + beat * lastBeatLen;
        if (nb < nextBar) nextBar = Math.max(t, nb);
      }
      if (req.mode === 'silent' && ac) crossfade(ac.currentTime, 'silent');
    },

    /** Boss phase: modulate up a minor third. */
    bossPhase() {
      bossPhase++;
    },

    /** @returns {object} a copy of the current state (debug) */
    state() {
      return { req: { ...req }, mode: st.mode, palette: st.palette, intensity: st.intensity, density: st.density, keyShift: st.keyShift, bar: gen.bar };
    },

    /**
     * Stinger over the music.
     * @param {string} id
     */
    stinger(id) {
      const ac = engine.ac;
      if (!ac || !engine.ready) return;
      readWorld();
      let root = PALETTES[st.palette].root;
      if (id === 'transform') root += req.formId && FORM_SHIFT[req.formId] !== undefined ? FORM_SHIFT[req.formId] : 0;
      else if (st.mode === 'combat' || st.mode === 'boss') root += st.keyShift;
      const n = stingerNotes(id, root, stingerBuf);
      const t0 = ac.currentTime + 0.04;
      for (let i = 0; i < n; i++) {
        const s = stingerBuf[i];
        queueNote(t0 + s.t, s.dur, s.inst, s.midi, s.vel, 2);
      }
      hushUntil = t0 + 3;
    },

    /** Frame: queue bars ahead and start the notes inside the horizon. */
    frame() {
      const ac = engine.ac;
      if (!ac || !engine.ready || ac.state !== 'running') return;
      const t = ac.currentTime;
      if (req.mode === 'silent' && st.mode === 'silent') return;
      if (nextBar === 0 || nextBar < t - 1) nextBar = t + 0.1;
      let guard = 0;
      while (nextBar < t + HORIZON + 0.05 && guard++ < 4) scheduleBar();
      for (let i = 0; i < PENDING; i++) {
        const p = pending[i];
        if (!p.used) continue;
        if (p.t < t - 0.1) { p.used = false; continue; }
        if (p.t < t + HORIZON) {
          p.used = false;
          startNote(p);
        }
      }
    },

    /** Stop every note (session end). */
    stopAll() {
      for (let i = 0; i < PENDING; i++) pending[i].used = false;
      for (let i = 0; i < voices.length; i++) freeVoice(voices[i]);
      nextBar = 0;
    },

    /** @returns {number} sounding music notes */
    voices() {
      let n = 0;
      for (let i = 0; i < voices.length; i++) if (voices[i].src) n++;
      return n;
    },

    gen,
  };
  return music;
}
