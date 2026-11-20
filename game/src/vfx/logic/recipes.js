/**
 * The VFX recipe table (ART_UX 3.2): one entry for every id of `IDS.vfx`, plus internal ids. Pure data.
 *
 * A recipe is `{ body, layers, low?, shock?, decal?, flash?, light?, pillar? }`:
 * - `body`: default body colour token (overridden by `opts.color`). Colour tokens: 'body', 'core' (white, hot),
 *   'fringe' (body hue -25 degrees, darker, 60% opacity: the three-layer rule of 3.1), or a palette token name.
 * - each layer emits particles: `m` material (0 additive soft, 1 additive streak, 2 alpha dust), `cell` atlas cell,
 *   `n` count per burst (`lo` on the low tier, default half), `rate` per second for attached emitters, `sp` speed
 *   range m/s, `life` range s, `sz` [start, end] size m, `col` colour token, `a` alpha, `g` gravity m/s^2 (positive
 *   pulls down), `dr` drag 1/s, `sh` spawn shape, `r` spawn radius m, `k` white-core amount, `st` streak length
 *   as seconds of velocity, `rv` spin rad/s, `hdr` intensity (above 1 blooms on high), `fb` flipbook frames, `fi`
 *   fade-in fraction, `hi` high tier only, `dir` weight of the burst direction.
 * - `shock`: `{ r, t, sphere?, ground?, col }` shockwave; `decal`: `{ kind, r, t, col? }`; `flash`: alpha through the
 *   flash budget; `light`: `{ r, i, t }` pooled point light (high); `pillar`: `{ h, w, t, col }` light column.
 * Spawn shapes: 'sphere', 'hemi' (upper), 'up' (narrow upward cone), 'ring' (horizontal ring, outward), 'disc' (flat
 * outward), 'dir' (cone around the burst direction), 'inward' (on a sphere of radius r, moving to the centre),
 * 'column' (along a vertical line of height r), 'still' (no velocity).
 * @module vfx/logic/recipes
 */

/** Atlas cells (4 x 4 grid). */
export const CELL = Object.freeze({
  dot: 0, star: 1, streak: 2, ring: 3, smoke: 4, chip: 8, hex: 9, warn: 10, glyph: 11, spark: 12, spiral: 13, slash: 14, pebble: 15,
});
export const MAT = Object.freeze({ add: 0, streak: 1, dust: 2 });

const { dot, star, streak, ring, smoke, chip, hex, warn, glyph, spark, spiral, slash, pebble } = CELL;

/** @type {Record<string, any>} */
export const RECIPES = {
  // ---------------------------------------------------------------- Ora energy
  aura: { body: 'ora', layers: [
    { m: 1, cell: streak, rate: 40, lo: 15, sp: [2.5, 4.5], life: [0.35, 0.6], sz: [0.06, 0.03], col: 'body', sh: 'column', r: 1.4, st: 0.09, hdr: 1.6, k: 0.5 },
    { m: 0, cell: spark, rate: 10, lo: 4, sp: [0.4, 1.2], life: [0.4, 0.8], sz: [0.12, 0.02], col: 'core', sh: 'column', r: 1.6, hdr: 2, hi: true },
  ] },
  bolt: { body: 'ora', layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.12, 0.12], sz: [0.9, 0.4], col: 'body', sh: 'still', hdr: 1.6, k: 0.8 },
  ] },
  bolt_hit: { body: 'ora', layers: [
    { m: 0, cell: star, n: 1, lo: 1, sp: [0, 0], life: [0.12, 0.12], sz: [1.4, 2.2], col: 'core', sh: 'still', hdr: 2.4, rv: 3 },
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.16, 0.16], sz: [1.8, 0.5], col: 'body', sh: 'still', hdr: 1.7, k: 0.5 },
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.16, 0.16], sz: [0.4, 2.0], col: 'body', sh: 'still', hdr: 1.8 },
    { m: 1, cell: streak, n: 6, lo: 5, sp: [7, 12], life: [0.12, 0.22], sz: [0.09, 0.03], col: 'core', sh: 'sphere', st: 0.045, dr: 6, hdr: 2, k: 1 },
    { m: 2, cell: smoke, n: 2, lo: 1, sp: [0.4, 1], life: [0.35, 0.5], sz: [0.4, 0.9], col: 'paper', a: 0.35, sh: 'sphere', fb: 4, dr: 2 },
  ] },
  muzzle: { body: 'ora', layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.08, 0.08], sz: [0.5, 0.25], col: 'core', sh: 'still', hdr: 2, k: 1 },
    { m: 0, cell: star, n: 1, lo: 1, sp: [0, 0], life: [0.08, 0.08], sz: [0.5, 0.7], col: 'body', sh: 'still', hdr: 1.6, rv: 4 },
    { m: 1, cell: streak, n: 3, lo: 3, sp: [5, 9], life: [0.1, 0.16], sz: [0.04, 0.02], col: 'core', sh: 'dir', dir: 1, st: 0.04, hdr: 2, k: 1 },
  ] },
  beam_charge: { body: 'ora', ringSpin: true, layers: [
    { m: 1, cell: streak, rate: 40, lo: 24, sp: [4, 6], life: [0.18, 0.28], sz: [0.07, 0.03], col: 'core', sh: 'inward', r: 1.3, st: 0.06, hdr: 2, k: 1 },
    { m: 0, cell: spark, rate: 14, lo: 8, sp: [0.3, 0.8], life: [0.2, 0.4], sz: [0.2, 0.03], col: 'body', sh: 'sphere', r: 0.5, hdr: 1.8 },
  ] },
  beam_hit: { body: 'ora', layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.12, 0.12], sz: [1.8, 1.0], col: 'body', sh: 'still', hdr: 1.8, k: 0.6 },
    { m: 1, cell: streak, n: 5, lo: 3, sp: [8, 15], life: [0.12, 0.22], sz: [0.06, 0.02], col: 'core', sh: 'hemi', st: 0.05, dr: 5, hdr: 2, k: 1 },
    { m: 1, cell: streak, n: 3, lo: 1, sp: [5, 9], life: [0.15, 0.25], sz: [0.05, 0.02], col: 'fringe', sh: 'hemi', st: 0.05, dr: 5, hdr: 1.4 },
    { m: 2, cell: smoke, n: 1, lo: 1, sp: [0.5, 1.5], life: [0.4, 0.6], sz: [0.6, 1.4], col: 'smoke', a: 0.4, sh: 'hemi', fb: 4, dr: 2, hi: true },
  ] },
  nova: { body: 'ora', shock: { r: 7, t: 0.3, sphere: true, ground: false, col: 'body' }, layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.16, 0.16], sz: [3.5, 5], col: 'core', sh: 'still', hdr: 2.4, k: 1, cap: 5 },
    { m: 0, cell: ring, n: 2, lo: 2, sp: [0, 0], life: [0.22, 0.3], sz: [1, 9], col: 'body', sh: 'still', hdr: 2, rr: true },
    { m: 1, cell: streak, n: 32, lo: 22, sp: [18, 28], life: [0.22, 0.34], sz: [0.16, 0.05], col: 'body', sh: 'ring', r: 0.6, st: 0.05, dr: 4, hdr: 2.2, k: 0.6 },
    { m: 1, cell: streak, n: 24, lo: 16, sp: [12, 18], life: [0.25, 0.4], sz: [0.14, 0.04], col: 'core', sh: 'ring', r: 1.2, st: 0.05, dr: 3, hdr: 2, k: 1, lift: 7 },
    { m: 1, cell: streak, n: 12, lo: 6, sp: [12, 20], life: [0.2, 0.3], sz: [0.1, 0.03], col: 'fringe', sh: 'sphere', st: 0.05, dr: 4, hdr: 1.5 },
    { m: 2, cell: chip, n: 14, lo: 10, sp: [6, 12], life: [0.5, 0.8], sz: [0.26, 0.14], col: 'path', sh: 'hemi', g: 18, rv: 9 },
    { m: 2, cell: smoke, n: 16, lo: 12, sp: [7, 11], life: [0.5, 0.85], sz: [1.0, 2.2], col: 'paper', a: 0.5, sh: 'ring', r: 0.8, fb: 4, dr: 3, gnd: true },
  ] },
  ult_rise: { body: 'ora', layers: [
    { m: 1, cell: streak, n: 30, lo: 15, rate: 60, sp: [10, 18], life: [0.3, 0.5], sz: [0.1, 0.03], col: 'body', sh: 'up', st: 0.06, hdr: 2, k: 0.5 },
    { m: 0, cell: dot, n: 2, lo: 1, rate: 6, sp: [0, 1], life: [0.3, 0.5], sz: [2.2, 3.2], col: 'body', sh: 'sphere', hdr: 1.4, k: 0.6 },
    { m: 2, cell: smoke, n: 10, lo: 5, sp: [5, 9], life: [0.5, 0.9], sz: [1.0, 2.2], col: 'paper', a: 0.4, sh: 'ring', fb: 4, dr: 3 },
  ] },
  ult_sigil: { body: 'ora', sigil: true, layers: [
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [1.0, 1.0], sz: [16, 16], col: 'body', sh: 'still', hdr: 2, rv: 1.2, fi: 0.25 },
    { m: 0, cell: glyph, n: 1, lo: 1, sp: [0, 0], life: [1.0, 1.0], sz: [12, 12], col: 'core', sh: 'still', hdr: 1.6, rv: -1.8, fi: 0.3 },
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [1.0, 1.0], sz: [7, 7], col: 'fringe', sh: 'still', hdr: 1.8, rv: 2.6, fi: 0.35 },
    { m: 0, cell: spark, n: 24, lo: 12, sp: [1, 3], life: [0.6, 1.0], sz: [0.4, 0.1], col: 'core', sh: 'ring', r: 7, hdr: 2 },
  ] },
  ult_dive: { body: 'ora', layers: [
    { m: 1, cell: streak, n: 24, lo: 16, rate: 80, sp: [2, 6], life: [0.3, 0.6], sz: [0.3, 0.1], col: 'body', sh: 'sphere', r: 0.8, st: 0.2, hdr: 2, k: 0.6 },
    { m: 1, cell: streak, n: 1, lo: 1, sp: [0, 0], life: [0.35, 0.35], sz: [1.4, 0.6], col: 'core', sh: 'still', hdr: 2.2, k: 1, tail: 14 },
    { m: 0, cell: dot, n: 2, lo: 1, rate: 20, sp: [0, 0.5], life: [0.2, 0.3], sz: [3, 1.5], col: 'core', sh: 'still', hdr: 2.4, k: 1 },
  ] },
  ult_impact: { body: 'ora', light: { r: 40, i: 3, t: 1.5 }, shock: { r: 30, t: 0.6, sphere: true, ground: true, col: 'body' },
    pillar: { h: 60, w: 0.9, t: 0.6, col: 'body', y0: 2.4 }, decal: { kind: 'scorch', r: 18, t: 14 }, layers: [
      { m: 0, cell: dot, n: 2, lo: 1, sp: [0, 0], life: [0.25, 0.4], sz: [5, 9], col: 'core', sh: 'still', hdr: 2.2, k: 1, cap: 9, fi: 0.15 },
      { m: 0, cell: ring, n: 2, lo: 2, sp: [0, 0], life: [0.35, 0.5], sz: [3, 26], col: 'body', sh: 'still', hdr: 2, rr: true, cap: 34 },
      { m: 1, cell: streak, n: 60, lo: 30, sp: [30, 55], life: [0.3, 0.6], sz: [0.25, 0.06], col: 'body', sh: 'hemi', st: 0.05, dr: 3, hdr: 2.2, k: 0.5 },
      { m: 1, cell: streak, n: 30, lo: 12, sp: [20, 35], life: [0.3, 0.5], sz: [0.2, 0.05], col: 'fringe', sh: 'ring', st: 0.05, dr: 3, hdr: 1.6 },
      { m: 2, cell: chip, n: 40, lo: 20, sp: [10, 22], life: [0.8, 1.4], sz: [0.6, 0.3], col: 'path', sh: 'hemi', g: 20, rv: 8 },
      { m: 2, cell: smoke, n: 30, lo: 14, sp: [10, 18], life: [0.9, 1.5], sz: [2, 4.5], col: 'smoke', a: 0.35, sh: 'ring', fb: 4, dr: 2.5 },
    ] },
  flicker_out: { body: 'ora', layers: [
    { m: 1, cell: streak, n: 12, lo: 6, sp: [10, 16], life: [0.08, 0.16], sz: [0.05, 0.02], col: 'core', sh: 'disc', r: 0.4, st: 0.06, hdr: 1.8, k: 1 },
    { m: 1, cell: streak, n: 6, lo: 3, sp: [8, 12], life: [0.1, 0.18], sz: [0.04, 0.02], col: 'body', sh: 'disc', r: 0.6, st: 0.06, hdr: 1.4 },
  ] },
  flicker_in: { body: 'ora', layers: [
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.22, 0.22], sz: [0.6, 3.2], col: 'body', sh: 'still', hdr: 1.8 },
    { m: 1, cell: streak, n: 10, lo: 5, sp: [6, 11], life: [0.1, 0.2], sz: [0.04, 0.02], col: 'core', sh: 'disc', st: 0.05, dr: 6, hdr: 1.8, k: 1 },
  ] },
  boost_trail: { body: 'ora', layers: [
    { m: 1, cell: streak, rate: 36, lo: 14, sp: [0.5, 2], life: [0.25, 0.4], sz: [0.07, 0.02], col: 'body', sh: 'sphere', r: 0.4, st: 0.12, hdr: 1.6, k: 0.4, trail: true },
    { m: 0, cell: dot, rate: 12, lo: 0, sp: [0, 0.4], life: [0.2, 0.3], sz: [0.6, 0.1], col: 'fringe', sh: 'sphere', r: 0.3, hdr: 1.2, hi: true },
  ] },
  sonic_ring: { body: 'oraCore', shock: { r: 8, t: 0.22, sphere: true, col: 'core' }, layers: [
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.22, 0.22], sz: [0.5, 16], col: 'core', sh: 'still', hdr: 2.2 },
    { m: 1, cell: streak, n: 24, lo: 12, sp: [20, 30], life: [0.15, 0.25], sz: [0.06, 0.02], col: 'ora', sh: 'ring', st: 0.05, dr: 5, hdr: 1.8 },
  ] },
  // ---------------------------------------------------------------- melee and guard
  // Hits read at phone size (a target 5-8 m from the camera). Light: a crisp spark (star, slash, sparks). Heavy: a
  // flash frame, a directional burst and a shock ring. Finisher: all of it larger with ink splashes. Ground dust,
  // debris and a crack under launches, slams and finishers come from impact_dust.
  hit_light: { body: 'ora', layers: [
    { m: 0, cell: star, n: 1, lo: 1, sp: [0, 0], life: [0.08, 0.08], sz: [1.1, 1.9], col: 'core', sh: 'still', hdr: 2.4, rv: 6 },
    { m: 0, cell: slash, n: 1, lo: 1, sp: [0, 0], life: [0.1, 0.1], sz: [1.5, 2.1], col: 'body', sh: 'still', hdr: 2, k: 0.8, rr: true },
    { m: 1, cell: streak, n: 6, lo: 5, sp: [9, 15], life: [0.1, 0.17], sz: [0.09, 0.03], col: 'core', sh: 'dir', dir: 0.7, st: 0.05, dr: 6, hdr: 2.2, k: 1 },
    { m: 1, cell: streak, n: 3, lo: 2, sp: [6, 10], life: [0.12, 0.2], sz: [0.07, 0.03], col: 'fringe', sh: 'dir', dir: 0.7, st: 0.045, dr: 6, hdr: 1.5 },
  ] },
  hit_heavy: { body: 'ora', layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.06, 0.06], sz: [3.4, 2.2], col: 'core', sh: 'still', hdr: 2.6, k: 1 },
    { m: 0, cell: star, n: 1, lo: 1, sp: [0, 0], life: [0.13, 0.13], sz: [1.8, 3.0], col: 'core', sh: 'still', hdr: 2.4, rv: 5 },
    { m: 0, cell: slash, n: 1, lo: 1, sp: [0, 0], life: [0.12, 0.12], sz: [2.2, 3.0], col: 'body', sh: 'still', hdr: 2.2, k: 0.8, rr: true },
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.2, 0.2], sz: [0.6, 3.6], col: 'body', sh: 'still', hdr: 2 },
    { m: 1, cell: streak, n: 12, lo: 9, sp: [11, 19], life: [0.12, 0.22], sz: [0.12, 0.04], col: 'core', sh: 'dir', dir: 0.9, st: 0.05, dr: 6, hdr: 2.2, k: 1 },
    { m: 1, cell: streak, n: 6, lo: 3, sp: [7, 12], life: [0.14, 0.24], sz: [0.09, 0.03], col: 'fringe', sh: 'dir', dir: 0.6, st: 0.045, dr: 6, hdr: 1.5 },
    { m: 2, cell: chip, n: 4, lo: 3, sp: [6, 10], life: [0.35, 0.55], sz: [0.2, 0.12], col: 'path', sh: 'dir', dir: 0.6, g: 18, rv: 9 },
    { m: 2, cell: smoke, n: 2, lo: 1, sp: [0.5, 1.5], life: [0.35, 0.5], sz: [0.6, 1.3], col: 'paper', a: 0.45, sh: 'sphere', fb: 4, dr: 2 },
  ] },
  hit_finisher: { body: 'ora', layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.08, 0.08], sz: [4.6, 3.0], col: 'core', sh: 'still', hdr: 2.8, k: 1 },
    { m: 0, cell: star, n: 1, lo: 1, sp: [0, 0], life: [0.16, 0.16], sz: [2.4, 4.0], col: 'core', sh: 'still', hdr: 2.6, rv: 4 },
    { m: 0, cell: slash, n: 2, lo: 2, sp: [0, 0], life: [0.14, 0.18], sz: [3.0, 4.0], col: 'body', sh: 'still', hdr: 2.2, k: 0.8, rr: true },
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.24, 0.24], sz: [0.8, 5], col: 'body', sh: 'still', hdr: 2 },
    { m: 1, cell: streak, n: 18, lo: 12, sp: [13, 22], life: [0.14, 0.26], sz: [0.14, 0.04], col: 'core', sh: 'dir', dir: 0.8, st: 0.055, dr: 5, hdr: 2.3, k: 1 },
    { m: 1, cell: streak, n: 8, lo: 4, sp: [8, 14], life: [0.16, 0.26], sz: [0.1, 0.03], col: 'fringe', sh: 'sphere', st: 0.05, dr: 5, hdr: 1.5 },
    { m: 2, cell: chip, n: 6, lo: 6, sp: [7, 11], life: [0.3, 0.45], sz: [0.5, 0.34], col: 'ink', a: 1, sh: 'dir', dir: 0.5, dr: 5, rv: 2 },
  ] },
  /** Ground under a heavy impact, a launch or a slam: a dust ring, debris and a small crack (internal id). */
  impact_dust: { body: 'path', layers: [
    { m: 2, cell: smoke, n: 8, lo: 6, sp: [3, 5.5], life: [0.45, 0.7], sz: [0.6, 1.5], col: 'paper', a: 0.6, sh: 'ring', r: 0.4, fb: 4, dr: 3.5 },
    { m: 2, cell: chip, n: 8, lo: 6, sp: [4, 8], life: [0.45, 0.75], sz: [0.2, 0.12], col: 'body', sh: 'hemi', r: 0.4, g: 18, rv: 9 },
  ] },
  guard_shell: { body: 'ora', layers: [
    { m: 0, cell: hex, rate: 26, lo: 10, sp: [0, 0.2], life: [0.25, 0.45], sz: [0.42, 0.42], col: 'body', a: 0.5, sh: 'shield', r: 1.4, hdr: 1.3, fi: 0.3 },
  ] },
  guard_block: { body: 'ora', layers: [
    { m: 0, cell: hex, n: 9, lo: 5, sp: [0.2, 0.8], life: [0.16, 0.26], sz: [0.45, 0.55], col: 'core', sh: 'shield', r: 1.4, hdr: 1.8 },
    { m: 1, cell: streak, n: 3, lo: 3, sp: [7, 11], life: [0.1, 0.18], sz: [0.05, 0.02], col: 'core', sh: 'dir', dir: 0.8, st: 0.04, dr: 6, hdr: 2, k: 1 },
  ] },
  perfect: { body: 'oraCore', layers: [
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.3, 0.3], sz: [0.6, 5], col: 'core', sh: 'still', hdr: 2.4 },
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.38, 0.38], sz: [0.4, 3.4], col: 'ora', sh: 'still', hdr: 1.8 },
    { m: 0, cell: star, n: 1, lo: 1, sp: [0, 0], life: [0.2, 0.2], sz: [1.5, 2.8], col: 'core', sh: 'still', hdr: 2.6, rv: 3 },
    { m: 1, cell: streak, n: 16, lo: 8, sp: [10, 16], life: [0.16, 0.28], sz: [0.06, 0.02], col: 'ora', sh: 'sphere', st: 0.05, dr: 5, hdr: 2 },
  ] },
  // ---------------------------------------------------------------- Forms
  transform_in: { body: 'ember', layers: [
    { m: 1, cell: streak, rate: 50, lo: 20, sp: [4, 7], life: [0.25, 0.4], sz: [0.07, 0.02], col: 'body', sh: 'inward', r: 2.6, st: 0.08, hdr: 2, k: 0.4 },
    { m: 0, cell: dot, rate: 8, lo: 4, sp: [0, 0.3], life: [0.2, 0.35], sz: [1.6, 0.6], col: 'core', sh: 'still', hdr: 1.6, k: 1 },
  ] },
  transform_burst: { body: 'ember', shock: { r: 40, t: 0.5, ground: true, sphere: true, col: 'body' }, light: { r: 25, i: 3, t: 0.6 }, layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.22, 0.22], sz: [2.4, 4.2], col: 'core', sh: 'still', hdr: 2.0, k: 1 },
    { m: 1, cell: streak, n: 40, lo: 20, sp: [22, 34], life: [0.3, 0.5], sz: [0.12, 0.03], col: 'body', sh: 'ring', st: 0.05, dr: 3, hdr: 2.2, k: 0.4 },
    { m: 1, cell: streak, n: 18, lo: 8, sp: [14, 24], life: [0.3, 0.5], sz: [0.1, 0.03], col: 'fringe', sh: 'sphere', st: 0.05, dr: 3, hdr: 1.4 },
    { m: 2, cell: pebble, n: 24, lo: 12, sp: [10, 18], life: [0.6, 1.0], sz: [0.2, 0.12], col: 'path', sh: 'disc', r: 2, g: 14, rv: 8 },
  ] },
  // ---------------------------------------------------------------- explosions and impacts
  explosion_s: { body: 'ember', shock: { r: 4, t: 0.3, ground: true, col: 'body' }, layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.28, 0.28], sz: [2.6, 3.4], col: 'core', sh: 'still', hdr: 2.4, k: 1, fi: 0.28 },
    { m: 0, cell: dot, n: 3, lo: 2, sp: [1, 3], life: [0.3, 0.45], sz: [1.8, 2.8], col: 'body', sh: 'sphere', hdr: 1.6, k: 0.3 },
    { m: 1, cell: streak, n: 10, lo: 5, sp: [10, 16], life: [0.2, 0.32], sz: [0.07, 0.02], col: 'core', sh: 'sphere', st: 0.05, dr: 4, hdr: 2, k: 1 },
    { m: 2, cell: smoke, n: 6, lo: 3, sp: [2, 4], life: [0.7, 1.1], sz: [1.0, 2.4], col: 'smoke', a: 0.75, sh: 'hemi', fb: 4, dr: 2.5, g: -1.5 },
    { m: 2, cell: chip, n: 6, lo: 3, sp: [6, 10], life: [0.5, 0.8], sz: [0.2, 0.12], col: 'scorch', sh: 'hemi', g: 16, rv: 9 },
  ] },
  explosion_m: { body: 'ember', light: { r: 18, i: 2.5, t: 0.25 }, shock: { r: 8, t: 0.35, ground: true, col: 'body' }, decal: { kind: 'scorch', r: 3.5, t: 10 }, layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.3, 0.3], sz: [4.5, 6], col: 'core', sh: 'still', hdr: 2.6, k: 1, fi: 0.27 },
    { m: 0, cell: dot, n: 5, lo: 3, sp: [2, 4], life: [0.35, 0.5], sz: [2.6, 4], col: 'body', sh: 'sphere', hdr: 1.7, k: 0.3 },
    { m: 1, cell: streak, n: 18, lo: 9, sp: [14, 22], life: [0.22, 0.36], sz: [0.09, 0.03], col: 'core', sh: 'sphere', st: 0.05, dr: 4, hdr: 2.2, k: 1 },
    { m: 1, cell: streak, n: 8, lo: 4, sp: [10, 16], life: [0.25, 0.4], sz: [0.08, 0.03], col: 'fringe', sh: 'hemi', st: 0.05, dr: 4, hdr: 1.4 },
    { m: 2, cell: smoke, n: 12, lo: 6, sp: [2.5, 5], life: [0.9, 1.4], sz: [1.6, 3.6], col: 'smoke', a: 0.8, sh: 'hemi', fb: 4, dr: 2.2, g: -1.5 },
    { m: 2, cell: chip, n: 12, lo: 6, sp: [8, 14], life: [0.6, 1.0], sz: [0.28, 0.16], col: 'scorch', sh: 'hemi', g: 16, rv: 9 },
  ] },
  explosion_l: { body: 'ember', flash: 0.2, light: { r: 30, i: 3, t: 0.3 }, shock: { r: 10, t: 0.4, ground: true, sphere: true, col: 'body' }, decal: { kind: 'scorch', r: 6, t: 14 }, layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.34, 0.34], sz: [7, 10], col: 'core', sh: 'still', hdr: 2.8, k: 1, fi: 0.24 },
    { m: 0, cell: dot, n: 8, lo: 4, sp: [3, 6], life: [0.4, 0.6], sz: [3.6, 6], col: 'body', sh: 'sphere', hdr: 1.8, k: 0.3 },
    { m: 1, cell: streak, n: 30, lo: 14, sp: [18, 30], life: [0.25, 0.4], sz: [0.12, 0.03], col: 'core', sh: 'sphere', st: 0.05, dr: 3.5, hdr: 2.2, k: 1 },
    { m: 1, cell: streak, n: 14, lo: 6, sp: [12, 20], life: [0.3, 0.45], sz: [0.1, 0.03], col: 'fringe', sh: 'hemi', st: 0.05, dr: 3.5, hdr: 1.5 },
    { m: 2, cell: smoke, n: 24, lo: 10, sp: [3, 7], life: [1.1, 1.8], sz: [2.4, 5.5], col: 'smoke', a: 0.85, sh: 'hemi', fb: 4, dr: 2, g: -1.5 },
    { m: 2, cell: chip, n: 20, lo: 10, sp: [10, 18], life: [0.7, 1.2], sz: [0.36, 0.2], col: 'scorch', sh: 'hemi', g: 16, rv: 9 },
  ] },
  hurtle_trail: { body: 'oraCore', layers: [
    { m: 1, cell: streak, rate: 40, lo: 18, sp: [0.3, 1.2], life: [0.2, 0.32], sz: [0.12, 0.03], col: 'core', sh: 'sphere', r: 0.35, st: 0.1, hdr: 1.5, trail: true },
  ] },
  slam: { body: 'paper', decal: { kind: 'crack', r: 2.2, t: 6 }, shock: { r: 3.5, t: 0.25, ground: true, col: 'paper' }, layers: [
    { m: 2, cell: smoke, n: 12, lo: 8, sp: [3, 6.5], life: [0.55, 0.9], sz: [0.9, 2.2], col: 'paper', a: 0.65, sh: 'ring', fb: 4, dr: 3 },
    { m: 2, cell: chip, n: 12, lo: 8, sp: [5, 11], life: [0.5, 0.85], sz: [0.3, 0.16], col: 'path', sh: 'hemi', g: 18, rv: 9 },
    { m: 0, cell: star, n: 1, lo: 1, sp: [0, 0], life: [0.12, 0.12], sz: [1.6, 2.8], col: 'core', sh: 'still', hdr: 1.8, rv: 3 },
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.2, 0.2], sz: [0.6, 3.2], col: 'paper', sh: 'still', hdr: 1.4 },
  ] },
  crater: { body: 'scorchRim', layers: [
    { m: 2, cell: smoke, n: 18, lo: 8, sp: [5, 10], life: [0.9, 1.4], sz: [1.6, 3.4], col: 'paper', a: 0.4, sh: 'ring', fb: 4, dr: 2 },
    { m: 2, cell: chip, n: 24, lo: 12, sp: [8, 15], life: [0.7, 1.2], sz: [0.4, 0.2], col: 'path', sh: 'hemi', g: 18, rv: 8 },
    { m: 0, cell: spark, n: 14, lo: 6, sp: [3, 8], life: [0.4, 0.8], sz: [0.25, 0.05], col: 'body', sh: 'hemi', g: 6, hdr: 1.8 },
  ] },
  // ---------------------------------------------------------------- telegraphs (never reduced on low)
  tele_white: { body: 'white', layers: [
    { m: 0, cell: star, n: 1, lo: 1, sp: [0, 0], life: [0.3, 0.3], sz: [0.4, 1.4], col: 'core', sh: 'still', hdr: 2.2, rv: 2, fi: 0.4 },
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.35, 0.35], sz: [0.4, 3], col: 'body', sh: 'still', hdr: 1.4 },
  ] },
  tele_red: { body: 'red', layers: [
    { m: 0, cell: star, n: 1, lo: 1, sp: [0, 0], life: [0.3, 0.3], sz: [0.5, 1.6], col: 'body', sh: 'still', hdr: 1.8, rv: 2, fi: 0.4 },
    { m: 0, cell: spark, n: 6, lo: 6, sp: [1, 3], life: [0.25, 0.4], sz: [0.25, 0.05], col: 'body', sh: 'sphere', hdr: 1.6 },
  ] },
  tele_violet: { body: 'violet', layers: [
    { m: 0, cell: spiral, n: 1, lo: 1, sp: [0, 0], life: [0.5, 0.5], sz: [1.0, 2.6], col: 'body', sh: 'still', hdr: 1.8, rv: -5, fi: 0.3 },
    { m: 0, cell: spark, n: 6, lo: 6, sp: [0.5, 2], life: [0.3, 0.5], sz: [0.25, 0.05], col: 'body', sh: 'sphere', hdr: 1.6 },
  ] },
  // ---------------------------------------------------------------- finale tethers
  tether: { body: 'ora', shock: { r: 5, t: 0.4, ground: true, col: 'body' }, layers: [
    { m: 0, cell: ring, n: 2, lo: 1, sp: [0, 0], life: [0.4, 0.6], sz: [1, 6], col: 'body', sh: 'still', hdr: 1.8 },
    { m: 1, cell: streak, n: 16, lo: 8, sp: [8, 14], life: [0.25, 0.4], sz: [0.08, 0.02], col: 'core', sh: 'up', st: 0.06, hdr: 2 },
  ] },
  tether_thread: { body: 'ora', layers: [
    { m: 0, cell: spark, rate: 16, lo: 8, sp: [0.5, 1.5], life: [0.4, 0.7], sz: [0.2, 0.04], col: 'body', sh: 'sphere', r: 0.3, hdr: 1.8 },
  ] },
  // ---------------------------------------------------------------- deaths and progression
  death_choir: { body: 'paper', layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.12, 0.12], sz: [2.2, 1.2], col: 'core', sh: 'still', hdr: 2, k: 1 },
    { m: 2, cell: smoke, n: 14, lo: 7, sp: [0.4, 1.4], life: [0.8, 1.3], sz: [0.4, 1.0], col: 'paper', a: 0.55, sh: 'column', r: 1.6, fb: 4, g: -2.5, dr: 1.5 },
    { m: 1, cell: streak, n: 8, lo: 4, sp: [5, 9], life: [0.2, 0.35], sz: [0.05, 0.02], col: 'hostile', sh: 'sphere', st: 0.05, dr: 5, hdr: 1.6 },
    { m: 2, cell: chip, n: 8, lo: 4, sp: [3, 6], life: [0.4, 0.7], sz: [0.12, 0.06], col: 'zenith', sh: 'sphere', g: 12, rv: 12 },
    { m: 0, cell: spark, n: 12, lo: 9, sp: [0.8, 2.2], life: [0.6, 1.0], sz: [0.28, 0.05], col: 'ora', sh: 'column', r: 1.5, g: -3.5, dr: 1.2, hdr: 2 },
  ] },
  // the body bursts and fades to motes: violet growths, then the freed Ora rising as teal motes
  death_beast: { body: 'hostile', layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.12, 0.12], sz: [2.4, 1.4], col: 'core', sh: 'still', hdr: 2, k: 1 },
    { m: 0, cell: spark, n: 12, lo: 9, sp: [0.8, 2.2], life: [0.6, 1.0], sz: [0.28, 0.05], col: 'ora', sh: 'column', r: 1.3, g: -3.5, dr: 1.2, hdr: 2 },
    { m: 0, cell: spark, n: 18, lo: 9, sp: [0.6, 2], life: [0.8, 1.3], sz: [0.22, 0.04], col: 'body', sh: 'column', r: 1.4, g: -3, dr: 1.5, hdr: 1.8 },
    { m: 1, cell: streak, n: 10, lo: 5, sp: [5, 10], life: [0.2, 0.35], sz: [0.06, 0.02], col: 'body', sh: 'hemi', st: 0.05, dr: 5, hdr: 1.8 },
    { m: 2, cell: smoke, n: 6, lo: 3, sp: [0.5, 1.5], life: [0.7, 1.1], sz: [0.6, 1.4], col: 'corruption', a: 0.5, sh: 'column', r: 1.2, fb: 4, g: -1.5 },
  ] },
  xp_orb: { body: 'ora', layers: [
    { m: 0, cell: star, n: 1, lo: 1, sp: [0, 0], life: [0.14, 0.14], sz: [0.5, 1.1], col: 'core', sh: 'still', hdr: 2.2, rv: 5 },
    { m: 0, cell: spark, n: 4, lo: 3, sp: [1, 3], life: [0.18, 0.3], sz: [0.16, 0.03], col: 'body', sh: 'sphere', hdr: 1.8 },
  ] },
  /** XP arriving in the body: a ring pulse around the chest and motes drawn in (internal id). */
  xp_gain: { body: 'ora', layers: [
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.22, 0.22], sz: [0.5, 2.2], col: 'body', sh: 'still', hdr: 2 },
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.18, 0.18], sz: [1.6, 0.6], col: 'body', sh: 'still', hdr: 1.6, k: 0.6 },
    { m: 1, cell: streak, n: 5, lo: 4, sp: [2, 4], life: [0.2, 0.3], sz: [0.08, 0.03], col: 'core', sh: 'up', r: 0.4, st: 0.06, hdr: 2, k: 1 },
  ] },
  /** A pickup collected: a rising ring and sparks in its rarity colour (internal id). */
  pickup_get: { body: 'common', layers: [
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.25, 0.25], sz: [0.4, 2.0], col: 'body', sh: 'still', hdr: 2 },
    { m: 0, cell: spark, n: 8, lo: 6, sp: [1.5, 3.5], life: [0.35, 0.55], sz: [0.2, 0.04], col: 'body', sh: 'up', r: 0.4, g: -1, hdr: 2 },
  ] },
  /** A Ringstone wakes: a teal column, a ring of light at its foot and motes rising (internal id). */
  ringstone_wake: { body: 'ora', pillar: { h: 40, w: 0.7, t: 1.4, col: 'body' }, shock: { r: 7, t: 0.6, ground: true, col: 'body' }, layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.25, 0.25], sz: [3, 1.5], col: 'core', sh: 'still', hdr: 2.2, k: 1 },
    { m: 0, cell: ring, n: 2, lo: 2, sp: [0, 0], life: [0.4, 0.6], sz: [1, 6], col: 'body', sh: 'still', hdr: 2 },
    { m: 0, cell: spark, n: 24, lo: 16, sp: [2, 5], life: [0.9, 1.5], sz: [0.3, 0.06], col: 'body', sh: 'column', r: 3, g: -2, hdr: 2 },
    { m: 1, cell: streak, n: 16, lo: 10, sp: [8, 14], life: [0.3, 0.5], sz: [0.1, 0.03], col: 'core', sh: 'up', r: 0.8, st: 0.06, hdr: 2, k: 1 },
  ] },
  /** A Siphon's last breath: violet drawn into the core before the teal burst (internal id). */
  siphon_implode: { body: 'hostile', layers: [
    { m: 1, cell: streak, n: 40, lo: 26, sp: [10, 16], life: [0.3, 0.4], sz: [0.16, 0.05], col: 'body', sh: 'inward', r: 6, st: 0.06, hdr: 2, k: 0.5 },
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.35, 0.35], sz: [1, 6], col: 'body', sh: 'still', hdr: 2, k: 0.4, fi: 0.8 },
    { m: 0, cell: spiral, n: 1, lo: 1, sp: [0, 0], life: [0.4, 0.4], sz: [8, 1], col: 'body', sh: 'still', hdr: 1.8, rv: -8 },
  ] },
  /** A boss enters a new phase: a hostile shock ring, a roar of streaks and a dark puff (internal id). */
  boss_phase: { body: 'hostile', shock: { r: 9, t: 0.45, ground: true, col: 'body' }, layers: [
    { m: 0, cell: ring, n: 2, lo: 2, sp: [0, 0], life: [0.3, 0.45], sz: [1, 9], col: 'body', sh: 'still', hdr: 2, rr: true },
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.2, 0.2], sz: [4, 2], col: 'body', sh: 'still', hdr: 1.8, k: 0.5 },
    { m: 1, cell: streak, n: 24, lo: 16, sp: [12, 20], life: [0.25, 0.4], sz: [0.14, 0.04], col: 'body', sh: 'ring', r: 1, st: 0.05, dr: 4, hdr: 2, lift: 4 },
    { m: 2, cell: smoke, n: 10, lo: 8, sp: [4, 7], life: [0.6, 1.0], sz: [1.2, 2.6], col: 'smoke', a: 0.6, sh: 'ring', r: 1, fb: 4, dr: 2.5, gnd: true },
  ] },
  level_up: { body: 'ora', pillar: { h: 12, w: 1.6, t: 0.9, col: 'body' }, decal: { kind: 'glyph', r: 3, t: 1.6 }, shock: { r: 5, t: 0.4, ground: true, col: 'body' }, layers: [
    { m: 1, cell: streak, n: 30, lo: 14, sp: [6, 12], life: [0.5, 0.9], sz: [0.08, 0.03], col: 'body', sh: 'up', r: 1.2, st: 0.06, hdr: 2, k: 0.5 },
    { m: 0, cell: spark, n: 24, lo: 10, sp: [1, 3], life: [0.8, 1.2], sz: [0.2, 0.05], col: 'core', sh: 'column', r: 2.5, g: -2, hdr: 2 },
    { m: 0, cell: glyph, n: 1, lo: 1, sp: [0, 0], life: [0.6, 0.6], sz: [1.5, 5], col: 'body', sh: 'still', hdr: 1.6, rv: 1 },
  ] },
  pickup: { body: 'common', layers: [
    { m: 0, cell: spark, rate: 5, lo: 3, sp: [0.4, 0.9], life: [0.7, 1.1], sz: [0.14, 0.03], col: 'body', sh: 'sphere', r: 0.4, g: -0.8, hdr: 1.8 },
  ] },
  pillar: { body: 'ora', layers: [
    { m: 0, cell: spark, rate: 8, lo: 4, sp: [1.5, 3], life: [1.2, 2.0], sz: [0.3, 0.05], col: 'body', sh: 'up', r: 0.6, hdr: 1.8 },
  ] },
  siphon_idle: { body: 'hostile', layers: [
    { m: 2, cell: smoke, rate: 6, lo: 2, sp: [1, 2], life: [1.0, 1.6], sz: [0.6, 0.2], col: 'corruption', a: 0.5, sh: 'inward', r: 9, fb: 4, hi: true },
    { m: 0, cell: spark, rate: 10, lo: 5, sp: [2, 3.5], life: [1.0, 1.6], sz: [0.18, 0.04], col: 'paper', sh: 'inward', r: 8, hdr: 1.2 },
    { m: 0, cell: dot, rate: 4, lo: 2, sp: [0.5, 1], life: [0.6, 1], sz: [1.2, 0.4], col: 'body', sh: 'column', r: 4, hdr: 1.6 },
  ] },
  siphon_core: { body: 'hostile', shock: { r: 6, t: 0.4, ground: true, col: 'body' }, layers: [
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.3, 0.3], sz: [3, 5], col: 'core', sh: 'still', hdr: 2.2, k: 1 },
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.4, 0.4], sz: [1, 7], col: 'body', sh: 'still', hdr: 2 },
    { m: 1, cell: streak, n: 16, lo: 8, sp: [8, 14], life: [0.2, 0.35], sz: [0.08, 0.02], col: 'body', sh: 'sphere', st: 0.05, dr: 4, hdr: 2 },
  ] },
  siphon_break: { body: 'ora', flash: 0.3, light: { r: 60, i: 3, t: 1 }, shock: { r: 120, t: 1.4, ground: true, sphere: true, col: 'body' }, layers: [
    { m: 0, cell: dot, n: 2, lo: 1, sp: [0, 0], life: [0.5, 0.7], sz: [8, 18], col: 'core', sh: 'still', hdr: 2.6, k: 1 },
    { m: 1, cell: streak, n: 50, lo: 24, sp: [25, 45], life: [0.4, 0.8], sz: [0.2, 0.05], col: 'body', sh: 'sphere', st: 0.05, dr: 2.5, hdr: 2.2, k: 0.5 },
    { m: 1, cell: streak, n: 24, lo: 10, sp: [18, 30], life: [0.4, 0.7], sz: [0.16, 0.05], col: 'hostile', sh: 'sphere', st: 0.05, dr: 2.5, hdr: 1.6 },
    { m: 2, cell: chip, n: 30, lo: 14, sp: [10, 20], life: [0.8, 1.4], sz: [0.5, 0.25], col: 'corruption', sh: 'hemi', g: 16, rv: 8 },
  ] },
  // ---------------------------------------------------------------- small ambient puffs
  spray: { body: 'foam', layers: [
    { m: 2, cell: smoke, n: 8, lo: 4, sp: [2, 5], life: [0.4, 0.7], sz: [0.4, 1.0], col: 'body', a: 0.7, sh: 'up', fb: 4, g: 9, dr: 1.5 },
    { m: 2, cell: pebble, n: 10, lo: 5, sp: [3, 6], life: [0.4, 0.6], sz: [0.1, 0.06], col: 'body', sh: 'up', g: 14 },
  ] },
  // footstep dust: only the player's strides at a run or faster use it on the low tier (scaled by speed)
  step_dust: { body: 'path', layers: [
    { m: 2, cell: smoke, n: 3, lo: 3, sp: [0.6, 1.6], life: [0.4, 0.6], sz: [0.45, 1.15], col: 'paper', a: 0.6, sh: 'disc', fb: 4, dr: 3 },
  ] },
  land_ring: { body: 'paper', shock: { r: 3, t: 0.3, ground: true, col: 'paper' }, layers: [
    { m: 2, cell: smoke, n: 12, lo: 8, sp: [3, 5.5], life: [0.4, 0.65], sz: [0.5, 1.3], col: 'body', a: 0.6, sh: 'ring', r: 0.3, fb: 4, dr: 4 },
    { m: 2, cell: pebble, n: 8, lo: 6, sp: [3, 6], life: [0.4, 0.6], sz: [0.12, 0.08], col: 'path', sh: 'hemi', r: 0.4, g: 16 },
  ] },
  // ---------------------------------------------------------------- movement (internal ids)
  /** Leaving the ground into flight: a horizontal ring of light under the feet and streaks thrown downward. */
  takeoff: { body: 'ora', layers: [
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.24, 0.24], sz: [0.6, 3.6], col: 'body', sh: 'still', hdr: 1.8 },
    { m: 0, cell: dot, n: 1, lo: 1, sp: [0, 0], life: [0.12, 0.12], sz: [1.6, 0.8], col: 'core', sh: 'still', hdr: 2, k: 1 },
    { m: 1, cell: streak, n: 14, lo: 10, sp: [7, 12], life: [0.14, 0.24], sz: [0.1, 0.03], col: 'body', sh: 'ring', r: 0.3, st: 0.05, dr: 5, hdr: 1.8, k: 0.5 },
    { m: 1, cell: streak, n: 6, lo: 4, sp: [8, 12], life: [0.14, 0.22], sz: [0.08, 0.03], col: 'core', sh: 'dir', dir: 1, st: 0.06, dr: 4, hdr: 2, k: 1 },
  ] },
  /** A boost stage change: a burst ring facing the direction of travel and streaks thrown back. */
  boost_start: { body: 'ora', layers: [
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.2, 0.2], sz: [0.5, 5], col: 'core', sh: 'still', hdr: 2 },
    { m: 0, cell: ring, n: 1, lo: 1, sp: [0, 0], life: [0.26, 0.26], sz: [0.4, 3.6], col: 'body', sh: 'still', hdr: 1.8 },
    { m: 1, cell: streak, n: 16, lo: 10, sp: [10, 18], life: [0.16, 0.26], sz: [0.09, 0.03], col: 'body', sh: 'dir', dir: 1, st: 0.06, dr: 4, hdr: 1.8, k: 0.6 },
  ] },
  /** Flight contrail behind the feet; only drawn while moving fast (minSpeed). */
  contrail: { body: 'ora', minSpeed: 9, layers: [
    { m: 1, cell: streak, rate: 30, lo: 20, sp: [0, 0.2], life: [0.4, 0.4], sz: [0.16, 0.03], col: 'body', a: 0.7, sh: 'still', hdr: 1.4, k: 0.3, trail: true },
  ] },
  /** Foam left on the water behind a low, fast flyer: flat puffs that spread and fade. */
  wake: { body: 'foam', layers: [
    { m: 2, cell: smoke, n: 2, lo: 2, sp: [0.6, 1.4], life: [0.9, 1.3], sz: [0.6, 1.8], col: 'body', a: 0.6, sh: 'disc', r: 0.5, fb: 4, dr: 1.5 },
  ] },
  // ---------------------------------------------------------------- internal ids (not in IDS.vfx)
  debris: { body: 'path', layers: [
    { m: 2, cell: chip, n: 16, lo: 8, sp: [5, 10], life: [0.6, 1.0], sz: [0.3, 0.16], col: 'body', sh: 'hemi', g: 18, rv: 9 },
    { m: 2, cell: smoke, n: 8, lo: 4, sp: [1.5, 3], life: [0.6, 1.0], sz: [0.8, 1.8], col: 'paper', a: 0.55, sh: 'hemi', fb: 4, dr: 2 },
  ] },
  limb_trail: { body: 'ora', layers: [
    { m: 1, cell: streak, rate: 90, lo: 60, sp: [0, 0.2], life: [0.16, 0.16], sz: [0.34, 0.04], col: 'body', sh: 'still', st: 0.0, hdr: 1.8, k: 0.5, trail: true },
  ] },
  trail: { body: 'ora', layers: [
    { m: 1, cell: streak, rate: 40, lo: 20, sp: [0, 0.3], life: [0.25, 0.25], sz: [0.3, 0.05], col: 'body', sh: 'still', st: 0.0, hdr: 1.4, trail: true },
  ] },
};
