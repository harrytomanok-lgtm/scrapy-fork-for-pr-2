import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerfLog, formatDeviceReport } from '../../src/ui/logic/perfLog.js';

test('perf log: averages, the 1% low, slow frames and the window', () => {
  const log = createPerfLog(1000);
  assert.equal(log.summary().frames, 0);
  for (let i = 0; i < 990; i++) log.push(1 / 60);
  for (let i = 0; i < 10; i++) log.push(0.05);
  log.push(5); // a pause, not a frame
  log.push(0);
  const s = log.summary();
  assert.equal(s.frames, 1000);
  assert.ok(Math.abs(s.avgFps - 58.8) < 0.5, 'average ' + s.avgFps);
  assert.ok(Math.abs(s.lowFps - 20) < 0.5, '1% low ' + s.lowFps);
  assert.ok(Math.abs(s.worstMs - 50) < 0.01);
  assert.ok(Math.abs(s.slowPct - 1) < 0.01);
  for (let i = 0; i < 1000; i++) log.push(1 / 30); // the window rolls over
  assert.ok(Math.abs(log.summary().avgFps - 30) < 0.1);
  log.clear();
  assert.equal(log.summary().frames, 0);
});

test('device report: says so when there is not enough play, and prints the numbers when there is', () => {
  const d = { gpu: 'Mali-G78', cssW: 412, cssH: 915, dpr: 2.625, canvasW: 412, canvasH: 915, scale: 1, tier: 'low', costMs: 6.24, cap: 60, drawCalls: 44, triangles: 120500, heapMb: 58.2, audio: 'running', storage: 'saved on device', bake: 'worker', device: 'touch', ua: 'Mozilla/5.0 (Linux; Android 14)' };
  const few = formatDeviceReport({ frames: 10, seconds: 0.2, avgFps: 60, lowFps: 60, worstMs: 17, slowPct: 0 }, d);
  assert.match(few, /not enough play yet/);
  const full = formatDeviceReport({ frames: 3600, seconds: 61.2, avgFps: 58.8, lowFps: 41.3, worstMs: 48, slowPct: 1.25 }, d);
  assert.match(full, /gpu: Mali-G78/);
  assert.match(full, /avg 59, 1% low 41, worst frame 48 ms, slow frames 1\.3%/);
  assert.match(full, /412x915 css, dpr 2\.63, canvas 412x915, scale 1\.00, tier low/);
  assert.match(full, /audio running, storage saved on device, world bake worker, input touch/);
});
