/**
 * Blob Worker entry (ARCHITECTURE 4.1): bakes the grid and layers off the main thread and posts progress.
 * Bundled as IIFE text by tools/build.mjs and injected as `__WORLD_WORKER_SRC__`.
 * Messages in: { seed, cell }. Out: { type:'progress', p } and { type:'done', result } (buffers transferred).
 * @module world/worker
 */

import { bakeSteps } from './gen/bake.js';

/** @type {any} */
const scope = self;

scope.onmessage = (e) => {
  const seed = e.data && Number(e.data.seed);
  const cell = e.data && e.data.cell === 8 ? 8 : 4;
  try {
    const it = bakeSteps(seed >>> 0, cell, 48);
    let r = it.next();
    while (!r.done) {
      scope.postMessage({ type: 'progress', p: r.value });
      r = it.next();
    }
    const v = r.value;
    scope.postMessage({ type: 'done', result: v }, [v.height.buffer, v.tint.buffer, v.region.buffer, v.flags.buffer, v.canopy.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
};
