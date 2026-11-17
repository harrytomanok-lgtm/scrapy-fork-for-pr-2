#!/usr/bin/env node
/**
 * Build (ARCHITECTURE 2.5): gen-registry, the optional world Worker bundle injected as `__WORLD_WORKER_SRC__`,
 * the ESM bundle `dist/game.js`, and three HTML outputs:
 *   dist/index.html            full document
 *   dist/artifact.html         fragment: <title>, <style>, the fonts <link>, #app, the module script tag
 *   dist/artifact-inline.html  the fragment with the bundle inlined
 * Fails when game.js exceeds 1.6 MB minified, warns above 1.2 MB. The Google Fonts stylesheet is the only
 * external reference of any output.
 * Usage: node tools/build.mjs [--dev] [--watch] [--serve]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { genRegistry, GAME_ROOT } from './gen-registry.mjs';
import { startServer } from './serve.mjs';

/** Bundle size gate in bytes (minified; decimal megabytes, the stricter reading of "1.6 MB"). */
export const SIZE_FAIL = 1600000;
/** Bundle size warning in bytes (minified). */
export const SIZE_WARN = 1200000;
/** Page title of the HTML outputs. */
const TITLE = 'KETHRA: Veins of Light';

/**
 * The parts shared by the three HTML outputs.
 * @param {string} css @param {string} fontsHref
 */
function shellParts(css, fontsHref) {
  return {
    title: `<title>${TITLE}</title>`,
    style: `<style>\n${css}\n</style>`,
    fonts: `<link rel="stylesheet" href="${fontsHref}">`,
    app: '<div id="app"></div>',
    script: '<script type="module" src="./game.js"></script>',
  };
}

/**
 * HTML text of the three outputs.
 * @param {{ css:string, fontsHref:string, bundle:string }} o
 * @returns {{ index:string, fragment:string, inline:string }}
 */
export function htmlOutputs(o) {
  const p = shellParts(o.css, o.fontsHref);
  const index = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="theme-color" content="#1B1626">',
    '<link rel="icon" href="data:,">',
    p.title,
    p.fonts,
    p.style,
    '</head>',
    '<body>',
    p.app,
    p.script,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  const fragment = [p.title, p.style, p.fonts, p.app, p.script, ''].join('\n');
  const safe = o.bundle.replace(/<\/script/gi, '<\\/script');
  const inline = [p.title, p.style, p.fonts, p.app, `<script type="module">\n${safe}\n</script>`, ''].join('\n');
  return { index, fragment, inline };
}

/**
 * External URLs referenced by HTML markup outside inline scripts (the gate allows only the fonts stylesheet).
 * @param {string} html
 * @returns {string[]}
 */
export function externalRefs(html) {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const out = [];
  const re = /(?:href|src)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']|url\(\s*['"]?((?:https?:)?\/\/[^)'"]+)/gi;
  let m;
  while ((m = re.exec(markup))) out.push(m[1] || m[2]);
  return out;
}

/**
 * Bundle `src/world/worker.js` as IIFE text when it exists.
 * @param {string} root @param {boolean} dev
 * @returns {Promise<string>}
 */
async function workerSource(root, dev) {
  const entry = join(root, 'src', 'world', 'worker.js');
  if (!existsSync(entry)) return '';
  const r = await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'iife', target: 'es2020', minify: !dev, write: false, logLevel: 'silent',
    define: { __DEV__: dev ? 'true' : 'false' },
  });
  return r.outputFiles[0].text;
}

/**
 * Run one build.
 * @param {{ dev?:boolean, root?:string, quiet?:boolean }} [opts]
 * @returns {Promise<{ ok:boolean, size:number, files:string[], warnings:string[] }>}
 */
export async function build(opts = {}) {
  const root = opts.root || GAME_ROOT;
  const dev = !!opts.dev;
  const say = opts.quiet ? () => {} : (...a) => console.log(...a);
  const reg = genRegistry({ root });
  say(`registry: ${reg.found.length ? reg.found.join(', ') : '(stand-ins only)'}`);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const worker = await workerSource(root, dev);
  const dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  const outfile = join(dist, 'game.js');
  await esbuild.build({
    entryPoints: [join(root, 'src', 'main.js')],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    outfile,
    logLevel: 'warning',
    legalComments: 'none',
    define: {
      __DEV__: dev ? 'true' : 'false',
      __VERSION__: JSON.stringify(pkg.version),
      __WORLD_WORKER_SRC__: JSON.stringify(worker),
    },
  });
  const bundle = readFileSync(outfile, 'utf8');
  const size = statSync(outfile).size;
  const theme = await import(pathToFileURL(join(root, 'src', 'core', 'theme.js')).href);
  const html = htmlOutputs({ css: theme.baseCss(), fontsHref: theme.FONTS_HREF, bundle });
  const files = { 'index.html': html.index, 'artifact.html': html.fragment, 'artifact-inline.html': html.inline };
  const warnings = [];
  let ok = true;
  for (const [name, text] of Object.entries(files)) {
    const refs = externalRefs(text).filter((u) => u !== theme.FONTS_HREF);
    if (refs.length) {
      ok = false;
      warnings.push(`${name}: external reference(s) besides the fonts stylesheet: ${refs.join(', ')}`);
    }
    writeFileSync(join(dist, name), text);
  }
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  if (!dev && size > SIZE_FAIL) {
    ok = false;
    warnings.push(`game.js is ${kb(size)}, over the ${kb(SIZE_FAIL)} gate`);
  } else if (!dev && size > SIZE_WARN) {
    warnings.push(`game.js is ${kb(size)}, over the ${kb(SIZE_WARN)} warning line`);
  }
  say(`dist/game.js ${kb(size)}${dev ? ' (dev, not minified)' : ''}; worker ${worker ? kb(worker.length) : 'none'}`);
  for (const w of warnings) console.warn('build: ' + w);
  return { ok, size, files: ['game.js', ...Object.keys(files)].map((f) => join(dist, f)), warnings };
}

/**
 * Watch src/ and rebuild on change (debounced).
 * @param {{ dev:boolean }} opts
 */
function watchAndRebuild(opts) {
  let timer = null;
  let running = false;
  let again = false;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await build({ dev: opts.dev });
    } catch (e) {
      console.error('build failed:', e && e.message);
    }
    running = false;
    if (again) {
      again = false;
      run();
    }
  };
  watch(join(GAME_ROOT, 'src'), { recursive: true }, (_event, file) => {
    if (file && String(file).endsWith('registry.gen.js')) return;
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  });
  console.log('watching src/ for changes');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const dev = args.has('--dev');
  try {
    const r = await build({ dev });
    if (!r.ok && !args.has('--watch')) process.exit(1);
  } catch (e) {
    console.error('build failed:', e && e.message ? e.message : e);
    if (!args.has('--watch')) process.exit(1);
  }
  if (args.has('--watch')) watchAndRebuild({ dev });
  if (args.has('--serve')) {
    const s = await startServer({ port: Number(process.env.PORT) || 5173 });
    console.log(`serving dist/ at ${s.url}`);
  }
}
