import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../../src/core/balance.js';
import * as F from '../../src/core/formulas.js';

const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` ${a} != ${b}`);
const BASE5 = { mgt: 5, spr: 5, vit: 5, swf: 5 };

/** Base stats at a level with every point applied by an allocation style. */
function allocated(level, style = 'balanced') {
  const b = { ...BASE5 };
  for (let i = 0; i < F.statPointsAt(level); i++) b[F.styleStat(style, i)]++;
  return b;
}

test('xpToNext matches the GDD 4.1 values', () => {
  assert.equal(F.xpToNext(1), 100);
  assert.equal(F.xpToNext(5), 871);
  assert.equal(F.xpToNext(10), 2297);
  assert.equal(F.xpToNext(20), 6167);
  assert.equal(F.xpToNext(26), 8994);
  assert.equal(F.totalXpToLevel(1), 0);
  assert.equal(F.totalXpToLevel(3), 100 + 250);
  assert.equal(F.statPointsAt(1), 0);
  assert.equal(F.statPointsAt(10), 27);
});

test('allocation styles (GDD 4.2)', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => F.styleStat('balanced', i)), ['mgt', 'spr', 'vit', 'swf', 'mgt']);
  assert.deepEqual([0, 1, 2, 3].map((i) => F.styleStat('brawler', i)), ['mgt', 'mgt', 'vit', 'mgt']);
  assert.deepEqual([0, 1, 2].map((i) => F.styleStat('blaster', i)), ['spr', 'spr', 'swf']);
  assert.equal(F.styleStat('manual', 0), null);
});

test('derived values at L1 with all stats 5 (GDD 4.3 table)', () => {
  const s = F.derivePlayerStats(BASE5, 1, null, null);
  assert.equal(s.hpMax, 196);
  assert.equal(s.hp, 196);
  assert.equal(s.oraMax, 125);
  near(F.oraRegen(5, null, {}), 3.25);
  near(F.gatherRate(5, null), 40);
  assert.equal(s.meleeRating, 43);
  assert.equal(s.oraRating, 43);
  assert.equal(s.defense, 11);
  near(s.critChance, 0.065);
  near(s.runSpeed, 9.2);
  near(s.runSpeed * BALANCE.derived.run.sprintMult, 14.72);
  near(s.flySpeed, 31);
  near(s.boostSpeed, 79);
  near(s.boostSpeed * BALANCE.derived.boost.sonicMult, 118.5);
  near(s.cdr, 0.02);
  assert.deepEqual([s.dmgMult, s.defMult, s.speedMult], [1, 1, 1]);
  assert.equal(s.resonance, 880);
  for (const k of ['hp', 'hpMax', 'ora', 'oraMax', 'meleeRating', 'oraRating', 'defense', 'critChance', 'poise', 'poiseMax', 'resonance',
    'runSpeed', 'flySpeed', 'boostSpeed', 'cdr', 'dmgMult', 'defMult', 'speedMult']) assert.ok(k in s, 'ActorStats.' + k);
});

test('derived values: caps, gear defense and modifiers', () => {
  const big = { mgt: 5, spr: 5, vit: 5, swf: 500 };
  const s = F.derivePlayerStats(big, 40, null, null);
  assert.equal(s.runSpeed, 12);
  assert.equal(s.flySpeed, 42);
  assert.equal(s.boostSpeed, 120);
  assert.equal(s.cdr, 0.30);
  assert.equal(s.critChance, 0.35);
  const mods = F.addMods(F.createMods(), { hpPct: 0.08, oraPoolPct: 0.10, critAdd: 0.03, boostSpeedPct: 0.05 });
  F.addMods(mods, { oraPoolPct: 0.10 });
  const g = F.derivePlayerStats({ ...BASE5, def: 8 }, 1, mods, null);
  assert.equal(g.hpMax, Math.round(196 * 1.08));
  assert.equal(g.oraMax, Math.round(125 * 1.2));
  assert.equal(g.defense, 19);
  near(g.critChance, 0.095);
  near(g.boostSpeed, 79 * 1.05);
  assert.equal(F.oraMax(5, { oraPoolPct: 0.1 }), 138);
  assert.equal(F.hpMax(5, 1), 196);
});

test('Form multipliers enter the stats exactly once', () => {
  const ember = { mult: BALANCE.forms.ember.mult };
  const s = F.derivePlayerStats(BASE5, 1, null, ember);
  assert.deepEqual([s.dmgMult, s.defMult, s.speedMult], [1.25, 1.10, 1.10]);
  assert.equal(s.resonance, 1320);
  assert.equal(s.runSpeed, 9.2, 'speeds stay unscaled; move multiplies by stats.speedMult');
  const base = F.damage(1, 100, 0, 1, 1, 1, 1, 1);
  assert.equal(F.damage(1, 100, 0, s.dmgMult, 1, 1, 1, 1), Math.round(base * 1.25), 'a hit in Ember is the base hit x 1.25');
});

test('Resonance examples of GDD 4.4', () => {
  assert.equal(F.resonance(BASE5, 1, null), 880);
  assert.equal(F.resonance(BASE5, 1, null, 1, 1, false), 176, 'before the Ora Awakening');
  const l10 = { mgt: 12, spr: 12, vit: 12, swf: 11 };
  assert.equal(l10.mgt + l10.spr + l10.vit + l10.swf, 47);
  assert.equal(F.resonance(l10, 10, null), 3760);
  const l30 = { mgt: 27, spr: 27, vit: 27, swf: 26 };
  assert.equal(F.resonance(l30, 30, null), 17120);
  assert.equal(F.resonance(l30, 30, null, F.formResMult('tempest')), 42800);
  assert.equal(F.resonance(l30, 30, null, F.formResMult('zenith')), 102720);
  assert.equal(F.formResMult(null), 1);
  assert.equal(F.formResMult('ember'), 1.5);
  near(F.gatherResMult(0), 1);
  near(F.gatherResMult(0.5), 1.075);
  near(F.gatherResMult(3), 1.15);
  assert.equal(F.resonance(BASE5, 1, { resPct: 0.05 }), 924);
  assert.equal(F.resonance(BASE5, 1, null, 1, 1.15), 1012);
  assert.equal(F.derivePlayerStats(BASE5, 1, null, null, { awakened: false }).resonance, 176);
});

test('enemy Resonance, tint and milestones (GDD 4.4)', () => {
  assert.equal(F.enemyResonance(1, 'grunt'), 880);
  assert.equal(F.enemyResonance(10, 'grunt'), Math.round(40 * 47 * 2));
  assert.equal(F.enemyResonance(10, 'heavy'), Math.round(40 * 47 * 2 * 1.5));
  assert.equal(F.enemyResonance(26, 'boss'), Math.round(40 * (20 + 75) * 3.6 * 4));
  assert.equal(F.resonanceTint(400, 1000), 'grey');
  assert.equal(F.resonanceTint(1000, 1000), 'white');
  assert.equal(F.resonanceTint(1400, 1000), 'amber');
  assert.equal(F.resonanceTint(2100, 1000), 'danger');
  assert.equal(F.resonanceMilestone(880, 1012), 1000);
  assert.equal(F.resonanceMilestone(4000, 26000), 25000);
  assert.equal(F.resonanceMilestone(1000, 1200), null);
});

test('enemy scaling of GDD 7.1', () => {
  assert.deepEqual([1, 10, 20, 30].map((L) => F.enemyHp(1, L)), [87, 220, 415, 660]);
  assert.equal(F.enemyAtk(1, 1), 12.5);
  assert.equal(F.enemyAtk(1.5, 10), 66);
  assert.equal(F.enemyDefense(1, 10), 20);
  assert.equal(F.enemyHp(1, 10, 'story'), Math.round(220 * 0.75));
  assert.equal(F.enemyHp(1, 10, 'master'), Math.round(220 * 1.25));
  const boar = { tier: 'grunt', mult: BALANCE.enemies.tusk_boar.mult, poise: BALANCE.enemies.tusk_boar.poise };
  const s = F.enemyStats(boar, 5);
  assert.equal(s.hpMax, 141, 'round(75 + 12*5 + 0.25*25)');
  assert.equal(s.hp, 141);
  assert.equal(s.meleeRating, 26.5);
  assert.equal(s.oraRating, 26.5);
  assert.equal(s.defense, 10);
  assert.equal(s.poise, 20);
  assert.equal(s.poiseMax, 20);
  assert.equal(s.resonance, F.enemyResonance(5, 'grunt'));
  const b = BALANCE.bosses.bramblehorn;
  const boss = F.enemyStats({ tier: 'boss', mult: { hp: 1, atk: 1, def: 1 }, poise: 0 }, b.level, 'warrior', { hpMult: b.hpMult, poise: b.poise });
  assert.equal(boss.hpMax, F.enemyHp(b.hpMult, 12));
  assert.equal(boss.poise, 200);
  assert.equal(F.enemyShells({ mult: { shells: 1 } }, 10), 15);
  assert.equal(F.enemyShells({ mult: { shells: 1.2 } }, 10, 'master'), Math.round(15 * 1.2 * 1.2));
});

test('enemy XP and its level-difference factors (GDD 4.1)', () => {
  const def = { mult: { xp: 1 } };
  assert.equal(F.enemyXp(def, 5, 5), Math.round(12 * Math.pow(5, 1.3)));
  assert.equal(F.enemyXp(def, 1, 1), 12);
  assert.equal(F.xpLevelFactor(10, 14), 1);
  assert.equal(F.xpLevelFactor(10, 15), 0.5);
  assert.equal(F.xpLevelFactor(10, 17), 0.5);
  assert.equal(F.xpLevelFactor(10, 18), 0.25);
  assert.equal(F.xpLevelFactor(14, 10), 1.5);
  assert.equal(F.xpLevelFactor(13, 10), 1);
  assert.equal(F.enemyXp(def, 10, 18), Math.round(12 * Math.pow(10, 1.3) * 0.25));
  assert.equal(F.enemyXp({ mult: { xp: 6 } }, 4, 4), Math.round(12 * Math.pow(4, 1.3) * 6), 'bosses use xpMult 6');
  assert.equal(F.enemyXp(def, 5, 5, 'master'), Math.round(12 * Math.pow(5, 1.3) * 1.2));
});

test('bonus XP shares (GDD 4.1)', () => {
  assert.equal(F.bonusXp('siphon', 10), Math.round(0.15 * 2297));
  assert.equal(F.bonusXp('camp', 10), Math.round(0.10 * 2297));
  assert.equal(F.bonusXp('campRefill', 10), Math.round(0.03 * 2297));
});

test('damage rule of GDD 5.2', () => {
  assert.equal(F.damage(0.30, 43, 2, 1, 1, 1, 1, 1), Math.round(0.30 * 43 * 100 / 102));
  assert.equal(F.damage(1, 100, 100, 1, 1, 1.5, 1, 1), 75);
  assert.equal(F.damage(1, 100, 0, 1, 1.25, 1, 1, 1), 80);
  assert.equal(F.damage(1, 100, 0, 1, 1, 1, 0.95, 1), 95);
  assert.equal(F.damage(1, 100, 0, 1, 1, 1, 1.05, 1.4), 147);
  assert.equal(F.damage(0.0001, 10, 500, 1, 1, 1, 1, 1), 1, 'minimum 1');
  assert.equal(F.damage(1, 100, 0, 1, 10, 1, 1, 1), 10, 'closed Siphon core takes 10%');
});

test('charge, falloff and Ringfall shape (GDD 5.2, 5.3)', () => {
  const c = BALANCE.tech.dawn_lance.charge;
  assert.equal(F.chargeMult(0.3, c.min, c.max, c.maxMult), 1);
  assert.equal(F.chargeMult(0.5, c.min, c.max, c.maxMult), 1);
  near(F.chargeMult(1.25, c.min, c.max, c.maxMult), 1.75);
  assert.equal(F.chargeMult(2.0, c.min, c.max, c.maxMult), 2.5);
  assert.equal(F.chargeMult(5, c.min, c.max, c.maxMult), 2.5);
  const br = BALANCE.tech.breaker;
  near(br.power * F.chargeMult(1.0, br.charge.min, br.charge.max, br.charge.maxMult), 2.4);
  assert.equal(F.boltFalloff(10), 1);
  assert.equal(F.boltFalloff(30), 1);
  near(F.boltFalloff(60), 0.75);
  assert.equal(F.boltFalloff(90), 0.5);
  assert.equal(F.boltFalloff(200), 0.5);
  assert.equal(F.ringfallPower(0), 16);
  assert.equal(F.ringfallPower(11), 12);
  assert.equal(F.ringfallPower(22), 8);
  assert.equal(F.ringfallPower(23), 0);
});

test('Ora regen states (GDD 4.3) and cooldowns', () => {
  near(F.oraRegen(5, null, { inCombat: true }), 1.625);
  near(F.oraRegen(5, null, { inSiphonZone: true }), 1.625);
  near(F.oraRegen(5, null, { inCombat: true, inSiphonZone: true }), 0.8125);
  near(F.oraRegen(5, { oraRegenPct: 0.15 }, {}), 3.25 * 1.15);
  for (const s of [{ boosting: true }, { inForm: true }, { burnout: true }]) assert.equal(F.oraRegen(50, { oraRegenPct: 1 }, s), 0);
  near(F.gatherRate(10, { gatherPct: 0.2 }), 45 * 1.2);
  near(F.cooldown(10, 0.02), 9.8);
  near(F.cooldown(10, 0.9), 7, 1e-9, 'cooldown reduction is capped at 30%');
  near(F.cooldownReduction(100), 0.30);
});

test('items, prices and region levels (GDD 10, 3.2)', () => {
  assert.equal(F.itemValue(2, 1), 2);
  assert.equal(F.itemValue(6, 15), Math.round(6 * 2.2));
  assert.equal(F.itemValue(20, 22), Math.round(20 * 2.76));
  assert.equal(F.itemPrice('common', 0), 70);
  assert.equal(F.itemPrice('fine', 3), Math.round(70 * 2.5 * 1.45));
  assert.equal(F.itemPrice('rare', 15), 1365);
  assert.equal(F.consumablePrice('sunfruit', 1), 32);
  assert.equal(F.consumablePrice('ora_draught', 10), 75);
  assert.equal(F.consumablePrice('nothing', 10), 0);
  assert.equal(F.sellPrice(780), 195);
  assert.equal(F.sellPrice(32), 8);
  assert.equal(F.regionLevel([1, 6], 0), 1);
  assert.equal(F.regionLevel([1, 6], 1), 6);
  assert.equal(F.regionLevel([1, 6], 0.5), 4);
  assert.equal(F.regionLevel([8, 14], -1), 8);
  assert.equal(F.regionLevel([8, 14], 3), 14);
});

test('modifier folding', () => {
  const m = F.createMods();
  assert.equal(m.flickerCostMult, 1);
  F.addMods(m, { meleePct: 0.06, flickerCostMult: 0.5, secondBreath: 1, unknownKey: 4 });
  F.addMods(m, { meleePct: 0.06, flickerCostMult: 0.5, perfectStaggerMult: 2 });
  near(m.meleePct, 0.12);
  assert.equal(m.flickerCostMult, 0.25);
  assert.equal(m.perfectStaggerMult, 2);
  assert.equal(m.secondBreath, 1);
  assert.equal('unknownKey' in m, false);
  assert.equal(F.mod(null, 'gatherDmgTakenMult'), 1);
  assert.equal(F.mod({ meleePct: 0.2 }, 'meleePct'), 0.2);
});

/** Strike String hit powers at a rank (BALANCE.tech). */
function stringPowers(rank) {
  const t = BALANCE.tech.strike_string;
  let p = t.hits.map((h) => h.power);
  if (rank >= 2) p = [...p, t.ranks[1].extraHit.power];
  if (rank >= 3) p = p.map((x) => x * t.ranks[2].powerMult);
  return p;
}

test('GDD 7.1 target: a grunt with hpMult 1 dies to 1-2 Strike Strings (Warrior, same level, typical build, no gear)', () => {
  // Typical build: Balanced style; rank 1 below L20, rank 2 from L20, rank 3 and Iron Fists I-III from L30.
  const grunt = { tier: 'grunt', mult: { hp: 1, atk: 1, def: 1 }, poise: 25 };
  for (let L = 1; L <= BALANCE.level.cap; L++) {
    const rank = L >= 30 ? 3 : L >= 20 ? 2 : 1;
    const meleePct = L >= 30 ? 3 * BALANCE.passives.iron_fists.ranks[0].mods.meleePct : 0;
    const p = F.derivePlayerStats(allocated(L), L, null, null);
    const e = F.enemyStats(grunt, L);
    for (const roll of BALANCE.damage.roll) {
      const perString = stringPowers(rank).reduce((sum, pw) => sum + F.damage(pw * (1 + meleePct), p.meleeRating, e.defense, 1, 1, 1, roll, 1), 0);
      const strings = Math.ceil(e.hpMax / perString);
      assert.ok(strings >= 1 && strings <= 2, `L${L} roll ${roll}: ${strings} strings`);
    }
  }
});

test('GDD 7.1 target: a full-HP player survives 9-18 grunt hits (Warrior, same level, typical allocation, no gear)', () => {
  const grunt = { tier: 'grunt', mult: { hp: 1, atk: 1, def: 1 }, poise: 25 };
  const power = BALANCE.enemyScale.referenceHitPower;
  for (let L = 1; L <= BALANCE.level.cap; L++) {
    const p = F.derivePlayerStats(allocated(L), L, null, null);
    const e = F.enemyStats(grunt, L);
    const hit = F.damage(power, e.meleeRating, p.defense, 1, 1, 1, 1, BALANCE.difficulty.warrior.enemyDmg);
    const survived = Math.floor((p.hpMax - 1) / hit);
    assert.ok(survived >= 9 && survived <= 18, `L${L}: survives ${survived} hits`);
  }
});

test('the reference grunt hit power is the mean of the P0 grunt attacks of GDD 7.2', () => {
  const grunts = Object.entries(BALANCE.enemies).filter(([, e]) => e.tier === 'grunt').map(([id]) => id);
  const prefixes = { ember_wisp: 'wisp_', tusk_boar: 'boar_', choir_acolyte: 'acolyte_', choir_caster: 'caster_', scuttlecrab: 'crab_', frost_harrier: 'harrier_' };
  const powers = [];
  for (const id of grunts) {
    if (!prefixes[id]) continue;
    for (const [tid, t] of Object.entries(BALANCE.enemyTech)) {
      if (!tid.startsWith(prefixes[id])) continue;
      if (typeof t.power === 'number') powers.push(t.power);
      if (Array.isArray(t.powers)) powers.push(...t.powers);
    }
  }
  const mean = powers.reduce((a, b) => a + b, 0) / powers.length;
  assert.ok(Math.abs(mean - BALANCE.enemyScale.referenceHitPower) < 0.05, 'mean grunt power ' + mean);
});

test('Technique Points: 55 available, all P0 ranks and passives cost 55 (GDD 4.5)', () => {
  const available = (BALANCE.level.cap - 1) * BALANCE.level.tpPerLevel + BALANCE.tp.shrines * BALANCE.tp.shrineTp
    + Object.values(BALANCE.quests).reduce((s, q) => s + q.tp, 0);
  assert.equal(available, 55);
  let cost = 0;
  for (const t of Object.values(BALANCE.tech)) for (const r of t.ranks) cost += r.tp;
  for (const p of Object.values(BALANCE.passives)) for (const r of p.ranks) cost += r.tp;
  assert.equal(cost, 55);
  assert.equal(BALANCE.tp.total, 55);
});

test('derivePlayerStats at L10 Balanced (GDD 4.4 L10 example allocation)', () => {
  const b = allocated(10);
  assert.deepEqual(b, { mgt: 12, spr: 12, vit: 12, swf: 11 });
  assert.equal(F.derivePlayerStats(b, 10, null, null).resonance, 3760);
});
