/**
 * Touch layout hit-testing (ART_UX 6.1-6.3) and camera spring math (ARCHITECTURE 8.5).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchLayout, hitTest, layoutProblems, TOUCH_BUTTONS } from '../../src/control/logic/touchLayout.js';
import { spring, springAngle, kickEnvelope, frameShift, lockFraming, CAM_MODES } from '../../src/control/logic/camMath.js';

const SCREENS = [
  { name: 'landscape 844x390', w: 844, h: 390, safeL: 47, safeR: 47, safeT: 0, safeB: 21 },
  { name: 'landscape 844x390 no insets', w: 844, h: 390 },
  { name: 'portrait 400x860', w: 400, h: 860, safeT: 47, safeB: 34 },
  { name: 'portrait 360x640', w: 360, h: 640 },
  { name: 'landscape 640x360', w: 640, h: 360 },
];

test('touch layouts: no overlaps, 48 px minimum, 8 px gaps, inside the safe areas, at most ten right-thumb targets', () => {
  for (const s of SCREENS) {
    for (const leftHanded of [false, true]) {
      const L = touchLayout({ ...s, leftHanded });
      assert.equal(L.portrait, s.h > s.w);
      assert.deepEqual(layoutProblems(L, s), [], `${s.name}${leftHanded ? ' left-handed' : ''}`);
      assert.deepEqual(L.buttons.map((b) => b.action).sort(), [...TOUCH_BUTTONS].sort());
      // Every button centre hits that button.
      for (const b of L.buttons) assert.equal(hitTest(L, b.x, b.y), b.action, `${s.name} ${b.action} hit`);
    }
  }
});

test('touch zones: stick zone bottom-left, camera zone elsewhere, Gather and Item on the left thumb', () => {
  const L = touchLayout({ w: 844, h: 390 });
  assert.equal(hitTest(L, 100, 340), 'move');
  assert.equal(hitTest(L, 600, 100), 'look');
  // The arc sits in the right 60% and never inside the stick zone.
  for (const b of L.buttons) {
    if (b.action === 'gather' || b.action === 'item') assert.ok(b.x < 844 * 0.4);
    else assert.ok(b.x > 844 * 0.4, `${b.action} on the right`);
  }
  const P = touchLayout({ w: 400, h: 860 });
  assert.ok(P.deck && Math.abs(P.deck.h - 275) <= 1, 'deck is the bottom 32%');
  assert.equal(hitTest(P, 200, 200), 'look');
  assert.equal(hitTest(P, 80, 800), 'move');
  const g = P.buttons.find((b) => b.action === 'gather');
  assert.ok(g.y > P.deck.y && g.x < 200, 'Gather at the top-left of the deck');
  // Left-handed swaps sides.
  const LH = touchLayout({ w: 844, h: 390, leftHanded: true });
  assert.ok(LH.buttons.find((b) => b.action === 'attack').x < 200);
  assert.equal(hitTest(LH, 744, 340), 'move');
});

test('camera springs converge without overshoot and are frame-rate independent', () => {
  const a = { x: 0, v: 0 };
  let max = 0;
  for (let i = 0; i < 120; i++) {
    spring(a, 10, 8, 1 / 60);
    max = Math.max(max, a.x);
  }
  assert.ok(Math.abs(a.x - 10) < 0.01, `converged ${a.x}`);
  assert.ok(max <= 10 + 1e-9, 'critically damped: no overshoot');
  const b = { x: 0, v: 0 };
  for (let i = 0; i < 60; i++) spring(b, 10, 8, 1 / 30);
  assert.ok(Math.abs(b.x - a.x) < 0.01, 'same result at 30 and 60 fps');
  const half = { x: 0, v: 0 };
  spring(half, 10, 8, 0.2);
  assert.ok(half.x > 3 && half.x < 6, `partial ${half.x}`);
  // Angles take the short way round.
  const ang = { x: 3.0, v: 0 };
  for (let i = 0; i < 120; i++) springAngle(ang, -3.0, 10, 1 / 60);
  assert.ok(ang.x > 3.0, `went through pi: ${ang.x}`);
});

test('FOV kick envelope, framing shift and lock framing', () => {
  assert.equal(kickEnvelope(10, 0.03, 0.25, false), 5);
  assert.equal(kickEnvelope(10, 0.06, 0.25, false), 10);
  assert.equal(kickEnvelope(10, 1, 0.25, false), 0);
  assert.equal(kickEnvelope(10, 5, 0.25, true), 10);
  assert.ok(Math.abs(frameShift(0.5, 5, 60)) < 1e-12, 'centre needs no shift');
  assert.ok(frameShift(0.62, 7, 72) < frameShift(0.55, 7, 72), 'portrait frames the player higher');
  const o = { yaw: 0, dist: 0, blend: 0 };
  lockFraming(0, 0, 0, 3, 1, false, o);
  assert.equal(o.dist, CAM_MODES.lock.dist);
  assert.ok(o.yaw > 0, 'turned to the side');
  lockFraming(0, 0, 0, 40, 1, false, o);
  assert.equal(o.dist, 14, 'widens to 14 m with separation');
});
