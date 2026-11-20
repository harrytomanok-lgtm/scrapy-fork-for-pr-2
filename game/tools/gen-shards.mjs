#!/usr/bin/env node
/**
 * Generate src/rpg/data/shardTable.js: the Ora shards placed once on the baked world (8 m grid, the game's seed) with
 * the world's fixed solid colliders (the Wellspring Spire and the Crown, as world/structures.js adds them), so every
 * phone has the same shards under the same ids whatever grid it bakes. tests/rpg/shards.test.mjs checks the table
 * against a fresh placement and checks every shard is reachable on the 4 m and 8 m grids.
 * Usage: node tools/gen-shards.mjs [--check]   (--check: exit 1 when the table is out of date, write nothing)
 * @module tools/gen-shards
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { WORLD_SEED } from '../src/core/constants.js';
import { bakeSync } from '../src/world/gen/bake.js';
import { createGrid } from '../src/world/gen/grid.js';
import { createQueries } from '../src/world/gen/queries.js';
import { createColliders, COLLIDER } from '../src/world/gen/colliders.js';
import { crownShards } from '../src/world/gen/pois.js';
import { LANDMARKS, REGIONS } from '../src/world/gen/layout.js';
import { placeShards } from '../src/rpg/data/shards.js';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'rpg', 'data', 'shardTable.js');

/**
 * The world as the shard placement sees it, on a grid of `cell` metres: heights, regions and the fixed solid
 * colliders of the Spire and its Crown.
 * @param {4|8} cell
 */
export function shardWorld(cell) {
  const grid = createGrid(bakeSync(WORLD_SEED, cell));
  const col = createColliders(grid.heightAt, grid.normalAt);
  const baseY = grid.heightAt(0, 0) - 6;
  col.add({ shape: 'capsule', x: 0, y: baseY, z: 0, r: 60, h: 990, flags: COLLIDER.SOLID });
  for (const s of crownShards(WORLD_SEED, baseY)) col.add({ shape: 'sphere', x: s.x, y: s.y, z: s.z, r: s.r * 0.95, flags: COLLIDER.SOLID });
  const q = createQueries(grid, (x, y, z, c) => col.blocked(x, y, z, c));
  return { heightAt: (x, z) => q.heightAt(x, z), regionAt: (x, z) => q.regionAt(x, z), blocked: (x, y, z, c) => col.blocked(x, y, z, c) };
}

/** Place the shards on a world from shardWorld(). */
export function placeOn(w) {
  return placeShards(w.heightAt, w.regionAt, REGIONS, LANDMARKS, w.blocked);
}

/** @param {any[]} list */
function source(list) {
  const rows = list.map((s) => `  { id: '${s.id}', x: ${s.x}, y: ${s.y}, z: ${s.z}, regionId: '${s.regionId}', kind: '${s.kind}', view: ${s.view} },`);
  return `/**
 * The Ora shards, placed by tools/gen-shards.mjs on the baked world (do not edit by hand: run the tool).
 * Fixed data so a journey moved between phones (4 m and 8 m grids) finds its shards under the same ids.
 * @module rpg/data/shardTable
 */

export const SHARD_TABLE = Object.freeze([
${rows.join('\n')}
].map((s) => Object.freeze(s)));
`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = source(placeOn(shardWorld(8)));
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(OUT, 'utf8'); } catch (e) { cur = ''; }
    if (cur !== text) {
      console.error('gen-shards: src/rpg/data/shardTable.js is out of date; run node tools/gen-shards.mjs');
      process.exit(1);
    }
    console.log('gen-shards: table up to date');
  } else {
    writeFileSync(OUT, text);
    console.log('gen-shards: wrote ' + OUT);
  }
}
