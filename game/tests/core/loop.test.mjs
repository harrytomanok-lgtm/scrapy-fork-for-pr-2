import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../../src/core/context.js';
import { createTime } from '../../src/core/time.js';
import { SIM_DT, MAX_STEPS } from '../../src/core/constants.js';

function fakeLog() {
  const errors = [];
  return { errors, info() {}, warn() {}, error(...a) { errors.push(a.join(' ')); } };
}

/** Context with a manual rAF driver and a probe system recording gameplay ticks. */
function setup(flags = { test: true }) {
  const log = fakeLog();
  const ctx = createContext({ flags, log, loop: { raf: () => 1, caf() {}, now: () => 0 } });
  const probe = { gameplay: 0, steps: 0, frames: 0, dts: [], alphas: [] };
  ctx.systems.add({ id: 't.gameplay', phase: 'combat', step(c, dt) { probe.gameplay++; probe.dts.push(dt); } });
  ctx.systems.add({ id: 't.always', phase: 'input', order: 50, step() { probe.steps++; } });
  ctx.systems.add({ id: 't.frame', phase: 'render', frame(c, dt, alpha) { probe.frames++; probe.alphas.push(alpha); } });
  return { ctx, log, probe };
}

test('stepSim runs exactly n ticks and advances tick, real and now', () => {
  const { ctx, probe } = setup();
  assert.equal(ctx.loop.stepSim(120), 120);
  assert.equal(ctx.time.tick, 120);
  assert.equal(probe.steps, 120);
  assert.equal(probe.gameplay, 120);
  assert.ok(Math.abs(ctx.time.real - 2) < 1e-9);
  assert.ok(Math.abs(ctx.time.now - 2) < 1e-9);
  assert.equal(probe.frames, 0, 'stepSim does not render');
});

test('hit-stop freezes gameplay phases for round(ms / 16.667) ticks; the longer wins, calls do not stack', () => {
  const { ctx, probe } = setup();
  ctx.time.hitStop(100); // 6 ticks
  assert.equal(ctx.time.frozen, true);
  ctx.time.hitStop(50); // shorter: ignored
  ctx.loop.stepSim(6);
  assert.equal(probe.gameplay, 0);
  assert.equal(probe.steps, 6, 'non-gameplay phases still run');
  assert.equal(ctx.time.now, 0, 'gameplay time does not advance during hit-stop');
  assert.ok(Math.abs(ctx.time.real - 6 * SIM_DT) < 1e-12);
  assert.equal(ctx.time.frozen, false);
  ctx.loop.stepSim(1);
  assert.equal(probe.gameplay, 1);

  ctx.time.hitStop(50); // 3 ticks
  ctx.loop.stepSim(1);
  ctx.time.hitStop(100); // 6 > 2 remaining: longer wins, no stacking (6, not 8)
  ctx.loop.stepSim(6);
  assert.equal(probe.gameplay, 1);
  ctx.loop.stepSim(1);
  assert.equal(probe.gameplay, 2);
});

test('hit-stop requested during a step starts with the next step', () => {
  const { ctx, probe } = setup();
  let fired = false;
  ctx.systems.add({ id: 't.hit', phase: 'intent', step(c) { if (!fired) { fired = true; c.time.hitStop(33.4); } } });
  ctx.loop.stepSim(1);
  assert.equal(probe.gameplay, 1, 'the current step finishes its gameplay phases');
  ctx.loop.stepSim(2);
  assert.equal(probe.gameplay, 1);
  ctx.loop.stepSim(1);
  assert.equal(probe.gameplay, 2);
});

test('slow-mo scales gameplay dt for its unscaled duration; the lowest scale wins', () => {
  const { ctx, probe } = setup();
  ctx.time.slowMo(0.5, 0.5); // 30 ticks
  ctx.time.slowMo(0.25, 0.1); // 6 ticks
  ctx.loop.stepSim(6);
  assert.ok(probe.dts.every((d) => Math.abs(d - SIM_DT * 0.25) < 1e-12));
  assert.equal(ctx.time.scale, 0.25);
  probe.dts.length = 0;
  ctx.loop.stepSim(24);
  assert.ok(probe.dts.every((d) => Math.abs(d - SIM_DT * 0.5) < 1e-12));
  probe.dts.length = 0;
  ctx.loop.stepSim(1);
  assert.equal(ctx.time.scale, 1);
  assert.ok(Math.abs(probe.dts[0] - SIM_DT) < 1e-12);
  const expectedNow = 6 * SIM_DT * 0.25 + 24 * SIM_DT * 0.5 + SIM_DT;
  assert.ok(Math.abs(ctx.time.now - expectedNow) < 1e-9);
  assert.ok(Math.abs(ctx.time.real - 31 * SIM_DT) < 1e-9);
});

test('slow-mo duration counts unscaled ticks, including hit-stop ticks', () => {
  const { ctx } = setup();
  ctx.time.slowMo(0.5, 0.1); // 6 ticks
  ctx.time.hitStop(67); // 4 ticks
  ctx.loop.stepSim(6);
  ctx.loop.stepSim(1);
  assert.equal(ctx.time.scale, 1);
  assert.ok(Math.abs(ctx.time.now - (2 * SIM_DT * 0.5 + SIM_DT)) < 1e-9);
});

test('pause reasons: paused while the set is non-empty; game:paused is emitted on each change', () => {
  const { ctx } = setup();
  const seen = [];
  ctx.bus.on('game:paused', (p) => seen.push(`${p.reason}:${p.paused}`));
  ctx.time.pause('menu');
  ctx.time.pause('menu');
  ctx.time.pause('dialogue');
  assert.equal(ctx.time.paused, true);
  ctx.time.resume('menu');
  assert.equal(ctx.time.paused, true);
  ctx.time.resume('dialogue');
  ctx.time.resume('dialogue');
  assert.equal(ctx.time.paused, false);
  assert.deepEqual(seen, ['menu:true', 'dialogue:true', 'menu:true', 'dialogue:false']);
});

test('stepSim ignores the debug pause reason but no other', () => {
  const { ctx } = setup();
  ctx.time.pause('debug');
  assert.equal(ctx.loop.stepSim(5), 5);
  ctx.time.pause('menu');
  assert.equal(ctx.loop.stepSim(5), 0);
  assert.equal(ctx.time.tick, 5);
  ctx.time.resume('menu');
  assert.equal(ctx.loop.stepSim(2), 2);
});

test('real-time frames: accumulator, MAX_STEPS cap with excess dropped, alpha', () => {
  const { ctx, probe } = setup({});
  ctx.loop.frame(SIM_DT);
  assert.equal(probe.steps, 1);
  ctx.loop.frame(SIM_DT / 2);
  assert.equal(probe.steps, 1);
  assert.ok(Math.abs(probe.alphas.at(-1) - 0.5) < 1e-6);
  ctx.loop.frame(SIM_DT / 2);
  assert.equal(probe.steps, 2);
  ctx.loop.frame(1); // clamped to 0.1 s = 6 steps worth, capped at MAX_STEPS
  assert.equal(probe.steps, 2 + MAX_STEPS);
  assert.ok(probe.alphas.at(-1) >= 0 && probe.alphas.at(-1) < 1, 'excess dropped');
  ctx.loop.frame(0);
  assert.equal(probe.steps, 2 + MAX_STEPS, 'nothing carried over beyond one step');
  assert.equal(probe.frames, 5, 'one frame pass per frame');
});

test('real-time frames: no sim steps while paused, the frame pass still runs', () => {
  const { ctx, probe } = setup({});
  ctx.time.pause('menu');
  ctx.loop.frame(0.05);
  ctx.loop.frame(0.05);
  assert.equal(probe.steps, 0);
  assert.equal(probe.frames, 2);
  ctx.time.resume('menu');
  ctx.loop.frame(SIM_DT);
  assert.equal(probe.steps, 1, 'no burst after resume');
});

test('test mode without autoplay does not feed the accumulator; renderNow runs one frame pass with dt 0', () => {
  const { ctx, probe } = setup({ test: true });
  ctx.loop.frame(0.1);
  assert.equal(probe.steps, 0);
  assert.equal(probe.frames, 1);
  assert.equal(probe.alphas.at(-1), 1);
  let lastDt = -1;
  ctx.systems.add({ id: 't.dt', phase: 'ui', frame(c, dt) { lastDt = dt; } });
  ctx.loop.renderNow();
  assert.equal(lastDt, 0);
  assert.equal(probe.frames, 2);

  const auto = setup({ test: true, autoplay: true });
  auto.ctx.loop.frame(SIM_DT * 2);
  assert.equal(auto.probe.steps, 2);
});

test('start drives frames from requestAnimationFrame timestamps; stop cancels', () => {
  let cb = null;
  let cancelled = 0;
  const ctx = createContext({ flags: {}, log: fakeLog(), loop: { raf: (f) => { cb = f; return 7; }, caf: () => { cancelled++; }, now: () => 0 } });
  let steps = 0;
  ctx.systems.add({ id: 't.s', phase: 'script', step() { steps++; } });
  ctx.loop.start();
  assert.equal(ctx.loop.running, true);
  cb(1000);
  cb(1000 + 1000 / 60);
  cb(1000 + 3000 / 60);
  assert.equal(steps, 3);
  ctx.loop.stop();
  assert.equal(cancelled, 1);
  assert.equal(ctx.loop.running, false);
});

test('time without a bus still works (standalone clock)', () => {
  const t = createTime();
  t.pause('cine');
  assert.equal(t.paused, true);
  assert.equal(t.pausedExcept('debug'), true);
  assert.equal(t.pausedExcept('cine'), false);
  t.resume('cine');
  t.setBaseScale(2);
  assert.equal(t.scale, 2);
  t.beginStep();
  t.endStep();
  assert.ok(Math.abs(t.now - 2 * SIM_DT) < 1e-12);
});
