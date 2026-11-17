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

/** The Ringstone prop stands ahead of its POI so a journey (or respawn) never starts inside the stone (11). */
const RS_DX = 4;
const RS_DZ = 10;
const CAMP_CHEST_DX = 5;
const GATE_RADIUS = 10;
const SIPHON_WAKE = 150;
const SIPHON_CYCLE_RANGE = 600;
const DISCOVERY_EVERY = 30;

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
    for (const poi of w.pois('ringstone')) buildRingstone(poi);
    for (const poi of w.pois('shrine')) buildShrine(poi);
    for (const poi of w.pois('chest')) buildChest(poi, poi.data && poi.data.table ? poi.data.table : 'chest_t1');
    for (const poi of w.pois('crownChest')) buildChest(poi, poi.data && poi.data.table ? poi.data.table : 'chest_t3');
    for (const poi of w.pois('camp')) buildCampChest(poi);
    for (const poi of w.pois('siphon')) buildSiphon(poi);
    for (const poi of w.pois('race')) buildRaceStart(poi);
    for (const l of ctx.defs.all('landmark')) if (l.tag !== 'P1') discover.push({ id: l.id, type: 'landmark', x: l.x, z: l.z });
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
    host.quests.addInteractable({ id: poi.id, kind: 'ringstone', x, y: y + 1, z, radius: 4, promptKey: 'rpg.prompt.ringstone', onUse: () => useRingstone(r) });
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
  }

  function buildShrine(poi) {
    const done = W().shrines.indexOf(poi.id) >= 0;
    const r = add({ id: poi.id, kind: 'shrine', x: poi.x, y: poi.y, z: poi.z, state: done ? 'claimed' : 'ready', prop: null, entId: 0, regionId: poi.regionId, data: poi.data });
    r.prop = prop('shrine', poi.x, poi.y, poi.z, { state: r.state });
    if (r.prop && !done) r.prop.setGlow(0.9);
    host.quests.addInteractable({ id: poi.id, kind: 'shrine', x: poi.x, y: poi.y + 1, z: poi.z, radius: 4, promptKey: 'rpg.prompt.shrine', enabled: !done,
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
      else ctx.bus.emit('ui:toast', { key: 'rpg.toast.item', args: { item: ctx.i18n.t('item.' + g.itemId + '.name'), count: g.count }, kind: 'good' });
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
    ctx.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.banner.siphon', args: { n: w.siphons.length } });
  }

  // ------------------------------------------------------------------ quest objects

  /** (Re)build the quest objects whose quest is active, and enable the ones the current steps need. */
  function questChanged() {
    const q = S().quests;
    for (const def of ctx.defs.all('object')) {
      if (!def.quest || def.script || def.id.startsWith('siphon_')) continue;
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
    for (const d of discover) {
      const dx = p.pos.x - d.x;
      const dz = p.pos.z - d.z;
      if (dx * dx + dz * dz > R * R || w.discovered.indexOf(d.id) >= 0) continue;
      w.discovered.push(d.id);
      ctx.bus.post('world:poiDiscovered', { poiId: d.id, type: d.type, x: d.x, z: d.z });
      ctx.rpg.grantXp(d.type === 'landmark' ? BALANCE.xp.discovery.landmark : BALANCE.xp.discovery.poi, 'discovery');
    }
  }

  // ------------------------------------------------------------------ public

  const api = {
    build,
    questChanged,

    clear() {
      if (race.active) endRace(false);
      for (const r of recs.slice()) removeRec(r);
      recs.length = 0;
      byId.clear();
      discover.length = 0;
    },

    /** @param {any} c @param {number} dt @param {any} p */
    step(c, dt, p) {
      tickN++;
      for (let i = 0; i < recs.length; i++) if (recs[i].kind === 'siphon' && recs[i].entId) stepSiphon(recs[i], dt, p);
      if (race.active) stepRace(dt, p);
      if (tickN % DISCOVERY_EVERY === 0) stepDiscovery(p);
    },

    /** @param {any} p actor:died @param {boolean} side */
    died(p, side) {
      if (p.kind === 'object') {
        let r = null;
        for (const x of recs) if (x.entId === p.entId) r = x;
        if (!r) return;
        if (r.kind === 'siphon') silence(r);
        else {
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
