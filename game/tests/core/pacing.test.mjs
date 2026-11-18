/**
 * Frame pacing (core/pacing): at most 60 presented frames per second at 60, 90, 120 and 144 Hz, evenly spread over
 * the vsyncs, no dropped frame on a jittery 60 Hz display, 30 while paused, and the real elapsed time is handed on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacer, paceFrame, resetPacer, PLAY_FPS_CAP, PAUSED_FPS_CAP } from '../../src/core/pacing.js';
import { createRng } from '../../src/core/rng.js';

/**
 * Run `seconds` of vsyncs through a pacer.
 * @param {(i:number) => number} interval seconds of vsync i
 * @param {number} cap @param {number} seconds
 */
function run(interval, cap, seconds) {
  const p = createPacer();
  let t = 0;
  let presented = 0;
  let elapsedSum = 0;
  let total = 0;
  const gaps = [];
  let since = 0;
  for (let i = 0; t < seconds; i++) {
    const dt = interval(i);
    t += dt;
    since++;
    const e = paceFrame(p, dt, cap);
    if (e >= 0) {
      presented++;
      elapsedSum += e;
      if (i > 20) gaps.push(since);
      since = 0;
    }
    total = t;
  }
  return { fps: presented / total, gaps, elapsedSum, total, pending: p.elapsed };
}

const counts = (gaps) => {
  const c = {};
  for (const g of gaps) c[g] = (c[g] || 0) + 1;
  return c;
};

test('60 Hz: every vsync is presented', () => {
  const r = run(() => 1 / 60, PLAY_FPS_CAP, 10);
  assert.ok(Math.abs(r.fps - 60) < 0.2, String(r.fps));
  assert.deepEqual(Object.keys(counts(r.gaps)), ['1']);
});

test('120 Hz: every second vsync, evenly', () => {
  const r = run(() => 1 / 120, PLAY_FPS_CAP, 10);
  assert.ok(Math.abs(r.fps - 60) < 0.2, String(r.fps));
  assert.deepEqual(Object.keys(counts(r.gaps)), ['2'], JSON.stringify(counts(r.gaps)));
});

test('90 Hz: 60 per second, alternating 2 and 1 vsyncs (never bursts)', () => {
  const r = run(() => 1 / 90, PLAY_FPS_CAP, 10);
  assert.ok(Math.abs(r.fps - 60) < 0.3, String(r.fps));
  const c = counts(r.gaps);
  assert.deepEqual(Object.keys(c).sort(), ['1', '2'], JSON.stringify(c));
  for (let i = 1; i < r.gaps.length; i++) assert.ok(r.gaps[i] + r.gaps[i - 1] === 3, 'a 1-vsync gap is always next to a 2-vsync gap');
});

test('144 Hz: at most 60 per second, 2 or 3 vsyncs apart', () => {
  const r = run(() => 1 / 144, PLAY_FPS_CAP, 10);
  assert.ok(r.fps <= 60.2 && r.fps > 57, String(r.fps));
  const c = counts(r.gaps);
  assert.deepEqual(Object.keys(c).sort(), ['2', '3'], JSON.stringify(c));
});

test('jittery 60 Hz: no frame is skipped', () => {
  const rng = createRng({ seed: 3 });
  // vsync-aligned timestamps with +-2.5 ms of jitter (the sum stays on the vsync grid)
  let prev = 0;
  const jitter = () => (rng.sim.next() - 0.5) * 0.005;
  const r = run((i) => {
    const next = (i + 1) / 60 + jitter();
    const dt = next - prev;
    prev = next;
    return dt;
  }, PLAY_FPS_CAP, 10);
  assert.deepEqual(Object.keys(counts(r.gaps)), ['1'], JSON.stringify(counts(r.gaps)));
});

test('paused: 30 per second at 60 and 120 Hz', () => {
  for (const hz of [60, 120]) {
    const r = run(() => 1 / hz, PAUSED_FPS_CAP, 10);
    assert.ok(Math.abs(r.fps - 30) < 0.2, hz + ' Hz: ' + r.fps);
    assert.deepEqual(Object.keys(counts(r.gaps)), [String(hz / 30)]);
  }
});

test('cap 0 (fpscap=0) presents every vsync; the real elapsed time is handed on', () => {
  const r = run(() => 1 / 120, 0, 5);
  assert.ok(Math.abs(r.fps - 120) < 0.3);
  const c = run(() => 1 / 144, PLAY_FPS_CAP, 5);
  assert.ok(Math.abs(c.elapsedSum + c.pending - c.total) < 1e-9, 'presented frames receive all the real time');
});

test('a long frame does not cause a burst; reset clears the debt', () => {
  const p = createPacer();
  for (let i = 0; i < 30; i++) paceFrame(p, 1 / 120, PLAY_FPS_CAP);
  assert.ok(paceFrame(p, 0.5, PLAY_FPS_CAP) >= 0.5 - 1e-9, 'the long frame presents with its real time');
  let shown = 0;
  for (let i = 0; i < 4; i++) if (paceFrame(p, 1 / 120, PLAY_FPS_CAP) >= 0) shown++;
  assert.equal(shown, 2, 'back to every second vsync right away');
  resetPacer(p);
  assert.equal(p.acc, 0);
  assert.equal(p.elapsed, 0);
});
