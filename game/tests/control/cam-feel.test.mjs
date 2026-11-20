/**
 * Camera feel rules: the lock-on readability band, the eased auto-recentre, and the stick response curve.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lockPitch, recentreStep, LOCK_BAND } from '../../src/control/logic/camMath.js';
import { stickResponse, STICK } from '../../src/control/logic/gesture.js';
import { touchLayout, hitTest, layoutProblems } from '../../src/control/logic/touchLayout.js';

const D2R = Math.PI / 180;
/** Screen offset (+ up, -1..1) of a point at elevation `elev` for a camera pitched `pitch` with half-FOV `half`. */
const screenY = (elev, pitch, half) => Math.tan(elev - pitch) / Math.tan(half);

test('lock band: a high flyer is pulled down under the HUD target frame, a low target up above the deck', () => {
  const half = 37 * D2R;
  // A target 30 degrees above the view axis at rest pitch -15 would sit near the top edge.
  let p = lockPitch(-15 * D2R, 15 * D2R, half, LOCK_BAND.topPortrait, LOCK_BAND.bottomPortrait);
  assert.ok(Math.abs(screenY(15 * D2R, p, half) - LOCK_BAND.topPortrait) < 1e-6);
  // A target far below the view sits at the bottom edge of the band.
  p = lockPitch(-5 * D2R, -30 * D2R, half, LOCK_BAND.topPortrait, LOCK_BAND.bottomPortrait);
  assert.ok(Math.abs(screenY(-30 * D2R, p, half) - LOCK_BAND.bottomPortrait) < 1e-6);
  // Inside the band the pitch is left alone.
  assert.equal(lockPitch(-15 * D2R, -12 * D2R, half, LOCK_BAND.top, LOCK_BAND.bottom), -15 * D2R);
});

test('recentre: eases in after the delay, slows near the heading, lands exactly, never overshoots', () => {
  const rate = 70 * D2R;
  const dt = 1 / 60;
  assert.equal(recentreStep(1, rate, -0.1, dt), 0, 'nothing before the delay');
  const first = recentreStep(1, rate, dt, dt);
  const full = recentreStep(1, rate, 2, dt);
  assert.ok(first > 0 && first < full * 0.05, 'a soft start');
  assert.ok(Math.abs(full - rate * dt) < 1e-9, 'full rate once ramped');
  const near = recentreStep(0.05, rate, 2, dt);
  assert.ok(near < full && near > 0, 'slower near the heading');
  // Run it to the end: monotone, no overshoot.
  let d = 1.2;
  let t = 0;
  let prev = d;
  for (let i = 0; i < 600 && d > 1e-6; i++) {
    t += dt;
    d -= recentreStep(d, rate, t, dt);
    assert.ok(d >= -1e-9 && d <= prev + 1e-12);
    prev = d;
  }
  assert.ok(d < 1e-6, 'reaches the heading in time');
});

test('portrait: a stick thumb landing just above the deck starts the stick, not a camera turn', () => {
  for (const [w, h] of [[400, 860], [360, 640], [412, 915]]) {
    const L = touchLayout({ w, h });
    const deckTop = L.deck.y;
    assert.equal(hitTest(L, 60, deckTop - 20), 'move', `${w}x${h} 20 px above the deck`);
    assert.equal(hitTest(L, Math.round(w * 0.58), deckTop - 20), 'look', 'the right half above the deck still looks');
    assert.equal(hitTest(L, 60, deckTop - 80), 'look', 'higher up is the camera');
    assert.deepEqual(layoutProblems(L, {}), []);
  }
});

test('stick: dead zone, a wide walking band, full speed before the rim', () => {
  assert.equal(stickResponse(STICK.deadZone * 0.9), 0);
  assert.equal(stickResponse(STICK.fullAt), 1);
  assert.equal(stickResponse(0.95), 1);
  // Half the thumb travel is still a walk (under half speed).
  assert.ok(stickResponse(0.5) < 0.5 && stickResponse(0.5) > 0.2, String(stickResponse(0.5)));
  // Monotone.
  let prev = 0;
  for (let n = 0; n <= 1; n += 0.01) {
    const v = stickResponse(n);
    assert.ok(v >= prev - 1e-12);
    prev = v;
  }
});
