#!/usr/bin/env node
/**
 * Static server for dist/ (ARCHITECTURE 2.5): node:http, correct MIME types, no dependencies.
 * Port 5173 unless PORT is set; `startServer({ port: 0 })` picks a free port (harness).
 * Usage: node tools/serve.mjs
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** MIME types by extension. */
export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
});

/** The default served folder: game/dist. */
export const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));

/**
 * Start the server.
 * @param {{ port?:number, root?:string, host?:string }} [opts]
 * @returns {Promise<{ server:import('node:http').Server, port:number, url:string, close:() => Promise<void> }>}
 */
export function startServer(opts = {}) {
  const root = resolve(opts.root || DIST);
  const host = opts.host || '127.0.0.1';
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let path;
    try {
      path = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    } catch (e) {
      res.writeHead(400);
      res.end('bad request');
      return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    let st;
    try {
      st = statSync(file);
    } catch (e) {
      st = null;
    }
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
      // The module script must load when the page runs in a sandboxed iframe with an opaque origin.
      'Access-Control-Allow-Origin': '*',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  });
  return new Promise((resolveP, reject) => {
    server.once('error', reject);
    server.listen(opts.port === undefined ? 5173 : opts.port, host, () => {
      const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolveP({
        server,
        port: addr.port,
        url: `http://${host}:${addr.port}/`,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startServer({ port: Number(process.env.PORT) || 5173 });
  console.log(`serving ${DIST} at ${s.url}`);
}
