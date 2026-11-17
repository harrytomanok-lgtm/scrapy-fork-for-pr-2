import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags, readFlags } from '../../src/core/flags.js';

test('defaults outside test mode', () => {
  const f = parseFlags('');
  assert.equal(f.test, false);
  assert.equal(f.autoplay, false);
  assert.equal(f.quality, null);
  assert.equal(f.res, null);
  assert.equal(f.seed, null);
  assert.equal(f.worldseed, null);
  assert.equal(f.lang, null);
  assert.equal(f.grid, null);
  assert.equal(f.spawn, null);
  assert.equal(f.hour, null);
  assert.equal(f.tutorial, 1);
  assert.equal(f.nosave, false);
  assert.equal(f.noaudio, false);
  assert.equal(f.debug, false);
  assert.equal(f.fps, false);
  assert.equal(f.bench, false);
  assert.deepEqual(f.raw, {});
});

test('the harness query', () => {
  const f = parseFlags('?test=1&quality=low&res=0.5&noaudio=1&seed=123&lang=en');
  assert.equal(f.test, true);
  assert.equal(f.quality, 'low');
  assert.equal(f.res, 0.5);
  assert.equal(f.noaudio, true);
  assert.equal(f.seed, 123);
  assert.equal(f.lang, 'en');
  assert.equal(f.tutorial, 0, 'test mode defaults to the tutorial=0 shortcut');
  assert.equal(f.nosave, true, 'test mode storage is memory-only');
  assert.equal(f.raw.seed, '123');
});

test('autoplay only counts with test', () => {
  assert.equal(parseFlags('autoplay=1').autoplay, false);
  assert.equal(parseFlags('test=1&autoplay=1').autoplay, true);
});

test('malformed values fall back', () => {
  const f = parseFlags('quality=ultra&lang=fr&grid=6&seed=1.5&worldseed=x&res=abc&hour=&tutorial=2');
  assert.equal(f.quality, null);
  assert.equal(f.lang, null);
  assert.equal(f.grid, null);
  assert.equal(f.seed, null);
  assert.equal(f.worldseed, null);
  assert.equal(f.res, null);
  assert.equal(f.hour, null);
  assert.equal(f.tutorial, 1);
});

test('ranges are clamped or wrapped', () => {
  assert.equal(parseFlags('res=0.1').res, 0.3);
  assert.equal(parseFlags('res=4').res, 1);
  assert.equal(parseFlags('hour=24').hour, 0);
  assert.equal(parseFlags('hour=17.5').hour, 17.5);
  assert.equal(parseFlags('hour=-2').hour, 22);
  assert.equal(parseFlags('grid=8').grid, 8);
  assert.equal(parseFlags('worldseed=-7').worldseed, -7);
});

test('spawn by coordinates or by id', () => {
  assert.deepEqual(parseFlags('spawn=-1430,1580').spawn, { landmark: null, x: -1430, z: 1580 });
  assert.deepEqual(parseFlags('spawn=12.5,-3').spawn, { landmark: null, x: 12.5, z: -3 });
  assert.deepEqual(parseFlags('spawn=haven_aster').spawn, { landmark: 'haven_aster', x: 0, z: 0 });
  assert.equal(parseFlags('spawn=1,2,3').spawn, null);
  assert.equal(parseFlags('spawn=<b>').spawn, null);
});

test('booleans and implied memory-only storage', () => {
  assert.equal(parseFlags('debug=1&fps=true').debug, true);
  assert.equal(parseFlags('debug=0').debug, false);
  assert.equal(parseFlags('nosave=1').nosave, true);
  assert.equal(parseFlags('bench=1').nosave, true, 'the benchmark never touches a saved journey');
  assert.equal(parseFlags('tutorial=1&test=1').tutorial, 1);
  assert.equal(parseFlags('tutorial=0').tutorial, 0);
});

test('readFlags works without a browser', () => {
  assert.equal(readFlags().test, false);
});
