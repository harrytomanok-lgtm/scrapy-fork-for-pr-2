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

/** A context driven by a manual rAF with a fake clock; frames counts presented frame passes. */
function rafSetup(flags = {}) {
  let cb = null;
  let nowMs = 0;
  const ctx = createContext({ flags, log: fakeLog(), loop: { raf: (f) => { cb = f; return 1; }, caf() {}, now: () => nowMs } });
  const probe = { steps: 0, frames: 0, dts: [] };
  ctx.systems.add({ id: 't.s', phase: 'script', step() { probe.steps++; } });
  ctx.systems.add({ id: 't.f', phase: 'render', frame(c, dt) { probe.frames++; probe.dts.push(dt); nowMs += 2; } });
  ctx.loop.start();
  let t = 1000;
  /** @param {number} hz @param {number} n */
  const vsyncs = (hz, n) => {
    for (let i = 0; i < n; i++) {
      t += 1000 / hz;
      cb(t);
    }
  };
  /** @param {number} ms */
  const gap = (ms) => {
    t += ms;
    cb(t);
  };
  cb(t);
  return { ctx, probe, vsyncs, gap };
}

test('frame cap: 60 presented frames per second on a 120 Hz screen, the sim stays at 60 Hz, frames get real time', () => {
  const { ctx, probe, vsyncs } = rafSetup();
  probe.frames = 0;
  vsyncs(120, 240);
  assert.ok(Math.abs(probe.frames - 120) <= 1, 'two seconds at 120 Hz present 120 frames (' + probe.frames + ')');
  assert.ok(Math.abs(probe.steps - 120) <= 2, 'the sim ran 120 steps (' + probe.steps + ')');
  for (const dt of probe.dts.slice(2)) assert.ok(Math.abs(dt - 1 / 60) < 1e-6, 'each frame receives the real elapsed time');
  assert.ok(ctx.loop.stats.costMs > 0 && ctx.loop.stats.costMs < 5, 'costMs measures the work, not the interval');
  assert.equal(ctx.loop.stats.cap, 60);
});

test('frame cap: paused at most 30; fpscap=0 presents every vsync', () => {
  const a = rafSetup();
  a.ctx.time.pause('menu');
  a.probe.frames = 0;
  a.vsyncs(120, 240);
  assert.ok(Math.abs(a.probe.frames - 60) <= 1, 'paused: 30 per second (' + a.probe.frames + ')');
  a.ctx.time.pause('debug');
  a.ctx.time.resume('menu');
  a.probe.frames = 0;
  a.vsyncs(120, 240);
  assert.ok(Math.abs(a.probe.frames - 120) <= 1, 'the debug pause (tests) keeps 60');
  // the paused cap is 30 on every tier, the high tier (target 60) included: dynres holds while the cap is below it
  const h = rafSetup();
  h.ctx.render = { caps: { targetFps: 60 } };
  h.ctx.time.pause('menu');
  h.probe.frames = 0;
  h.vsyncs(120, 240);
  assert.ok(Math.abs(h.probe.frames - 60) <= 1, 'high tier paused: 30 per second (' + h.probe.frames + ')');
  assert.equal(h.ctx.loop.stats.cap, 30);
  const b = rafSetup({ fpscap: false });
  b.probe.frames = 0;
  b.vsyncs(120, 240);
  assert.equal(b.probe.frames, 240);
});

test('catch-up is clamped after a long frame, and a background gap resyncs without a burst', () => {
  const { ctx, probe, vsyncs, gap } = rafSetup();
  vsyncs(60, 30);
  let s0 = probe.steps;
  gap(400); // one very long frame (GC, slow device): at most MAX_STEPS, the rest is dropped
  assert.ok(probe.steps - s0 <= MAX_STEPS, 'at most MAX_STEPS steps after a long frame');
  vsyncs(60, 1);
  assert.ok(probe.steps - s0 <= MAX_STEPS + 2, 'no spiral after it');
  s0 = probe.steps;
  const f0 = probe.frames;
  gap(30000); // the page was hidden: rAF stopped for 30 s
  assert.equal(probe.steps, s0, 'returning from the background runs no catch-up steps');
  vsyncs(60, 1);
  assert.ok(probe.steps - s0 <= 1, 'the first frame after the return runs one step at most');
  assert.ok(probe.frames > f0);
  ctx.loop.resync();
  s0 = probe.steps;
  gap(200);
  assert.equal(probe.steps, s0, 'resync forgets the last timestamp (visibilitychange)');
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
