/**
 * World activities (ARCHITECTURE 4.12, GDD 8.3 and 9): Ringstones, Ora Shrines, chests and camp chests, Siphon
 * Spires (HP, the 8 s core cycle, guard waves, silencing), the ring race, quest objects and discovery. Built on
 * `game:loaded` from `world.pois` and defs `object`, drawn with `env.spawnProp`, persisted through the store lists
 * (`world.ringstones / shrines / chests / siphons / discovered / races`) and quest flags (camp chests, used objects).
 * @module rpg/activities
 */

import { BALANCE } from '../core/balance.js';
import * as F from '../core/formulas.js';
import { TAG } from '../core/ents.js';
import { PALETTE } from '../core/palette.js';
import { medalFor, gatePassed, siphonOpen } from './logic/activity.js';
import { shardRewards, SHARD_XP } from './data/shards.js';
import { SHARD_TABLE } from './data/shardTable.js';

/** The Ringstone prop stands ahead of its POI so a journey (or respawn) never starts inside the stone (11). */
const RS_DX = 4;
const RS_DZ = 10;
/** Interact reach of Ringstones and shrines (m). The stone's collider keeps the player about 4 m from its centre. */
const STONE_REACH = 6.5;
const CAMP_CHEST_DX = 5;
const GATE_RADIUS = 10;
const SIPHON_WAKE = 150;
const SIPHON_CYCLE_RANGE = 600;
/** Beyond this distance from a woken Siphon its guards are sent home (m). */
const SIPHON_GUARD_LEASH = 400;
const DISCOVERY_EVERY = 30;
/** Ora shards: a pickup stands within SHARD_NEAR (m) of the player; the nearest SHARD_BEACONS within SHARD_BEACON_RANGE
 * also raise a column of light so a flyer sees where to go. Checked every SHARD_EVERY ticks. */
const SHARD_NEAR = 260;
const SHARD_FAR = 300;
const SHARD_BEACONS = 2;
const SHARD_BEACON_RANGE = 700;
const SHARD_EVERY = 20;
/** An unbreakable quest object stands again this long after it is broken (s). */
const OBJECT_RESPAWN = 1.2;

/**
 * @param {any} ctx
 * @param {{ quests:any, engine:any, isPlayerSide:(id:number)=>boolean }} host
 */
export function createActivities(ctx, host) {
  /** Activity records: { id, kind, x, y, z, state, prop, entId, regionId, data }. @type {any[]} */
  const recs = [];
  /** @type {Map<string, any>} */
  const byId = new Map();
  /** Discovery candidates. @type {Array<{ id:string, type:string, x:number, z:number }>} */
  const discover = [];
  const race = { active: false, courseId: '', t: 0, next: 0, gates: /** @type {any[]} */ ([]), props: /** @type {any[]} */ ([]) };
  const pSiphon = { id: '', state: 'closed', regionId: '' };
  const pGate = { courseId: '', index: 0, total: 0 };
  let tickN = 0;
  /** Unbreakable quest objects waiting to stand again. */
  let respawns = 0;
  /** Ora shards: the placed set, their pickup entities and light columns by shard id. */
  /** @type {Array<{ id:string, x:number, y:number, z:number, regionId:string, kind:string, view:boolean }>} */
  let shards = [];
  /** @type {Map<string, number>} */
  const shardEnts = new Map();
  /** @type {Map<string, any>} */
  const shardBeacons = new Map();
  /** @type {any[]} */
  let shardReward = [];
  const nearScratch = [];
  /** The light columns lit now (shard ids) and the ones wanted this check. */
  const beaconIds = [null, null];
  const want = [null, null];

  const S = () => ctx.store.state;
  const W = () => ctx.store.state.world;
  const flags = () => ctx.store.state.quests.flags;
  const ground = (x, z) => (ctx.world ? ctx.world.heightAt(x, z) : 0);

  /** @param {any} r */
  function add(r) {
    recs.push(r);
    byId.set(r.id, r);
    return r;
  }

  function prop(kind, x, y, z, opts) {
    return ctx.env ? ctx.env.spawnProp(kind, x, y, z, opts) : null;
  }

  // ------------------------------------------------------------------ build

  function build() {
    api.clear();
    const w = ctx.world;
    if (!w) return;
    // Every attuned stone carries its flag (the Ringstone menu's travel choices read it; older journeys and the
    // tutorial=0 shortcut only had the list).
    for (const id of W().ringstones) flags()['attuned.' + id] = true;
    // Likewise every beaten boss (the menu offers a rematch only for those).
    for (const id of W().bosses) flags()['beaten.' + id] = true;
    for (const poi of w.pois('ringstone')) buildRingstone(poi);
    for (const poi of w.pois('shrine')) buildShrine(poi);
    for (const poi of w.pois('chest')) buildChest(poi, poi.data && poi.data.table ? poi.data.table : 'chest_t1');
    for (const poi of w.pois('crownChest')) buildChest(poi, poi.data && poi.data.table ? poi.data.table : 'chest_t3');
    for (const poi of w.pois('camp')) buildCampChest(poi);
    for (const poi of w.pois('siphon')) buildSiphon(poi);
    for (const poi of w.pois('race')) buildRaceStart(poi);
    for (const l of ctx.defs.all('landmark')) if (l.tag !== 'P1') discover.push({ id: l.id, type: 'landmark', x: l.x, z: l.z });
    // The shards are fixed data (tools/gen-shards.mjs): the same ids at the same spots on every grid.
    shards = SHARD_TABLE.slice();
    shardReward = shardRewards(shards.length);
    for (const poi of w.pois()) discover.push({ id: poi.id, type: poi.type, x: poi.x, z: poi.z });
    // Where the journey (re)starts is known already: no XP and no event for it.
    const pl = S().player;
    const R = BALANCE.world.discoveryRadius;
    for (const d of discover) {
      if ((pl.x - d.x) * (pl.x - d.x) + (pl.z - d.z) * (pl.z - d.z) <= R * R && W().discovered.indexOf(d.id) < 0) W().discovered.push(d.id);
    }
    questChanged();
  }

  function buildRingstone(poi) {
    const done = W().ringstones.indexOf(poi.id) >= 0;
    const x = poi.x + RS_DX;
    const z = poi.z + RS_DZ;
    const y = ground(x, z);
    const r = add({ id: poi.id, kind: 'ringstone', x: poi.x, y: poi.y, z: poi.z, state: done ? 'active' : 'idle', prop: null, entId: 0, regionId: poi.regionId, data: poi.data });
    r.prop = prop('ringstone', x, y, z, { state: r.state, yaw: Math.PI });
    if (r.prop && done) r.prop.setGlow(0.7);
    host.quests.addInteractable({ id: poi.id, kind: 'ringstone', x, y: y + 1, z, radius: STONE_REACH, promptKey: 'rpg.prompt.ringstone', onUse: () => useRingstone(r) });
  }

  function useRingstone(r) {
    const w = W();
    const first = w.ringstones.indexOf(r.id) < 0;
    if (first) w.ringstones.push(r.id);
    S().player.respawn = r.id;
    flags()['attuned.' + r.id] = true;
    const p = ctx.player;
    if (p && p.stats) {
      ctx.combat.heal(p, p.stats.hpMax);
      ctx.combat.addOra(p, p.stats.oraMax);
    }
    r.state = 'active';
    if (r.prop) {
      r.prop.setState('active');
      r.prop.setGlow(0.7);
    }
    if (ctx.vfx) ctx.vfx.shockwave(r.x + RS_DX, ground(r.x + RS_DX, r.z + RS_DZ) + 0.5, r.z + RS_DZ, { radius: 6, color: PALETTE.structure.ringstone, seconds: 0.5 });
    ctx.bus.emit('ringstone:activated', { id: r.id, first });
    // With a second Ringstone attuned the stone offers travel, and after the ending its rematches and trials.
    if (!first && (w.ringstones.length > 1 || flags().credits) && !race.active) host.quests.talk('ringstone_menu', {});
  }

  /**
   * Travel to an attuned Ringstone (the Ringstone menu, and the map screen through ctx.quests.travel): not during a
   * boss fight, a race, a fight or a dialogue. The player arrives beside the stone on foot, healed like a touch.
   * @param {string} id ringstone POI id @returns {boolean}
   */
  function travel(id) {
    const r = byId.get(id);
    const p = ctx.player;
    if (!r || r.kind !== 'ringstone' || W().ringstones.indexOf(id) < 0 || !p || !p.alive) return false;
    if (race.active || (ctx.ai && ctx.ai.boss) || (ctx.combat && ctx.combat.inCombat)) return false;
    if (ctx.vfx) ctx.vfx.shockwave(p.pos.x, p.pos.y + 1, p.pos.z, { radius: 6, color: PALETTE.structure.ringstone, seconds: 0.4, sphere: true });
    ctx.move.teleport(p, r.x, ground(r.x, r.z), r.z, Math.atan2(RS_DX, RS_DZ));
    ctx.move.setMode(p, 'ground');
    if (ctx.cam && ctx.cam.setOrbit) ctx.cam.setOrbit(Math.atan2(RS_DX, RS_DZ), ctx.cam.pitch);
    S().player.respawn = id;
    ctx.combat.heal(p, p.stats.hpMax);
    ctx.combat.addOra(p, p.stats.oraMax);
    if (ctx.vfx) ctx.vfx.shockwave(r.x + RS_DX, ground(r.x + RS_DX, r.z + RS_DZ) + 0.5, r.z + RS_DZ, { radius: 10, color: PALETTE.structure.ringstone, seconds: 0.6 });
    ctx.bus.emit('ui:toast', { key: 'rpg.toast.travel', args: { place: ctx.i18n.t('landmark.' + (r.data && r.data.landmarkId) + '.name') }, kind: 'good' });
    return true;
  }

  function buildShrine(poi) {
    const done = W().shrines.indexOf(poi.id) >= 0;
    const r = add({ id: poi.id, kind: 'shrine', x: poi.x, y: poi.y, z: poi.z, state: done ? 'claimed' : 'ready', prop: null, entId: 0, regionId: poi.regionId, data: poi.data });
    r.prop = prop('shrine', poi.x, poi.y, poi.z, { state: r.state });
    if (r.prop && !done) r.prop.setGlow(0.9);
    host.quests.addInteractable({ id: poi.id, kind: 'shrine', x: poi.x, y: poi.y + 1, z: poi.z, radius: STONE_REACH, promptKey: 'rpg.prompt.shrine', enabled: !done,
      onUse: () => claimShrine(r) });
  }

  function claimShrine(r) {
    const w = W();
    if (w.shrines.indexOf(r.id) >= 0) return;
    w.shrines.push(r.id);
    ctx.rpg.addTp(BALANCE.tp.shrineTp);
    r.state = 'claimed';
    if (r.prop) {
      r.prop.setState('claimed');
      r.prop.setGlow(0);
    }
    host.quests.setInteractable(r.id, false);
    if (ctx.vfx) ctx.vfx.shockwave(r.x, r.y + 1, r.z, { radius: 8, color: PALETTE.ora, seconds: 0.6, sphere: true });
    ctx.bus.emit('shrine:claimed', { id: r.id });
    ctx.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.banner.shrine', args: { n: w.shrines.length, total: BALANCE.tp.shrines } });
  }

  function buildChest(poi, table) {
    const done = W().chests.indexOf(poi.id) >= 0;
    const r = add({ id: poi.id, kind: 'chest', x: poi.x, y: poi.y, z: poi.z, state: done ? 'open' : 'closed', prop: null, entId: 0, regionId: poi.regionId, data: { table } });
    r.prop = prop('chest', poi.x, poi.y, poi.z, { state: r.state, yaw: (poi.x * 0.013) % 6.28 });
    if (r.prop && !done) r.prop.setGlow(0.5);
    host.quests.addInteractable({ id: poi.id, kind: 'chest', x: poi.x, y: poi.y + 0.5, z: poi.z, radius: 3, promptKey: 'rpg.prompt.chest', enabled: !done,
      onUse: () => openChest(r) });
  }

  /** @param {any} r */
  function openChest(r) {
    if (r.state === 'open' || r.state === 'locked') return;
    const level = regionLevel(r.x, r.z);
    const got = ctx.rpg.giveLoot(r.data.table, level);
    r.state = 'open';
    if (r.kind === 'chest') {
      if (W().chests.indexOf(r.id) < 0) W().chests.push(r.id);
    } else flags()['camp.' + r.data.campId + '.chest'] = 'open';
    if (r.prop) {
      r.prop.setState('open');
      r.prop.setGlow(0);
    }
    host.quests.setInteractable(r.id, false);
    for (const g of got) {
      if (g.kind === 'shells') ctx.bus.emit('ui:toast', { key: 'rpg.toast.shells', args: { n: g.count }, kind: 'good' });
      else ctx.rpg.toastGrant(g.itemId, { added: g.count, soldCount: g.soldCount || 0, soldShells: g.soldShells || 0, dropped: g.dropped || 0 });
    }
    ctx.bus.emit('chest:opened', { id: r.id });
  }

  function buildCampChest(poi) {
    const id = 'campchest_' + poi.id;
    const st = flags()['camp.' + poi.id + '.chest'] || 'locked';
    const x = poi.x + CAMP_CHEST_DX;
    const y = ground(x, poi.z);
    const table = regionTable(poi.regionId);
    const r = add({ id, kind: 'campChest', x, y, z: poi.z, state: st, prop: null, entId: 0, regionId: poi.regionId, data: { table, campId: poi.id } });
    r.prop = prop('chest', x, y, poi.z, { state: st });
    host.quests.addInteractable({ id, kind: 'chest', x, y: y + 0.5, z: poi.z, radius: 3, promptKey: 'rpg.prompt.chest', enabled: st === 'closed',
      onUse: () => openChest(r) });
  }

  /** @param {string} regionId */
  function regionTable(regionId) {
    const rd = ctx.defs.find('region', regionId);
    return rd && rd.chestTable ? rd.chestTable : 'chest_t1';
  }

  /** @param {number} x @param {number} z */
  function regionLevel(x, z) {
    const w = ctx.world;
    if (w && typeof w.regionLevel === 'function') return Math.max(1, Math.round(w.regionLevel(x, z)));
    return Math.max(1, ctx.rpg.level);
  }

  // ------------------------------------------------------------------ Siphons

  function buildSiphon(poi) {
    const def = ctx.defs.find('object', poi.id);
    const x = def ? def.x : poi.x;
    const z = def ? def.z : poi.z;
    const y = ground(x, z);
    const done = W().siphons.indexOf(poi.id) >= 0;
    const r = add({ id: poi.id, kind: 'siphon', x, y, z, state: done ? 'destroyed' : 'closed', prop: null, entId: 0, regionId: poi.regionId,
      data: { t: 0, woke: false, wave2: false, level: regionLevel(x, z) } });
    r.prop = prop('siphon', x, y, z, { state: r.state });
    if (r.prop && !done) r.prop.setGlow(0.6);
    if (!done && def) spawnObjectEntity(r, def, r.data.level);
  }

  /**
   * A damageable object entity (Siphons, breakable quest objects): rpg fills its stats and owns it (4.12).
   * @param {any} r record @param {any} def ObjectDef @param {number} level
   */
  function spawnObjectEntity(r, def, level) {
    const e = ctx.ents.create('object');
    if (!e) return;
    const siphon = r.kind === 'siphon';
    const hp = Math.max(1, Math.round((def.hpMult || 1) * F.enemyHp(1, level, ctx.rpg.difficulty)));
    e.team = 2;
    e.defId = def.id;
    e.level = level;
    e.radius = siphon ? 3.5 : 1.2;
    e.height = siphon ? 14 : 2.4;
    e.questTag = def.targetTag || null;
    e.tags = TAG.QUEST | TAG.DESTRUCTIBLE | (siphon ? TAG.ELITE : 0);
    e.nameKey = 'object.' + def.id + '.name';
    e.pos.set(r.x, r.y + (def.yOffset || 0), r.z);
    e.prev.copy(e.pos);
    e.stats = {
      hp, hpMax: hp, ora: 0, oraMax: 0, meleeRating: 0, oraRating: 0, defense: F.enemyDefense(siphon ? 1.5 : 0.5, level), critChance: 0,
      poise: 0, poiseMax: 0, resonance: F.enemyResonance(level, siphon ? 'elite' : 'grunt'), runSpeed: 0, flySpeed: 0, boostSpeed: 0, cdr: 0,
      dmgMult: 1, defMult: siphon ? BALANCE.siphon.closedDefMult : 1, speedMult: 1,
    };
    e.data = { rpgObject: true, recId: r.id };
    ctx.combat.initActor(e);
    r.entId = e.id;
    ctx.bus.emit('actor:spawned', { entId: e.id, kind: 'object', defId: def.id });
  }

  /** @param {any} r @param {any} p player */
  function stepSiphon(r, dt, p) {
    const d = r.data;
    const dx = p.pos.x - r.x;
    const dz = p.pos.z - r.z;
    const d2 = dx * dx + dz * dz;
    const e = r.entId ? ctx.ents.get(r.entId) : null;
    // The player left a woken (or silenced) Siphon: its guards go home (they would hold the active-enemy cap from
    // kilometres away and starve the ambient spawner) and wake again on the next approach.
    if (d.woke && d2 > SIPHON_GUARD_LEASH * SIPHON_GUARD_LEASH) sendGuardsHome(r);
    if (!e || !e.alive) return;
    if (!d.woke && d2 < SIPHON_WAKE * SIPHON_WAKE) {
      d.woke = true;
      if (ctx.ai) ctx.ai.spawnGroup('siphon_wave_1', r.x + 24, r.z + 24, { questTag: r.id + '_guard', aggro: true });
    }
    if (d.woke && !d.wave2 && e.stats.hp < e.stats.hpMax * 0.5) {
      d.wave2 = true;
      if (ctx.ai) ctx.ai.spawnGroup('siphon_wave_2', r.x - 24, r.z - 20, { questTag: r.id + '_guard', aggro: true });
    }
    if (d2 > SIPHON_CYCLE_RANGE * SIPHON_CYCLE_RANGE) {
      if (r.state !== 'closed') setSiphon(r, e, 'closed');
      d.t = 0;
      return;
    }
    d.t += dt;
    const want = siphonOpen(d.t, BALANCE.siphon.cycleSeconds, BALANCE.siphon.openSeconds) ? 'open' : 'closed';
    if (want !== r.state) setSiphon(r, e, want);
  }

  /** Despawn a Siphon's living guards (quest tag `<siphon>_guard`) and let it wake again later. @param {any} r */
  function sendGuardsHome(r) {
    const tag = r.id + '_guard';
    const list = ctx.ents.list('enemy');
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i];
      if (!g.alive || g.questTag !== tag || !ctx.ai) continue;
      if (ctx.vfx && r.state === 'destroyed') ctx.vfx.shockwave(g.pos.x, g.pos.y + 1, g.pos.z, { radius: 3, color: PALETTE.ora, seconds: 0.4 });
      ctx.ai.despawn(g.id);
    }
    r.data.woke = false;
    r.data.wave2 = false;
  }

  function setSiphon(r, e, state) {
    r.state = state;
    if (e && e.stats) e.stats.defMult = state === 'open' ? 1 : BALANCE.siphon.closedDefMult;
    if (r.prop) {
      r.prop.setState(state);
      r.prop.setGlow(state === 'open' ? 1 : state === 'destroyed' ? 0 : 0.6);
    }
    pSiphon.id = r.id; pSiphon.state = state; pSiphon.regionId = r.regionId;
    ctx.bus.post('siphon:state', pSiphon);
  }

  function silence(r) {
    const w = W();
    if (w.siphons.indexOf(r.id) < 0) w.siphons.push(r.id);
    const e = r.entId ? ctx.ents.get(r.entId) : null;
    r.entId = 0;
    if (e) ctx.ents.destroy(e.id);
    r.state = 'destroyed';
    if (r.prop) {
      r.prop.setState('destroyed');
      r.prop.setGlow(0);
    }
    ctx.bus.post('siphon:state', { id: r.id, state: 'destroyed', regionId: r.regionId });
    ctx.rpg.grantXp(F.bonusXp('siphon', ctx.rpg.level), 'siphon');
    if (ctx.vfx) ctx.vfx.shockwave(r.x, r.y + 2, r.z, { radius: 60, color: PALETTE.ora, seconds: 1.2, ground: true });
    if (ctx.ai && ctx.ai.clear) ctx.ai.clear(r.x, r.z, 120);
    // The Siphon's guards are bound to it: its fall (the Ora shockwave above) dispels them wherever they are.
    sendGuardsHome(r);
    ctx.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.banner.siphon', args: { n: w.siphons.length } });
  }

  // ------------------------------------------------------------------ quest objects

  /** (Re)build the quest objects whose quest is active, and enable the ones the current steps need. */
  function questChanged() {
    const q = S().quests;
    for (const def of ctx.defs.all('object')) {
      if (!def.quest || def.script || def.id.startsWith('siphon_')) continue;
      // An object no destroy step asks for (the MQ4 saltglass pillar) is never gone for good: a stale flag from an
      // older journey is dropped and the object is rebuilt.
      if (flags()['obj.' + def.id + '.destroyed'] && !breakable(def.id)) delete flags()['obj.' + def.id + '.destroyed'];
      const want = !!q.active[def.quest] && !flags()['obj.' + def.id + '.destroyed'];
      const r = byId.get(def.id);
      if (want && !r) buildQuestObject(def);
      else if (!want && r) removeRec(r);
    }
    for (const r of recs) {
      if (r.kind !== 'questObject' || r.entId) continue;
      host.quests.setInteractable(r.id, !flags()['obj.' + r.id + '.used'] && stepWants(r.id));
    }
  }

  /** @type {Set<string>|null} objects some destroy step asks for */
  let breakables = null;
  /** @param {string} id @returns {boolean} a destroy step of some quest targets this object */
  function breakable(id) {
    if (!breakables) {
      breakables = new Set();
      for (const qd of ctx.defs.all('quest')) {
        for (const s of qd.steps || []) {
          if (s.type !== 'destroy') continue;
          if (s.object) breakables.add(s.object);
          if (Array.isArray(s.objects)) for (const o of s.objects) breakables.add(o);
        }
      }
    }
    return breakables.has(id);
  }

  /** @param {string} id @returns {boolean} the current step of an active quest lists this object for interact */
  function stepWants(id) {
    for (const qid of host.engine.ids) {
      const s = host.engine.current(qid);
      if (s && s.type === 'interact' && (s.object === id || (s.objects && s.objects.indexOf(id) >= 0))) return true;
    }
    return false;
  }

  function buildQuestObject(def) {
    const y = ground(def.x, def.z) + (def.yOffset || 0);
    const used = !!flags()['obj.' + def.id + '.used'];
    const r = add({ id: def.id, kind: 'questObject', x: def.x, y, z: def.z, state: used ? 'used' : 'idle', prop: null, entId: 0,
      regionId: ctx.world ? ctx.world.regionAt(def.x, def.z) : '', data: { def } });
    r.prop = prop(def.prop, def.x, y, def.z, { state: r.state, yaw: def.yaw || 0 });
    if (r.prop && !used) r.prop.setGlow(0.5);
    if (typeof def.hpMult === 'number') spawnObjectEntity(r, def, Math.max(1, ctx.rpg.level));
    else {
      host.quests.addInteractable({ id: def.id, kind: 'object', x: def.x, y: y + 1, z: def.z, radius: 3.5, promptKey: def.promptKey || 'rpg.prompt.use',
        enabled: false, onUse: () => useObject(r) });
    }
  }

  function useObject(r) {
    flags()['obj.' + r.id + '.used'] = true;
    r.state = 'used';
    if (r.prop) {
      r.prop.setState('used');
      r.prop.setGlow(0);
    }
    host.quests.setInteractable(r.id, false);
    if (ctx.vfx) ctx.vfx.shockwave(r.x, r.y + 1, r.z, { radius: 5, color: PALETTE.ora, seconds: 0.4 });
  }

  function removeRec(r) {
    const i = recs.indexOf(r);
    if (i >= 0) recs.splice(i, 1);
    byId.delete(r.id);
    host.quests.removeInteractable(r.id);
    if (r.prop) r.prop.dispose();
    r.prop = null;
    const e = r.entId ? ctx.ents.get(r.entId) : null;
    if (e) ctx.ents.destroy(e.id);
    r.entId = 0;
  }

  /** Unbreakable quest objects stand again a moment after they are broken. @param {number} dt */
  function stepRespawns(dt) {
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.kind !== 'questObject' || r.entId || !(r.data.respawnT > 0)) continue;
      r.data.respawnT -= dt;
      if (r.data.respawnT > 0) continue;
      r.data.respawnT = 0;
      respawns = Math.max(0, respawns - 1);
      spawnObjectEntity(r, r.data.def, Math.max(1, ctx.rpg.level));
      if (r.prop) r.prop.setGlow(0.5);
    }
  }

  // ------------------------------------------------------------------ race

  function buildRaceStart(poi) {
    const courseId = poi.data && poi.data.courseId ? poi.data.courseId : '';
    const c = ctx.defs.find('course', courseId);
    if (!c) return;
    const y = ground(c.start.x, c.start.z);
    const r = add({ id: poi.id, kind: 'race', x: c.start.x, y, z: c.start.z, state: 'idle', prop: null, entId: 0, regionId: poi.regionId, data: { courseId } });
    r.prop = prop('signpost', c.start.x, y, c.start.z, { yaw: Math.atan2(c.gates[0].x - c.start.x, c.gates[0].z - c.start.z) });
    if (r.prop) r.prop.setGlow(0.6);
    host.quests.addInteractable({ id: poi.id, kind: 'race', x: c.start.x, y: y + 1, z: c.start.z, radius: 6, promptKey: 'rpg.prompt.race',
      onUse: () => api.raceStart(courseId) });
  }

  function endRace(finished) {
    if (!race.active) return;
    const c = ctx.defs.find('course', race.courseId);
    const seconds = Math.round(race.t * 100) / 100;
    const medal = finished && c ? medalFor(seconds, c.medals) : 'none';
    for (const h of race.props) if (h) h.dispose();
    race.props.length = 0;
    race.gates.length = 0;
    race.active = false;
    const startRec = byId.get('race_' + race.courseId);
    if (startRec) host.quests.setInteractable(startRec.id, true);
    if (finished && c) reward(c, seconds, medal);
    ctx.bus.emit('race:end', { courseId: race.courseId, seconds, medal, finished });
  }

  function reward(c, seconds, medal) {
    const w = W();
    const rec = w.races[c.id] || (w.races[c.id] = { best: 0, medals: [] });
    if (!rec.best || seconds < rec.best) rec.best = seconds;
    if (medal === 'none') return;
    const order = ['bronze', 'silver', 'gold'];
    const upTo = order.indexOf(medal);
    for (let i = 0; i <= upTo; i++) {
      const m = order[i];
      if (rec.medals.indexOf(m) >= 0) continue;
      rec.medals.push(m);
      ctx.rpg.addShells(BALANCE.world.race.rewards[m], 'race');
      if (m === 'gold' && c.goldReward) ctx.rpg.addItem(c.goldReward, 1, { level: ctx.rpg.level });
    }
    ctx.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.race.medal.' + medal, args: { seconds } });
  }

  function stepRace(dt, p) {
    race.t += dt;
    const c = ctx.defs.find('course', race.courseId);
    if (!c || !p.combat || p.combat.state === 'dead' || race.t > c.medals.bronze * 2.5) {
      endRace(false);
      return;
    }
    const g = race.gates[race.next];
    if (!g || !gatePassed(g, p.pos.x, p.pos.y + 1, p.pos.z, GATE_RADIUS)) return;
    const h = race.props[race.next];
    if (h) h.setState('passed');
    race.next++;
    pGate.courseId = race.courseId; pGate.index = race.next; pGate.total = race.gates.length;
    ctx.bus.emit('race:gate', pGate);
    if (race.next >= race.gates.length) endRace(true);
    else if (race.props[race.next]) race.props[race.next].setState('next');
  }

  // ------------------------------------------------------------------ discovery

  function stepDiscovery(p) {
    const w = W();
    const R = BALANCE.world.discoveryRadius;
    for (let i = 0; i < discover.length; i++) {
      const d = discover[i];
      const dx = p.pos.x - d.x;
      const dz = p.pos.z - d.z;
      if (dx * dx + dz * dz > R * R || w.discovered.indexOf(d.id) >= 0) continue;
      w.discovered.push(d.id);
      ctx.bus.post('world:poiDiscovered', { poiId: d.id, type: d.type, x: d.x, z: d.z });
      ctx.rpg.grantXp(d.type === 'landmark' ? BALANCE.xp.discovery.landmark : BALANCE.xp.discovery.poi, 'discovery');
    }
  }

  // ------------------------------------------------------------------ Ora shards

  /** @returns {string[]} the collected shard ids (a quest flag, so it is saved with the journey) */
  function shardsGot() {
    const f = flags();
    if (!Array.isArray(f['ora.shards'])) f['ora.shards'] = [];
    return f['ora.shards'];
  }

  /** Stream shard pickups and light columns around the player. @param {any} p */
  function stepShards(p) {
    const got = shardsGot();
    nearScratch.length = 0;
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      if (got.indexOf(s.id) >= 0) continue;
      const dx = p.pos.x - s.x;
      const dz = p.pos.z - s.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const id = shardEnts.get(s.id);
      if (!id && d <= SHARD_NEAR) spawnShard(s);
      else if (id && d > SHARD_FAR) dropShardEnt(s.id);
      if (d <= SHARD_BEACON_RANGE) nearScratch.push(s, d);
    }
    // the nearest few raise a column of light; the others put theirs out
    for (let k = 0; k < SHARD_BEACONS; k++) {
      let bi = -1;
      for (let i = 0; i < nearScratch.length; i += 2) if (nearScratch[i] && (bi < 0 || nearScratch[i + 1] < nearScratch[bi + 1])) bi = i;
      want[k] = bi < 0 ? null : nearScratch[bi];
      if (bi >= 0) nearScratch[bi] = null;
    }
    for (let k = 0; k < SHARD_BEACONS; k++) {
      const cur = beaconIds[k];
      if (cur && cur !== (want[0] && want[0].id) && cur !== (want[1] && want[1].id)) {
        const h = shardBeacons.get(cur);
        if (h) h.dispose();
        shardBeacons.delete(cur);
        beaconIds[k] = null;
      }
    }
    for (let k = 0; k < SHARD_BEACONS; k++) {
      const s = want[k];
      if (!s || shardBeacons.has(s.id)) continue;
      let slot = beaconIds.indexOf(null);
      if (slot < 0) slot = k;
      shardBeacons.set(s.id, prop('lightPillar', s.x, s.y, s.z, { state: 'on', color: PALETTE.ora }));
      beaconIds[slot] = s.id;
    }
  }

  /** @param {string} id */
  function shardById(id) {
    for (let i = 0; i < shards.length; i++) if (shards[i].id === id) return shards[i];
    return null;
  }

  /** A shard pickup (the rpg pickup system collects it: magnet, sound and glow come with it). @param {any} s */
  function spawnShard(s) {
    const e = ctx.ents.create('pickup');
    if (!e) return;
    e.team = 0;
    e.defId = 'ora_shard';
    e.radius = 0.4;
    e.height = 0.8;
    e.pos.set(s.x, s.y, s.z);
    e.prev.copy(e.pos);
    e.data = { rpgPickup: true, kind: 'xp', itemId: s.id, amount: SHARD_XP, level: 1, rarity: null, life: 1e9 };
    shardEnts.set(s.id, e.id);
    ctx.bus.emit('pickup:spawned', { entId: e.id, kind: 'xp', itemId: s.id, rarity: null });
  }

  /** @param {string} id */
  function dropShardEnt(id) {
    const eid = shardEnts.get(id);
    shardEnts.delete(id);
    const e = eid ? ctx.ents.get(eid) : null;
    if (e && e.alive) ctx.ents.destroy(e.id);
  }

  /** pickup:collected of a shard: count it, light the threshold rewards, and a viewpoint reveals its region. */
  function shardCollected(id) {
    const s = shardById(id);
    const got = shardsGot();
    if (!s || got.indexOf(id) >= 0) return;
    got.push(id);
    shardEnts.delete(id);
    const h = shardBeacons.get(id);
    if (h) h.dispose();
    shardBeacons.delete(id);
    const bk = beaconIds.indexOf(id);
    if (bk >= 0) beaconIds[bk] = null;
    const n = got.length;
    if (ctx.vfx) ctx.vfx.shockwave(s.x, s.y, s.z, { radius: 7, color: PALETTE.ora, seconds: 0.5, sphere: true });
    ctx.bus.emit('ui:toast', { key: 'rpg.toast.shard', args: { n, total: shards.length }, kind: 'good' });
    for (const r of shardReward) {
      if (r.at !== n) continue;
      if (r.kind === 'tp') {
        ctx.rpg.addTp(r.amount);
        ctx.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.banner.shardsTp', args: { n } });
      } else if (r.kind === 'shells') {
        ctx.rpg.addShells(r.amount, 'shards');
        ctx.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.banner.shardsShells', args: { n, shells: r.amount } });
      } else if (r.kind === 'title') {
        ctx.rpg.addShells(r.amount, 'shards');
        flags().title = r.title;
        ctx.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.banner.title', args: { title: ctx.i18n.t('rpg.title.' + r.title) } });
      }
    }
    if (s.view) revealRegion(s.regionId);
  }

  /**
   * A viewpoint: the region's points of interest go on the map (flag `revealed.<regionId>`; the map screen shows
   * every POI of a revealed region, see shards().revealed). Their discovery XP still waits for the visit.
   */
  function revealRegion(regionId) {
    const f = flags();
    if (f['revealed.' + regionId]) return;
    f['revealed.' + regionId] = true;
    let n = 0;
    for (const d of discover) if (W().discovered.indexOf(d.id) < 0 && ctx.world && ctx.world.regionAt(d.x, d.z) === regionId) n++;
    ctx.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.banner.viewpoint', args: { region: ctx.i18n.t('region.' + regionId + '.name'), n } });
  }

  // ------------------------------------------------------------------ public

  const api = {
    build,
    questChanged,

    clear() {
      if (race.active) endRace(false);
      for (const r of recs.slice()) removeRec(r);
      recs.length = 0;
      respawns = 0;
      byId.clear();
      discover.length = 0;
      for (const id of Array.from(shardEnts.keys())) dropShardEnt(id);
      for (const h of shardBeacons.values()) if (h) h.dispose();
      shardBeacons.clear();
      beaconIds[0] = null;
      beaconIds[1] = null;
    },

    /** @param {any} c @param {number} dt @param {any} p */
    step(c, dt, p) {
      tickN++;
      for (let i = 0; i < recs.length; i++) if (recs[i].kind === 'siphon' && (recs[i].entId || recs[i].data.woke)) stepSiphon(recs[i], dt, p);
      if (race.active) stepRace(dt, p);
      if (respawns > 0) stepRespawns(dt);
      if (tickN % DISCOVERY_EVERY === 0) stepDiscovery(p);
      if (tickN % SHARD_EVERY === 0 && shards.length) stepShards(p);
    },

    travel,

    /** @param {any} p pickup:collected */
    pickupCollected(p) {
      if (p && typeof p.itemId === 'string' && p.itemId.indexOf('shard_') === 0) shardCollected(p.itemId);
    },

    /**
     * The Ora-shard counter for the map screen: found and total, per region (with its viewpoint state), and the
     * title earned. `list` gives each shard's position and state for markers (found ones, and the viewpoints).
     */
    shards() {
      const got = shardsGot();
      const regions = [];
      for (const s of shards) {
        let r = null;
        for (const x of regions) if (x.id === s.regionId) r = x;
        if (!r) regions.push((r = { id: s.regionId, found: 0, total: 0, revealed: !!flags()['revealed.' + s.regionId] }));
        r.total++;
        if (got.indexOf(s.id) >= 0) r.found++;
      }
      const revealed = [];
      for (const r of regions) if (r.revealed) revealed.push(r.id);
      return { found: got.length, total: shards.length, regions, revealed, title: flags().title || null,
        list: shards.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, regionId: s.regionId, kind: s.kind, view: s.view, found: got.indexOf(s.id) >= 0 })),
        next: shardReward.find((r) => r.at > got.length) || null };
    },

    /** player:died: a running race ends (the player wakes at a Ringstone; the start post is free again). */
    playerDied() {
      if (!race.active) return;
      endRace(false);
      ctx.bus.emit('ui:toast', { key: 'rpg.toast.raceFailed', args: null, kind: 'warn' });
    },

    /** @param {any} p actor:died @param {boolean} side */
    died(p, side) {
      if (p.kind === 'object') {
        let r = null;
        for (const x of recs) if (x.entId === p.entId) r = x;
        if (!r) return;
        if (r.kind === 'siphon') silence(r);
        else if (r.kind === 'questObject' && !breakable(r.id)) {
          // Unbreakable (a later step still needs it, like the pillar the Dawn Lance focuses through): it shatters
          // for a moment and stands again at full strength.
          ctx.ents.destroy(r.entId);
          r.entId = 0;
          r.data.respawnT = OBJECT_RESPAWN;
          respawns++;
          if (r.prop) r.prop.setGlow(0);
          if (ctx.vfx) ctx.vfx.shockwave(r.x, r.y + 1.5, r.z, { radius: 6, color: PALETTE.ora, seconds: 0.5 });
        } else {
          flags()['obj.' + r.id + '.destroyed'] = true;
          r.state = 'broken';
          if (r.prop) {
            r.prop.setState('broken');
            r.prop.setGlow(0);
          }
          ctx.ents.destroy(r.entId);
          r.entId = 0;
        }
        return;
      }
      // SQ4: Rust Golems shed a core while the quest wants them.
      if (side && p.defId === 'rust_golem' && S().quests.active.sq4 && ctx.rpg.count('rust_core') < 3) {
        ctx.rpg.addItem('rust_core', 1);
      }
    },

    /** @param {any} p camp:cleared */
    campCleared(p) {
      const f = flags();
      const k = 'camp.' + p.campId;
      const clears = (f[k + '.clears'] || 0) + 1;
      f[k + '.clears'] = clears;
      ctx.rpg.grantXp(F.bonusXp(clears === 1 ? 'camp' : 'campRefill', ctx.rpg.level), 'camp');
      f[k + '.chest'] = 'closed';
      const r = byId.get('campchest_' + p.campId);
      if (r) {
        r.state = 'closed';
        if (r.prop) {
          r.prop.setState('closed');
          r.prop.setGlow(0.6);
        }
        host.quests.setInteractable(r.id, true);
      }
    },

    /** @param {string} courseId */
    raceStart(courseId) {
      const c = ctx.defs.find('course', courseId);
      const p = ctx.player;
      if (!c || race.active || !p) return false;
      race.active = true;
      race.courseId = courseId;
      race.t = 0;
      race.next = 0;
      for (let i = 0; i < c.gates.length; i++) {
        const g = c.gates[i];
        const y = ground(g.x, g.z) + g.alt;
        const n = c.gates[i + 1] || g;
        const prev = i > 0 ? c.gates[i - 1] : c.start;
        race.gates.push({ x: g.x, y, z: g.z });
        race.props.push(prop('ringGate', g.x, y, g.z, { state: i === 0 ? 'next' : 'idle', yaw: Math.atan2(n.x - prev.x, n.z - prev.z), scale: 1.25 }));
      }
      host.quests.setInteractable('race_' + courseId, false);
      ctx.bus.emit('race:start', { courseId });
      return true;
    },
    raceAbort() {
      endRace(false);
    },
    get raceActive() {
      return race.active;
    },
    /** Gate positions of the running race (tests). */
    raceGates() {
      return race.gates;
    },

    objects() {
      const out = [];
      for (const r of recs) out.push({ id: r.id, kind: r.kind, x: r.x, y: r.y, z: r.z, state: r.state, entId: r.entId });
      return out;
    },

    /** @param {string} id @param {{x:number,z:number}} out */
    objectPos(id, out) {
      const r = byId.get(id);
      if (r) { out.x = r.x; out.z = r.z; return true; }
      const d = ctx.defs.find('object', id);
      if (d) { out.x = d.x; out.z = d.z; return true; }
      return false;
    },

    /** Attune a Ringstone as if the player touched it (heal, respawn point, event). False when it is unknown. @param {string} id */
    attune(id) {
      const r = byId.get(id);
      if (!r || r.kind !== 'ringstone') return false;
      useRingstone(r);
      return true;
    },

    /** @param {string} id */
    record(id) {
      return byId.get(id) || null;
    },

    dispose() {
      api.clear();
    },
  };
  return api;
}
