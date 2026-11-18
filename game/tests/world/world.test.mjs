/**
 * World package pure-logic tests (ARCHITECTURE 8.1 Definition of Done): bake determinism, heightAt continuity,
 * coastline radius, regionAt at the region centres, stamps, the 500 m rule, the Stormwell, POI ids, craters,
 * rays and sweeps, findSpot and the scatter caps. One 8 m bake shared by every test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bakeSync } from '../../src/world/gen/bake.js';
import { createGrid } from '../../src/world/gen/grid.js';
import { createQueries } from '../../src/world/gen/queries.js';
import { createColliders, COLLIDER } from '../../src/world/gen/colliders.js';
import { placePois, uncovered } from '../../src/world/gen/pois.js';
import { REGIONS, LANDMARKS } from '../../src/world/gen/layout.js';
import { scatterCell, createCellBuffer, IS_TREE, SCATTER_N } from '../../src/world/gen/scatter.js';
import { WORLD_SEED } from '../../src/core/constants.js';

/** @param {any} b */
function digest(b) {
  const h = createHash('sha256');
  for (const a of [b.height, b.tint, b.region, b.flags, b.canopy]) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  return h.digest('hex');
}

const bake = bakeSync(WORLD_SEED, 8);
const bakeHash = digest(bake);
const grid = createGrid(bake);
const cols = createColliders(grid.heightAt, grid.normalAt);
const q = createQueries(grid, (x, y, z, c) => cols.blocked(x, y, z, c));
const pois = placePois(q, WORLD_SEED);

test('bake determinism: two 8 m bakes of the default seed hash the same', () => {
  const again = bakeSync(WORLD_SEED, 8);
  assert.equal(digest(again), bakeHash);
  assert.equal(bake.n, 897);
  assert.equal(bake.height.length, 897 * 897);
  const other = bakeSync(WORLD_SEED + 1, 8);
  assert.notEqual(digest(other), bakeHash, 'another seed gives another world');
});

test('heightAt is continuous across cell and chunk borders', () => {
  const eps = 1e-3;
  let worst = 0;
  for (let k = 0; k < 400; k++) {
    const z = -3000 + k * 15.3;
    for (const x of [-2048, -1024, -256, 0, 8, 256, 512, 1280, 2304]) {
      worst = Math.max(worst, Math.abs(grid.heightAt(x - eps, z) - grid.heightAt(x + eps, z)));
      worst = Math.max(worst, Math.abs(grid.heightAt(z, x - eps) - grid.heightAt(z, x + eps)));
    }
  }
  assert.ok(worst < 0.05, `largest step across a border ${worst}`);
  assert.ok(Number.isFinite(grid.heightAt(1e6, -1e6)), 'outside the square the query clamps');
});

test('coastline radius lies between 2700 and 3400 m in 64 directions', () => {
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    let last = 0;
    for (let d = 0; d < 3584; d += 4) if (grid.heightAt(Math.cos(a) * d, Math.sin(a) * d) > 0) last = d;
    assert.ok(last >= 2700 && last <= 3400, `direction ${k}: coastline at ${last} m`);
  }
});

test('regionAt returns the region at each centre and spire at the origin', () => {
  for (const r of REGIONS) assert.equal(q.regionAt(r.cx, r.cz), r.id, r.id);
  assert.equal(q.regionAt(0, 0), 'spire');
  let max = -Infinity;
  for (let i = 0; i < bake.height.length; i++) if (bake.height[i] > max) max = bake.height[i];
  assert.ok(max > 600 && max < 760, `highest terrain about 700 m (${max.toFixed(0)})`);
});

test('every flatten stamp is flat inside its radius', () => {
  for (const l of LANDMARKS) {
    if (!l.stamp || l.stamp.kind !== 'flatten') continue;
    const r = l.stamp.radius - 12;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (const f of [0, 0.5, 1]) {
        const s = q.slopeAt(l.x + Math.cos(a) * r * f, l.z + Math.sin(a) * r * f);
        assert.ok(s < 0.1, `${l.id}: slope ${s.toFixed(3)} at ${f} of the radius`);
      }
    }
  }
});

test('the 500 m rule holds for the six content regions; the Stormwell has no POIs', () => {
  const left = uncovered(q, pois);
  assert.deepEqual(left, [], 'every land sample is within 500 m of a landmark or POI');
  assert.equal(pois.filter((p) => p.regionId === 'stormwell').length, 0, 'no POIs in the Stormwell');
  const count = (t) => pois.filter((p) => p.type === t).length;
  assert.equal(count('ringstone'), 9);
  assert.equal(count('shrine'), 10);
  assert.equal(count('siphon'), 5);
  assert.equal(count('camp'), 25);
  assert.equal(count('chest'), 20);
  assert.equal(count('crownChest'), 6);
});

test('camps keep 250 m from settlements and 300 m from each other; POI ids are stable', () => {
  const settlements = LANDMARKS.filter((l) => l.type === 'settlement');
  const camps = pois.filter((p) => p.type === 'camp');
  for (const c of camps) {
    for (const s of settlements) assert.ok(Math.hypot(c.x - s.x, c.z - s.z) >= 250, `${c.id} near ${s.id}`);
    for (const d of camps) if (d !== c && d.regionId === c.regionId) assert.ok(Math.hypot(c.x - d.x, c.z - d.z) >= 300, `${c.id} near ${d.id}`);
    assert.equal(c.regionId, c.id.split('_')[1], `${c.id} lies in its region`);
    assert.ok(c.y > 0, `${c.id} is dry`);
  }
  const again = placePois(q, WORLD_SEED);
  assert.deepEqual(again.map((p) => [p.id, p.x, p.z]), pois.map((p) => [p.id, p.x, p.z]));
  assert.equal(new Set(pois.map((p) => p.id)).size, pois.length, 'ids are unique');
});

test('crater lowers the grid only for radius >= 6', () => {
  const b = bakeSync(WORLD_SEED, 8);
  const g = createGrid(b);
  const x = -900;
  const z = 1500;
  const copy = b.height.slice();
  assert.equal(g.crater(x, z, 4, 1.2), false);
  assert.deepEqual(b.height, copy, 'a small crater edits nothing');
  const h0 = g.heightAt(x, z);
  assert.equal(g.crater(x, z, 12, 3.6), true);
  assert.ok(h0 - g.heightAt(x, z) >= 2, 'the bowl is at least 2 m deep');
  let changed = 0;
  for (let i = 0; i < copy.length; i++) {
    if (copy[i] === b.height[i]) continue;
    changed++;
    const gx = (i % b.n) * 8 - 3584;
    const gz = Math.floor(i / b.n) * 8 - 3584;
    assert.ok(Math.hypot(gx - x, gz - z) < 12 * 1.25 + 0.01, 'only samples inside the lip change');
  }
  assert.ok(changed > 0);
});

test('raycast and sweepSphere hit terrain and a test collider; groundAt sees platforms', () => {
  const hit = { hit: false, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: null, colliderId: 0, propKey: 0 };
  const x = -1430;
  const z = 1580;
  const h = grid.heightAt(x, z);
  assert.ok(cols.march(x, h + 50, z, x, h - 50, z, 0, hit), 'a vertical ray hits the ground');
  assert.equal(hit.kind, 'terrain');
  assert.ok(Math.abs(hit.y - h) < 0.2, `hit at the surface (${hit.y} vs ${h})`);
  assert.ok(hit.ny > 0.9, 'flat stamp normal points up');
  const id = cols.add({ shape: 'box', x: x + 20, y: h, z, hx: 2, hz: 2, h: 6, flags: COLLIDER.SOLID | COLLIDER.PLATFORM, propKey: 7 });
  assert.ok(cols.march(x, h + 3, z, x + 40, h + 3, z, 0.5, hit), 'the sweep stops at the box');
  assert.equal(hit.kind, 'collider');
  assert.equal(hit.colliderId, id);
  assert.equal(hit.propKey, 7);
  assert.ok(Math.abs(hit.x - (x + 20 - 2 - 0.5)) < 0.1, `contact at the inflated face (${hit.x})`);
  assert.ok(hit.nx < -0.9, 'normal faces the sweep');
  assert.ok(Math.abs(cols.groundAt(x + 20, h + 6.5, z) - (h + 6)) < 1e-6, 'groundAt stands on the platform top');
  assert.ok(Math.abs(cols.groundAt(x + 20, h + 3, z) - h) < 0.5, 'below the top the terrain is the ground');
  const out = [];
  assert.equal(cols.query(x + 20, z, 5, out), 1);
  cols.remove(id);
  assert.equal(cols.query(x + 20, z, 5, out), 0);
  assert.equal(cols.march(x, h + 3, z, x + 40, h + 3, z, 0.5, hit), false, 'nothing left to hit');
});

test('findSpot never returns water or steep ground', () => {
  const spot = { x: 0, y: 0, z: 0 };
  let found = 0;
  for (let k = 0; k < 120; k++) {
    const a = k * 2.399;
    const d = 300 + ((k * 97) % 3000);
    if (!q.findSpot(Math.cos(a) * d, Math.sin(a) * d, 120, spot, { maxSlope: 0.4 })) continue;
    found++;
    assert.ok(grid.heightAt(spot.x, spot.z) >= 0.5, 'dry');
    assert.ok(grid.slopeAt(spot.x, spot.z) <= 0.4, 'walkable');
  }
  assert.ok(found > 60, `found ${found} spots`);
});

test('scatter is deterministic and the tier caps hold', () => {
  const a = createCellBuffer();
  const b = createCellBuffer();
  let trees = 0;
  let rocks = 0;
  for (let cj = 20; cj < 36; cj++) {
    for (let ci = 6; ci < 22; ci++) {
      const n = scatterCell(ci, cj, WORLD_SEED, grid, a);
      scatterCell(ci, cj, WORLD_SEED, grid, b);
      assert.deepEqual(Array.from(a.key.subarray(0, n)), Array.from(b.key.subarray(0, b.n)));
      for (let i = 0; i < n; i++) {
        if (IS_TREE[a.kind[i]]) trees++;
        else rocks++;
        assert.ok(a.y[i] > 0, 'no props under water');
      }
    }
  }
  assert.ok(trees > 1200 && rocks > 100, `a forest exists (${trees} trees, ${rocks} rocks)`);
  assert.equal(SCATTER_N, 56);
});

test('the Shattered Crown is one ring of large shards around the top of the Spire', async () => {
  const { crownShards, CROWN_LARGE, CROWN_SMALL } = await import('../../src/world/gen/pois.js');
  const base = 120;
  const s = crownShards(7, base);
  assert.equal(s.length, CROWN_LARGE + CROWN_SMALL);
  assert.ok(CROWN_LARGE >= 12 && CROWN_LARGE <= 20, 'twelve to twenty large shards');
  for (let i = 0; i < s.length; i++) {
    const d = Math.hypot(s[i].x, s[i].z);
    const large = i < CROWN_LARGE;
    assert.ok(d > 110 && d < 230, `shard ${i} sits on the ring around the Spire (${d.toFixed(0)} m out)`);
    assert.ok(s[i].y > base + 850 && s[i].y < base + 1000, `shard ${i} floats at the top of the Spire`);
    assert.ok(large ? s[i].r >= 15 : s[i].r < 10, `shard ${i} size`);
  }
  // the large shards are evenly spread around the ring (no gap wider than two slots)
  const ang = s.slice(0, CROWN_LARGE).map((q) => Math.atan2(q.z, q.x)).sort((a, b) => a - b);
  for (let i = 0; i < ang.length; i++) {
    const gap = (i + 1 < ang.length ? ang[i + 1] : ang[0] + Math.PI * 2) - ang[i];
    assert.ok(gap < (Math.PI * 4) / CROWN_LARGE, 'even spacing');
  }
  assert.deepEqual(crownShards(7, base), s);
});
