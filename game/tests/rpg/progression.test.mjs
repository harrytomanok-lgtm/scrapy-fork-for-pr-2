import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../../src/core/store.js';
import { IDS } from '../../src/core/ids.js';
import { BALANCE } from '../../src/core/balance.js';
import * as F from '../../src/core/formulas.js';
import * as P from '../../src/rpg/logic/progression.js';
import * as I from '../../src/rpg/logic/inventory.js';
import { ITEMS } from '../../src/rpg/data/items.js';

const itemById = new Map(ITEMS.map((d) => [d.id, d]));
const NODES = [
  { id: 'iron_fists_1', branch: 'fist', tp: 1, passive: { meleePct: 0.06 } },
  { id: 'iron_fists_2', branch: 'fist', tp: 2, passive: { meleePct: 0.06 }, requires: { node: 'iron_fists_1' } },
  { id: 'nova_2', branch: 'flare', tp: 2, techId: 'nova_ring', rank: 2, requires: { level: 5 } },
  { id: 'deep_well_1', branch: 'spirit', tp: 2, passive: { oraPoolPct: 0.10 } },
];
const nodeById = new Map(NODES.map((n) => [n.id, n]));
const look = { item: (id) => itemById.get(id) || null, node: (id) => nodeById.get(id) || null };

test('XP: one grant can apply several level-ups without pause, with points by the style', () => {
  const s = defaultState();
  const p = s.player;
  const total = F.xpToNext(1) + F.xpToNext(2) + F.xpToNext(3) + F.xpToNext(4) + 7;
  const seen = [];
  const gained = P.addXp(p, total, (pp) => seen.push(pp.level));
  assert.equal(gained, 4);
  assert.deepEqual(seen, [2, 3, 4, 5]);
  assert.equal(p.level, 5);
  assert.equal(p.xp, 7);
  assert.equal(p.tp, 4);
  assert.equal(p.statPoints, 0, 'balanced spends every point');
  // balanced: mgt, spr, vit, swf repeating over 12 points
  assert.deepEqual(p.base, { mgt: 8, spr: 8, vit: 8, swf: 8 });
});

test('allocation styles: brawler, blaster, manual banks', () => {
  for (const [style, want] of [['brawler', { mgt: 13, spr: 5, vit: 9, swf: 5 }], ['blaster', { mgt: 5, spr: 13, vit: 5, swf: 9 }]]) {
    const p = defaultState().player;
    p.autoStyle = style;
    P.addXp(p, F.totalXpToLevel(5));
    assert.equal(p.level, 5);
    assert.deepEqual(p.base, want, style);
  }
  const p = defaultState().player;
  p.autoStyle = 'manual';
  P.addXp(p, F.totalXpToLevel(3));
  assert.equal(p.statPoints, 6);
  assert.ok(P.allocate(p, 'vit', 4));
  assert.equal(p.base.vit, 9);
  assert.equal(p.statPoints, 2);
  assert.equal(P.allocate(p, 'vit', 3), false, 'cannot overspend');
  assert.equal(P.allocate(p, 'luck', 1), false, 'unknown stat');
  assert.equal(P.spendBy(p, 'brawler'), 2);
});

test('the level cap stops XP', () => {
  const p = defaultState().player;
  P.setLevel(p, BALANCE.level.cap);
  assert.equal(P.addXp(p, 1e9), 0);
  assert.equal(p.xp, 0);
  assert.equal(p.statPoints, 0);
  assert.equal(p.base.mgt + p.base.spr + p.base.vit + p.base.swf, 20 + F.statPointsAt(BALANCE.level.cap));
});

test('stats with gear equal hand-computed values (GDD 4.3, 10.2)', () => {
  const s = defaultState();
  const p = s.player;
  const inv = s.inv;
  const none = P.deriveAll(p, inv, look, null);
  assert.equal(none.stats.hpMax, 196);
  assert.equal(none.stats.oraMax, 125);
  assert.equal(none.stats.meleeRating, 43);
  assert.equal(none.stats.defense, 11);
  assert.equal(none.stats.resonance, 0 + Math.round(40 * 20 * 1.1 * 0.2), 'not awakened: x0.2');
  p.awakened = true;
  assert.equal(P.deriveAll(p, inv, look, null).stats.resonance, 880, 'GDD 4.4: L1 = 880');

  // Training Wraps L1: +round(2 * 1.08) = +2 mgt. Meadow Garb L3: def round(8 * 1.24) = 10, vit round(2 * 1.24) = 2.
  const w = I.addItem(inv, itemById.get('training_wraps'), 1, 1).uid;
  const g = I.addItem(inv, itemById.get('meadow_garb'), 1, 3).uid;
  I.equip(inv, w, itemById.get('training_wraps'));
  I.equip(inv, g, itemById.get('meadow_garb'));
  const r = P.deriveAll(p, inv, look, null);
  assert.equal(r.base.mgt, 7);
  assert.equal(r.base.vit, 7);
  assert.equal(r.base.def, 10);
  assert.equal(r.stats.meleeRating, 20 + 4 * 7 + 3);
  assert.equal(r.stats.hpMax, 100 + 18 * 7 + 6);
  assert.equal(r.stats.defense, 2 * 7 + 1 + 10);
  assert.equal(r.stats.resonance, Math.round(40 * 24 * 1.1));

  // Charms: Wyrmhide +8% HP; Lanterned Mantle +5% RES.
  const c = I.addItem(inv, itemById.get('wyrmhide_charm'), 1, 1).uid;
  I.equip(inv, c, itemById.get('wyrmhide_charm'));
  const m = I.addItem(inv, itemById.get('lantern_mantle'), 1, 0).uid;
  I.equip(inv, m, itemById.get('lantern_mantle'));
  const r2 = P.deriveAll(p, inv, look, null);
  // The mantle is garb: it replaced the Meadow Garb, so vit is back to 5.
  assert.equal(inv.equip.garb, m);
  assert.equal(r2.stats.hpMax, Math.round((100 + 18 * 5 + 6) * 1.08));
  assert.equal(r2.mods.resPct, 0.05);
  assert.equal(r2.base.spr, 5 + 5, 'mantle L0: +5 spr');
});

test('Resonance examples of GDD 4.4 and the Form multipliers', () => {
  const base = (sum) => ({ mgt: sum / 4, spr: sum / 4, vit: sum / 4, swf: sum / 4 });
  assert.equal(F.resonance(base(47 + 0), 10, null), 3760);
  assert.equal(F.resonance(base(107 + 1), 30, null) > 0, true);
  const L30 = { mgt: 27, spr: 27, vit: 27, swf: 26 };
  assert.equal(F.resonance(L30, 30, null), 17120);
  assert.equal(F.resonance(L30, 30, null, F.formResMult('tempest')), 42800);
  assert.equal(F.resonance(L30, 30, null, F.formResMult('zenith')), 102720);
  const p = defaultState().player;
  p.awakened = true;
  const form = { mult: { dmg: 1.25, def: 1.1, speed: 1.1, res: 1.5, surge: 1 }, mods: { flickerCostMult: 1 } };
  const r = P.deriveAll(p, defaultState().inv, look, form);
  assert.equal(r.stats.resonance, 1320);
  assert.equal(r.stats.dmgMult, 1.25);
  assert.equal(r.stats.defMult, 1.1);
});

test('passives and Forms fold into the closed mods set; every modifier key is in IDS.modKey', () => {
  const s = defaultState();
  s.player.nodes.push('iron_fists_1', 'iron_fists_2', 'deep_well_1');
  const mods = P.collectMods(s.player, s.inv, look, { mods: { flickerCostMult: 0.5 }, mult: { surge: 1.1 } }, F.createMods());
  assert.ok(Math.abs(mods.meleePct - 0.12) < 1e-9);
  assert.equal(mods.oraPoolPct, 0.10);
  assert.equal(mods.flickerCostMult, 0.5);
  assert.ok(Math.abs(mods.surgePct - 0.1) < 1e-9);
  for (const k of Object.keys(mods)) assert.ok(IDS.modKey.includes(k), k);
  for (const d of ITEMS) for (const k of Object.keys(d.mods || {})) assert.ok(IDS.modKey.includes(k), d.id + '.' + k);
  for (const id of Object.keys(BALANCE.passives)) for (const r of BALANCE.passives[id].ranks) for (const k of Object.keys(r.mods)) assert.ok(IDS.modKey.includes(k));
  for (const id of Object.keys(BALANCE.forms)) for (const k of Object.keys(BALANCE.forms[id].mods || {})) assert.ok(IDS.modKey.includes(k));
});

test('a stat recompute never changes hp or ora (they are returned at max and kept by the service)', () => {
  const s = defaultState();
  const r1 = P.deriveAll(s.player, s.inv, look, null);
  assert.equal(r1.stats.hp, r1.stats.hpMax);
  // The service copies every key except hp and ora: emulate it.
  const live = Object.assign({}, r1.stats, { hp: 50, ora: 10 });
  s.player.base.vit += 3;
  const r2 = P.deriveAll(s.player, s.inv, look, null);
  for (const k in r2.stats) if (k !== 'hp' && k !== 'ora') live[k] = r2.stats[k];
  assert.equal(live.hp, 50);
  assert.equal(live.ora, 10);
  assert.ok(live.hpMax > r1.stats.hpMax);
});

test('technique nodes: prerequisites, TP and ranks; TP accounting reaches 55', () => {
  const p = defaultState().player;
  const rows = () => Object.fromEntries(P.nodeRows(p, NODES).map((r) => [r.id, r]));
  assert.equal(rows().iron_fists_1.reasonKey, 'rpg.node.needTp');
  p.tp = 10;
  assert.equal(rows().iron_fists_1.state, 'available');
  assert.equal(rows().iron_fists_2.reasonKey, 'rpg.node.needNode');
  assert.equal(rows().nova_2.reasonKey, 'rpg.node.needLevel');
  assert.ok(P.learnNode(p, nodeById.get('iron_fists_1')));
  assert.equal(p.tp, 9);
  assert.equal(rows().iron_fists_1.state, 'owned');
  assert.equal(P.learnNode(p, nodeById.get('iron_fists_1')), false, 'no double learn');
  p.level = 5;
  assert.equal(rows().nova_2.reasonKey, 'rpg.node.needTech', 'rank 2 needs the technique');
  p.techs.push('nova_ring');
  assert.equal(P.techRank(p, 'nova_ring', look.node), 1);
  assert.ok(P.learnNode(p, nodeById.get('nova_2')));
  assert.equal(P.techRank(p, 'nova_ring', look.node), 2);
  assert.equal(P.techRank(p, 'dawn_lance', look.node), 0);
  // GDD 4.5: 39 from levels + 10 shrines + 6 from main quests = 55.
  let mq = 0;
  for (const id of ['mq1', 'mq2', 'mq3', 'mq4', 'mq5', 'mq6', 'mq7']) mq += BALANCE.quests[id].tp;
  assert.equal((BALANCE.level.cap - 1) * BALANCE.level.tpPerLevel + BALANCE.tp.shrines * BALANCE.tp.shrineTp + mq, 55);
});

test('loadout slots accept only known techniques of the right slot kind', () => {
  const p = defaultState().player;
  const nova = { id: 'nova_ring', slot: 'slot' };
  const ring = { id: 'ringfall', slot: 'ultimate' };
  assert.equal(P.setSlot(p, 0, 'nova_ring', nova), false, 'not known');
  p.techs.push('nova_ring', 'ringfall');
  assert.ok(P.setSlot(p, 0, 'nova_ring', nova));
  assert.ok(P.setSlot(p, 1, 'nova_ring', nova));
  assert.deepEqual(p.slots, [null, 'nova_ring'], 'moving a technique clears its old slot');
  assert.equal(P.setSlot(p, 0, 'ringfall', ring), false);
  assert.ok(P.setSlot(p, 'ultimate', 'ringfall', ring));
  assert.equal(p.ultimate, 'ringfall');
  assert.equal(P.setSlot(p, 2, null, null), false);
});
