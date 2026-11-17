import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../../src/core/pool.js';

test('initial size, get reuses released objects, reset on release', () => {
  let made = 0;
  const pool = createPool(() => ({ n: ++made, used: false }), (o) => { o.used = false; }, 2);
  assert.equal(pool.size, 2);
  assert.equal(pool.created, 2);
  const a = pool.get();
  const b = pool.get();
  assert.equal(pool.size, 0);
  const c = pool.get();
  assert.equal(pool.created, 3);
  a.used = true;
  pool.release(a);
  assert.equal(a.used, false);
  assert.equal(pool.size, 1);
  assert.equal(pool.get(), a, 'released object is reused');
  assert.notEqual(b, c);
  assert.equal(pool.created, 3);
});

test('a null reset is allowed', () => {
  const pool = createPool(() => ({}), null);
  const o = pool.get();
  pool.release(o);
  assert.equal(pool.get(), o);
});
