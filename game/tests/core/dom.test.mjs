import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafeStorage, LAYERS } from '../../src/core/dom.js';
import { createSave } from '../../src/core/save.js';
import { createStore } from '../../src/core/store.js';

/** A Storage-like Map. */
function memoryBacking() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('safeStorage uses a working backing store', () => {
  const b = memoryBacking();
  const s = createSafeStorage({ backing: b });
  assert.equal(s.memoryOnly, false);
  s.set('a', 'x');
  assert.equal(b.m.get('a'), 'x');
  assert.equal(s.get('a'), 'x');
  s.remove('a');
  assert.equal(s.get('a'), null);
  assert.equal(b.m.has('kethra.probe'), false, 'the probe key is removed');
});

test('a getter that throws (sandboxed frame) gives memory-only storage', () => {
  const s = createSafeStorage({ backing: () => { throw new Error('SecurityError'); } });
  assert.equal(s.memoryOnly, true);
  s.set('k', 'v');
  assert.equal(s.get('k'), 'v');
});

test('a backing store that refuses writes gives memory-only storage', () => {
  const s = createSafeStorage({ backing: { getItem: () => null, setItem() { throw new Error('QuotaExceeded'); }, removeItem() {} } });
  assert.equal(s.memoryOnly, true);
  s.set('k', 'v');
  assert.equal(s.get('k'), 'v');
});

test('a failure after start switches to memory and keeps earlier values', () => {
  const b = memoryBacking();
  const s = createSafeStorage({ backing: b });
  s.set('early', '1');
  b.setItem = () => { throw new Error('QuotaExceeded'); };
  b.getItem = () => { throw new Error('gone'); };
  s.set('late', '2');
  assert.equal(s.memoryOnly, true);
  assert.equal(s.get('early'), '1', 'written before the failure, still readable');
  assert.equal(s.get('late'), '2');
  s.remove('early');
  assert.equal(s.get('early'), null);
});

test('memoryOnly forces memory even with a working backing store', () => {
  const b = memoryBacking();
  const s = createSafeStorage({ backing: b, memoryOnly: true });
  s.set('a', 'x');
  assert.equal(s.memoryOnly, true);
  assert.equal(b.m.size, 0);
  assert.equal(s.get('a'), 'x');
});

test('no backing store at all (Node) is memory-only', () => {
  const s = createSafeStorage();
  assert.equal(s.memoryOnly, true);
  assert.equal(s.get('missing'), null);
});

test('values are stored as strings and never throw', () => {
  const s = createSafeStorage({ backing: memoryBacking() });
  s.set('n', /** @type {any} */ (42));
  assert.equal(s.get('n'), '42');
});

test('save.memoryOnly follows a safeStorage that fell back to memory', () => {
  const b = memoryBacking();
  const storage = createSafeStorage({ backing: b });
  const save = createSave({ store: createStore(), storage, autosave: false });
  assert.equal(save.memoryOnly, false);
  b.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.equal(save.write('test'), true);
  assert.equal(save.memoryOnly, true, 'the HUD warning condition becomes true');
  assert.ok(save.load(1), 'the journey is still loadable this session');
});

test('layer order is fixed', () => {
  assert.deepEqual(LAYERS, ['canvas', 'touch', 'hud', 'screens', 'overlay', 'fatal']);
});
