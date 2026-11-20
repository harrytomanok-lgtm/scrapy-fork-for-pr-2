/**
 * Ambience beds (pure data and logic): which bed a place gets, the parameters of the live `ambience` loop for
 * each bed, and a deterministic scheduler of the sparse one-shot critters (birds, crickets, gulls, a far rumble)
 * that play around the listener. The engine builds the graph (loops.js); the wiring decides the bed at 1 Hz.
 * @module audio/logic/ambience
 */

/**
 * Bed parameters of the `ambience` live loop: a pink-noise band with a slow swell (gusts, waves) and an optional
 * hum (a sawtooth through a resonant lowpass). `noise` and `hum` are linear gains; `lfoDepth` 0..1 of the noise.
 * @typedef {{ type:'bandpass', f:number, q:number, noise:number, lfoRate:number, lfoDepth:number,
 *   hum:number, humLP:number }} Bed
 */

/** @type {Record<string, Bed>} */
export const BEDS = Object.freeze({
  // meadows and forest: a soft high breeze in the grass; the birds and crickets are one-shots
  meadow: Object.freeze({ type: 'bandpass', f: 1800, q: 0.6, noise: 0.5, lfoRate: 0.07, lfoDepth: 0.5, hum: 0, humLP: 400 }),
  // the coast: broadband surf rising and falling with the waves
  surf: Object.freeze({ type: 'bandpass', f: 800, q: 0.35, noise: 1.3, lfoRate: 0.11, lfoDepth: 0.85, hum: 0, humLP: 400 }),
  // mountains, dunes and high air: a hollow wind band with gusts
  wind: Object.freeze({ type: 'bandpass', f: 750, q: 1.1, noise: 1.6, lfoRate: 0.13, lfoDepth: 0.65, hum: 0, humLP: 400 }),
  // the Stormwell and the Spire: a low electric hum with a dark rumble under it
  hum: Object.freeze({ type: 'bandpass', f: 420, q: 1.4, noise: 0.9, lfoRate: 0.05, lfoDepth: 0.4, hum: 0.2, humLP: 900 }),
});

/** Bed of each region (IDS.region) when nothing nearer decides it. */
export const REGION_BED = Object.freeze({ meadows: 'meadow', coast: 'surf', thornwood: 'meadow', rustdune: 'wind', frostspine: 'wind', stormwell: 'hum', spire: 'hum' });

/** Above this height over the ground the air is wind, whatever the region (m). */
export const HIGH_AIR = 120;

/**
 * The bed for a place.
 * @param {string} regionId @param {number} altitude metres above the ground @param {boolean} nearSea the sea is within reach
 * @returns {string}
 */
export function bedFor(regionId, altitude, nearSea) {
  if (altitude > HIGH_AIR) return 'wind';
  if (nearSea) return 'surf';
  return REGION_BED[regionId] || 'meadow';
}

/**
 * Critters per bed: ids by day and by night (dusk and night), and the gap between two of them (s).
 * @type {Record<string, { day:string[], night:string[], gap:[number, number] }>}
 */
export const CRITTERS = Object.freeze({
  meadow: Object.freeze({ day: Object.freeze(['amb_bird', 'amb_bird', 'amb_bird2']), night: Object.freeze(['amb_cricket']), gap: Object.freeze([1.8, 6]) }),
  surf: Object.freeze({ day: Object.freeze(['amb_gull']), night: Object.freeze([]), gap: Object.freeze([5, 13]) }),
  wind: Object.freeze({ day: Object.freeze([]), night: Object.freeze([]), gap: Object.freeze([10, 20]) }),
  hum: Object.freeze({ day: Object.freeze(['amb_rumble']), night: Object.freeze(['amb_rumble']), gap: Object.freeze([7, 16]) }),
});

/**
 * @typedef {{ id:string, dx:number, dy:number, dz:number, vol:number, pitch:number }} CritterCall
 */

/**
 * Deterministic critter scheduler. `step` returns true when a critter sounds now and fills `out` with its id, an
 * offset from the listener (12-35 m away, any direction, a little above) and a volume and pitch spread.
 * @param {{ next():number }} rng the visual stream (rng.fx)
 */
export function createCritters(rng) {
  const c = {
    wait: 2,
    /**
     * @param {number} dt @param {string} bed @param {boolean} night @param {CritterCall} out @returns {boolean}
     */
    step(dt, bed, night, out) {
      const def = CRITTERS[bed];
      if (!def) return false;
      c.wait -= dt;
      if (c.wait > 0) return false;
      c.wait = def.gap[0] + (def.gap[1] - def.gap[0]) * rng.next();
      const list = night ? def.night : def.day;
      if (list.length === 0) return false;
      out.id = list[Math.floor(rng.next() * list.length) % list.length];
      const a = rng.next() * Math.PI * 2;
      const d = 12 + 23 * rng.next();
      out.dx = Math.cos(a) * d;
      out.dz = Math.sin(a) * d;
      out.dy = out.id === 'amb_rumble' ? 0 : 3 + 6 * rng.next();
      out.vol = 0.6 + 0.4 * rng.next();
      out.pitch = 0.9 + 0.2 * rng.next();
      return true;
    },
  };
  return c;
}
