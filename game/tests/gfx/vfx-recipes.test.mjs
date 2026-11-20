/**
 * vfx recipe table checks for the effects polish: the internal ids the service triggers exist, every layer is
 * well formed (colour tokens, sizes, counts), and the new layer fields (cap, lift, gnd, tail, rr) and recipe
 * fields (minSpeed, pillar.y0) carry sane values.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, CELL } from '../../src/vfx/logic/recipes.js';

const TOKENS = new Set(['body', 'fringe', 'core', 'ora', 'oraCore', 'hostile', 'ember', 'tempest', 'zenith', 'kerrin', 'paper', 'ink', 'smoke',
  'scorch', 'scorchRim', 'white', 'red', 'violet', 'foam', 'path', 'common', 'fine', 'rare', 'corruption']);
const CELLS = new Set(Object.values(CELL));

test('the internal recipes the service triggers exist', () => {
  for (const id of ['impact_dust', 'limb_trail', 'takeoff', 'boost_start', 'contrail', 'wake', 'xp_gain', 'pickup_get',
    'ringstone_wake', 'siphon_implode', 'boss_phase', 'nova', 'siphon_break', 'siphon_core']) {
    assert.ok(RECIPES[id], `recipe ${id}`);
  }
});

test('every recipe layer is well formed', () => {
  for (const [id, R] of Object.entries(RECIPES)) {
    assert.ok(TOKENS.has(R.body), `${id}: body token ${R.body}`);
    for (const L of R.layers) {
      assert.ok(TOKENS.has(L.col), `${id}: colour token ${L.col}`);
      assert.ok(CELLS.has(L.cell), `${id}: atlas cell ${L.cell}`);
      assert.ok(L.m === 0 || L.m === 1 || L.m === 2, `${id}: material ${L.m}`);
      assert.ok(L.sz[0] >= 0 && L.sz[1] >= 0 && L.life[0] > 0 && L.life[1] >= L.life[0], `${id}: sizes and life`);
      assert.ok(L.n > 0 || L.rate > 0, `${id}: a layer emits by count or rate`);
      if ('cap' in L) assert.ok(L.cap > 0, `${id}: cap`);
      if ('lift' in L) assert.ok(L.lift > 0 && L.lift < 30, `${id}: lift`);
      if ('tail' in L) assert.ok(L.tail > 0 && L.sh === 'still', `${id}: a tail is a still streak`);
    }
    if (R.minSpeed !== undefined) assert.ok(R.minSpeed > 0 && R.layers.every((L) => L.trail), `${id}: minSpeed only on trails`);
    if (R.pillar && R.pillar.y0 !== undefined) assert.ok(R.pillar.y0 >= 0 && R.pillar.y0 < R.pillar.h, `${id}: pillar y0`);
  }
});

test('hits grow with the damage class', () => {
  const peak = (id) => Math.max(...RECIPES[id].layers.filter((L) => L.m === 0).map((L) => Math.max(L.sz[0], L.sz[1])));
  const sparks = (id) => RECIPES[id].layers.filter((L) => L.m === 1).reduce((s, L) => s + (L.lo ?? Math.ceil(L.n / 2)), 0);
  assert.ok(peak('hit_light') < peak('hit_heavy') && peak('hit_heavy') < peak('hit_finisher'), 'flash size light < heavy < finisher');
  assert.ok(sparks('hit_light') < sparks('hit_heavy') && sparks('hit_heavy') < sparks('hit_finisher'), 'low-tier sparks light < heavy < finisher');
});

test('the Ringfall impact core is capped so the hero stays visible', () => {
  const core = RECIPES.ult_impact.layers.find((L) => L.cell === CELL.dot && L.col === 'core');
  assert.ok(core.cap && core.cap <= 10, 'white core capped');
  assert.ok(RECIPES.ult_impact.pillar.y0 >= 2, 'the light column starts above the hero');
});
