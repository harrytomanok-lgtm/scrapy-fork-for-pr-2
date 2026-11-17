import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../../src/core/store.js';
import { BALANCE } from '../../src/core/balance.js';
import { createStream } from '../../src/core/rng.js';
import * as I from '../../src/rpg/logic/inventory.js';
import { gearPool, rollLoot, pickRarity, SUNFRUIT_SHARE } from '../../src/rpg/logic/loot.js';
import { ITEMS, SHOPS, LOOT_TABLES } from '../../src/rpg/data/items.js';

const item = (id) => ITEMS.find((d) => d.id === id);

test('stackables share a row and respect the carry cap; gear rows are one per piece', () => {
  const inv = defaultState().inv;
  const a = I.addItem(inv, item('sunfruit'), 3, 1);
  const b = I.addItem(inv, item('sunfruit'), 4, 1);
  assert.equal(a.uid, b.uid);
  assert.equal(b.added, 2, 'clamped to the cap of 5');
  assert.equal(I.countOf(inv, 'sunfruit'), BALANCE.economy.carryCap);
  assert.deepEqual(I.addItem(inv, item('sunfruit'), 1, 1), { uid: 0, added: 0 });
  const g1 = I.addItem(inv, item('training_wraps'), 1, 2);
  const g2 = I.addItem(inv, item('training_wraps'), 1, 4);
  assert.notEqual(g1.uid, g2.uid);
  assert.equal(I.countOf(inv, 'training_wraps'), 2);
  assert.ok(I.removeItem(inv, 'sunfruit', 2));
  assert.equal(I.countOf(inv, 'sunfruit'), 3);
  assert.equal(I.removeItem(inv, 'sunfruit', 9), false, 'nothing removed when short');
  assert.equal(I.countOf(inv, 'sunfruit'), 3);
  assert.ok(I.removeItem(inv, 'sunfruit', 3));
  assert.equal(inv.items.filter((r) => r.itemId === 'sunfruit').length, 0, 'empty rows are dropped');
});

test('equip swaps by slot; charms fill both charm slots; removing an equipped item unequips it', () => {
  const inv = defaultState().inv;
  const w1 = I.addItem(inv, item('training_wraps'), 1, 1).uid;
  const w2 = I.addItem(inv, item('copper_knuckles'), 1, 1).uid;
  assert.equal(I.equip(inv, w1, item('training_wraps')), 'wraps');
  assert.equal(I.equip(inv, w2, item('copper_knuckles')), 'wraps');
  assert.equal(inv.equip.wraps, w2);
  const c1 = I.addItem(inv, item('ember_charm'), 1, 1).uid;
  const c2 = I.addItem(inv, item('tide_charm'), 1, 1).uid;
  const c3 = I.addItem(inv, item('frost_charm'), 1, 1).uid;
  assert.equal(I.equip(inv, c1, item('ember_charm')), 'charm1');
  assert.equal(I.equip(inv, c2, item('tide_charm')), 'charm2');
  assert.equal(I.equip(inv, c3, item('frost_charm')), 'charm1', 'both full: replaces charm1');
  assert.equal(I.equip(inv, c2, item('tide_charm')), 'charm2', 're-equipping keeps its slot');
  assert.equal(I.equip(inv, 999, item('tide_charm')), null);
  const s = I.addItem(inv, item('sunfruit'), 1, 1).uid;
  assert.equal(I.equip(inv, s, item('sunfruit')), null, 'consumables are not equipment');
  assert.ok(I.removeItem(inv, 'copper_knuckles', 1));
  assert.equal(inv.equip.wraps, null);
  assert.ok(I.unequip(inv, 'charm1'));
  assert.equal(I.unequip(inv, 'charm1'), false);
});

test('item level scaling and prices (GDD 10.2, 10.3, 10.4)', () => {
  const inv = defaultState().inv;
  const uid = I.addItem(inv, item('meadow_garb'), 1, 3).uid;
  const row = inv.items.find((r) => r.uid === uid);
  const st = I.itemStats(item('meadow_garb'), row);
  assert.deepEqual(st.stats, { def: Math.round(8 * 1.24), vit: Math.round(2 * 1.24) });
  assert.equal(I.buyPrice(item('meadow_garb'), 3, 1), Math.round(40 * 2.5 * 1.45));
  assert.equal(I.buyPrice(item('sunfruit'), 1, 7), 30 + 2 * 7);
  assert.equal(I.buyPrice(item('ora_draught'), 1, 10, 0.8), Math.round((45 + 30) * 0.8), "Talia's -20%");
  assert.equal(I.sellValue(item('meadow_garb'), row, 1, 1), Math.floor(Math.round(40 * 2.5 * 1.45) * 0.25));
  assert.equal(I.sellValue(item('rust_core'), { level: 1 }, 1, 1), 0, 'quest items cannot be sold');
  const dov = SHOPS.find((s) => s.id === 'dov_stall');
  const rows = I.shopRows(dov, item, 5, 40);
  assert.deepEqual(rows.map((r) => r.itemId), ['sunfruit', 'ora_draught', 'apprentice_garb', 'meadow_garb', 'sunfruit_charm']);
  assert.equal(rows[0].price, 40);
  assert.equal(rows[0].canAfford, true);
  assert.equal(rows[3].level, 3, 'gear at the shop level');
  assert.equal(rows[3].canAfford, false);
});

test('loot: 10,000 seeded rolls match the table within 2%', () => {
  const pool = gearPool(ITEMS);
  const rng = createStream(12345);
  for (const id of ['grunt', 'elite', 'chest_t1', 'chest_t2']) {
    const t = LOOT_TABLES.find((x) => x.id === id);
    const N = 10000;
    let gear = 0;
    let cons = 0;
    let sun = 0;
    const rar = { common: 0, fine: 0, rare: 0 };
    let shellMin = Infinity;
    let shellMax = -Infinity;
    const out = [];
    for (let i = 0; i < N; i++) {
      rollLoot(t, 5, rng, pool, {}, out);
      let hadCons = false;
      for (const r of out) {
        if (r.kind === 'shells') { shellMin = Math.min(shellMin, r.count); shellMax = Math.max(shellMax, r.count); }
        else if (r.itemId === 'sunfruit' || r.itemId === 'ora_draught') { hadCons = true; if (r.itemId === 'sunfruit') sun++; }
        else { gear++; rar[r.rarity]++; assert.ok(item(r.itemId).drops, 'quest-only gear never drops: ' + r.itemId); }
      }
      if (hadCons) cons++;
    }
    assert.ok(Math.abs(cons / N - t.consumable) < 0.02, id + ' consumable rate ' + cons / N);
    assert.ok(Math.abs(gear / N - t.gear.chance) < 0.02, id + ' gear rate ' + gear / N);
    const wt = t.gear.weights.common + t.gear.weights.fine + t.gear.weights.rare;
    for (const k of ['common', 'fine', 'rare']) {
      assert.ok(Math.abs(rar[k] / Math.max(1, gear) - t.gear.weights[k] / wt) < 0.05, id + ' rarity ' + k);
    }
    if (typeof t.shells.min === 'number') {
      assert.equal(shellMin, t.shells.min);
      assert.equal(shellMax, t.shells.max);
    }
    if (cons > 500) assert.ok(Math.abs(sun / cons - SUNFRUIT_SHARE) < 0.03);
  }
});

test('loot: boss table pays perIndex x index and two consumables; rarity picking', () => {
  const t = LOOT_TABLES.find((x) => x.id === 'boss');
  const out = rollLoot(t, 12, createStream(1), gearPool(ITEMS), { bossIndex: 2 });
  assert.equal(out[0].kind, 'shells');
  assert.equal(out[0].count, 1000);
  assert.equal(out.filter((r) => r.kind === 'item').length, 2);
  assert.equal(pickRarity({ common: 70, fine: 27, rare: 3 }, 0), 'common');
  assert.equal(pickRarity({ common: 70, fine: 27, rare: 3 }, 0.71), 'fine');
  assert.equal(pickRarity({ common: 70, fine: 27, rare: 3 }, 0.99), 'rare');
  assert.equal(pickRarity({ common: 0, fine: 60, rare: 40 }, 0), 'fine');
});
