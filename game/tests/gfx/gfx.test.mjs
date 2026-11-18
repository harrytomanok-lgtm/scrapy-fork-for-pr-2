/**
 * gfx pure-logic tests (ARCHITECTURE 8.3 Definition of Done): tier table, dynamic resolution step response,
 * particle pool bookkeeping, recipe table coverage of IDS.vfx, flash budget limiter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, TIER_KEYS, chooseTier } from '../../src/render/logic/tiers.js';
import { createDynRes, DROP_AFTER } from '../../src/render/logic/dynres.js';
import { createParticlePool, cullCoverage } from '../../src/vfx/logic/pool.js';
import { RECIPES, CELL, MAT } from '../../src/vfx/logic/recipes.js';
import { IDS } from '../../src/core/ids.js';
import { createFlashBudget, FLASH_BUDGET } from '../../src/core/fx.js';

test('tier table: both rows complete and matching 7.1', () => {
  for (const t of ['low', 'high']) {
    for (const k of TIER_KEYS) assert.ok(TIERS[t][k] !== undefined, `${t}.${k}`);
    assert.equal(Object.keys(TIERS[t]).length, TIER_KEYS.length);
  }
  assert.equal(TIERS.low.targetFps, 30);
  assert.equal(TIERS.high.targetFps, 60);
  assert.equal(TIERS.low.drawCalls, 120);
  assert.equal(TIERS.low.triangles, 250000);
  assert.equal(TIERS.low.programs, 24);
  assert.equal(TIERS.high.programs, 32);
  assert.equal(TIERS.low.particles, 800);
  assert.equal(TIERS.high.particles, 3500);
  assert.equal(TIERS.low.pointLights, 0);
  assert.equal(TIERS.high.pointLights, 2);
  assert.equal(TIERS.low.bloom, false);
  assert.equal(TIERS.high.bloom, true);
  assert.deepEqual([...TIERS.low.lodRanges], [256, 512, 1152]);
  assert.equal(TIERS.low.dynRes.min, 0.6);
  assert.equal(TIERS.high.dynRes.step, 0.05);
});

test('tier choice: flag > setting > auto', () => {
  assert.equal(chooseTier({ flag: 'high', setting: 'low', coarse: true }), 'high');
  assert.equal(chooseTier({ flag: null, setting: 'low', coarse: false }), 'low');
  assert.equal(chooseTier({ flag: null, setting: 'auto', coarse: true }), 'low');
  assert.equal(chooseTier({ flag: null, setting: 'auto', coarse: false }), 'high');
  assert.equal(chooseTier({ flag: null, setting: null, software: true }), 'low');
});

/** Feed `seconds` of frames at `fps`; returns the number of scale changes. */
function feed(dr, fps, seconds, held = false) {
  let changes = 0;
  const dt = 1 / fps;
  for (let t = 0; t < seconds - 1e-9; t += dt) if (dr.update(dt, held)) changes++;
  return changes;
}

test('dynamic resolution (low): step response to a synthetic fps series', () => {
  const dr = createDynRes(TIERS.low, false);
  assert.equal(dr.scale, 1);
  // on target: nothing moves
  assert.equal(feed(dr, 30, 9), 0);
  // a slow phase: one step down per 3 s window, never below 0.6
  assert.equal(feed(dr, 20, 3.2), 1);
  assert.equal(dr.scale, 0.9);
  feed(dr, 20, 30);
  assert.equal(dr.scale, 0.6);
  // inside the hysteresis band (27..38) nothing changes
  assert.equal(feed(dr, 35, 12), 0);
  assert.equal(dr.scale, 0.6);
  // fast again: one step up per window
  const up = feed(dr, 45, 6.05);
  assert.ok(up >= 1 && up <= 2, 'at most one step per window');
  assert.ok(dr.scale >= 0.7 && dr.scale <= 0.8);
  feed(dr, 45, 30);
  assert.equal(dr.scale, 1);
  // held (cinematic): no change however slow
  assert.equal(feed(dr, 10, 12, true), 0);
  assert.equal(dr.scale, 1);
  // teleport hold blocks for 5 s
  dr.hold(5);
  assert.equal(feed(dr, 10, 4.5), 0);
  assert.equal(feed(dr, 10, 4), 1);
  assert.equal(dr.dropRequested, false);
});

test('dynamic resolution (high): 0.5 s steps of 0.05 and the drop rule', () => {
  const dr = createDynRes(TIERS.high, true);
  feed(dr, 40, 0.51);
  assert.equal(dr.scale, 0.95);
  feed(dr, 40, 2);
  assert.equal(dr.scale, 0.8);
  assert.equal(dr.dropRequested, false);
  feed(dr, 40, DROP_AFTER + 0.1);
  assert.equal(dr.dropRequested, true);
});

/** Feed `seconds` of presented frames at `fps`, each costing `costMs`, under the frame cap `cap`; returns the changes. */
function feedCost(dr, fps, costMs, cap, seconds, held = false) {
  let changes = 0;
  const dt = 1 / fps;
  for (let t = 0; t < seconds - 1e-9; t += dt) if (dr.update(dt, held, costMs, cap)) changes++;
  return changes;
}

test('dynamic resolution (high): decides on the frame cost, so it can raise under the 60 fps cap', () => {
  const dr = createDynRes(TIERS.high, true);
  // presented at the cap but each frame costs 25 ms: the cost says 40 fps, lower
  feedCost(dr, 60, 25, 60, 1.1);
  assert.equal(dr.scale, 0.9);
  // cheap frames (8 ms = 125 fps of headroom) presented at the 60 cap: the scale climbs back to 1
  assert.equal(feedCost(dr, 60, 8, 60, 1.1), 2);
  assert.equal(dr.scale, 1);
  // in the hysteresis band (cost 16 ms = 62.5 fps) nothing moves
  dr.reset();
  feedCost(dr, 60, 25, 60, 0.55);
  assert.equal(dr.scale, 0.95);
  assert.equal(feedCost(dr, 60, 16, 60, 5), 0);
  // GPU-bound: the CPU cost is small but only 45 frames are presented: lower, never raise
  assert.equal(feedCost(dr, 45, 4, 60, 0.55), 1);
  assert.equal(dr.scale, 0.9);
});

test('dynamic resolution (high): a 30 fps capped menu holds, never lowers and never drops the tier', () => {
  const dr = createDynRes(TIERS.high, true);
  feedCost(dr, 60, 25, 60, 2.2);
  assert.equal(dr.scale, 0.8, 'at the minimum');
  // the menu opens: 30 presented frames per second under a cap of 30, slow cost or not
  assert.equal(feedCost(dr, 30, 40, 30, 20), 0);
  assert.equal(dr.scale, 0.8);
  assert.equal(dr.dropRequested, false, 'a capped menu never drops the tier');
  // uncapped again and cheap: the scale climbs
  feedCost(dr, 60, 6, 60, 2.2);
  assert.equal(dr.scale, 1);
  assert.equal(dr.dropRequested, false);
});

test('dynamic resolution (low): cost decisions, and the 30 fps paused cap is not below the target', () => {
  const dr = createDynRes(TIERS.low, false);
  // 30 presented, cost 45 ms (22 fps worth): lower one step per 3 s
  assert.equal(feedCost(dr, 30, 45, 60, 3.05), 1);
  assert.equal(dr.scale, 0.9);
  // the paused cap (30) equals the low target: no hold, cheap frames raise it
  assert.equal(feedCost(dr, 30, 10, 30, 3.05), 1);
  assert.equal(dr.scale, 1);
  // cost 30 ms (33 fps) is inside the band
  assert.equal(feedCost(dr, 30, 30, 60, 9.1), 0);
});

/** Fill one particle. */
function emit(P, life, mat = 0) {
  const i = P.alloc();
  P.life[i] = life;
  P.mat[i] = mat;
  P.px[i] = 0; P.py[i] = 0; P.pz[i] = 0;
  P.vx[i] = 1; P.vy[i] = 0; P.vz[i] = 0;
  P.grav[i] = 0; P.drag[i] = 0;
  return i;
}

test('particle pool: emit, integrate, expire, cap', () => {
  const P = createParticlePool(100);
  P.setCap(10);
  for (let k = 0; k < 5; k++) emit(P, 1);
  assert.equal(P.live, 5);
  P.step(0.5);
  assert.equal(P.live, 5);
  assert.ok(Math.abs(P.px[0] - 0.5) < 1e-6, 'integrated');
  P.step(0.6);
  assert.equal(P.live, 0, 'all expired');
  // cap: the oldest is replaced
  for (let k = 0; k < 10; k++) {
    const i = emit(P, 5);
    P.px[i] = k;
  }
  assert.equal(P.live, 10);
  const i = emit(P, 5);
  P.px[i] = 99;
  assert.equal(P.live, 10, 'live count stays at the cap');
  const xs = Array.from(P.px.slice(0, 10)).sort((a, b) => a - b);
  assert.ok(!xs.includes(0), 'the oldest particle was replaced');
  assert.ok(xs.includes(99));
  // lowering the cap drops the oldest
  P.setCap(4);
  assert.equal(P.live, 4);
  const kept = Array.from(P.px.slice(0, 4)).sort((a, b) => a - b);
  assert.deepEqual(kept, [7, 8, 9, 99]);
  // mixed lifetimes: dense packing survives swap-removal
  P.clear();
  P.setCap(100);
  for (let k = 0; k < 20; k++) emit(P, k % 2 ? 0.1 : 1);
  P.step(0.2);
  assert.equal(P.live, 10);
  for (let k = 0; k < P.live; k++) assert.equal(P.life[k], 1);
});

test('particle pool: overdraw cull removes farthest and oldest first', () => {
  const P = createParticlePool(50);
  for (let k = 0; k < 10; k++) {
    const i = emit(P, 1);
    P.dist[i] = k === 3 ? 100 : 10;
    P.age[i] = k === 7 ? 0.9 : 0.1;
    P.area[i] = 0.1;
    P.px[i] = k;
  }
  const dust = emit(P, 1, 2);
  P.area[dust] = 0;
  P.px[dust] = -1;
  const removed = cullCoverage(P, 0.85, 100);
  assert.equal(removed, 2, 'total 1.0 over 0.85 needs two removals');
  const left = Array.from(P.px.slice(0, P.live));
  assert.ok(!left.includes(3), 'farthest culled');
  assert.ok(!left.includes(7), 'oldest culled');
  assert.ok(left.includes(-1), 'dust (uncounted) kept');
  assert.equal(cullCoverage(P, 0.85, 100), 0, 'under the cap: nothing more');
  // limit per call
  for (let k = 0; k < P.live; k++) P.area[k] = P.mat[k] === 2 ? 0 : 1;
  assert.equal(cullCoverage(P, 0, 3), 3);
});

test('recipe table: every IDS.vfx id has a valid recipe', () => {
  const cells = new Set(Object.values(CELL));
  const mats = new Set(Object.values(MAT));
  for (const id of IDS.vfx) {
    const R = RECIPES[id];
    assert.ok(R, `recipe ${id}`);
    assert.ok(Array.isArray(R.layers) && R.layers.length > 0, `${id} layers`);
    for (const L of R.layers) {
      assert.ok(mats.has(L.m), `${id} material`);
      assert.ok(cells.has(L.cell), `${id} cell`);
      assert.ok((L.n || 0) > 0 || (L.rate || 0) > 0, `${id} emits`);
      assert.ok(L.life[0] > 0 && L.life[1] >= L.life[0], `${id} life`);
      assert.equal(L.sz.length, 2);
    }
  }
  for (const id of ['tele_white', 'tele_red', 'tele_violet']) {
    for (const L of RECIPES[id].layers) assert.equal(L.lo, L.n, `${id} is never reduced on low`);
  }
});

test('flash budget: count and alpha in both modes', () => {
  const b = createFlashBudget();
  let shown = 0;
  for (let k = 0; k < 10; k++) {
    const a = b.request(0.9, k * 0.09, false);
    if (a > 0) {
      shown++;
      assert.ok(a <= FLASH_BUDGET.normal.alpha);
    }
  }
  assert.equal(shown, 3);
  const p = createFlashBudget();
  shown = 0;
  for (let k = 0; k < 10; k++) {
    const a = p.request(0.9, k * 0.09, true);
    if (a > 0) {
      shown++;
      assert.ok(a <= 0.25);
    }
  }
  assert.equal(shown, 2);
  assert.ok(p.request(0.9, 5, true) > 0, 'a new window allows flashes again');
});
