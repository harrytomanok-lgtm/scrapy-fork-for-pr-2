/**
 * Progression logic (ARCHITECTURE 4.11, GDD 4): XP and multi-level-ups, allocation styles, effective stats with
 * gear, the closed modifier set (gear, passives, Form), derived stats and Resonance, technique nodes and ranks.
 * Pure: functions take plain store sections and definition lookups; no three, no DOM, no ctx.
 * @module rpg/logic/progression
 */

import { BALANCE } from '../../core/balance.js';
import * as F from '../../core/formulas.js';

export const STATS = Object.freeze(['mgt', 'spr', 'vit', 'swf']);
export const EQUIP_SLOTS = Object.freeze(['wraps', 'garb', 'charm1', 'charm2']);
export const STYLES = Object.freeze(['brawler', 'blaster', 'balanced', 'manual']);
const MOD_KEYS = Object.freeze(Object.keys(F.MOD_DEFAULTS));

/**
 * @typedef {{ item:(id:string)=>any, node:(id:string)=>any }} Lookup   definition finders (defs.find bound to a kind)
 */

/**
 * Number of points already applied above the starting stats (the index the next auto point gets).
 * @param {any} p store.player
 * @returns {number}
 */
export function appliedPoints(p) {
  return p.base.mgt + p.base.spr + p.base.vit + p.base.swf - 4 * BALANCE.level.startStat;
}

/**
 * Spend every unspent point by an allocation style. 'manual' (or an unknown style) banks them.
 * @param {any} p store.player
 * @param {string} style
 * @returns {number} points spent
 */
export function spendBy(p, style) {
  let n = 0;
  while (p.statPoints > 0) {
    const stat = F.styleStat(/** @type {any} */ (style), appliedPoints(p));
    if (!stat) break;
    p.base[stat]++;
    p.statPoints--;
    n++;
  }
  return n;
}

/**
 * Add XP and apply every level-up it pays for, without pause. Each level grants the stat points and TP of
 * BALANCE.level and applies them by `p.autoStyle` unless it is 'manual'. At the cap XP stays 0.
 * @param {any} p store.player
 * @param {number} amount
 * @param {(p:any)=>void} [onLevel] called after each level is applied
 * @returns {number} levels gained
 */
export function addXp(p, amount, onLevel) {
  const n = Math.max(0, Math.round(amount || 0));
  const L = BALANCE.level;
  if (n <= 0 || p.level >= L.cap) return 0;
  p.xp += n;
  let gained = 0;
  while (p.level < L.cap && p.xp >= F.xpToNext(p.level)) {
    p.xp -= F.xpToNext(p.level);
    p.level++;
    gained++;
    p.statPoints += L.statPointsPerLevel;
    p.tp += L.tpPerLevel;
    if (p.autoStyle !== 'manual') spendBy(p, p.autoStyle);
    if (onLevel) onLevel(p);
  }
  if (p.level >= L.cap) p.xp = 0;
  return gained;
}

/**
 * Debug: set the level, reset the allocation to the starting stats and grant the matching points and TP
 * (TP already spent on nodes is kept spent).
 * @param {any} p store.player
 * @param {number} level
 * @param {(id:string)=>any} [findNode]
 */
export function setLevel(p, level, findNode) {
  const L = Math.max(1, Math.min(BALANCE.level.cap, Math.round(level || 1)));
  p.level = L;
  p.xp = 0;
  for (const k of STATS) p.base[k] = BALANCE.level.startStat;
  p.statPoints = F.statPointsAt(L);
  let spent = 0;
  if (findNode) for (const id of p.nodes) { const n = findNode(id); if (n) spent += n.tp || 0; }
  p.tp = Math.max(0, (L - 1) * BALANCE.level.tpPerLevel - spent);
  if (p.autoStyle !== 'manual') spendBy(p, p.autoStyle);
}

/**
 * Manual allocation.
 * @param {any} p @param {string} stat @param {number} [n=1]
 * @returns {boolean}
 */
export function allocate(p, stat, n = 1) {
  const k = Math.floor(n);
  if (STATS.indexOf(stat) < 0 || !(k >= 1) || p.statPoints < k) return false;
  p.base[stat] += k;
  p.statPoints -= k;
  return true;
}

/**
 * Effective stats: the allocation plus every equipped item's scaled stats; `def` is the gear defense.
 * @param {any} p store.player @param {any} inv store.inv @param {Lookup} look
 * @param {{ mgt:number, spr:number, vit:number, swf:number, def:number }} out
 */
export function effectiveBase(p, inv, look, out) {
  for (const k of STATS) out[k] = p.base[k];
  out.def = 0;
  for (const s of EQUIP_SLOTS) {
    const row = rowOf(inv, inv.equip[s]);
    const def = row ? look.item(row.itemId) : null;
    if (!def || !def.stats) continue;
    for (const k in def.stats) out[k] = (out[k] || 0) + F.itemValue(def.stats[k], row.level);
  }
  return out;
}

/**
 * Aggregate the closed modifier set: equipped gear, owned passive nodes and the active Form.
 * @param {any} p @param {any} inv @param {Lookup} look @param {any} form FormDef or null
 * @param {Record<string, number>} out
 */
export function collectMods(p, inv, look, form, out) {
  for (let i = 0; i < MOD_KEYS.length; i++) out[MOD_KEYS[i]] = F.MOD_DEFAULTS[MOD_KEYS[i]];
  for (const s of EQUIP_SLOTS) {
    const row = rowOf(inv, inv.equip[s]);
    const def = row ? look.item(row.itemId) : null;
    if (def) F.addMods(out, def.mods);
  }
  for (const id of p.nodes) {
    const n = look.node(id);
    if (n && n.passive) F.addMods(out, n.passive);
  }
  if (form) {
    if (form.mods) F.addMods(out, form.mods);
    else if (typeof form.flickerCostMult === 'number') out.flickerCostMult *= form.flickerCostMult;
    if (form.mult && typeof form.mult.surge === 'number') out.surgePct += form.mult.surge - 1;
  }
  return out;
}

/**
 * Derived ActorStats of the player (GDD 4.3) with gear, passives and Form, plus Resonance.
 * @param {any} p @param {any} inv @param {Lookup} look @param {any} form
 * @param {{ gatherSeconds?:number|null }} [opts] gatherSeconds: null when not Gathering
 * @returns {{ base:any, mods:Record<string, number>, stats:any }}
 */
export function deriveAll(p, inv, look, form, opts) {
  const base = effectiveBase(p, inv, look, { mgt: 0, spr: 0, vit: 0, swf: 0, def: 0 });
  const mods = collectMods(p, inv, look, form, F.createMods());
  const g = opts && typeof opts.gatherSeconds === 'number' ? F.gatherResMult(opts.gatherSeconds) : 1;
  const stats = F.derivePlayerStats(base, p.level, mods, form, { awakened: !!p.awakened, gatherMult: g });
  return { base, mods, stats };
}

/**
 * @param {any} inv @param {number|null|undefined} uid
 * @returns {any} the inventory row or null
 */
export function rowOf(inv, uid) {
  if (uid === null || uid === undefined) return null;
  const items = inv.items;
  for (let i = 0; i < items.length; i++) if (items[i].uid === uid) return items[i];
  return null;
}

/**
 * The rank of a technique: 0 when not known, else the highest owned node rank for it (at least 1).
 * @param {any} p @param {string} techId @param {(id:string)=>any} findNode
 */
export function techRank(p, techId, findNode) {
  if (p.techs.indexOf(techId) < 0) return 0;
  let r = 1;
  for (const id of p.nodes) {
    const n = findNode(id);
    if (n && n.techId === techId && typeof n.rank === 'number' && n.rank > r) r = n.rank;
  }
  return r;
}

/**
 * Technique-tree rows with their state. A node is available when its level, technique and node prerequisites hold
 * and the player has the TP; rank nodes also need the technique itself and the previous rank.
 * @param {any} p @param {any[]} nodeDefs
 * @returns {Array<{ id:string, branch:string, techId:string|null, rank:number, tp:number, state:'locked'|'available'|'owned', reasonKey:string|null }>}
 */
export function nodeRows(p, nodeDefs) {
  const out = [];
  for (const n of nodeDefs) {
    const owned = p.nodes.indexOf(n.id) >= 0;
    out.push({ id: n.id, branch: n.branch, techId: n.techId || null, rank: n.rank || 0, tp: n.tp || 0,
      state: owned ? 'owned' : 'locked', reasonKey: owned ? null : nodeBlock(p, n) });
    const row = out[out.length - 1];
    if (!owned && row.reasonKey === null) row.state = 'available';
  }
  return out;
}

/**
 * Why a node cannot be learned now (an i18n key), or null.
 * @param {any} p @param {any} n TechNodeDef
 * @returns {string|null}
 */
export function nodeBlock(p, n) {
  const rq = n.requires || {};
  if (typeof rq.level === 'number' && p.level < rq.level) return 'rpg.node.needLevel';
  if (rq.tech && p.techs.indexOf(rq.tech) < 0) return 'rpg.node.needTech';
  if (rq.node && p.nodes.indexOf(rq.node) < 0) return 'rpg.node.needNode';
  if (n.techId && typeof n.rank === 'number' && n.rank > 1 && p.techs.indexOf(n.techId) < 0) return 'rpg.node.needTech';
  if (p.tp < (n.tp || 0)) return 'rpg.node.needTp';
  return null;
}

/**
 * Learn a node: spends its TP and adds its technique.
 * @param {any} p @param {any} n TechNodeDef
 * @returns {boolean}
 */
export function learnNode(p, n) {
  if (!n || p.nodes.indexOf(n.id) >= 0 || nodeBlock(p, n) !== null) return false;
  p.tp -= n.tp || 0;
  p.nodes.push(n.id);
  if (n.techId && p.techs.indexOf(n.techId) < 0) p.techs.push(n.techId);
  return true;
}

/**
 * Validate and apply a loadout slot change.
 * @param {any} p @param {0|1|'ultimate'} index @param {string|null} techId @param {any} techDef
 * @returns {boolean}
 */
export function setSlot(p, index, techId, techDef) {
  if (index !== 0 && index !== 1 && index !== 'ultimate') return false;
  if (techId) {
    if (!techDef || p.techs.indexOf(techId) < 0) return false;
    if (index === 'ultimate' ? techDef.slot !== 'ultimate' : techDef.slot !== 'slot') return false;
  }
  if (index === 'ultimate') p.ultimate = techId || null;
  else {
    p.slots[index] = techId || null;
    if (techId && p.slots[1 - index] === techId) p.slots[1 - index] = null;
  }
  return true;
}
