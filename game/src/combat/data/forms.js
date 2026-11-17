/**
 * Forms (ARCHITECTURE 5.2, GDD 5.5) and technique-tree nodes (5.1 TechNodeDef, GDD 5.3) from BALANCE.
 * Pure data: Node tests load it.
 * @module combat/data/forms
 */

import { BALANCE } from '../../core/balance.js';
import { PALETTE } from '../../core/palette.js';

/** Music shift per Form (semitones; the audio package reads it). */
const MUSIC = Object.freeze({ ember: 0, tempest: 2, zenith: 5 });

/** @returns {object[]} FormDefs in order */
export function formDefs() {
  const r = BALANCE.formRules;
  return Object.keys(BALANCE.forms).map((id) => {
    const f = BALANCE.forms[id];
    return {
      id, order: f.order, cost: f.cost, drain: f.drain, hpDrainPct: f.hpDrainPct,
      mult: { dmg: f.mult.dmg, def: f.mult.def, speed: f.mult.speed, res: f.mult.res, surge: f.mult.surge },
      flickerCostMult: f.mods.flickerCostMult,
      color: PALETTE[id], coreColor: PALETTE.oraCore, auraStyle: id, formKey: id,
      transform: { seconds: r.transformSeconds, shortSeconds: r.shortSeconds, shockRadius: r.shockRadius },
      musicShift: MUSIC[id] || 0,
      unlock: f.scripted ? { scripted: true } : { quest: f.unlockQuest },
    };
  }).sort((a, b) => a.order - b.order);
}

/** Technique branch per technique id. */
const TECH_BRANCH = Object.freeze({
  strike_string: 'fist', breaker: 'fist', meteor_heel: 'fist', pursuit: 'fist',
  ora_bolt: 'flare', flare_barrage: 'flare', dawn_lance: 'flare', nova_ring: 'flare', ringfall: 'flare',
  guard: 'spirit', flicker_step: 'spirit', boost: 'spirit', gather: 'spirit',
});

/**
 * Technique-tree nodes: one node per purchasable technique rank (rank 2 and up, and rank 1 when it costs TP,
 * like Flare Barrage), and one node per passive rank.
 * @returns {object[]} TechNodeDefs
 */
export function techNodeDefs() {
  const out = [];
  const order = { fist: 0, flare: 0, spirit: 0 };
  const T = BALANCE.tech;
  for (const techId of Object.keys(TECH_BRANCH)) {
    const t = T[techId];
    if (!t || !Array.isArray(t.ranks)) continue;
    const branch = TECH_BRANCH[techId];
    t.ranks.forEach((rk, i) => {
      if (!(rk.tp > 0)) return;
      const rank = i + 1;
      /** @type {Record<string, any>} */
      const requires = {};
      if (rank === 1) {
        if (typeof t.unlockLevel === 'number') requires.level = t.unlockLevel;
      } else {
        requires.tech = techId;
        const prev = t.ranks[i - 1];
        if (i - 1 >= 1 || (i - 1 === 0 && prev.tp > 0)) requires.node = techId + '_r' + i;
      }
      const node = { id: techId + '_r' + rank, branch, order: ++order[branch], tp: rk.tp, techId, rank, requires };
      // Gather rank 2 also lowers the damage taken while Gathering (an rpg modifier).
      if (rk.mods) node.passive = Object.assign({}, rk.mods);
      out.push(node);
    });
  }
  for (const pid of Object.keys(BALANCE.passives)) {
    const p = BALANCE.passives[pid];
    p.ranks.forEach((rk, i) => {
      const id = pid + '_' + (i + 1);
      const node = { id, branch: p.branch, order: ++order[p.branch], tp: rk.tp, passive: Object.assign({}, rk.mods) };
      if (i > 0) node.requires = { node: pid + '_' + i };
      out.push(node);
    });
  }
  return out;
}
