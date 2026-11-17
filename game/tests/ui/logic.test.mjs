import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearing, relative, stripX, placePip, tickPositions, compassYaw, headingDeg, wrapPi } from '../../src/ui/logic/compass.js';
import { createRoll, setTarget, advance, rollSteps, rollDuration, ROLL_MAX } from '../../src/ui/logic/digitRoll.js';
import { createSlotPool, acquire, release } from '../../src/ui/logic/slotPool.js';
import { formatInt, formatCompact, formatClock, formatDelta, formatPct, typedChars, quantize } from '../../src/ui/logic/format.js';
import { moveFocus, focusProblems, gridRects, SCREEN_FOCUS_ROWS } from '../../src/ui/logic/focus.js';
import { hudMode, intersects, overlaps } from '../../src/ui/logic/layout.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('compass: bearings follow the world convention (yaw 0 south, pi north, pi/2 east)', () => {
  close(bearing(0, 1), 0);
  close(Math.abs(bearing(0, -1)), Math.PI);
  close(bearing(1, 0), Math.PI / 2);
  close(compassYaw(0), Math.PI);
  close(compassYaw(90), Math.PI / 2);
  close(compassYaw(180), 0);
  close(compassYaw(270), -Math.PI / 2);
  close(headingDeg(Math.PI), 0);
  close(headingDeg(Math.PI / 2), 90);
  close(headingDeg(-Math.PI / 2), 270);
});

test('compass: relative angles wrap and targets on the right sit right of centre', () => {
  close(wrapPi(3 * Math.PI), Math.PI);
  close(relative(Math.PI - 0.1, -Math.PI + 0.1), 0.2);
  // Facing north, a point to the east (+x) is on the right half of the strip.
  const out = { x: 0, on: false, dist: 0, rel: 0 };
  placePip(0, 0, Math.PI, 100, 0, out);
  assert.equal(out.on, false, 'due east is outside a 150 degree strip');
  placePip(0, 0, Math.PI, 100, -100, out);
  assert.ok(out.on && out.x > 0.5 && out.x < 1, 'north-east is right of centre: ' + out.x);
  close(out.dist, Math.hypot(100, 100));
  placePip(0, 0, Math.PI, -100, -100, out);
  assert.ok(out.x < 0.5, 'north-west is left of centre');
  placePip(0, 0, Math.PI, 0, -50, out);
  close(out.x, 0.5);
  // Behind: clamped to an edge for the quest diamond.
  placePip(0, 0, Math.PI, 10, 100, out, true);
  assert.ok(out.x === 0 || out.x === 1);
  assert.equal(out.on, false);
  close(stripX(0), 0.5);
});

test('compass: ticks every 15 degrees, about span/15 of them visible', () => {
  const xs = new Float32Array(24);
  const n = tickPositions(Math.PI, xs);
  assert.ok(n >= 10 && n <= 11, 'visible ticks ' + n);
  close(xs[0], 0.5, 1e-6);
  assert.ok(xs[1] > 0.5, 'N15E is right of north');
  assert.ok(Number.isNaN(xs[12]), 'south is behind');
});

test('digit roll: rolls monotonically from 176 to 880 and lands exactly', () => {
  const steps = rollSteps(176, 880, 30);
  assert.equal(steps[steps.length - 1], 880);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] > steps[i - 1], 'monotonic');
  assert.ok(steps.length > 8, 'visible roll: ' + steps.length + ' steps');
  assert.ok(rollDuration(176, 880) <= ROLL_MAX);
  assert.deepEqual(rollSteps(5, 5), [5]);
  const down = rollSteps(1000, 900);
  assert.equal(down[down.length - 1], 900);
  for (let i = 1; i < down.length; i++) assert.ok(down[i] < down[i - 1]);
});

test('digit roll: retargeting mid-roll continues from the shown value', () => {
  const r = createRoll(100);
  setTarget(r, 1000);
  advance(r, 0.1);
  const mid = r.shown;
  assert.ok(mid > 100 && mid < 1000);
  assert.equal(setTarget(r, 1000), false, 'same target is a no-op');
  setTarget(r, 500);
  assert.equal(r.from, mid);
  for (let i = 0; i < 100; i++) advance(r, 0.05);
  assert.equal(r.shown, 500);
  assert.equal(r.rolling, false);
  assert.equal(advance(r, 1), false);
});

test('damage-number pool: reuses free slots first, then recycles the oldest', () => {
  const p = createSlotPool(3);
  const a = acquire(p);
  const b = acquire(p);
  const c = acquire(p);
  assert.deepEqual([a, b, c].sort(), [0, 1, 2]);
  assert.equal(p.live, 3);
  const d = acquire(p);
  assert.equal(d, a, 'full pool recycles the oldest');
  assert.equal(p.live, 3);
  release(p, b);
  assert.equal(p.live, 2);
  assert.equal(acquire(p), b, 'a released slot is reused');
  const e = acquire(p);
  assert.equal(e, c, 'then the oldest again');
  release(p, 99);
  release(p, b);
  release(p, b);
  assert.equal(p.live, 2, 'double release is ignored');
});

test('number formatting', () => {
  assert.equal(formatInt(1240), '1,240');
  assert.equal(formatInt(1234567.6), '1,234,568');
  assert.equal(formatInt(-1500), '-1,500');
  assert.equal(formatInt(NaN), '0');
  assert.equal(formatInt(0), '0');
  assert.equal(formatCompact(9999), '9,999');
  assert.equal(formatCompact(12345), '12.3k');
  assert.equal(formatCompact(20000), '20k');
  assert.equal(formatCompact(456789), '457k');
  assert.equal(formatCompact(1250000), '1.2M');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatDelta(4), '+4');
  assert.equal(formatDelta(-2.2), '-2');
  assert.equal(formatDelta(0.2), '0');
  assert.equal(formatPct(0.643), '64');
  assert.equal(formatPct(2), '100');
  assert.equal(typedChars(100, 1), 45);
  assert.equal(typedChars(10, 5), 10);
  assert.equal(typedChars(10, 0), 0);
  assert.equal(quantize(1.4), 1);
  assert.equal(quantize(-1), 0);
  assert.equal(quantize(0.5001), 0.5);
});

test('focus: spatial moves in a grid, with wrap-around at the edges', () => {
  const r = gridRects([3, 3]);
  assert.equal(moveFocus(r, 0, 'right'), 1);
  assert.equal(moveFocus(r, 0, 'down'), 3);
  assert.equal(moveFocus(r, 4, 'up'), 1);
  assert.equal(moveFocus(r, 2, 'right'), 0, 'wraps to the row start');
  assert.equal(moveFocus(r, 3, 'down'), 0, 'wraps to the column top');
  assert.equal(moveFocus(r, 0, 'left'), 2);
  assert.equal(moveFocus([], 0, 'up'), -1);
  assert.equal(moveFocus(gridRects([1]), 0, 'up'), 0);
});

test('focus: every screen layout is a graph without dead ends', () => {
  for (const [id, rows] of Object.entries(SCREEN_FOCUS_ROWS)) {
    for (const width of [368, 560, 900]) {
      assert.deepEqual(focusProblems(gridRects(rows, width)), [], `${id} at ${width}px`);
    }
  }
  // An irregular layout: a tab bar over a two-column body with a lone footer button.
  const odd = [
    { x: 0, y: 0, w: 80, h: 40 }, { x: 90, y: 0, w: 80, h: 40 }, { x: 180, y: 0, w: 80, h: 40 },
    { x: 0, y: 60, w: 120, h: 64 }, { x: 140, y: 60, w: 300, h: 200 }, { x: 0, y: 140, w: 120, h: 64 },
    { x: 300, y: 300, w: 140, h: 48 },
  ];
  assert.deepEqual(focusProblems(odd), []);
});

test('layout: modes and intersections', () => {
  assert.equal(hudMode(400, 800, true), 'portrait');
  assert.equal(hudMode(640, 360, true), 'short');
  assert.equal(hudMode(844, 390, true), 'landscape');
  assert.equal(hudMode(1280, 720, false), 'desktop');
  assert.equal(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), false, 'touching edges do not intersect');
  assert.equal(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 }), true);
  assert.deepEqual(overlaps([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 }, { x: 5, y: 5, w: 10, h: 10 }]), [[0, 2]]);
});
