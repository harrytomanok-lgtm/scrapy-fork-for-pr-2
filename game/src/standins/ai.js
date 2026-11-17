/**
 * Stand-in `ctx.ai` (ARCHITECTURE 4.10, 8.0): `spawn` with real stats (`formulas.enemyStats`), one simple brain
 * (acquire the player within sight, approach to the range of the first technique, attack with it every 2 s,
 * return home and heal beyond the leash), body removal 1.5 s after `actor:died` for the enemies and bosses it
 * spawned, `spawnGroup`, and `startBoss` = spawn at the arena with `boss:start`, `boss:phase` (running the phase
 * `onEnter` actions through `quests.runActions`) and `boss:end`, including the pending-boss rule. No ambient
 * spawning. Systems: `standin.ai.brains` (intent, order 20) and `standin.ai.bodies` (post).
 * Replaced by the ai package.
 * @module standins/ai
 */

import { BALANCE } from '../core/balance.js';
import * as F from '../core/formulas.js';
import { TAG } from '../core/ents.js';

const OWNER = 'standin:ai';
const ATTACK_EVERY = 2;
const BODY_SECONDS = 1.5;
const MAX_BODIES = 128;
const HOVER = 4;

/**
 * Create the stand-in ai service.
 * @param {any} ctx
 */
function createAi(ctx) {
  /** Ids of the enemies and bosses this service spawned. @type {Set<number>} */
  const spawned = new Set();
  /** @type {Map<string, Function>} */
  const brains = new Map();
  const bodyId = new Int32Array(MAX_BODIES);
  const bodyAt = new Float64Array(MAX_BODIES);
  let bodyCount = 0;
  let enabled = true;
  let ambient = false;
  /** @type {any} */
  let bossEnt = null;
  /** @type {string|null} */
  let pending = null;
  let bossPhase = 0;
  const pRemoved = { entId: 0, kind: 'enemy', defId: '' };
  const pPhase = { bossId: '', entId: 0, phase: 0 };

  /** @param {any} ent */
  function emitRemoved(ent) {
    pRemoved.entId = ent.id; pRemoved.kind = ent.kind; pRemoved.defId = ent.defId;
    ctx.bus.emit('actor:removed', pRemoved);
  }

  /** @param {any} ent */
  function zeroIntent(ent) {
    const it = ent.intent;
    if (!it) return;
    it.mx = 0; it.mz = 0; it.up = 0; it.sprint = false; it.faceYaw = null;
  }

  /**
   * @param {string} enemyId @param {number} x @param {number} y @param {number} z
   * @param {any} o @param {{ hpMult?:number, poise?:number }|undefined} statOpts
   */
  function spawnInternal(enemyId, x, y, z, o, statOpts) {
    const def = ctx.defs.find('enemy', enemyId);
    if (!def) {
      ctx.log.warn('ai', 'spawn: unknown enemy', enemyId);
      return null;
    }
    const world = ctx.world;
    const band = def.levels || [1, 1];
    let level = typeof o.level === 'number' ? o.level : Math.round(world ? world.regionLevel(x, z) : band[0]);
    if (typeof o.level !== 'number') level = Math.max(band[0], Math.min(band[1], level));
    level = Math.max(1, Math.round(level));
    const ent = ctx.ents.create(def.tier === 'boss' ? 'boss' : 'enemy');
    if (!ent) return null;
    const flyer = def.movement === 'fly' || def.movement === 'hover';
    const ground = world ? world.heightAt(x, z) : 0;
    const yy = flyer ? Math.max(y, Math.max(ground, 0) + HOVER) : Math.max(y, ground);
    ent.team = o.hostile === false ? 0 : 2;
    ent.defId = enemyId;
    ent.level = level;
    ent.questTag = o.questTag || null;
    ent.nameKey = (def.tier === 'boss' ? 'boss.' : 'enemy.') + enemyId + '.name';
    ent.tags = (flyer ? TAG.FLYER : TAG.GROUNDED_ONLY) | (def.tier === 'boss' ? TAG.BOSS : 0) | (def.tier === 'elite' ? TAG.ELITE : 0) | (o.questTag ? TAG.QUEST : 0);
    ent.pos.set(x, yy, z);
    ent.prev.set(x, yy, z);
    const p = ctx.player;
    ent.yaw = p ? Math.atan2(p.pos.x - x, p.pos.z - z) : 0;
    ent.stats = F.enemyStats(def, level, ctx.rpg ? ctx.rpg.difficulty : 'warrior', statOpts);
    if (typeof o.hpMult === 'number' && !statOpts) {
      ent.stats.hp = Math.max(1, Math.round(ent.stats.hp * o.hpMult));
      ent.stats.hpMax = ent.stats.hp;
    }
    ctx.actors.create(ent, def.specId, {});
    ctx.move.initActor(ent, { canFly: flyer, mode: flyer ? 'fly' : 'ground' });
    ctx.combat.initActor(ent);
    const params = def.params || {};
    ent.brain = {
      standinBrain: true, homeX: x, homeZ: z, hoverY: yy - Math.max(ground, 0), sight: params.sight || 45,
      leash: typeof o.leash === 'number' ? o.leash : params.leash || 80, passive: !!o.passive, aggro: !!o.aggro, targetId: 0,
      state: 'idle', attackT: 0.6 + (ent.id % 7) * 0.2, custom: null, campId: o.campId || null,
    };
    const factory = brains.get(def.brain);
    if (factory) ent.brain.custom = factory(ctx, ent, params);
    spawned.add(ent.id);
    ctx.bus.emit('actor:spawned', { entId: ent.id, kind: ent.kind, defId: enemyId });
    return ent;
  }

  /** Brain of one enemy for one tick. */
  function think(c, ent, dt, tick) {
    const b = ent.brain;
    const it = ent.intent;
    if (!it) return;
    if (!enabled || (ent.tags & TAG.SCRIPTED) !== 0 || !ent.combat || ent.combat.state === 'dead') {
      zeroIntent(ent);
      b.state = 'idle';
      return;
    }
    if (b.custom) {
      if ((tick + ent.id) % 6 === 0) b.custom.think(0.1);
      return;
    }
    const p = c.player;
    const hx = ent.pos.x - b.homeX;
    const hz = ent.pos.z - b.homeZ;
    const fromHome = Math.sqrt(hx * hx + hz * hz);
    if ((tick + ent.id) % 6 === 0) {
      let target = 0;
      if (!b.passive && p && p.alive && ent.team === 2) {
        const dx = p.pos.x - ent.pos.x;
        const dz = p.pos.z - ent.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if ((b.aggro || d <= b.sight || b.targetId === p.id) && fromHome <= b.leash) target = p.id;
      }
      if (b.targetId && !target && fromHome > b.leash) b.state = 'return';
      b.targetId = target;
      if (target && b.state !== 'attack') b.state = 'chase';
      if (!target && b.state !== 'return') b.state = 'idle';
    }
    const flyer = (ent.tags & TAG.FLYER) !== 0;
    it.up = 0;
    if (flyer && ent.move) {
      const g = Math.max(ent.move.groundY, 0);
      it.up = Math.max(-1, Math.min(1, (g + b.hoverY - ent.pos.y) / 3));
    }
    const t = b.targetId ? c.ents.get(b.targetId) : null;
    if (b.state === 'return') {
      if (fromHome < 2) {
        b.state = 'idle';
        it.mx = 0; it.mz = 0;
        if (ent.stats) ctx.combat.heal(ent, ent.stats.hpMax);
      } else {
        it.mx = -hx / fromHome; it.mz = -hz / fromHome;
      }
      it.faceYaw = null;
      return;
    }
    if (!t || !t.alive) {
      it.mx = 0; it.mz = 0; it.faceYaw = null;
      return;
    }
    const def = c.defs.find('enemy', ent.defId);
    const tech = def && def.techs.length ? c.defs.find('technique', def.techs[0]) : null;
    const range = tech && tech.ai ? tech.ai.maxRange : 2.5;
    const dx = t.pos.x - ent.pos.x;
    const dz = t.pos.z - ent.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1e-3;
    const busy = ent.combat.state !== 'idle';
    const speedK = flyer ? 0.5 : 1;
    if (d > range * 0.8 && !busy) {
      it.mx = (dx / d) * speedK; it.mz = (dz / d) * speedK;
      b.state = 'chase';
    } else {
      it.mx = 0; it.mz = 0;
      b.state = 'attack';
    }
    it.faceYaw = Math.atan2(dx, dz);
    b.attackT -= dt;
    if (b.attackT <= 0 && d <= range && !busy && tech) {
      if (ctx.combat.useTechnique(ent, tech.id, { targetId: t.id })) b.attackT = ATTACK_EVERY;
      else b.attackT = 0.25;
    }
  }

  const ai = {
    /** @param {string} enemyId @param {number} x @param {number} y @param {number} z @param {any} [opts] */
    spawn(enemyId, x, y, z, opts) {
      return spawnInternal(enemyId, x, y, z, opts || {}, undefined);
    },

    /** @param {string} groupId @param {number} x @param {number} z @param {{ level?:number, questTag?:string, radius?:number, aggro?:boolean }} [opts] */
    spawnGroup(groupId, x, z, opts) {
      const g = ctx.defs.find('group', groupId);
      const out = [];
      if (!g) return out;
      const o = opts || {};
      const radius = typeof o.radius === 'number' ? o.radius : 8;
      let total = 0;
      for (const m of g.members) total += m.count;
      let i = 0;
      for (const m of g.members) {
        for (let k = 0; k < m.count; k++) {
          const a = (i / Math.max(1, total)) * Math.PI * 2;
          const px = x + Math.sin(a) * radius;
          const pz = z + Math.cos(a) * radius;
          const so = { aggro: !!o.aggro, questTag: o.questTag };
          if (typeof o.level === 'number') so.level = o.level + (m.levelOffset || 0);
          const e = spawnInternal(m.enemy, px, ctx.world ? ctx.world.heightAt(px, pz) : 0, pz, so, undefined);
          if (e) out.push(e.id);
          i++;
        }
      }
      return out;
    },

    /** @param {number} entId */
    despawn(entId) {
      const e = ctx.ents.get(entId);
      spawned.delete(entId);
      if (!e) return;
      if (bossEnt === e) bossEnt = null;
      ctx.ents.destroy(entId);
      emitRemoved(e);
    },

    /** @param {string} bossId @param {{ skipIntro?:boolean }} [opts] */
    startBoss(bossId, opts) {
      const bd = ctx.defs.find('boss', bossId);
      if (!bd) {
        ctx.log.warn('ai', 'startBoss: unknown boss', bossId);
        return null;
      }
      if (bossEnt && bossEnt.alive) ai.despawn(bossEnt.id);
      const lm = ctx.world ? ctx.world.landmark(bd.arena.landmarkId) : null;
      const x = lm ? lm.x : 0;
      const z = lm ? lm.z : 0;
      let hpMult = bd.hpMult;
      if (typeof bd.hpPerSiphonStanding === 'number' && ctx.quests) hpMult *= 1 + bd.hpPerSiphonStanding * Math.max(0, 5 - ctx.quests.siphonsSilenced());
      const ent = spawnInternal(bd.enemyId, x, ctx.world ? ctx.world.heightAt(x, z) : 0, z,
        { level: bd.level, aggro: true, leash: bd.arena.radius + BALANCE.bossRules.resetExtra }, { hpMult, poise: bd.poise });
      if (!ent) return null;
      ent.tags |= TAG.BOSS;
      bossEnt = ent;
      pending = bossId;
      bossPhase = 0;
      ctx.bus.emit('boss:start', { bossId, entId: ent.id });
      return ent;
    },

    resetBoss() {
      if (bossEnt) ai.despawn(bossEnt.id);
      bossEnt = null;
    },

    get boss() {
      return bossEnt && bossEnt.alive ? bossEnt : null;
    },

    /** @param {boolean} on */
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) {
        for (const kind of ['enemy', 'boss']) for (const e of ctx.ents.list(kind)) zeroIntent(e);
      }
    },

    /** @param {boolean} on */
    setAmbient(on) {
      ambient = !!on;
    },

    /** @param {number} entId @param {number} targetId */
    aggro(entId, targetId) {
      const e = ctx.ents.get(entId);
      if (!e || !e.brain || !e.brain.standinBrain) return;
      e.brain.aggro = true;
      e.brain.targetId = targetId || 0;
      e.brain.passive = false;
    },

    /** @param {number} x @param {number} z @param {number} radius */
    clear(x, z, radius) {
      const ids = [];
      for (const e of ctx.ents.list('enemy')) {
        if (!e.alive || e.questTag || !spawned.has(e.id)) continue;
        if ((e.pos.x - x) * (e.pos.x - x) + (e.pos.z - z) * (e.pos.z - z) <= radius * radius) ids.push(e.id);
      }
      for (const id of ids) ai.despawn(id);
    },

    /** @returns {{ alive:number, engaged:number }} */
    population() {
      let alive = 0;
      let engaged = 0;
      for (const kind of ['enemy', 'boss']) {
        for (const e of ctx.ents.list(kind)) {
          if (!e.alive) continue;
          alive++;
          if (e.brain && e.brain.targetId) engaged++;
        }
      }
      return { alive, engaged };
    },

    /** @param {number} entId */
    debugState(entId) {
      const e = ctx.ents.get(entId);
      if (!e || !e.brain || !e.brain.standinBrain) return null;
      const def = ctx.defs.find('enemy', e.defId);
      return { brain: def ? def.brain : 'standin', state: e.brain.state, targetId: e.brain.targetId, hasToken: e.brain.state === 'attack' };
    },

    /** @param {string} id @param {Function} factory */
    registerBrain(id, factory) {
      if (typeof factory === 'function') brains.set(id, factory);
    },

    /** @returns {boolean} ambient spawning requested (the stand-in never spawns ambiently) */
    get ambient() {
      return ambient;
    },

    /** Despawn everything this service spawned. */
    dispose() {
      for (const id of Array.from(spawned)) ai.despawn(id);
      reset();
    },
  };

  function reset() {
    spawned.clear();
    bodyCount = 0;
    bossEnt = null;
    pending = null;
    bossPhase = 0;
  }

  const brainSystem = {
    id: 'standin.ai.brains',
    phase: 'intent',
    order: 20,
    owner: OWNER,
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      const tick = c.time.tick;
      const a = c.ents.list('enemy');
      for (let i = 0; i < a.length; i++) if (a[i].alive && a[i].brain !== null) think(c, a[i], dt, tick);
      const b = c.ents.list('boss');
      for (let i = 0; i < b.length; i++) if (b[i].alive && b[i].brain !== null) think(c, b[i], dt, tick);
    },
  };

  const bodySystem = {
    id: 'standin.ai.bodies',
    phase: 'post',
    owner: OWNER,
    /** @param {any} c */
    step(c) {
      const now = c.time.now;
      let w = 0;
      for (let i = 0; i < bodyCount; i++) {
        if (bodyAt[i] <= now) {
          const e = c.ents.get(bodyId[i]);
          spawned.delete(bodyId[i]);
          if (e) {
            c.ents.destroy(e.id);
            emitRemoved(e);
          }
        } else {
          bodyId[w] = bodyId[i];
          bodyAt[w] = bodyAt[i];
          w++;
        }
      }
      bodyCount = w;
    },
  };

  const on = {
    /** @param {any} e actor:died */
    died(e) {
      if ((e.kind !== 'enemy' && e.kind !== 'boss') || !spawned.has(e.entId)) return;
      if (bodyCount < MAX_BODIES) {
        bodyId[bodyCount] = e.entId;
        bodyAt[bodyCount] = ctx.time.now + BODY_SECONDS;
        bodyCount++;
      }
      if (bossEnt && bossEnt.id === e.entId) {
        const bossId = pending || bossEnt.defId;
        bossEnt = null;
        pending = null;
        ctx.bus.emit('boss:end', { bossId, defeated: true });
      }
    },
    /** @param {any} e actor:damaged */
    damaged(e) {
      if (!bossEnt || e.targetId !== bossEnt.id || !pending) return;
      const bd = ctx.defs.find('boss', pending);
      if (!bd || !bossEnt.stats) return;
      const frac = bossEnt.stats.hp / Math.max(1, bossEnt.stats.hpMax);
      while (bossPhase + 1 < bd.phases.length && frac < bd.phases[bossPhase + 1].hpBelow && bossEnt.stats.hp > 0) {
        bossPhase++;
        pPhase.bossId = pending; pPhase.entId = bossEnt.id; pPhase.phase = bossPhase;
        ctx.bus.emit('boss:phase', pPhase);
        const acts = bd.phases[bossPhase].onEnter;
        if (acts && acts.length && ctx.quests) ctx.quests.runActions(acts);
      }
    },
    /** @param {any} e player:respawned */
    respawned(e) {
      for (const kind of ['enemy', 'boss']) {
        for (const ent of ctx.ents.list(kind)) {
          if (!ent.alive || !ent.brain || !ent.brain.standinBrain) continue;
          ent.brain.targetId = 0;
          ent.brain.aggro = false;
          ent.brain.state = 'idle';
          if (ent.stats) ctx.combat.heal(ent, ent.stats.hpMax);
        }
      }
      if (pending && !bossEnt) {
        if (e.retry) ai.startBoss(pending, { skipIntro: true });
      } else if (bossEnt && !e.retry) {
        ai.resetBoss();
      }
    },
    /** @param {any} e player:died */
    playerDied() {
      if (bossEnt) ai.resetBoss();
    },
    ended() {
      reset();
    },
  };

  return { ai, brainSystem, bodySystem, on };
}

/**
 * Install the stand-in ai service under the owner 'standin:ai'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { ai, brainSystem, bodySystem, on } = createAi(ctx);
  ctx.provide('ai', ai, OWNER);
  ctx.systems.add(brainSystem);
  ctx.systems.add(bodySystem);
  ctx.bus.on('actor:died', on.died, OWNER);
  ctx.bus.on('actor:damaged', on.damaged, OWNER);
  ctx.bus.on('player:respawned', on.respawned, OWNER);
  ctx.bus.on('player:died', on.playerDied, OWNER);
  ctx.bus.on('game:ended', on.ended, OWNER);
}
