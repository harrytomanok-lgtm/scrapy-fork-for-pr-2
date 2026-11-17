/**
 * The attack-token director (GDD 6.7, ARCHITECTURE 4.10). Only enemies holding a token may start an attack, so at
 * most `attackers` enemies attack at once (Story 2, Warrior 4, Master 6), split evenly between melee and ranged
 * tokens (Warrior: 2 melee, 2 ranged). The rest circle and taunt. Bosses do not use tokens.
 * Tokens are held from the request until the attack ends; a holder that does not release in `maxHold` seconds
 * loses it (a stuck brain never starves the others), and a released holder waits `rest` seconds before it may
 * ask again, so enemies take turns. Pure and allocation-free after creation.
 * @module ai/logic/director
 */

/** Largest attacker count of the difficulty table. */
const MAX = 8;

/**
 * Token limits for a number of simultaneous attackers.
 * @param {number} attackers @returns {{ melee:number, ranged:number }}
 */
export function tokenLimits(attackers) {
  const n = Math.max(0, Math.min(MAX, Math.floor(attackers)));
  const melee = Math.ceil(n / 2);
  return { melee, ranged: n - melee };
}

/**
 * @param {{ maxHold?:number, rest?:number }} [opts]
 */
export function createDirector(opts) {
  const o = opts || {};
  const maxHold = typeof o.maxHold === 'number' ? o.maxHold : 6;
  const rest = typeof o.rest === 'number' ? o.rest : 1.2;
  // Slot tables: holder id (0 = free) and the time the token was granted. Index 0..MAX-1 melee, MAX.. ranged.
  const holder = new Int32Array(MAX * 2);
  const since = new Float64Array(MAX * 2);
  // Recently released ids and their release time (turn taking).
  const restId = new Int32Array(64);
  const restAt = new Float64Array(64);
  let restN = 0;
  const lim = { melee: 2, ranged: 2 };

  /** @param {'melee'|'ranged'} kind */
  const base = (kind) => (kind === 'ranged' ? MAX : 0);

  function expire(now) {
    for (let i = 0; i < MAX * 2; i++) if (holder[i] && now - since[i] > maxHold) holder[i] = 0;
    let w = 0;
    for (let i = 0; i < restN; i++) {
      if (now - restAt[i] < rest) {
        restId[w] = restId[i];
        restAt[w] = restAt[i];
        w++;
      }
    }
    restN = w;
  }

  const d = {
    limits: lim,

    /** @param {number} attackers simultaneous attackers of the difficulty */
    setAttackers(attackers) {
      const l = tokenLimits(attackers);
      lim.melee = l.melee;
      lim.ranged = l.ranged;
    },

    /**
     * Ask for a token. True when the entity holds (or now gets) one of that kind.
     * @param {number} entId @param {'melee'|'ranged'} kind @param {number} now
     */
    request(entId, kind, now) {
      expire(now);
      const b = base(kind);
      const n = kind === 'ranged' ? lim.ranged : lim.melee;
      for (let i = 0; i < MAX; i++) if (holder[b + i] === entId) return i < n;
      for (let i = 0; i < restN; i++) if (restId[i] === entId) return false;
      // A holder of the other kind gives it up first.
      d.release(entId, now, true);
      for (let i = 0; i < n; i++) {
        if (holder[b + i] === 0) {
          holder[b + i] = entId;
          since[b + i] = now;
          return true;
        }
      }
      return false;
    },

    /**
     * Give a token back. `quiet` skips the rest period (a kind switch, a despawn).
     * @param {number} entId @param {number} now @param {boolean} [quiet]
     */
    release(entId, now, quiet) {
      let had = false;
      for (let i = 0; i < MAX * 2; i++) {
        if (holder[i] === entId) {
          holder[i] = 0;
          had = true;
        }
      }
      if (had && !quiet && restN < restId.length) {
        restId[restN] = entId;
        restAt[restN] = now;
        restN++;
      }
      return had;
    },

    /** @param {number} entId @returns {0|1|2} 0 none, 1 melee, 2 ranged */
    holds(entId) {
      for (let i = 0; i < MAX; i++) if (holder[i] === entId) return 1;
      for (let i = 0; i < MAX; i++) if (holder[MAX + i] === entId) return 2;
      return 0;
    },

    /** @param {'melee'|'ranged'} kind @returns {number} tokens held of that kind */
    count(kind) {
      const b = base(kind);
      let c = 0;
      for (let i = 0; i < MAX; i++) if (holder[b + i]) c++;
      return c;
    },

    reset() {
      holder.fill(0);
      restN = 0;
    },
  };
  return d;
}
