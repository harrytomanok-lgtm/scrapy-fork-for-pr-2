/**
 * The live loops (ARCHITECTURE 4.2 binding decision 2): `wind_loop`, `gather_loop`, `beam_loop`, `siphon_loop`,
 * plus the internal `ambience` air bed. Each is a small node graph built on start and torn down after its
 * fade-out; `setLevel` drives the recipe-specific sweep (speed, hold time, charge).
 * @module audio/loops
 */

import { BEDS } from './logic/ambience.js';

/** Live loop ids handled here (`ambience` is internal and not in IDS.sfx). */
export const LIVE_IDS = Object.freeze(['wind_loop', 'gather_loop', 'beam_loop', 'siphon_loop', 'ambience']);

/** Node cost of each live loop including its stereo panner (for the node budget). */
export const LOOP_COST = Object.freeze({ wind_loop: 8, gather_loop: 9, beam_loop: 10, siphon_loop: 7, ambience: 10 });

/**
 * @typedef {object} LiveLoop
 * @property {number} id
 * @property {string} kind
 * @property {any[]} nodes      every node of the graph (for teardown and counting)
 * @property {any[]} sources    nodes that need start / stop
 * @property {any} out          output gain (envelope, volume and distance)
 * @property {any} pan          StereoPanner or null
 * @property {any} a @property {any} b @property {any} c   recipe-specific params
 * @property {number} level @property {number} vol @property {number} dist
 * @property {number} entId @property {number} x @property {number} y @property {number} z @property {boolean} positional
 * @property {number} endAt     context time the graph may be released (0 while playing)
 */

/** @returns {LiveLoop} */
export function createLoopSlot() {
  return {
    id: 0, kind: '', nodes: [], sources: [], out: null, pan: null, a: null, b: null, c: null,
    level: 0, vol: 1, dist: 1, entId: 0, x: 0, y: 0, z: 0, positional: false, endAt: 0, t0: 0, lg: 1, d: null, e: null, f: null, bed: '',
  };
}

/**
 * @param {any} ac @param {LiveLoop} L @param {any} node @returns {any}
 */
function add(ac, L, node) {
  L.nodes.push(node);
  return node;
}

/** @param {any} ac @param {LiveLoop} L @param {any} buffer @param {number} rate */
function noiseSrc(ac, L, buffer, rate) {
  const s = add(ac, L, ac.createBufferSource());
  s.buffer = buffer;
  s.loop = true;
  s.playbackRate.value = rate;
  L.sources.push(s);
  return s;
}

/** @param {any} ac @param {LiveLoop} L @param {string} type @param {number} f */
function osc(ac, L, type, f) {
  const o = add(ac, L, ac.createOscillator());
  o.type = type;
  o.frequency.value = f;
  L.sources.push(o);
  return o;
}

/** @param {any} ac @param {LiveLoop} L @param {string} type @param {number} f @param {number} q */
function biquad(ac, L, type, f, q) {
  const b = add(ac, L, ac.createBiquadFilter());
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

/** @param {any} ac @param {LiveLoop} L @param {number} v */
function gain(ac, L, v) {
  const g = add(ac, L, ac.createGain());
  g.gain.value = v;
  return g;
}

/**
 * Build the graph of a live loop into `L` (its `out` starts silent; the engine fades it in).
 * @param {any} ac @param {LiveLoop} L @param {string} kind
 * @param {{ pink:any, white:any, clipCurve:Float32Array }} shared
 */
export function buildLoop(ac, L, kind, shared) {
  L.nodes.length = 0;
  L.sources.length = 0;
  L.kind = kind;
  L.level = 0;
  const out = gain(ac, L, 0);
  L.out = out;
  if (kind === 'wind_loop') {
    // pink noise -> bp (500 + speed x 20 Hz, Q 0.7) and an octave-up band; 0.3 Hz LFO on the gain
    const src = noiseSrc(ac, L, shared.pink, 1);
    const bp1 = biquad(ac, L, 'bandpass', 500, 0.7);
    const bp2 = biquad(ac, L, 'bandpass', 1000, 0.9);
    const body = gain(ac, L, 0.7);
    src.connect(bp1); src.connect(bp2);
    bp1.connect(body); bp2.connect(out);
    body.connect(out);
    const lfo = osc(ac, L, 'sine', 0.3);
    const lfoG = gain(ac, L, 0.25);
    lfo.connect(lfoG); lfoG.connect(body.gain);
    L.a = bp1; L.b = bp2; L.c = body;
  } else if (kind === 'gather_loop') {
    // pink noise bp 300 Q 0.5 with 18 Hz tremolo and a 55 Hz saw through lp 300 -> 1400 rising with the hold.
    // Raised for phone speakers: the noise band sits at 700 Hz and the saw at 110 Hz through a band rising 700 -> 2000 Hz.
    const src = noiseSrc(ac, L, shared.pink, 1);
    const bp = biquad(ac, L, 'bandpass', 700, 0.6);
    const trem = gain(ac, L, 0.55);
    const tOsc = osc(ac, L, 'sine', 18);
    const tDepth = gain(ac, L, 0.4);
    src.connect(bp); bp.connect(trem); trem.connect(out);
    tOsc.connect(tDepth); tDepth.connect(trem.gain);
    const saw = osc(ac, L, 'sawtooth', 110);
    const lp = biquad(ac, L, 'bandpass', 700, 1.2);
    saw.connect(lp); lp.connect(out);
    L.a = lp; L.b = saw; L.c = tOsc;
  } else if (kind === 'beam_loop') {
    // saw 82 + square 164 -> soft clip -> a resonant band (1.1 kHz, 6 Hz LFO) instead of a lowpass, so the beam
    // is carried by its buzzing harmonics on a phone speaker; and noise bp 1200
    const saw = osc(ac, L, 'sawtooth', 82);
    const sq = osc(ac, L, 'square', 164);
    const ws = add(ac, L, ac.createWaveShaper());
    ws.curve = shared.clipCurve;
    const lp = biquad(ac, L, 'bandpass', 1100, 0.8);
    const lfo = osc(ac, L, 'sine', 6);
    const lfoG = gain(ac, L, 700);
    saw.connect(ws); sq.connect(ws); ws.connect(lp); lp.connect(out);
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    const src = noiseSrc(ac, L, shared.white, 1);
    const bp = biquad(ac, L, 'bandpass', 1200, 1.2);
    src.connect(bp); bp.connect(out);
    L.a = lp; L.b = saw; L.c = sq;
  } else if (kind === 'siphon_loop') {
    // low detuned saw drone 40 Hz with slow downward sweeps, heard through a resonant band that sweeps down
    // across its harmonics (a phone speaker cannot play the 40 Hz fundamental)
    const s1 = osc(ac, L, 'sawtooth', 40);
    const s2 = osc(ac, L, 'sawtooth', 40.35);
    const lp = biquad(ac, L, 'bandpass', 640, 3);
    const lfo = osc(ac, L, 'sawtooth', 0.09);
    const lfoG = gain(ac, L, -220);
    s1.connect(lp); s2.connect(lp); lp.connect(out);
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    L.a = lp; L.b = null; L.c = null;
  } else {
    // ambience: the region's bed (logic/ambience.js BEDS): a pink-noise band whose gain swells with a slow LFO
    // (gusts, waves), and a hum (saw through a resonant lowpass) for the Stormwell; applyBed sets the parameters
    const src = noiseSrc(ac, L, shared.pink, 0.5);
    const band = biquad(ac, L, 'bandpass', 1800, 0.6);
    const nGain = gain(ac, L, 0);
    const lfo = osc(ac, L, 'sine', 0.07);
    const lfoG = gain(ac, L, 0);
    src.connect(band); band.connect(nGain); nGain.connect(out);
    lfo.connect(lfoG); lfoG.connect(nGain.gain);
    const hum = osc(ac, L, 'sawtooth', 110);
    const humLP = biquad(ac, L, 'lowpass', 400, 4);
    const hGain = gain(ac, L, 0);
    hum.connect(humLP); humLP.connect(hGain); hGain.connect(out);
    L.a = band; L.b = nGain; L.c = hGain; L.d = lfoG; L.e = humLP; L.f = lfo;
    L.bed = '';
  }
  L.pan = ac.createStereoPanner ? add(ac, L, ac.createStereoPanner()) : null;
  if (L.pan) out.connect(L.pan);
}

/**
 * Recipe-specific sweep for `level` 0..1 at context time `t`; returns the level gain of the loop.
 * @param {LiveLoop} L @param {number} level @param {number} t
 * @returns {number}
 */
export function applyLevel(L, level, t) {
  const l = Math.max(0, Math.min(1, level));
  L.level = l;
  if (L.kind === 'wind_loop') {
    const speed = l * 60;
    L.a.frequency.setTargetAtTime(500 + speed * 20, t, 0.12);
    L.b.frequency.setTargetAtTime(1000 + speed * 40, t, 0.12);
    return 0.05 + 0.95 * l * l;
  }
  if (L.kind === 'gather_loop') {
    L.a.frequency.setTargetAtTime(700 + 1300 * l, t, 0.1);
    L.b.frequency.setTargetAtTime(110 * (1 + 0.06 * l), t, 0.1);
    L.c.frequency.setTargetAtTime(18 + 6 * l, t, 0.1);
    return 0.55 + 0.45 * l;
  }
  if (L.kind === 'beam_loop') {
    L.a.frequency.setTargetAtTime(900 + 900 * l, t, 0.05);
    return 0.8 + 0.2 * l;
  }
  if (L.kind === 'ambience') {
    // level: how exposed the listener is (altitude); the wind bed also brightens with it
    const B = BEDS[L.bed] || BEDS.meadow;
    if (L.bed === 'wind') L.a.frequency.setTargetAtTime(B.f * (0.8 + 0.6 * l), t, 0.5);
    return 0.45 + 0.55 * l;
  }
  return 1;
}

/**
 * Glide the ambience loop to a bed over about 3 s (region and shore changes never cut).
 * @param {LiveLoop} L @param {string} bed @param {number} t @param {number} [tc] glide time constant
 */
export function applyBed(L, bed, t, tc = 1) {
  if (L.kind !== 'ambience' || !L.a) return;
  const B = BEDS[bed];
  if (!B) return;
  L.bed = bed;
  // every bed is a band (a filter type cannot glide); the surf is simply a very wide one
  L.a.frequency.setTargetAtTime(B.f, t, tc);
  L.a.Q.setTargetAtTime(B.q, t, tc);
  const base = B.noise * (1 - B.lfoDepth * 0.5);
  L.b.gain.setTargetAtTime(base, t, tc);
  L.d.gain.setTargetAtTime(B.noise * B.lfoDepth * 0.5, t, tc);
  L.f.frequency.setTargetAtTime(B.lfoRate, t, tc);
  L.c.gain.setTargetAtTime(B.hum, t, tc);
  L.e.frequency.setTargetAtTime(B.humLP, t, tc);
}

/** Peak gain of each loop before volume and distance. */
export const LOOP_GAIN = Object.freeze({ wind_loop: 0.5, gather_loop: 0.32, beam_loop: 0.22, siphon_loop: 0.5, ambience: 0.12 });
