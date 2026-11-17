/**
 * Voice allocation (ART_UX 9.1): a fixed pool per tier (24 low, 32 high), per-recipe caps (bolt 6, hits 8,
 * steps 2, explosions 4, UI 3, pickups 4), same-id merge within 30 ms, and stealing of the oldest and quietest
 * voice. Pure: works on plain slot records so it runs in Node; the engine attaches the audio nodes.
 * @module audio/logic/voices
 */

/** Voices per quality tier. */
export const TIER_VOICES = Object.freeze({ low: 24, high: 32 });
/** Pre-rendered variants per tier. */
export const TIER_VARIANTS = Object.freeze({ low: 2, high: 3 });
/** Same-id sounds closer than this merge into the first (seconds). */
export const MERGE_WINDOW = 0.03;

/**
 * @typedef {object} VoiceSlot
 * @property {number} id        voice id, 0 when free
 * @property {string|null} sfx  recipe id
 * @property {string|null} cap  voice group
 * @property {number} start     context time it started
 * @property {number} end       context time it ends
 * @property {number} vol       effective gain (distance and mix included)
 */

/** @returns {VoiceSlot} */
export function createSlot() {
  return { id: 0, sfx: null, cap: null, start: 0, end: 0, vol: 0 };
}

/**
 * Steal score: older and quieter voices score higher.
 * @param {VoiceSlot} v @param {number} now
 */
function stealScore(v, now) {
  const dur = Math.max(0.01, v.end - v.start);
  const progress = Math.min(1, (now - v.start) / dur);
  return progress + (1 - Math.min(1, v.vol)) * 0.75;
}

/**
 * Index of a voice playing `sfx` that started within the merge window, or -1.
 * @param {VoiceSlot[]} slots @param {number} n @param {string} sfx @param {number} now
 */
export function findMerge(slots, n, sfx, now) {
  for (let i = 0; i < n; i++) {
    const v = slots[i];
    if (v.id !== 0 && v.sfx === sfx && now - v.start < MERGE_WINDOW) return i;
  }
  return -1;
}

/**
 * Choose the slot for a new voice: a voice of the same group when the group is at its cap, else a free slot,
 * else the best steal candidate overall. Returns -1 when the new sound is quieter than everything it could steal
 * while the pool is full (the new sound is dropped instead).
 * @param {VoiceSlot[]} slots @param {number} n active pool size @param {string|null} cap @param {number} capLimit
 * @param {number} now @param {number} vol gain of the new voice
 * @returns {number}
 */
export function pickSlot(slots, n, cap, capLimit, now, vol) {
  let inCap = 0;
  let free = -1;
  let bestCap = -1;
  let bestCapScore = -1;
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < n; i++) {
    const v = slots[i];
    if (v.id === 0) {
      if (free < 0) free = i;
      continue;
    }
    const sc = stealScore(v, now);
    if (cap !== null && v.cap === cap) {
      inCap++;
      if (sc > bestCapScore) { bestCapScore = sc; bestCap = i; }
    }
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  if (cap !== null && inCap >= capLimit) return bestCap;
  if (free >= 0) return free;
  if (best >= 0 && vol < slots[best].vol * 0.25 && bestScore < 0.5) return -1;
  return best;
}

/**
 * Count of busy voices.
 * @param {VoiceSlot[]} slots @param {number} n
 */
export function busyCount(slots, n) {
  let c = 0;
  for (let i = 0; i < n; i++) if (slots[i].id !== 0) c++;
  return c;
}

/**
 * Distance gain of ART_UX 9.1: 1 / (1 + d / 15).
 * @param {number} d metres
 */
export function distanceGain(d) {
  return 1 / (1 + d / 15);
}

/**
 * Lowpass cutoff by distance: 18 kHz at 0 m down to 2 kHz at 150 m (exponential).
 * @param {number} d metres
 */
export function distanceCutoff(d) {
  const t = Math.min(1, Math.max(0, d / 150));
  return 18000 * Math.pow(2000 / 18000, t);
}

/** Footstep surface mapping of ARCHITECTURE 4.2 (5): [sfx id, pitch]. */
export const STEP_SURFACE = Object.freeze({
  grass: Object.freeze(['step_grass', 1]),
  stone: Object.freeze(['step_stone', 1]),
  snow: Object.freeze(['step_snow', 1]),
  water: Object.freeze(['step_water', 1]),
  sand: Object.freeze(['step_grass', 0.7]),
});

/** Hit sound by feel class of `combat:hit` (IDS.feel). */
export const HIT_CLASS = Object.freeze({
  lightHit: 'hit_light', heavyHit: 'hit_heavy', finisher: 'hit_finisher', boltHit: 'bolt_hit', beamTick: 'hit_light',
  burst: 'hit_heavy', ultimate: 'hit_finisher', hurtLight: 'player_hurt', hurtHeavy: 'player_hurt', wallSlam: 'hit_heavy',
  craterBig: 'explosion_m', bossDeath: 'explosion_l',
});
