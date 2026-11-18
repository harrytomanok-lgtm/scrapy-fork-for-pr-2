// Boot time support: the static splash of the HTML shells and the boot clock (ARCHITECTURE 7.1 boot budget).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splashMarkup, baseCss, FONTS_HREF, RING_LEN } from '../../src/core/theme.js';
import { markBoot, bootTimes } from '../../src/core/bootclock.js';
import { htmlOutputs, externalRefs } from '../../tools/build.mjs';

test('splash markup is the overlay layer with the loading node, language-neutral and self-contained', () => {
  const m = splashMarkup();
  assert.match(m, /^<div class="k-layer k-layer-overlay" data-layer="overlay"/);
  for (const cls of ['k-loading', 'k-loading-title', 'k-loading-ring k-spin', 'k-loading-track', 'k-loading-fill', 'k-loading-text']) {
    assert.ok(m.includes(`class="${cls}"`), cls);
  }
  assert.ok(m.includes(`stroke-dasharray="${RING_LEN.toFixed(2)}"`));
  // no text nodes between tags: the language is not known before the script runs
  assert.equal(m.replace(/<[^>]*>/g, ''), '');
  assert.deepEqual(externalRefs(m), []);
  assert.ok(baseCss().includes('@keyframes k-spin'));
});

test('every HTML output carries the splash inside #app, before the script', () => {
  const splash = splashMarkup();
  const out = htmlOutputs({ css: baseCss(), fontsHref: FONTS_HREF, bundle: 'console.log(1)', splash });
  for (const html of [out.index, out.fragment, out.inline]) {
    const app = html.indexOf('<div id="app">' + splash + '</div>');
    assert.ok(app >= 0);
    assert.ok(app < html.indexOf('<script'));
    assert.deepEqual(externalRefs(html), [FONTS_HREF]);
  }
});

test('boot clock records each stage once, in order, with deltas', () => {
  markBoot('a');
  markBoot('b');
  markBoot('a');
  const t = bootTimes();
  const names = t.stages.map((s) => s.stage);
  assert.equal(names[0], 'script');
  assert.deepEqual(names.slice(-2), ['a', 'b']);
  let prev = 0;
  for (const s of t.stages) {
    assert.ok(s.at >= prev && s.ms >= 0);
    prev = s.at;
  }
  assert.equal(t.total, prev);
});
