import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBus, EVENTS, isEventType } from '../../src/core/events.js';
import { createContext } from '../../src/core/context.js';

function fakeLog() {
  const out = { errors: [], warnings: [] };
  out.info = () => {};
  out.warn = (...a) => out.warnings.push(a.join(' '));
  out.error = (...a) => out.errors.push(a.join(' '));
  return out;
}

/** Field names at depth 1 of the first `{ ... }` of a payload cell. */
function topLevelFields(cell) {
  const fields = [];
  let depth = 0;
  let token = '';
  for (const ch of cell) {
    if (ch === '{' || ch === '<' || ch === '(') {
      depth++;
      if (depth === 1 && ch === '{') token = '';
      else if (depth > 1) continue;
      continue;
    }
    if (ch === '}' || ch === '>' || ch === ')') {
      depth--;
      if (depth === 0) {
        if (token.trim()) fields.push(token.trim().match(/^[A-Za-z]+/)[0]);
        return fields;
      }
      continue;
    }
    if (depth !== 1) continue;
    if (ch === ',') {
      fields.push(token.trim().match(/^[A-Za-z]+/)[0]);
      token = '';
    } else token += ch;
  }
  return fields;
}

test('the catalog matches every event row of ARCHITECTURE 3.6 exactly', () => {
  const doc = readFileSync(new URL('../../docs/ARCHITECTURE.md', import.meta.url), 'utf8');
  const start = doc.indexOf('### 3.6 Event bus');
  const end = doc.indexOf('### 3.7');
  const rows = doc.slice(start, end).split('\n').filter((l) => /^\| `[^`]+` \|/.test(l));
  const fromDoc = rows.map((l) => l.match(/^\| `([^`]+)`/)[1]);
  assert.deepEqual([...fromDoc].sort(), Object.keys(EVENTS).sort());
  for (const row of rows) {
    const type = row.match(/^\| `([^`]+)`/)[1];
    const payload = row.replace(/\\\|/g, '/').split('|')[2];
    assert.deepEqual(EVENTS[type], topLevelFields(payload), `fields of ${type}`);
  }
});

test('unknown event types throw in strict (dev and test) mode, for emit, post and on', () => {
  const bus = createBus({ strict: true });
  assert.throws(() => bus.emit('nope:event', {}), /unknown event type/);
  assert.throws(() => bus.post('nope:event', {}), /unknown event type/);
  assert.throws(() => bus.on('nope:event', () => {}), /unknown event type/);
  assert.equal(isEventType('combat:hit'), true);
  assert.equal(isEventType('nope:event'), false);
});

test('unknown event types are dropped and logged once in production mode', () => {
  const log = fakeLog();
  const bus = createBus({ strict: false, ctx: { log } });
  bus.emit('nope:event', {});
  bus.emit('nope:event', {});
  assert.equal(log.warnings.length, 1);
});

test('strict mode logs a missing payload field once per type', () => {
  const log = fakeLog();
  const bus = createBus({ strict: true, ctx: { log } });
  bus.emit('rpg:xp', { amount: 1, total: 1 });
  bus.emit('rpg:xp', { amount: 1, total: 1 });
  bus.emit('rpg:xp', { amount: 1, total: 1, source: 'kill' });
  assert.equal(log.warnings.length, 1);
  assert.match(log.warnings[0], /source/);
});

test('emit is synchronous, in subscription order; unsubscribe and off work', () => {
  const bus = createBus({ strict: true });
  const seen = [];
  const f1 = (p) => seen.push(`a${p.count}`);
  const un = bus.on('combat:combo', (p) => seen.push(`b${p.count}`));
  bus.on('combat:combo', f1);
  bus.emit('combat:combo', { count: 1 });
  assert.deepEqual(seen, ['b1', 'a1']);
  un();
  bus.off('combat:combo', f1);
  bus.emit('combat:combo', { count: 2 });
  assert.deepEqual(seen, ['b1', 'a1']);
  assert.equal(bus.listenerCount('combat:combo'), 0);
});

test('post queues until flush, in post order; posts made during flush are delivered in the same flush', () => {
  const bus = createBus({ strict: true });
  const seen = [];
  bus.on('quest:started', (p) => {
    seen.push(`start:${p.questId}`);
    if (p.questId === 'mq1') bus.post('quest:completed', { questId: 'mq1' });
  });
  bus.on('quest:completed', (p) => seen.push(`done:${p.questId}`));
  bus.post('quest:started', { questId: 'mq1' });
  bus.post('quest:started', { questId: 'mq2' });
  bus.emit('quest:completed', { questId: 'sq1' });
  assert.deepEqual(seen, ['done:sq1']);
  bus.flush();
  assert.deepEqual(seen, ['done:sq1', 'start:mq1', 'start:mq2', 'done:mq1']);
  bus.flush();
  assert.equal(seen.length, 4);
});

test('posted events are delivered in the cleanup phase of the current tick', () => {
  const ctx = createContext({ flags: { test: true }, log: fakeLog() });
  const seen = [];
  ctx.bus.on('camp:cleared', () => seen.push(`delivered@${ctx.time.tick}`));
  ctx.systems.add({ id: 't.post', phase: 'combat', step(c) { if (c.time.tick === 0) c.bus.post('camp:cleared', { campId: 'c', regionId: 'meadows', day: 1 }); } });
  ctx.systems.add({ id: 't.after', phase: 'post', step(c) { if (c.time.tick === 0) seen.push('post-phase'); } });
  ctx.loop.stepSim(2);
  assert.deepEqual(seen, ['post-phase', 'delivered@0']);
});

test('offOwner removes every listener of that owner; the default owner is ctx.owner', () => {
  const ctx = { owner: 'standin:rpg', log: fakeLog() };
  const bus = createBus({ strict: true, ctx });
  const seen = [];
  bus.on('rpg:stats', () => seen.push('standin1'));
  bus.on('rpg:loadout', () => seen.push('standin2'));
  ctx.owner = null;
  bus.on('rpg:stats', () => seen.push('ui'), 'ui');
  bus.on('rpg:stats', () => seen.push('explicit'), 'standin:rpg');
  bus.offOwner('standin:rpg');
  bus.emit('rpg:stats', {});
  bus.emit('rpg:loadout', {});
  assert.deepEqual(seen, ['ui']);
});

test('a listener removed during an emit is not called later in that emit', () => {
  const bus = createBus({ strict: true });
  const seen = [];
  let unB = null;
  bus.on('rpg:stats', () => { seen.push('a'); unB(); });
  unB = bus.on('rpg:stats', () => seen.push('b'));
  bus.emit('rpg:stats', {});
  assert.deepEqual(seen, ['a']);
});

test('a throwing listener is logged, does not stop others, and is disabled after 3 throws in 60 ticks', () => {
  const log = fakeLog();
  const ctx = { log, time: { tick: 0 } };
  const bus = createBus({ strict: true, ctx });
  let bad = 0;
  let good = 0;
  bus.on('combat:burnout', () => { bad++; throw new Error('listener boom'); });
  bus.on('combat:burnout', () => { good++; });
  for (let i = 0; i < 5; i++) { ctx.time.tick = i; bus.emit('combat:burnout', { entId: 1 }); }
  assert.equal(bad, 3);
  assert.equal(good, 5);
  assert.equal(log.errors.length, 3);
});

test('onAny observes every delivered event (the debug recorder hook)', () => {
  const bus = createBus({ strict: true });
  const seen = [];
  const un = bus.onAny((type, p) => seen.push(type + ':' + (p.count ?? '')));
  bus.emit('combat:combo', { count: 3 });
  bus.post('game:ready');
  bus.flush();
  un();
  bus.emit('combat:combo', { count: 4 });
  assert.deepEqual(seen, ['combat:combo:3', 'game:ready:']);
});
