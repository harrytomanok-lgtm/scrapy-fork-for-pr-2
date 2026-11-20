/**
 * Every SFX recipe of ART_UX 9.2, keyed by the `audio.play` ids of `IDS.sfx`. One-shots are rendered offline into
 * Float32Arrays (2 variants on low, 3 on high); each variant changes pitch and timbre a little. Ids ending in
 * `_loop` are synthesised live by the engine (`live: true`). Mix levels follow ART_UX 9.1 (impacts 0 dB,
 * techniques -3, foley -10, UI -12); `cap` names the per-recipe voice group (bolt 6, hits 8, steps 2,
 * explosions 4, UI 3).
 * @module audio/logic/recipes
 */

import { Synth, mtof } from './dsp.js';

/** Sample rate of every pre-rendered one-shot (Hz). Played back at any context rate. */
export const SFX_RATE = 32000;

/**
 * @typedef {object} Recipe
 * @property {number} len         seconds rendered
 * @property {number} mix         dB
 * @property {string|null} cap    voice group
 * @property {number} [peak]      normalisation peak (default 0.9)
 * @property {boolean} [live]     live loop: not rendered
 * @property {boolean} [internal] played by the audio package itself (ambience, sand steps); not an IDS.sfx id
 * @property {boolean} [duck]     big impact: ducks the music
 * @property {number} [duckDb]     duck depth when it is not the default -6 dB (dialogue blips: a gentle -5 dB)
 * @property {(s:Synth, v:number, k:number)=>void} [render]   k = variant factor (1, 0.96, 1.045)
 */

/** Variant factors: pitch / timbre spread of variants 0, 1, 2. */
export const VARIANT_K = [1, 0.955, 1.045];

const D5 = mtof(74);
const FS5 = mtof(78);
const A5 = mtof(81);
const D6 = mtof(86);

/** @param {Synth} s @param {number} k @param {number} gain */
function heavyHit(s, k, gain) {
  s.noise('pink', { a: 1, d: 120, gain: 6 * gain, filter: { type: 'bp', f: 900 * k, q: 0.8 } });
  s.noise('pink', { a: 0.5, d: 45, gain: 3 * gain, filter: { type: 'bp', f: 1800 * k, q: 1 } });
  s.osc('sine', 120 * k, 45 * k, { a: 1, d: 220, gain: 0.45 * gain, sweep: 0.16 });
  s.osc('square', 2000, 2000, { a: 0.3, d: 5, len: 0.006, gain: 0.35 * gain });
  s.noise('white', { a: 0.3, d: 18, gain: 0.4 * gain, filter: { type: 'bp', f: 3000, q: 0.9 } });
}

/** @param {Synth} s @param {number} k @param {number} lp @param {number} dec @param {number} sub @param {number} gain */
function explosion(s, k, lp, dec, sub, gain) {
  s.noise('brown', { a: 2, d: dec, gain: 0.8 * gain, filter: { type: 'lp', f: lp * 2 * k, f1: lp * 0.6 * k, q: 0.8 } });
  s.noise('white', { a: 1, d: dec * 0.25, gain: 0.35 * gain, filter: { type: 'lp', f: lp * 2.5, q: 0.7 } });
  // the body a phone speaker can play: a debris roar in the midrange that closes with the blast
  s.noise('pink', { a: 2, d: dec * 0.55, gain: 7 * gain, filter: { type: 'bp', f: 1400 * k, f1: 600 * k, q: 0.7 } });
  s.osc('sine', sub * 1.6 * k, sub * k, { a: 2, d: dec * 0.8, gain: 0.5 * gain, sweep: 0.12 });
}

/** @param {Synth} s @param {number} f @param {number} at @param {number} dur s @param {number} gain */
function horn(s, f, at, dur, gain) {
  s.osc('square', f, f, { at, a: 25, hold: dur * 700, d: 160, gain: 0.7 * gain, filter: { type: 'bp', f: 800, q: 3 }, vib: 5, vibDepth: 0.12, vibDelay: 0.12 });
  s.osc('saw', f * 1.003, f * 1.003, { at, a: 30, hold: dur * 700, d: 160, gain: 0.25 * gain, filter: { type: 'lp', f: 1600, q: 0.8 } });
}

/** @param {Synth} s @param {number[]} freqs @param {number} at @param {number} d @param {number} gain */
function bells(s, freqs, at, d, gain) {
  for (let i = 0; i < freqs.length; i++) s.fm(freqs[i], 3.5, 1.4, { at, a: 1, d, gain: gain / freqs.length });
}

/** @param {Synth} s @param {number[]} freqs @param {LayerLike} o */
function pad(s, freqs, o) {
  s.saws(freqs, 0.004, o.drop || 1, { at: o.at, a: o.a, hold: o.hold, d: o.d, gain: o.gain * 0.6, filter: { type: 'lp', f: o.lp || 900, q: 0.7 } });
}
/** @typedef {{ at?:number, a:number, hold?:number, d:number, gain:number, lp?:number, drop?:number }} LayerLike */

/** @param {Synth} s @param {number} k @param {number} gain */
function block(s, k, gain) {
  s.noise('white', { a: 1, d: 120, gain: 1.2 * gain, filter: { type: 'bp', f: 2500 * k, q: 6 } });
  s.osc('tri', 1800 * k, 1700 * k, { a: 1, d: 140, gain: 0.25 * gain });
  s.osc('sine', 180, 120, { a: 1, d: 60, gain: 0.5 * gain });
}

/** @param {Synth} s @param {number} k */
function swish(s, k, f0, f1) {
  s.noise('pink', { a: 50, d: 90, gain: 1, filter: { type: 'bp', f: f0 * k, f1: f1 * k, q: 1.2, sweep: 0.14 } });
}

/** @type {Record<string, Recipe>} */
export const RECIPES = {
  // foley
  step_grass: { len: 0.12, mix: -10, cap: 'step', render(s, v, k) { s.noise('pink', { a: 2, d: 45, gain: 1.3, filter: { type: 'bp', f: 1300 * k, q: 0.9 } }); s.noise('brown', { a: 2, d: 50, gain: 0.25, filter: { type: 'lp', f: 600 * k, q: 0.7 } }); s.noise('white', { a: 1, d: 20, gain: 0.1, filter: { type: 'bp', f: 3500 * k, q: 1 } }); } },
  step_stone: { len: 0.1, mix: -7, cap: 'step', render(s, v, k) { s.noise('brown', { a: 1, d: 50, gain: 1.4, filter: { type: 'bp', f: 1800 * k, q: 2 } }); s.osc('sine', 260 * k, 180 * k, { a: 1, d: 25, gain: 0.25 }); } },
  step_snow: { len: 0.18, mix: -10, cap: 'step', render(s, v, k) { s.noise('pink', { a: 10, d: 110, gain: 1, filter: { type: 'bp', f: 2000 * k, q: 0.8 }, trem: 55, tremDepth: 0.6 }); s.noise('brown', { a: 6, d: 70, gain: 0.45, filter: { type: 'lp', f: 600, q: 0.7 } }); } },
  step_water: { len: 0.16, mix: -10, cap: 'step', render(s, v, k) { s.noise('pink', { a: 2, d: 90, filter: { type: 'bp', f: 1200 * k, q: 1.2 } }); s.osc('sine', 500 * k, 1100 * k, { at: 0.015, a: 2, d: 45, gain: 0.25 }); } },
  jump: { len: 0.14, mix: -10, cap: null, render(s, v, k) { s.osc('tri', 440 * k, 700 * k, { a: 3, d: 70, gain: 0.45 }); s.noise('pink', { a: 2, d: 45, gain: 1.2, filter: { type: 'bp', f: 1600, q: 1 } }); } },
  land: { len: 0.32, mix: -8, cap: null, render(s, v, k) { s.osc('sine', 90 * k, 40 * k, { a: 2, d: 180, gain: 0.35, sweep: 0.12 }); s.noise('brown', { a: 2, d: 220, gain: 0.4, filter: { type: 'lp', f: 400 * k, q: 0.7 } }); s.noise('pink', { a: 1, d: 90, gain: 7, filter: { type: 'bp', f: 850 * k, q: 0.9 } }); } },
  land_heavy: { len: 0.5, mix: 0, cap: null, duck: true, render(s, v, k) { s.osc('sine', 90 * k, 40 * k, { a: 2, d: 180, gain: 0.35, sweep: 0.12 }); s.noise('brown', { a: 2, d: 300, gain: 0.5, filter: { type: 'lp', f: 400 * k, q: 0.7 } }); s.osc('sine', 55 * k, 50 * k, { a: 2, d: 320, gain: 0.45 }); s.noise('pink', { a: 1, d: 160, gain: 8, filter: { type: 'bp', f: 750 * k, q: 0.8 } }); s.noise('pink', { a: 0.5, d: 40, gain: 3, filter: { type: 'bp', f: 1900 * k, q: 1 } }); s.clip(1.6); } },
  takeoff: { len: 0.55, mix: -12, cap: null, render(s, v, k) { s.noise('pink', { a: 120, d: 380, filter: { type: 'bp', f: 600 * k, f1: 2400 * k, q: 1, sweep: 0.4 } }); s.osc('sine', 180 * k, 360 * k, { a: 20, d: 300, gain: 0.15, sweep: 0.35 }); } },
  wind_loop: { len: 0, mix: -8, cap: null, live: true },
  // movement techniques
  flicker_out: { len: 0.22, mix: -3, cap: null, render(s, v, k) { s.osc('saw', 1200 * k, 2400 * k, { a: 1, d: 40, len: 0.045, gain: 0.5 }); s.osc('saw', 1200 * k, 2400 * k, { at: 0.07, a: 1, d: 40, len: 0.045, gain: 0.45 }); s.noise('white', { a: 5, d: 160, gain: 0.2, filter: { type: 'hp', f: 6000 }, trem: 40, tremDepth: 0.7 }); } },
  flicker_in: { len: 0.2, mix: -3, cap: null, render(s, v, k) { s.osc('sine', 1600 * k, 800 * k, { a: 1, d: 50, gain: 0.8 }); s.noise('white', { a: 2, d: 140, gain: 0.3, filter: { type: 'hp', f: 6000 }, trem: 35, tremDepth: 0.7 }); } },
  boost_start: { len: 0.4, mix: -3, cap: null, render(s, v, k) { s.noise('pink', { a: 8, d: 260, gain: 1.2, filter: { type: 'bp', f: 3000 * k, f1: 800 * k, q: 1.4, sweep: 0.18 } }); s.osc('sine', 400 * k, 160 * k, { a: 3, d: 220, gain: 0.15, sweep: 0.18 }); } },
  sonic_boom: { len: 1.0, mix: 0, cap: 'explosion', duck: true, render(s, v, k) { s.osc('sine', 60 * k, 52 * k, { a: 1, d: 400, gain: 0.6 }); s.noise('pink', { a: 1, d: 300, gain: 1.1, filter: { type: 'lp', f: 2500 * k, q: 0.7 } }); s.noise('pink', { a: 1, d: 160, gain: 8, filter: { type: 'bp', f: 1300 * k, q: 0.7 } }); s.noise('white', { a: 0.5, d: 25, gain: 0.4, filter: { type: 'bp', f: 2800, q: 1 } }); s.clip(2.2); s.echo(0.17, 0.35, 0.6); } },
  whoosh: { len: 0.18, mix: -6, cap: null, render(s, v, k) { s.noise('pink', { a: 30, d: 90, gain: 1, filter: { type: 'bp', f: 800 * k, f1: 2000 * k, q: 1.3, sweep: 0.09 } }); } },
  // hits
  hit_light: { len: 0.16, mix: 3, cap: 'hit', render(s, v, k) { s.noise('white', { a: 1, d: 50, gain: 1.6, filter: { type: 'bp', f: 1500 * k, q: 1 } }); s.osc('sine', 180 * k, 90 * k, { a: 1, d: 70, gain: 0.35, sweep: 0.06 }); s.noise('white', { a: 0.3, d: 10, gain: 0.45, filter: { type: 'bp', f: 2600, q: 1 } }); s.clip(1.4); } },
  hit_heavy: { len: 0.32, mix: 0, cap: 'hit', render(s, v, k) { heavyHit(s, k, 1); s.clip(1.8); } },
  hit_finisher: { len: 0.75, mix: 0, cap: 'hit', duck: true, render(s, v, k) { heavyHit(s, k, 1); s.osc('sine', 62 * k, 50 * k, { a: 2, d: 400, gain: 0.45 }); s.noise('pink', { at: 0.01, a: 2, d: 260, gain: 6, filter: { type: 'bp', f: 1100 * k, f1: 500 * k, q: 0.8 } }); s.clip(2); s.echo(0.11, 0.3, 0.5); } },
  gather_loop: { len: 0, mix: -6, cap: null, live: true },
  gather_full: { len: 0.8, mix: -4, cap: null, render(s, v, k) { s.osc('sine', 880 * k, 880 * k, { a: 5, d: 600, gain: 0.6 }); s.osc('sine', 1320 * k, 1320 * k, { at: 0.06, a: 5, d: 600, gain: 0.45 }); s.fm(1760 * k, 3.5, 0.8, { at: 0.06, a: 2, d: 400, gain: 0.15 }); } },
  bolt_fire: { len: 0.16, mix: -3, cap: 'bolt', render(s, v, k) { const p = v === 1 ? 1.12 : 1; s.osc('square', 900 * k * p, 1400 * k * p, { a: 1, d: 60, gain: 0.45, filter: { type: 'lp', f: 5000, q: 0.7 } }); s.noise('white', { a: 0.4, d: 30, gain: 0.6, filter: { type: 'bp', f: 4000, q: 0.8 } }); s.osc('sine', 220 * k, 130 * k, { a: 1, d: 60, gain: 0.5 }); s.clip(1.5); } },
  bolt_hit: { len: 0.2, mix: -1, cap: 'bolt', render(s, v, k) { s.noise('white', { a: 1, d: 90, gain: 1.4, filter: { type: 'bp', f: 2000 * k, q: 1.5 } }); s.osc('sine', 300 * k, 100 * k, { a: 1, d: 90, gain: 0.5, sweep: 0.08 }); s.clip(1.3); } },
  beam_charge: { len: 2.4, mix: -8, cap: null, render(s, v, k) {
    const lpF = { type: /** @type {'lp'} */ ('lp'), f: 200, f1: 3000, q: 1.2, sweep: 2.1 };
    s.saws([110.35 * k, 220.4 * k], 0.0032, 1, { a: 300, hold: 1800, d: 250, gain: 0.9, filter: lpF });
    s.osc('sine', 200 * k, 800 * k, { a: 600, hold: 1500, d: 250, gain: 0.25, sweep: 2.1 });
    s.clicks(10, 0.4, 1.2, 0.25, 4000); s.clicks(22, 1.2, 2.2, 0.35, 5000);
  } },
  beam_loop: { len: 0, mix: -3, cap: null, live: true },
  beam_end: { len: 0.4, mix: -3, cap: null, render(s, v, k) { s.osc('saw', 82 * k, 70 * k, { a: 1, d: 260, gain: 0.45, filter: { type: 'lp', f: 2200, f1: 150, q: 1.5, sweep: 0.18 } }); s.osc('square', 164 * k, 140 * k, { a: 1, d: 260, gain: 0.4, filter: { type: 'lp', f: 2200, f1: 150, q: 1.5, sweep: 0.18 } }); s.noise('pink', { a: 1, d: 200, gain: 5, filter: { type: 'bp', f: 1400 * k, f1: 500 * k, q: 1, sweep: 0.18 } }); s.clip(1.5); } },
  nova: { len: 0.75, mix: 0, cap: 'explosion', duck: true, render(s, v, k) { s.osc('sine', 70 * k, 30 * k, { a: 2, d: 500, gain: 0.45, sweep: 0.5 }); s.noise('pink', { a: 2, d: 360, gain: 6, filter: { type: 'bp', f: 1300 * k, f1: 500 * k, q: 0.8, sweep: 0.4 } }); s.noise('pink', { a: 1, d: 500, gain: 1, filter: { type: 'lp', f: 3000 * k, f1: 400 * k, q: 0.8, sweep: 0.5 } }); s.clip(1.6); } },
  explosion_s: { len: 0.55, mix: 0, cap: 'explosion', render(s, v, k) { explosion(s, k, 1500, 300, 80, 1); s.clicks(4, 0.08, 0.4, 0.2, 2500); s.clip(1.8); } },
  explosion_m: { len: 0.95, mix: 0, cap: 'explosion', duck: true, render(s, v, k) { explosion(s, k, 1000, 600, 60, 1); s.clicks(7, 0.1, 0.8, 0.18, 2200); s.clip(2); } },
  explosion_l: { len: 1.7, mix: 0, cap: 'explosion', duck: true, render(s, v, k) { explosion(s, k, 700, 1200, 45, 1); s.clicks(12, 0.15, 1.4, 0.15, 1800); s.clip(2.2); s.echo(0.19, 0.25, 0.6); } },
  rock_break: { len: 0.45, mix: -2, cap: 'explosion', render(s, v, k) { s.noise('pink', { a: 1, d: 300, gain: 1.2, filter: { type: 'bp', f: 400 * k, q: 1 } }); s.clicks(6, 0.02, 0.35, 0.45, 2500); } },
  crater: { len: 1.0, mix: 0, cap: 'explosion', duck: true, render(s, v, k) { s.noise('pink', { a: 1, d: 300, gain: 3, filter: { type: 'bp', f: 650 * k, q: 1 } }); s.clicks(6, 0.02, 0.35, 0.45, 2500); explosion(s, k, 1000, 600, 60, 0.5); s.clip(1.5); } },
  ult_rise: { len: 2.6, mix: -7, cap: null, render(s, v, k) {
    const lpF = { type: /** @type {'lp'} */ ('lp'), f: 200, f1: 3000, q: 1.2, sweep: 2.2 };
    s.saws([110.35 * k], 0.0032, 1, { a: 400, hold: 1900, d: 250, gain: 0.5, filter: lpF });
    const ch = [mtof(62), mtof(69), mtof(74), mtof(78)];
    for (let i = 0; i < 4; i++) s.osc('sine', ch[i] * k, ch[i] * k * 1.06, { a: 800, hold: 1400, d: 300, gain: 0.22, sweep: 2.4 });
    s.clicks(24, 0.6, 2.3, 0.3, 5000);
  } },
  ult_impact: { len: 2.2, mix: 0, cap: 'explosion', duck: true, render(s, v, k) { explosion(s, k, 700, 1200, 45, 1.5); s.osc('sine', 50 * k, 25 * k, { a: 3, hold: 200, d: 1200, gain: 0.3, sweep: 1.2 }); s.clicks(16, 0.1, 1.6, 0.2, 2000); s.clip(2.4); s.echo(0.23, 0.3, 0.6); } },
  // guard
  guard_on: { len: 0.22, mix: 0, cap: null, render(s, v, k) { s.osc('sine', 500 * k, 500 * k, { a: 5, d: 100, gain: 0.5 }); s.osc('sine', 750 * k, 750 * k, { a: 5, d: 100, gain: 0.4 }); s.noise('white', { a: 5, d: 110, gain: 0.6, filter: { type: 'bp', f: 3000 * k, q: 8 } }); } },
  guard_block: { len: 0.24, mix: -1, cap: 'hit', render(s, v, k) { block(s, k, 1); s.clip(1.3); } },
  perfect: { len: 0.95, mix: -4, cap: null, render(s, v, k) { block(s, k, 0.8); bells(s, [1046 * k, 1568 * k, 2093 * k], 0.02, 700, 1.1); } },
  // Forms
  transform_rise: { len: 1.2, mix: -6, cap: null, render(s, v, k) {
    s.noise('pink', { a: 700, hold: 200, d: 250, gain: 0.6, filter: { type: 'lp', f: 200, f1: 6000, q: 1, sweep: 0.9 } });
    pad(s, [mtof(50) * k, mtof(57) * k, mtof(62) * k], { a: 600, hold: 300, d: 250, gain: 1.2, lp: 2500 });
    const beats = [0, 0.32, 0.56, 0.74, 0.86, 0.95];
    for (let i = 0; i < beats.length; i++) s.osc('sine', 75, 52, { at: beats[i], a: 2, d: 110, gain: 0.6 + i * 0.08, sweep: 0.08 });
  } },
  transform_burst: { len: 1.8, mix: 0, cap: 'explosion', duck: true, render(s, v, k) { explosion(s, k, 1000, 600, 60, 0.9); bells(s, [mtof(74) * k, mtof(78) * k, mtof(81) * k, mtof(86) * k], 0.03, 1300, 1); s.noise('pink', { at: 0.35, a: 900, d: 40, gain: 0.35, filter: { type: 'hp', f: 1200 } }); s.clip(1.4); } },
  burnout: { len: 0.8, mix: -3, cap: null, render(s, v, k) { s.osc('tri', 600 * k, 150 * k, { a: 5, d: 600, gain: 0.7, sweep: 0.6 }); s.noise('white', { a: 20, d: 600, gain: 0.25, filter: { type: 'hp', f: 5000 }, trem: 23, tremDepth: 0.8 }); } },
  // telegraphs
  tele_white: { len: 0.3, mix: -4, cap: null, render(s, v, k) { s.osc('sine', 1200 * k, 1500 * k, { a: 5, d: 200, gain: 0.7 }); s.osc('sine', 2400 * k, 3000 * k, { a: 5, d: 120, gain: 0.15 }); } },
  tele_red: { len: 0.3, mix: -3, cap: null, render(s, v, k) { for (let i = 0; i < 2; i++) s.osc('square', 300 * k, 290 * k, { at: i * 0.12, a: 2, d: 80, len: 0.1, gain: 0.6, filter: { type: 'lp', f: 2200, q: 1 } }); } },
  tele_violet: { len: 0.55, mix: -8, cap: null, render(s, v, k) { s.osc('sine', 400 * k, 400 * k, { a: 20, hold: 120, d: 380, gain: 0.7, vib: 7, vibDepth: 1 }); s.osc('sine', 600 * k, 600 * k, { a: 20, hold: 120, d: 380, gain: 0.3, vib: 7, vibDepth: 1 }); } },
  // creatures
  enemy_growl: { len: 0.6, mix: -4, cap: null, render(s, v, k) { s.osc('saw', 90 * k, 80 * k, { a: 40, d: 450, gain: 0.8, vib: 5, vibDepth: 0.7, filter: { type: 'bp', f: 700 * k, q: 4 } }); s.osc('saw', 90 * k, 80 * k, { a: 40, d: 450, gain: 0.5, vib: 5, vibDepth: 0.7, filter: { type: 'bp', f: 1150 * k, q: 5 } }); s.noise('pink', { a: 30, d: 300, gain: 0.2, filter: { type: 'lp', f: 900 } }); s.clip(1.5); } },
  enemy_death: { len: 0.9, mix: -3, cap: null, render(s, v, k) { s.osc('saw', 95 * k, 60 * k, { a: 20, d: 700, gain: 0.7, vib: 6, vibDepth: 0.8, filter: { type: 'bp', f: 1400, f1: 500, q: 1.5, sweep: 0.7 } }); s.osc('saw', 96 * k, 61 * k, { a: 20, d: 700, gain: 0.6, filter: { type: 'bp', f: 900, f1: 450, q: 3, sweep: 0.7 } }); s.noise('pink', { a: 5, d: 500, gain: 0.35, filter: { type: 'bp', f: 1200, f1: 400, q: 0.8, sweep: 0.6 } }); s.clip(1.4); } },
  boss_roar: { len: 2.0, mix: 0, cap: null, duck: true, render(s, v, k) { const f = { type: /** @type {'bp'} */ ('bp'), f: 550, f1: 1300, q: 3, sweep: 1.2 }; s.osc('saw', 60 * k, 52 * k, { a: 100, hold: 200, d: 1500, gain: 0.8, filter: f, vib: 4, vibDepth: 0.6 }); s.osc('saw', 61.3 * k, 53 * k, { a: 100, hold: 200, d: 1500, gain: 0.8, filter: f }); s.osc('square', 30 * k, 27 * k, { a: 100, hold: 200, d: 1500, gain: 0.12, filter: { type: 'lp', f: 300 } }); s.noise('pink', { a: 120, d: 1200, gain: 1.1, filter: { type: 'bp', f: 700, f1: 1300, q: 1.2, sweep: 1.2 } }); s.clip(2); } },
  // player
  player_hurt: { len: 0.25, mix: -2, cap: null, render(s, v, k) { s.noise('pink', { a: 1, d: 120, gain: 1.9, filter: { type: 'bp', f: 900 * k, q: 1.1 } }); s.osc('tri', 440 * k, 220 * k, { a: 2, d: 150, gain: 0.3 }); s.clip(1.4); } },
  player_death: { len: 2.2, mix: 0, cap: null, render(s, v, k) { pad(s, [mtof(50), mtof(57), mtof(62), mtof(65)], { a: 150, hold: 400, d: 1500, gain: 1.6, lp: 1100, drop: Math.pow(2, -6 / 12) }); s.osc('sine', 80, 40, { a: 2, d: 900, gain: 0.8, sweep: 1 }); } },
  heal: { len: 0.6, mix: -6, cap: null, render(s, v, k) { const n = [D5, FS5, A5]; for (let i = 0; i < 3; i++) s.osc('tri', n[i] * k, n[i] * k, { at: i * 0.07, a: 3, d: 300, gain: 0.5 }); } },
  // rewards
  xp_orb: { len: 0.2, mix: 0, cap: 'pickup', render(s, v, k) { s.osc('sine', D6 * k, D6 * k * 1.02, { a: 2, d: 140, gain: 0.7 }); s.osc('sine', D6 * 2 * k, D6 * 2 * k, { a: 2, d: 70, gain: 0.15 }); } },
  pickup_item: { len: 0.6, mix: -6, cap: 'pickup', render(s, v, k) { const n = [mtof(81), mtof(85), mtof(88), mtof(93)]; for (let i = 0; i < 4; i++) s.osc('tri', n[i] * k, n[i] * k, { at: i * 0.05, a: 2, d: 250, gain: 0.5 }); s.clicks(8, 0.1, 0.45, 0.12, 7000); } },
  shells: { len: 0.35, mix: -8, cap: 'pickup', render(s, v, k) { s.osc('sine', 2600 * k, 2600 * k, { a: 1, d: 200, gain: 0.5 }); s.osc('sine', 3100 * k, 3100 * k, { at: 0.07, a: 1, d: 220, gain: 0.5 }); } },
  level_up: { len: 1.8, mix: -2, cap: null, render(s, v, k) {
    const n = [D5, FS5, A5, D6];
    for (let i = 0; i < 4; i++) { s.osc('tri', n[i] * k, n[i] * k, { at: i * 0.09, a: 3, d: 350, gain: 0.45 }); s.osc('sine', n[i] * 2 * k, n[i] * 2 * k, { at: i * 0.09, a: 2, d: 200, gain: 0.12 }); }
    pad(s, [mtof(62) * k, mtof(66) * k, mtof(69) * k, mtof(74) * k], { at: 0.3, a: 60, hold: 300, d: 1100, gain: 0.9, lp: 2400 });
    bells(s, [D6 * k, A5 * 2 * k], 0.33, 1200, 0.5);
  } },
  quest_start: { len: 0.9, mix: -4, cap: null, render(s, v, k) { horn(s, mtof(69) * k, 0, 0.22, 1); horn(s, mtof(76) * k, 0.26, 0.38, 1); } },
  quest_step: { len: 0.55, mix: -5, cap: null, render(s, v, k) { horn(s, D5 * k, 0, 0.3, 1); } },
  quest_complete: { len: 2.2, mix: -3, cap: null, render(s, v, k) { horn(s, D5 * k, 0, 0.18, 1); horn(s, A5 * k, 0.22, 0.6, 1); pad(s, [mtof(62) * k, mtof(66) * k, mtof(69) * k], { at: 0.2, a: 150, hold: 500, d: 1200, gain: 1, lp: 1200 }); } },
  discover: { len: 2.4, mix: -3, cap: null, render(s, v, k) {
    bells(s, [D6 * k, mtof(90) * k, mtof(93) * k], 0, 1500, 0.9);
    const m = [mtof(81), mtof(83), mtof(86)];
    for (let i = 0; i < 3; i++) {
      s.osc('sine', m[i] * k, m[i] * k, { at: 0.35 + i * 0.22, a: 40, hold: i === 2 ? 500 : 120, d: 300, gain: 0.35, vib: 5, vibDepth: 0.15, vibDelay: 0.2 });
      s.noise('white', { at: 0.35 + i * 0.22, a: 30, d: 120, gain: 0.04, filter: { type: 'bp', f: m[i] * 2, q: 2 } });
    }
  } },
  ringstone: { len: 1.4, mix: -4, cap: null, render(s, v, k) { s.osc('sine', 660 * k, 660 * k, { a: 300, hold: 100, d: 900, gain: 0.5 }); s.osc('sine', 990 * k, 990 * k, { a: 300, hold: 100, d: 900, gain: 0.4, trem: 5, tremDepth: 0.3 }); s.osc('sine', 1320 * k, 1320 * k, { a: 400, d: 700, gain: 0.12 }); } },
  shrine: { len: 1.6, mix: -4, cap: null, render(s, v, k) { const f = [1318, 1568, 1975, 2637]; for (let i = 0; i < 4; i++) s.fm(f[i] * k, 3.5, 1.2, { at: i * 0.07 + s.rng.next() * 0.05, a: 1, d: 1200, gain: 0.3 }); } },
  chest_open: { len: 0.7, mix: -2, cap: null, render(s, v, k) { for (let i = 0; i < 2; i++) { s.noise('white', { at: i * 0.08, a: 1, d: 40, gain: 0.8, filter: { type: 'bp', f: 900 * k, q: 4 } }); s.osc('sine', 300 * k, 260 * k, { at: i * 0.08, a: 1, d: 45, gain: 0.5 }); } for (let i = 0; i < 6; i++) s.osc('sine', (2000 + 2000 * s.rng.next()) * k, 3000 * k, { at: 0.15 + i * 0.05, a: 1, d: 150, gain: 0.12 }); } },
  ring_gate: { len: 0.45, mix: 1, cap: null, render(s, v, k) { s.osc('sine', 880 * k, 1320 * k, { a: 2, d: 300, gain: 0.6, sweep: 0.06 }); s.osc('sine', 1320 * k, 1980 * k, { a: 2, d: 200, gain: 0.2, sweep: 0.06 }); } },
  race_start: { len: 1.7, mix: -4, cap: null, render(s, v, k) { for (let i = 0; i < 3; i++) s.osc('sine', 1000, 1000, { at: i * 0.35, a: 1, d: 60, gain: 0.5 }); horn(s, D5 * k, 1.05, 0.4, 1.2); } },
  race_end: { len: 1.9, mix: -3, cap: null, render(s, v, k) { const n = [D5, D5, A5, D6]; const t = [0, 0.15, 0.3, 0.55]; for (let i = 0; i < 4; i++) horn(s, n[i] * k, t[i], i === 3 ? 0.8 : 0.1, 1); } },
  // siphons
  siphon_loop: { len: 0, mix: -6, cap: null, live: true },
  siphon_core: { len: 0.7, mix: -3, cap: null, render(s, v, k) { s.noise('white', { a: 1, d: 200, gain: 0.9, filter: { type: 'bp', f: 1800 * k, q: 6 } }); s.osc('square', 140 * k, 120 * k, { a: 1, d: 150, gain: 0.5, filter: { type: 'lp', f: 900 } }); s.fm(420 * k, 1.41, 3, { a: 1, d: 500, gain: 0.5 }); s.clip(1.4); } },
  siphon_break: { len: 1.8, mix: 0, cap: 'explosion', duck: true, render(s, v, k) { for (let i = 0; i < 6; i++) s.noise('white', { at: i * 0.05 + s.rng.next() * 0.03, a: 1, d: 80, gain: 0.8, filter: { type: 'hp', f: 4000 * k } }); s.clicks(14, 0, 0.5, 0.3, 6000); pad(s, [mtof(62) * k, mtof(69) * k, mtof(74) * k, mtof(78) * k], { at: 0.3, a: 600, hold: 200, d: 600, gain: 1.2, lp: 2000 }); } },
  // internal (not in IDS.sfx): ambience critters and sand steps, played by the wiring only
  step_sand: { len: 0.16, mix: -11, cap: 'step', internal: true, render(s, v, k) { s.noise('pink', { a: 5, d: 80, gain: 4, filter: { type: 'bp', f: 950 * k, q: 0.7 }, trem: 70, tremDepth: 0.5 }); s.noise('brown', { a: 4, d: 60, gain: 0.25, filter: { type: 'lp', f: 500, q: 0.7 } }); } },
  amb_bird: { len: 0.7, mix: -14, cap: 'amb', internal: true, render(s, v, k) {
    const n = 3 + Math.floor(s.rng.next() * 3);
    for (let i = 0; i < n; i++) {
      const f0 = (2300 + 900 * s.rng.next()) * k;
      s.osc('sine', f0, f0 * (1.15 + 0.3 * s.rng.next()), { at: i * 0.1 + 0.02 * s.rng.next(), a: 4, d: 40, len: 0.07, gain: 0.6, sweep: 0.05 });
    }
  } },
  amb_bird2: { len: 0.9, mix: -24, cap: 'amb', internal: true, render(s, v, k) { s.osc('sine', 2100 * k, 2150 * k, { a: 15, hold: 140, d: 90, gain: 0.6, vib: 11, vibDepth: 0.4 }); s.osc('sine', 1650 * k, 1600 * k, { at: 0.32, a: 15, hold: 220, d: 160, gain: 0.55, vib: 11, vibDepth: 0.4 }); } },
  amb_cricket: { len: 1.3, mix: -24, cap: 'amb', internal: true, render(s, v, k) { for (let i = 0; i < 3; i++) s.osc('sine', 3300 * k, 3300 * k, { at: i * 0.42, a: 10, hold: 220, d: 40, gain: 0.5, trem: 32, tremDepth: 1 }); } },
  amb_gull: { len: 1.0, mix: -20, cap: 'amb', internal: true, render(s, v, k) { for (let i = 0; i < 2; i++) { s.osc('tri', 1350 * k, 880 * k, { at: i * 0.38, a: 20, hold: 120, d: 120, gain: 0.55, sweep: 0.28, vib: 9, vibDepth: 0.5 }); s.noise('pink', { at: i * 0.38, a: 20, d: 160, gain: 1.2, filter: { type: 'bp', f: 1500, q: 2 } }); } } },
  amb_rumble: { len: 2.4, mix: -17, cap: 'amb', internal: true, render(s, v, k) { s.noise('brown', { a: 400, hold: 300, d: 1400, gain: 0.8, filter: { type: 'lp', f: 300 * k, q: 0.7 } }); s.noise('pink', { a: 500, hold: 200, d: 1300, gain: 3.5, filter: { type: 'bp', f: 520 * k, f1: 380 * k, q: 0.9 } }); } },
  // UI
  ui_move: { len: 0.05, mix: -12, cap: 'ui', render(s, v, k) { s.osc('sine', 1400 * k, 1400 * k, { a: 1, d: 30, gain: 0.8 }); } },
  ui_confirm: { len: 0.12, mix: -12, cap: 'ui', render(s, v, k) { s.osc('sine', 880 * k, 1320 * k, { a: 2, d: 80, gain: 0.8, sweep: 0.04 }); } },
  ui_back: { len: 0.12, mix: -12, cap: 'ui', render(s, v, k) { s.osc('sine', 1100 * k, 700 * k, { a: 2, d: 80, gain: 0.8, sweep: 0.06 }); } },
  ui_error: { len: 0.2, mix: -12, cap: 'ui', render(s, v, k) { for (let i = 0; i < 2; i++) s.osc('square', 440 * k, 440 * k, { at: i * 0.09, a: 2, d: 60, len: 0.07, gain: 0.5, filter: { type: 'lp', f: 3000 } }); } },
  ui_open: { len: 0.18, mix: -12, cap: 'ui', render(s, v, k) { swish(s, k, 1000, 3000); } },
  ui_close: { len: 0.18, mix: -12, cap: 'ui', render(s, v, k) { swish(s, k, 3000, 1000); } },
  dialogue_tick: { len: 0.05, mix: -10, cap: 'ui', duck: true, duckDb: -5, render(s, v, k) { s.osc('tri', 900 * k, 900 * k, { a: 1, d: 25, gain: 0.8 }); } },
};

/** Voice caps per recipe group (ART_UX 9.1). */
export const CAPS = Object.freeze({ bolt: 6, hit: 8, step: 2, explosion: 4, ui: 3, pickup: 4, amb: 2 });

/** Render order: the sounds needed first come first; the rest follow in catalog order. */
export const PRIORITY = ['ui_confirm', 'ui_move', 'ui_back', 'ui_open', 'ui_close', 'hit_light', 'hit_heavy', 'bolt_fire', 'bolt_hit', 'level_up',
  'step_grass', 'step_stone', 'jump', 'land', 'whoosh', 'hit_finisher', 'explosion_s', 'xp_orb', 'player_hurt', 'guard_on', 'guard_block'];

/** Long, dark recipes render at a lower rate (cheaper to render, nothing lost above their content). */
const LOW_RATE = new Set(['amb_rumble', 'player_death', 'quest_complete', 'transform_rise', 'ult_rise', 'boss_roar', 'beam_charge', 'explosion_l', 'ult_impact', 'nova', 'land_heavy', 'land']);

/** @param {string} id @returns {number} sample rate of the recipe's buffers */
export function recipeRate(id) {
  return LOW_RATE.has(id) ? 22050 : SFX_RATE;
}

/**
 * Render one variant of a one-shot recipe.
 * @param {string} id @param {number} variant 0..2 @param {number} [sr] @returns {Float32Array|null} null for live loops and unknown ids
 */
export function renderRecipe(id, variant, sr) {
  const r = RECIPES[id];
  if (!r || r.live || !r.render) return null;
  if (!sr) sr = recipeRate(id);
  let seed = 0x9e3779b1;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619) >>> 0;
  const s = new Synth(r.len, sr, (seed + variant * 7919) >>> 0);
  r.render(s, variant, VARIANT_K[variant] || 1);
  return s.finish(r.peak !== undefined ? r.peak : 0.9);
}
