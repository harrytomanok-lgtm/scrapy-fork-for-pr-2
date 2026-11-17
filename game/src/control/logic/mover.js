/**
 * The kinematic mover for every actor (ARCHITECTURE 4.6). Pure logic: no three, no DOM, no ctx. It runs against a
 * world interface and reports events to a sink, so Node tests drive it with a mock world.
 *
 * World interface: heightAt(x,z), groundAt(x,y,z), slopeAt(x,z), normalAt(x,z,out), edgeFactor(x,z), edgeHard,
 * queryColliders(x,z,r,out) -> n (optional), seaLevel (optional, default 0), ceiling (optional).
 * Sink interface: mode(ent, mode, prev), jump(ent), boost(ent, stage), landed(ent, speed), slam(ent, speed, surface).
 *
 * Feel notes: ground acceleration 40 m/s^2 with a stronger brake and reversal so the hero plants and turns sharply;
 * coyote time and jump buffering; variable jump height for the player (releasing Jump early cuts the rise);
 * weightless flight with exponential damping (6 per s), a softer surge into boost and the sonic stage after 2 s;
 * terrain-hugging flight that never scrapes; hurtle with slam detection on terrain and props.
 * @module control/logic/mover
 */

import { BALANCE } from '../../core/balance.js';
import { angleDelta, wrapAngle } from '../../core/math.js';
import { pushOut, createContact, CFLAG } from './colliders.js';

const M = BALANCE.move;
const SLAM = BALANCE.combat.slam;
const HURTLE = BALANCE.combat.hurtle;

/** Tunables of the mover (values not fixed by the GDD are chosen here). */
export const MOVER = Object.freeze({
  groundAccel: M.groundAccel,
  brakeMult: 1.5,
  reverseMult: 1.8,
  gravity: M.gravity,
  jumpSpeed: M.jumpSpeed,
  jumpCutGravityMult: 2.4,
  walkableSlope: M.walkableSlope,
  groundSnap: M.groundSnap,
  airAccel: 16,
  airDrag: 1.5,
  terminal: 55,
  coyote: 0.1,
  jumpBuffer: 0.12,
  takeOffSpeed: 6,
  flightDamping: M.flightDamping,
  boostSurge: 3.2,
  flightVertical: 0.7,
  sonicAfter: 2,
  autoLand: M.autoLand,
  swimDepth: M.swimDepth,
  swimSpeedMult: 0.55,
  swimSprintMult: 0.85,
  ceiling: M.ceiling,
  ceilingFadeFrom: M.ceilingFadeFrom,
  turnRate: 12,
  flyTurnRate: 7,
  slideAccel: 18,
  uphillSlow: 0.3,
  hardLanding: 24,
  slamSpeed: SLAM.minSpeed,
  hurtleStop: HURTLE.stopSpeed,
  edgePush: 60,
  edgeCarry: 15,
  edgeOvershoot: 8,
  defaultRun: BALANCE.enemyScale.move.run,
  defaultFly: BALANCE.enemyScale.move.fly,
  sprintMult: BALANCE.derived.run.sprintMult,
  sonicMult: BALANCE.derived.boost.sonicMult,
  colliderReach: 2.5,
  hangMaxFall: 3,
});

/** Movement modes in the MoveState union. */
export const MODES = Object.freeze(['ground', 'air', 'fly', 'swim', 'hurtle', 'scripted']);

/**
 * Create a MoveState (ARCHITECTURE 3.5). Every field exists from creation.
 * @param {{ canFly?:boolean, mode?:string }} [opts]
 */
export function createMoveState(opts) {
  const o = opts || {};
  const mode = o.mode === 'fly' || o.mode === 'scripted' ? o.mode : 'ground';
  return {
    mode, grounded: mode === 'ground', groundY: 0, boost: 0, canFly: !!o.canFly, boostAllowed: true, speedMult: 1,
    lockT: 0, noTurnT: 0, gravityScale: 1, hurtleDamage: 0, hurtleSourceId: 0, airT: 0, speed: 0,
  };
}

/** @returns {{ mx:number, mz:number, up:number, jump:boolean, sprint:boolean, flyToggle:boolean, faceYaw:number|null }} */
export function createIntent() {
  return { mx: 0, mz: 0, up: 0, jump: false, sprint: false, flyToggle: false, faceYaw: null };
}

/**
 * Private per-entity mover record.
 * @typedef {{ boostT:number, dashT:number, dashVx:number, dashVy:number, dashVz:number, lockSlow:number, faceYaw:number,
 *   coyoteT:number, bufT:number, jumped:boolean, spin:number, hangT:number, hangScale:number, cols:any[], contact:any, nrm:any }} MoveRec
 */

/** @returns {MoveRec} */
export function createRec() {
  return {
    boostT: 0, dashT: 0, dashVx: 0, dashVy: 0, dashVz: 0, lockSlow: 1, faceYaw: NaN,
    coyoteT: 0, bufT: 0, jumped: false, spin: 0, hangT: 0, hangScale: 1,
    cols: [], contact: createContact(),
    nrm: { x: 0, y: 1, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } },
  };
}

/** Reset the transient parts of a record (teleport, init). @param {MoveRec} r */
export function resetRec(r) {
  r.boostT = 0; r.dashT = 0; r.dashVx = 0; r.dashVy = 0; r.dashVz = 0; r.lockSlow = 1; r.faceYaw = NaN;
  r.coyoteT = 0; r.bufT = 0; r.jumped = false; r.spin = 0; r.hangT = 0; r.hangScale = 1;
}

/* ------------------------------------------------------------------ helpers -- */

/** @param {any} ent @param {any} sink @param {string} mode */
export function setMode(ent, sink, mode) {
  const m = ent.move;
  if (m.mode === mode) return;
  const prev = m.mode;
  m.mode = mode;
  if (sink) sink.mode(ent, mode, prev);
}

/** @param {any} ent @param {any} sink @param {number} stage */
export function setBoost(ent, sink, stage) {
  const m = ent.move;
  if (m.boost === stage) return;
  m.boost = stage;
  if (sink) sink.boost(ent, stage);
}

/** Ground run speed in m/s (before sprint and lock). @param {any} ent */
export function runSpeedOf(ent) {
  const st = ent.stats;
  return (st ? st.runSpeed * st.speedMult : MOVER.defaultRun) * ent.move.speedMult;
}

/** Cruise flight speed. @param {any} ent */
export function flySpeedOf(ent) {
  const st = ent.stats;
  return (st ? st.flySpeed * st.speedMult : MOVER.defaultFly) * ent.move.speedMult;
}

/** Boost speed (stage 1). @param {any} ent */
export function boostSpeedOf(ent) {
  const st = ent.stats;
  return st ? st.boostSpeed * st.speedMult * ent.move.speedMult : flySpeedOf(ent) * 2.5;
}

/** @param {any} ent @param {number} yaw @param {number} rate @param {number} dt */
function turnToward(ent, yaw, rate, dt) {
  const d = angleDelta(ent.yaw, yaw);
  // Exponential approach with a rate cap: quick for small corrections, never a snap for large ones.
  let step = d * (1 - Math.exp(-rate * dt));
  const max = rate * 1.6 * dt;
  if (step > max) step = max;
  else if (step < -max) step = -max;
  if (Math.abs(d) < 1e-4) step = d;
  ent.yaw = wrapAngle(ent.yaw + step);
}

/** @param {any} world */
function seaOf(world) {
  return typeof world.seaLevel === 'number' ? world.seaLevel : 0;
}

/** @param {any} world */
function ceilingOf(world) {
  return typeof world.ceiling === 'number' ? world.ceiling : MOVER.ceiling;
}

/**
 * Land on the ground at height g.
 * @param {any} ent @param {MoveRec} r @param {any} sink @param {number} g
 */
function land(ent, r, sink, g) {
  const m = ent.move;
  const speed = ent.vel.y < 0 ? -ent.vel.y : 0;
  ent.pos.y = g;
  ent.vel.y = 0;
  m.grounded = true;
  m.airT = 0;
  m.gravityScale = 1;
  r.jumped = false;
  r.boostT = 0;
  setBoost(ent, sink, 0);
  setMode(ent, sink, 'ground');
  if (speed > MOVER.hardLanding && m.lockT <= 0) {
    m.lockT = 0.16;
    r.lockSlow = 0.25;
  }
  if (sink) sink.landed(ent, speed);
}

/* ------------------------------------------------------------------ modes -- */

/**
 * Ground and air movement.
 * @param {any} ent @param {MoveRec} r @param {number} dt @param {any} it intent or null @param {any} world @param {any} sink
 */
function stepGround(ent, r, dt, it, world, sink) {
  const m = ent.move;
  const v = ent.vel;
  const p = ent.pos;
  const mx = it ? it.mx : 0;
  const mz = it ? it.mz : 0;
  const up = it ? it.up : 0;
  const sprint = it ? it.sprint : false;
  const lockF = m.lockT > 0 ? r.lockSlow : 1;
  let grounded = m.grounded;
  const speed = runSpeedOf(ent) * lockF * (sprint && grounded ? MOVER.sprintMult : 1);
  let tvx = mx * speed;
  let tvz = mz * speed;
  let steep = false;
  const nrm = r.nrm;

  if (grounded) {
    const slope = world.slopeAt(p.x, p.z);
    if (slope > 0.04) {
      world.normalAt(p.x, p.z, nrm);
      const hl = Math.sqrt(nrm.x * nrm.x + nrm.z * nrm.z);
      if (hl > 1e-5) {
        const dx = nrm.x / hl;
        const dz = nrm.z / hl;
        const along = tvx * dx + tvz * dz; // < 0: moving uphill
        steep = slope > MOVER.walkableSlope;
        if (steep) {
          // No progress uphill on unwalkable ground.
          if (along < 0) { tvx -= along * dx; tvz -= along * dz; }
          const k = MOVER.slideAccel + MOVER.gravity * (slope - MOVER.walkableSlope);
          v.x += dx * k * dt;
          v.z += dz * k * dt;
        } else if (along < 0) {
          const s = 1 - MOVER.uphillSlow * (slope / MOVER.walkableSlope);
          tvx *= s;
          tvz *= s;
        }
      }
    }
    const dvx = tvx - v.x;
    const dvz = tvz - v.z;
    const dl = Math.sqrt(dvx * dvx + dvz * dvz);
    let accel = MOVER.groundAccel;
    const hasInput = mx * mx + mz * mz > 0.0004;
    if (!hasInput) accel *= MOVER.brakeMult;
    else if (tvx * v.x + tvz * v.z < 0) accel *= MOVER.reverseMult;
    if (steep) accel *= 0.25;
    const a = accel * dt;
    if (!steep || hasInput) {
      if (dl <= a) { v.x = tvx; v.z = tvz; } else { v.x += (dvx / dl) * a; v.z += (dvz / dl) * a; }
    }
  } else {
    // Air control: steer toward the stick without bleeding momentum when it is neutral.
    const hasInput = mx * mx + mz * mz > 0.0004;
    if (hasInput) {
      const dvx = tvx - v.x;
      const dvz = tvz - v.z;
      const dl = Math.sqrt(dvx * dvx + dvz * dvz);
      const a = MOVER.airAccel * dt;
      if (dl <= a) { v.x = tvx; v.z = tvz; } else { v.x += (dvx / dl) * a; v.z += (dvz / dl) * a; }
    } else {
      const k = Math.max(0, 1 - MOVER.airDrag * dt * 0.1);
      v.x *= k;
      v.z *= k;
    }
  }

  // Facing follows the wanted direction on the ground, the velocity in the air.
  if (m.noTurnT <= 0 && !(r.faceYaw === r.faceYaw) && !(it && it.faceYaw !== null && it.faceYaw !== undefined)) {
    if (tvx * tvx + tvz * tvz > 0.01) turnToward(ent, Math.atan2(tvx, tvz), MOVER.turnRate, dt);
  }

  // Jump, coyote jump, take-off and the jump buffer.
  const jump = it ? it.jump : false;
  const flyToggle = it ? it.flyToggle : false;
  if ((jump || flyToggle) && m.lockT <= 0) {
    if (flyToggle && m.canFly) {
      takeOff(ent, r, sink);
      return;
    }
    if ((grounded || r.coyoteT > 0) && !steep) {
      v.y = MOVER.jumpSpeed;
      grounded = false;
      m.grounded = false;
      r.coyoteT = 0;
      r.jumped = true;
      p.y += 0.02;
      setMode(ent, sink, 'air');
      if (sink) sink.jump(ent);
    } else if (!grounded && m.canFly) {
      takeOff(ent, r, sink);
      return;
    } else if (!grounded) {
      r.bufT = MOVER.jumpBuffer;
    }
  }

  if (!grounded) {
    let g = MOVER.gravity * m.gravityScale;
    if (r.jumped && v.y > 0 && up <= 0 && ent.kind === 'player') g *= MOVER.jumpCutGravityMult;
    v.y -= g * dt;
    if (v.y < -MOVER.terminal) v.y = -MOVER.terminal;
  }
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;
  const gy = world.groundAt(p.x, p.y, p.z);
  m.groundY = gy;
  if (grounded) {
    if (p.y - gy <= MOVER.groundSnap && v.y <= 0) {
      p.y = gy;
      v.y = 0;
    } else {
      m.grounded = false;
      r.coyoteT = MOVER.coyote;
      setMode(ent, sink, 'air');
    }
  } else if (p.y <= gy) {
    if (v.y <= 0) {
      land(ent, r, sink, gy);
      if (r.bufT > 0 && m.lockT <= 0) {
        r.bufT = 0;
        v.y = MOVER.jumpSpeed;
        m.grounded = false;
        r.jumped = true;
        p.y += 0.02;
        setMode(ent, sink, 'air');
        if (sink) sink.jump(ent);
      }
    } else {
      p.y = gy;
    }
  }
  if (r.coyoteT > 0) r.coyoteT -= dt;
  if (r.bufT > 0) r.bufT -= dt;
  m.airT = m.grounded ? 0 : m.airT + dt;

  // Deep water: swim at the surface.
  const sea = seaOf(world);
  if (p.y < sea - MOVER.swimDepth && world.heightAt(p.x, p.z) < sea - MOVER.swimDepth) enterSwim(ent, r, sink, sea);
}

/** @param {any} ent @param {MoveRec} r @param {any} sink */
function takeOff(ent, r, sink) {
  const m = ent.move;
  m.grounded = false;
  r.boostT = 0;
  r.jumped = false;
  r.coyoteT = 0;
  r.bufT = 0;
  if (ent.vel.y < MOVER.takeOffSpeed) ent.vel.y = MOVER.takeOffSpeed;
  ent.pos.y += 0.05;
  setMode(ent, sink, 'fly');
}

/** @param {any} ent @param {MoveRec} r @param {any} sink @param {number} sea */
function enterSwim(ent, r, sink, sea) {
  const m = ent.move;
  ent.pos.y = sea - MOVER.swimDepth;
  ent.vel.y = 0;
  m.grounded = false;
  r.boostT = 0;
  setBoost(ent, sink, 0);
  setMode(ent, sink, 'swim');
}

/**
 * Swimming at the surface.
 * @param {any} ent @param {MoveRec} r @param {number} dt @param {any} it @param {any} world @param {any} sink
 */
function stepSwim(ent, r, dt, it, world, sink) {
  const m = ent.move;
  const v = ent.vel;
  const p = ent.pos;
  const mx = it ? it.mx : 0;
  const mz = it ? it.mz : 0;
  const lockF = m.lockT > 0 ? r.lockSlow : 1;
  const speed = runSpeedOf(ent) * lockF * (it && it.sprint ? MOVER.swimSprintMult : MOVER.swimSpeedMult);
  const k = 1 - Math.exp(-3.5 * dt);
  v.x += (mx * speed - v.x) * k;
  v.z += (mz * speed - v.z) * k;
  v.y = 0;
  if (m.noTurnT <= 0 && !(r.faceYaw === r.faceYaw) && mx * mx + mz * mz > 0.01) turnToward(ent, Math.atan2(mx, mz), MOVER.turnRate * 0.6, dt);
  p.x += v.x * dt;
  p.z += v.z * dt;
  const sea = seaOf(world);
  p.y = sea - MOVER.swimDepth;
  const gy = world.groundAt(p.x, p.y, p.z);
  m.groundY = gy;
  m.airT = 0;
  if (it && (it.jump || it.flyToggle) && m.canFly && m.lockT <= 0) {
    takeOff(ent, r, sink);
    ent.vel.y = MOVER.takeOffSpeed * 1.4;
    return;
  }
  if (gy > sea - MOVER.swimDepth) {
    p.y = gy;
    m.grounded = true;
    setMode(ent, sink, 'ground');
  }
}

/**
 * Flight with boost stages.
 * @param {any} ent @param {MoveRec} r @param {number} dt @param {any} it @param {any} world @param {any} sink
 */
function stepFly(ent, r, dt, it, world, sink) {
  const m = ent.move;
  const v = ent.vel;
  const p = ent.pos;
  let dx = it ? it.mx : 0;
  let dy = it ? it.up : 0;
  let dz = it ? it.mz : 0;
  const sprint = it ? it.sprint : false;
  const lockF = m.lockT > 0 ? r.lockSlow : 1;
  if (!m.canFly) {
    // Flight revoked mid-air: fall.
    setBoost(ent, sink, 0);
    setMode(ent, sink, 'air');
    return;
  }
  if (sprint && m.boostAllowed && m.lockT <= 0) {
    r.boostT += dt;
    setBoost(ent, sink, r.boostT >= MOVER.sonicAfter ? 2 : 1);
  } else {
    r.boostT = 0;
    setBoost(ent, sink, 0);
  }
  const cruise = flySpeedOf(ent) * lockF;
  const speed = m.boost > 0 ? boostSpeedOf(ent) * lockF * (m.boost === 2 ? MOVER.sonicMult : 1) : cruise;
  if (m.boost > 0 && dx * dx + dz * dz < 0.01 && Math.abs(dy) < 0.1) {
    // Boost with a neutral stick flies along the facing.
    dx = Math.sin(ent.yaw);
    dz = Math.cos(ent.yaw);
  }
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dl > 1) { dx /= dl; dy /= dl; dz /= dl; }
  let ty = dy * speed * (m.boost > 0 ? 1 : MOVER.flightVertical);
  const ceil = ceilingOf(world);
  const fadeFrom = ceil - (MOVER.ceiling - MOVER.ceilingFadeFrom);
  if (p.y > fadeFrom && ty > 0) {
    const f = 1 - (p.y - fadeFrom) / (ceil - fadeFrom);
    ty *= f < 0 ? 0 : f;
  }
  const tx = dx * speed;
  const tz = dz * speed;
  // Speed up with a softer surge into boost; slow down with the flight damping.
  const curSq = v.x * v.x + v.y * v.y + v.z * v.z;
  const wantSq = tx * tx + ty * ty + tz * tz;
  const lambda = wantSq > curSq && m.boost > 0 ? MOVER.boostSurge : MOVER.flightDamping;
  const k = 1 - Math.exp(-lambda * dt);
  v.x += (tx - v.x) * k;
  v.y += (ty - v.y) * k;
  v.z += (tz - v.z) * k;
  const vh2 = v.x * v.x + v.z * v.z;
  if (m.noTurnT <= 0 && !(r.faceYaw === r.faceYaw) && !(it && it.faceYaw !== null && it.faceYaw !== undefined)) {
    if (vh2 > 1) turnToward(ent, Math.atan2(v.x, v.z), MOVER.flyTurnRate, dt);
    else if (dx * dx + dz * dz > 0.01) turnToward(ent, Math.atan2(dx, dz), MOVER.flyTurnRate, dt);
  }
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;
  if (p.y > ceil) {
    p.y = ceil;
    if (v.y > 0) v.y = 0;
  }
  const gy = world.groundAt(p.x, p.y, p.z);
  m.groundY = gy;
  m.grounded = false;
  m.airT += dt;
  const sea = seaOf(world);
  const floor = gy > sea - MOVER.swimDepth ? gy : sea - MOVER.swimDepth;
  if (p.y < floor) {
    // Hug the terrain instead of scraping through it: lift and redirect the velocity along the slope.
    p.y = floor;
    if (v.y < 0) v.y = 0;
  }
  const alt = p.y - gy;
  const descending = v.y < -2 && m.boost === 0;
  const wantsDown = dy < -0.5;
  if ((descending || wantsDown) && alt < MOVER.autoLand && gy > sea - MOVER.swimDepth) {
    land(ent, r, sink, gy);
  } else if ((descending || wantsDown) && p.y <= sea - MOVER.swimDepth + 0.3 && gy <= sea - MOVER.swimDepth) {
    enterSwim(ent, r, sink, sea);
  }
}

/**
 * Ballistic hurtle; slams on a hard impact with terrain.
 * @param {any} ent @param {MoveRec} r @param {number} dt @param {any} world @param {any} sink
 */
function stepHurtle(ent, r, dt, world, sink) {
  const m = ent.move;
  const v = ent.vel;
  const p = ent.pos;
  v.y -= MOVER.gravity * m.gravityScale * dt;
  if (v.y < -MOVER.terminal) v.y = -MOVER.terminal;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;
  r.spin += dt * Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 0.8;
  const gy = world.groundAt(p.x, p.y, p.z);
  m.groundY = gy;
  m.airT += dt;
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const sea = seaOf(world);
  if (p.y <= gy) {
    p.y = gy;
    impact(ent, r, sink, speed, 'terrain');
  } else if (p.y < sea - MOVER.swimDepth && gy < sea - MOVER.swimDepth) {
    endHurtle(ent, r);
    enterSwim(ent, r, sink, sea);
  } else if (speed < MOVER.hurtleStop) {
    endHurtle(ent, r);
    setMode(ent, sink, m.canFly && ent.move.mode === 'hurtle' && isFlyer(ent) ? 'fly' : 'air');
  }
}

/** @param {any} ent */
function isFlyer(ent) {
  return (ent.tags & 2) !== 0;
}

/** @param {any} ent @param {MoveRec} r */
function endHurtle(ent, r) {
  const m = ent.move;
  m.gravityScale = 1;
  m.hurtleDamage = 0;
  m.hurtleSourceId = 0;
  r.spin = 0;
}

/**
 * A hurtling body hit something: slam at or above the threshold, otherwise come down.
 * @param {any} ent @param {MoveRec} r @param {any} sink @param {number} speed @param {'terrain'|'prop'} surface
 */
function impact(ent, r, sink, speed, surface) {
  const m = ent.move;
  if (speed >= MOVER.slamSpeed && sink) sink.slam(ent, speed, surface);
  const slam = speed >= MOVER.slamSpeed;
  endHurtle(ent, r);
  const v = ent.vel;
  // A short skid along the ground keeps the impact readable without a dead stop.
  v.x *= slam ? 0.12 : 0.35;
  v.z *= slam ? 0.12 : 0.35;
  v.y = 0;
  m.grounded = true;
  m.airT = 0;
  if (m.lockT < (slam ? 0.7 : 0.4)) m.lockT = slam ? 0.7 : 0.4;
  r.lockSlow = 0;
  setMode(ent, sink, 'ground');
  if (sink) sink.landed(ent, speed);
}

/**
 * Scripted straight move (dashTo): ignores intent, stops at terrain and solids.
 * @param {any} ent @param {MoveRec} r @param {number} dt @param {any} world
 */
function stepDash(ent, r, dt, world, sink) {
  const m = ent.move;
  const p = ent.pos;
  const step = dt < r.dashT ? dt : r.dashT;
  r.dashT -= step;
  const nx = p.x + r.dashVx * step;
  const nz = p.z + r.dashVz * step;
  let ny = p.y + r.dashVy * step;
  const gy = world.groundAt(nx, ny, nz);
  if (gy > ny + 1.0 && gy > p.y + 1.0) {
    // A wall of terrain: stop short.
    r.dashT = 0;
  } else {
    if (ny < gy) ny = gy;
    p.x = nx; p.y = ny; p.z = nz;
  }
  ent.vel.x = r.dashVx; ent.vel.y = r.dashVy; ent.vel.z = r.dashVz;
  m.groundY = gy;
  if (m.mode === 'ground' && p.y - gy > MOVER.groundSnap) {
    // A dash that leaves the ground (Pursuit, air string lunges) is airborne from that tick on.
    m.grounded = false;
    setMode(ent, sink, 'air');
  }
  if (r.dashT <= 0) {
    ent.vel.x = 0; ent.vel.y = 0; ent.vel.z = 0;
    if (m.mode !== 'fly' && m.mode !== 'scripted') {
      m.grounded = p.y - gy < MOVER.groundSnap;
      if (m.grounded) {
        p.y = gy;
        if (m.mode === 'air') setMode(ent, sink, 'ground');
      }
    }
  }
}

/**
 * Veilstorm push-back toward the island centre.
 * @param {any} ent @param {number} dt @param {any} world @returns {number} the edge factor 0..1
 */
export function edgeStep(ent, dt, world) {
  const p = ent.pos;
  const v = ent.vel;
  const f = world.edgeFactor(p.x, p.z);
  if (f <= 0) return 0;
  const rr = Math.sqrt(p.x * p.x + p.z * p.z) || 1;
  const nx = p.x / rr;
  const nz = p.z / rr;
  const radial = v.x * nx + v.z * nz;
  const hard = world.edgeHard;
  if (rr >= hard) {
    // At the wall: carried back inward, turned around, and never beyond the overshoot.
    const want = -MOVER.edgeCarry;
    if (radial > want) {
      v.x += (want - radial) * nx;
      v.z += (want - radial) * nz;
    }
    if (rr > hard + MOVER.edgeOvershoot) {
      const k = (hard + MOVER.edgeOvershoot) / rr;
      p.x *= k;
      p.z *= k;
    }
    ent.yaw = Math.atan2(-nx, -nz);
  } else if (radial > -MOVER.edgeCarry) {
    v.x -= nx * MOVER.edgePush * f * f * dt * 1.5;
    v.z -= nz * MOVER.edgePush * f * f * dt * 1.5;
  }
  return f;
}

/**
 * Static collider resolution for one actor (3 push-out iterations). A hurtling body hitting a prop at slam speed slams.
 * @param {any} ent @param {MoveRec} r @param {any} world @param {any} sink @returns {boolean} pushed
 */
function collide(ent, r, world, sink) {
  if (typeof world.queryColliders !== 'function') return false;
  const p = ent.pos;
  const n = world.queryColliders(p.x, p.z, ent.radius + MOVER.colliderReach, r.cols);
  if (n <= 0) return false;
  const v = ent.vel;
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const c = r.contact;
  const radius = ent.radius > 0 ? ent.radius : 0.4;
  const height = ent.height > 0 ? ent.height : 1.8;
  const pushed = pushOut(p, v, radius, height, r.cols, n, c);
  if (!pushed) return false;
  const m = ent.move;
  if (c.hit && c.ny > 0.7 && m.mode !== 'fly' && m.mode !== 'hurtle') {
    // Stood on top of a solid: treat as ground.
    if (!m.grounded) {
      m.groundY = p.y;
      land(ent, r, sink, p.y);
    }
  } else if (c.hit && m.mode === 'hurtle') {
    impact(ent, r, sink, speed, 'prop');
  }
  return true;
}

/* ------------------------------------------------------------------ step -- */

/**
 * Advance one actor by one sim step.
 * @param {any} ent entity with move, intent, pos, vel, yaw, radius, height, stats
 * @param {MoveRec} r @param {number} dt @param {any} world @param {any} sink
 * @returns {number} the edge factor at the new position
 */
export function stepActor(ent, r, dt, world, sink) {
  const m = ent.move;
  if (m.lockT > 0) { m.lockT -= dt; if (m.lockT < 0) m.lockT = 0; }
  if (m.noTurnT > 0) { m.noTurnT -= dt; if (m.noTurnT < 0) m.noTurnT = 0; }
  const raw = ent.intent;
  const it = ent.alive !== false && raw && m.mode !== 'scripted' && m.mode !== 'hurtle' ? raw : null;

  if (it && it.faceYaw !== null && it.faceYaw !== undefined && m.noTurnT <= 0) turnToward(ent, it.faceYaw, MOVER.turnRate * 1.5, dt);
  if (r.faceYaw === r.faceYaw) {
    turnToward(ent, r.faceYaw, MOVER.turnRate * 1.5, dt);
    if (Math.abs(angleDelta(ent.yaw, r.faceYaw)) < 1e-3) r.faceYaw = NaN;
  }

  if (r.hangT > 0) stepHang(ent, r, dt);
  if (r.dashT > 0) {
    stepDash(ent, r, dt, world, sink);
    if (collide(ent, r, world, sink) && r.contact.total > 0.05) {
      r.dashT = 0;
    }
  } else {
    switch (m.mode) {
      case 'scripted': break;
      case 'hurtle': stepHurtle(ent, r, dt, world, sink); break;
      case 'fly': stepFly(ent, r, dt, it, world, sink); break;
      case 'swim': stepSwim(ent, r, dt, it, world, sink); break;
      default: stepGround(ent, r, dt, it, world, sink); break;
    }
    if (m.mode !== 'scripted') collide(ent, r, world, sink);
  }
  let f = 0;
  if (m.mode !== 'scripted') f = edgeStep(ent, dt, world);
  if (raw) {
    raw.jump = false;
    raw.flyToggle = false;
  }
  const v = ent.vel;
  m.speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return f;
}

/**
 * Air hang (air strings): while it lasts an airborne body falls with the reduced gravity scale and never faster
 * than MOVER.hangMaxFall, so an attacker stays level with a juggled target. Ends early on landing or a mode change.
 * @param {any} ent @param {MoveRec} r @param {number} dt
 */
function stepHang(ent, r, dt) {
  const m = ent.move;
  r.hangT -= dt;
  const air = m.mode === 'air' && !m.grounded;
  if (!air && r.dashT > 0 && r.hangT > 0 && m.mode !== 'fly') return; // a dash into the air: the hang starts on arrival
  if (r.hangT <= 0 || !air) {
    if (r.hangT <= 0 && air && m.gravityScale === r.hangScale) m.gravityScale = 1;
    r.hangT = 0;
    return;
  }
  m.gravityScale = r.hangScale;
  if (ent.vel.y < -MOVER.hangMaxFall) ent.vel.y = -MOVER.hangMaxFall;
}

/* ------------------------------------------------------------------ commands -- */

/**
 * Hang in the air for a while (air strings, Pursuit). Bodies in the air, or dashing, hang; on the ground it does nothing.
 * @param {any} ent @param {MoveRec} r @param {number} seconds @param {number} gravityScale @param {number} vy vertical speed to take now (NaN keeps it)
 */
export function hang(ent, r, seconds, gravityScale, vy) {
  const m = ent.move;
  if (!(seconds > 0)) {
    // hang(ent, 0) ends a hang early.
    if (r.hangT > 0 && m.gravityScale === r.hangScale) m.gravityScale = 1;
    r.hangT = 0;
    return;
  }
  if (m.mode === 'fly' || m.mode === 'swim' || m.mode === 'hurtle' || m.mode === 'scripted') return;
  if (m.grounded && r.dashT <= 0) return;
  r.hangT = seconds;
  r.hangScale = gravityScale >= 0 && gravityScale <= 1 ? gravityScale : 0.3;
  if (m.mode === 'air' && !m.grounded) m.gravityScale = r.hangScale;
  if (vy === vy && r.dashT <= 0) ent.vel.y = vy;
}

/**
 * Knockback; hurtle makes the body ballistic until it stops or hits something.
 * @param {any} ent @param {MoveRec} r @param {any} sink @param {number} vx @param {number} vy @param {number} vz
 * @param {{ hurtle?:boolean, stun?:number, gravityScale?:number, sourceId?:number, slamDamage?:number }} [o]
 */
export function knock(ent, r, sink, vx, vy, vz, o) {
  const m = ent.move;
  const hurtle = !!(o && o.hurtle);
  ent.vel.x = vx; ent.vel.y = vy; ent.vel.z = vz;
  const stun = o && typeof o.stun === 'number' ? o.stun : 0.3;
  if (m.lockT < stun) m.lockT = stun;
  r.lockSlow = 0;
  r.dashT = 0;
  r.boostT = 0;
  setBoost(ent, sink, 0);
  m.gravityScale = o && typeof o.gravityScale === 'number' ? o.gravityScale : 1;
  if (hurtle) {
    m.hurtleDamage = (o && o.slamDamage) || 0;
    m.hurtleSourceId = (o && o.sourceId) || 0;
    m.grounded = false;
    ent.pos.y += 0.05;
    setMode(ent, sink, 'hurtle');
  } else if (m.mode !== 'fly' && m.mode !== 'swim' && vy > 0) {
    m.grounded = false;
    ent.pos.y += 0.02;
    setMode(ent, sink, 'air');
  }
}

/**
 * Additive velocity (lunges, recoil).
 * @param {any} ent @param {any} sink @param {number} vx @param {number} vy @param {number} vz
 */
export function impulse(ent, sink, vx, vy, vz) {
  const m = ent.move;
  ent.vel.x += vx; ent.vel.y += vy; ent.vel.z += vz;
  if (vy > 0 && m.grounded && m.mode === 'ground') {
    m.grounded = false;
    ent.pos.y += 0.02;
    setMode(ent, sink, 'air');
  }
}

/**
 * Start a straight scripted move.
 * @param {any} ent @param {MoveRec} r @param {number} x @param {number} y @param {number} z @param {number} seconds
 */
export function dashTo(ent, r, x, y, z, seconds) {
  const s = seconds > 1 / 60 ? seconds : 1 / 60;
  r.dashT = s;
  r.dashVx = (x - ent.pos.x) / s;
  r.dashVy = (y - ent.pos.y) / s;
  r.dashVz = (z - ent.pos.z) / s;
}

/**
 * Turn boost off immediately (boost drops to cruise).
 * @param {any} ent @param {MoveRec} r @param {any} sink @param {boolean} on
 */
export function setBoostAllowed(ent, r, sink, on) {
  const m = ent.move;
  m.boostAllowed = !!on;
  if (!on) {
    r.boostT = 0;
    setBoost(ent, sink, 0);
  }
}

/**
 * Soft actor-actor separation on the horizontal plane (pairs with overlapping height ranges).
 * Heavier (wider) bodies move less. Returns the applied correction.
 * @param {any} a @param {any} b @param {number} dt
 */
export function separatePair(a, b, dt) {
  const ra = a.radius > 0 ? a.radius : 0.4;
  const rb = b.radius > 0 ? b.radius : 0.4;
  const ha = a.height > 0 ? a.height : 1.8;
  const hb = b.height > 0 ? b.height : 1.8;
  if (a.pos.y >= b.pos.y + hb || b.pos.y >= a.pos.y + ha) return 0;
  let dx = b.pos.x - a.pos.x;
  let dz = b.pos.z - a.pos.z;
  const min = ra + rb;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return 0;
  let d = Math.sqrt(d2);
  if (d < 1e-4) {
    // Coincident: split along a fixed axis chosen by id so it stays deterministic.
    dx = (a.id & 1) === 0 ? 1 : -1;
    dz = 0;
    d = 1;
  }
  const pen = min - d;
  const soft = pen * Math.min(1, 12 * dt);
  const wa = ra * ra;
  const wb = rb * rb;
  const fixedA = a.move && (a.move.mode === 'scripted' || a.move.mode === 'hurtle');
  const fixedB = b.move && (b.move.mode === 'scripted' || b.move.mode === 'hurtle');
  if (fixedA && fixedB) return 0;
  const shareA = fixedA ? 0 : fixedB ? 1 : wb / (wa + wb);
  const shareB = 1 - shareA;
  const nx = dx / d;
  const nz = dz / d;
  a.pos.x -= nx * soft * shareA;
  a.pos.z -= nz * soft * shareA;
  b.pos.x += nx * soft * shareB;
  b.pos.z += nz * soft * shareB;
  return soft;
}

export { CFLAG };
