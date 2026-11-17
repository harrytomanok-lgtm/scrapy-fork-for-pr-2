import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createEnts, TAG, KIND_MASK } from '../../src/core/ents.js';
import { createContext } from '../../src/core/context.js';
import { ENT_CAPS } from '../../src/core/constants.js';

function fakeLog() {
  const out = { warnings: [], errors: [] };
  out.info = () => {};
  out.warn = (...a) => out.warnings.push(a.join(' '));
  out.error = (...a) => out.errors.push(a.join(' '));
  return out;
}

const SHAPE = ['id', 'kind', 'defId', 'alive', 'team', 'pos', 'prev', 'vel', 'yaw', 'radius', 'height', 'level', 'intent', 'move',
  'stats', 'combat', 'brain', 'visual', 'data', 'questTag', 'tags', 'nameKey'];

test('every entity has the full stable shape from creation, in the same key order', () => {
  const ents = createEnts({ log: fakeLog() });
  const a = ents.create('enemy');
  const b = ents.create('projectile', { defId: 'ora_bolt', team: 1, pos: { x: 1, y: 2, z: 3 }, data: { speed: 40 } });
  assert.deepEqual(Object.keys(a), SHAPE);
  assert.deepEqual(Object.keys(b), SHAPE);
  assert.ok(a.pos instanceof Vector3 && a.prev instanceof Vector3 && a.vel instanceof Vector3);
  assert.equal(a.alive, true);
  assert.equal(a.move, null);
  assert.equal(b.defId, 'ora_bolt');
  assert.deepEqual([b.pos.x, b.pos.y, b.pos.z], [1, 2, 3]);
  assert.deepEqual([b.prev.x, b.prev.y, b.prev.z], [1, 2, 3], 'prev starts at pos');
});

test('unknown init fields are ignored with a warning (shape stays fixed)', () => {
  const log = fakeLog();
  const ents = createEnts({ log });
  const e = ents.create('npc', { hp: 5, defId: 'sela' });
  assert.equal('hp' in e, false);
  assert.equal(e.defId, 'sela');
  assert.equal(log.warnings.length, 1);
  assert.throws(() => ents.create('dragon'));
});

test('ids are unique and never reused; pooled objects come back fully reset', () => {
  const ents = createEnts({ log: fakeLog() });
  const a = ents.create('enemy', { tags: TAG.ELITE, questTag: 'q', brain: {} });
  const firstId = a.id;
  ents.destroy(a.id);
  ents.flush();
  const b = ents.create('enemy');
  assert.ok(b.id > firstId);
  assert.equal(b.tags, 0);
  assert.equal(b.questTag, null);
  assert.equal(b.brain, null);
  assert.deepEqual(Object.keys(b), SHAPE);
});

test('destroy is deferred to the cleanup phase and sets alive = false immediately', () => {
  const ctx = createContext({ flags: { test: true }, log: fakeLog() });
  const e = ctx.ents.create('enemy');
  const seen = [];
  ctx.systems.add({
    id: 't.kill', phase: 'combat',
    step(c) {
      if (c.time.tick !== 0) return;
      assert.equal(c.ents.destroy(e.id), true);
      seen.push([e.alive, c.ents.get(e.id) === e, c.ents.list('enemy').length]);
    },
  });
  ctx.systems.add({ id: 't.post', phase: 'post', step(c) { if (c.time.tick === 0) seen.push([c.ents.count('enemy')]); } });
  ctx.loop.stepSim(1);
  assert.deepEqual(seen, [[false, true, 1], [1]]);
  assert.equal(ctx.ents.get(e.id), null);
  assert.equal(ctx.ents.count('enemy'), 0);
  assert.equal(ctx.ents.destroy(e.id), false, 'dead ids are tolerated');
  assert.equal(ctx.ents.destroy(9999), false);
});

test('a killed entity (alive already false) can still be destroyed', () => {
  const ents = createEnts({ log: fakeLog() });
  const e = ents.create('boss');
  e.alive = false;
  assert.equal(ents.destroy(e.id), true);
  ents.destroy(e.id);
  ents.flush();
  assert.equal(ents.count('boss'), 0);
});

test('lists and all() iterate in id order across kinds, creation and removal', () => {
  const ents = createEnts({ log: fakeLog() });
  const ids = [];
  for (let i = 0; i < 10; i++) ids.push(ents.create(i % 2 ? 'enemy' : 'pickup').id);
  ents.destroy(ids[3]);
  ents.destroy(ids[6]);
  ents.flush();
  ents.create('enemy');
  const all = ents.all().map((e) => e.id);
  assert.deepEqual(all, [...all].sort((a, b) => a - b));
  assert.equal(all.length, 9);
  const enemies = ents.list('enemy').map((e) => e.id);
  assert.deepEqual(enemies, [...enemies].sort((a, b) => a - b));
  assert.ok(enemies.every((id) => ents.get(id).kind === 'enemy'));
  assert.deepEqual(ents.list('boss'), []);
});

test('hard caps: creation beyond the cap returns null and logs once; actors share one cap', () => {
  const log = fakeLog();
  const ents = createEnts({ log });
  for (let i = 0; i < ENT_CAPS.actors - 1; i++) assert.ok(ents.create(i % 2 ? 'enemy' : 'npc'));
  assert.ok(ents.create('player'));
  assert.equal(ents.create('boss'), null);
  assert.equal(ents.create('enemy'), null);
  assert.equal(log.warnings.length, 1);
  assert.ok(ents.create('projectile'), 'other caps are independent');
  ents.destroy(ents.list('npc')[0].id);
  ents.flush();
  assert.ok(ents.create('boss'), 'a removed actor frees a slot');
});

test('core.prev copies pos into prev at the start of each step; renderPos interpolates', () => {
  const ctx = createContext({ flags: { test: true }, log: fakeLog() });
  const e = ctx.ents.create('enemy', { pos: { x: 0, y: 0, z: 0 } });
  ctx.systems.add({ id: 't.mv', phase: 'move', step(c) { e.pos.x += 1; } });
  ctx.loop.stepSim(3);
  assert.equal(e.prev.x, 2);
  assert.equal(e.pos.x, 3);
  const out = new Vector3();
  assert.equal(ctx.ents.renderPos(e, 0.25, out), out);
  assert.equal(out.x, 2.25);
});

test('KIND_MASK and TAG constants match the contract', () => {
  assert.equal(KIND_MASK.ACTORS, 1 | 2 | 4 | 8);
  assert.equal(KIND_MASK.HOSTILE_TARGETS, 2 | 4 | 64);
  assert.equal(TAG.DESTRUCTIBLE, 256);
  assert.equal(TAG.SCRIPTED, 128);
});
