/**
 * Camera rotation interpolation (control/logic/camMath interpAngle): yaw changes in 60 Hz sim steps, the rig shows it
 * between the last two steps with the frame alpha, so a constant drag turns the view evenly at 120 Hz, 90 Hz and on a
 * jittery 60 Hz display (frames with 0 or 2 steps), and the short way round across +-PI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { interpAngle } from '../../src/control/logic/camMath.js';
import { SIM_DT } from '../../src/core/constants.js';
import { angleDelta } from '../../src/core/math.js';

test('interpAngle: endpoints, midpoint, short way round across PI, alpha clamped', () => {
  assert.equal(interpAngle(0.2, 0.6, 0), 0.2);
  assert.ok(Math.abs(interpAngle(0.2, 0.6, 1) - 0.6) < 1e-12);
  assert.ok(Math.abs(interpAngle(0.2, 0.6, 0.5) - 0.4) < 1e-12);
  const a = Math.PI - 0.1;
  const b = -Math.PI + 0.1;
  const mid = interpAngle(a, b, 0.5);
  assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 1e-9, 'crosses PI, not zero: ' + mid);
  assert.ok(Math.abs(interpAngle(a, b, 2) - b) < 1e-9);
  assert.equal(interpAngle(a, b, -1), a);
});

/**
 * A constant-rate drag through a fixed-step loop driven by display frames; returns the per-frame turn of the shown
 * yaw (radians) and the per-frame elapsed time.
 * @param {(i:number) => number} frameDt @param {number} frames @param {boolean} interp
 */
function drag(frameDt, frames, interp) {
  const rate = 2; // rad/s
  let acc = 0;
  let yaw = 3; // close to PI so the drag wraps
  let yaw0 = yaw;
  let shown = yaw;
  const turns = [];
  const dts = [];
  for (let i = 0; i < frames; i++) {
    const dt = frameDt(i);
    acc += dt;
    while (acc >= SIM_DT - 1e-9) {
      acc -= SIM_DT;
      yaw0 = yaw;
      yaw = interpAngle(yaw, yaw + rate * SIM_DT, 1);
    }
    const now = interp ? interpAngle(yaw0, yaw, acc / SIM_DT) : yaw;
    if (i > 2) {
      turns.push(angleDelta(shown, now));
      dts.push(dt);
    }
    shown = now;
  }
  return { turns, dts, rate };
}

test('120 Hz: the view turns by the same angle every frame (no 0, 2x, 0, 2x pattern)', () => {
  const raw = drag(() => 1 / 120, 240, false);
  assert.ok(raw.turns.some((t) => Math.abs(t) < 1e-9), 'without interpolation every other frame does not turn');
  const r = drag(() => 1 / 120, 240, true);
  for (const t of r.turns) assert.ok(Math.abs(t - r.rate / 120) < 1e-6, 'even turn per frame: ' + t);
});

test('90 Hz and jittery 60 Hz: the turn of each frame follows its real time', () => {
  const r90 = drag(() => 1 / 90, 270, true);
  for (const t of r90.turns) assert.ok(Math.abs(t - r90.rate / 90) < 1e-6, '90 Hz: ' + t);
  // vsync-aligned jitter: a late frame (2 steps) then an early one (0 steps)
  const pattern = [1 / 60, 1.45 / 60, 0.55 / 60, 1 / 60];
  const j = drag((i) => pattern[i % pattern.length], 240, true);
  for (let i = 0; i < j.turns.length; i++) assert.ok(Math.abs(j.turns[i] - j.rate * j.dts[i]) < 1e-6, 'jittery 60 Hz frame ' + i);
  const raw = drag((i) => pattern[i % pattern.length], 240, false);
  assert.ok(raw.turns.some((t, i) => Math.abs(t - raw.rate * raw.dts[i]) > 0.005), 'without interpolation the turn does not follow time');
});
