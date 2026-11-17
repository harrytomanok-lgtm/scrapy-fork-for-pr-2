/**
 * Balance asserts of ARCHITECTURE 4.17 and GDD 5.3, computed from BALANCE data alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../../src/core/balance.js';
import { IDS } from '../../src/core/ids.js';
import { oraRegen, simulateRoute, statPointsAt, xpToNext } from '../../src/core/formulas.js';

const T = BALANCE.tech;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

/** Strike String sustained power per second at a rank (single target). */
function stringPerSecond(rank) {
  const t = T.strike_string;
  const hits = t.hits.map((h) => h.power);
  if (rank >= 2) hits.push(t.ranks[1].extraHit.power);
  const mult = rank >= 3 ? t.ranks[2].powerMult : 1;
  return hits.reduce((a, b) => a + b, 0) * mult / (hits.length * t.hitSeconds);
}

/** Ora Bolt sustained power per second at a rank (single target: piercing adds nothing). */
function boltPerSecond(rank) {
  const t = T.ora_bolt;
  const twin = rank >= 2 ? t.ranks[1] : { count: 1, powerMult: 1 };
  return t.power * twin.count * twin.powerMult / t.cooldown;
}

/** Full output of a slot technique at its highest P0 rank (single target, fully charged). */
function fullOutput(id) {
  const t = T[id];
  let mult = 1;
  let total = 0;
  for (const r of t.ranks) if (r.powerMult) mult *= r.powerMult;
  if (t.beam) {
    const ticks = Math.round(t.beam.seconds / t.beam.tick);
    total = ticks * t.beam.power * (t.charge ? t.charge.maxMult : 1);
  } else if (t.boltsPerSec) {
    total = t.power * t.boltsPerSec * t.seconds;
  } else {
    total = t.power;
  }
  for (const r of t.ranks) {
    if (r.finalBolt) total += r.finalBolt.power;
    if (r.burn) total += Math.round(r.burn.seconds / r.burn.every) * r.burn.power;
  }
  return total * mult;
}

test('(1) Strike String sustained power per second beats Ora Bolt at equal rank count', () => {
  near(stringPerSecond(1), 1.39, 0.01, 'GDD: 1.95 over 1.4 s');
  near(boltPerSecond(1), 1.10, 1e-9, 'GDD: 0.22 per 0.2 s');
  near(boltPerSecond(2), 1.32, 1e-9, 'GDD: twin bolts');
  for (let rank = 1; rank <= 3; rank++) {
    assert.ok(stringPerSecond(rank) > boltPerSecond(rank), `rank ${rank}: ${stringPerSecond(rank)} > ${boltPerSecond(rank)}`);
  }
});

test('(2) the Ultimate centre power exceeds the full output of every slot technique at its top P0 rank', () => {
  near(fullOutput('flare_barrage'), 6.5, 1e-9, 'Flare Barrage');
  near(fullOutput('dawn_lance'), 8.3, 0.05, 'charged Dawn Lance');
  near(fullOutput('nova_ring'), 3.6, 1e-9, 'Nova Ring');
  const slots = Object.keys(T).filter((id) => T[id].slot === 'slot');
  assert.deepEqual(slots.sort(), ['dawn_lance', 'flare_barrage', 'nova_ring']);
  for (const id of slots) assert.ok(T.ringfall.powerCentre > fullOutput(id), `${id}: ${fullOutput(id)}`);
});

test('GDD 5.3 technique totals', () => {
  near(T.flare_barrage.power * T.flare_barrage.boltsPerSec * T.flare_barrage.seconds, 5.0, 1e-9, 'Flare Barrage total');
  const lance = T.dawn_lance;
  const uncharged = Math.round(lance.beam.seconds / lance.beam.tick) * lance.beam.power;
  near(uncharged, 2.56, 1e-9, 'Dawn Lance total');
  near(uncharged * lance.charge.maxMult, 6.4, 1e-9, 'charged Dawn Lance total');
  near(T.strike_string.hits.reduce((s, h) => s + h.power, 0), 1.95, 1e-9, 'Strike String total');
});

test('(3) for every level 1-40 and both allocation extremes, boost and every Form are a net Ora drain', () => {
  const bestRegenPct = Object.values(BALANCE.gear).reduce((s, g) => s + ((g.mods && g.mods.oraRegenPct) || 0), 0);
  const mods = { oraRegenPct: bestRegenPct };
  for (let L = 1; L <= BALANCE.level.cap; L++) {
    for (const extreme of ['allSpirit', 'noSpirit']) {
      const spr = BALANCE.level.startStat + (extreme === 'allSpirit' ? statPointsAt(L) : 0);
      for (const state of [{ boosting: true }, { boosting: true, inCombat: true }]) {
        const net = oraRegen(spr, mods, state) - T.boost.oraPerSec;
        assert.ok(net < 0, `L${L} ${extreme} boost: ${net}`);
        assert.ok(oraRegen(spr, mods, state) - T.boost.sonicOraPerSec < 0, `L${L} ${extreme} sonic`);
      }
      for (const [id, form] of Object.entries(BALANCE.forms)) {
        const net = oraRegen(spr, mods, { inForm: true }) - form.drain;
        assert.ok(net < 0, `L${L} ${extreme} ${id}: ${net}`);
      }
    }
  }
});

test('(4) the XP route meets the pacing targets of GDD 4.1', () => {
  const route = BALANCE.route;
  const sim = simulateRoute(route);
  assert.equal(sim[0].minute, 0);
  assert.equal(sim[0].level, 1);
  for (let i = 1; i < sim.length; i++) assert.ok(sim[i].level >= sim[i - 1].level, 'levels never drop');
  const reach = (level) => sim.find((e) => e.level >= level);
  const l10 = reach(10);
  const l20 = reach(20);
  assert.ok(l10, 'level 10 is reached');
  assert.ok(l20, 'level 20 is reached');
  const [a10, b10] = route.targets.level10;
  const [a20, b20] = route.targets.level20;
  assert.ok(l10.minute >= a10 && l10.minute <= b10, `L10 at minute ${l10.minute}`);
  assert.ok(l20.minute >= a20 && l20.minute <= b20, `L20 at minute ${l20.minute}`);
  const atMq7 = sim.find((e) => e.minute === route.mq7StartMinute);
  assert.ok(atMq7.level >= route.targets.mq7MinLevel, `level ${atMq7.level} when MQ7 starts`);
  assert.ok(atMq7.level < BALANCE.level.cap, 'L40 is post-game');
  assert.deepEqual(route.targets, { level10: [40, 50], level20: [110, 130], mq7MinLevel: 25 });
  assert.equal(xpToNext(1), 100, 'the level curve stays fixed');
});

test('the route covers the GDD 4.1 bands and quest XP', () => {
  const bands = BALANCE.route.bands;
  assert.deepEqual(bands.map((b) => [b.from, b.to]), [[0, 45], [45, 120], [120, 270]]);
  assert.deepEqual(bands.map((b) => b.killsPerMin), [1.8, 0.8, 0.4]);
  const questXp = (b) => b.quests.reduce((s, id) => s + BALANCE.quests[id].xp + (BALANCE.quests[id].stepXp || 0), 0);
  assert.deepEqual(bands.map(questXp), [100 + 300 + 550, 900 + 600 + 1500 + 800, 2200]);
  assert.deepEqual(bands.map((b) => b.camps), [5, 10, 6]);
  assert.deepEqual(bands.map((b) => b.siphons), [1, 3, 1]);
  assert.deepEqual(bands.map((b) => b.bosses), [['durn'], ['bramblehorn', 'gorrumaw'], ['iskra']]);
  assert.deepEqual(bands.map((b) => b.discoveries), [25, 40, 30]);
});

test('(5) every key used by BALANCE modifiers is in IDS.modKey', () => {
  const found = [];
  const walk = (o, path) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'mods' && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const key of Object.keys(v)) {
          found.push(key);
          assert.ok(IDS.modKey.includes(key), `${path}.mods.${key} is not in IDS.modKey`);
        }
      } else walk(v, path + '.' + k);
    }
  };
  walk(BALANCE, 'BALANCE');
  assert.ok(found.length >= 20, 'gear, passives, Forms and ranks carry modifiers');
});

test('every catalog id with numbers in BALANCE is a known id', () => {
  for (const id of Object.keys(BALANCE.tech)) assert.ok(IDS.technique.includes(id), id);
  for (const id of Object.keys(BALANCE.enemyTech)) assert.ok(IDS.technique.includes(id), id);
  for (const id of Object.keys(BALANCE.enemies)) assert.ok(IDS.enemy.includes(id), id);
  for (const id of Object.keys(BALANCE.bosses)) assert.ok(IDS.boss.includes(id), id);
  for (const id of Object.keys(BALANCE.forms)) assert.ok(IDS.form.includes(id), id);
  for (const id of Object.keys(BALANCE.gear)) assert.ok(IDS.item.includes(id), id);
  for (const id of Object.keys(BALANCE.consumables)) assert.ok(IDS.item.includes(id), id);
  for (const id of Object.keys(BALANCE.shops)) assert.ok(IDS.shop.includes(id), id);
  for (const id of Object.keys(BALANCE.loot)) assert.ok(IDS.lootTable.includes(id), id);
  for (const id of Object.keys(BALANCE.quests)) assert.ok(IDS.quest.includes(id), id);
  for (const b of Object.values(BALANCE.bosses)) assert.ok(IDS.landmark.includes(b.arena.landmarkId));
  const nonBoss = IDS.enemy.filter((id) => !IDS.boss.includes(id));
  assert.deepEqual(Object.keys(BALANCE.enemies).sort(), nonBoss.sort());
  assert.deepEqual(Object.keys(BALANCE.gear).length, 20, 'twenty gear items');
  assert.ok(Object.isFrozen(BALANCE) && Object.isFrozen(BALANCE.tech.strike_string.hits[0]), 'BALANCE is deeply frozen');
});
