/**
 * The `ctx.world` service (ARCHITECTURE 4.1): bakes the island (blob Worker at 4 m, time-sliced main-thread
 * fallback at 8 m), answers every surface, ray and collider query from the grid, owns the terrain, ocean,
 * Veilstorm, vegetation, Spire and Crown visuals, craters and destructible props, region and POI data, the
 * region-enter events and the parchment map.
 * @module world/service
 */

import { WORLD_SIZE, WORLD_HALF } from '../core/constants.js';
import { BALANCE } from '../core/balance.js';
import { bakeSteps } from './gen/bake.js';
import { createGrid } from './gen/grid.js';
import { createQueries, EDGE_START, EDGE_HARD } from './gen/queries.js';
import { createColliders } from './gen/colliders.js';
import { placePois } from './gen/pois.js';
import { REGIONS, LANDMARKS } from './gen/layout.js';
import { createTerrain } from './terrain.js';
import { createWater } from './water.js';
import { createVegetation } from './vegetation.js';
import { createClearSet, addClear } from './gen/scatter.js';
import { createPlaces } from './places.js';
import { createTufts } from './tufts.js';
import { createStructures } from './structures.js';
import { drawMap } from './map.js';

export const OWNER = 'world';
const WORKER_FIRST_MESSAGE_MS = 10000;
const WORKER_TOTAL_MS = 120000;
const SLICE_MS = 12;
const MAX_DESTROY = 64;

/** @returns {number} */
function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Bake in a blob Worker. Rejects when the Worker cannot be created, errors, or stays silent.
 * @param {number} seed @param {4|8} cell @param {(p:number)=>void} report
 * @returns {Promise<import('./gen/bake.js').BakeResult>}
 */
function bakeInWorker(seed, cell, report) {
  return new Promise((resolve, reject) => {
    /** @type {any} */
    let w = null;
    let url = '';
    try {
      // eslint-disable-next-line no-undef
      const src = typeof __WORLD_WORKER_SRC__ === 'string' ? __WORLD_WORKER_SRC__ : '';
      if (!src || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
        reject(new Error('worker unavailable'));
        return;
      }
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      w = new Worker(url);
    } catch (err) {
      try {
        if (url) URL.revokeObjectURL(url);
      } catch (e) {
        /* ignore */
      }
      reject(err);
      return;
    }
    let settled = false;
    let heard = false;
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(firstTimer);
      clearTimeout(totalTimer);
      try {
        w.terminate();
      } catch (e) {
        /* ignore */
      }
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        /* ignore */
      }
      if (ok) resolve(value);
      else reject(value);
    };
    const firstTimer = setTimeout(() => {
      if (!heard) finish(false, new Error('worker silent'));
    }, WORKER_FIRST_MESSAGE_MS);
    const totalTimer = setTimeout(() => finish(false, new Error('worker timeout')), WORKER_TOTAL_MS);
    w.onmessage = (e) => {
      heard = true;
      const m = e.data || {};
      if (m.type === 'progress') report(m.p);
      else if (m.type === 'done') finish(true, m.result);
      else finish(false, new Error(m.message || 'worker failed'));
    };
    w.onerror = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      finish(false, new Error('worker error'));
    };
    try {
      w.postMessage({ seed, cell });
    } catch (err) {
      finish(false, err);
    }
  });
}

/**
 * Time-sliced bake on the main thread.
 * @param {number} seed @param {4|8} cell @param {(p:number)=>void} report
 * @returns {Promise<import('./gen/bake.js').BakeResult>}
 */
async function bakeMainThread(seed, cell, report) {
  const it = bakeSteps(seed, cell, 4);
  for (;;) {
    const t0 = now();
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
      report(r.value);
      if (now() - t0 > SLICE_MS) break;
    }
    await new Promise((res) => setTimeout(res, 0));
  }
}

/**
 * Create the world service and its stream system.
 * @param {any} ctx
 */
export function createWorld(ctx) {
  const seed = (ctx.rng && ctx.rng.world ? ctx.rng.world.seed : 7168) >>> 0;
  const flags = ctx.flags || {};
  const lowMemory = typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 2;
  const want8 = Number(flags.grid) === 8 || (flags.grid !== 4 && lowMemory);

  /** @type {ReturnType<typeof createGrid>|null} */
  let grid = null;
  /** @type {ReturnType<typeof createQueries>|null} */
  let q = null;
  /** @type {ReturnType<typeof createColliders>|null} */
  let col = null;
  /** @type {any} */
  let terrain = null;
  /** @type {any} */
  let water = null;
  /** @type {any} */
  let veg = null;
  /** @type {any} */
  let tufts = null;
  /** @type {any} */
  let structs = null;
  /** @type {any} */
  let places = null;
  let bakeMode = 'none';
  let bakeMs = 0;
  let focusX = 0;
  let focusY = 50;
  let focusZ = 0;
  let pulseT = 0;

  /** Discs kept free of vegetation and rocks: landmark stamps and points of interest. */
  const clearSet = createClearSet(4096);
  /** Discs where not even ground tufts grow: paving, floors, lanes (world.keepClear with bare). */
  const bareSet = createClearSet(4096);
  const landmarks = LANDMARKS.map((l) => Object.assign({}, l, { y: 0 }));
  /** @type {Record<string, any>} */
  const landmarkById = Object.create(null);
  for (const l of landmarks) landmarkById[l.id] = l;
  /** @type {any[]} */
  const poiAll = [];
  /** @type {Record<string, any[]>} */
  const poiByType = { ringstone: [], shrine: [], camp: [], chest: [], siphon: [], race: [], crownChest: [] };
  const EMPTY = Object.freeze([]);
  /** @type {Record<number, HTMLCanvasElement>} */
  const mapCache = {};

  const craterPayload = { x: 0, y: 0, z: 0, radius: 0, depth: 0, deformed: false, sourceId: 0 };
  const propPayload = { key: 0, kind: 'rock', x: 0, y: 0, z: 0, sourceId: 0 };
  const dKey = new Int32Array(MAX_DESTROY);
  const dId = new Int32Array(MAX_DESTROY);
  const dPos = new Float32Array(MAX_DESTROY * 3);
  let dN = 0;
  /** Collect destroyed colliders; events are emitted after the collider pass. @param {any} c */
  function onPropHit(c) {
    if (dN >= MAX_DESTROY) return;
    dKey[dN] = c.propKey;
    dId[dN] = c.id;
    dKind[dN] = veg ? veg.kindOf(c.id) : 'rock';
    dPos[dN * 3] = c.x; dPos[dN * 3 + 1] = c.y; dPos[dN * 3 + 2] = c.z;
    dN++;
  }
  /** @type {string[]} */
  const dKind = [];
  for (let i = 0; i < MAX_DESTROY; i++) dKind.push('rock');

  const world = {
    size: WORLD_SIZE,
    half: WORLD_HALF,
    cell: want8 ? 8 : 4,
    seaLevel: 0,
    islandRadius: 3100,
    edgeStart: EDGE_START,
    edgeHard: EDGE_HARD,
    ceiling: BALANCE.move && BALANCE.move.ceiling ? BALANCE.move.ceiling : 1500,
    /** @type {ReadonlyArray<any>} */
    regions: REGIONS,
    /** How the grid was baked: 'worker' | 'main'. */
    bakeMode: 'none',

    /**
     * Bake the grid and layers, build the visuals, resolve landmarks and POIs. Emits world:baked.
     * @param {(progress:number)=>void} [onProgress] @returns {Promise<void>}
     */
    async bake(onProgress) {
      const t0 = now();
      let last = -1;
      const report = (p) => {
        const v = Math.min(1, Math.max(0, p));
        if (v - last < 0.01 && v < 1) return;
        last = v;
        if (typeof onProgress === 'function') onProgress(v);
      };
      report(0);
      const bakeReport = (p) => report(p * 0.82);
      /** @type {import('./gen/bake.js').BakeResult|null} */
      let res = null;
      if (!want8) {
        try {
          res = await bakeInWorker(seed, 4, bakeReport);
          bakeMode = 'worker';
        } catch (err) {
          if (ctx.log) ctx.log.warn('world', 'Worker bake unavailable, baking at 8 m on the main thread:', String(err && err.message ? err.message : err));
          res = null;
        }
      }
      if (!res) {
        res = await bakeMainThread(seed, 8, bakeReport);
        bakeMode = 'main';
      }
      world.cell = res.cell;
      world.bakeMode = bakeMode;
      grid = createGrid(res);
      col = createColliders(grid.heightAt, grid.normalAt);
      const c = col;
      q = createQueries(grid, (x, y, z, cl) => c.blocked(x, y, z, cl));
      for (const l of landmarks) l.y = grid.heightAt(l.x, l.z);
      report(0.86);
      const s = ctx.store && ctx.store.state && ctx.store.state.player;
      focusX = s && typeof s.x === 'number' ? s.x : landmarkById.sparkstead.x;
      focusZ = s && typeof s.z === 'number' ? s.z : landmarkById.sparkstead.z;
      focusY = grid.heightAt(focusX, focusZ) + 6;
      if (ctx.render && ctx.render.layers && ctx.render.glsl) {
        structs = createStructures(ctx, grid, col, seed);
        terrain = createTerrain(ctx, grid);
        report(0.9);
        water = createWater(ctx, grid, EDGE_HARD);
        clearSet.n = 0;
        bareSet.n = 0;
        for (const l of landmarks) {
          if (l.type === 'settlement') addClear(bareSet, l.x, l.z, l.id === 'haven_aster' ? 21 : 17);
          if (l.type === 'spire') continue;
          const r = l.stamp && l.stamp.radius ? l.stamp.radius : 24;
          addClear(clearSet, l.x, l.z, l.type === 'settlement' ? r + 10 : l.type === 'arena' ? r * 0.85 : r * 0.7);
        }
        places = createPlaces(ctx, grid, col, seed, clearSet, landmarks);
        veg = createVegetation(ctx, grid, col, seed, clearSet);
        tufts = createTufts(ctx, grid, seed, bareSet);
        terrain.flush(focusX, focusY, focusZ);
        water.follow(focusX, focusZ);
        veg.update(focusX, focusY, focusZ, focusX, focusZ, true);
      }
      report(0.95);
      const list = placePois(q, seed);
      poiAll.length = 0;
      for (const k of Object.keys(poiByType)) poiByType[k].length = 0;
      for (const p of list) {
        poiAll.push(p);
        poiByType[p.type].push(p);
        // keep the points of interest clear of trees and rocks (camps get room for their tents and fights)
        const pr = p.type === 'camp' ? 22 : p.type === 'shrine' || p.type === 'ringstone' ? 9 : p.type === 'race' ? 14 : p.type === 'siphon' ? 18 : 6;
        if (p.type !== 'crownChest') addClear(clearSet, p.x, p.z, pr);
      }
      if (veg) {
        veg.invalidate();
        veg.update(focusX, focusY, focusZ, focusX, focusZ, true);
      }
      report(1);
      bakeMs = now() - t0;
      if (ctx.log) ctx.log.info('world', `baked ${res.cell} m grid (${bakeMode}) in ${Math.round(res.ms)} ms; ready in ${Math.round(bakeMs)} ms`);
      ctx.bus.emit('world:baked', { seed, ms: bakeMs });
    },

    /** @param {number} x @param {number} z @returns {number} */
    heightAt(x, z) {
      return grid ? grid.heightAt(x, z) : 0;
    },

    /** @param {number} x @param {number} z @param {any} out @returns {any} */
    normalAt(x, z, out) {
      if (!grid) {
        out.x = 0; out.y = 1; out.z = 0;
        return out;
      }
      return grid.normalAt(x, z, out);
    },

    /** @param {number} x @param {number} z @returns {number} 0 flat .. 1 vertical */
    slopeAt(x, z) {
      return grid ? grid.slopeAt(x, z) : 0;
    },

    /** @param {number} x @param {number} y @param {number} z @returns {number} */
    groundAt(x, y, z) {
      return col ? col.groundAt(x, y, z) : 0;
    },

    /** @param {number} x @param {number} z @returns {number} */
    waterDepthAt(x, z) {
      const d = -world.heightAt(x, z);
      return d > 0 ? d : 0;
    },

    /** @param {number} x @param {number} z @returns {'grass'|'stone'|'snow'|'sand'|'water'} */
    surfaceAt(x, z) {
      return q ? q.surfaceAt(x, z) : 'grass';
    },

    /** @param {number} x @param {number} z @returns {string} */
    regionAt(x, z) {
      return q ? q.regionAt(x, z) : 'meadows';
    },

    /** @param {number} x @param {number} z @returns {number} */
    regionLevel(x, z) {
      return q ? q.regionLevel(x, z) : 1;
    },

    /** @param {number} x @param {number} z @returns {number} */
    edgeFactor(x, z) {
      const r = Math.sqrt(x * x + z * z);
      const t = (r - EDGE_START) / (EDGE_HARD - EDGE_START);
      return t < 0 ? 0 : t > 1 ? 1 : t;
    },

    /** @returns {boolean} */
    raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const k = maxDist / len;
      if (!col) {
        out.hit = false;
        return false;
      }
      return col.march(ox, oy, oz, ox + dx * k, oy + dy * k, oz + dz * k, 0, out);
    },

    /** @returns {boolean} */
    sweepSphere(ax, ay, az, bx, by, bz, radius, out) {
      if (!col) {
        out.hit = false;
        return false;
      }
      return col.march(ax, ay, az, bx, by, bz, radius, out);
    },

    /** Terrain only, 8 m steps. @returns {boolean} */
    lineOfSight(ax, ay, az, bx, by, bz) {
      if (!grid) return true;
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const steps = Math.max(1, Math.ceil(len / 8));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        if (ay + dy * t < grid.heightAt(ax + dx * t, az + dz * t)) return false;
      }
      return true;
    },

    /** @param {number} x @param {number} z @param {number} r @param {any[]} out @returns {number} */
    queryColliders(x, z, r, out) {
      if (!col) {
        out.length = 0;
        return 0;
      }
      return col.query(x, z, r, out);
    },

    /** @param {any} def @returns {number} */
    addCollider(def) {
      return col ? col.add(def) : 0;
    },

    /** @param {number} id */
    removeCollider(id) {
      if (col) col.remove(id);
    },

    /**
     * Crater bowl: radius >= 6 edits the grid (chunk rebuilds within the build budget, water texels, scorch).
     * Always emits world:crater.
     * @param {number} x @param {number} z @param {number} radius @param {number} depth @param {number} [sourceId]
     */
    crater(x, z, radius, depth, sourceId = 0) {
      const r = radius > 0 ? radius : 0;
      const dmax = 0.3 * r;
      const d = depth > dmax ? dmax : depth > 0 ? depth : 0;
      let deformed = false;
      if (grid && r >= 6) {
        deformed = grid.crater(x, z, r, d);
        if (deformed) {
          if (terrain) terrain.edited(x, z, r * 1.3 + 8);
          if (water) water.edited(x, z, r * 1.3);
          if (veg) veg.invalidate();
          if (tufts) tufts.invalidate();
        }
      }
      craterPayload.x = x;
      craterPayload.y = world.heightAt(x, z);
      craterPayload.z = z;
      craterPayload.radius = r;
      craterPayload.depth = d;
      craterPayload.deformed = deformed;
      craterPayload.sourceId = sourceId;
      ctx.bus.emit('world:crater', craterPayload);
    },

    /** Destroy destructible props touching the sphere. @returns {number} */
    damageProps(x, y, z, radius, damage, sourceId = 0) {
      if (!col || !(damage > 0)) return 0;
      dN = 0;
      const n = col.damage(x, y, z, radius, onPropHit);
      for (let i = 0; i < dN; i++) {
        if (veg) veg.destroy(dKey[i]);
        propPayload.key = dKey[i];
        propPayload.kind = dKind[i] || 'rock';
        propPayload.x = dPos[i * 3];
        propPayload.y = dPos[i * 3 + 1];
        propPayload.z = dPos[i * 3 + 2];
        propPayload.sourceId = sourceId;
        ctx.bus.emit('world:propDestroyed', propPayload);
      }
      return n;
    },

    /** @param {string} id @returns {any} */
    landmark(id) {
      return landmarkById[id] || null;
    },

    /** @param {string} [type] @returns {ReadonlyArray<any>} live list, do not mutate */
    pois(type) {
      if (type === undefined) return poiAll;
      return poiByType[type] || EMPTY;
    },

    /**
     * Nearest dry, walkable, collider-free spot within `radius`.
     * @param {number} x @param {number} z @param {number} radius @param {{x:number,y:number,z:number}} out
     * @param {{ maxSlope?:number, clearance?:number }} [opts] @returns {boolean}
     */
    findSpot(x, z, radius, out, opts) {
      if (!q) {
        out.x = x; out.y = 0; out.z = z;
        return false;
      }
      return q.findSpot(x, z, radius, out, opts);
    },

    /**
     * Keep a disc free of trees, rocks and ground cover (world pass, an addition): settlements call it for their
     * buildings, and with `bare` for paving and lanes, where not even the ground tufts grow. Takes effect at the
     * next refill. @param {number} x @param {number} z @param {number} r @param {boolean} [bare]
     */
    keepClear(x, z, r, bare) {
      if (!(r > 0)) return;
      addClear(clearSet, x, z, r);
      if (bare) addClear(bareSet, x, z, r);
      if (veg) veg.invalidate();
      if (tufts) tufts.invalidate();
    },

    /**
     * The authored places between the settlements (an addition): arches, elder trees, bridges, ruins, falls.
     * @returns {{ id:string, x:number, y:number, z:number, lookUp:number }[]}
     */
    places() {
      return places ? places.list() : [];
    },

    /** Streaming and LOD centre (the camera position). */
    setFocus(x, y, z) {
      focusX = x;
      focusY = y;
      focusZ = z;
    },

    /** Build every chunk and refill every prop the current focus needs, now. */
    flushBuilds() {
      if (terrain) terrain.flush(focusX, focusY, focusZ);
      if (water) water.follow(focusX, focusZ);
      if (veg) {
        const p = ctx.player;
        const px = p && p.alive ? p.pos.x : focusX;
        const pz = p && p.alive ? p.pos.z : focusZ;
        veg.update(focusX, focusY, focusZ, px, pz, true);
        if (tufts) tufts.update(px, p && p.alive ? p.pos.y : focusY, pz, focusY, true);
      }
    },

    /** Parchment map of the whole square, north up; cached per size. @param {number} size @returns {HTMLCanvasElement} */
    mapCanvas(size) {
      const s = size === 512 ? 512 : 256;
      if (!mapCache[s] && grid) mapCache[s] = drawMap(grid, s);
      return mapCache[s] || null;
    },

    /** @param {number} x @param {number} z @param {{u:number,v:number}} out */
    toMap(x, z, out) {
      out.u = (x + WORLD_HALF) / WORLD_SIZE;
      out.v = (z + WORLD_HALF) / WORLD_SIZE;
      return out;
    },

    /** Diagnostics for scenarios. */
    info() {
      return {
        cell: world.cell, bakeMode, bakeMs, colliders: col ? col.count() : 0,
        tiles: terrain ? terrain.visibleCount() : 0, pending: terrain ? terrain.pending() : 0,
        props: veg ? veg.stats() : null, focus: [focusX, focusY, focusZ],
      };
    },

    /** Remove the meshes and GPU resources. */
    dispose() {
      for (const part of [terrain, water, veg, tufts, structs, places]) if (part) part.dispose();
      places = null;
      tufts = null;
      terrain = null;
      water = null;
      veg = null;
      structs = null;
    },
  };

  // ------------------------------------------------------------- region tracking and streaming
  let lastRegion = /** @type {string|null} */ (null);
  let lastSim = 0;
  const regionPayload = { regionId: '', prevRegionId: /** @type {string|null} */ (null), first: false };

  const streamSystem = {
    id: 'world.stream',
    phase: { step: 'post', frame: 'world' },
    owner: OWNER,
    /** Region-enter tracking for the player. @param {any} c */
    step(c) {
      const p = c.player;
      if (!p || !p.alive || !grid) return;
      const id = world.regionAt(p.pos.x, p.pos.z);
      if (id === lastRegion) return;
      const seen = c.store && c.store.state.world ? c.store.state.world.regionsSeen : null;
      const first = !!seen && seen.indexOf(id) < 0;
      if (first) {
        seen.push(id);
        c.store.set('world.regionsSeen', seen);
      }
      regionPayload.regionId = id;
      regionPayload.prevRegionId = lastRegion;
      regionPayload.first = first;
      lastRegion = id;
      c.bus.emit('world:regionEnter', regionPayload);
    },
    /** Terrain LOD and build budget, ocean follow, prop refill, Spire pulse. @param {any} c @param {number} dt */
    frame(c, dt) {
      if (!terrain) return;
      terrain.update(focusX, focusY, focusZ);
      water.follow(focusX, focusZ);
      const p = c.player;
      // growth clock: real frame time, or the simulated time when frames carry none (stepped tests, renderNow)
      const simNow = c.time ? c.time.now : 0;
      const sd = simNow - lastSim;
      lastSim = simNow;
      const gdt = dt > 0 ? dt : sd > 0 && sd < 2 ? sd : 0;
      veg.update(focusX, focusY, focusZ, p && p.alive ? p.pos.x : focusX, p && p.alive ? p.pos.z : focusZ, false, gdt);
      if (p && p.alive) tufts.update(p.pos.x, p.pos.y, p.pos.z, focusY, false);
      pulseT += dt > 0 ? dt : 0;
      structs.update(pulseT);
      if (places) places.update(pulseT);
    },
  };

  return {
    world,
    streamSystem,
    resetRegion() {
      lastRegion = null;
    },
    restoreProps() {
      lastRegion = null;
      if (veg) veg.restore();
    },
    invalidateProps() {
      if (veg) veg.invalidate();
      if (tufts) tufts.invalidate();
    },
  };
}
