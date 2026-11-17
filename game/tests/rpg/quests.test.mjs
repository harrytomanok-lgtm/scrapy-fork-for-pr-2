import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../../src/core/store.js';
import { createQuestEngine } from '../../src/rpg/logic/questEngine.js';
import { createDialogueRunner } from '../../src/rpg/logic/dialogue.js';
import { medalFor, siphonOpen } from '../../src/rpg/logic/activity.js';
import { QUESTS } from '../../src/rpg/data/quests.js';

/** A synthetic host: records events and actions, with a tiny inventory. */
function harness(quests, opts = {}) {
  const s = defaultState();
  const events = [];
  const actions = [];
  const entered = [];
  const items = Object.assign({}, opts.items || {});
  const h = {
    s, events, actions, entered, items, level: 1, siphons: 0,
    host: {
      q: () => s.quests,
      quest: (id) => quests.find((q) => q.id === id) || null,
      quests: () => quests,
      level: () => h.level,
      siphons: () => h.siphons,
      flag: (k) => s.quests.flags[k],
      count: (id) => items[id] || 0,
      removeItem: (id, n) => ((items[id] || 0) >= n ? ((items[id] -= n), true) : false),
      emit: (type, p) => events.push([type, Object.assign({}, p)]),
      run: (acts) => {
        for (const a of acts) {
          actions.push(a);
          if (a.op === 'startQuest') h.engine.start(a.quest);
        }
      },
      enter: (qid, step, index, resumed) => entered.push([qid, step.id, resumed]),
      leave: () => {},
    },
  };
  h.engine = createQuestEngine(h.host);
  return h;
}

const Q = (id, steps, o) => Object.assign({ id, kind: 'side', order: 1, prereq: {}, steps, rewards: [{ op: 'giveXp', amount: 10 }] }, o || {});

test('quest engine: every P0 step type completes from synthetic events', () => {
  const quest = Q('t', [
    { id: 'talk', type: 'talk', npc: 'dov', dialogue: 'd' },
    { id: 'goto', type: 'goto', x: 100, z: 0, radius: 10, minAlt: 5 },
    { id: 'kill', type: 'kill', enemy: 'tusk_boar', count: 2 },
    { id: 'tag', type: 'kill', tag: 'raid', count: 1, region: 'meadows' },
    { id: 'defeat', type: 'defeat', boss: 'durn' },
    { id: 'collect', type: 'collect', item: 'rust_core', count: 2 },
    { id: 'deliver', type: 'deliver', item: 'rust_core', count: 2, npc: 'yael' },
    { id: 'interact', type: 'interact', objects: ['bell_1', 'bell_2'] },
    { id: 'destroy', type: 'destroy', object: 'siphon_1' },
    { id: 'tech', type: 'useTechnique', tech: 'nova_ring', count: 2 },
    { id: 'techTag', type: 'useTechnique', tech: 'dawn_lance', count: 2, targetTag: 'pillar' },
    { id: 'reach', type: 'reach', level: 3 },
    { id: 'race', type: 'race', course: 'windmill_run', medal: 'silver' },
    { id: 'script', type: 'script', script: 'x' },
  ]);
  const h = harness([quest]);
  const E = h.engine;
  const step = () => E.current('t') && E.current('t').id;
  const target = (s, out) => { out.x = s.x; out.z = s.z; return true; };
  const tmp = { x: 0, z: 0 };
  assert.ok(E.start('t'));
  assert.equal(E.state('t'), 'active');
  assert.equal(h.s.quests.tracked, 't');
  assert.equal(E.talkStep('mira'), null);
  const ts = E.talkStep('dov');
  assert.equal(ts.step.id, 'talk');
  E.finishTalk(ts.questId, ts.index);
  assert.equal(step(), 'goto');
  E.poll(100, 3, 0, target, tmp);
  assert.equal(step(), 'goto', 'below minAlt');
  E.poll(130, 0, 9, target, tmp);
  assert.equal(step(), 'goto', 'outside the radius');
  E.poll(100, 3, 9, target, tmp);
  assert.equal(step(), 'kill');
  E.onDied({ kind: 'enemy', defId: 'tusk_boar', questTag: null }, false, 'meadows');
  assert.equal(h.s.quests.active.t.counts.kill || 0, 0, 'not by the player: ignored');
  E.onDied({ kind: 'enemy', defId: 'ember_wisp', questTag: null }, true, 'meadows');
  E.onDied({ kind: 'enemy', defId: 'tusk_boar', questTag: null }, true, 'meadows');
  assert.equal(step(), 'kill');
  E.onDied({ kind: 'enemy', defId: 'tusk_boar', questTag: null }, true, 'meadows');
  assert.equal(step(), 'tag');
  E.onDied({ kind: 'enemy', defId: 'choir_acolyte', questTag: 'raid' }, true, 'coast');
  assert.equal(step(), 'tag', 'wrong region');
  E.onDied({ kind: 'enemy', defId: 'choir_acolyte', questTag: 'raid' }, true, 'meadows');
  assert.equal(step(), 'defeat');
  E.onBossDefeated('iskra');
  E.onBossDefeated('durn');
  assert.equal(step(), 'collect');
  h.items.rust_core = 2;
  E.poll(0, 0, 0, target, tmp);
  assert.equal(step(), 'deliver');
  h.items.rust_core = 1;
  assert.equal(E.talkStep('yael'), null, 'deliver needs the items');
  h.items.rust_core = 2;
  const d = E.talkStep('yael');
  E.finishTalk(d.questId, d.index);
  assert.equal(h.items.rust_core, 0, 'delivered items are removed');
  assert.equal(step(), 'interact');
  E.onUsed('bell_1');
  E.onUsed('bell_1');
  assert.equal(step(), 'interact', 'the same object counts once');
  E.onUsed('bell_2');
  assert.equal(step(), 'destroy');
  E.onDied({ kind: 'object', defId: 'siphon_1' }, false, null);
  assert.equal(step(), 'tech');
  E.onTech('nova_ring', null, 1);
  E.onTech('nova_ring', null, 2);
  assert.equal(step(), 'techTag');
  E.onTech('dawn_lance', null, 3);
  E.onTech('dawn_lance', 'pillar', 3);
  E.onTech('dawn_lance', 'pillar', 3);
  assert.equal(h.s.quests.active.t.counts.techTag, 1, 'one use counts once however many ticks hit');
  E.onTech('dawn_lance', 'pillar', 4);
  assert.equal(step(), 'reach');
  h.level = 3;
  E.poll(0, 0, 0, target, tmp);
  assert.equal(step(), 'race');
  E.onRace('windmill_run', 'bronze');
  assert.equal(step(), 'race', 'bronze is not silver');
  E.onRace('windmill_run', 'gold');
  assert.equal(step(), 'script');
  E.completeStep('t');
  assert.equal(E.state('t'), 'done');
  assert.ok(h.actions.some((a) => a.op === 'giveXp' && a.amount === 10), 'rewards ran');
  const types = h.events.map((e) => e[0]);
  assert.ok(types.includes('quest:started') && types.includes('quest:completed') && types.includes('quest:progress'));
  assert.equal(h.s.quests.tracked, null);
});

test('quest engine: parallel quests, tracking, autoStart and the MQ7 rule (four of five Siphons)', () => {
  const h = harness(QUESTS);
  const E = h.engine;
  h.s.quests.done.push('mq1', 'mq2');
  for (const id of ['mq3', 'mq4', 'mq5', 'mq6']) assert.ok(E.start(id));
  assert.equal(E.ids.length, 4);
  assert.deepEqual(E.ids, ['mq3', 'mq4', 'mq5', 'mq6'], 'in quest order');
  assert.equal(E.active().length, 4);
  assert.equal(E.active()[0].objectiveKey, 'quest.mq3.s1');
  E.track('mq5');
  assert.equal(h.s.quests.tracked, 'mq5');
  assert.equal(E.state('mq7'), 'locked');
  h.siphons = 3;
  assert.equal(E.state('mq7'), 'locked');
  h.siphons = 4;
  assert.equal(E.state('mq7'), 'available');
  E.autoStart();
  assert.equal(E.state('mq7'), 'active');
  assert.equal(h.s.quests.tracked, 'mq5', 'starting another main quest keeps a main tracked quest');
  // A destroy step completes on the object's death, not by a kill step.
  const sh = harness(QUESTS);
  sh.s.quests.done.push('mq1');
  sh.engine.start('mq2');
  for (let i = 0; i < 6; i++) sh.engine.completeStep('mq2');
  assert.equal(sh.engine.current('mq2').id, 's7');
  sh.engine.onDied({ kind: 'enemy', defId: 'siphon_1', questTag: 'siphon_1' }, true, null);
  assert.equal(sh.engine.current('mq2').id, 's7', 'an enemy death never completes a destroy step');
  sh.engine.onDied({ kind: 'object', defId: 'siphon_1', questTag: 'siphon_1' }, true, null);
  assert.equal(sh.engine.current('mq2').id, 's8');
});

test('quest engine: tagged kills count through questTag; resume re-runs only world ops', () => {
  const h = harness(QUESTS);
  h.s.quests.done.push('mq1');
  h.engine.start('mq2');
  h.engine.completeStep('mq2');
  h.engine.completeStep('mq2');
  assert.equal(h.engine.current('mq2').id, 's3');
  assert.ok(h.actions.some((a) => a.op === 'spawnGroup' && a.questTag === 'mq2_raid'));
  for (let i = 0; i < 3; i++) h.engine.onDied({ kind: 'enemy', defId: 'choir_acolyte', questTag: 'mq2_raid' }, true, null);
  h.engine.onDied({ kind: 'enemy', defId: 'choir_acolyte', questTag: null }, true, null);
  assert.equal(h.engine.current('mq2').id, 's3', 'untagged kills do not count');
  assert.equal(h.engine.active()[0].count, 3);
  // save round trip: a fresh engine on a JSON copy resumes the same step and counts
  const copy = JSON.parse(JSON.stringify(h.s.quests));
  const h2 = harness(QUESTS);
  h2.s.quests = copy;
  h2.actions.length = 0;
  h2.engine.resume();
  assert.equal(h2.engine.current('mq2').id, 's3');
  assert.equal(h2.engine.active()[0].count, 3);
  assert.deepEqual(h2.actions.map((a) => a.op), ['spawnGroup'], 'only the world op of onStart re-runs');
  assert.deepEqual(h2.entered.at(-1), ['mq2', 's3', true]);
  h2.engine.onDied({ kind: 'enemy', defId: 'choir_caster', questTag: 'mq2_raid' }, true, null);
  assert.equal(h2.engine.current('mq2').id, 's4');
});

test('dialogue: traversal, node and choice actions, conditional choices', () => {
  const events = [];
  const ran = [];
  const flags = { met: true };
  const defs = {
    d: { id: 'd', start: 'a', nodes: {
      a: { speaker: 'dov', text: 'k.a', next: 'b', actions: [{ op: 'toast', key: 'x' }] },
      b: { speaker: 'tavi', text: 'k.b', choices: [
        { text: 'c.1', next: 'c', actions: [{ op: 'setFlag', key: 'chose', value: 1 }] },
        { text: 'c.hidden', next: null, if: { flag: 'nope' } },
        { text: 'c.2', next: null, if: { flag: 'met' } },
      ] },
      c: { speaker: 'dov', text: 'k.c', next: null },
    } },
  };
  let ended = 0;
  const r = createDialogueRunner({
    dialogue: (id) => defs[id] || null,
    cond: (c) => !c.flag || !!flags[c.flag],
    run: (a) => ran.push(...a.map((x) => x.op)),
    emit: (t, p) => events.push([t, p]),
    ended: () => ended++,
  });
  assert.equal(r.start('missing', null), false);
  assert.ok(r.start('d', 'dov'));
  assert.deepEqual(ran, ['toast']);
  r.advance();
  const line = events.filter((e) => e[0] === 'dialogue:line').at(-1)[1];
  assert.deepEqual(line.choices.map((c) => c.textKey), ['c.1', 'c.2'], 'the hidden choice is not shown');
  r.advance(1);
  assert.equal(r.open, false, 'c.2 ends the dialogue');
  assert.equal(ended, 1);
  assert.ok(r.start('d', 'dov'));
  r.advance();
  r.advance(0);
  assert.ok(ran.includes('setFlag'));
  assert.equal(r.nodeId, 'c');
  r.advance();
  assert.equal(r.open, false);
  assert.equal(events.filter((e) => e[0] === 'dialogue:end').length, 2);
});

test('activities: medals and the Siphon core cycle (4 s open in every 8 s)', () => {
  const m = { bronze: 75, silver: 55, gold: 42 };
  assert.equal(medalFor(40, m), 'gold');
  assert.equal(medalFor(42, m), 'gold');
  assert.equal(medalFor(50, m), 'silver');
  assert.equal(medalFor(70, m), 'bronze');
  assert.equal(medalFor(80, m), 'none');
  let open = 0;
  for (let i = 0; i < 800; i++) if (siphonOpen(i / 100, 8, 4)) open++;
  assert.equal(open, 400);
  assert.equal(siphonOpen(1, 8, 4), false);
  assert.equal(siphonOpen(5, 8, 4), true);
});
