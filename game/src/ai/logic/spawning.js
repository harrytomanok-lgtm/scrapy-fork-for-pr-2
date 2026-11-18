/**
 * Pure spawning rules (ARCHITECTURE 4.10; GDD 3.2, 6.7): spawn-table entry selection by weight and level band,
 * enemy level clamping, ambient population targets, camp availability (the one-day refill), the boss phase by
 * HP, and the pending-boss state machine. No three, no window: Node tests load it.
 * @module ai/logic/spawning
 */

/**
 * Is a spawn-table entry valid at `level`? The entry's own min and max level and the enemy's level band.
 * @param {{ minLevel?:number, maxLevel?:number }} entry @param {[number, number]|null} band @param {number} level
 */
export function entryValid(entry, band, level) {
  if (typeof entry.minLevel === 'number' && level < entry.minLevel) return false;
  if (typeof entry.maxLevel === 'number' && level > entry.maxLevel) return false;
  if (band && (level < band[0] - 2 || level > band[1] + 2)) return false;
  return true;
}

/**
 * Pick a spawn-table entry by weight among the entries valid at `level`. Returns the index or -1.
 * @param {Array<{ enemy:string, weight:number, minLevel?:number, maxLevel?:number }>} entries
 * @param {(enemyId:string) => [number, number]|null} bandOf
 * @param {number} level @param {number} roll 0..1
 * @param {(enemyId:string) => boolean} [allow] extra filter (Siphon-silenced regions drop the Choir)
 */
export function pickEntry(entries, bandOf, level, roll, allow) {
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.weight > 0 && entryValid(e, bandOf(e.enemy), level) && (!allow || allow(e.enemy))) total += e.weight;
  }
  if (total <= 0) return -1;
  let r = Math.max(0, Math.min(0.999999, roll)) * total;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!(e.weight > 0 && entryValid(e, bandOf(e.enemy), level) && (!allow || allow(e.enemy)))) continue;
    r -= e.weight;
    if (r < 0) return i;
  }
  return -1;
}

/**
 * Level of an enemy spawned at a point of region level `regionLevel`, clamped to the enemy band.
 * @param {number} regionLevel @param {[number, number]} band
 */
export function enemyLevel(regionLevel, band) {
  const l = Math.round(regionLevel);
  return Math.max(band[0], Math.min(band[1], Math.max(1, l)));
}

/**
 * Target ambient population near the player: density (x night), never above the free room under the tier cap.
 * @param {number} density @param {number} nightMult @param {boolean} night @param {number} cap @param {number} othersAlive
 */
export function ambientTarget(density, nightMult, night, cap, othersAlive) {
  const want = Math.round(density * (night ? nightMult || 1 : 1));
  return Math.max(0, Math.min(want, cap - othersAlive));
}

/**
 * Can a camp be populated? Never cleared, or cleared at least one in-game day ago (GDD 9: camps refill after a day).
 * @param {number|undefined} dayCleared @param {number} day
 */
export function campAvailable(dayCleared, day) {
  return typeof dayCleared !== 'number' || day - dayCleared >= 1;
}

/**
 * The boss phase for an HP fraction: the last phase whose `hpBelow` is above the fraction (phase 0 starts at 1.0).
 * Phases never go back: pass the current phase as `from`.
 * @param {Array<{ hpBelow:number }>} phases @param {number} hpFrac @param {number} [from=0]
 */
export function phaseFor(phases, hpFrac, from) {
  let p = from || 0;
  while (p + 1 < phases.length && hpFrac < phases[p + 1].hpBelow) p++;
  return p;
}

/**
 * Pending-boss state machine (ARCHITECTURE 4.10). Several quest bosses can be pending at once (MQ3, MQ5 and MQ6 run
 * in parallel), but at most one is spawned. `start` records a boss as pending and spawned; `reset` despawns the
 * spawned one but keeps it pending; while a boss is pending and nothing is spawned it restarts (without the intro)
 * when the living player enters its arena, or on Retry (the last boss fought); `defeat` clears one boss and `end`
 * clears them all.
 */
export function createPendingBoss() {
  /** Pending boss ids in the order they were first started. @type {string[]} */
  const ids = [];
  const s = {
    ids,
    /** The spawned boss id, or null. @type {string|null} */
    spawned: null,
    /** The boss most recently spawned (the one Retry restarts). @type {string|null} */
    last: null,
    /** The boss Retry would restart, else the newest pending one (null when none). */
    get pending() {
      if (s.last && ids.indexOf(s.last) >= 0) return s.last;
      return ids.length ? ids[ids.length - 1] : null;
    },
    /** @param {string} id */
    has(id) {
      return ids.indexOf(id) >= 0;
    },
    /** @param {string} id */
    start(id) {
      if (ids.indexOf(id) < 0) ids.push(id);
      s.spawned = id;
      s.last = id;
    },
    /** The fight was reset (player left the arena or died, or another boss started): the boss is gone but still pending. */
    reset() {
      s.spawned = null;
    },
    /** @param {string} [id] the defeated boss (default: the spawned one, else the last one) */
    defeat(id) {
      const d = id || s.spawned || s.last;
      const i = d ? ids.indexOf(d) : -1;
      if (i >= 0) ids.splice(i, 1);
      if (s.spawned === d) s.spawned = null;
      if (s.last === d) s.last = null;
    },
    /** game:ended */
    end() {
      ids.length = 0;
      s.spawned = null;
      s.last = null;
    },
    /**
     * Should a boss restart now? Re-entry: the living player is inside a pending boss's arena. Retry:
     * player:respawned with retry restarts the last boss fought.
     * @param {boolean|((id:string) => boolean)} playerInArena true/false, or a test of the player against a boss's arena
     * @param {boolean} playerAlive @param {boolean} [retry]
     * @returns {string|null} the boss id to restart without the intro
     */
    restart(playerInArena, playerAlive, retry) {
      if (!ids.length || s.spawned || !playerAlive) return null;
      if (retry) return s.pending;
      for (let i = 0; i < ids.length; i++) {
        if (typeof playerInArena === 'function' ? playerInArena(ids[i]) : playerInArena) return ids[i];
      }
      return null;
    },
  };
  return s;
}
