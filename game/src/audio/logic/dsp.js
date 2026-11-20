/**
 * Pure offline DSP used to pre-render every one-shot and every instrument sample (ART_UX 9.1, 9.3).
 * A `Synth` owns one mono Float32Array and adds layers into it: band-limited oscillators with exponential pitch
 * sweeps, coloured noise, FM bells, a sweeping RBJ biquad per layer, attack/decay envelopes, soft clipping,
 * echoes and reversal. Everything is deterministic for a seed (no Math.random) and runs in Node for the tests.
 * @module audio/logic/dsp
 */

import { createStream } from '../../core/rng.js';

const TAU = Math.PI * 2;

/**
 * @typedef {object} FilterSpec
 * @property {'lp'|'hp'|'bp'} type
 * @property {number} f       start cutoff / centre (Hz)
 * @property {number} [f1]    end cutoff (exponential sweep over `sweep` seconds or the layer)
 * @property {number} [q]     Q (default 0.707)
 * @property {number} [sweep] sweep duration in seconds
 */

/**
 * @typedef {object} LayerSpec
 * @property {number} [at]     start time (s)
 * @property {number} [a]      attack (ms)
 * @property {number} [d]      decay (ms): time to about -40 dB after the attack
 * @property {number} [hold]   sustain at full level for this many ms before the decay
 * @property {number} [len]    layer length (s); default attack + hold + 1.25 x decay
 * @property {number} [gain]
 * @property {FilterSpec} [filter]
 * @property {number} [trem]   tremolo rate (Hz) @property {number} [tremDepth] 0..1
 * @property {number} [vib]    vibrato rate (Hz) @property {number} [vibDepth] semitones @property {number} [vibDelay] s
 * @property {number} [sweep]  pitch sweep duration (s), default the layer length
 * @property {'exp'|'lin'} [curve] envelope decay curve (default exp)
 */

/** RBJ biquad state that can re-tune itself while it runs. */
class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }

  /** @param {'lp'|'hp'|'bp'} type @param {number} f @param {number} q @param {number} sr */
  set(type, f, q, sr) {
    const fc = Math.min(sr * 0.45, Math.max(10, f));
    const w = TAU * fc / sr;
    const cw = Math.cos(w);
    const al = Math.sin(w) / (2 * Math.max(0.05, q));
    const a0 = 1 + al;
    let b0; let b1; let b2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * cw) / a0; this.a2 = (1 - al) / a0;
  }

  /** @param {number} x @returns {number} */
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** PolyBLEP residual for band-limited saw and square. @param {number} t phase 0..1 @param {number} dt */
function blep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

/** Soft-clip curve used by the recipes and the live loops. @param {number} x @param {number} drive */
export function softClip(x, drive) {
  const y = Math.tanh(x * drive);
  return drive > 1 ? y / Math.tanh(drive) : y;
}

/** Mono synthesis buffer with layer helpers. */
export class Synth {
  /** @param {number} seconds @param {number} sr @param {number} seed */
  constructor(seconds, sr, seed) {
    this.sr = sr;
    this.n = Math.max(1, Math.ceil(seconds * sr));
    this.out = new Float32Array(this.n);
    this.rng = createStream(seed >>> 0);
    this.filter = new Biquad();
    this.pinkB = new Float32Array(7);
    this.brown = 0;
  }

  /** @returns {number} white noise -1..1 */
  white() {
    return this.rng.next() * 2 - 1;
  }

  /** @param {'white'|'pink'|'brown'} colour @returns {number} */
  noiseSample(colour) {
    const w = this.white();
    if (colour === 'white') return w;
    if (colour === 'brown') {
      this.brown = (this.brown + 0.02 * w) * 0.995;
      return this.brown * 3.5;
    }
    const b = this.pinkB;
    b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759; b[2] = 0.969 * b[2] + w * 0.153852;
    b[3] = 0.8665 * b[3] + w * 0.3104856; b[4] = 0.55 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.016898;
    const p = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
    b[6] = w * 0.115926;
    return p * 0.11;
  }

  /**
   * Envelope value at `t` seconds into a layer.
   * @param {number} t @param {number} a s @param {number} hold s @param {number} d s @param {boolean} lin
   */
  static env(t, a, hold, d, lin) {
    if (t < a) return a > 0 ? t / a : 1;
    const td = t - a - hold;
    if (td <= 0) return 1;
    if (lin) return Math.max(0, 1 - td / d);
    return Math.exp(-4.6 * td / d);
  }

  /**
   * Generic layer loop: `gen(i, t)` returns the raw sample; the envelope, tremolo and filter are applied here.
   * @param {LayerSpec} o @param {(t:number, k:number)=>number} gen
   */
  layer(o, gen) {
    const sr = this.sr;
    const a = (o.a !== undefined ? o.a : 2) / 1000;
    const d = (o.d !== undefined ? o.d : 100) / 1000;
    const hold = (o.hold || 0) / 1000;
    const len = o.len !== undefined ? o.len : a + hold + d * 1.25;
    const i0 = Math.floor((o.at || 0) * sr);
    const n = Math.min(this.n - i0, Math.ceil(len * sr));
    if (n <= 0) return;
    const gain = o.gain !== undefined ? o.gain : 1;
    const f = o.filter || null;
    const fl = this.filter;
    fl.x1 = fl.x2 = fl.y1 = fl.y2 = 0;
    const fSweep = f ? (f.sweep !== undefined ? f.sweep : len) : 1;
    const lin = o.curve === 'lin';
    const tail = Math.min(n, Math.floor(sr * 0.006));
    const out = this.out;
    // at least 0.4 ms of attack: a layer that starts at full level is a click, not a transient
    const aN = Math.max(Math.ceil(sr * 0.0004), Math.floor(a * sr));
    const hN = aN + Math.floor(hold * sr);
    const df = lin ? 1 / Math.max(1, d * sr) : Math.exp(-4.6 / Math.max(1, d * sr));
    const fq = f && f.q !== undefined ? f.q : 0.707;
    const sweeping = !!(f && f.f1 !== undefined);
    if (f && !sweeping) fl.set(f.type, f.f, fq, sr);
    const trem = o.trem || 0;
    const tremDepth = o.tremDepth !== undefined ? o.tremDepth : 0.5;
    let e = 0;
    for (let k = 0; k < n; k++) {
      const t = k / sr;
      if (sweeping && (k & 15) === 0) fl.set(f.type, f.f * Math.pow(f.f1 / f.f, Math.min(1, t / fSweep)), fq, sr);
      let s = gen(t, k);
      if (f) s = fl.run(s);
      if (k < aN) e = k / aN;
      else if (k < hN) e = 1;
      else if (k === hN) e = 1;
      else if (lin) e = Math.max(0, e - df);
      else e *= df;
      let g = e;
      if (trem) g *= 1 - tremDepth * (0.5 + 0.5 * Math.sin(TAU * trem * t));
      if (k >= n - tail) g *= (n - k) / tail;
      out[i0 + k] += s * g * gain;
    }
  }

  /**
   * Oscillator layer with an exponential pitch sweep.
   * @param {'sine'|'tri'|'saw'|'square'} type @param {number} f0 @param {number} f1 @param {LayerSpec} o
   */
  osc(type, f0, f1, o) {
    const sr = this.sr;
    let ph = this.rng.next();
    const a = (o.a !== undefined ? o.a : 2) / 1000;
    const d = (o.d !== undefined ? o.d : 100) / 1000;
    const len = o.len !== undefined ? o.len : a + (o.hold || 0) / 1000 + d * 1.25;
    const sw = o.sweep !== undefined ? o.sweep : len;
    const ratio = f1 / f0;
    const vib = o.vib || 0;
    const vibDepth = o.vibDepth || 0;
    const vibDelay = o.vibDelay || 0;
    const moving = ratio !== 1 || vib !== 0;
    let f = f0;
    this.layer(o, (t, k) => {
      if (moving && (k & 7) === 0) {
        f = ratio !== 1 ? f0 * Math.pow(ratio, Math.min(1, t / sw)) : f0;
        if (vib && t > vibDelay) f *= Math.pow(2, vibDepth * Math.min(1, (t - vibDelay) * 3) * Math.sin(TAU * vib * t) / 12);
      }
      const dt = f / sr;
      ph += dt;
      if (ph >= 1) ph -= 1;
      if (type === 'sine') return Math.sin(TAU * ph);
      if (type === 'tri') return 4 * Math.abs(ph - 0.5) - 1;
      if (type === 'saw') return 2 * ph - 1 - blep(ph, dt);
      let sq = ph < 0.5 ? 1 : -1;
      sq += blep(ph, dt);
      const p2 = ph + 0.5 >= 1 ? ph - 0.5 : ph + 0.5;
      return sq - blep(p2, dt);
    });
  }

  /**
   * Detuned saw ensemble (pads, brass, drones) in one layer sharing one filter: every frequency of `freqs` gets
   * three saws spread by `spread` (ratio), all gliding by `drop` (end / start ratio) over the layer.
   * @param {number[]} freqs @param {number} spread @param {number} drop @param {LayerSpec} o
   */
  saws(freqs, spread, drop, o) {
    const sr = this.sr;
    const nv = freqs.length * 3;
    const ph = new Float64Array(nv);
    const base = new Float64Array(nv);
    for (let i = 0; i < nv; i++) {
      ph[i] = this.rng.next();
      base[i] = freqs[(i / 3) | 0] * (1 + ((i % 3) - 1) * spread);
    }
    const a = (o.a !== undefined ? o.a : 2) / 1000;
    const d = (o.d !== undefined ? o.d : 100) / 1000;
    const len = o.len !== undefined ? o.len : a + (o.hold || 0) / 1000 + d * 1.25;
    let m = 1;
    const norm = 1 / Math.sqrt(nv);
    this.layer(o, (t, k) => {
      if (drop !== 1 && (k & 15) === 0) m = Math.pow(drop, Math.min(1, t / len));
      let s = 0;
      for (let i = 0; i < nv; i++) {
        const dt = base[i] * m / sr;
        let p = ph[i] + dt;
        if (p >= 1) p -= 1;
        ph[i] = p;
        s += 2 * p - 1 - blep(p, dt);
      }
      return s * norm;
    });
  }

  /** @param {'white'|'pink'|'brown'} colour @param {LayerSpec} o */
  noise(colour, o) {
    this.layer(o, () => this.noiseSample(colour));
  }

  /**
   * FM bell: sine carrier with a sine modulator at `ratio`, index decaying faster than the amplitude.
   * @param {number} f @param {number} ratio @param {number} index @param {LayerSpec} o
   */
  fm(f, ratio, index, o) {
    const sr = this.sr;
    let pc = 0;
    let pm = 0;
    const d = (o.d !== undefined ? o.d : 600) / 1000;
    let idx = index;
    this.layer(o, (t, k) => {
      pc += f / sr; pm += f * ratio / sr;
      if (pc >= 1) pc -= 1;
      if (pm >= 1) pm -= 1;
      if ((k & 15) === 0) idx = index * Math.exp(-3 * t / d);
      return Math.sin(TAU * pc + idx * Math.sin(TAU * pm));
    });
  }

  /** Short clicks (pebbles, crackle) at random times. @param {number} count @param {number} from s @param {number} to s @param {number} gain @param {number} [freq] */
  clicks(count, from, to, gain, freq = 3000) {
    for (let c = 0; c < count; c++) {
      const at = from + this.rng.next() * (to - from);
      const g = gain * (0.5 + 0.5 * this.rng.next());
      this.noise('white', { at, a: 0.2, d: 12 + this.rng.next() * 18, gain: g, filter: { type: 'bp', f: freq * (0.7 + 0.6 * this.rng.next()), q: 2 } });
    }
  }

  /** Soft-clip the whole buffer. @param {number} drive */
  clip(drive) {
    const o = this.out;
    for (let i = 0; i < this.n; i++) o[i] = softClip(o[i], drive);
  }

  /** Feedback echo baked into the buffer. @param {number} time s @param {number} fb 0..0.9 @param {number} [damp] lowpass factor 0..1 */
  echo(time, fb, damp = 0.4) {
    const o = this.out;
    const dl = Math.max(1, Math.floor(time * this.sr));
    let lp = 0;
    for (let i = dl; i < this.n; i++) {
      lp += (o[i - dl] - lp) * (1 - damp);
      o[i] += lp * fb;
    }
  }

  /** Reverse the buffer (reverse swells). */
  reverse() {
    this.out.reverse();
  }

  /** Raised-cosine fade over the last `seconds`. @param {number} seconds */
  fadeOut(seconds) {
    const o = this.out;
    const m = Math.min(this.n, Math.max(1, Math.floor(seconds * this.sr)));
    for (let i = 0; i < m; i++) o[this.n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / m);
  }

  /**
   * Remove DC (a 12 Hz one-pole high-pass; brown noise and asymmetric clipping leave an offset), normalise to a
   * peak and fade the last 5 ms. @param {number} peak @returns {Float32Array}
   */
  finish(peak) {
    const o = this.out;
    const R = 1 - TAU * 12 / this.sr;
    let x1 = 0;
    let y1 = 0;
    for (let i = 0; i < this.n; i++) {
      const y = o[i] - x1 + R * y1;
      x1 = o[i];
      y1 = y;
      o[i] = y;
    }
    let m = 0;
    for (let i = 0; i < this.n; i++) {
      const v = Math.abs(o[i]);
      if (v > m) m = v;
    }
    const k = m > 1e-6 ? peak / m : 0;
    const fade = Math.min(this.n, Math.floor(this.sr * 0.005));
    for (let i = 0; i < this.n; i++) o[i] *= k;
    for (let i = 0; i < fade; i++) o[this.n - 1 - i] *= i / fade;
    return o;
  }
}

/** @param {number} midi @returns {number} Hz */
export function mtof(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Looping noise buffer shared by the live loops (white or pink), with its loop point crossfaded.
 * @param {number} seconds @param {number} sr @param {'white'|'pink'} colour @returns {Float32Array}
 */
export function loopNoise(seconds, sr, colour) {
  const n = Math.floor(seconds * sr);
  // generate `xf` extra samples: the loop start is crossfaded with the continuation past the end, so the
  // wrap from the last sample to the first continues the same noise
  const xf = 1024;
  const d = new Float32Array(n + xf);
  let s = 0x2545f491;
  const p = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n + xf; i++) {
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
  // equal-power crossfade of the loop start with the continuation (uncorrelated noise)
  for (let i = 0; i < xf; i++) {
    const t = (i + 0.5) / xf;
    d[i] = d[i] * Math.sin(t * Math.PI / 2) + d[n + i] * Math.cos(t * Math.PI / 2);
  }
  return d.subarray(0, n);
}
