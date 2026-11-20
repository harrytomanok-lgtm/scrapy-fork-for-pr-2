#!/usr/bin/env node
/**
 * Reward cadence: the main path of a first journey as a timeline of rewards (level-ups, techniques, Forms, gear,
 * chests, shrines, Ora shards, regions, Ringstones, bosses, quests), with the stretches of more than
 * CADENCE.gapLimit seconds that bring nothing new. The world is baked in Node (8 m grid, the game's seed) so the
 * chests, shrines and camps are the real ones; the model is src/rpg/logic/cadence.js, its numbers src/rpg/data/cadence.js.
 * Usage: node tools/reward-cadence.mjs [--all] [--json]   (--all: the whole path, not only the first hour)
 * @module tools/reward-cadence
 */
import { pathToFileURL } from 'node:url';
import { BALANCE } from '../src/core/balance.js';
import { WORLD_SEED } from '../src/core/constants.js';
import { bakeSync } from '../src/world/gen/bake.js';
import { createGrid } from '../src/world/gen/grid.js';
import { createQueries } from '../src/world/gen/queries.js';
import { createColliders } from '../src/world/gen/colliders.js';
import { placePois } from '../src/world/gen/pois.js';
import { LANDMARKS, REGIONS } from '../src/world/gen/layout.js';
import { enemies, bosses, GROUPS, SPAWN_TABLES } from '../src/ai/data/enemies.js';
import { QUESTS } from '../src/rpg/data/quests.js';
import { DIALOGUES } from '../src/rpg/data/dialogues.js';
import { ITEMS } from '../src/rpg/data/items.js';
import { NPCS, OBJECTS, COURSES } from '../src/rpg/data/world.js';
import { SHARDS_PER_REGION, shardRewards } from '../src/rpg/data/shards.js';
import { SHARD_TABLE } from '../src/rpg/data/shardTable.js';
import { CADENCE } from '../src/rpg/data/cadence.js';
import { rewardTimeline, formatTimeline } from '../src/rpg/logic/cadence.js';

/** Bake the world and gather what the cadence model reads. @returns {import('../src/rpg/logic/cadence.js').CadenceWorld} */
export function cadenceWorld() {
  const grid = createGrid(bakeSync(WORLD_SEED, 8));
  const col = createColliders(grid.heightAt, grid.normalAt);
  const q = createQueries(grid, (x, y, z, c) => col.blocked(x, y, z, c));
  const pois = placePois(q, WORLD_SEED);
  const lm = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));
  for (const l of LANDMARKS) if (l.tag !== 'P1') pois.push({ id: l.id, type: 'landmark', x: l.x, z: l.z, regionId: q.regionAt(l.x, l.z), data: {} });
  const defs = {};
  const reg = (kind, list) => { for (const d of list) defs[kind + ':' + d.id] = d; };
  reg('enemy', enemies()); reg('boss', bosses()); reg('group', GROUPS); reg('spawnTable', SPAWN_TABLES); reg('quest', QUESTS);
  reg('dialogue', DIALOGUES); reg('item', ITEMS); reg('course', COURSES); reg('region', REGIONS); reg('object', OBJECTS);
  const levelTechs = [];
  for (const id of Object.keys(BALANCE.tech)) {
    const t = BALANCE.tech[id];
    if (typeof t.unlockLevel === 'number') levelTechs.push({ techId: id, level: t.unlockLevel, tp: t.ranks[0].tp || 0 });
  }
  const npcs = Object.fromEntries(NPCS.map((n) => [n.id, n]));
  const shards = process.env.NO_SHARDS ? [] : SHARD_TABLE.slice();
  return {
    start: lm.selas_ledge,
    regionAt: (x, z) => q.regionAt(x, z),
    landmark: (id) => lm[id] || null,
    npc: (id) => {
      const n = npcs[id];
      if (!n) return null;
      if (typeof n.home.x === 'number') return n.home;
      return lm[n.home.settlement] || null;
    },
    object: (id) => defs['object:' + id] || null,
    def: (k) => defs[k] || null,
    pois,
    levelTechs,
    shards,
    shardRewards: shardRewards(shards.length),
    shardsPerRegion: SHARDS_PER_REGION,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = process.argv.includes('--all');
  const r = rewardTimeline(cadenceWorld(), CADENCE);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log('Reward cadence of the main path (minute:second, level, kind, id); gap limit ' + CADENCE.gapLimit + ' s');
    for (const l of formatTimeline(r, CADENCE, all ? 0 : CADENCE.horizon)) console.log(l);
    const first = r.gaps.filter((g) => g.from < CADENCE.horizon);
    console.log((all ? r.gaps : first).length + ' gap(s) over ' + CADENCE.gapLimit + ' s' + (all ? '' : ' in the first hour') + '; path ends at ' + Math.round(r.end / 60) + ' min');
  }
}
