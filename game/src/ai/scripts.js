/**
 * Scripted enemy and boss moves registered with `combat.registerScript` (ARCHITECTURE 4.9): ground hazards with
 * their own red telegraphs (root lines, rock rain, Spire crystals, ice spears), the Shatterdive rise, the Ora-drain
 * tether, the furrows of the horn charge and the wisp's self-destruct. A script runs every tick of its technique,
 * before the timeline advances, as fn(ctx, ent, def, combatState, rt); `rt.entered` is true on the first tick of the
 * windup and of the active phase. Delayed damage goes through the hazard pool of the ai service.
 * @module ai/scripts
 */

import { SIM_DT } from '../core/constants.js';
import { PALETTE } from '../core/palette.js';

const BURST = { dirX: 0, dirY: 1, dirZ: 0, color: PALETTE.hostile, scale: 1.2 };
const BEAM = { color: PALETTE.telegraph.violet, radius: 0.18, ownerId: 0 };

/**
 * @param {any} ctx
 * @param {{ circle(owner:any, x:number, z:number, radius:number, delay:number, power:number):void,
 *           line(owner:any, x:number, z:number, dirX:number, dirZ:number, length:number, delay:number, power:number):void,
 *           rand():number }} hz  the hazard pool of the service
 */
export function registerAiScripts(ctx, hz) {
  const combat = ctx.combat;
  if (!combat || typeof combat.registerScript !== 'function') return;

  /** @param {any} ent @returns {any} the current target entity */
  const targetOf = (ent) => {
    const id = ent.combat && ent.combat.targetId ? ent.combat.targetId : ent.brain && ent.brain.targetId ? ent.brain.targetId : 0;
    const t = id ? ctx.ents.get(id) : null;
    return t && t.alive ? t : null;
  };
  /** @param {any} def @param {string} k @param {number} d */
  const aiNum = (def, k, d) => (def.ai && typeof def.ai[k] === 'number' ? def.ai[k] : d);
  /** Windup seconds scaled by the difficulty telegraph factor (the same scale combat applies). */
  const tele = (s) => {
    const row = ctx.rpg && ctx.rpg.difficulty === 'story' ? 1.3 : ctx.rpg && ctx.rpg.difficulty === 'master' ? 0.85 : 1;
    return s * row;
  };

  // The wisp dives and bursts.
  combat.registerScript('ai_self_destruct', (c, ent, def, st) => {
    if (st.state !== 'recover') return;
    if (c.vfx) c.vfx.burst('explosion_s', ent.pos.x, ent.pos.y + 0.5, ent.pos.z, BURST);
    c.combat.kill(ent, 0);
  });

  // Choir Caster and Vorrhal: a violet tether drains the target's Ora while it holds.
  combat.registerScript('ai_tether', (c, ent, def, st, r) => {
    if (st.state !== 'active') return;
    const t = targetOf(ent);
    const b = ent.brain;
    if (!t) return;
    const dx = t.pos.x - ent.pos.x;
    const dz = t.pos.z - ent.pos.z;
    const range = aiNum(def, 'maxRange', 30) + 6;
    if (dx * dx + dz * dz > range * range) return;
    if (t.stats && t.stats.ora > 0) c.combat.addOra(t, -aiNum(def, 'drain', 15) * SIM_DT * (c.time.scale || 1));
    if (b && c.vfx && c.vfx.beam) {
      if (!b.beam) {
        BEAM.ownerId = ent.id;
        b.beam = c.vfx.beam(BEAM);
      }
      if (b.beam && b.beam.set) b.beam.set(ent.pos.x, ent.pos.y + ent.height * 0.6, ent.pos.z, t.pos.x, t.pos.y + t.height * 0.55, t.pos.z, 0.18, 1);
    }
    void r;
  });

  // Bramblehorn: three lines of roots burst along the ground toward the target.
  combat.registerScript('ai_root_lines', (c, ent, def, st, r) => {
    if (!(r.entered && st.state === 'windup')) return;
    const t = targetOf(ent);
    let ax = Math.sin(ent.yaw);
    let az = Math.cos(ent.yaw);
    if (t) {
      const dx = t.pos.x - ent.pos.x;
      const dz = t.pos.z - ent.pos.z;
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      ax = dx / l; az = dz / l;
    }
    const power = aiNum(def, 'power', 1.4);
    const wind = tele(def.timeline.windup);
    for (let k = -1; k <= 1; k++) {
      const a = k * 0.42;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const dx = ax * ca - az * sa;
      const dz = az * ca + ax * sa;
      hz.line(ent, ent.pos.x + dx * 3, ent.pos.z + dz * 3, dx, dz, 30, wind, power);
    }
  });

  // Gorrumaw's rock rain and Vorrhal's Spire crystals: red circles around the target.
  combat.registerScript('ai_rain', (c, ent, def, st, r) => {
    if (!(r.entered && st.state === 'active')) return;
    const t = targetOf(ent);
    const cx = t ? t.pos.x : ent.pos.x;
    const cz = t ? t.pos.z : ent.pos.z;
    const n = aiNum(def, 'count', 6);
    const rad = aiNum(def, 'radius', 4);
    const power = aiNum(def, 'power', 1.3);
    for (let i = 0; i < n; i++) {
      // The first lands on the target; the others scatter around it, falling one after another.
      const a = hz.rand() * Math.PI * 2;
      const d = i === 0 ? 0 : 4 + hz.rand() * 12;
      hz.circle(ent, cx + Math.sin(a) * d, cz + Math.cos(a) * d, rad, tele(1.0) + i * 0.14, power);
    }
  });

  // Iskra's ice spears: four red lines converge on the target from four sides.
  combat.registerScript('ai_spears', (c, ent, def, st, r) => {
    if (!(r.entered && st.state === 'active')) return;
    const t = targetOf(ent);
    const cx = t ? t.pos.x : ent.pos.x;
    const cz = t ? t.pos.z : ent.pos.z;
    const power = aiNum(def, 'power', 1.4);
    const rot = hz.rand() * Math.PI * 0.5;
    for (let i = 0; i < 4; i++) {
      const a = rot + i * Math.PI * 0.5;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      hz.line(ent, cx - dx * 22, cz - dz * 22, dx, dz, 26, tele(1.0) + i * 0.1, power);
    }
  });

  // Iskra's Shatterdive: rise high during the windup; the data motion dives onto the marked circle.
  combat.registerScript('ai_shatterdive', (c, ent, def, st, r) => {
    if (r.entered && st.state === 'windup' && c.move) {
      const rise = aiNum(def, 'rise', 60);
      c.move.dashTo(ent, ent.pos.x, ent.pos.y + rise, ent.pos.z, Math.min(1.2, def.timeline.windup * 0.6));
    }
  });

  // Horn charge: furrows torn behind the charge (small craters: decal only, no grid edit).
  combat.registerScript('ai_furrow', (c, ent, def, st, r) => {
    if (st.state !== 'active' || !c.world || !c.world.crater) return;
    r.scrX += 1;
    if (r.scrX % 8 === 0) c.world.crater(ent.pos.x, ent.pos.z, 2.2, 0.3, ent.id);
  });
}
