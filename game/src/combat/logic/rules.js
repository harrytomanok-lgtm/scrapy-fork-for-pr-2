/**
 * Pure combat rules (GDD 5.2-5.6, 6.1-6.4): guard geometry and windows, the damage amount, poise, Surge gains,
 * knock classes into velocities, soft-lock scoring, hit-shape tests and capsule sweeps. No state, no services,
 * no allocation: the engine (logic/engine.js) and the Node tests call these.
 * @module combat/logic/rules
 */

import { BALANCE } from '../../core/balance.js';
import * as F from '../../core/formulas.js';

const CB = BALANCE.combat;
const GUARD = BALANCE.tech.guard;
const SURGE = BALANCE.surge;

/** Entity tag bits and kind masks, mirrored from core/ents.js (which imports three); tests assert equality. */
export const TAG = Object.freeze({ GROUNDED_ONLY: 1, FLYER: 2, BOSS: 4, ELITE: 8, QUEST: 16, NO_LOCK: 32, INVULNERABLE: 64, SCRIPTED: 128, DESTRUCTIBLE: 256 });
export const KIND_MASK = Object.freeze({ player: 1, enemy: 2, boss: 4, npc: 8, projectile: 16, pickup: 32, object: 64, ACTORS: 1 | 2 | 4 | 8, HOSTILE_TARGETS: 2 | 4 | 64, ALL: 127 });

/**
 * Does a guard facing `yaw` block a hit travelling along (dirX, dirZ)? The guard covers the frontal `arcDeg`.
 * @param {number} yaw @param {number} dirX @param {number} dirZ @param {number} [arcDeg]
 * @returns {boolean}
 */
export function frontal(yaw, dirX, dirZ, arcDeg = GUARD.arcDeg) {
  const l = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (l < 1e-6) return true;
  const dot = -(Math.sin(yaw) * dirX + Math.cos(yaw) * dirZ) / l;
  return dot >= Math.cos((arcDeg * Math.PI) / 360);
}

/**
 * Perfect guard: Guard pressed at most `window * perfectWindow` seconds before the impact.
 * @param {number} sinceGuardOn seconds since the guard went up
 * @param {number} perfectWindowMult difficulty row perfectWindow
 * @returns {boolean}
 */
export function isPerfectGuard(sinceGuardOn, perfectWindowMult = 1) {
  return sinceGuardOn >= 0 && sinceGuardOn <= GUARD.perfect.window * perfectWindowMult + 1e-9;
}

/**
 * Perfect Flicker: an attack avoided by the invulnerability within `window` seconds of the Flicker's start.
 * @param {number} sinceFlicker @param {number} perfectWindowMult
 * @returns {boolean}
 */
export function isPerfectFlicker(sinceFlicker, perfectWindowMult = 1) {
  return sinceFlicker >= 0 && sinceFlicker <= BALANCE.tech.flicker_step.perfect.window * perfectWindowMult + 1e-9;
}

/**
 * The damage amount of one hit after the formula, guard and perfect guard (GDD 5.2, 5.4).
 * `kind: 'true'` deals `power` as raw HP.
 * @param {{ power:number, rating:number, defense:number, dmgMult:number, defMult:number, crit:boolean, roll:number,
 *           difficultyMult:number, kind:string, blocked:boolean, perfect:boolean }} h
 * @returns {number}
 */
export function hitAmount(h) {
  if (h.blocked && h.perfect) return 0;
  let amount;
  if (h.kind === 'true') amount = Math.max(BALANCE.damage.min, Math.round(h.power));
  else amount = F.damage(h.power, h.rating, h.defense, h.dmgMult, h.defMult, h.crit ? BALANCE.derived.crit.mult : 1, h.roll, h.difficultyMult);
  if (h.blocked) amount = Math.max(BALANCE.damage.min, Math.round(amount * GUARD.blockedMult));
  return amount;
}

/**
 * Surge gained by the attacker for one unblocked hit dealt.
 * @param {'melee'|'ora'|'true'} kind @param {number} surgePct rpg mods surgePct
 * @returns {number}
 */
export function surgeForHit(kind, surgePct) {
  if (kind === 'true') return 0;
  return (kind === 'ora' ? SURGE.oraHit : SURGE.meleeHit) * (1 + surgePct);
}

/**
 * Surge gained by the player for HP lost: +2 per 5% of max HP.
 * @param {number} amount @param {number} hpMax
 * @returns {number}
 */
export function surgeForHpLoss(amount, hpMax) {
  if (!(hpMax > 0) || !(amount > 0)) return 0;
  return (amount / hpMax / SURGE.hpLoss.perPct) * SURGE.hpLoss.gain;
}

/**
 * Surge decay for one step: nothing during the first `afterSeconds` without a gain.
 * @param {number} surge @param {number} idleSeconds @param {number} dt
 * @returns {number} the new Surge
 */
export function surgeDecay(surge, idleSeconds, dt) {
  if (idleSeconds <= SURGE.decay.afterSeconds || surge <= 0) return surge;
  return Math.max(0, surge - SURGE.decay.perSec * dt);
}

/**
 * Poise after a hit. Returns the new poise; a result of 0 from a positive value is a Break.
 * @param {number} poise @param {number} poiseMax @param {number} dmg
 * @returns {number}
 */
export function poiseAfter(poise, poiseMax, dmg) {
  if (!(poiseMax > 0) || !(dmg > 0)) return poise;
  return Math.max(0, poise - dmg);
}

/**
 * Knock class to a velocity (GDD 5.3 knock classes). Writes `out.vx, vy, vz, hurtle, gravityScale, stun`.
 * dir is the unit horizontal direction from the attacker to the target. For 'radial', (rx, rz) is the unit
 * direction from the ring centre to the target.
 * @param {{ kind:string, speed?:number, up?:number }} k
 * @param {number} dirX @param {number} dirZ @param {number} rx @param {number} rz
 * @param {{ boss:boolean, player:boolean }} who
 * @param {{ vx:number, vy:number, vz:number, hurtle:boolean, gravityScale:number, stun:number }} out
 * @returns {boolean} false for 'none'
 */
export function knockVelocity(k, dirX, dirZ, rx, rz, who, out) {
  out.vx = 0; out.vy = 0; out.vz = 0; out.hurtle = false; out.gravityScale = 1; out.stun = 0.3;
  if (!k || k.kind === 'none') return false;
  const kind = k.kind;
  let sp = typeof k.speed === 'number' ? k.speed : 0;
  if (kind === 'push') {
    if (!sp) sp = CB.knock.push[1];
    out.vx = dirX * sp; out.vz = dirZ * sp; out.vy = Math.min(3, 0.6 + sp * 0.15);
    out.stun = 0.18 + sp * 0.025;
  } else if (kind === 'launch') {
    out.vx = dirX * 1.5; out.vz = dirZ * 1.5; out.vy = typeof k.up === 'number' ? k.up : CB.knock.launchUp;
    out.gravityScale = BALANCE.tech.strike_string.juggle.gravityScale;
    out.stun = 1.4;
  } else if (kind === 'smash') {
    if (!sp) sp = CB.knock.smash;
    out.vx = dirX * sp; out.vz = dirZ * sp; out.vy = 3;
    out.stun = 1.0;
  } else if (kind === 'spike') {
    if (!sp) sp = CB.knock.spike;
    out.vx = dirX * 2; out.vz = dirZ * 2; out.vy = -sp;
    out.stun = 1.0;
  } else if (kind === 'radial') {
    if (!sp) sp = CB.knock.radial;
    out.vx = rx * sp; out.vz = rz * sp; out.vy = 5;
    out.stun = 0.9;
  } else {
    return false;
  }
  const horiz = Math.sqrt(out.vx * out.vx + out.vz * out.vz);
  out.hurtle = Math.max(horiz, Math.abs(out.vy) * (kind === 'spike' ? 1 : 0)) >= CB.hurtle.minSpeed;
  if (who.boss) {
    // Bosses stagger in place: a short push only, never launched or hurled.
    const k2 = 0.25;
    out.vx *= k2; out.vz *= k2; out.vy = Math.min(out.vy, 1.5) * (out.vy > 0 ? 1 : 0); out.hurtle = false; out.gravityScale = 1;
    out.stun = Math.min(out.stun, 0.25);
  } else if (who.player) {
    // The player is pushed, never launched or hurled (GDD 6.4): a readable shove.
    out.vx *= 0.45; out.vz *= 0.45; out.vy = Math.min(Math.max(out.vy, 0), 4); out.hurtle = false; out.gravityScale = 1;
    out.stun = Math.min(out.stun, 0.35);
  }
  return true;
}

/**
 * Soft-lock score of a candidate (lower is better), or -1 when it is not eligible (GDD 6.1): within `range` and
 * inside the cone around the aim direction; candidates within `closeRange` are eligible from any angle.
 * @param {number} dx @param {number} dz offset player -> candidate
 * @param {number} aimX @param {number} aimZ unit aim direction
 * @param {number} range @param {number} coneDeg @param {number} [closeRange]
 * @returns {number}
 */
export function softScore(dx, dz, aimX, aimZ, range, coneDeg, closeRange = 6) {
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > range) return -1;
  if (d < 1e-4) return 0;
  const cos = (dx * aimX + dz * aimZ) / d;
  const half = Math.cos((coneDeg * Math.PI) / 360);
  if (cos < half && d > closeRange) return -1;
  // Distance weighted by the angle: straight ahead counts at face value, the cone edge doubles it.
  return d * (2 - Math.max(-1, cos)) + (cos < half ? 30 : 0);
}

/**
 * Horizontal angle (radians, -PI..PI) of a candidate around the player relative to `yaw`; positive = to the right.
 * @param {number} dx @param {number} dz @param {number} yaw
 * @returns {number}
 */
export function relAngle(dx, dz, yaw) {
  const a = Math.atan2(dx, dz) - yaw;
  return Math.atan2(Math.sin(a), Math.cos(a)) * -1;
}

/**
 * Segment parameter t (0..1) of the first contact between a sphere of radius `r` swept from A to B and a vertical
 * capsule (feet at px,py,pz, radius cr, height ch); -1 when they do not touch. Approximation: the capsule is its
 * axis segment and contact is measured at the closest approach.
 * @returns {number}
 */
export function sweepCapsuleT(ax, ay, az, bx, by, bz, r, px, py, pz, cr, ch) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  const cy = py + ch * 0.5;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (cy - ay) * dy + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  const qz = az + dz * t;
  const half = Math.max(0, ch * 0.5 - cr);
  let yy = qy - cy;
  yy = yy > half ? yy - half : yy < -half ? yy + half : 0;
  const ex = qx - px;
  const ez = qz - pz;
  const dist = Math.sqrt(ex * ex + yy * yy + ez * ez);
  const reach = r + cr;
  if (dist > reach) return -1;
  const len = Math.sqrt(len2);
  if (len < 1e-6) return 0;
  // Back off along the segment to the entry point.
  const back = Math.sqrt(Math.max(0, reach * reach - dist * dist)) / len;
  return Math.max(0, t - back);
}

/**
 * Is a point within `pad` metres of a world collider (sphere, capsule, box, disc)? Used for the
 * entity-inside-collider rule of projectile and beam hits (ARCHITECTURE 4.9).
 * @param {{ shape:string, x:number, y:number, z:number, r:number, h:number, hx:number, hz:number, yaw:number }} c
 * @param {number} x @param {number} y @param {number} z @param {number} pad
 * @returns {boolean}
 */
export function nearCollider(c, x, y, z, pad) {
  const dx = x - c.x;
  const dz = z - c.z;
  if (c.shape === 'box') {
    const cs = Math.cos(-c.yaw || 0);
    const sn = Math.sin(-c.yaw || 0);
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    return Math.abs(lx) <= c.hx + pad && Math.abs(lz) <= c.hz + pad && y >= c.y - pad && y <= c.y + (c.h || 1e6) + pad;
  }
  const rr = (c.r || 0) + pad;
  if (dx * dx + dz * dz > rr * rr) return false;
  if (c.shape === 'sphere') return Math.abs(y - c.y) <= rr + 2;
  return y >= c.y - pad - 2 && y <= c.y + (c.h || 1e6) + pad;
}

/**
 * Ringfall-style falloff: `power` at the centre to `edgePower` at `radius`.
 * @param {number} power @param {number} edgePower @param {number} dist @param {number} radius
 * @returns {number}
 */
export function falloffPower(power, edgePower, dist, radius) {
  if (!(radius > 0)) return power;
  const t = Math.max(0, Math.min(1, dist / radius));
  return power + (edgePower - power) * t;
}
