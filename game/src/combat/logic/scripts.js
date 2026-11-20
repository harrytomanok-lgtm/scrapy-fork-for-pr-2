/**
 * Bespoke technique scripts registered with `combat.registerScript` (ARCHITECTURE 4.9). A script runs every tick
 * of its technique, before the timeline advances, as fn(ctx, ent, def, combatState, rt) where rt is the engine's
 * runtime record (phaseT, entered, craterDone, scratch fields scrX/scrY/scrZ/scrFlag).
 *
 * Ringfall (GDD 5.3 ultimate): rise 11 m with the sigil forming below, hang, dive into the ground, impact ring
 * with falloff, a 20 m crater, the ultimate feel row and a three-shot camera.
 * Pure: no three, no window.
 * @module combat/logic/scripts
 */

import { BALANCE } from '../../core/balance.js';
import { PALETTE } from '../../core/palette.js';

const RF = BALANCE.tech.ringfall;
const F_SIGIL = 1;
const F_DIVE = 2;
const F_IMPACT = 4;
const F_PEAK = 8;

const SHOCK = { radius: 22, seconds: 0.6, color: PALETTE.ora, ground: true, sphere: false };
const BURST = { dirX: 0, dirY: 1, dirZ: 0, color: PALETTE.ora, scale: 1.6 };

/**
 * @param {any} ctx @param {any} ent @param {number} color
 * @returns {object[]} the camera shots of the ultimate (allocated once per cast)
 */
function ringfallShots(ctx, ent, color) {
  void color;
  const yaw = ent.yaw;
  const x = ent.pos.x;
  const y = ent.pos.y;
  const z = ent.pos.z;
  const bx = -Math.sin(yaw);
  const bz = -Math.cos(yaw);
  return [
    // Low and close, looking up as Tavi rises.
    { seconds: 0.95, orbit: { entId: ent.id, dist: 7, height: -0.5, yawFrom: yaw + 2.5, yawTo: yaw + 3.0 }, lookAt: { entId: ent.id, socket: 'chest' }, fov: 56, ease: 'inOut' },
    // Pull back and up as the dive starts: the whole ring is in frame.
    { seconds: 0.55, from: { x: x + bx * 14, y: y + 14, z: z + bz * 14 }, to: { x: x + bx * 22, y: y + 18, z: z + bz * 22 },
      lookAt: { x, y: y + 1, z }, fov: 66, ease: 'out' },
    // Hold on the impact and the crater while the shockwave rolls out.
    { seconds: 0.9, from: { x: x + bx * 22, y: y + 18, z: z + bz * 22 }, to: { x: x + bx * 26, y: y + 15, z: z + bz * 26 },
      lookAt: { x, y, z }, fov: 64, ease: 'inOut' },
  ];
}

/**
 * Ringfall: the ultimate.
 * @param {any} ctx @param {any} ent @param {any} def @param {any} c @param {any} r
 */
export function ringfallScript(ctx, ent, def, c, r) {
  const vfx = ctx.vfx;
  const mv = ctx.move;
  const color = ent.combat && ent.combat.formId ? (ctx.defs.find('form', ent.combat.formId) || { color: PALETTE.ora }).color : PALETTE.ora;
  if (c.state === 'windup') {
    if (r.entered) {
      r.scrFlag = 0;
      r.scrX = ent.pos.x;
      r.scrY = ent.pos.y;
      r.scrZ = ent.pos.z;
      if (vfx) {
        BURST.color = color; BURST.scale = 1.4;
        vfx.burst('ult_rise', ent.pos.x, ent.pos.y + 0.5, ent.pos.z, BURST);
      }
      const cam = ctx.cam;
      if (cam && cam.play && !cam.busy && ctx.player === ent) {
        try {
          const pr = cam.play('combat.ringfall', ringfallShots(ctx, ent, color), { skippable: true, freeze: false });
          if (pr && pr.catch) pr.catch(() => {});
        } catch (e) {
          if (ctx.log) ctx.log.warn('combat', 'ringfall shot failed', String(e));
        }
      }
      return;
    }
    const peakY = r.scrY + (def.motion ? def.motion.dist : 11);
    if (r.techT >= (def.motion ? def.motion.t + def.motion.seconds : 0.55) && mv) {
      // Hang at the peak while the sigil forms.
      mv.dashTo(ent, r.scrX, peakY, r.scrZ, 1 / 60);
      if (!(r.scrFlag & F_PEAK)) r.scrFlag |= F_PEAK;
    }
    if (!(r.scrFlag & F_SIGIL) && r.techT >= 0.45) {
      r.scrFlag |= F_SIGIL;
      if (vfx) {
        const gy = ctx.world ? ctx.world.groundAt(r.scrX, r.scrY + 2, r.scrZ) : r.scrY;
        BURST.color = color; BURST.scale = 2;
        vfx.burst('ult_sigil', r.scrX, gy + 0.2, r.scrZ, BURST);
        SHOCK.radius = RF.radius; SHOCK.seconds = 0.6; SHOCK.color = color; SHOCK.ground = true; SHOCK.sphere = false;
        vfx.shockwave(r.scrX, gy, r.scrZ, SHOCK);
      }
    }
    return;
  }
  if (c.state === 'active') {
    if (!(r.scrFlag & F_DIVE)) {
      r.scrFlag |= F_DIVE;
      const gy = ctx.world ? ctx.world.groundAt(r.scrX, ent.pos.y + 2, r.scrZ) : r.scrY;
      if (mv) mv.dashTo(ent, r.scrX, gy, r.scrZ, 0.22);
      if (vfx) {
        BURST.color = color; BURST.scale = 1.2; BURST.dirY = -1;
        vfx.burst('ult_dive', ent.pos.x, ent.pos.y + 1, ent.pos.z, BURST);
        BURST.dirY = 1;
      }
    }
    if (r.craterDone && !(r.scrFlag & F_IMPACT)) {
      r.scrFlag |= F_IMPACT;
      const x = ent.pos.x;
      const z = ent.pos.z;
      const y = ctx.world ? ctx.world.groundAt(x, ent.pos.y + 2, z) : ent.pos.y;
      if (ctx.fx) ctx.fx.impact('ultimate', x, y, z, 1);
      if (ctx.fx && ctx.fx.flash) ctx.fx.flash(PALETTE.oraCore, 0.55, 0.3);
      if (vfx) {
        SHOCK.radius = RF.radius * 1.2; SHOCK.seconds = 0.8; SHOCK.color = color; SHOCK.ground = true; SHOCK.sphere = false;
        vfx.shockwave(x, y, z, SHOCK);
        SHOCK.radius = 9; SHOCK.seconds = 0.5; SHOCK.sphere = true; SHOCK.ground = false;
        vfx.shockwave(x, y + 1, z, SHOCK);
        BURST.color = color; BURST.scale = 2.4;
        vfx.burst('ult_impact', x, y + 0.5, z, BURST);
        vfx.burst('explosion_l', x, y + 0.5, z, BURST);
      }
    }
  }
}
/**
 * Register the package's scripts.
 * @param {any} combat
 */
export function registerScripts(combat) {
  combat.registerScript('ringfall', ringfallScript);
}
