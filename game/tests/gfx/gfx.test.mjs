/**
 * gfx pure-logic tests (ARCHITECTURE 8.3 Definition of Done): tier table, dynamic resolution step response,
 * particle pool bookkeeping, recipe table coverage of IDS.vfx, flash budget limiter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, TIER_KEYS, chooseTier } from '../../src/render/logic/tiers.js';
import { createDynRes, DROP_AFTER } from '../../src/render/logic/dynres.js';
import { createCalib, LADDER, MAX_TIME, RETRY_FIRST, RETRY_MAX } from '../../src/render/logic/calib.js';
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
  assert.equal(TIERS.low.programs, 30);
  assert.equal(TIERS.low.maxDpr, 2);
  assert.equal(TIERS.low.shadowSize, 1024);
  assert.equal(TIERS.high.programs, 40);
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

/**
 * A device model for the calibration: presented fps = min(cap, base / ratio^2 / (shadows ? 1.2 : 1)), i.e. a
 * fill-bound GPU whose shadow pass costs 20%; the CPU cost is a fixed `cpuMs` per frame.
 */
function runDevice(calib, base, cpuMs = 8, cap = 60, seconds = 40) {
  let t = 0;
  while (t < seconds && calib.phase !== 'done') {
    const fps = Math.min(cap, base / (calib.scale * calib.scale) / (calib.shadows ? 1.2 : 1));
    const dt = 1 / fps;
    calib.update(dt, false, cpuMs, cap);
    t += dt;
  }
  return t;
}

test('calibration: a weak phone sheds the shadows first and stays at ratio 1 (never worse than before)', () => {
  const c = createCalib({ maxRatio: 2.75, target: 30, shadows: true });
  assert.equal(c.scale, 1, 'starts from the safe ratio of before');
  runDevice(c, 28);
  assert.equal(c.phase, 'done');
  assert.equal(c.shadows, false, 'shadows were the first sacrifice');
  assert.equal(c.scale, 1);
  assert.equal(c.ceiling, 1, 'dynamic resolution then works below 1 as before');
  // the same device far too slow even without shadows: ends at 1 at once (dynamic resolution lowers it to 0.6)
  const d = createCalib({ maxRatio: 2.75, target: 30, shadows: true });
  runDevice(d, 15);
  assert.equal(d.phase, 'done');
  assert.equal(d.scale, 1);
  assert.equal(d.shadows, false);
});

test('calibration: a mid phone climbs while the prediction holds, keeps its shadows', () => {
  const c = createCalib({ maxRatio: 2.625, target: 30, shadows: true });
  runDevice(c, 75);
  assert.equal(c.phase, 'done');
  assert.equal(c.scale, 1.25);
  assert.equal(c.ceiling, 1.25);
  assert.equal(c.shadows, true);
});

test('calibration: a strong phone reaches ratio 2 with shadows; the ladder stops at the device ratio', () => {
  const c = createCalib({ maxRatio: 2.75, target: 30, shadows: true });
  const t = runDevice(c, 400);
  assert.equal(c.scale, 2);
  assert.equal(c.shadows, true);
  assert.ok(t < MAX_TIME + 6, `done within the time budget (${t.toFixed(1)} s)`);
  const d = createCalib({ maxRatio: 1.5, target: 30, shadows: true });
  runDevice(d, 400);
  assert.equal(d.scale, 1.5, 'a 1.5x screen tops out at its own ratio');
  const e = createCalib({ maxRatio: 1, target: 30, shadows: false });
  assert.equal(e.phase, 'done', 'nothing to probe on a 1x screen without shadows');
  assert.deepEqual([...LADDER], [1, 1.25, 1.5, 1.75, 2]);
});

test('calibration: a level that turns out slow sheds shadows, then steps back down and ends', () => {
  const c = createCalib({ maxRatio: 2, target: 30, shadows: true });
  // 60 presented at 1.0, but at 1.25 the device falls to 25 whatever the shadows do
  let t = 0;
  while (t < 30 && c.phase !== 'done') {
    const fps = c.scale > 1 ? 25 : 60;
    c.update(1 / fps, false, 8, 60);
    t += 1 / fps;
  }
  assert.equal(c.scale, 1);
  assert.equal(c.ceiling, 1);
  assert.equal(c.shadows, false);
});

test('calibration: capped menus and holds are not measured; a slow CPU blocks the climb', () => {
  const c = createCalib({ maxRatio: 2, target: 30, shadows: true });
  for (let i = 0; i < 300; i++) assert.equal(c.update(1 / 30, false, 8, 30), false, 'a 30 fps cap says nothing about head-room');
  for (let i = 0; i < 300; i++) assert.equal(c.update(1 / 60, true, 8, 60), false, 'held');
  assert.equal(c.phase, 'probe');
  assert.equal(c.scale, 1);
  // presented at 60 but each frame costs 30 ms of CPU (33 fps): the resolution would not help, no climb
  runDevice(c, 400, 30);
  assert.equal(c.phase, 'done');
  assert.equal(c.scale, 1);
  assert.equal(c.shadows, true);
});

/** Feed `seconds` of frames at a rate given by `fpsAt(t, calib)`; returns the changes as 'time>ratio' strings. */
function play(calib, seconds, fpsAt, opts = {}) {
  const log = [];
  let t = 0;
  while (t < seconds) {
    const v = fpsAt(t, calib);
    const dt = typeof v === 'number' ? 1 / v : v.dt;
    if (calib.update(dt, false, opts.cpuMs || 6, opts.cap === undefined ? 60 : opts.cap, opts.atCeiling === undefined ? true : opts.atCeiling)) {
      log.push(t.toFixed(1) + '>' + calib.scale);
    }
    t += dt;
  }
  return log;
}

test('calibration: a busy start does not decide the session (found on a real phone)', () => {
  // A Galaxy A56 stayed at ratio 1 (384x708 on a 1080 px screen) with 5.6 ms frames: the first second of the title
  // was uneven while the world streamed in, and the first version ended there for good.
  // 1. hitches in the first four seconds, then a steady 60: the hitch windows are not verdicts
  const a = createCalib({ maxRatio: 2.81, target: 30, shadows: true });
  let lastHitch = -1;
  play(a, 30, (t) => {
    if (t < 4 && Math.floor(t * 3) !== lastHitch) {
      lastHitch = Math.floor(t * 3);
      return { dt: 0.14 };
    }
    return t < 4 ? 42 : 60;
  });
  assert.equal(a.scale, 2, 'reaches the top ratio');
  assert.equal(a.shadows, true, 'and keeps its shadows');
  // 2. an even but slower start (45 shown for six seconds: no head-room by the cautious prediction), then 60:
  //    it rests at 1, and the first re-probe climbs
  const b = createCalib({ maxRatio: 2.81, target: 30, shadows: true });
  play(b, 8, (t) => (t < 6 ? 45 : 60));
  assert.equal(b.phase, 'done');
  assert.equal(b.scale, 1, 'rests at 1 for now');
  assert.equal(b.retry, RETRY_FIRST);
  play(b, 40, () => 60);
  assert.equal(b.scale, 2, 'the re-probe climbs to the top');
  assert.ok(b.reprobes >= 1);
  assert.equal(b.shadows, true);
});

test('calibration: a re-probe is careful, takes a failed raise back and waits longer each time', () => {
  // 60 shown at 1.0, 25 at anything above: head-room by the prediction, but the raise does not hold
  const c = createCalib({ maxRatio: 2, target: 30, shadows: false });
  const fps = (t, k) => (k.scale > 1 ? 25 : 60);
  // the first probe steps up at once, finds it slow, comes back and rests
  play(c, 12, fps);
  assert.equal(c.phase, 'done');
  assert.equal(c.scale, 1);
  const first = c.retry;
  assert.ok(first >= RETRY_FIRST * 2, 'a failed start waits longer than the first retry');
  // re-probes: each failed raise doubles the wait, up to the maximum, and the level always comes back to 1
  let waits = [first];
  for (let i = 0; i < 6; i++) {
    const before = c.reprobes;
    play(c, c.retry + 8, fps);
    assert.equal(c.reprobes, before + 1, 'one re-probe per wait');
    assert.equal(c.scale, 1, 'the failed raise was taken back');
    assert.equal(c.phase, 'done');
    waits.push(c.retry);
  }
  for (let i = 1; i < waits.length; i++) assert.ok(waits[i] >= waits[i - 1], 'the wait never shrinks after a failure: ' + waits.join(','));
  assert.equal(waits[waits.length - 1], RETRY_MAX, 'and stops growing at the maximum: ' + waits.join(','));
  // the shadows are never the price of a re-probe
  const d = createCalib({ maxRatio: 2, target: 30, shadows: true });
  play(d, 8, () => 45);
  assert.equal(d.phase, 'done');
  assert.equal(d.shadows, true);
  play(d, 60, (t, k) => (k.scale > 1 ? 25 : 60));
  assert.equal(d.shadows, true, 'a re-probe does not shed the shadows');
  assert.equal(d.scale, 1);
});

test('calibration: resting counts only steady, uncapped play at the ceiling', () => {
  const c = createCalib({ maxRatio: 2, target: 30, shadows: false });
  play(c, 8, () => 45);
  assert.equal(c.phase, 'done');
  // a 30 fps menu, dynamic resolution below the ceiling, and hitches do not count toward the re-probe
  play(c, 60, () => 30, { cap: 30 });
  assert.equal(c.reprobes, 0, 'a capped menu');
  play(c, 60, () => 60, { atCeiling: false });
  assert.equal(c.reprobes, 0, 'the scale was lowered: the device is struggling');
  play(c, 20, () => ({ dt: 0.2 }));
  assert.equal(c.reprobes, 0, 'hitches');
  play(c, RETRY_FIRST + 1, () => 60);
  assert.equal(c.reprobes, 1);
  // at the top level there is nothing left to probe
  const d = createCalib({ maxRatio: 2, target: 30, shadows: true });
  play(d, 20, () => 60);
  assert.equal(d.scale, 2);
  play(d, 600, () => 60);
  assert.equal(d.reprobes, 0);
});

test('calibration: a later session starts from the ratio the device reached', () => {
  // it holds: sharp from the first frame, rests after two windows, shadows kept
  const a = createCalib({ maxRatio: 2.81, target: 30, shadows: true, startRatio: 2 });
  assert.equal(a.scale, 2, 'starts at the remembered ratio');
  play(a, 8, () => 60);
  assert.equal(a.phase, 'done');
  assert.equal(a.scale, 2);
  assert.equal(a.shadows, true);
  // a remembered ratio between two levels starts at the level below it; one above the ladder at its top
  assert.equal(createCalib({ maxRatio: 2.81, target: 30, shadows: true, startRatio: 1.6 }).scale, 1.5);
  assert.equal(createCalib({ maxRatio: 1.5, target: 30, shadows: true, startRatio: 2 }).scale, 1.5);
  assert.equal(createCalib({ maxRatio: 2, target: 30, shadows: true, startRatio: 0 }).scale, 1);
  // it does not hold today (a hot phone: 60 only at 1.25 and below): it comes down level by level, keeps the shadows
  const b = createCalib({ maxRatio: 2.81, target: 30, shadows: true, startRatio: 2 });
  play(b, 30, (t, k) => (k.scale > 1.25 ? 22 : 60));
  assert.equal(b.phase, 'done');
  assert.equal(b.scale, 1.25, 'rests at the first level that holds');
  assert.equal(b.shadows, true, 'the resolution came down before the shadows');
  // too slow even at 1: only then the shadows go
  const d = createCalib({ maxRatio: 2.81, target: 30, shadows: true, startRatio: 1.5 });
  play(d, 40, () => 20);
  assert.equal(d.phase, 'done');
  assert.equal(d.scale, 1);
  assert.equal(d.shadows, false);
  // a device where every frame is long (7 shown) is slow, not "hitching": it comes down just the same
  const e = createCalib({ maxRatio: 2.81, target: 30, shadows: true, startRatio: 2 });
  play(e, 40, () => 7);
  assert.equal(e.phase, 'done');
  assert.equal(e.scale, 1, 'long frames all the time are a slow verdict');
  assert.equal(e.shadows, false);
});

test('dynamic resolution: the shadow map is shed before the scale drops; limit() sets the ceiling', () => {
  const dr = createDynRes(TIERS.low, false);
  dr.limit(1.5);
  dr.scale = 1.5;
  dr.canShed = true;
  // a slow window: the sacrifice is asked for, the scale stays
  assert.equal(feed(dr, 20, 3.05), 0);
  assert.equal(dr.shedRequested, true);
  assert.equal(dr.scale, 1.5);
  dr.shedRequested = false;
  dr.canShed = false;
  // still slow: now the scale drops one step per window
  assert.equal(feed(dr, 20, 3.05), 1);
  assert.equal(dr.scale, 1.4);
  // fast: climbs back, never above the ceiling
  feed(dr, 50, 40);
  assert.equal(dr.scale, 1.5);
  assert.equal(dr.max(), 1.5);
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
