/**
 * Reward cadence of the first hour (rpg/logic/cadence.js on the baked world, tools/reward-cadence.mjs): no stretch
 * longer than CADENCE.gapLimit without something new, with the Ora shards and without them (a player who never
 * turns aside for one).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cadenceWorld } from '../../tools/reward-cadence.mjs';
import { CADENCE } from '../../src/rpg/data/cadence.js';
import { rewardTimeline } from '../../src/rpg/logic/cadence.js';

const W = cadenceWorld();

test('reward cadence: nothing-new stretches stay under the limit in the first hour', () => {
  const r = rewardTimeline(W, CADENCE);
  const first = r.gaps.filter((g) => g.from < CADENCE.horizon);
  assert.deepEqual(first, [], 'gaps: ' + JSON.stringify(first));
  const kinds = new Set(r.events.filter((e) => e.t <= CADENCE.horizon).map((e) => e.kind));
  for (const k of ['level', 'technique', 'form', 'gear', 'chest', 'region', 'boss', 'quest', 'shard']) assert.ok(kinds.has(k), 'the first hour has a ' + k);
  const mh = r.events.find((e) => e.id === 'meteor_heel');
  assert.ok(mh && mh.level === 4, 'Meteor Heel opens at level 4');
});

test('reward cadence: the first hour holds without the side shards too', () => {
  const r = rewardTimeline(Object.assign({}, W, { shards: [] }), CADENCE);
  assert.deepEqual(r.gaps.filter((g) => g.from < CADENCE.horizon), []);
});
