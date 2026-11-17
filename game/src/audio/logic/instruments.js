/**
 * Music instruments of ART_UX 9.3, pre-rendered into short sample buffers (one per octave, drums one each) and
 * played as buffer sources with `playbackRate`. Samples carry their own attack and natural decay; the scheduler
 * shortens notes with a gain release.
 * @module audio/logic/instruments
 */

import { Synth, mtof } from './dsp.js';

/**
 * @typedef {object} Instrument
 * @property {number[]} bases   midi notes of the rendered samples (one per octave)
 * @property {number} len       sample length (s)
 * @property {number} sr        sample rate
 * @property {number} gain      mix gain of the part (linear)
 * @property {number} release   release time when a note is shortened (s)
 * @property {(s:Synth, f:number)=>void} render
 */

/** @type {Record<string, Instrument>} */
export const INSTRUMENTS = {
  // kite-flute: sine plus triangle, delayed vibrato, breath noise
  flute: {
    bases: [69, 81], len: 2.6, sr: 32000, gain: 0.32, release: 0.25,
    render(s, f) {
      s.osc('sine', f, f, { a: 70, hold: 1600, d: 900, gain: 0.8, vib: 5.2, vibDepth: 0.18, vibDelay: 0.35 });
      s.osc('tri', f, f, { a: 90, hold: 1500, d: 900, gain: 0.25, vib: 5.2, vibDepth: 0.18, vibDelay: 0.35 });
      s.noise('pink', { a: 40, hold: 80, d: 300, gain: 0.12, filter: { type: 'bp', f: f * 2, q: 1.5 } });
      s.noise('pink', { a: 120, hold: 1400, d: 900, gain: 0.025, filter: { type: 'bp', f: f * 3, q: 2 } });
    },
  },
  // plucked lute: noise burst into a lowpassed feedback delay (Karplus-Strong style)
  lute: {
    bases: [57, 69], len: 1.8, sr: 32000, gain: 0.3, release: 0.15,
    render(s, f) {
      const sr = s.sr;
      const period = Math.max(2, Math.round(sr / f));
      const line = new Float32Array(period);
      for (let i = 0; i < period; i++) line[i] = s.white() * (1 - i / period * 0.4);
      let idx = 0;
      let prev = 0;
      const out = s.out;
      const decay = 0.996;
      for (let i = 0; i < s.n; i++) {
        const cur = line[idx];
        const v = (cur + prev) * 0.5 * decay;
        prev = cur;
        line[idx] = v;
        idx = idx + 1 === period ? 0 : idx + 1;
        out[i] += cur * 0.8;
      }
      s.osc('sine', f, f, { a: 2, d: 600, gain: 0.15 });
    },
  },
  // pad: three detuned saws, lp 900, slow envelope
  pad: {
    bases: [50, 62], len: 7, sr: 22050, gain: 0.22, release: 1.2,
    render(s, f) {
      s.saws([f], 0.005, 1, { a: 1300, hold: 3800, d: 2200, gain: 1, filter: { type: 'lp', f: 900, q: 0.6 } });
      s.osc('sine', f / 2, f / 2, { a: 1500, hold: 3600, d: 2000, gain: 0.25 });
    },
  },
  // bell: FM sine, ratio 3.5
  bell: {
    bases: [74, 86], len: 3, sr: 32000, gain: 0.2, release: 0.6,
    render(s, f) {
      s.fm(f, 3.5, 1.6, { a: 1, d: 2600, gain: 0.8 });
      s.osc('sine', f * 2.01, f * 2.01, { a: 1, d: 900, gain: 0.12 });
    },
  },
  // bass: triangle and sub
  bass: {
    bases: [38, 50], len: 1.4, sr: 22050, gain: 0.42, release: 0.08,
    render(s, f) {
      s.osc('tri', f, f, { a: 6, hold: 250, d: 1000, gain: 0.8, filter: { type: 'lp', f: 900, q: 0.7 } });
      s.osc('sine', f / 2, f / 2, { a: 6, hold: 250, d: 1000, gain: 0.5 });
    },
  },
  // brass stab: two saws through a fast filter envelope
  brass: {
    bases: [57, 69], len: 0.7, sr: 32000, gain: 0.22, release: 0.08,
    render(s, f) {
      s.saws([f], 0.006, 1, { a: 12, hold: 120, d: 450, gain: 1, filter: { type: 'lp', f: 3200, f1: 500, q: 1.4, sweep: 0.35 } });
      s.clip(1.3);
    },
  },
  // corrupted drone (low pad without the filter opening) and its reversed swell
  drone: {
    bases: [37], len: 6, sr: 16000, gain: 0.3, release: 1.5,
    render(s, f) {
      s.saws([f, f * 1.5], 0.003, 0.985, { a: 1500, hold: 2500, d: 2000, gain: 1, filter: { type: 'lp', f: 420, q: 1.5 } });
    },
  },
  swell: {
    bases: [61], len: 2.5, sr: 22050, gain: 0.16, release: 0.1,
    render(s, f) {
      s.saws([f, f * 1.189, f * 1.498], 0.006, 1, { a: 2, d: 2200, gain: 1, filter: { type: 'lp', f: 2200, f1: 500, q: 0.8 } });
      s.reverse();
    },
  },
  // frame drum: sine 110->50 and noise; rim and shaker
  drum: {
    bases: [45], len: 0.6, sr: 22050, gain: 0.6, release: 0.05,
    render(s) {
      s.osc('sine', 110, 50, { a: 1, d: 380, gain: 1.2, sweep: 0.12 });
      s.noise('brown', { a: 1, d: 140, gain: 0.5, filter: { type: 'lp', f: 900 } });
      s.clip(1.4);
    },
  },
  rim: {
    bases: [76], len: 0.18, sr: 32000, gain: 0.25, release: 0.03,
    render(s) {
      s.noise('white', { a: 0, d: 40, gain: 0.9, filter: { type: 'bp', f: 1900, q: 3 } });
      s.osc('tri', 820, 760, { a: 0, d: 50, gain: 0.5 });
    },
  },
  shaker: {
    bases: [82], len: 0.12, sr: 32000, gain: 0.12, release: 0.02,
    render(s) {
      s.noise('white', { a: 8, d: 60, gain: 1, filter: { type: 'hp', f: 6000 } });
    },
  },
};

/** Instrument ids in render order. */
export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS);

/**
 * Render one sample of an instrument.
 * @param {string} id @param {number} baseIndex @returns {Float32Array}
 */
export function renderInstrument(id, baseIndex) {
  const ins = INSTRUMENTS[id];
  const midi = ins.bases[baseIndex];
  const s = new Synth(ins.len, ins.sr, 0x51ad0000 + midi * 131 + id.length * 7);
  ins.render(s, mtof(midi));
  return s.finish(0.85);
}

/**
 * Pick the sample of `inst` nearest to `midi` and the playback rate that plays `midi` from it.
 * @param {string} inst @param {number} midi @param {{ index:number, rate:number }} out
 * @returns {{ index:number, rate:number }}
 */
export function sampleFor(inst, midi, out) {
  const b = INSTRUMENTS[inst].bases;
  let best = 0;
  for (let i = 1; i < b.length; i++) if (Math.abs(b[i] - midi) < Math.abs(b[best] - midi)) best = i;
  out.index = best;
  out.rate = Math.pow(2, (midi - b[best]) / 12);
  return out;
}
