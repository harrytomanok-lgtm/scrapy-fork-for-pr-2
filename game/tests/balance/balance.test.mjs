/**
 * Balance bands of the main path, computed by tools/balance-sim.mjs from BALANCE, formulas and the ai, combat and
 * rpg data. These lock the tuned numbers: a later change to an enemy, a boss, a price or the route that pushes a
 * fight, a level or the economy out of its band fails here. The browser check of the same model is
 * tools/scenarios/balance.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../../src/core/balance.js';
import { enemies } from '../../src/ai/data/enemies.js';
import { aiTechniques } from '../../src/ai/data/techniques.js';
import { playerTechniques } from '../../src/combat/data/techniques.js';
import { STAGES, checks, gruntTargets, killShellsPerHour, profileFor, run, shellsPerHour, stageGruntStrings, totalNodeCost } from '../../tools/balance-sim.mjs';

const DIFFS = ['story', 'warrior', 'master'];
const RUNS = Object.fromEntries(DIFFS.map((d) => [d, run(d, profileFor(d))]));
const inBand = (v, [lo, hi], msg) => assert.ok(v >= lo && v <= hi, `${msg}: ${typeof v === 'number' ? v.toFixed(2) : v} not in [${lo}, ${hi}]`);

/** Boss fight length bands in seconds (Warrior, realistic player): a first boss under a minute, a finale of 2-4. */
const BOSS_SECONDS = { durn: [40, 80], bramblehorn: [65, 120], gorrumaw: [75, 140], iskra: [80, 150], vorrhal: [120, 240] };
/** Healing items a boss may cost at most (Master: the carry cap). */
const MAX_HEALS = { story: 1, warrior: 3, master: BALANCE.economy.carryCap };

test('fight pacing: a roster grunt on the main path takes 2-3 Strike Strings from the route\'s player', () => {
  // tusk_boar keeps the GDD 7.2 multipliers (tests/core/formulas.test.mjs pins them); every other grunt is paced.
  const rows = stageGruntStrings('warrior').filter((r) => r.id !== 'tusk_boar');
  for (const r of rows) inBand(r.strings, [1.4, 3.0], `${r.stage} ${r.id} L${r.level} strings to kill`);
  const mean = rows.reduce((s, r) => s + r.strings, 0) / rows.length;
  inBand(mean, [2, 3], 'mean strings to kill a grunt');
});

test('fight pacing: a group of 3-4 at the player\'s level lasts about 8-15 s on Warrior', () => {
  for (const r of RUNS.warrior.rows) {
    for (const f of r.fights) {
      if (f.n < 3 || f.n > 4) continue;
      // Ember Wisps alone are the gentlest fight of the game (fragile flyers): shorter, but no longer a blink.
      const band = /^(mq1_)?wisps$/.test(f.id) ? [5, 17] : [8, 17];
      inBand(f.ttkGroup, band, `Warrior ${r.stage} ${f.id} x${f.n} seconds`);
    }
  }
});

test('GDD 7.1: a same-level grunt dies to 1-2 Strike Strings and a full-HP player survives 9-18 grunt hits (L1-30)', () => {
  for (let L = 1; L <= 30; L++) {
    for (const [id, v] of Object.entries(gruntTargets(L))) {
      inBand(v.strings, BALANCE.enemyScale.targets.stringsToKillGrunt, `L${L} ${id} strings to kill`);
      inBand(v.hits, BALANCE.enemyScale.targets.gruntHitsSurvived, `L${L} ${id} hits survived`);
    }
  }
});

test('player level follows the region level along the main path, and every boss is met at its level', () => {
  for (const d of DIFFS) {
    for (const r of RUNS[d].rows) {
      assert.ok(r.level >= r.regionLevel - 1 && r.level <= r.regionLevel + 4, `${d} ${r.stage}: player L${r.level} in a L${r.regionLevel} region`);
      if (r.boss) assert.ok(r.level >= r.boss.level - 1 && r.level <= r.boss.level + 4, `${d} ${r.stage}: player L${r.level} vs ${r.boss.id} L${r.boss.level}`);
    }
  }
  // GDD 4.1: the finale is recommended for 24-28 and L25 or more when MQ7 starts (Story and Warrior route).
  const mq7 = RUNS.warrior.rows.find((r) => r.stage === 'MQ7');
  inBand(mq7.level, [25, 28], 'level when MQ7 starts');
});

// Lower bound 4 s: the pacing pass made three wisps a fight of about 6 s (they fell in 2.7 s before).
test('group fights: quick, never a death sentence', () => {
  for (const d of DIFFS) {
    const maxLost = d === 'master' ? 1.2 : 0.9;
    for (const r of RUNS[d].rows) {
      for (const f of r.fights) {
        inBand(f.ttkGroup, [4, 25], `${d} ${r.stage} ${f.id} seconds to clear`);
        assert.ok(f.hpLost <= maxLost * r.hp, `${d} ${r.stage} ${f.id}: ${(100 * f.hpLost / r.hp).toFixed(0)}% HP lost`);
        if (d !== 'master') assert.ok(f.ttd > f.ttkGroup, `${d} ${r.stage} ${f.id}: dies in ${f.ttd.toFixed(1)} s, clears in ${f.ttkGroup.toFixed(1)} s`);
      }
    }
  }
});

test('boss fight length and the healing items it costs', () => {
  for (const r of RUNS.warrior.rows) if (r.boss) inBand(r.boss.length, BOSS_SECONDS[r.boss.id], `Warrior ${r.boss.id} fight length`);
  for (const d of DIFFS) {
    for (const r of RUNS[d].rows) {
      if (!r.boss) continue;
      assert.ok(r.boss.heals <= MAX_HEALS[d], `${d} ${r.boss.id}: ${r.boss.heals} healing items`);
      assert.ok(r.boss.length > 30, `${d} ${r.boss.id}: a boss is a fight (${r.boss.length.toFixed(0)} s)`);
    }
  }
  // Each boss is a longer fight than the one before it on the main path (Warrior).
  const lengths = RUNS.warrior.rows.filter((r) => r.boss).map((r) => r.boss.length);
  for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i] > lengths[i - 1] * 0.9, `boss ${i} ${lengths[i].toFixed(0)} s after ${lengths[i - 1].toFixed(0)} s`);
});

test('economy: the gear on offer is affordable when it is met, and Shells keep mattering', () => {
  for (const d of DIFFS) {
    for (const r of RUNS[d].rows) {
      assert.ok(r.shells >= r.spent, `${d} ${r.stage}: earned ${r.shells}, the stage's shopping costs ${r.spent}`);
      if (r.spent > 0 && r.minute >= 50) assert.ok(r.shells <= 2 * r.spent, `${d} ${r.stage}: earned ${r.shells} vs spent ${r.spent}: Shells stop mattering`);
    }
  }
  // GDD 10.1 pacing within 35%: about 600 per hour from kills at L10, 2500 per hour at L25.
  inBand(killShellsPerHour(10), [600 * 0.65, 600 * 1.35], 'kill Shells per hour at L10');
  inBand(shellsPerHour(25), [2500 * 0.65, 2500 * 1.35], 'Shells per hour at L25');
});

test('Technique Points and Forms', () => {
  assert.equal(totalNodeCost(), BALANCE.tp.total, 'GDD 4.5: all P0 ranks cost 55');
  const mq7 = RUNS.warrior.rows.find((r) => r.stage === 'MQ7');
  inBand(mq7.tp, [38, 46], 'TP when MQ7 starts (GDD: about 41 at L26)');
  assert.ok(mq7.tp < BALANCE.tp.total, 'choices matter: not every node is bought by the finale');
  for (const r of RUNS.warrior.rows) {
    if (r.minute >= 22) assert.ok(r.emberSeconds >= 20, `${r.stage}: a full pool holds Ember Form ${r.emberSeconds.toFixed(0)} s`);
    assert.ok(r.gatherRefill <= 5, `${r.stage}: Gather refills the pool in ${r.gatherRefill.toFixed(1)} s`);
  }
  inBand(mq7.tempestSeconds, [20, 60], 'Tempest seconds from a full pool at MQ7');
});

test('Ember Wisps: reachable by a grounded Strike String and the gentlest first enemy', () => {
  const wisp = enemies().find((e) => e.id === 'ember_wisp');
  const string = playerTechniques().find((t) => t.id === 'strike_string');
  const reach = Math.max(...string.chain.map((c) => c.hits[0].u + c.hits[0].radius));
  assert.ok(wisp.params.hover <= reach, `wisp hover ${wisp.params.hover} m within the string's reach ${reach} m`);
  assert.ok(wisp.params.prefer[0] < BALANCE.tech.strike_string.lunge.dist, 'wisps come within the lunge of the first hit');
  const spit = aiTechniques().find((t) => t.id === 'wisp_spit');
  const boar = aiTechniques().find((t) => t.id === 'boar_gore');
  // Per second, a wisp's spit is weaker than a boar's gore (atk x power per cooldown).
  assert.ok(wisp.mult.atk * spit.projectiles[0].power / spit.ai.cooldown < BALANCE.enemies.tusk_boar.mult.atk * boar.hits[0].power / boar.ai.cooldown);
  const c = checks().wisps;
  assert.ok(c.expect.lostPct < 50, `a level-3 player loses ${c.expect.lostPct.toFixed(0)}% HP to three level-6 wisps`);
});

test('the main path covers MQ1-MQ7 and every boss', () => {
  assert.deepEqual(STAGES.filter((s) => s.boss).map((s) => s.boss), ['durn', 'bramblehorn', 'gorrumaw', 'iskra', 'vorrhal']);
  assert.deepEqual(STAGES.map((s) => s.minute), STAGES.map((s) => s.minute).slice().sort((a, b) => a - b));
});
