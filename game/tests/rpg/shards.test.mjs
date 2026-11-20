/**
 * Ora shards: the shipped table (src/rpg/data/shardTable.js) is what tools/gen-shards.mjs places, every shard can be
 * reached on both world grids (4 m, and the 8 m of low-memory phones), and the ids sit at the same spots on both.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { shardWorld, placeOn } from '../../tools/gen-shards.mjs';
import { SHARD_TABLE } from '../../src/rpg/data/shardTable.js';
import { shardRewards } from '../../src/rpg/data/shards.js';

const W8 = shardWorld(8);
const W4 = shardWorld(4);
/** The player's body radius plus a margin: a shard closer than this to a solid collider is behind a wall. */
const CLEAR = 1;

test('shard table: up to date with the placement on the 8 m world', () => {
  const fresh = placeOn(W8);
  assert.deepEqual(fresh.map((s) => s.id), SHARD_TABLE.map((s) => s.id));
  for (let i = 0; i < fresh.length; i++) {
    const a = fresh[i];
    const b = SHARD_TABLE[i];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1 && Math.abs(a.y - b.y) < 0.5, a.id + ' moved: run node tools/gen-shards.mjs');
  }
});

test('shard table: every shard is reachable on the 4 m and the 8 m grid', () => {
  for (const [name, w] of [['8 m', W8], ['4 m', W4]]) {
    for (const s of SHARD_TABLE) {
      const g = w.heightAt(s.x, s.z);
      assert.ok(s.y > g + 1, s.id + ' above the ground on ' + name + ' (' + s.y + ' over ' + g.toFixed(1) + ')');
      assert.ok(s.y > 1, s.id + ' above the sea');
      for (const up of [0, 4, 10]) assert.ok(!w.blocked(s.x, s.y + up, s.z, CLEAR), s.id + ' clear of colliders on ' + name);
    }
  }
});

test('shard table: one fixed set for every phone, all 43 reachable, the title for all of them', () => {
  // The game reads this table, never the grid it baked: a journey code moved from a 4 m phone to an 8 m phone finds
  // its shards under the same ids at the same spots (checked reachable on both grids above).
  assert.equal(SHARD_TABLE.length, 43);
  const last = shardRewards(SHARD_TABLE.length).at(-1);
  assert.equal(last.at, SHARD_TABLE.length, 'the title is for all of them');
  assert.equal(new Set(SHARD_TABLE.map((s) => s.id)).size, SHARD_TABLE.length);
  const spire = SHARD_TABLE.find((s) => s.regionId === 'spire' && s.kind === 'roof');
  assert.ok(spire && Math.hypot(spire.x, spire.z) > 62, 'the Spire shard is outside the Spire');
});
