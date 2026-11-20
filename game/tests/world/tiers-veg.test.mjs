/**
 * Tier-driven vegetation sizing (fix-gfx D6, D7): the tuft rows of the tier table and the per-tier instance capacity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS } from '../../src/render/logic/tiers.js';
import { tuftSettings } from '../../src/world/tufts.js';
import { capacityFor, coverRadius } from '../../src/world/vegetation.js';
import { KIND, KIND_COUNT, IS_TREE, CLASS } from '../../src/world/gen/scatter.js';

test('tier table: explicit tuft rows, low smaller and sparser than high', () => {
  for (const t of ['low', 'high']) {
    assert.equal(typeof TIERS[t].tuftRadius, 'number', t);
    assert.equal(typeof TIERS[t].tuftDensity, 'number', t);
    assert.equal(typeof TIERS[t].tuftInstances, 'number', t);
    assert.ok(TIERS[t].tuftRadius > 0 && TIERS[t].tuftInstances > 0, t + ': tufts run on every tier');
  }
  assert.ok(TIERS.low.tuftRadius < TIERS.high.tuftRadius);
  assert.ok(TIERS.low.tuftDensity < TIERS.high.tuftDensity);
  assert.ok(TIERS.low.tuftInstances < TIERS.high.tuftInstances);
  assert.equal(TIERS.low.grassRadius, undefined, 'the unread grass radius row is gone');
});

test('tufts read the tier caps (clamped, with fallbacks)', () => {
  const out = { radius: 0, density: 0, instances: 0 };
  assert.deepEqual(tuftSettings(TIERS.low, out), { radius: 22, density: 0.75, instances: 800 });
  assert.deepEqual(tuftSettings(TIERS.high, out), { radius: 30, density: 1, instances: 1700 });
  assert.deepEqual(tuftSettings(null, out), { radius: 30, density: 1, instances: 1700 });
  assert.deepEqual(tuftSettings({ tuftRadius: 500, tuftDensity: 3, tuftInstances: 1e6 }, out), { radius: 40, density: 1, instances: 2400 });
});

test('vegetation instance buffers are sized for the active tier', () => {
  let trees = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    const tree = IS_TREE[k] === 1;
    if (tree) trees++;
    // ground cover (class 2) takes 1.5x the rock cap, at most 1600
    const cover = CLASS[k] === 2;
    assert.equal(capacityFor(k, TIERS.low), tree ? 1200 : cover ? 900 : 600, 'low kind ' + k);
    assert.equal(capacityFor(k, TIERS.high), tree ? 4000 : cover ? 1600 : 2000, 'high kind ' + k);
    assert.equal(capacityFor(k, null), tree ? 4000 : cover ? 1600 : 2000, 'no caps: the high maximum');
  }
  assert.equal(CLASS.length, KIND_COUNT);
  assert.ok(coverRadius(TIERS.low) <= 160 && coverRadius(TIERS.low) > 100, 'ground cover radius on low (about 100 m)');
  assert.ok(trees > 0 && trees < KIND_COUNT);
  assert.equal(capacityFor(KIND.ROCK, TIERS.low), 600);
});
