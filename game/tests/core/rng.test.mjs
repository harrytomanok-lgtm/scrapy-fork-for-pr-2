import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStream, createRng, hash2, hashString } from '../../src/core/rng.js';
import { WORLD_SEED } from '../../src/core/constants.js';

const draw = (s, n) => Array.from({ length: n }, () => s.next());

test('same seed, same sequence; different seed, different sequence', () => {
  assert.deepEqual(draw(createStream(123), 100), draw(createStream(123), 100));
  assert.notDeepEqual(draw(createStream(123), 10), draw(createStream(124), 10));
});

test('streams follow the reference mulberry32 sequence', () => {
  function reference(a) {
    return () => {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  for (const seed of [1, 123, 7168, 0xdeadbeef]) {
    const ref = reference(seed >>> 0);
    const s = createStream(seed);
    for (let i = 0; i < 50; i++) assert.equal(s.next(), ref());
  }
});

test('next is in [0, 1); range, int (inclusive), pick, chance', () => {
  const s = createStream(7);
  const ints = new Set();
  for (let i = 0; i < 5000; i++) {
    const x = s.next();
    assert.ok(x >= 0 && x < 1);
    const r = s.range(-2, 3);
    assert.ok(r >= -2 && r < 3);
    const k = s.int(1, 6);
    assert.ok(Number.isInteger(k) && k >= 1 && k <= 6);
    ints.add(k);
  }
  assert.equal(ints.size, 6, 'both ends reachable');
  assert.equal(s.pick([]), undefined);
  assert.ok(['a', 'b'].includes(s.pick(['a', 'b'])));
  assert.equal(s.chance(0), false);
  assert.equal(s.chance(1), true);
  let hits = 0;
  for (let i = 0; i < 10000; i++) if (s.chance(0.3)) hits++;
  assert.ok(hits > 2700 && hits < 3300);
});

test('streams are independent: drawing from one never changes another', () => {
  const a = createRng({ seed: 5 });
  const b = createRng({ seed: 5 });
  draw(a.fx, 50);
  draw(a.world, 50);
  assert.deepEqual(draw(a.sim, 20), draw(b.sim, 20));
  assert.notDeepEqual(draw(createRng({ seed: 5 }).sim, 5), draw(createRng({ seed: 5 }).fx, 5));
});

test('fork depends only on the seed and the label, not on how much was drawn', () => {
  const s1 = createStream(99);
  const s2 = createStream(99);
  draw(s2, 17);
  assert.deepEqual(draw(s1.fork('loot'), 10), draw(s2.fork('loot'), 10));
  assert.notDeepEqual(draw(s1.fork('loot'), 5), draw(s1.fork('ai'), 5));
  const parent = createStream(99);
  const before = draw(createStream(99), 5);
  parent.fork('x');
  assert.deepEqual(draw(parent, 5), before, 'forking consumes nothing');
});

test('reset restarts the sequence; world stream uses WORLD_SEED by default', () => {
  const s = createStream(3);
  const first = draw(s, 5);
  s.reset(3);
  assert.deepEqual(draw(s, 5), first);
  assert.equal(createRng().world.seed, WORLD_SEED);
  assert.equal(createRng({ worldSeed: 11 }).world.seed, 11);
});

test('hash2 is stateless, deterministic and spreads neighbouring cells', () => {
  assert.equal(hash2(3, -4, 7), hash2(3, -4, 7));
  const seen = new Set();
  for (let x = -10; x < 10; x++) for (let z = -10; z < 10; z++) {
    const h = hash2(x, z, 7168);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
    seen.add(h);
  }
  assert.equal(seen.size, 400);
  assert.notEqual(hash2(1, 2, 1), hash2(2, 1, 1));
  assert.notEqual(hash2(1, 2, 1), hash2(1, 2, 2));
  assert.notEqual(hashString('a'), hashString('b'));
});
