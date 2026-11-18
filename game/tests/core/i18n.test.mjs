import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createI18n, formatNumber } from '../../src/core/i18n.js';
import { STRINGS } from '../../src/core/strings.js';

function setup(lang = 'en') {
  const events = [];
  const attrs = {};
  const root = { setAttribute: (k, v) => { attrs[k] = v; } };
  const warnings = [];
  const i18n = createI18n({
    lang,
    bus: { emit: (type, payload) => events.push({ type, payload }) },
    getRoot: () => root,
    log: { warn: (...a) => warnings.push(a) },
  });
  i18n.addStrings({
    en: {
      'test.hello': 'Hello, {name}!',
      'test.level': 'Level {level}',
      'test.gender': 'You {g:are a warrior/are a warrioress}.',
      'test.plural': '{n} {p:n/bolt/bolts}',
      'test.nested': '{p:count/one shell/{count} shells} for {g:him/her}',
      'test.shells': '{amount} Shells',
      'test.unknown': 'Missing {thing} stays',
    },
    he: {
      'test.hello': 'שלום, {name}!',
      'test.gender': '{g:קפוץ/קפצי}!',
      'test.plural': '{p:n/קליע אחד/{n} קליעים}',
    },
  });
  return { i18n, events, attrs, warnings };
}

test('parameters', () => {
  const { i18n } = setup();
  assert.equal(i18n.t('test.hello', { name: 'Tavi' }), 'Hello, Tavi!');
  assert.equal(i18n.t('test.level', { level: 12 }), 'Level 12');
  assert.equal(i18n.t('test.shells', { amount: 1240 }), '1,240 Shells', 'numbers are formatted');
  assert.equal(i18n.t('test.unknown', {}), 'Missing {thing} stays');
  assert.equal(i18n.t('test.unknown'), 'Missing {thing} stays');
});

test('gender forms follow setGender', () => {
  const { i18n } = setup();
  assert.equal(i18n.t('test.gender'), 'You are a warrior.');
  i18n.setGender('f');
  assert.equal(i18n.gender, 'f');
  assert.equal(i18n.t('test.gender'), 'You are a warrioress.');
  i18n.setLang('he');
  assert.equal(i18n.t('test.gender'), 'קפצי!');
  i18n.setGender('m');
  assert.equal(i18n.t('test.gender'), 'קפוץ!');
});

test('plurals pick by args.n, with nested parameters', () => {
  const { i18n } = setup();
  assert.equal(i18n.t('test.plural', { n: 1 }), '1 bolt');
  assert.equal(i18n.t('test.plural', { n: 0 }), '0 bolts');
  assert.equal(i18n.t('test.plural', { n: 3 }), '3 bolts');
  assert.equal(i18n.t('test.nested', { count: 1 }), 'one shell for him');
  i18n.setGender('f');
  assert.equal(i18n.t('test.nested', { count: 2500 }), '2,500 shells for her');
  i18n.setLang('he');
  assert.equal(i18n.t('test.plural', { n: 1 }), 'קליע אחד');
  assert.equal(i18n.t('test.plural', { n: 5 }), '⁨5⁩ קליעים', 'Hebrew arguments are bidi-isolated');
});

test('right-to-left lines isolate every inserted argument (FSI ... PDI); left-to-right lines do not', () => {
  const { i18n } = setup('he');
  assert.equal(i18n.t('test.hello', { name: 'Kai 2' }), 'שלום, ⁨Kai 2⁩!');
  assert.equal(i18n.t('test.gender', null), 'קפוץ!', 'no arguments, nothing inserted');
  assert.equal(i18n.t('test.hello', { name: '' }), 'שלום, !', 'an empty argument adds no marks');
  i18n.setLang('en');
  assert.equal(i18n.t('test.hello', { name: 'Kai 2' }), 'Hello, Kai 2!');
  assert.equal(i18n.t('test.plural', { n: 2500 }), '2,500 bolts');
});

test('a missing key renders as [key] and is recorded once', () => {
  const { i18n, warnings } = setup();
  assert.equal(i18n.t('no.such.key'), '[no.such.key]');
  assert.equal(i18n.t('no.such.key'), '[no.such.key]');
  assert.deepEqual(i18n.missing(), ['no.such.key']);
  assert.equal(warnings.length, 1);
  i18n.setLang('he');
  assert.equal(i18n.t('test.level', { level: 2 }), '[test.level]', 'missing in the current language');
  assert.deepEqual(i18n.missing(), ['no.such.key', 'test.level']);
  assert.equal(i18n.has('test.hello'), true);
  assert.equal(i18n.has('test.level'), false);
});

test('setLang sets dir and lang on the root and emits lang:changed', () => {
  const { i18n, events, attrs } = setup('he');
  assert.equal(i18n.lang, 'he');
  assert.equal(i18n.dir, 'rtl');
  i18n.setLang('en');
  assert.equal(i18n.dir, 'ltr');
  assert.deepEqual(attrs, { lang: 'en', dir: 'ltr' });
  i18n.setLang('he');
  assert.deepEqual(attrs, { lang: 'he', dir: 'rtl' });
  assert.deepEqual(events.map((e) => e.payload), [{ lang: 'en', dir: 'ltr' }, { lang: 'he', dir: 'rtl' }]);
  assert.ok(events.every((e) => e.type === 'lang:changed'));
  i18n.setLang('fr');
  assert.equal(i18n.lang, 'he', 'unknown languages are ignored');
});

test('addStrings: later tables replace keys', () => {
  const { i18n } = setup();
  i18n.addStrings({ en: { 'test.hello': 'Hi {name}' } });
  assert.equal(i18n.t('test.hello', { name: 'Sela' }), 'Hi Sela');
});

test('num formats with Western digits and thousands separators', () => {
  assert.equal(formatNumber(1240), '1,240');
  assert.equal(formatNumber(102720), '102,720');
  assert.equal(formatNumber(1000000), '1,000,000');
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(-4321), '-4,321');
  assert.equal(formatNumber(2.5), '2.5');
  assert.equal(formatNumber(3.25), '3.25');
  assert.equal(formatNumber(1234.05), '1,234.05');
  const { i18n } = setup();
  assert.equal(i18n.num(17120), '17,120');
});

test('foundation strings exist in both languages', () => {
  const he = Object.keys(STRINGS.he).sort();
  const en = Object.keys(STRINGS.en).sort();
  assert.deepEqual(he, en);
  for (const k of he) {
    assert.ok(STRINGS.he[k].length > 0 && STRINGS.en[k].length > 0, k);
    assert.match(k, /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/, 'lower dotted key: ' + k);
  }
  const i18n = createI18n({ lang: 'he' });
  i18n.addStrings(STRINGS);
  assert.equal(i18n.t('core.save.memoryOnly'), 'ההתקדמות נשמרת רק עד סגירת המשחק');
  i18n.setLang('en');
  assert.equal(i18n.t('core.save.memoryOnly'), 'Progress is kept for this session only');
});
