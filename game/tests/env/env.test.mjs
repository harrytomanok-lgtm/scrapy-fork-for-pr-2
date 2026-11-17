/**
 * env package pure-logic tests (ARCHITECTURE 8.2 Definition of Done): day-key interpolation (hour 12 returns the
 * Day key exactly; continuity at 24 -> 0), clock advance (24 real minutes per day at 60 Hz ticks), phases and
 * curves, settlement spot resolution and layouts, every id of IDS.settlement and IDS.prop defined.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Color } from 'three';
import { IDS } from '../../src/core/ids.js';
import { PALETTE } from '../../src/core/palette.js';
import {
  sampleDay, createSample, advanceClock, phaseOf, hexToLinear, nightFactor, lanternFactor, fogDensity, sunDirection,
  lightDirection, wrapHour, SECONDS_PER_HOUR, KEYS,
} from '../../src/env/logic/day.js';
import { SETTLEMENTS, layoutProblems, REQUIRED_SPOTS } from '../../src/env/data/settlements.js';
import { PROP_KINDS } from '../../src/env/data/props.js';
import { createSettlements } from '../../src/env/settlements.js';

const REGION = hexToLinear(PALETTE.biome.meadows.fog);

/** @param {number[]} a @param {number[]} b @param {number} eps */
function close3(a, b, eps = 1e-9) {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;
}

test('hour 12 returns the Day key exactly (fog = region fogDay)', () => {
  const s = sampleDay(12, REGION, createSample());
  const day = PALETTE.day.find((k) => k.key === 'day');
  assert.ok(close3(s.sun, hexToLinear(day.sun)));
  assert.equal(s.intensity, day.intensity);
  assert.ok(close3(s.ambSky, hexToLinear(day.ambSky)));
  assert.ok(close3(s.ambGround, hexToLinear(day.ambGround)));
  assert.ok(close3(s.shadow, hexToLinear(day.shadowTint)));
  assert.ok(close3(s.fog, REGION));
});

test('every key hour returns its key exactly', () => {
  for (const k of PALETTE.day) {
    const s = sampleDay(k.hour, REGION, createSample());
    assert.ok(close3(s.sun, hexToLinear(k.sun)), k.key + ' sun');
    assert.ok(Math.abs(s.intensity - k.intensity) < 1e-12, k.key + ' intensity');
    if (k.fogTint !== null) assert.ok(close3(s.fog, hexToLinear(k.fogTint)), k.key + ' fog');
  }
});

test('the day is continuous across 24 -> 0 and between keys', () => {
  const a = sampleDay(23.9999, REGION, createSample());
  const b = sampleDay(0, REGION, createSample());
  assert.ok(close3(a.sun, b.sun, 1e-4) && close3(a.ambSky, b.ambSky, 1e-4) && close3(a.fog, b.fog, 1e-4));
  assert.ok(Math.abs(a.intensity - b.intensity) < 1e-4);
  // no jumps anywhere: neighbouring samples 0.01 h apart differ by little
  const p = createSample();
  const q = createSample();
  for (let h = 0; h < 24; h += 0.01) {
    sampleDay(h, REGION, p);
    sampleDay(Math.min(24, h + 0.01), REGION, q);
    assert.ok(close3(p.sun, q.sun, 0.01) && Math.abs(p.intensity - q.intensity) < 0.01, 'jump at ' + h.toFixed(2));
  }
  assert.equal(KEYS[0].key, 'night');
  assert.equal(KEYS[KEYS.length - 1].hour, 24);
});

test('linear-space interpolation: the midpoint is the mean of the linear colours', () => {
  const dawn = KEYS.find((k) => k.key === 'dawn');
  const day = KEYS.find((k) => k.key === 'day');
  const s = sampleDay((dawn.hour + day.hour) / 2, REGION, createSample());
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(s.ambSky[i] - (dawn.ambSky[i] + day.ambSky[i]) / 2) < 1e-12);
});

test('clock: 24 real minutes per game day at 60 Hz ticks', () => {
  const st = { hour: 0, day: 1 };
  const ticks = 24 * 60 * 60;
  for (let i = 0; i < ticks; i++) advanceClock(st, 1 / 60, 1);
  assert.equal(st.day, 2);
  assert.ok(st.hour < 1e-6 || st.hour > 24 - 1e-6, 'back at midnight: ' + st.hour);
  const half = { hour: 6, day: 3 };
  for (let i = 0; i < 60 * 60; i++) advanceClock(half, 1 / 60, 1);
  assert.ok(Math.abs(half.hour - 7) < 1e-6, 'one real minute = one game hour');
  assert.equal(SECONDS_PER_HOUR, 60);
  const frozen = { hour: 9, day: 1 };
  advanceClock(frozen, 1, 0);
  assert.equal(frozen.hour, 9, 'scale 0 freezes the clock');
  const fast = { hour: 23, day: 1 };
  assert.equal(advanceClock(fast, 60, 2), true);
  assert.equal(fast.day, 2);
  assert.ok(Math.abs(fast.hour - 1) < 1e-9);
});

test('phases, night, lanterns, fog and light direction', () => {
  assert.equal(phaseOf(6), 'dawn');
  assert.equal(phaseOf(12), 'day');
  assert.equal(phaseOf(18), 'golden');
  assert.equal(phaseOf(20), 'dusk');
  assert.equal(phaseOf(23), 'night');
  assert.equal(phaseOf(2), 'night');
  assert.equal(nightFactor(0), 1);
  assert.equal(nightFactor(12), 0);
  assert.equal(lanternFactor(22), 1);
  assert.equal(lanternFactor(12), 0);
  assert.ok(lanternFactor(19) > 0 && lanternFactor(19) < 1, 'lanterns light at dusk');
  assert.ok(Math.abs(fogDensity(12) - 0.00018) < 1e-12);
  assert.ok(Math.abs(fogDensity(5.5) - 0.00028) < 1e-12);
  const v = { x: 0, y: 0, z: 0 };
  sunDirection(12, v);
  assert.ok(v.y > 0.8 && v.z > 0, 'noon sun is high in the south');
  sunDirection(6, v);
  assert.ok(Math.abs(v.y) < 1e-9 && v.x > 0.9, 'sunrise in the east');
  const s = { x: 0, y: 0, z: 0 };
  const m = { x: 0, y: 0, z: 0 };
  for (let h = 0; h < 24; h += 0.25) {
    lightDirection(h, s, m, v);
    assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9 && v.y >= 0.15, 'light above the horizon at ' + h);
  }
  assert.equal(wrapHour(25), 1);
  assert.equal(wrapHour(-1), 23);
  assert.equal(wrapHour(NaN), 0);
});

test('every id of IDS.settlement has a settlement definition with a valid layout', () => {
  const ids = SETTLEMENTS.map((d) => d.id);
  for (const id of IDS.settlement) assert.ok(ids.includes(id), 'settlement ' + id);
  assert.equal(SETTLEMENTS.length, IDS.settlement.length);
  for (const d of SETTLEMENTS) {
    assert.deepEqual(layoutProblems(d), [], d.id);
    assert.ok(Array.isArray(d.banner) && d.banner.length === 2);
  }
  const spark = SETTLEMENTS.find((d) => d.id === 'sparkstead');
  assert.equal(spark.buildings.filter((b) => b.kind.startsWith('house_')).length, 8, 'Sparkstead has 8 houses');
  assert.ok(spark.buildings.some((b) => b.kind === 'windmill') && spark.buildings.some((b) => b.kind === 'well'));
  const haven = SETTLEMENTS.find((d) => d.id === 'haven_aster');
  assert.ok(haven.buildings.filter((b) => b.kind.startsWith('house_') || b.kind === 'kiteTower' || b.kind === 'well').length >= 16, 'Haven Aster has 16 buildings');
  assert.ok(SETTLEMENTS.find((d) => d.id === 'tide_beacon').buildings.some((b) => b.kind === 'beacon'), 'the Tide Beacon lighthouse');
  assert.ok(SETTLEMENTS.find((d) => d.id === 'still_wind').buildings.some((b) => b.kind === 'cloister'), 'the Still Wind cloister');
});

test('every id of IDS.prop is a defined prop kind with states and a valid default', () => {
  for (const id of IDS.prop) {
    const k = PROP_KINDS[id];
    assert.ok(k, 'prop ' + id);
    assert.ok(Array.isArray(k.states) && k.states.length >= 1);
    assert.equal(typeof k.glow, 'number');
  }
  assert.deepEqual(PROP_KINDS.siphon.states, ['closed', 'open', 'destroyed']);
  assert.deepEqual(PROP_KINDS.chest.states, ['locked', 'closed', 'open']);
  assert.equal(PROP_KINDS.siphon.collider.r, 4);
  assert.equal(PROP_KINDS.siphon.collider.h, 40);
  assert.equal(PROP_KINDS.ringstone.collider.r, 0.8);
  assert.equal(PROP_KINDS.shrine.collider, null);
});

test('settlement spot resolution on a mock world', () => {
  const H = (x, z) => 20 + Math.sin(x * 0.01) * 3 + Math.cos(z * 0.013) * 2;
  const colliders = [];
  const lms = Object.fromEntries(IDS.settlement.map((id, i) => [id, { id, x: i * 900 - 3000, z: 400 - i * 300, stamp: { radius: 80 } }]));
  const mat = () => {
    const pal = [];
    for (let i = 0; i < 16; i++) pal.push(new Color());
    return { uniforms: { uPalette: { value: pal }, uEmissive: { value: new Float32Array(16) } }, dispose() {} };
  };
  const ctx = {
    world: {
      heightAt: H, waterDepthAt: () => 0, landmark: (id) => lms[id] || null,
      addCollider: (c) => { colliders.push(c); return colliders.length; }, removeCollider() {},
    },
    render: { layers: { props: new Group() }, materials: { toon: mat } },
    defs: { find: (kind, id) => SETTLEMENTS.find((d) => d.id === id) || null },
    log: { warn: (...a) => { throw new Error(a.join(' ')); } },
  };
  const s = createSettlements(ctx);
  s.build();
  const st = s.stats();
  assert.equal(st.built, IDS.settlement.length);
  assert.ok(st.colliders > 60 && colliders.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)));
  const out = { x: 0, y: 0, z: 0, yaw: 0 };
  for (const id of IDS.settlement) {
    for (const sp of REQUIRED_SPOTS) {
      assert.ok(s.spot(id, sp, out), id + ':' + sp);
      assert.ok(Math.abs(out.y - H(out.x, out.z)) < 1e-9, 'spot on the ground');
    }
    const info = s.info(id);
    assert.equal(info.id, id);
    assert.equal(info.x, lms[id].x);
  }
  assert.ok(s.spot('sparkstead', 'stall', out));
  assert.equal(out.x, lms.sparkstead.x + 25.5);
  assert.equal(s.spot('sparkstead', 'nowhere', out), false);
  assert.equal(s.spot('nowhere', 'a', out), false);
  s.dispose();
});
