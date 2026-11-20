/**
 * Reward cadence (the pacing rule of the experience pass): walk the main path of a first journey as a careful player
 * would, with the game's own quest, dialogue, enemy, item and world data, and list every reward with the minute it
 * lands: level-ups, techniques and Forms, gear, chests, shrines, Ora shards, new regions, Ringstones, bosses and
 * quests. Then find the stretches with nothing new. Pure: the world is passed in (tools/reward-cadence.mjs bakes it
 * in Node; tests/rpg/cadence.test.mjs asserts the rule).
 * @module rpg/logic/cadence
 */

import { BALANCE } from '../../core/balance.js';
import * as F from '../../core/formulas.js';

/**
 * @typedef {object} CadenceWorld
 * @property {{x:number, z:number}} start
 * @property {(x:number, z:number) => string} regionAt
 * @property {(id:string) => ({x:number, z:number}|null)} landmark
 * @property {(id:string) => ({x:number, z:number}|null)} npc
 * @property {(id:string) => ({x:number, z:number}|null)} object
 * @property {(id:string) => any} def            (kind:id) lookups: 'quest:mq1', 'dialogue:x', 'enemy:x', 'group:x', 'boss:x', 'item:x', 'course:x', 'spawnTable:x', 'region:x'
 * @property {any[]} pois                        world POIs { id, type, x, z, regionId, data }
 * @property {Array<{ techId:string, level:number, tp:number }>} levelTechs   techniques that open at a level
 * @property {Array<{ id:string, x:number, y:number, z:number, regionId:string }>} [shards]  Ora shards
 * @property {Array<{ at:number, kind:string }>} [shardRewards]              rewards at shard counts
 */

/**
 * @param {CadenceWorld} W
 * @param {any} C  the CADENCE data
 * @returns {{ events: Array<{ t:number, kind:string, id:string, level:number }>, gaps: Array<{ from:number, to:number, seconds:number }>, end:number }}
 */
export function rewardTimeline(W, C) {
  const events = [];
  const st = { t: 0, x: W.start.x, z: W.start.z, level: 1, xp: 0, tp: 0, fly: false, techs: new Set(), regions: new Set(), done: new Set(),
    shards: 0 };
  const D = (k, id) => W.def(k + ':' + id);
  const emit = (kind, id) => events.push({ t: Math.round(st.t), kind, id, level: st.level });
  st.regions.add(W.regionAt(st.x, st.z));

  const band = () => {
    const m = st.t / 60;
    for (const b of BALANCE.route.bands) if (m >= b.from && m < b.to) return b;
    return BALANCE.route.bands[BALANCE.route.bands.length - 1];
  };

  function grantXp(n) {
    st.xp += Math.max(0, Math.round(n));
    while (st.level < BALANCE.level.cap && st.xp >= F.xpToNext(st.level)) {
      st.xp -= F.xpToNext(st.level);
      st.level++;
      st.tp += BALANCE.level.tpPerLevel;
      emit('level', 'L' + st.level);
      for (const lt of W.levelTechs) {
        if (st.techs.has(lt.techId) || st.level < lt.level || st.tp < lt.tp) continue;
        st.tp -= lt.tp;
        st.techs.add(lt.techId);
        emit('technique', lt.techId);
      }
    }
  }

  /** The level of an enemy met now (its def's band around the player's level). */
  function enemyLevel(def) {
    const lv = def && def.levels ? def.levels : [st.level, st.level];
    return Math.max(lv[0], Math.min(lv[1], st.level));
  }
  function kill(enemyId, n) {
    const def = D('enemy', enemyId);
    for (let i = 0; i < n; i++) grantXp(F.enemyXp(def, enemyLevel(def), st.level));
    st.t += n * (C.perKill[def && def.tier] || C.perKill.grunt);
  }

  /** Things passed on the way: regions, side chests and shrines, Ora shards; discovery and ambient-kill XP. */
  function travel(x, z) {
    const dx = x - st.x;
    const dz = z - st.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) return;
    const speed = st.fly ? C.fly : C.walk;
    // Ambient fights on the way take their share of the time: the route band's kill rate at the grunt kill time.
    const b = band();
    const fightShare = Math.min(0.6, (b.killsPerMin * C.perKill.grunt) / 60);
    const total = ((d * C.detour) / speed + C.legOverhead) / (1 - fightShare);
    const steps = Math.max(1, Math.ceil(d / 20));
    const t0 = st.t;
    const x0 = st.x;
    const z0 = st.z;
    let side = 0;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const px = x0 + dx * k;
      const pz = z0 + dz * k;
      st.t = t0 + total * k + side;
      const r = W.regionAt(px, pz);
      if (r && !st.regions.has(r)) {
        st.regions.add(r);
        emit('region', r);
      }
      for (const p of W.pois) {
        if (st.done.has(p.id)) continue;
        const pd = Math.hypot(p.x - px, p.z - pz);
        if (pd <= BALANCE.world.discoveryRadius && p.type !== 'chest' && p.type !== 'crownChest' && p.type !== 'shrine') {
          st.done.add(p.id);
          grantXp(p.type === 'landmark' ? BALANCE.xp.discovery.landmark : BALANCE.xp.discovery.poi);
        } else if ((p.type === 'chest' || p.type === 'shrine') && pd <= C.sideReach && (p.type !== 'chest' || st.fly)) {
          st.done.add(p.id);
          const extra = p.type === 'chest' ? C.chestSeconds : C.shrineSeconds;
          side += extra;
          st.t += extra;
          if (p.type === 'shrine') st.tp += BALANCE.tp.shrineTp;
          emit(p.type, p.id);
        }
      }
      if (W.shards && st.fly) {
        for (const s of W.shards) {
          if (st.done.has(s.id) || Math.hypot(s.x - px, s.z - pz) > C.sideReach) continue;
          st.done.add(s.id);
          side += 6;
          st.t += 6;
          st.shards++;
          emit('shard', s.id);
          if (W.shardRewards) for (const sr of W.shardRewards) if (sr.at === st.shards) emit(sr.kind, 'shards_' + sr.at);
        }
      }
    }
    const kills = (b.killsPerMin * (st.t - t0)) / 60;
    grantXp(kills * F.enemyXp({ mult: { xp: b.xpMult } }, st.level, st.level));
    st.x = x;
    st.z = z;
  }

  function run(actions) {
    for (const a of actions || []) {
      if (a.op === 'giveXp') grantXp(a.amount);
      else if (a.op === 'giveTp') st.tp += a.amount;
      else if (a.op === 'unlockTech') {
        if (!st.techs.has(a.tech)) emit('technique', a.tech);
        st.techs.add(a.tech);
      } else if (a.op === 'unlockForm') emit('form', a.form);
      else if (a.op === 'giveItem') {
        const it = D('item', a.item);
        emit(it && it.type === 'gear' ? 'gear' : 'item', a.item);
      }
    }
  }

  function talk(dialogueId) {
    const d = D('dialogue', dialogueId);
    let lines = 0;
    if (d && d.nodes) {
      let n = d.start;
      for (let k = 0; n && d.nodes[n] && k < 40; k++) {
        lines++;
        n = d.nodes[n].next;
      }
    }
    st.t += C.talkBase + lines * C.talkPerLine;
  }

  function goPos(p) {
    if (p) travel(p.x, p.z);
  }

  function step(q, s) {
    const pos = (m) => {
      if (!m) return null;
      if (typeof m.x === 'number') return m;
      if (m.landmark) return W.landmark(m.landmark);
      if (m.npc) return W.npc(m.npc);
      if (m.object) return W.object(m.object);
      return null;
    };
    switch (s.type) {
      case 'script':
        if (q.id === 'mq1') st.t += C.mq1[s.id] || 10;
        if (s.script === 'tut_fly') st.fly = true;
        if (s.script === 'tut_awakening') emit('technique', 'gather');
        if (s.script === 'ending') st.t += 30;
        break;
      case 'talk':
      case 'deliver':
        goPos(W.npc(s.npc));
        talk(s.dialogue);
        break;
      case 'goto':
        goPos(W.landmark(s.landmark) || pos(s.marker));
        break;
      case 'kill': {
        goPos(pos(s.marker));
        const n = s.count || 1;
        if (s.enemy) kill(s.enemy, n);
        else {
          // a tagged group: the quest's spawn group, else Choir Acolytes
          let gid = null;
          for (const a of (s.onStart || [])) if (a.op === 'spawnGroup') gid = a.group;
          const g = gid ? D('group', gid) : null;
          if (g) for (const m of g.members) kill(m.enemy, m.count);
          else kill('choir_acolyte', n);
        }
        break;
      }
      case 'defeat': {
        const bd = D('boss', s.boss);
        goPos(bd ? W.landmark(bd.arena.landmarkId) : null);
        st.t += C.boss[s.boss] || 90;
        const ed = D('enemy', s.boss);
        if (bd) grantXp(F.enemyXp(ed, bd.level, st.level));
        emit('boss', s.boss);
        break;
      }
      case 'destroy': {
        goPos(W.object(s.object));
        if (String(s.object).indexOf('siphon_') === 0) {
          st.t += C.siphonSeconds;
          for (const gid of ['siphon_wave_1', 'siphon_wave_2']) {
            const g = D('group', gid);
            if (g) for (const m of g.members) for (let i = 0; i < m.count; i++) grantXp(F.enemyXp(D('enemy', m.enemy), enemyLevel(D('enemy', m.enemy)), st.level));
          }
          grantXp(F.bonusXp('siphon', st.level));
          emit('siphon', s.object);
        } else st.t += 6;
        break;
      }
      case 'interact':
        for (const o of s.objects || [s.object]) {
          goPos(W.object(o));
          st.t += C.interactSeconds;
        }
        break;
      case 'useTechnique':
        goPos(pos(s.marker));
        st.t += (s.count || 1) * C.techUseSeconds;
        break;
      case 'race': {
        const c = D('course', s.course);
        if (c) {
          goPos(c.start);
          st.t += c.medals.bronze + C.raceExtra;
          let px = c.start.x;
          let pz = c.start.z;
          for (const g of c.gates) {
            px = g.x;
            pz = g.z;
          }
          st.x = px;
          st.z = pz;
        }
        break;
      }
      case 'reach':
        if (s.flag && s.flag.indexOf('attuned.') === 0) {
          const id = s.flag.slice('attuned.'.length);
          const rs = W.pois.find((p) => p.id === id);
          goPos(rs);
          st.done.add(id);
          emit('ringstone', id);
        }
        break;
      default:
        st.t += 5;
    }
    if (s.onComplete) run(s.onComplete);
  }

  function quest(id) {
    const q = D('quest', id);
    if (!q) return;
    if (q.giver && !q.autoStart && q.kind === 'side') {
      goPos(W.npc(q.giver));
      talk(id + '_offer');
    }
    for (const s of q.steps) step(q, s);
    run(q.rewards);
    emit('quest', id);
  }

  function camp(regionId) {
    let best = null;
    let bd = Infinity;
    for (const p of W.pois) {
      if (p.type !== 'camp' || p.regionId !== regionId || st.done.has(p.id)) continue;
      const d = Math.hypot(p.x - st.x, p.z - st.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return;
    goPos(best);
    st.done.add(best.id);
    const tbl = D('spawnTable', regionId);
    const tier = best.data && best.data.tier ? best.data.tier : 1;
    const row = tbl ? tbl.camps.find((c) => c.tier === tier) || tbl.camps[0] : null;
    const g = row ? D('group', row.group) : null;
    st.t += C.campBase;
    if (g) for (const m of g.members) kill(m.enemy, m.count);
    grantXp(F.bonusXp('camp', st.level));
    emit('chest', 'campchest_' + best.id);
  }

  for (const entry of C.plan) {
    if (typeof entry === 'string') quest(entry);
    else if (entry && entry.camp) camp(entry.camp);
  }

  const gaps = [];
  let last = 0;
  const news = events.filter((e) => C.newKinds.indexOf(e.kind) >= 0);
  for (const e of news) {
    if (e.t - last > C.gapLimit) gaps.push({ from: last, to: e.t, seconds: e.t - last });
    last = e.t;
  }
  return { events, gaps, end: Math.round(st.t) };
}

/**
 * The timeline as text lines, minutes:seconds, one reward per line; gaps over the limit are marked.
 * @param {{ events:any[], gaps:any[] }} r @param {any} C @param {number} [horizon]
 * @returns {string[]}
 */
export function formatTimeline(r, C, horizon) {
  const mmss = (t) => Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0');
  const out = [];
  let last = 0;
  for (const e of r.events) {
    if (horizon && e.t > horizon) break;
    const isNew = C.newKinds.indexOf(e.kind) >= 0;
    if (isNew && e.t - last > C.gapLimit) out.push('        --- ' + Math.round(e.t - last) + ' s with nothing new ---');
    if (isNew) last = e.t;
    out.push(mmss(e.t).padStart(6) + '  L' + String(e.level).padEnd(3) + e.kind.padEnd(10) + e.id);
  }
  return out;
}
