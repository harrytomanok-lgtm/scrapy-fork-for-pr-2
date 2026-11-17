/**
 * Player intent (ARCHITECTURE 8.5): the 0.2 s dash threshold, the touch double-press latch, camera-pitch flight.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIntentInput, createLatch, computeIntent, SPRINT_HOLD } from '../../src/control/logic/intent.js';
import { createIntent } from '../../src/control/logic/mover.js';

const DT = 1 / 60;

/** Drive ticks: script(i, inp) sets the input of tick i. Returns the intents. */
function drive(ticks, script, touch = false) {
  const inp = createIntentInput();
  const latch = createLatch();
  const out = createIntent();
  const sprint = [];
  let held = 0;
  let wasDown = false;
  for (let i = 0; i < ticks; i++) {
    inp.ax = 0; inp.ay = 0; inp.dashDown = false;
    inp.touch = touch;
    inp.t = i * DT;
    script(i, inp);
    held = inp.dashDown ? held + DT : 0;
    inp.dashHeld = held;
    inp.dashPressed = inp.dashDown && !wasDown;
    wasDown = inp.dashDown;
    computeIntent(inp, latch, out);
    sprint.push(out.sprint);
    out.jump = false;
  }
  return { sprint, latch, out };
}

test('a dash press shorter than 0.2 s never sets sprint; a hold sets it after 0.2 s', () => {
  const short = drive(60, (i, inp) => { inp.dashDown = i < 11; });
  assert.ok(short.sprint.every((s) => !s), 'short press');
  const hold = drive(60, (i, inp) => { inp.dashDown = true; });
  const first = hold.sprint.indexOf(true);
  assert.ok(first >= 0);
  assert.ok(Math.abs((first + 1) * DT - SPRINT_HOLD) < DT + 1e-9, `sprint after ${(first + 1) * DT}`);
  assert.ok(hold.sprint.slice(first).every(Boolean));
});

test('a double press latches sprint on touch until the stick is neutral', () => {
  const r = drive(120, (i, inp) => {
    inp.dashDown = (i >= 2 && i < 5) || (i >= 10 && i < 13);
    inp.ay = i < 80 ? 1 : 0;
  }, true);
  assert.equal(r.sprint[9], false, 'not latched after one press');
  assert.equal(r.sprint[14], true, 'latched after the second press');
  assert.equal(r.sprint[79], true, 'held while the stick is deflected');
  assert.equal(r.sprint[81], false, 'released when the stick returns to neutral');
  // A third press turns the latch off.
  const off = drive(60, (i, inp) => {
    inp.dashDown = (i >= 2 && i < 5) || (i >= 10 && i < 13) || (i >= 30 && i < 33);
    inp.ay = 1;
  }, true);
  assert.equal(off.sprint[20], true);
  assert.equal(off.sprint[40], false);
  // Presses further apart than the window do not latch; on keyboard the double press does nothing.
  const slow = drive(80, (i, inp) => { inp.dashDown = (i >= 2 && i < 5) || (i >= 30 && i < 33); inp.ay = 1; }, true);
  assert.ok(slow.sprint.every((s) => !s));
  const kbm = drive(40, (i, inp) => { inp.dashDown = (i >= 2 && i < 5) || (i >= 10 && i < 13); inp.ay = 1; }, false);
  assert.ok(kbm.sprint.every((s) => !s));
});

test('camera-relative stick and camera-pitch flight', () => {
  const inp = createIntentInput();
  const latch = createLatch();
  const out = createIntent();
  // Camera looking along +x: forward = (1,0,0), right = (0,0,1).
  inp.fwdX = 1; inp.fwdZ = 0; inp.rightX = 0; inp.rightZ = 1;
  inp.ay = 1;
  computeIntent(inp, latch, out);
  assert.equal(out.mx, 1);
  assert.equal(out.mz, 0);
  assert.equal(out.up, 0);
  // Flying with pitch flight, camera pitched up 30 degrees: up = sin(30) = 0.5, horizontal scaled by cos.
  inp.flying = true;
  inp.pitchFlight = true;
  inp.pitch = Math.PI / 6;
  computeIntent(inp, latch, out);
  assert.ok(Math.abs(out.up - 0.5) < 1e-9);
  assert.ok(Math.abs(out.mx - Math.cos(Math.PI / 6)) < 1e-9);
  // Diving: pitch -45 degrees.
  inp.pitch = -Math.PI / 4;
  computeIntent(inp, latch, out);
  assert.ok(Math.abs(out.up + Math.SQRT1_2) < 1e-9);
  // Jump adds and the sum clamps to 1.
  inp.pitch = Math.PI / 3;
  inp.jumpDown = true;
  computeIntent(inp, latch, out);
  assert.equal(out.up, 1);
  // Pitch flight off: up comes from the buttons only.
  inp.pitchFlight = false;
  inp.jumpDown = false;
  inp.descendDown = true;
  computeIntent(inp, latch, out);
  assert.equal(out.up, -1);
  assert.equal(out.mx, 1);
});
