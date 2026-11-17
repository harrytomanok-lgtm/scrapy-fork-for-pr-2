/**
 * The feel service `ctx.fx` (ARCHITECTURE 4.15, ART_UX section 4 and 3.1).
 *
 * `fx.impact(classId, x, y, z, scale)` applies one FEEL row: hit-stop, camera shake and FOV kick (scaled by the
 * shake setting and Reduced Motion), slow motion, vibration and rumble, then emits `fx:impact`. The standard
 * cases are automatic through the event catalog, so packages never call it for them.
 * Flash safety: `fx.flash` is the budgeted path to `render.flash` (at most 3 flashes start per second with
 * alpha <= 0.4; Photosensitivity mode 2 and 0.25; over-budget requests are dropped). `createFlashBudget` is
 * exported so the gfx package's own `render.flash` can apply the same limiter.
 * @module core/fx
 */

import { FEEL, FEEL_RULES } from './feel.js';

/** Flash budget of ART_UX 3.1, per one-second window. */
export const FLASH_BUDGET = Object.freeze({
  normal: Object.freeze({ count: 3, alpha: 0.4 }),
  photosensitive: Object.freeze({ count: 2, alpha: 0.25 }),
  window: 1,
});

/** FOV return time (seconds) when a held kick is released. */
const RELEASE_SECONDS = 0.25;
/** A held beam kick is released when no `beamTick` arrived for this many seconds of sim time. */
const BEAM_IDLE = 0.2;

/**
 * @typedef {object} FlashBudget
 * @property {(alpha:number, now:number, photosensitive:boolean) => number}
 *   request  the alpha to show (clamped), or 0 when the request is dropped; `now` in seconds
 * @property {() => void} reset
 */

/**
 * Sliding one-second window limiter for full-screen flashes. Allocation-free.
 * @returns {FlashBudget}
 */
export function createFlashBudget() {
  const starts = new Float64Array(FLASH_BUDGET.normal.count);
  let n = 0;
  return {
    request(alpha, now, photosensitive) {
      if (!(alpha > 0)) return 0;
      const rule = photosensitive ? FLASH_BUDGET.photosensitive : FLASH_BUDGET.normal;
      let live = 0;
      for (let i = 0; i < n; i++) if (now - starts[i] < FLASH_BUDGET.window) starts[live++] = starts[i];
      n = live;
      if (n >= rule.count) return 0;
      starts[n++] = now;
      return alpha > rule.alpha ? rule.alpha : alpha;
    },
    reset() {
      n = 0;
    },
  };
}

/**
 * @typedef {object} Fx
 * @property {(classId:string, x?:number, y?:number, z?:number, scale?:number) => void} impact
 * @property {(color:number, alpha:number, seconds:number) => boolean} flash  budgeted `render.flash`; false when dropped
 * @property {FlashBudget} flashBudget
 * @property {() => void} dispose
 */

/**
 * Create the feel service and subscribe it to the standard events (owner 'core.fx').
 * It also registers the frame system `core.fx` (phase `camera`, order -50) that settles and releases held FOV kicks.
 * @param {any} ctx  read at call time: time, cam, input, combat, player, save, render, bus, log
 * @returns {Fx}
 */
export function createFx(ctx) {
  const OWNER = 'core.fx';
  const budget = createFlashBudget();
  /** Reused `fx:impact` payload (pooled event: listeners never retain it). */
  const payload = { classId: '', x: 0, y: 0, z: 0, scale: 1 };
  const warned = new Set();
  /** Pending settle of a held kick (sonicBoom): target degrees and sim time, or settleAt < 0. */
  let settleAt = -1;
  let settleDeg = 0;
  /** True while the beam kick is held; released after BEAM_IDLE without ticks. */
  let beamHeld = false;
  let beamLast = 0;
  /** True while a boost kick is held; released by `move:boost` stage 0. */
  let boostHeld = false;

  function settings() {
    return (ctx.save && ctx.save.settings) || null;
  }

  function playerId() {
    return ctx.player ? ctx.player.id : 0;
  }

  /** @param {number} deg @param {number} seconds @param {boolean} hold */
  function kick(deg, seconds, hold) {
    const cam = ctx.cam;
    if (cam) cam.fovKick(deg, seconds, hold);
  }

  /** @param {string} classId @param {number} x @param {number} y @param {number} z @param {number} scale */
  function impact(classId, x = 0, y = 0, z = 0, scale = 1) {
    const row = /** @type {any} */ (FEEL)[classId];
    if (!row) {
      if (!warned.has(classId)) {
        warned.add(classId);
        if (ctx.log) ctx.log.warn('fx', 'unknown feel class', classId);
      }
      return;
    }
    const s = settings();
    const reduced = !!(s && s.reducedMotion);
    const shakeSetting = s && typeof s.shake === 'number' ? s.shake : 1;
    const time = ctx.time;
    if (row.hitStop > 0) time.hitStop(row.hitStop);
    if (row.shake > 0 && ctx.cam) {
      const k = reduced ? Math.min(shakeSetting, FEEL_RULES.reducedMotion.shake) : shakeSetting;
      if (k > 0) ctx.cam.shake(row.shake * scale * k);
    }
    if (row.fov !== 0) {
      const deg = row.fov * (reduced ? FEEL_RULES.reducedMotion.fov : 1);
      kick(deg, row.fovSeconds, row.fovHold);
      if (row.fovHold) {
        if (classId === 'beamTick') {
          beamHeld = true;
          beamLast = time.real;
        } else {
          boostHeld = true;
        }
      }
      if (row.fovSettle !== 0) {
        settleAt = time.real + row.fovSeconds;
        settleDeg = row.fovSettle * (reduced ? FEEL_RULES.reducedMotion.fov : 1);
      }
    }
    const inCombat = !!(ctx.combat && ctx.combat.inCombat);
    if (row.slowSeconds > 0 && !(classId === 'levelUp' && inCombat)) time.slowMo(row.slowScale, row.slowSeconds);
    const input = ctx.input;
    if (input) {
      const v = row.vibrate;
      if (typeof v === 'number' ? v > 0 : v.length > 0) input.vibrate(v);
      input.rumble(row.rumble[0], row.rumble[1], row.rumble[2]);
    }
    payload.classId = classId;
    payload.x = x;
    payload.y = y;
    payload.z = z;
    payload.scale = scale;
    ctx.bus.emit('fx:impact', payload);
  }

  /** @param {any} p combat:hit */
  function onHit(p) {
    const pid = playerId();
    if (!pid) return;
    if (p.targetId === pid) {
      const ent = ctx.player;
      const hpMax = ent && ent.stats ? ent.stats.hpMax : 0;
      impact(hpMax > 0 && p.amount >= FEEL_RULES.hurtHeavyFraction * hpMax ? 'hurtHeavy' : 'hurtLight', p.x, p.y, p.z, 1);
    } else if (p.attackerId === pid && p.class) {
      impact(p.class, p.x, p.y, p.z, 1);
    }
  }

  /** @param {number} entId @returns {boolean} */
  function isPlayer(entId) {
    const pid = playerId();
    return pid !== 0 && entId === pid;
  }

  /** @param {number} entId @param {string} classId */
  function atEntity(entId, classId) {
    const e = ctx.ents.get(entId);
    if (e) impact(classId, e.pos.x, e.pos.y, e.pos.z, 1);
    else impact(classId, 0, 0, 0, 1);
  }

  const bus = ctx.bus;
  const offs = [
    bus.on('combat:hit', onHit, OWNER),
    bus.on('combat:perfect', (p) => {
      if (isPlayer(p.entId)) atEntity(p.entId, p.kind === 'flicker' ? 'perfectFlicker' : 'perfectGuard');
    }, OWNER),
    bus.on('combat:flicker', (p) => {
      if (isPlayer(p.entId)) impact('flicker', p.toX, p.toY, p.toZ, 1);
    }, OWNER),
    bus.on('move:boost', (p) => {
      if (!isPlayer(p.entId)) return;
      if (p.stage === 1) atEntity(p.entId, 'boostStart');
      else if (p.stage === 2) atEntity(p.entId, 'sonicBoom');
      else if (boostHeld) {
        boostHeld = false;
        settleAt = -1;
        kick(0, RELEASE_SECONDS, false);
      }
    }, OWNER),
    bus.on('actor:slam', (p) => impact('wallSlam', p.x, p.y, p.z, 1), OWNER),
    bus.on('combat:form', (p) => {
      if (isPlayer(p.entId) && p.formId) atEntity(p.entId, 'transform');
    }, OWNER),
    bus.on('boss:end', (p) => {
      if (!p.defeated) return;
      const boss = ctx.ai && ctx.ai.boss;
      if (boss) impact('bossDeath', boss.pos.x, boss.pos.y, boss.pos.z, 1);
      else if (ctx.player) atEntity(ctx.player.id, 'bossDeath');
      else impact('bossDeath', 0, 0, 0, 1);
    }, OWNER),
    bus.on('rpg:levelUp', () => {
      if (ctx.player) atEntity(ctx.player.id, 'levelUp');
      else impact('levelUp', 0, 0, 0, 1);
    }, OWNER),
    bus.on('actor:landed', (p) => {
      if (isPlayer(p.entId) && p.speed > FEEL_RULES.landHeavySpeed) impact('landHeavy', p.x, p.y, p.z, 1);
    }, OWNER),
    bus.on('world:crater', (p) => {
      if (p.radius >= FEEL_RULES.craterBigRadius) impact('craterBig', p.x, p.y, p.z, 1);
    }, OWNER),
    bus.on('game:ended', () => {
      settleAt = -1;
      beamHeld = false;
      boostHeld = false;
      budget.reset();
    }, OWNER),
  ];

  ctx.systems.add({
    id: 'core.fx',
    phase: 'camera',
    order: -50,
    owner: OWNER,
    /** @param {any} c */
    frame(c) {
      const now = c.time.real;
      if (settleAt >= 0 && now >= settleAt) {
        settleAt = -1;
        if (boostHeld) kick(settleDeg, RELEASE_SECONDS, true);
      }
      if (beamHeld && now - beamLast > BEAM_IDLE) {
        beamHeld = false;
        kick(0, RELEASE_SECONDS, false);
      }
    },
  });

  return {
    impact,
    flashBudget: budget,
    flash(color, alpha, seconds) {
      const s = settings();
      const a = budget.request(alpha, ctx.time.real, !!(s && s.photosensitive));
      if (a <= 0 || !ctx.render) return false;
      ctx.render.flash(color, a, seconds);
      return true;
    },
    dispose() {
      for (const off of offs) off();
      ctx.systems.removeOwner(OWNER);
    },
  };
}
