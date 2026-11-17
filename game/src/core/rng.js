/**
 * Deterministic random streams (mulberry32) and stateless hashes (ARCHITECTURE 3.9).
 * `Math.random` is forbidden everywhere else in `src/`. Pure module.
 * @module core/rng
 */

import { WORLD_SEED } from './constants.js';

/**
 * @typedef {object} RngStream
 * @property {number} seed                 Seed the stream was created or last reset with (uint32).
 * @property {() => number} next           Uniform float in [0, 1).
 * @property {(a:number, b:number) => number} range   Uniform float in [a, b).
 * @property {(a:number, b:number) => number} int     Uniform integer in [a, b], both inclusive.
 * @property {<T>(arr:ArrayLike<T>) => T|undefined} pick   Uniform element; undefined for an empty array.
 * @property {(p:number) => boolean} chance  True with probability p.
 * @property {(label:string) => RngStream} fork  New independent stream derived from this stream's seed and `label`
 *                                         (does not consume numbers; the same label always yields the same stream).
 * @property {(seed:number) => void} reset Restart the sequence from `seed`.
 * @property {number} state                Internal state (read and write, for snapshots in tests).
 */

/**
 * Hash a string to a uint32 (FNV-1a with a final avalanche).
 * @param {string} str @returns {number}
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

/**
 * Avalanche a 32-bit integer.
 * @param {number} h @returns {number} uint32
 */
function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Stateless hash of an integer cell coordinate and a seed, for per-cell determinism.
 * @param {number} ix @param {number} iz @param {number} seed
 * @returns {number} uint32
 */
export function hash2(ix, iz, seed) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = mix32(h ^ Math.imul(ix | 0, 0x27d4eb2d));
  h = mix32(h ^ Math.imul(iz | 0, 0x165667b1));
  return h;
}

/**
 * Create a mulberry32 stream.
 * @param {number} seed Any number; it is truncated to uint32.
 * @returns {RngStream}
 */
export function createStream(seed) {
  const s = {
    seed: seed >>> 0,
    state: seed >>> 0,
    next() {
      s.state = (s.state + 0x6d2b79f5) >>> 0;
      let t = s.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(a, b) {
      return a + (b - a) * s.next();
    },
    int(a, b) {
      return a + Math.floor(s.next() * (b - a + 1));
    },
    pick(arr) {
      return arr.length === 0 ? undefined : arr[Math.floor(s.next() * arr.length)];
    },
    chance(p) {
      return s.next() < p;
    },
    fork(label) {
      return createStream(mix32(s.seed ^ hashString(label)));
    },
    reset(newSeed) {
      s.seed = newSeed >>> 0;
      s.state = s.seed;
    },
  };
  return /** @type {RngStream} */ (s);
}

/**
 * @typedef {object} RngService
 * @property {RngStream} sim    Gameplay randomness. Session reseeds it (`rng.sim.reset(seed)`) from `flags.seed` or the save's createdAt.
 * @property {RngStream} fx     Visuals only; never influences the sim.
 * @property {RngStream} world  Fixed by the world seed; used only during the bake.
 */

/**
 * Create the three standard streams of `ctx.rng`.
 * @param {{ seed?:number, worldSeed?:number }} [opts] `seed` seeds `sim` and `fx` (default 1); `worldSeed` defaults to WORLD_SEED.
 * @returns {RngService}
 */
export function createRng(opts = {}) {
  const seed = Number.isFinite(opts.seed) ? /** @type {number} */ (opts.seed) : 1;
  const worldSeed = Number.isFinite(opts.worldSeed) ? /** @type {number} */ (opts.worldSeed) : WORLD_SEED;
  return {
    sim: createStream(seed),
    fx: createStream(mix32(seed ^ 0x5bd1e995)),
    world: createStream(worldSeed),
  };
}
