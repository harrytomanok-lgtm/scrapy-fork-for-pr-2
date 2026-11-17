import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnts, KIND_MASK } from '../../src/core/ents.js';
import { createSpatial } from '../../src/core/spatial.js';
import { createRng } from '../../src/core/rng.js';

function setup() {
  const ctx = { log: { info() {}, warn() {}, error() {} } };
  ctx.ents = createEnts(ctx);
  ctx.spatial = createSpatial(ctx);
  return ctx;
}

function add(ctx, kind, x, y, z, radius = 0.5, height = 1.8) {
  return ctx.ents.create(kind, { pos: { x, y, z }, radius, height });
}

const ids = (out) => out.map((e) => e.id);

test('query: horizontal radius including the entity radius, kind mask, id order, out truncated', () => {
  const ctx = setup();
  const a = add(ctx, 'enemy', 10, 0, 10);
  const b = add(ctx, 'enemy', 13, 50, 10); // y is ignored by query
  const c = add(ctx, 'npc', 11, 0, 10);
  add(ctx, 'enemy', 20, 0, 10);
  ctx.spatial.rehash();
  const out = [1, 2, 3, 4, 5, 6, 7];
  assert.equal(ctx.spatial.query(10, 10, 2.5, out, KIND_MASK.enemy), 2);
  assert.deepEqual(ids(out), [a.id, b.id]);
  assert.equal(ctx.spatial.query(10, 10, 2.5, out, KIND_MASK.ACTORS), 3);
  assert.deepEqual(ids(out), [a.id, b.id, c.id]);
  assert.equal(ctx.spatial.query(10, 10, 2.5, out, KIND_MASK.projectile), 0);
  assert.equal(out.length, 0);
});

test('querySphere tests against the capsule (y matters)', () => {
  const ctx = setup();
  const low = add(ctx, 'enemy', 0, 0, 0);
  const high = add(ctx, 'enemy', 0, 30, 0);
  ctx.spatial.rehash();
  const out = [];
  assert.equal(ctx.spatial.querySphere(0, 1, 1, 1, out, KIND_MASK.ALL), 1);
  assert.equal(out[0], low);
  assert.equal(ctx.spatial.querySphere(0, 31.7, 0, 0.1, out, KIND_MASK.ALL), 1);
  assert.equal(out[0], high);
  assert.equal(ctx.spatial.querySphere(0, 3.0, 0, 0.5, out, KIND_MASK.ALL), 0, 'above the head of the low one');
  assert.equal(ctx.spatial.querySphere(0, 2.2, 0, 0.5, out, KIND_MASK.ALL), 1, 'touching the top hemisphere');
});

test('querySegment sweeps a capsule against entity capsules', () => {
  const ctx = setup();
  const near = add(ctx, 'enemy', 50, 0, 0.8);
  const far = add(ctx, 'boss', 80, 0, 5, 2, 6);
  add(ctx, 'enemy', 120, 0, 0); // beyond the end
  add(ctx, 'enemy', 50, 10, 0); // above the line
  ctx.spatial.rehash();
  const out = [];
  const n = ctx.spatial.querySegment(0, 1, 0, 100, 1, 0, 0.5, out, KIND_MASK.HOSTILE_TARGETS);
  assert.equal(n, 1);
  assert.deepEqual(ids(out), [near.id]);
  assert.equal(ctx.spatial.querySegment(0, 1, 0, 100, 1, 0, 3.1, out, KIND_MASK.HOSTILE_TARGETS), 2);
  assert.deepEqual(ids(out), [near.id, far.id]);
  assert.equal(ctx.spatial.querySegment(0, 1, 0, 100, 1, 0, 0.5, out, KIND_MASK.npc), 0);
  // degenerate segment behaves like a sphere
  assert.equal(ctx.spatial.querySegment(50, 1, 0.8, 50, 1, 0.8, 0.1, out, KIND_MASK.ALL), 1);
});

test('nearest: smallest distance to the capsule, within r, filter, ties by lower id', () => {
  const ctx = setup();
  const a = add(ctx, 'enemy', 5, 0, 0);
  const b = add(ctx, 'enemy', -5, 0, 0);
  const c = add(ctx, 'enemy', 3, 0, 0);
  ctx.spatial.rehash();
  assert.equal(ctx.spatial.nearest(0, 1, 0, 10, KIND_MASK.enemy), c);
  assert.equal(ctx.spatial.nearest(0, 1, 0, 10, KIND_MASK.enemy, (e) => e !== c), a, 'tie between a and b goes to the lower id');
  assert.equal(ctx.spatial.nearest(0, 1, 0, 1, KIND_MASK.enemy), null);
  assert.equal(ctx.spatial.nearest(-4, 1, 0, 10, KIND_MASK.enemy), b);
});

test('dead entities never match', () => {
  const ctx = setup();
  const e = add(ctx, 'enemy', 0, 0, 0);
  ctx.spatial.rehash();
  e.alive = false;
  assert.equal(ctx.spatial.query(0, 0, 5, [], KIND_MASK.ALL), 0);
  assert.equal(ctx.spatial.nearest(0, 0, 0, 5, KIND_MASK.ALL), null);
});

test('moved entities rehash into their new cell; entities created since the rehash are found', () => {
  const ctx = setup();
  const e = add(ctx, 'enemy', 0, 0, 0);
  ctx.spatial.rehash();
  e.pos.set(500, 0, -700);
  e.prev.set(500, 0, -700);
  const out = [];
  ctx.spatial.rehash();
  assert.equal(ctx.spatial.query(500, -700, 1, out, KIND_MASK.ALL), 1);
  assert.equal(ctx.spatial.query(0, 0, 10, out, KIND_MASK.ALL), 0);
  e.pos.set(503, 0, -700); // moved a little since the rehash, across nothing: still found
  assert.equal(ctx.spatial.query(503, -700, 0.6, out, KIND_MASK.ALL), 1);
  const fresh = add(ctx, 'projectile', 100, 1, 100);
  assert.equal(ctx.spatial.querySphere(100, 1.5, 100, 0.5, out, KIND_MASK.projectile), 1);
  assert.equal(out[0], fresh);
});

test('positions outside the world square clamp to the border cells', () => {
  const ctx = setup();
  const e = add(ctx, 'enemy', 5000, 0, -5000);
  ctx.spatial.rehash();
  const out = [];
  assert.equal(ctx.spatial.query(5000, -5000, 1, out, KIND_MASK.ALL), 1);
  assert.equal(out[0], e);
});

test('grid results equal brute force on a random population', () => {
  const ctx = setup();
  const r = createRng({ seed: 42 }).sim;
  for (let i = 0; i < 60; i++) add(ctx, r.pick(['enemy', 'npc', 'pickup', 'object']), r.range(-300, 300), r.range(0, 40), r.range(-300, 300), r.range(0.3, 2), r.range(1, 5));
  ctx.spatial.rehash();
  const out = [];
  for (let q = 0; q < 50; q++) {
    const x = r.range(-300, 300), y = r.range(0, 40), z = r.range(-300, 300), rad = r.range(1, 80);
    ctx.spatial.query(x, z, rad, out, KIND_MASK.ALL);
    const brute = ctx.ents.all().filter((e) => Math.hypot(e.pos.x - x, e.pos.z - z) <= rad + e.radius);
    assert.deepEqual(ids(out), ids(brute));
    ctx.spatial.querySphere(x, y, z, rad, out, KIND_MASK.ACTORS);
    const bruteS = ctx.ents.all().filter((e) => {
      if (!(KIND_MASK[e.kind] & KIND_MASK.ACTORS)) return false;
      const y0 = e.pos.y + e.radius, y1 = Math.max(y0, e.pos.y + e.height - e.radius);
      const cy = Math.min(Math.max(y, y0), y1);
      return Math.hypot(e.pos.x - x, y - cy, e.pos.z - z) <= rad + e.radius;
    });
    assert.deepEqual(ids(out), ids(bruteS));
  }
});
