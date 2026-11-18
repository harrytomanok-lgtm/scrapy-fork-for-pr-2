import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefs } from '../../src/core/defs.js';
import { IDS } from '../../src/core/ids.js';
import { STRINGS } from '../../src/core/strings.js';
import { BALANCE } from '../../src/core/balance.js';
import { createStream } from '../../src/core/rng.js';
import { standinDefs } from '../../src/standins/content.js';
import { playerTechniques } from '../../src/combat/data/techniques.js';
import { aiTechniques } from '../../src/ai/data/techniques.js';
import { enemies, bosses, GROUPS, SPAWN_TABLES } from '../../src/ai/data/enemies.js';
import { AI_STRINGS } from '../../src/ai/strings.js';
import { createDirector, tokenLimits } from '../../src/ai/logic/director.js';
import { createBrain, createSense, techEntries, think, started, pickTech } from '../../src/ai/logic/brain.js';
import { pickEntry, entryValid, enemyLevel, campAvailable, phaseFor, createPendingBoss, ambientTarget } from '../../src/ai/logic/spawning.js';
import { createAi } from '../../src/ai/service.js';

const MINE = { technique: aiTechniques(), enemy: enemies(), boss: bosses(), group: GROUPS, spawnTable: SPAWN_TABLES };

function registry() {
  const defs = createDefs({ strict: true });
  const all = standinDefs();
  for (const kind of Object.keys(all)) defs.register(kind, all[kind]);
  defs.register('technique', playerTechniques());
  for (const kind of Object.keys(MINE)) defs.register(kind, MINE[kind]);
  return defs;
}

// ---------------------------------------------------------------- definitions

test('defs.validate passes with the ai content over the stand-ins', () => {
  const r = registry().validate({ throwOnError: false });
  assert.deepEqual(r.errors, []);
});

test('every IDS id of the kinds ai owns is defined', () => {
  const defs = registry();
  for (const kind of ['enemy', 'boss', 'group', 'spawnTable']) {
    for (const id of IDS[kind]) assert.ok(MINE[kind].some((d) => d.id === id), kind + ' ' + id + ' is defined by ai');
  }
  const enemyTechIds = IDS.technique.filter((id) => !playerTechniques().some((t) => t.id === id));
  for (const id of enemyTechIds) assert.ok(MINE.technique.some((t) => t.id === id), 'technique ' + id);
  assert.ok(defs.find('enemy', 'choir_acolyte'));
});

test('every technique an enemy or boss lists exists, is an enemy technique and has a telegraph', () => {
  const byId = new Map(MINE.technique.map((t) => [t.id, t]));
  const check = (owner, id) => {
    const t = byId.get(id);
    assert.ok(t, owner + ' lists unknown technique ' + id);
    assert.equal(t.user, 'enemy', id + ' is an enemy technique');
    assert.ok(t.telegraph && ['white', 'red', 'violet'].includes(t.telegraph.kind), id + ' has a telegraph');
    assert.ok(t.ai && t.ai.maxRange >= t.ai.minRange, id + ' has an ai block');
  };
  for (const e of MINE.enemy) for (const id of e.techs) check(e.id, id);
  for (const b of MINE.boss) for (const ph of b.phases) for (const t of ph.techs) check(b.id, t.id);
});

test('enemy windups lie in the GDD bands (0.5-1.2 s, bosses 0.8-2.0 s)', () => {
  const bossTechs = new Set();
  for (const b of MINE.boss) for (const ph of b.phases) for (const t of ph.techs) bossTechs.add(t.id);
  for (const t of MINE.technique) {
    const band = bossTechs.has(t.id) ? BALANCE.combat.telegraph.bossWindup : BALANCE.combat.telegraph.windup;
    assert.ok(t.timeline.windup >= band[0] - 1e-9 && t.timeline.windup <= band[1] + 1e-9, t.id + ' windup ' + t.timeline.windup);
  }
});

test('the nine roster enemies match GDD 7.2 (brain, movement, multipliers) and the boss enemies are tier boss', () => {
  const roster = MINE.enemy.filter((e) => e.tier !== 'boss');
  assert.equal(roster.length, 9);
  for (const e of roster) {
    const b = BALANCE.enemies[e.id];
    assert.equal(e.brain, b.brain);
    assert.equal(e.movement, b.movement);
    assert.deepEqual(e.mult, b.mult);
    assert.ok(e.regions.length > 0);
  }
  for (const b of MINE.boss) {
    const e = MINE.enemy.find((x) => x.id === b.enemyId);
    assert.equal(e.tier, 'boss');
    assert.equal(e.brain, 'boss');
    assert.equal(b.phases.length, BALANCE.bosses[b.id].phases.length);
  }
});

test('quest groups satisfy the quest kill counts and are tagged by the quests', () => {
  const size = (id) => GROUPS.find((g) => g.id === id).members.reduce((n, m) => n + m.count, 0);
  assert.equal(size('mq2_raid'), 4);
  assert.equal(size('mq4_wave'), 8);
  assert.ok(size('mq7_gate') >= 3);
  assert.equal(size('durn_adds'), BALANCE.bosses.durn.adds);
  assert.equal(size('vorrhal_adds'), BALANCE.bosses.vorrhal.adds);
});

test('ai strings exist in both languages', () => {
  for (const k of Object.keys(AI_STRINGS.en)) assert.ok(k in AI_STRINGS.he, k);
  for (const b of MINE.boss) {
    for (const ph of b.phases) for (const a of ph.onEnter || []) if (a.op === 'banner') assert.ok(a.key in AI_STRINGS.en, a.key);
    assert.ok(b.intro.lineKey in AI_STRINGS.en);
    assert.ok(('boss.' + b.id + '.title') in STRINGS.en);
  }
});

// ---------------------------------------------------------------- director

test('token limits by difficulty: Story 2, Warrior 2+2, Master 6', () => {
  assert.deepEqual(tokenLimits(4), { melee: 2, ranged: 2 });
  assert.deepEqual(tokenLimits(2), { melee: 1, ranged: 1 });
  assert.deepEqual(tokenLimits(6), { melee: 3, ranged: 3 });
});

test('the director never exceeds the difficulty limits in a simulated crowd', () => {
  for (const diff of ['story', 'warrior', 'master']) {
    const attackers = BALANCE.difficulty[diff].attackers;
    const d = createDirector();
    d.setAttackers(attackers);
    const rng = createStream(7);
    const holdUntil = new Map();
    let now = 0;
    let peak = 0;
    for (let tick = 0; tick < 6000; tick++) {
      now += 1 / 60;
      for (let id = 1; id <= 24; id++) {
        const until = holdUntil.get(id);
        if (until !== undefined && now >= until) {
          d.release(id, now);
          holdUntil.delete(id);
        }
        if (until === undefined && rng.next() < 0.05) {
          const kind = rng.next() < 0.5 ? 'melee' : 'ranged';
          if (d.request(id, kind, now)) holdUntil.set(id, now + 0.5 + rng.next() * 2);
        }
      }
      const total = d.count('melee') + d.count('ranged');
      assert.ok(d.count('melee') <= d.limits.melee && d.count('ranged') <= d.limits.ranged, diff + ' per-kind limits');
      assert.ok(total <= attackers, diff + ' total ' + total);
      peak = Math.max(peak, total);
    }
    assert.equal(peak, attackers, diff + ' reaches its limit under pressure');
  }
});

test('the director makes released holders wait their turn and expires stuck holders', () => {
  const d = createDirector({ rest: 1, maxHold: 3 });
  d.setAttackers(2);
  assert.equal(d.request(1, 'melee', 0), true);
  assert.equal(d.request(2, 'melee', 0), false);
  d.release(1, 0.5);
  assert.equal(d.request(1, 'melee', 0.6), false, 'resting');
  assert.equal(d.request(2, 'melee', 0.6), true);
  assert.equal(d.request(3, 'ranged', 0.6), true);
  assert.equal(d.request(4, 'ranged', 0.7), false);
  assert.equal(d.request(4, 'ranged', 4), true, 'the stuck holder lost it');
});

// ---------------------------------------------------------------- spawn tables and levels

test('spawn-table selection respects weights and level bands', () => {
  const band = (id) => BALANCE.enemies[id].levels;
  const meadows = SPAWN_TABLES.find((t) => t.id === 'meadows');
  const counts = [0, 0, 0];
  const rng = createStream(3);
  for (let i = 0; i < 9000; i++) counts[pickEntry(meadows.entries, band, 4, rng.next())]++;
  const total = meadows.entries.reduce((n, e) => n + e.weight, 0);
  meadows.entries.forEach((e, i) => assert.ok(Math.abs(counts[i] / 9000 - e.weight / total) < 0.03, e.enemy + ' share'));
  // Level 1: the acolyte (minLevel 2) is excluded.
  for (let i = 0; i < 500; i++) assert.notEqual(meadows.entries[pickEntry(meadows.entries, band, 1, rng.next())].enemy, 'choir_acolyte');
  // Frostspine below 22: no Vanguard.
  const frost = SPAWN_TABLES.find((t) => t.id === 'frostspine');
  for (let i = 0; i < 500; i++) assert.notEqual(frost.entries[pickEntry(frost.entries, band, 20, rng.next())].enemy, 'choir_vanguard');
  // A filter (silenced Siphon) can remove the Choir.
  for (let i = 0; i < 500; i++) {
    const k = pickEntry(meadows.entries, band, 4, rng.next(), (id) => !id.startsWith('choir'));
    assert.notEqual(meadows.entries[k].enemy, 'choir_acolyte');
  }
  assert.equal(entryValid({ maxLevel: 10 }, [1, 10], 11), false);
  assert.equal(pickEntry([], band, 3, 0.5), -1);
});

test('enemy level by region clamps to the enemy band; every table lists only region enemies', () => {
  assert.equal(enemyLevel(4.4, [1, 8]), 4);
  assert.equal(enemyLevel(12, [1, 8]), 8);
  assert.equal(enemyLevel(0, [2, 28]), 2);
  for (const t of SPAWN_TABLES) {
    for (const e of t.entries) {
      const def = MINE.enemy.find((d) => d.id === e.enemy);
      assert.ok(def.regions.includes(t.id), e.enemy + ' appears in ' + t.id);
    }
  }
  assert.equal(ambientTarget(5, 1.3, true, 12, 10), 2);
  assert.equal(ambientTarget(5, 1.3, false, 12, 0), 5);
});

test('camps refill only after one in-game day', () => {
  assert.equal(campAvailable(undefined, 3), true);
  assert.equal(campAvailable(3, 3), false);
  assert.equal(campAvailable(3, 3.9), false);
  assert.equal(campAvailable(3, 4), true);
});

// ---------------------------------------------------------------- bosses

test('boss phase selection by HP thresholds never goes back', () => {
  const v = MINE.boss.find((b) => b.id === 'vorrhal');
  assert.equal(phaseFor(v.phases, 1), 0);
  assert.equal(phaseFor(v.phases, 0.61), 0);
  assert.equal(phaseFor(v.phases, 0.59), 1);
  assert.equal(phaseFor(v.phases, 0.2), 2);
  assert.equal(phaseFor(v.phases, 0.9, 2), 2);
  const d = MINE.boss.find((b) => b.id === 'durn');
  assert.equal(phaseFor(d.phases, 0.01), 0);
  assert.ok(v.phases[2].onEnter.some((a) => a.op === 'script' && a.script === 'finale_tethers'));
  assert.equal(v.phases[1].summon, 'vorrhal_adds');
});

test('the pending-boss state machine: start, reset, re-enter, retry, defeat', () => {
  const s = createPendingBoss();
  assert.equal(s.restart(true, true, false), null, 'nothing pending');
  s.start('bramblehorn');
  assert.equal(s.restart(true, true, false), null, 'already spawned');
  s.reset();
  assert.equal(s.pending, 'bramblehorn', 'still pending after a reset');
  assert.equal(s.restart(false, true, false), null, 'outside the arena');
  assert.equal(s.restart(true, false, false), null, 'dead player');
  assert.equal(s.restart(true, true, false), 'bramblehorn', 're-entry');
  s.start('bramblehorn');
  s.reset();
  assert.equal(s.restart(false, true, true), 'bramblehorn', 'retry');
  s.start('bramblehorn');
  s.defeat();
  assert.equal(s.pending, null);
  s.reset();
  assert.equal(s.restart(true, true, true), null, 'cleared on defeat');
  s.start('iskra');
  s.end();
  assert.equal(s.pending, null, 'cleared on game:ended');
});

test('several bosses can be pending: a second quest boss never orphans the first (S1)', () => {
  const s = createPendingBoss();
  const arenas = { bramblehorn: false, gorrumaw: false };
  const inArena = (id) => arenas[id];
  s.start('bramblehorn');
  s.reset(); // the player flew off: Bramblehorn waits
  s.start('gorrumaw'); // MQ5's boss starts
  assert.deepEqual(s.ids, ['bramblehorn', 'gorrumaw']);
  s.reset();
  arenas.bramblehorn = true;
  assert.equal(s.restart(inArena, true, false), 'bramblehorn', 'back at Bramble Hollow');
  arenas.bramblehorn = false;
  arenas.gorrumaw = true;
  assert.equal(s.restart(inArena, true, false), 'gorrumaw');
  s.start('gorrumaw');
  assert.equal(s.restart(inArena, true, false), null, 'one boss spawned at a time');
  s.defeat('gorrumaw');
  assert.deepEqual(s.ids, ['bramblehorn'], 'only the defeated boss is cleared');
  assert.equal(s.restart(inArena, true, true), 'bramblehorn', 'Retry falls back to a pending boss');
  arenas.bramblehorn = true;
  assert.equal(s.restart(inArena, true, false), 'bramblehorn');
});

// ---------------------------------------------------------------- brains

/** A harness that runs one brain against a scripted world. */
function rig(enemyId, o = {}) {
  const def = MINE.enemy.find((d) => d.id === enemyId);
  const techs = techEntries(def.techs, (id) => MINE.technique.find((t) => t.id === id));
  const flyer = def.movement !== 'ground';
  const b = createBrain(def.brain, def.params, techs, { x: 0, y: 0, z: 0 }, { flyer, seed: 1 });
  const s = createSense();
  s.flyer = flyer; s.groundOnly = !flyer;
  const rng = createStream(11);
  const tokens = { melee: o.melee !== undefined ? o.melee : 1, ranged: o.ranged !== undefined ? o.ranged : 1, held: 0 };
  const api = {
    rand: () => rng.next(),
    ready: () => true,
    request: (k) => {
      if (tokens[k] > 0) { tokens[k]--; tokens.held = k; return true; }
      return false;
    },
    release: () => {
      if (tokens.held) { tokens[tokens.held]++; tokens.held = 0; }
    },
  };
  return { b, s, api, tokens, def };
}

function place(s, dist, o = {}) {
  s.hasTarget = o.target !== false;
  s.x = 0; s.z = 0; s.y = o.y || 0; s.alt = o.alt !== undefined ? o.alt : s.y;
  s.tx = dist; s.tz = 0; s.ty = o.ty || 0;
  s.dist = dist; s.dy = s.ty - s.y; s.tAir = s.ty > 3;
  s.homeDist = o.home || 0; s.homeDx = 0; s.homeDz = 0;
}

test('melee brain: idle -> alert -> approach -> attack -> recover -> circle', () => {
  const { b, s, api } = rig('choir_acolyte');
  const seen = [];
  const log = () => { if (seen[seen.length - 1] !== b.state) seen.push(b.state); };
  place(s, 30, { target: false });
  think(b, s, api); log();
  place(s, 30);
  for (let i = 0; i < 6; i++) { s.now += 0.1; think(b, s, api); log(); }
  assert.ok(b.mx > 0.5, 'approaches the target');
  let dist = 30;
  let acted = false;
  for (let i = 0; i < 80 && !acted; i++) {
    s.now += 0.1;
    dist = Math.max(2, dist - 1.5);
    place(s, dist);
    think(b, s, api); log();
    if (b.act) {
      acted = true;
      assert.ok(['acolyte_string', 'acolyte_rush'].includes(b.act));
      started(b); log();
    }
  }
  assert.ok(acted, 'attacks');
  s.busy = true;
  for (let i = 0; i < 5; i++) { s.now += 0.1; think(b, s, api); log(); }
  assert.equal(b.state, 'recover', 'waits while the technique runs');
  s.busy = false;
  for (let i = 0; i < 3; i++) { s.now += 0.1; think(b, s, api); log(); }
  assert.deepEqual(seen.slice(0, 4), ['idle', 'alert', 'approach', 'circle']);
  assert.ok(seen.indexOf('attack') > 0 && seen.indexOf('recover') > seen.indexOf('attack'), seen.join(' > '));
  assert.equal(seen[seen.length - 1], 'circle');
});

test('melee brain without a token circles and never attacks', () => {
  const { b, s, api } = rig('choir_acolyte', { melee: 0, ranged: 0 });
  place(s, 6);
  b.state = 'circle';
  for (let i = 0; i < 100; i++) {
    s.now += 0.1;
    think(b, s, api);
    assert.equal(b.act, null);
    assert.notEqual(b.state, 'attack');
  }
  assert.ok(Math.abs(b.mx) + Math.abs(b.mz) > 0.1, 'it keeps moving (strafes)');
});

test('ranged brain keeps its range band', () => {
  const { b, s, api, def } = rig('choir_caster', { ranged: 0 });
  b.state = 'circle';
  place(s, 6);
  s.y = 3; s.alt = 3;
  think(b, s, api);
  assert.ok(b.mx < 0, 'too close: backs away');
  place(s, 60);
  think(b, s, api);
  assert.ok(b.mx > 0, 'too far: closes in');
  // Simulated 1D: the distance settles inside the band.
  let d = 4;
  for (let i = 0; i < 300; i++) {
    s.now += 0.1;
    place(s, d);
    think(b, s, api);
    d -= b.mx * 0.7;
  }
  assert.ok(d >= def.params.prefer[0] - 1 && d <= def.params.prefer[1] + 1, 'settles at ' + d.toFixed(1));
});

test('diver cycle: circle high -> dive -> recover -> climb -> circle', () => {
  const { b, s, api } = rig('frost_harrier');
  b.state = 'circle';
  const seen = ['circle'];
  for (let i = 0; i < 120; i++) {
    s.now += 0.1;
    place(s, 16, { y: 20, alt: 20 });
    think(b, s, api);
    assert.ok(Number.isNaN(b.wantY) || b.wantY >= 15, 'stays high');
    if (b.act) {
      assert.ok(['harrier_dive', 'harrier_gust'].includes(b.act));
      started(b);
    }
    if (seen[seen.length - 1] !== b.state) seen.push(b.state);
  }
  const str = seen.join(' > ');
  assert.ok(/circle > attack > recover > climb > circle/.test(str), str);
});

test('ground-versus-flyer: a ground enemy throws at a hovering target, then disengages and heals', () => {
  const { b, s, api } = rig('choir_acolyte', { melee: 1, ranged: 1 });
  b.state = 'circle';
  let threw = false;
  let disengaged = false;
  let healed = false;
  for (let i = 0; i < 100; i++) {
    s.now += 0.1;
    place(s, 6, { ty: 15 });
    think(b, s, api);
    if (b.act) {
      assert.equal(b.act, 'enemy_rock', 'only the throw reaches a flyer');
      threw = true;
      started(b);
    }
    if (b.ignoreT > 100) {
      disengaged = true;
      healed = b.heal || b.state === 'return';
      break;
    }
  }
  assert.ok(threw, 'throws rocks');
  assert.ok(disengaged, 'disengages after 6 s of hovering');
  assert.ok(b.drop, 'drops the target');
  if (!healed) {
    place(s, 6, { ty: 15, home: 1, target: false });
    think(b, s, api);
    healed = b.heal;
  }
  assert.ok(healed, 'restored at its post');
});

test('flee and regroup: a hurt acolyte runs, then rejoins its allies', () => {
  const { b, s, api } = rig('choir_acolyte');
  b.state = 'circle';
  place(s, 5);
  s.hpFrac = 0.1;
  think(b, s, api);
  assert.equal(b.state, 'flee');
  assert.ok(b.mx < 0, 'runs away');
  for (let i = 0; i < 31; i++) { s.now += 0.1; think(b, s, api); }
  assert.equal(b.state, 'regroup');
  s.allies = 1; s.allyDist = 20; s.allyDx = 0; s.allyDz = 1;
  s.now += 0.1;
  think(b, s, api);
  assert.ok(b.mz > 0.5, 'heads to the allies');
});

test('leash: beyond the leash the brain gives up and walks home', () => {
  const { b, s, api } = rig('tusk_boar');
  b.state = 'circle';
  place(s, 10, { home: 200 });
  s.homeDx = -1;
  think(b, s, api);
  assert.equal(b.state, 'return');
  assert.ok(b.drop);
  assert.ok(b.mx < 0);
});

test('pickTech: the wisp dives only when alone; charger charges from range', () => {
  const w = rig('ember_wisp');
  place(w.s, 10, { y: 5, alt: 5 });
  w.s.allies = 2;
  for (let i = 0; i < 50; i++) assert.notEqual(w.b.techs[pickTech(w.b, w.s, w.api, false)].id, 'wisp_dive');
  const c = rig('tusk_boar');
  place(c.s, 12);
  for (let i = 0; i < 50; i++) assert.equal(c.b.techs[pickTech(c.b, c.s, c.api, false)].id, 'boar_charge');
});

// ---------------------------------------------------------------- service: body removal

function fakeCtx() {
  const lists = { enemy: [], boss: [], player: [], object: [], npc: [] };
  const byId = new Map();
  let nextId = 1;
  const events = [];
  const vec = () => ({ x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
  const ctx = {
    flags: { test: 1 },
    log: { warn() {} },
    time: { now: 0, tick: 0, scale: 1 },
    rng: { sim: createStream(1) },
    defs: registry(),
    store: { state: { world: { camps: {}, siphons: [] } }, set() {} },
    bus: { emit: (type, p) => events.push({ type, p: Object.assign({}, p) }), post: (type, p) => events.push({ type, p: Object.assign({}, p) }) },
    ents: {
      create(kind) {
        const e = { id: nextId++, kind, alive: true, team: 0, defId: '', pos: vec(), prev: vec(), vel: vec(), yaw: 0, radius: 0.5, height: 1.8, level: 1,
          intent: null, move: null, stats: null, combat: null, brain: null, visual: null, data: null, questTag: null, tags: 0, nameKey: null };
        lists[kind].push(e);
        byId.set(e.id, e);
        return e;
      },
      destroy(id) { const e = byId.get(id); if (e) e.alive = false; byId.delete(id); },
      get: (id) => byId.get(id) || null,
      list: (k) => lists[k] || [],
    },
    actors: { create() {}, play() {} },
    move: { initActor(e) { e.intent = { mx: 0, mz: 0, up: 0, jump: false, sprint: false, flyToggle: false, faceYaw: null }; e.move = { mode: 'ground', groundY: 0 }; } },
    combat: { initActor(e) { e.combat = { state: 'idle', targetId: 0 }; }, registerScript() {}, heal() {}, canUse: () => true },
    world: null, player: null,
  };
  return { ctx, events };
}

test('body removal ignores entities ai did not spawn', () => {
  const { ctx, events } = fakeCtx();
  const s = createAi(ctx);
  const mine = s.ai.spawn('tusk_boar', 0, 0, 0, { level: 2 });
  const other = ctx.ents.create('enemy');
  other.defId = 'tusk_boar';
  const obj = ctx.ents.create('object');
  for (const e of [mine, other, obj]) s.on.died({ entId: e.id, kind: e.kind, defId: e.defId });
  ctx.time.now = 2;
  s.spawnerSystem.step({ ...ctx, time: ctx.time, ents: ctx.ents, player: null }, 1 / 60);
  const removed = events.filter((e) => e.type === 'actor:removed').map((e) => e.p.entId);
  assert.deepEqual(removed, [mine.id]);
  assert.equal(other.alive, true);
  assert.equal(obj.alive, true);
});
