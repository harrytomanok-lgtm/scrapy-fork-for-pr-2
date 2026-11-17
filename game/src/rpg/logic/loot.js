/**
 * Loot rolls (ARCHITECTURE 5.10, GDD 10.5). Pure: the caller passes the table, a random stream with `next()`
 * (rng.sim in the game, a seeded stream in tests) and the gear pool. Dropped gear is picked by slot first, then by
 * item, so every slot is equally likely whatever the number of items per slot.
 * @module rpg/logic/loot
 */

import * as F from '../../core/formulas.js';

/** Share of Sunfruit among dropped consumables (the rest are Ora Draughts). */
export const SUNFRUIT_SHARE = 0.65;
const SLOT_ORDER = Object.freeze(['wraps', 'garb', 'charm']);

/**
 * Gear pool by rarity and slot, built once from item defs: only `drops: true` gear.
 * @param {any[]} items ItemDef list
 * @returns {Record<string, Record<string, string[]>>}
 */
export function gearPool(items) {
  const pool = { common: {}, fine: {}, rare: {} };
  for (const d of items) {
    if (d.type !== 'gear' || !d.drops || !pool[d.rarity]) continue;
    (pool[d.rarity][d.slot] || (pool[d.rarity][d.slot] = [])).push(d.id);
  }
  return pool;
}

/**
 * Pick a rarity from weights with one uniform draw.
 * @param {{ common:number, fine:number, rare:number }} w @param {number} u in [0, 1)
 */
export function pickRarity(w, u) {
  const total = (w.common || 0) + (w.fine || 0) + (w.rare || 0);
  let x = u * total;
  if (x < (w.common || 0)) return 'common';
  x -= w.common || 0;
  return x < (w.fine || 0) ? 'fine' : 'rare';
}

/**
 * Roll a loot table.
 * @param {any} table LootTableDef
 * @param {number} level enemy or region level (dropped gear gets it)
 * @param {{ next():number }} rng
 * @param {Record<string, Record<string, string[]>>} pool from gearPool
 * @param {{ difficulty?:string, source?:any, bossIndex?:number }} [opts] source: the enemy def (its shell mult)
 * @param {Array<{ kind:'shells'|'item', itemId:string|null, count:number, level:number, rarity:string|null }>} [out]
 */
export function rollLoot(table, level, rng, pool, opts, out = []) {
  out.length = 0;
  if (!table) return out;
  const o = opts || {};
  const diff = o.difficulty || 'warrior';
  const s = table.shells || {};
  if (typeof s.min === 'number') {
    out.push({ kind: 'shells', itemId: null, count: s.min + Math.floor(rng.next() * (s.max - s.min + 1)), level, rarity: null });
  } else if (typeof s.perIndex === 'number') {
    out.push({ kind: 'shells', itemId: null, count: Math.round(s.perIndex * Math.max(1, o.bossIndex || 1) * F.difficultyRow(diff).reward), level, rarity: null });
  } else if (typeof s.chance === 'number' && rng.next() < s.chance) {
    const n = Math.round(F.enemyShells(o.source || null, level, diff) * (s.mult || 1));
    if (n > 0) out.push({ kind: 'shells', itemId: null, count: n, level, rarity: null });
  }
  if (table.consumable > 0 && rng.next() < table.consumable) {
    const k = typeof table.consumableCount === 'number' ? table.consumableCount : 1;
    for (let i = 0; i < k; i++) {
      out.push({ kind: 'item', itemId: rng.next() < SUNFRUIT_SHARE ? 'sunfruit' : 'ora_draught', count: 1, level: 1, rarity: 'common' });
    }
  }
  const g = table.gear;
  if (g && g.chance > 0 && rng.next() < g.chance) {
    const rarity = pickRarity(g.weights, rng.next());
    const bySlot = pool[rarity] || {};
    let slots = 0;
    for (const sl of SLOT_ORDER) if (bySlot[sl] && bySlot[sl].length) slots++;
    if (slots > 0) {
      let k = Math.floor(rng.next() * slots);
      for (const sl of SLOT_ORDER) {
        const list = bySlot[sl];
        if (!list || !list.length) continue;
        if (k-- === 0) {
          out.push({ kind: 'item', itemId: list[Math.floor(rng.next() * list.length)], count: 1, level: Math.max(1, Math.round(level)), rarity });
          break;
        }
      }
    }
  }
  return out;
}
