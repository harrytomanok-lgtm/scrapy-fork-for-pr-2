/**
 * Audio engine (ARCHITECTURE 4.2, ART_UX 9.1): AudioContext unlocked on the first gesture, the bus graph
 * (voices -> sfx / ui / music -> compressor -> master), time-sliced pre-rendering of every one-shot and instrument
 * sample into AudioBuffers, pooled buffer voices with per-recipe caps and stealing, simple spatialisation
 * (StereoPanner, 1 / (1 + d/15) distance gain, a far lowpass bus), the live loops, music ducking, the menu filter
 * and the 120-node budget. With `noaudio=1` no AudioContext is ever created.
 * @module audio/engine
 */

import { RECIPES, PRIORITY, CAPS, renderRecipe, recipeRate } from './logic/recipes.js';
import { INSTRUMENTS, INSTRUMENT_IDS, renderInstrument } from './logic/instruments.js';
import { TIER_VOICES, TIER_VARIANTS, createSlot, findMerge, pickSlot, busyCount, distanceGain } from './logic/voices.js';
import { createLoopSlot, buildLoop, applyLevel, LOOP_COST, LOOP_GAIN } from './loops.js';
import { softClip } from './logic/dsp.js';

/** Hard cap of live AudioNodes owned by the engine (ARCHITECTURE 7.1). */
export const NODE_BUDGET = 120;
/** Max pool size over all tiers. */
const MAX_SLOTS = 32;
/** Max concurrent live loops. */
const MAX_LOOPS = 6;
/** Beyond this distance a positional voice goes through the far lowpass bus (m). */
const FAR_DIST = 70;
/** Pre-render slice budget (ms) and pause between slices. */
const SLICE_MS = 6;
const SLICE_GAP = 4;
/** Ids that never get a pre-rendered buffer (rendered live). */
const LIVE = new Set(['wind_loop', 'gather_loop', 'beam_loop', 'siphon_loop', 'ambience']);

/** @param {number} db */
export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

/**
 * @typedef {import('./logic/voices.js').VoiceSlot & { src:any, gain:any, pan:any, route:number, baseVol:number, rate:number, loop:boolean, entId:number }} Voice
 */

/**
 * Create the engine.
 * @param {any} ctx
 * @param {{ makeContext?:()=>any, sync?:boolean, noWindow?:boolean, gestureTarget?:any, isHidden?:()=>boolean }} [opts]
 *   tests inject a mock context and render synchronously; gestureTarget and isHidden replace the window and
 *   document.hidden for the unlock gestures
 */
export function createEngine(ctx, opts = {}) {
  const flags = ctx.flags || {};
  const noaudio = flags.noaudio === true || flags.noaudio === 1 || flags.noaudio === '1';
  const hasWindow = !opts.noWindow && typeof window !== 'undefined';
  /** @type {any} */
  let ac = null;
  let nodeCount = 0;
  let nextId = 1;
  let paused = false;
  let tier = 'low';
  let poolSize = TIER_VOICES.low;
  let variantsWanted = TIER_VARIANTS.low;
  const volume = { master: 0.8, music: 0.7, sfx: 0.9, ui: 1 };
  /** @type {Record<string, any>} buses and shared resources */
  const bus = { master: null, comp: null, sfx: null, ui: null, far: null, musicVol: null, musicLP: null, duck: null, explore: null, combat: null, send: null, verb: null, fb: null, wet: null };
  const shared = { pink: null, white: null, clipCurve: /** @type {any} */ (null) };
  /** @type {Record<string, any[]>} rendered variants per sfx id */
  const buffers = Object.create(null);
  /** @type {Record<string, any[]>} instrument samples per instrument id */
  const samples = Object.create(null);
  /** @type {Record<string, number>} last variant played per id */
  const lastVariant = Object.create(null);
  /** @type {Array<[string, string, number]>} pre-render queue: [kind, id, index] */
  const queue = [];
  let queuePos = 0;
  let pumpTimer = 0;
  /** Listener pose (written by the frame system). */
  const L = { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0 };
  const warned = new Set();

  /** @type {Voice[]} */
  const slots = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const s = /** @type {Voice} */ (createSlot());
    s.src = null; s.gain = null; s.pan = null; s.route = -1; s.baseVol = 1; s.rate = 1; s.loop = false; s.entId = 0;
    slots.push(s);
  }
  const loops = [];
  for (let i = 0; i < MAX_LOOPS; i++) loops.push(createLoopSlot());

  /** @param {string} key @param {...any} args */
  function warnOnce(key, ...args) {
    if (warned.has(key)) return;
    warned.add(key);
    if (ctx.log && ctx.log.warn) ctx.log.warn('audio', ...args);
  }

  function now() {
    return ac ? ac.currentTime : 0;
  }

  // ------------------------------------------------------------------ graph

  function makeNoise(seconds, colour) {
    const sr = 22050;
    const n = Math.floor(seconds * sr);
    const b = ac.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    let s = 0x2545f491;
    const p = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      const w = ((s >>> 0) / 4294967296) * 2 - 1;
      if (colour === 'white') d[i] = w * 0.5;
      else {
        p[0] = 0.99886 * p[0] + w * 0.0555179; p[1] = 0.99332 * p[1] + w * 0.0750759; p[2] = 0.969 * p[2] + w * 0.153852;
        p[3] = 0.8665 * p[3] + w * 0.3104856; p[4] = 0.55 * p[4] + w * 0.5329522; p[5] = -0.7616 * p[5] - w * 0.016898;
        d[i] = (p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + w * 0.5362) * 0.11;
        p[6] = w * 0.115926;
      }
    }
    // crossfade the loop point
    const xf = 1024;
    for (let i = 0; i < xf; i++) {
      const t = i / xf;
      d[n - xf + i] = d[n - xf + i] * (1 - t) + d[i] * t;
    }
    return b;
  }

  function gainNode(v) {
    const g = ac.createGain();
    g.gain.value = v;
    nodeCount++;
    return g;
  }

  function buildGraph() {
    const c = ac;
    bus.master = gainNode(volume.master);
    bus.comp = c.createDynamicsCompressor();
    nodeCount++;
    bus.comp.threshold.value = -18;
    bus.comp.ratio.value = 4;
    bus.comp.attack.value = 0.005;
    bus.comp.release.value = 0.12;
    bus.comp.knee.value = 6;
    bus.comp.connect(bus.master);
    bus.master.connect(c.destination);
    bus.sfx = gainNode(volume.sfx);
    bus.sfx.connect(bus.comp);
    bus.ui = gainNode(volume.sfx * volume.ui);
    bus.ui.connect(bus.comp);
    bus.far = c.createBiquadFilter();
    nodeCount++;
    bus.far.type = 'lowpass';
    bus.far.frequency.value = 2400;
    bus.far.Q.value = 0.5;
    bus.far.connect(bus.sfx);
    bus.musicVol = gainNode(volume.music);
    bus.musicVol.connect(bus.comp);
    bus.musicLP = c.createBiquadFilter();
    nodeCount++;
    bus.musicLP.type = 'lowpass';
    bus.musicLP.frequency.value = 20000;
    bus.musicLP.Q.value = 0.5;
    bus.musicLP.connect(bus.musicVol);
    bus.duck = gainNode(1);
    bus.duck.connect(bus.musicLP);
    bus.explore = gainNode(1);
    bus.explore.connect(bus.duck);
    bus.combat = gainNode(0);
    bus.combat.connect(bus.duck);
    // space: a feedback delay on low, a generated convolver reverb on high
    bus.send = gainNode(0.22);
    bus.wet = gainNode(tier === 'high' ? 0.5 : 0.35);
    bus.duck.connect(bus.send);
    bus.far.connect(bus.send);
    if (tier === 'high' && c.createConvolver) {
      bus.verb = c.createConvolver();
      nodeCount++;
      bus.verb.buffer = makeImpulse(2.2);
      bus.send.connect(bus.verb);
      bus.verb.connect(bus.wet);
      bus.fb = null;
    } else {
      bus.verb = c.createDelay(1);
      nodeCount++;
      bus.verb.delayTime.value = 0.27;
      bus.fb = gainNode(0.32);
      bus.send.connect(bus.verb);
      bus.verb.connect(bus.fb);
      bus.fb.connect(bus.verb);
      bus.verb.connect(bus.wet);
    }
    bus.wet.connect(bus.comp);
    shared.pink = makeNoise(2, 'pink');
    shared.white = makeNoise(1, 'white');
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = softClip((i / 1023) * 2 - 1, 2.5);
    shared.clipCurve = curve;
  }

  /** @param {number} seconds */
  function makeImpulse(seconds) {
    const sr = ac.sampleRate;
    const n = Math.floor(seconds * sr);
    const b = ac.createBuffer(2, n, sr);
    let s = 0x1234567;
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        d[i] = (((s >>> 0) / 4294967296) * 2 - 1) * Math.pow(1 - i / n, 2.6);
      }
    }
    return b;
  }

  function applyVolumes() {
    if (!ac) return;
    const t = ac.currentTime;
    bus.master.gain.setTargetAtTime(volume.master, t, 0.02);
    bus.sfx.gain.setTargetAtTime(volume.sfx * (paused ? 0.4 : 1), t, 0.05);
    bus.ui.gain.setTargetAtTime(volume.sfx * volume.ui, t, 0.05);
    // menu filter: music lowpassed to 800 Hz at -6 dB
    bus.musicVol.gain.setTargetAtTime(volume.music * (paused ? 0.5 : 1), t, 0.08);
    bus.musicLP.frequency.setTargetAtTime(paused ? 800 : 20000, t, 0.08);
  }

  // ------------------------------------------------------------------ pre-rendering

  function buildQueue() {
    queue.length = 0;
    queuePos = 0;
    const seen = new Set();
    const pushSfx = (id, v) => {
      const key = id + ':' + v;
      if (seen.has(key) || LIVE.has(id) || !RECIPES[id]) return;
      seen.add(key);
      queue.push(['sfx', id, v]);
    };
    for (const id of PRIORITY) pushSfx(id, 0);
    for (const id of ['pad', 'flute', 'bell', 'lute', 'bass']) {
      for (let i = 0; i < INSTRUMENTS[id].bases.length; i++) queue.push(['ins', id, i]);
    }
    for (const id of Object.keys(RECIPES)) pushSfx(id, 0);
    for (const id of INSTRUMENT_IDS) {
      if (id === 'pad' || id === 'flute' || id === 'bell' || id === 'lute' || id === 'bass') continue;
      for (let i = 0; i < INSTRUMENTS[id].bases.length; i++) queue.push(['ins', id, i]);
    }
    for (let v = 1; v < variantsWanted; v++) for (const id of Object.keys(RECIPES)) pushSfx(id, v);
  }

  /** @param {Float32Array} data @param {number} sr */
  function toBuffer(data, sr) {
    const b = ac.createBuffer(1, data.length, sr);
    if (b.copyToChannel) b.copyToChannel(data, 0);
    else b.getChannelData(0).set(data);
    return b;
  }

  /** Render one queued job. */
  function renderJob(job) {
    if (job[0] === 'sfx') {
      const data = renderRecipe(job[1], job[2]);
      if (!data) return;
      const list = buffers[job[1]] || (buffers[job[1]] = []);
      list[job[2]] = toBuffer(data, recipeRate(job[1]));
    } else {
      const list = samples[job[1]] || (samples[job[1]] = []);
      list[job[2]] = toBuffer(renderInstrument(job[1], job[2]), INSTRUMENTS[job[1]].sr);
    }
  }

  function pump() {
    pumpTimer = 0;
    if (!ac) return;
    const clock = typeof performance !== 'undefined' ? performance : Date;
    const t0 = clock.now();
    while (queuePos < queue.length) {
      try {
        renderJob(queue[queuePos]);
      } catch (err) {
        warnOnce('render:' + queue[queuePos][1], 'render failed', queue[queuePos][1], String(err));
      }
      queuePos++;
      if (clock.now() - t0 > SLICE_MS) break;
    }
    if (queuePos < queue.length) pumpTimer = /** @type {any} */ (setTimeout(pump, SLICE_GAP));
  }

  /** Render everything left in the queue now (tests). */
  function flushRender() {
    while (queuePos < queue.length) renderJob(queue[queuePos++]);
  }

  // ------------------------------------------------------------------ voices

  /** Shared `onended` handler: `this` is the source node. */
  function onVoiceEnded() {
    const src = this;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const v = slots[i];
      if (v.src === src) {
        releaseVoice(v);
        return;
      }
    }
  }

  /** @param {Voice} v */
  function releaseVoice(v) {
    if (v.src) {
      v.src.onended = null;
      try { v.src.stop(); } catch (err) { /* already stopped */ }
      v.src.disconnect();
      v.src = null;
      nodeCount--;
    }
    v.id = 0;
    v.sfx = null;
    v.cap = null;
    v.loop = false;
    v.entId = 0;
  }

  /**
   * Pan and distance gain toward a world point, written into `out` ([gain, pan, distance]).
   * @param {number} x @param {number} y @param {number} z @param {Float64Array} out
   */
  function spatial(x, y, z, out) {
    const dx = x - L.x;
    const dy = y - L.y;
    const dz = z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    out[0] = distanceGain(d);
    const side = d > 1e-3 ? (dx * L.rx + dy * L.ry + dz * L.rz) / d : 0;
    out[1] = Math.max(-1, Math.min(1, side * Math.min(1, d / 4) * 0.85));
    out[2] = d;
    return out;
  }
  const sp = new Float64Array(3);

  /**
   * Connect a voice's gain to its route: 0 sfx, 1 ui, 2 positional near, 3 positional far.
   * @param {Voice} v @param {number} route
   */
  function routeVoice(v, route) {
    if (v.route === route) return;
    v.gain.disconnect();
    if (v.pan) v.pan.disconnect();
    if (route === 1) v.gain.connect(bus.ui);
    else if (route === 0 || !v.pan) v.gain.connect(bus.sfx);
    else {
      v.gain.connect(v.pan);
      v.pan.connect(route === 3 ? bus.far : bus.sfx);
    }
    v.route = route;
  }

  /**
   * Start a buffer on a pooled voice. Returns the voice id or 0.
   * @param {string} id @param {any} buffer @param {number} g gain @param {number} rate @param {number} route
   * @param {number} pan @param {boolean} loop @param {string|null} cap
   */
  function startVoice(id, buffer, g, rate, route, pan, loop, cap) {
    const t = ac.currentTime;
    const capLimit = cap !== null && CAPS[cap] !== undefined ? CAPS[cap] : 99;
    let i = pickSlot(slots, poolSize, cap, capLimit, t, g);
    if (i < 0) return 0;
    let v = slots[i];
    if (v.loop && v.id !== 0) return 0;
    // node budget: a new source plus, the first time, the slot's gain and panner
    const need = (v.src ? 0 : 1) + (v.gain ? 0 : 1) + (route >= 2 && !v.pan ? 1 : 0);
    if (nodeCount + need > NODE_BUDGET) {
      i = -1;
      let bestStart = Infinity;
      for (let k = 0; k < poolSize; k++) {
        const s = slots[k];
        if (s.id !== 0 && !s.loop && s.gain && (route < 2 || s.pan) && s.start < bestStart) { bestStart = s.start; i = k; }
      }
      if (i < 0) return 0;
      v = slots[i];
    }
    if (v.id !== 0) releaseVoice(v);
    if (!v.gain) {
      v.gain = ac.createGain();
      nodeCount++;
      v.route = -1;
    }
    if (route >= 2 && !v.pan && ac.createStereoPanner) {
      v.pan = ac.createStereoPanner();
      nodeCount++;
      v.route = -1;
    }
    routeVoice(v, route);
    if (v.pan && route >= 2) v.pan.pan.setValueAtTime(pan, t);
    const src = ac.createBufferSource();
    nodeCount++;
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = rate;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(g, t);
    src.connect(v.gain);
    src.onended = onVoiceEnded;
    v.src = src;
    v.id = nextId++;
    v.sfx = id;
    v.cap = cap;
    v.start = t;
    v.end = loop ? t + 3600 : t + buffer.duration / Math.max(0.05, rate);
    v.vol = g;
    v.baseVol = g;
    v.rate = rate;
    v.loop = loop;
    src.start(t);
    return v.id;
  }

  /** @param {number} id @returns {Voice|null} */
  function findVoice(id) {
    if (!id) return null;
    for (let i = 0; i < MAX_SLOTS; i++) if (slots[i].id === id) return slots[i];
    return null;
  }

  /** @param {number} id */
  function findLoop(id) {
    if (!id) return null;
    for (let i = 0; i < MAX_LOOPS; i++) if (loops[i].id === id) return loops[i];
    return null;
  }

  /** @param {string} id @returns {any} a rendered variant, or null */
  function pickBuffer(id) {
    const list = buffers[id];
    if (!list || !list[0]) return null;
    let n = 0;
    while (n < list.length && list[n]) n++;
    let v = n > 1 ? ctx.rng.fx.int(0, n - 1) : 0;
    if (n > 1 && v === lastVariant[id]) v = (v + 1) % n;
    lastVariant[id] = v;
    return list[v];
  }

  // ------------------------------------------------------------------ music support

  /**
   * Duck the music by `db` with an 80 ms attack, held for `hold` s, then a 400 ms release.
   * @param {number} db @param {number} hold
   */
  function duck(db, hold) {
    if (!ac) return;
    const t = ac.currentTime;
    const g = bus.duck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(dbToGain(db), t, 0.08 / 3);
    g.setTargetAtTime(1, t + 0.08 + hold, 0.4 / 3);
  }

  // ------------------------------------------------------------------ gestures and visibility

  /** Event target of the unlock gestures: `opts.gestureTarget` (tests) or the window. */
  const gestureTarget = opts.gestureTarget || (hasWindow ? window : null);
  /** @returns {boolean} the page is hidden (a hidden page must not resume audio) */
  function pageHidden() {
    if (typeof opts.isHidden === 'function') return !!opts.isHidden();
    return hasWindow && typeof document !== 'undefined' && !!document.hidden;
  }
  /**
   * Gestures that may grant user activation. A touch pointerdown does not (Chrome activates on pointerup,
   * touchend and click for touch), so the listeners stay armed and every gesture retries resume() until the
   * context reports 'running'; they are re-armed when the context is suspended or interrupted by the system.
   */
  const gestureEvents = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'click', 'keydown'];
  let listening = false;
  function onGesture() {
    engine.unlock();
  }
  /** @param {boolean} on */
  function listenGestures(on) {
    if (!gestureTarget || noaudio || listening === on) return;
    listening = on;
    for (const e of gestureEvents) {
      if (on) gestureTarget.addEventListener(e, onGesture, { capture: true });
      else gestureTarget.removeEventListener(e, onGesture, { capture: true });
    }
  }
  /** Disarm once the context runs; keep (or re-arm) the gesture listeners while it does not. */
  function checkRunning() {
    if (!ac) return;
    if (ac.state === 'running') listenGestures(false);
    else if (!pageHidden()) listenGestures(true);
  }
  /** Ask the context to run (when visible); the result is checked whether resume() succeeds or is refused. */
  function tryResume() {
    if (!ac || ac.state === 'running' || ac.state === 'closed' || pageHidden()) return;
    let pr = null;
    try {
      pr = ac.resume();
    } catch (err) {
      pr = null;
    }
    if (pr && typeof pr.then === 'function') pr.then(checkRunning, checkRunning);
  }
  function onStateChange() {
    // 'suspended' by the system (another app took audio focus) or 'interrupted' (iOS): wait for a new gesture.
    checkRunning();
  }
  function onVisibility() {
    if (!ac) return;
    if (pageHidden()) ac.suspend().catch(() => {});
    else {
      tryResume();
      checkRunning();
    }
  }

  const engine = {
    ready: false,
    bus,
    samples,
    /** @returns {any} the AudioContext or null */
    get ac() { return ac; },
    get tier() { return tier; },
    get paused() { return paused; },
    listener: L,

    /** Create and resume the AudioContext; call from a user gesture. Safe to call repeatedly. */
    unlock() {
      if (noaudio) return;
      if (ac) {
        tryResume();
        checkRunning();
        return;
      }
      try {
        if (opts.makeContext) ac = opts.makeContext();
        else {
          if (!hasWindow) return;
          const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
          if (!AC) return;
          ac = new AC({ latencyHint: 'interactive' });
        }
      } catch (err) {
        warnOnce('ctx', 'AudioContext unavailable', String(err));
        ac = null;
        return;
      }
      const s = ctx.save && ctx.save.settings;
      if (s) {
        if (typeof s.volMaster === 'number') volume.master = s.volMaster;
        if (typeof s.volMusic === 'number') volume.music = s.volMusic;
        if (typeof s.volSfx === 'number') volume.sfx = s.volSfx;
      }
      const r = ctx.render;
      engine.setTier(r && r.tier === 'high' ? 'high' : 'low');
      try {
        buildGraph();
      } catch (err) {
        warnOnce('graph', 'audio graph failed', String(err));
        try { ac.close(); } catch (e) { /* ignore */ }
        ac = null;
        return;
      }
      applyVolumes();
      buildQueue();
      if (opts.sync) flushRender();
      else pump();
      engine.ready = true;
      if (typeof ac.addEventListener === 'function') ac.addEventListener('statechange', onStateChange);
      else ac.onstatechange = onStateChange;
      // The listeners are removed only once the context really runs (a touch pointerdown gives no activation).
      tryResume();
      checkRunning();
      if (hasWindow && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      if (engine.onUnlock) engine.onUnlock();
    },

    /** @type {null|(() => void)} called once after the context exists */
    onUnlock: null,

    /** @param {'low'|'high'} t */
    setTier(t) {
      tier = t === 'high' ? 'high' : 'low';
      const n = TIER_VOICES[tier];
      if (ac) for (let i = n; i < MAX_SLOTS; i++) if (slots[i].id !== 0) releaseVoice(slots[i]);
      poolSize = n;
      if (!engine.ready) variantsWanted = TIER_VARIANTS[tier];
    },

    /**
     * One-shot; positional when `x` is given.
     * @param {string} id @param {{ x?:number, y?:number, z?:number, vol?:number, pitch?:number }} [o] @returns {number}
     */
    play(id, o) {
      if (!engine.ready || !ac || ac.state !== 'running') return 0;
      const r = RECIPES[id];
      if (!r) {
        warnOnce('id:' + id, 'unknown sfx id', id);
        return 0;
      }
      if (r.live) return 0;
      const t = ac.currentTime;
      const m = findMerge(slots, poolSize, id, t);
      if (m >= 0) return slots[m].id;
      const buf = pickBuffer(id);
      if (!buf) return 0;
      const vol = o && o.vol !== undefined ? o.vol : 1;
      const pitch = o && o.pitch !== undefined ? o.pitch : 1;
      const rng = ctx.rng.fx;
      let g = dbToGain(r.mix + rng.range(-1.5, 1.5)) * vol;
      let route = r.cap === 'ui' ? 1 : 0;
      let pan = 0;
      if (o && o.x !== undefined) {
        spatial(o.x, o.y || 0, o.z || 0, sp);
        g *= sp[0];
        pan = sp[1];
        route = sp[2] > FAR_DIST ? 3 : 2;
        if (g < 0.006) return 0;
      }
      const rate = pitch * (1 + rng.range(-0.04, 0.04));
      const vid = startVoice(id, buf, g, rate, route, pan, false, r.cap);
      if (vid && r.duck) {
        if (id === 'ult_impact') duck(-12, 1.5);
        else if (g > 0.25) duck(-6, 0.15);
      }
      return vid;
    },

    /**
     * Looping voice: the live loops build their own graph; any other id loops its pre-rendered buffer.
     * @param {string} id @param {{ entId?:number, x?:number, y?:number, z?:number, vol?:number }} [o] @returns {number}
     */
    loop(id, o) {
      if (!engine.ready || !ac) return 0;
      const vol = o && o.vol !== undefined ? o.vol : 1;
      if (LIVE.has(id)) {
        const cost = LOOP_COST[id];
        if (nodeCount + cost > NODE_BUDGET) {
          // free the room by stealing the oldest one-shots
          for (let tries = 0; tries < 8 && nodeCount + cost > NODE_BUDGET; tries++) {
            let best = -1;
            let bestStart = Infinity;
            for (let k = 0; k < poolSize; k++) if (slots[k].id !== 0 && !slots[k].loop && slots[k].start < bestStart) { bestStart = slots[k].start; best = k; }
            if (best < 0) break;
            releaseVoice(slots[best]);
          }
          if (nodeCount + cost > NODE_BUDGET) return 0;
        }
        let Ls = null;
        for (let i = 0; i < MAX_LOOPS; i++) if (loops[i].id === 0 && loops[i].nodes.length === 0) { Ls = loops[i]; break; }
        if (!Ls) return 0;
        buildLoop(ac, Ls, id, shared);
        nodeCount += Ls.nodes.length;
        Ls.id = nextId++;
        Ls.vol = vol;
        Ls.entId = o && o.entId ? o.entId : 0;
        Ls.positional = !!(o && (o.entId || o.x !== undefined));
        Ls.x = o && o.x !== undefined ? o.x : 0;
        Ls.y = o && o.y !== undefined ? o.y : 0;
        Ls.z = o && o.z !== undefined ? o.z : 0;
        Ls.dist = 1;
        Ls.endAt = 0;
        const target = Ls.pan || Ls.out;
        target.connect(bus.sfx);
        const t = ac.currentTime;
        Ls.lg = applyLevel(Ls, id === 'ambience' ? 0.5 : 0, t);
        Ls.t0 = t;
        engine.updateLoopPos(Ls);
        Ls.out.gain.setValueAtTime(0, t);
        Ls.out.gain.linearRampToValueAtTime(LOOP_GAIN[id] * vol * Ls.lg * Ls.dist, t + 0.25);
        for (let i = 0; i < Ls.sources.length; i++) Ls.sources[i].start(t);
        return Ls.id;
      }
      const r = RECIPES[id];
      const buf = r ? pickBuffer(id) : null;
      if (!buf) return 0;
      return startVoice(id, buf, dbToGain(r.mix) * vol, 1, r.cap === 'ui' ? 1 : 0, 0, true, null);
    },

    /** @param {import('./loops.js').LiveLoop} Ls position and distance gain of a live loop */
    updateLoopPos(Ls) {
      if (!Ls.positional) {
        Ls.dist = 1;
        return;
      }
      if (Ls.entId) {
        const e = ctx.ents.get(Ls.entId);
        if (e) { Ls.x = e.pos.x; Ls.y = e.pos.y + e.height * 0.5; Ls.z = e.pos.z; }
      }
      spatial(Ls.x, Ls.y, Ls.z, sp);
      Ls.dist = sp[0];
      if (Ls.pan) Ls.pan.pan.setTargetAtTime(sp[1], ac.currentTime, 0.05);
    },

    /** @param {number} voiceId @param {number} [fadeSeconds] */
    stop(voiceId, fadeSeconds = 0.1) {
      if (!ac || !voiceId) return;
      const t = ac.currentTime;
      const f = Math.max(0.005, fadeSeconds);
      const Ls = findLoop(voiceId);
      if (Ls) {
        Ls.id = 0;
        Ls.out.gain.cancelScheduledValues(t);
        Ls.out.gain.setValueAtTime(Ls.out.gain.value, t);
        Ls.out.gain.linearRampToValueAtTime(0, t + f);
        for (let i = 0; i < Ls.sources.length; i++) {
          try { Ls.sources[i].stop(t + f + 0.02); } catch (err) { /* ignore */ }
        }
        Ls.endAt = t + f + 0.05;
        return;
      }
      const v = findVoice(voiceId);
      if (!v || !v.src) return;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + f);
      v.loop = false;
      v.end = t + f;
      v.vol = 0;
      try { v.src.stop(t + f + 0.01); } catch (err) { releaseVoice(v); }
    },

    /** @param {number} voiceId @param {'vol'|'pitch'|'level'} name @param {number} value */
    setParam(voiceId, name, value) {
      if (!ac || !voiceId) return;
      const t = ac.currentTime;
      const Ls = findLoop(voiceId);
      if (Ls) {
        if (name === 'vol') Ls.vol = Math.max(0, value);
        else if (name === 'level') Ls.level = Math.max(0, Math.min(1, value));
        else if (name === 'pitch' && Ls.sources[0] && Ls.sources[0].playbackRate) Ls.sources[0].playbackRate.setTargetAtTime(value, t, 0.05);
        engine.refreshLoop(Ls);
        return;
      }
      const v = findVoice(voiceId);
      if (!v || !v.src) return;
      if (name === 'vol') {
        v.vol = v.baseVol * value;
        v.gain.gain.setTargetAtTime(v.vol, t, 0.03);
      } else if (name === 'pitch') v.src.playbackRate.setTargetAtTime(v.rate * value, t, 0.03);
      else if (name === 'level') v.src.playbackRate.setTargetAtTime(v.rate * (0.92 + 0.2 * Math.max(0, Math.min(1, value))), t, 0.05);
    },

    /** @param {import('./loops.js').LiveLoop} Ls */
    refreshLoop(Ls) {
      if (!ac || Ls.id === 0) return;
      const t = ac.currentTime;
      Ls.lg = applyLevel(Ls, Ls.level, t);
      Ls.out.gain.setTargetAtTime(LOOP_GAIN[Ls.kind] * Ls.vol * Ls.lg * Ls.dist, Math.max(t, Ls.t0 + 0.26), 0.06);
    },

    /** @param {'master'|'music'|'sfx'|'ui'} which @param {number} v */
    setVolume(which, v) {
      if (which !== 'master' && which !== 'music' && which !== 'sfx' && which !== 'ui') return;
      volume[which] = Math.max(0, Math.min(1, Number(v) || 0));
      applyVolumes();
    },

    /** Menu filter. @param {boolean} p */
    setPaused(p) {
      paused = !!p;
      applyVolumes();
    },

    duck,

    /** @returns {number} live voices: busy one-shot voices plus live loops */
    voices() {
      let n = busyCount(slots, MAX_SLOTS);
      for (let i = 0; i < MAX_LOOPS; i++) if (loops[i].id !== 0) n++;
      return n;
    },

    /** @returns {number} live AudioNodes owned by the engine */
    nodes() {
      return ac ? nodeCount : 0;
    },

    /** Node accounting for the music scheduler. @param {number} n */
    addNodes(n) {
      nodeCount += n;
    },

    /** @param {number} n @returns {boolean} room for n more nodes */
    canAfford(n) {
      return nodeCount + n <= NODE_BUDGET;
    },

    /** @returns {number} pending pre-render jobs */
    pending() {
      return queue.length - queuePos;
    },

    flushRender,

    /** @param {string} id @returns {number} rendered variants of an sfx id */
    variants(id) {
      const list = buffers[id];
      let n = 0;
      while (list && n < list.length && list[n]) n++;
      return n;
    },

    /**
     * Frame update: listener at the camera, positional loops, loop teardown.
     * @param {any} c ctx
     */
    frame(c) {
      if (!ac) return;
      const cam = c.three && c.three.camera;
      if (cam) {
        const e = cam.matrixWorld.elements;
        L.x = cam.position.x; L.y = cam.position.y; L.z = cam.position.z;
        L.rx = e[0]; L.ry = e[1]; L.rz = e[2];
      }
      const t = ac.currentTime;
      for (let i = 0; i < MAX_LOOPS; i++) {
        const Ls = loops[i];
        if (Ls.nodes.length === 0) continue;
        if (Ls.id === 0) {
          if (Ls.endAt > 0 && t >= Ls.endAt) engine.releaseLoop(Ls);
          continue;
        }
        if (Ls.positional) {
          engine.updateLoopPos(Ls);
          Ls.out.gain.setTargetAtTime(LOOP_GAIN[Ls.kind] * Ls.vol * Ls.dist * Ls.lg, Math.max(t, Ls.t0 + 0.26), 0.08);
        }
      }
    },

    /** @param {import('./loops.js').LiveLoop} Ls */
    releaseLoop(Ls) {
      for (let i = 0; i < Ls.nodes.length; i++) {
        try { Ls.nodes[i].disconnect(); } catch (err) { /* ignore */ }
      }
      nodeCount -= Ls.nodes.length;
      Ls.nodes.length = 0;
      Ls.sources.length = 0;
      Ls.out = null; Ls.pan = null; Ls.a = null; Ls.b = null; Ls.c = null;
      Ls.id = 0;
      Ls.endAt = 0;
    },

    /** Stop every voice and loop at once (session end). */
    stopAll() {
      for (let i = 0; i < MAX_SLOTS; i++) if (slots[i].id !== 0) engine.stop(slots[i].id, 0.2);
      for (let i = 0; i < MAX_LOOPS; i++) if (loops[i].id !== 0) engine.stop(loops[i].id, 0.3);
    },

    /** Close the AudioContext and remove the listeners. */
    dispose() {
      listenGestures(false);
      if (pumpTimer) clearTimeout(pumpTimer);
      pumpTimer = 0;
      if (hasWindow && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      for (let i = 0; i < MAX_SLOTS; i++) releaseVoice(slots[i]);
      if (ac) {
        if (typeof ac.removeEventListener === 'function') ac.removeEventListener('statechange', onStateChange);
        try { ac.close().catch(() => {}); } catch (err) { /* ignore */ }
      }
      ac = null;
      nodeCount = 0;
      engine.ready = false;
    },

    /** Debug view of the voice pool. */
    debugSlots() {
      return slots;
    },
  };

  listenGestures(true);
  return engine;
}
