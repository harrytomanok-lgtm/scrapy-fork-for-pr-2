/**
 * Headless test harness (ARCHITECTURE 2.5): build if needed, serve dist/ on a free port, launch Chromium with
 * SwiftShader WebGL2, open the game in test mode and wait for `__GAME__.isReady()`.
 * Also the scenario runner used by smoke.mjs and scenarios.mjs.
 *
 * Playwright is not a dependency: it is resolved with `import('playwright')` and falls back to the machine's
 * global install (/opt/node-tools/node_modules/playwright, browsers in /opt/pw-browsers).
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { build } from '../build.mjs';
import { startServer } from '../serve.mjs';
import { GAME_ROOT } from '../gen-registry.mjs';

/** Global Playwright install used when `import('playwright')` fails. */
export const GLOBAL_PLAYWRIGHT = '/opt/node-tools/node_modules/playwright/index.mjs';
/** Browsers of the global install. */
const GLOBAL_BROWSERS = '/opt/pw-browsers';
/** Query of every harness page; `launch({ query })` overrides single keys. */
export const BASE_QUERY = 'test=1&quality=low&res=0.5&noaudio=1&seed=123&lang=en';
/** The only external hosts the page may reach: the Google Fonts stylesheet and its font files. */
const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
/** Boot timeout (SwiftShader is slow). */
const READY_TIMEOUT = 180000;
/** Output folders. */
export const OUT_SHOTS = join(GAME_ROOT, 'tools', 'out', 'shots');
export const OUT_LOGS = join(GAME_ROOT, 'tools', 'out', 'logs');

let playwrightPromise = null;
let buildPromise = null;
let serverPromise = null;

/** @returns {Promise<any>} the playwright module */
export function loadPlaywright() {
  if (!playwrightPromise) {
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(GLOBAL_BROWSERS)) process.env.PLAYWRIGHT_BROWSERS_PATH = GLOBAL_BROWSERS;
    playwrightPromise = import('playwright').catch(() => import(GLOBAL_PLAYWRIGHT)).then((m) => m.default || m);
  }
  return playwrightPromise;
}

/** @param {string} dir @returns {number} newest mtime (ms) of the files under dir */
function newest(dir) {
  let t = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    t = Math.max(t, st.isDirectory() ? newest(p) : st.mtimeMs);
  }
  return t;
}

/**
 * Build once per process when dist/ is missing or older than src/ (or always with `force`).
 * @param {{ force?:boolean }} [opts]
 * @returns {Promise<void>}
 */
export function ensureBuilt(opts = {}) {
  if (!buildPromise) {
    buildPromise = (async () => {
      const out = join(GAME_ROOT, 'dist', 'game.js');
      const stale = !existsSync(out) || !existsSync(join(GAME_ROOT, 'dist', 'index.html'))
        || newest(join(GAME_ROOT, 'src')) > statSync(out).mtimeMs;
      if (opts.force || stale) {
        const r = await build({ quiet: true });
        if (!r.ok) throw new Error('build failed: ' + r.warnings.join('; '));
      }
    })();
  }
  return buildPromise;
}

/** @returns {Promise<{ url:string, close:() => Promise<void> }>} one server per process */
function server() {
  if (!serverPromise) serverPromise = startServer({ port: 0 });
  return serverPromise;
}

/**
 * Merge the base query with overrides (keys in `query` replace the base keys).
 * @param {string} query
 * @returns {string}
 */
export function mergeQuery(query = '') {
  const q = new URLSearchParams(BASE_QUERY);
  for (const [k, v] of new URLSearchParams(query.replace(/^[?&]/, ''))) q.set(k, v);
  return q.toString();
}

/**
 * @typedef {object} Harness
 * @property {any} page                        the Playwright page
 * @property {(fn:Function, ...args:any[]) => Promise<any>} game   evaluate fn(window.__GAME__, ...args) in the page
 * @property {(name:string) => Promise<string>} shot              render a frame and write tools/out/shots/<name>.png
 * @property {() => string[]} errors           console errors and page errors collected so far
 * @property {() => Promise<void>} reload      reload the page and wait for ready again
 * @property {() => Promise<void>} close
 */

/**
 * Launch the game in headless Chromium.
 * @param {{ width?:number, height?:number, query?:string, build?:boolean, touch?:boolean }} [opts]  touch: emulate a touch screen
 * @returns {Promise<Harness>}
 */
export async function launch(opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 360;
  await ensureBuilt({ force: opts.build === true });
  const srv = await server();
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: opts.touch === true });
  const page = await context.newPage();
  const origin = new URL(srv.url).origin;
  /** @type {string[]} */
  const errs = [];
  // Tests never depend on the network: external requests (the fonts stylesheet) are refused, which also
  // exercises the fallback font stacks. Any request other than the page's own files, the Google Fonts
  // stylesheet and its font files is recorded as an error (7.2 rule 10).
  await page.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
  page.on('request', (rq) => {
    const u = rq.url();
    if (u.startsWith(origin) || /^(data:|blob:|about:)/.test(u) || FONT_HOSTS.test(u)) return;
    errs.push('[network] unexpected request ' + u);
  });
  page.on('dialog', (d) => {
    errs.push('[dialog] ' + d.type() + ' ' + d.message());
    d.dismiss().catch(() => {});
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location && msg.location();
    if (loc && loc.url && !loc.url.startsWith(origin)) return;
    errs.push('[console] ' + msg.text());
  });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + (e && e.message ? e.message : String(e))));
  const url = `${srv.url}index.html?${mergeQuery(opts.query)}`;

  async function waitReady() {
    await page.waitForFunction(
      () => {
        const g = /** @type {any} */ (window).__GAME__;
        return !!g && (g.isReady() || g.errors.some((e) => e.indexOf('[fatal]') === 0));
      },
      null,
      { timeout: READY_TIMEOUT, polling: 250 },
    );
    const ok = await page.evaluate(() => /** @type {any} */ (window).__GAME__.isReady());
    if (!ok) {
      const gameErrors = await page.evaluate(() => /** @type {any} */ (window).__GAME__.errors.slice());
      throw new Error('boot failed:\n' + gameErrors.concat(errs).join('\n'));
    }
  }

  await page.goto(url, { waitUntil: 'load' });
  await waitReady();

  return {
    page,
    game(fn, ...args) {
      return page.evaluate(({ src, a }) => {
        const f = (0, eval)('(' + src + ')');
        return f(/** @type {any} */ (window).__GAME__, ...a);
      }, { src: fn.toString(), a: args });
    },
    async shot(name) {
      await page.evaluate(() => /** @type {any} */ (window).__GAME__.screenshotReady());
      mkdirSync(OUT_SHOTS, { recursive: true });
      const path = join(OUT_SHOTS, name + '.png');
      await page.screenshot({ path });
      return path;
    },
    errors: () => errs.slice(),
    async reload() {
      await page.reload({ waitUntil: 'load' });
      await waitReady();
    },
    async close() {
      await browser.close();
    },
  };
}

/**
 * @typedef {object} Scenario
 * @property {string} name
 * @property {number} [width] @property {number} [height] @property {string} [query] @property {boolean} [touch]
 * @property {(h:{ page:any, game:Harness['game'], shot:Harness['shot'], assert:typeof assert, harness:Harness }) => Promise<void>} run
 */

/**
 * Run scenarios one browser at a time; after each, `__GAME__.errors` and the console errors must be empty.
 * @param {Scenario[]} list
 * @param {{ only?:string|null, label?:string }} [opts]
 * @returns {Promise<{ passed:number, failed:number, results:Array<{ name:string, ok:boolean, ms:number, error:string|null }> }>}
 */
export async function runScenarios(list, opts = {}) {
  const chosen = opts.only ? list.filter((s) => s.name === opts.only) : list;
  if (opts.only && chosen.length === 0) throw new Error(`no scenario named '${opts.only}'`);
  await ensureBuilt({ force: true });
  mkdirSync(OUT_LOGS, { recursive: true });
  const results = [];
  for (const sc of chosen) {
    const t0 = Date.now();
    /** @type {Harness|null} */
    let h = null;
    let error = null;
    try {
      h = await launch({ width: sc.width, height: sc.height, query: sc.query, touch: sc.touch });
      await sc.run({ page: h.page, game: h.game, shot: h.shot, assert, harness: h });
      const gameErrors = await h.game((g) => g.errors.slice());
      const all = gameErrors.concat(h.errors());
      if (all.length) throw new Error('errors recorded:\n  ' + all.join('\n  '));
    } catch (e) {
      error = e && e.stack ? e.stack : String(e);
    }
    if (h) await h.close().catch(() => {});
    const ms = Date.now() - t0;
    const ok = !error;
    results.push({ name: sc.name, ok, ms, error });
    writeFileSync(join(OUT_LOGS, `${sc.name}.log`), ok ? 'pass\n' : error + '\n');
    console.log(`${ok ? 'PASS' : 'FAIL'} ${opts.label ? opts.label + ' ' : ''}${sc.name} (${(ms / 1000).toFixed(1)} s)`);
    if (!ok) console.log('  ' + String(error).split('\n').join('\n  '));
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const srv = serverPromise ? await serverPromise : null;
  if (srv) await srv.close();
  serverPromise = null;
  return { passed, failed, results };
}
