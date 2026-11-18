/**
 * Entry point (ARCHITECTURE 3.1 step 1): parse the flags, install the error traps, find or create `#app`,
 * apply the base CSS and theme tokens, show the fallback loading layer, then run the boot sequence.
 * A boot failure ends on the fatal screen (the ui package's, or the foundation's fallback layer).
 * @module main
 */

import { markBoot } from './core/bootclock.js';
import { readFlags } from './core/flags.js';
import { createLog } from './core/log.js';
import { createErrors } from './core/errors.js';
import { createDom, createSafeStorage, browserStorage } from './core/dom.js';
import { applyTheme } from './core/theme.js';
import { boot, createLoadingLayer, paintYield } from './game/boot.js';

// @ts-ignore defined by tools/build.mjs
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0';
// @ts-ignore defined by tools/build.mjs
const DEV = typeof __DEV__ !== 'undefined' && !!__DEV__;

markBoot('modules');
const flags = readFlags();
const log = createLog({ dev: DEV || flags.test });
const dom = createDom({ storage: createSafeStorage({ backing: browserStorage, memoryOnly: flags.nosave }) });
const errors = createErrors({ log, dom, lang: flags.lang || 'he' });
applyTheme(dom);
const loading = createLoadingLayer(dom, flags.lang || 'he');
markBoot('loading');

// Let the splash (title and progress) paint once before the installs block the main thread.
paintYield().then(() => boot({ flags, log, dom, errors, loading, version: VERSION })).catch((err) => {
  loading.hide();
  errors.fatal(err);
});
