#!/usr/bin/env node
/**
 * Balance simulator: one table for the main path, from MQ1 to the finale, on the pure logic only (BALANCE, formulas
 * and the registered data modules of ai, combat and rpg, loaded directly). Usage:
 *   node tools/balance-sim.mjs [--json] [--difficulty story|warrior|master]
 *
 * Model (every assumption is a named constant below, so tests and the browser check share it):
 * - Player level along the main path: formulas.simulateRoute(BALANCE.route) (quest XP, kills at the band rate,
 *   camps, Siphons, bosses, discoveries) read at the minute each stage is reached.
 * - Stats: Balanced allocation (the default style) plus the stage's gear loadout at its item level.
 * - TP: one per level, the main-quest TP already earned, and shrines found at a steady rate; spent in a fixed
 *   priority order (string ranks and Iron Fists first).
 * - Rotation: a full Strike String, a Breaker (smash), a short re-engage during which bolts are fired, and one slot
 *   technique on cooldown (Flare Barrage before Nova Ring is unlocked, then Nova Ring), all within the Ora budget of
 *   the fight (pool plus in-combat regen). Melee uptime is below 1 (spacing, dodging); in a group every enemy also
 *   costs a target switch (lock, lunge, chase; longer for ranged and flying enemies). Calibrated on the browser check.
 * - Enemies: the weighted average of their usable techniques (power per cycle of windup + active + recover + the
 *   brain's gap), limited by the difficulty's attack tokens; a share of the hits is avoided (guard, Flicker, knock).
 * @module tools/balance-sim
 */
import { BALANCE } from '../src/core/balance.js';
import * as F from '../src/core/formulas.js';
import { enemies as enemyDefs, bosses as bossDefs, GROUPS } from '../src/ai/data/enemies.js';
import { aiTechniques } from '../src/ai/data/techniques.js';
import { SHOPS } from '../src/rpg/data/items.js';
import { REGIONS } from '../src/world/gen/layout.js';

const B = BALANCE;

/** Model constants (shared with tests/balance and tools/scenarios/balance.mjs). */
export const MODEL = Object.freeze({
  /**
   * Profiles. uptime: share of time the melee rotation is landing (spacing, dodging, enemies knocked away);
   * hitRate: share of enemy hits that land; nodes: TP nodes bought. `player` is the realistic player of the table
   * (guards and dodges some hits); `bot` is the scripted rotation of tools/scenarios/balance.mjs (only attacks).
   */
  profiles: {
    player: { uptime: { group: 0.8, boss: 0.75 }, hitRate: 0.55, nodes: true },
    /** Story is chosen by newer players (more hits land); Master by skilled ones (fewer). */
    story: { uptime: { group: 0.8, boss: 0.75 }, hitRate: 0.65, nodes: true },
    master: { uptime: { group: 0.8, boss: 0.75 }, hitRate: 0.4, nodes: true },
    bot: { uptime: { group: 0.95, boss: 1.0 }, hitRate: 0.8, nodes: false },
  },
  /** Shortest window (s) over which a full Ora pool is spent in fights. */
  oraWindow: 40,
  /** Average extra targets hit by the string in a group (cleave). */
  cleave: 1.15,
  /** Re-engage after a Breaker smash (s), and bolts fired during it. */
  reengage: 0, boltsPerCycle: 0.5,
  /** Seconds lost per enemy of a group to switch target (lock, lunge, chase): ground melee, ranged or flying. */
  switchSeconds: { melee: 1.3, ranged: 1.7 },
  /** Breaker as a tap after the string (s). */
  breakerSeconds: 0.45,
  /** HP fraction a player loses before the first healing item of a boss fight. */
  healAt: 0.7,
  /** Shrines found per minute of play (10 over the 270-minute route). */
  shrinesPerMinute: 10 / 270,
  /** Chests opened per band (A, B, C): about 60% of the 26 chests of GDD 12 by the finale. */
  chests: { A: 3, B: 7, C: 6 },
  /** Healing items bought before each boss (counted in the spending). */
  sunfruitPerBoss: 3,
  /** Gap between enemy attacks (s): brain.afterAttack. */
  gap: { enemy: 1.7, boss: 0.95 },
});

/** TP spending priority: [node id, rank index]. Tech ranks first, then passives. */
const TP_ORDER = [
  ['strike_string', 1], ['iron_fists', 0], ['flare_barrage', 0], ['breaker', 1], ['iron_fists', 1], ['strike_string', 2],
  ['nova_ring', 1], ['iron_fists', 2], ['bright_core', 0], ['ora_bolt', 1], ['meteor_heel', 1], ['flicker_step', 1],
  ['ringfall', 1], ['deep_well', 0], ['nova_ring', 2], ['gather', 1], ['second_breath', 0], ['dawn_lance', 1],
  ['dawn_lance', 2], ['bright_core', 1], ['deep_well', 1], ['flare_barrage', 1], ['bright_core', 2], ['ora_bolt', 2],
];

/** Total TP price of every P0 node (all ranks of all techniques and passives). */
export function totalNodeCost() {
  let s = 0;
  for (const t of Object.values(B.tech)) for (const r of t.ranks || []) s += r.tp || 0;
  for (const p of Object.values(B.passives)) for (const r of p.ranks) s += r.tp || 0;
  return s;
}

/**
 * The main path. minute = when the stage is played on the route; region = world region id; level = the enemy level
 * there (region band interpolated, or the quest's own level); fights = groups met; boss = the stage's boss.
 * Gear: [itemId, itemLevel] equipped at that point (shop stock, quest rewards met before).
 */
export const STAGES = [
  { id: 'MQ1', minute: 4, region: 'meadows', t: 0, unlocks: [], gear: [['apprentice_garb', 1]],
    fights: [{ id: 'mq1_wisps', members: [['ember_wisp', 4]], level: 1 }, { id: 'mq1_boars', members: [['tusk_boar', 2]], level: 1 }] },
  { id: 'Meadows', minute: 12, region: 'meadows', t: 0.3, unlocks: ['flare_barrage'],
    gear: [['training_wraps', 1], ['apprentice_garb', 1], ['wind_charm', 4]],
    fights: [{ id: 'wisps', members: [['ember_wisp', 3]] }, { id: 'boars', members: [['tusk_boar', 2]] }, { id: 'camp_choir_small', members: [['choir_acolyte', 3]] }] },
  { id: 'MQ2', minute: 22, region: 'meadows', t: 0.5, unlocks: ['flare_barrage'],
    gear: [['racers_wraps', 3], ['meadow_garb', 3], ['wind_charm', 4], ['sunfruit_charm', 3]],
    fights: [{ id: 'mq2_raid', members: [['choir_acolyte', 3], ['choir_caster', 1]], level: 'player' }], boss: 'durn' },
  { id: 'MQ4', minute: 50, region: 'coast', t: 0.6, unlocks: ['flare_barrage', 'nova_ring', 'dawn_lance'],
    gear: [['bramble_wraps', 8], ['tidewoven_garb', 8], ['wind_charm', 4], ['sunfruit_charm', 3]],
    fights: [{ id: 'mq4_wave', members: [['choir_acolyte', 5], ['choir_caster', 3]] }, { id: 'camp_coast', members: [['scuttlecrab', 2], ['choir_caster', 1]] }] },
  { id: 'MQ3', minute: 64, region: 'thornwood', t: 0.5, unlocks: ['flare_barrage', 'nova_ring', 'dawn_lance'],
    gear: [['bramble_wraps', 8], ['meadow_garb', 8], ['tide_charm', 8], ['sunfruit_charm', 3]],
    fights: [{ id: 'camp_thornwood', members: [['bramble_boar', 2], ['choir_acolyte', 2]] }], boss: 'bramblehorn' },
  { id: 'MQ5', minute: 101, region: 'rustdune', t: 0.5, unlocks: ['flare_barrage', 'nova_ring', 'dawn_lance', 'ringfall'],
    gear: [['copper_knuckles', 15], ['dunewalker_garb', 15], ['tide_charm', 8], ['golem_core_charm', 14]],
    fights: [{ id: 'camp_rustdune', members: [['rust_golem', 1], ['choir_acolyte', 3]] }], boss: 'gorrumaw' },
  { id: 'MQ6', minute: 195, region: 'frostspine', t: 0.45, unlocks: ['flare_barrage', 'nova_ring', 'dawn_lance', 'ringfall'],
    gear: [['copper_knuckles', 15], ['frostweave_garb', 22], ['wyrmhide_charm', 16], ['golem_core_charm', 14]],
    fights: [{ id: 'camp_frostspine', members: [['frost_harrier', 2], ['choir_acolyte', 2]] }], boss: 'iskra' },
  { id: 'MQ7', minute: 270, region: 'spire', t: 0.5, unlocks: ['flare_barrage', 'nova_ring', 'dawn_lance', 'ringfall'],
    gear: [['copper_knuckles', 15], ['frostweave_garb', 22], ['wyrmhide_charm', 16], ['frost_charm', 22]],
    fights: [{ id: 'mq7_gate', members: [['choir_vanguard', 3]], level: 26 }], boss: 'vorrhal' },
];

/** Main quests completed before each stage (their TP and Shells are in hand). */
const QUESTS_BEFORE = { MQ1: [], Meadows: ['mq1'], MQ2: ['mq1', 'sq1'], MQ4: ['mq1', 'mq2', 'sq1'], MQ3: ['mq1', 'mq2', 'sq1', 'mq4'],
  MQ5: ['mq1', 'mq2', 'sq1', 'mq4', 'mq3'], MQ6: ['mq1', 'mq2', 'sq1', 'mq4', 'mq3', 'mq5', 'sq4'], MQ7: ['mq1', 'mq2', 'sq1', 'mq4', 'mq3', 'mq5', 'sq4', 'mq6'] };
/** Bosses beaten before each stage. */
const BOSSES_BEFORE = { MQ1: [], Meadows: [], MQ2: [], MQ4: ['durn'], MQ3: ['durn'], MQ5: ['durn', 'bramblehorn'], MQ6: ['durn', 'bramblehorn', 'gorrumaw'], MQ7: ['durn', 'bramblehorn', 'gorrumaw', 'iskra'] };
/** Shop purchases made by each stage: [shopId, itemId] (cumulative). Healing items are counted separately. */
const BUYS = { MQ1: [], Meadows: [], MQ2: [['dov_stall', 'meadow_garb'], ['dov_stall', 'sunfruit_charm']],
  MQ4: [['aster_market', 'bramble_wraps'], ['aster_market', 'tidewoven_garb']] };
BUYS.MQ3 = BUYS.MQ2.concat(BUYS.MQ4, [['aster_market', 'meadow_garb']]);
BUYS.MQ4 = BUYS.MQ2.concat(BUYS.MQ4);
BUYS.MQ5 = BUYS.MQ3.concat([['yael_outpost', 'copper_knuckles'], ['yael_outpost', 'dunewalker_garb']]);
BUYS.MQ6 = BUYS.MQ5.concat([['ridgerest_provisions', 'frostweave_garb']]);
BUYS.MQ7 = BUYS.MQ6.concat([['ridgerest_provisions', 'stormcaller_wraps'], ['ridgerest_provisions', 'stillwind_charm']]);

const ENEMY = Object.fromEntries(enemyDefs().map((d) => [d.id, d]));
const BOSS = Object.fromEntries(bossDefs().map((d) => [d.id, d]));
const TECH = Object.fromEntries(aiTechniques().map((d) => [d.id, d]));
const GROUP = Object.fromEntries(GROUPS.map((g) => [g.id, g]));
const REGION = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
const SHOP = Object.fromEntries(SHOPS.map((s) => [s.id, s]));

// ---------------------------------------------------------------- player

/** Balanced allocation at a level: [mgt, spr, vit, swf]. */
export function allocation(level, style = 'balanced') {
  const s = { mgt: B.level.startStat, spr: B.level.startStat, vit: B.level.startStat, swf: B.level.startStat };
  const n = F.statPointsAt(level);
  for (let i = 0; i < n; i++) s[F.styleStat(style, i)]++;
  return s;
}

/** TP nodes owned at a stage: a map id -> highest owned rank index (0 = base). */
function tpNodes(level, quests, minute, unlocks) {
  let tp = (level - 1) * B.level.tpPerLevel + Math.min(B.tp.shrines, Math.floor(minute * MODEL.shrinesPerMinute));
  for (const q of quests) tp += (B.quests[q] && B.quests[q].tp) || 0;
  const have = { strike_string: 0, breaker: 0, ora_bolt: 0, meteor_heel: 0, flicker_step: 0, gather: 0 };
  for (const u of unlocks) if (u !== 'flare_barrage') have[u] = 0;
  const total = tp;
  let spent = 0;
  for (const [id, rank] of TP_ORDER) {
    const node = B.tech[id] || B.passives[id];
    if (id === 'flare_barrage' && (level < B.tech.flare_barrage.unlockLevel || unlocks.indexOf(id) < 0)) continue;
    if (B.tech[id] && id !== 'flare_barrage' && !(id in have)) continue;
    const cur = id in have ? have[id] : -1;
    if (cur !== rank - 1) continue;
    const price = node.ranks[rank].tp || 0;
    if (spent + price > tp) break;
    spent += price;
    have[id] = rank;
  }
  return { tp: total, spent, have };
}

/** Player stats at a stage. */
export function playerAt(stage, level, withNodes = true) {
  const base = allocation(level);
  const mods = F.createMods();
  base.def = 0;
  for (const [id, il] of stage.gear) {
    const g = B.gear[id];
    if (g.stats) for (const k in g.stats) base[k] = (base[k] || 0) + F.itemValue(g.stats[k], il);
    F.addMods(mods, g.mods);
  }
  const nodes = withNodes ? tpNodes(level, QUESTS_BEFORE[stage.id] || [], stage.minute, stage.unlocks)
    : { tp: 0, spent: 0, have: { strike_string: 0, breaker: 0, ora_bolt: 0, flare_barrage: -1 } };
  for (const [id, rank] of Object.entries(nodes.have)) {
    const p = B.passives[id];
    if (p) for (let i = 0; i <= rank; i++) F.addMods(mods, p.ranks[i].mods);
  }
  const st = F.derivePlayerStats(base, level, mods, null);
  return { level, base, mods, stats: st, nodes };
}

/** Damage of one power unit of the player's melee or Ora against a target. */
function perPower(p, kind, target) {
  const st = p.stats;
  const rating = kind === 'ora' ? st.oraRating : st.meleeRating;
  const pct = F.mod(p.mods, kind === 'ora' ? 'oraPct' : 'meleePct');
  const crit = 1 + st.critChance * (B.derived.crit.mult - 1);
  return rating * B.damage.defenseK / (B.damage.defenseK + target.defense) * (1 + pct) / (target.defMult || 1) * crit;
}

/**
 * Player damage per second against a target (single-target melee and bolts) and the slot technique's area damage
 * per second per target, within an Ora budget per second.
 * @returns {{ single:number, area:number, cycle:number }}
 */
export function playerDps(p, target, oraPerSec, unlocks, uptime, frontMult = 1) {
  const ss = B.tech.strike_string;
  const rS = p.nodes.have.strike_string || 0;
  let strPower = ss.hits.reduce((s, h) => s + h.power, 0);
  let strHits = ss.hits.length;
  if (rS >= 1) { strPower += ss.ranks[1].extraHit.power; strHits++; }
  if (rS >= 2) strPower *= ss.ranks[2].powerMult;
  const cycle = strHits * ss.hitSeconds + MODEL.breakerSeconds + MODEL.reengage;
  const melee = (strPower + B.tech.breaker.power) * perPower(p, 'melee', target) * frontMult;
  // Slot technique on cooldown, paid first from the Ora budget.
  let area = 0;
  let ora = oraPerSec;
  const cdr = p.stats.cdr;
  if (unlocks.indexOf('nova_ring') >= 0) {
    const n = B.tech.nova_ring;
    const rate = Math.min(1 / F.cooldown(n.cooldown, cdr), ora / n.ora);
    const burn = (p.nodes.have.nova_ring || 0) >= 2 ? 6 * n.ranks[2].burn.power : 0;
    area = rate * (n.power + burn) * perPower(p, 'ora', target);
    ora -= rate * n.ora;
  } else if (unlocks.indexOf('flare_barrage') >= 0 && p.level >= B.tech.flare_barrage.unlockLevel && p.nodes.have.flare_barrage >= 0) {
    const fb = B.tech.flare_barrage;
    const cost = fb.oraPerBolt * fb.boltsPerSec * fb.seconds;
    const rate = Math.min(1 / (F.cooldown(fb.cooldown, cdr) + fb.seconds), ora / cost);
    // Single target: the barrage is focused on the locked enemy.
    const single = rate * fb.power * fb.boltsPerSec * fb.seconds * perPower(p, 'ora', target);
    ora -= rate * cost;
    const bolts = boltsDps(p, target, ora, cycle);
    return { single: (melee / cycle) * uptime + single + bolts, area, cycle };
  }
  return { single: (melee / cycle) * uptime + boltsDps(p, target, ora, cycle), area, cycle };
}

function boltsDps(p, target, ora, cycle) {
  const b = B.tech.ora_bolt;
  const twin = (p.nodes.have.ora_bolt || 0) >= 1 ? b.ranks[1].count * b.ranks[1].powerMult : 1;
  const rate = Math.max(0, Math.min(MODEL.boltsPerCycle / cycle, ora / b.ora));
  return rate * b.power * twin * perPower(p, 'ora', target);
}

/**
 * Ora per second available in a fight: 80% of the pool spread over the fight (at least MODEL.oraWindow seconds:
 * fights come in a row, and boost and Flicker share the pool) plus in-combat regen.
 */
function oraBudget(p, seconds) {
  return (0.8 * p.stats.oraMax) / Math.max(MODEL.oraWindow, seconds) + F.oraRegen(p.base.spr, p.mods, { inCombat: true });
}

// ---------------------------------------------------------------- enemies

/** Total power of one use of an enemy technique (all hits, projectiles and beam ticks, one target). */
export function techPower(t) {
  let s = 0;
  for (const h of t.hits || []) s += h.power;
  for (const pr of t.projectiles || []) {
    const n = pr.every ? Math.floor((pr.until || 0) / pr.every + 1e-6) + 1 : 1;
    s += (pr.count || 1) * n * pr.power;
  }
  if (t.beam) s += Math.round(t.timeline.active / t.beam.tick) * t.beam.power;
  if (t.script && t.ai && typeof t.ai.power === 'number') s += t.ai.power;
  return s;
}

/**
 * Power per second of an enemy while it holds a token (weighted pick of its usable techniques).
 * @param {object} def EnemyDef @param {{ alone?:boolean, techs?:{id:string, weight:number}[], speedMult?:number }} [o]
 */
export function enemyPowerPerSec(def, o = {}) {
  const list = o.techs || def.techs.map((id) => ({ id, weight: TECH[id].ai.weight }));
  let w = 0;
  let pow = 0;
  let sec = 0;
  for (const e of list) {
    const t = TECH[e.id];
    if (!t || t.ai.airOnly || (t.ai.alone && !o.alone)) continue;
    const tl = t.timeline;
    const gap = def.tier === 'boss' ? MODEL.gap.boss : MODEL.gap.enemy;
    const dur = Math.max(tl.windup + tl.active + tl.recover + gap, t.ai.cooldown || 0) / (o.speedMult || 1);
    w += e.weight;
    pow += e.weight * techPower(t);
    sec += e.weight * dur;
  }
  return w > 0 ? pow / sec : 0;
}

/** Enemy damage per power unit against the player. */
function enemyPerPower(p, est, diff) {
  return est.meleeRating * B.damage.defenseK / (B.damage.defenseK + p.stats.defense) / (p.stats.defMult || 1) * F.difficultyRow(diff).enemyDmg;
}

/** Level of an enemy at a stage. */
function stageLevel(stage, fight, enemyId, playerLevel) {
  if (fight.level === 'player') return playerLevel;
  if (typeof fight.level === 'number') return fight.level;
  const band = REGION[stage.region].levels;
  const rl = F.regionLevel(band, stage.t);
  const eb = ENEMY[enemyId].levels;
  return Math.max(eb[0], Math.min(eb[1], rl));
}

/**
 * A group fight: time to kill the group, damage per second taken (token limited), time to die.
 * @returns {object}
 */
export function groupFight(p, stage, fight, diff, prof = MODEL.profiles.player) {
  const hitRate = prof.hitRate;
  const row = F.difficultyRow(diff);
  const members = [];
  for (const [id, n] of fight.members) {
    const def = ENEMY[id];
    const lv = stageLevel(stage, fight, id, p.level);
    const est = F.enemyStats(def, lv, diff);
    for (let i = 0; i < n; i++) members.push({ id, def, lv, est });
  }
  const totalHp = members.reduce((s, m) => s + m.est.hp, 0);
  const alone = members.length === 1;
  // Iterate the fight length (the Ora budget depends on it).
  let T = 30;
  let dps = 0;
  let ttkOne = 0;
  let switchT = 0;
  for (const m of members) switchT += m.def.brain === 'ranged' || m.def.movement === 'fly' ? MODEL.switchSeconds.ranged : MODEL.switchSeconds.melee;
  for (let it = 0; it < 4; it++) {
    const ora = oraBudget(p, T);
    let sum = 0;
    let sumOne = 0;
    for (const m of members) {
      const fg = m.def.frontGuard ? 0.5 + 0.5 * m.def.frontGuard.damageMult : 1;
      const d = playerDps(p, m.est, ora, stage.unlocks, prof.uptime.group, fg);
      sum += d.single * (members.length > 1 ? MODEL.cleave : 1) + d.area * Math.min(members.length, 4) * 0.8;
      sumOne += m.est.hp / Math.max(1e-6, d.single + d.area);
    }
    dps = sum / members.length;
    ttkOne = sumOne / members.length;
    T = totalHp / Math.max(1e-6, dps) + switchT;
  }
  // Damage taken: on average half the group (plus one) is alive; tokens cap the attackers.
  const tok = { melee: Math.floor(row.attackers / 2), ranged: Math.ceil(row.attackers / 2) };
  const aliveShare = (members.length + 1) / (2 * members.length);
  let inMelee = 0;
  let inRanged = 0;
  const per = { melee: [], ranged: [] };
  for (const m of members) {
    const kind = m.def.brain === 'ranged' ? 'ranged' : 'melee';
    per[kind].push(enemyPowerPerSec(m.def, { alone }) * enemyPerPower(p, m.est, diff));
  }
  for (const kind of ['melee', 'ranged']) {
    const arr = per[kind];
    if (!arr.length) continue;
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const n = Math.min(tok[kind], arr.length * aliveShare);
    if (kind === 'melee') inMelee = mean * n; else inRanged = mean * n;
  }
  const dpsIn = (inMelee + inRanged) * hitRate;
  // The last enemy of a group fights alone: one use of its `alone` move (the wisp's self-destructing dive, which
  // usually lands: the wisp is gone either way, so it is counted in full).
  let lastBlow = 0;
  const last = members[members.length - 1];
  for (const id of last.def.techs) {
    const t = TECH[id];
    if (t && t.ai.alone) lastBlow = Math.max(lastBlow, techPower(t) * enemyPerPower(p, last.est, diff));
  }
  return {
    id: fight.id, levels: [...new Set(members.map((m) => m.lv))].join('/'), n: members.length,
    ttkOne, ttkGroup: T, dpsIn, hpLost: dpsIn * T + lastBlow, ttd: p.stats.hpMax / Math.max(1e-6, dpsIn),
    hitsToDie: members.map((m) => p.stats.hpMax / (B.enemyScale.referenceHitPower * enemyPerPower(p, m.est, diff)))[0],
  };
}

/** A boss fight: fight length, damage taken and the healing items it costs. */
export function bossFight(p, stage, bossId, diff, prof = MODEL.profiles.player) {
  const hitRate = prof.hitRate;
  const bd = BOSS[bossId];
  const def = ENEMY[bossId];
  const extraHp = bossId === 'vorrhal' ? 1 + bd.hpPerSiphonStanding * 1 : 1;
  const est = F.enemyStats(def, bd.level, diff, { hpMult: bd.hpMult * extraHp, poise: bd.poise });
  let T = 90;
  let dps = 0;
  let dpsIn = 0;
  const phases = bd.phases;
  for (let it = 0; it < 4; it++) {
    const ora = oraBudget(p, T);
    dps = 0;
    dpsIn = 0;
    for (let i = 0; i < phases.length; i++) {
      const share = phases[i].hpBelow - (i + 1 < phases.length ? phases[i + 1].hpBelow : 0);
      const defMult = phases[i].defMult || 1;
      const t = Object.assign({}, est, { defense: est.defense * defMult });
      const fg = def.frontGuard && i === 0 ? 0.5 + 0.5 * def.frontGuard.damageMult : 1;
      const d = playerDps(p, t, ora, stage.unlocks, prof.uptime.boss, fg);
      dps += share / (d.single + d.area);
      dpsIn += share * enemyPowerPerSec(def, { techs: phases[i].techs, speedMult: phases[i].speedMult });
    }
    dps = 1 / dps;
    T = est.hp / dps;
    // A Ringfall per fight once unlocked (Surge fills during a boss fight).
    if (stage.unlocks.indexOf('ringfall') >= 0) T = Math.max(1, (est.hp - B.tech.ringfall.powerCentre * perPower(p, 'ora', est)) / dps);
  }
  let taken = dpsIn * enemyPerPower(p, est, diff) * hitRate * T;
  // Adds: Durn's acolytes at 50%, Vorrhal's Vanguards in phase 2.
  let addsHp = 0;
  const addGroup = bd.adds ? GROUP[bd.adds.group] : bd.phases.some((ph) => ph.summon) ? GROUP[bd.phases.find((ph) => ph.summon).summon] : null;
  if (addGroup) {
    const fight = { id: addGroup.id, members: addGroup.members.map((m) => [m.enemy, m.count]), level: bd.level };
    const g = groupFight(p, stage, fight, diff, prof);
    addsHp = g.ttkGroup;
    T += g.ttkGroup;
    taken += g.hpLost;
  }
  const hp = p.stats.hpMax;
  const heal = 0.30 * hp * (1 + F.mod(p.mods, 'healPct'));
  const heals = Math.max(0, Math.ceil((taken - MODEL.healAt * hp) / heal));
  return { id: bossId, level: bd.level, hp: est.hp, length: T, addsSeconds: addsHp, taken, heals, hpMax: hp };
}

// ---------------------------------------------------------------- economy

/** Shells earned on the route up to a minute (kills at the band rate, quests, bosses, chests). */
export function shellsBy(minute, levelAt, diff = 'warrior', stageId = null) {
  let s = 0;
  const reward = F.difficultyRow(diff).reward;
  for (const band of B.route.bands) {
    const to = Math.min(minute, band.to);
    for (let m = band.from; m < to; m++) s += band.killsPerMin * F.enemyShells({ mult: { shells: 1.1 } }, levelAt(m), diff);
    const share = Math.max(0, Math.min(1, (minute - band.from) / (band.to - band.from)));
    const tier = band.id === 'A' ? 'chest_t1' : band.id === 'B' ? 'chest_t2' : 'chest_t3';
    const ch = B.loot[tier].shells;
    s += Math.floor(MODEL.chests[band.id] * share) * (ch.min + ch.max) / 2;
  }
  if (stageId) {
    for (const q of QUESTS_BEFORE[stageId]) s += (B.quests[q].shells || 0) * 1;
    for (const b of BOSSES_BEFORE[stageId]) s += B.loot.boss.shells.perIndex * B.bosses[b].index * reward;
  }
  return Math.round(s);
}

/** Shells spent on the shop gear and the healing items bought by a stage. */
export function spentBy(stageId, levelAt) {
  let s = 0;
  for (const [shop, item] of BUYS[stageId] || []) s += Math.round(F.itemPrice(B.gear[item].rarity, SHOP[shop].level) * SHOP[shop].priceMult);
  for (const st of STAGES) {
    if (st.id === stageId) break;
    if (st.boss) s += MODEL.sunfruitPerBoss * F.consumablePrice('sunfruit', levelAt(st.minute));
  }
  return s;
}

/** Shells per hour at a level on the route (kills at the band rate plus chests), for the GDD 10.1 pacing. */
export function shellsPerHour(level) {
  const band = level <= 10 ? B.route.bands[1] : B.route.bands[2];
  const kills = band.killsPerMin * 60 * F.enemyShells({ mult: { shells: 1.1 } }, level);
  const tier = band.id === 'B' ? 'chest_t2' : 'chest_t3';
  const ch = B.loot[tier].shells;
  const chests = MODEL.chests[band.id] * 60 / (band.to - band.from) * (ch.min + ch.max) / 2;
  return Math.round(kills + chests);
}

// ---------------------------------------------------------------- table

/** The realistic profile of a difficulty's typical player. */
export function profileFor(diff) {
  return diff === 'story' ? MODEL.profiles.story : diff === 'master' ? MODEL.profiles.master : MODEL.profiles.player;
}

/** Run the main path for a difficulty. */
export function run(diff = 'warrior', prof = MODEL.profiles.player) {
  const route = diff === 'master'
    ? Object.assign({}, B.route, { bands: B.route.bands.map((b) => Object.assign({}, b, { xpMult: b.xpMult * B.difficulty.master.reward })) })
    : B.route;
  const sim = F.simulateRoute(route);
  const levelAt = (m) => (sim.find((e) => e.minute >= Math.floor(m)) || sim[sim.length - 1]).level;
  const rows = [];
  for (const stage of STAGES) {
    const L = levelAt(stage.minute);
    const p = playerAt(stage, L, prof.nodes);
    const fights = stage.fights.map((f) => groupFight(p, stage, f, diff, prof));
    const boss = stage.boss ? bossFight(p, stage, stage.boss, diff, prof) : null;
    const band = REGION[stage.region].levels;
    const ember = B.forms.ember;
    rows.push({
      stage: stage.id, minute: stage.minute, region: stage.region, band, regionLevel: F.regionLevel(band, stage.t), level: L,
      hp: p.stats.hpMax, ora: p.stats.oraMax, def: p.stats.defense, mRating: p.stats.meleeRating, oRating: p.stats.oraRating,
      tp: p.nodes.tp, tpSpent: p.nodes.spent,
      dpsVsSameLevel: playerDps(p, F.enemyStats(ENEMY.choir_acolyte, L, diff), oraBudget(p, 30), stage.unlocks, 1).single,
      fights, boss,
      shells: shellsBy(stage.minute, levelAt, diff, stage.id), spent: spentBy(stage.id, levelAt),
      emberSeconds: (p.stats.oraMax - ember.cost) / ember.drain,
      gatherRefill: p.stats.oraMax / F.gatherRate(p.base.spr, p.mods),
    });
  }
  return { diff, rows, levelAt };
}

/** Same-level grunt checks of GDD 7.1 (Warrior, typical allocation, no gear). */
export function gruntTargets(level) {
  const p = playerAt({ id: 'none', minute: 0, gear: [], unlocks: [] }, level);
  const ss = B.tech.strike_string;
  const strPower = ss.hits.reduce((s, h) => s + h.power, 0);
  const out = {};
  for (const id of ['tusk_boar', 'choir_acolyte']) {
    const est = F.enemyStats(ENEMY[id], level, 'warrior');
    out[id] = { strings: est.hp / (strPower * perPower(p, 'melee', est)), hits: p.stats.hpMax / (B.enemyScale.referenceHitPower * enemyPerPower(p, est, 'warrior')) };
  }
  return out;
}

/**
 * The three browser check points (tools/scenarios/balance.mjs), bot profile, Warrior: the page setup, the fight and
 * the simulated time to kill and HP lost (% of max).
 */
export function checks(diff = 'warrior') {
  const prof = MODEL.profiles.bot;
  const out = {};
  const mk = (key, stage, level, fight, setup, maxSeconds, boss) => {
    const p = playerAt(stage, level, false);
    let ttk;
    let lost;
    if (boss) {
      const b = bossFight(p, stage, boss, diff, prof);
      ttk = b.length;
      lost = b.taken;
    } else {
      const g = groupFight(p, stage, fight, diff, prof);
      ttk = g.ttkGroup;
      lost = g.hpLost;
    }
    const members = [];
    if (fight) for (const [id, n] of fight.members) for (let i = 0; i < n; i++) members.push(id);
    out[key] = {
      setup: Object.assign({ difficulty: diff, level, gear: stage.gear }, setup),
      fight: fight ? { members, enemyLevel: fight.level, dist: 9 } : null,
      maxSeconds, expect: { ttk, lostPct: 100 * lost / p.stats.hpMax },
    };
  };
  const st = Object.fromEntries(STAGES.map((s) => [s.id, s]));
  const meadows = { id: 'check_a', minute: 8, region: 'meadows', t: 0.2, unlocks: [], gear: [['training_wraps', 1], ['apprentice_garb', 1]] };
  mk('meadows', meadows, 2, { id: 'wisps', members: [['ember_wisp', 3]], level: 2 }, { x: -1150, z: 1250 }, 90);
  // The wisp complaint: a level-3 player who only uses Attack against higher-level wisps of the outer Meadows.
  mk('wisps', Object.assign({}, meadows, { t: 1 }), 3, { id: 'wisps_l6', members: [['ember_wisp', 3]], level: REGION.meadows.levels[1] },
    { x: -1150, z: 1250, attackOnly: true }, 90);
  const mq3 = Object.assign({}, st.MQ3, { unlocks: ['nova_ring'] });
  const L3 = run(diff).levelAt(mq3.minute);
  const n = B.tech.nova_ring;
  mk('camp', mq3, L3, { id: 'camp_thornwood', members: [['bramble_boar', 2], ['choir_acolyte', 2]], level: F.regionLevel(REGION.thornwood.levels, mq3.t) },
    { x: -2200, z: -400, slot: 'nova_ring', slotCooldown: n.cooldown + 0.5, slotOra: n.ora, slotRange: n.radius - 2 }, 120);
  const mq2 = Object.assign({}, st.MQ2, { unlocks: [] });
  mk('durn', mq2, run(diff).levelAt(mq2.minute), null, { x: -1150, z: 1250 }, 240, 'durn');
  return out;
}

const fmt = (v, d = 0) => (typeof v === 'number' ? v.toFixed(d) : String(v));
const pad = (s, n) => String(s).padEnd(n);

/** Print the table. */
export function print(res) {
  const lines = [];
  lines.push(`\n=== ${res.diff.toUpperCase()} ===`);
  lines.push(pad('stage', 8) + pad('min', 5) + pad('region', 11) + pad('band', 7) + pad('PL', 4) + pad('HP', 5) + pad('Ora', 5) + pad('DEF', 5) + pad('mRat', 6) + pad('TP', 7) + pad('dps', 6) + pad('Shells', 12) + 'Ember s / gather s');
  for (const r of res.rows) {
    lines.push(pad(r.stage, 8) + pad(r.minute, 5) + pad(r.region, 11) + pad(r.band.join('-'), 7) + pad(r.level, 4) + pad(r.hp, 5) + pad(r.ora, 5) + pad(fmt(r.def), 5) + pad(r.mRating, 6)
      + pad(r.tpSpent + '/' + r.tp, 7) + pad(fmt(r.dpsVsSameLevel), 6) + pad(r.shells + '-' + r.spent, 12) + fmt(r.emberSeconds) + ' / ' + fmt(r.gatherRefill, 1));
    for (const f of r.fights) {
      lines.push('    ' + pad(f.id, 18) + pad('L' + f.levels, 8) + pad('x' + f.n, 4) + 'ttk1 ' + pad(fmt(f.ttkOne, 1), 6) + 'group ' + pad(fmt(f.ttkGroup, 1) + 's', 8)
        + 'in ' + pad(fmt(f.dpsIn, 1) + '/s', 9) + 'lost ' + pad(fmt(f.hpLost) + ' (' + fmt(100 * f.hpLost / r.hp) + '%)', 13) + 'ttd ' + fmt(f.ttd) + 's');
    }
    if (r.boss) {
      const b = r.boss;
      lines.push('    ' + pad('BOSS ' + b.id, 18) + pad('L' + b.level, 8) + pad('hp ' + b.hp, 10) + 'length ' + pad(fmt(b.length) + 's', 7) + '(adds ' + fmt(b.addsSeconds) + 's) taken '
        + fmt(b.taken) + ' (' + fmt(100 * b.taken / b.hpMax) + '% HP)  heals ' + b.heals);
    }
  }
  return lines.join('\n');
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const di = args.indexOf('--difficulty');
  const diffs = di >= 0 ? [args[di + 1]] : ['story', 'warrior', 'master'];
  const out = diffs.map((d) => run(d, profileFor(d)));
  if (args.includes('--json')) {
    console.log(JSON.stringify(out.map((o) => ({ diff: o.diff, rows: o.rows })), null, 1));
  } else {
    for (const o of out) console.log(print(o));
    console.log('\nGDD 7.1 same-level grunt targets (strings to kill 1-2, hits survived 9-18):');
    for (const L of [1, 5, 10, 20, 30]) {
      const g = gruntTargets(L);
      console.log(`  L${L}: ` + Object.entries(g).map(([id, v]) => `${id} ${v.strings.toFixed(2)} strings, ${v.hits.toFixed(1)} hits`).join('; '));
    }
    console.log(`\nShells per hour: L10 ${shellsPerHour(10)} (GDD ~600), L25 ${shellsPerHour(25)} (GDD ~2500)`);
    console.log(`TP: total P0 node cost ${totalNodeCost()} (GDD 55); sources 39 + ${B.tp.shrines} + ${Object.values(B.quests).reduce((s, q) => s + (q.tp || 0), 0)}`);
  }
}
