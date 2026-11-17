/**
 * Inventory, equipment, prices and shops (ARCHITECTURE 4.11, GDD 10). Pure: works on `store.inv` and item defs.
 * Stackables (consumables, quest items) share one row per item id and respect the carry cap; every gear piece is
 * its own row with an item level.
 * @module rpg/logic/inventory
 */

import { BALANCE } from '../../core/balance.js';
import * as F from '../../core/formulas.js';
import { EQUIP_SLOTS, rowOf } from './progression.js';

/** @param {any} inv @param {string} itemId @returns {number} */
export function countOf(inv, itemId) {
  let n = 0;
  for (const r of inv.items) if (r.itemId === itemId) n += r.count;
  return n;
}

/** @param {any} inv @param {number} uid @returns {string|null} the slot holding uid */
export function slotOf(inv, uid) {
  const eq = inv.equip;
  for (const s of EQUIP_SLOTS) if (eq[s] === uid) return s;
  return null;
}

/** @param {any} def ItemDef @returns {number} the carry cap of a stackable */
export function capOf(def) {
  return typeof def.cap === 'number' ? def.cap : BALANCE.economy.carryCap;
}

/**
 * Add items. Gear: one row per piece at `level`. Stackables: one shared row, clamped to the cap.
 * @param {any} inv @param {any} def ItemDef @param {number} count @param {number} level
 * @returns {{ uid:number, added:number }} uid 0 when nothing was added
 */
export function addItem(inv, def, count, level) {
  const n = Math.max(1, Math.floor(count || 1));
  if (def.type !== 'gear') {
    let row = null;
    for (const r of inv.items) if (r.itemId === def.id) row = r;
    const add = Math.min(n, capOf(def) - (row ? row.count : 0));
    if (add <= 0) return { uid: 0, added: 0 };
    if (!row) {
      row = { uid: inv.nextUid++, itemId: def.id, level: 1, count: 0 };
      inv.items.push(row);
    }
    row.count += add;
    return { uid: row.uid, added: add };
  }
  let uid = 0;
  const lv = Math.max(1, Math.round(level || 1));
  for (let i = 0; i < n; i++) {
    uid = inv.nextUid++;
    inv.items.push({ uid, itemId: def.id, level: lv, count: 1 });
  }
  return { uid, added: n };
}

/**
 * Remove `count` of an item (newest rows first). Removed rows are unequipped first.
 * @param {any} inv @param {string} itemId @param {number} count
 * @param {(row:any, taken:number)=>void} [onRow]
 * @returns {boolean} false (and nothing removed) when the inventory holds fewer
 */
export function removeItem(inv, itemId, count, onRow) {
  const n = Math.max(1, Math.floor(count || 1));
  if (countOf(inv, itemId) < n) return false;
  let left = n;
  for (let i = inv.items.length - 1; i >= 0 && left > 0; i--) {
    const r = inv.items[i];
    if (r.itemId !== itemId) continue;
    const take = Math.min(left, r.count);
    r.count -= take;
    left -= take;
    if (r.count <= 0) {
      const s = slotOf(inv, r.uid);
      if (s) inv.equip[s] = null;
      inv.items.splice(i, 1);
    }
    if (onRow) onRow(r, take);
  }
  return true;
}

/**
 * Equip a gear row. Charms fill charm1, then charm2, then replace charm1. Returns the slot used, or null.
 * @param {any} inv @param {number} uid @param {any} def
 * @returns {string|null}
 */
export function equip(inv, uid, def) {
  const row = rowOf(inv, uid);
  if (!row || !def || def.type !== 'gear' || !def.slot) return null;
  const eq = inv.equip;
  let slot = def.slot;
  if (slot === 'charm') {
    if (eq.charm1 === uid || eq.charm2 === uid) slot = eq.charm1 === uid ? 'charm1' : 'charm2';
    else slot = eq.charm1 === null ? 'charm1' : eq.charm2 === null ? 'charm2' : 'charm1';
  }
  for (const s of EQUIP_SLOTS) if (eq[s] === uid && s !== slot) eq[s] = null;
  eq[slot] = uid;
  return slot;
}

/** @param {any} inv @param {string} slot @returns {boolean} */
export function unequip(inv, slot) {
  if (EQUIP_SLOTS.indexOf(slot) < 0 || inv.equip[slot] === null) return false;
  inv.equip[slot] = null;
  return true;
}

/**
 * Buy price of one item: gear by rarity and item level (GDD 10.2), consumables by player level (10.3),
 * times the shop multiplier.
 * @param {any} def @param {number} itemLevel @param {number} playerLevel @param {number} [priceMult=1]
 */
export function buyPrice(def, itemLevel, playerLevel, priceMult = 1) {
  let p;
  if (def.type === 'gear') p = F.itemPrice(def.rarity || 'common', itemLevel);
  else if (typeof def.basePrice === 'number') p = def.basePrice + (def.pricePerLevel || 0) * playerLevel;
  else p = F.consumablePrice(def.id, playerLevel);
  return Math.round(p * priceMult);
}

/**
 * Sell value of `n` of a row (25% of the full buy price; quest items cannot be sold).
 * @param {any} def @param {any} row @param {number} playerLevel @param {number} n
 */
export function sellValue(def, row, playerLevel, n) {
  if (!def || def.type === 'quest') return 0;
  return F.sellPrice(buyPrice(def, row.level, playerLevel, 1)) * n;
}

/**
 * Shop rows (GDD 10.4): gear at the shop level, consumables priced by player level.
 * @param {any} shop ShopDef @param {(id:string)=>any} findItem @param {number} playerLevel @param {number} shells
 */
export function shopRows(shop, findItem, playerLevel, shells) {
  const out = [];
  for (let index = 0; index < shop.stock.length; index++) {
    const itemId = shop.stock[index];
    const def = findItem(itemId);
    if (!def) continue;
    const level = def.type === 'gear' ? shop.level : 1;
    const price = buyPrice(def, level, playerLevel, shop.priceMult || 1);
    out.push({ index, itemId, level, price, canAfford: shells >= price });
  }
  return out;
}

/**
 * Scaled item effects for display and comparison.
 * @param {any} def @param {any} row
 */
export function itemStats(def, row) {
  const stats = {};
  if (def.stats) for (const k of Object.keys(def.stats)) stats[k] = F.itemValue(def.stats[k], row.level);
  return { itemId: def.id, level: row.level, slot: def.slot || null, rarity: def.rarity || null, stats,
    mods: Object.assign({}, def.mods || {}), effect: def.effect ? Object.assign({}, def.effect) : null };
}
