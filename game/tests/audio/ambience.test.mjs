/**
 * Ambience beds and critters (logic/ambience.js), the ambience loop graph with a mock context, and the measured
 * qualities of the internal ambience and sand sounds (tools/audio-qa.mjs analyzer): no clicks, no cut-offs, energy
 * where a phone speaker plays it, nothing harsh.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDS } from '../../src/core/ids.js';
import { createStream } from '../../src/core/rng.js';
import { BEDS, REGION_BED, CRITTERS, HIGH_AIR, bedFor, createCritters } from '../../src/audio/logic/ambience.js';
import { RECIPES, renderRecipe, recipeRate } from '../../src/audio/logic/recipes.js';
import { createLoopSlot, buildLoop, applyBed, applyLevel, LOOP_COST } from '../../src/audio/loops.js';
import { makeAnalyzer, LIMITS } from '../../tools/audio-qa.mjs';

test('every region has a bed, and the bed follows altitude and the shore', () => {
  for (const r of IDS.region) assert.ok(BEDS[REGION_BED[r]], r);
  assert.equal(bedFor('meadows', 2, false), 'meadow');
  assert.equal(bedFor('frostspine', 2, false), 'wind');
  assert.equal(bedFor('stormwell', 2, false), 'hum');
  assert.equal(bedFor('meadows', 2, true), 'surf');
  assert.equal(bedFor('coast', HIGH_AIR + 1, true), 'wind');
});

test('critters: deterministic, sparse, by day and night, around the listener', () => {
  const run = (bed, night) => {
    const c = createCritters(createStream(5));
    const out = { id: '', dx: 0, dy: 0, dz: 0, vol: 0, pitch: 0 };
    const calls = [];
    for (let i = 0; i < 60 * 120; i++) if (c.step(1 / 60, bed, night, out)) calls.push({ ...out });
    return calls;
  };
  const day = run('meadow', false);
  assert.deepEqual(day, run('meadow', false), 'deterministic');
  assert.ok(day.length >= 15 && day.length <= 70, 'birds every few seconds (' + day.length + ' in 2 min)');
  for (const c of day) {
    assert.ok(CRITTERS.meadow.day.includes(c.id));
    const d = Math.hypot(c.dx, c.dz);
    assert.ok(d >= 12 && d <= 35, 'distance ' + d);
  }
  assert.ok(run('meadow', true).every((c) => c.id === 'amb_cricket'), 'crickets at night');
  assert.equal(run('wind', false).length, 0, 'nothing chirps in the wind');
  for (const bed of Object.keys(CRITTERS)) for (const id of [...CRITTERS[bed].day, ...CRITTERS[bed].night]) assert.ok(RECIPES[id] && RECIPES[id].internal, id);
});

test('the ambience loop builds within its node cost and glides between beds', () => {
  const p = (v = 0) => ({ value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime(x) { this.value = x; } });
  const node = (x) => ({ connect() {}, disconnect() {}, ...x });
  const ac = {
    createGain: () => node({ gain: p(1) }), createBiquadFilter: () => node({ type: 'lowpass', frequency: p(), Q: p() }),
    createOscillator: () => node({ type: 'sine', frequency: p(), start() {}, stop() {} }), createBufferSource: () => node({ buffer: null, loop: false, playbackRate: p(1), start() {}, stop() {} }),
    createStereoPanner: () => node({ pan: p() }),
  };
  const L = createLoopSlot();
  buildLoop(ac, L, 'ambience', { pink: {}, white: {}, clipCurve: new Float32Array(4) });
  assert.equal(L.nodes.length, LOOP_COST.ambience);
  for (const bed of Object.keys(BEDS)) {
    applyBed(L, bed, 0);
    assert.equal(L.bed, bed);
    assert.equal(L.a.frequency.value, BEDS[bed].f);
    assert.equal(L.c.gain.value, BEDS[bed].hum);
    assert.ok(applyLevel(L, 1, 0) > applyLevel(L, 0, 0), 'exposure raises the bed');
  }
});

test('ambience and sand sounds: no click, no cut-off, phone band, not harsh', () => {
  const QA = makeAnalyzer();
  for (const id of Object.keys(RECIPES)) {
    if (!RECIPES[id].internal) continue;
    for (let v = 0; v < 2; v++) {
      const r = QA.analyze([renderRecipe(id, v)], recipeRate(id), 'sfx');
      assert.ok(r.click <= LIMITS.click, id + ' click ' + r.click);
      assert.ok(r.tail <= LIMITS.tail, id + ' cut-off ' + r.tail);
      assert.ok(r.ph >= LIMITS.phone, id + ' phone band ' + r.ph);
      assert.ok(r.hi <= LIMITS.hi, id + ' harsh ' + r.hi);
    }
  }
});

test('every one-shot passes the source checks of the QA tool (click, cut-off, DC, phone band, harshness)', () => {
  const QA = makeAnalyzer();
  for (const id of Object.keys(RECIPES)) {
    if (RECIPES[id].live) continue;
    const r = QA.analyze([renderRecipe(id, 0)], recipeRate(id), 'sfx');
    assert.ok(r.click <= LIMITS.click, id + ' click ' + r.click.toFixed(1));
    assert.ok(r.tail <= LIMITS.tail, id + ' cut-off ' + r.tail.toFixed(1));
    assert.ok(Math.abs(r.dc) <= LIMITS.dc, id + ' dc ' + r.dc);
    assert.ok(r.ph >= LIMITS.phone, id + ' phone band ' + r.ph.toFixed(2));
    assert.ok(r.hi <= LIMITS.hi, id + ' harsh ' + r.hi.toFixed(2));
  }
});
