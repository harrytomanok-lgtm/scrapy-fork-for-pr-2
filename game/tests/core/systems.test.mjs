import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSystems } from '../../src/core/systems.js';
import { createTime } from '../../src/core/time.js';
import { SIM_PHASES, FRAME_PHASES } from '../../src/core/constants.js';

function makeCtx() {
  const errors = [];
  const warnings = [];
  const ctx = {
    owner: null,
    time: createTime(),
    log: { info() {}, warn: (...a) => warnings.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')) },
  };
  ctx.systems = createSystems(ctx);
  return { ctx, errors, warnings };
}

/** Advance the standalone clock by one tick and run the sim phases. */
function tick(ctx, frozen = false) {
  ctx.time.beginStep();
  ctx.systems.runStep(1 / 60, frozen);
  ctx.time.endStep();
}

test('sim phases run in the contract order, frame phases too', () => {
  const { ctx } = makeCtx();
  const order = [];
  for (const p of [...SIM_PHASES].reverse()) ctx.systems.add({ id: `t.${p}`, phase: p, step() { order.push(p); } });
  for (const p of [...FRAME_PHASES].reverse()) ctx.systems.add({ id: `t.f.${p}`, phase: p, frame() { order.push(p); } });
  tick(ctx);
  assert.deepEqual(order, SIM_PHASES);
  order.length = 0;
  ctx.systems.runFrame(0.016, 0.5);
  assert.deepEqual(order, FRAME_PHASES);
});

test('within a phase: order field, then registration order', () => {
  const { ctx } = makeCtx();
  const seen = [];
  ctx.systems.add({ id: 'a.ai', phase: 'intent', order: 20, step() { seen.push('ai'); } });
  ctx.systems.add({ id: 'a.combat', phase: 'intent', order: 10, step() { seen.push('combat'); } });
  ctx.systems.add({ id: 'a.first0', phase: 'intent', step() { seen.push('first0'); } });
  ctx.systems.add({ id: 'a.second0', phase: 'intent', order: 0, step() { seen.push('second0'); } });
  ctx.systems.add({ id: 'a.neg', phase: 'intent', order: -5, step() { seen.push('neg'); } });
  tick(ctx);
  assert.deepEqual(seen, ['neg', 'first0', 'second0', 'combat', 'ai']);
});

test('gameplay phases are skipped while frozen; input and cleanup still run', () => {
  const { ctx } = makeCtx();
  const seen = [];
  for (const p of SIM_PHASES) ctx.systems.add({ id: `t.${p}`, phase: p, step() { seen.push(p); } });
  tick(ctx, true);
  assert.deepEqual(seen, ['input', 'cleanup']);
});

test('{ step, frame } phase object and the string-phase defaults', () => {
  const { ctx } = makeCtx();
  ctx.systems.add({ id: 'x.both', phase: { step: 'combat', frame: 'vfx' }, step() {}, frame() {} });
  ctx.systems.add({ id: 'x.stream', phase: 'post', step() {}, frame() {} });
  ctx.systems.add({ id: 'x.cam', phase: 'camera', step() {}, frame() {} });
  const byId = Object.fromEntries(ctx.systems.list().map((s) => [s.id, s]));
  assert.equal(byId['x.both'].step, 'combat');
  assert.equal(byId['x.both'].frame, 'vfx');
  assert.equal(byId['x.stream'].step, 'post');
  assert.equal(byId['x.stream'].frame, 'world');
  assert.equal(byId['x.cam'].frame, 'camera');
  assert.equal(byId['x.cam'].step, 'post');
});

test('invalid systems throw: missing id, duplicate id, unknown phase, no callback', () => {
  const { ctx } = makeCtx();
  assert.throws(() => ctx.systems.add({ phase: 'post', step() {} }));
  assert.throws(() => ctx.systems.add({ id: 'x.a', phase: 'nope', step() {} }));
  assert.throws(() => ctx.systems.add({ id: 'x.a', phase: 'post' }));
  assert.throws(() => ctx.systems.add({ id: 'x.a', phase: { step: 'render' }, step() {} }));
  ctx.systems.add({ id: 'x.a', phase: 'post', step() {} });
  assert.throws(() => ctx.systems.add({ id: 'x.a', phase: 'post', step() {} }));
});

test('remove, removeOwner and the default owner from ctx.owner', () => {
  const { ctx } = makeCtx();
  const seen = [];
  ctx.owner = 'standin:world';
  ctx.systems.add({ id: 's.one', phase: 'post', step() { seen.push('one'); } });
  ctx.systems.add({ id: 's.two', phase: 'post', frame() { seen.push('twoF'); }, step() { seen.push('two'); } });
  ctx.owner = null;
  ctx.systems.add({ id: 'w.keep', phase: 'post', owner: 'world', step() { seen.push('keep'); } });
  ctx.systems.add({ id: 'c.core', phase: 'post', step() { seen.push('core'); } });
  assert.equal(ctx.systems.list().find((s) => s.id === 'c.core').owner, 'core');
  assert.equal(ctx.systems.removeOwner('standin:world'), 2);
  assert.equal(ctx.systems.remove('c.core'), true);
  assert.equal(ctx.systems.remove('c.core'), false);
  tick(ctx);
  ctx.systems.runFrame(0, 0);
  assert.deepEqual(seen, ['keep']);
  assert.equal(ctx.systems.has('s.one'), false);
  ctx.systems.add({ id: 's.one', phase: 'post', step() {} }); // id is free again
});

test('removal during a run takes effect immediately; additions run from the next run', () => {
  const { ctx } = makeCtx();
  const seen = [];
  ctx.systems.add({ id: 'r.a', phase: 'script', step(c) { seen.push('a'); c.systems.remove('r.b'); c.systems.add({ id: 'r.late', phase: 'script', step() { seen.push('late'); } }); } });
  ctx.systems.add({ id: 'r.b', phase: 'script', step() { seen.push('b'); } });
  tick(ctx);
  assert.deepEqual(seen, ['a']);
  ctx.systems.remove('r.a');
  tick(ctx);
  assert.deepEqual(seen, ['a', 'late']);
});

test('a throwing system is logged, keeps running, and is disabled after 3 throws within 60 ticks', () => {
  const { ctx, errors } = makeCtx();
  let calls = 0;
  let other = 0;
  ctx.systems.add({ id: 'bad.sys', phase: 'combat', step() { calls++; throw new Error('boom'); } });
  ctx.systems.add({ id: 'ok.sys', phase: 'combat', step() { other++; } });
  tick(ctx);
  tick(ctx);
  assert.equal(ctx.systems.isDisabled('bad.sys'), false);
  tick(ctx);
  assert.equal(ctx.systems.isDisabled('bad.sys'), true);
  for (let i = 0; i < 5; i++) tick(ctx);
  assert.equal(calls, 3);
  assert.equal(other, 8, 'other systems keep running');
  assert.equal(errors.length, 3);
  assert.match(errors[0], /bad\.sys/);
});

test('throws spread over more than 60 ticks do not disable the system', () => {
  const { ctx } = makeCtx();
  let calls = 0;
  ctx.systems.add({ id: 'flaky.sys', phase: 'move', step(c) { if (c.time.tick % 40 === 0) { calls++; throw new Error('x'); } } });
  for (let i = 0; i < 200; i++) tick(ctx);
  assert.equal(calls, 5);
  assert.equal(ctx.systems.isDisabled('flaky.sys'), false);
});

test('a throwing frame callback is wrapped the same way', () => {
  const { ctx } = makeCtx();
  let calls = 0;
  ctx.systems.add({ id: 'bad.frame', phase: 'render', frame() { calls++; throw new Error('f'); } });
  for (let i = 0; i < 6; i++) ctx.systems.runFrame(0.016, 1);
  assert.equal(calls, 3);
  assert.equal(ctx.systems.isDisabled('bad.frame'), true);
});
