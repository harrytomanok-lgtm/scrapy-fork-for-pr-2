/**
 * Enemy brains (ARCHITECTURE 4.10, 8.7; GDD 6.5-6.7, 7.2): one state machine shared by the five brain kinds,
 * with kind-specific spacing and attack choice.
 *
 *   idle -> alert -> approach -> circle <-> attack -> recover -> circle ...
 *   circle / approach -> skirmish (a ground-only enemy against a hovering target: throw, then disengage)
 *   any -> return (leash, settlement, disengage; heals on arrival) ; low HP -> flee -> regroup -> approach
 *   diver: circle high -> attack (dive) -> recover -> climb -> circle
 *
 * - melee (acolyte, crab, golem, vanguard): orbit at `engage` m, strafe and flank, close in only with a melee token.
 * - charger (boars): orbit wide (12 m) and charge across it.
 * - ranged (wisp, caster): keep the `prefer` band, strafe, fire with a ranged token.
 * - diver (harrier): circle 16 m above the target, dive with a token, climb back.
 * - boss: like melee with the phase weights, no token, shorter gaps.
 *
 * Pure: the service fills a Sense snapshot and an Api adapter, `think` writes the brain outputs (movement, desired
 * altitude, facing, technique to start, guard, heal). Called at 10 Hz; allocation-free.
 * @module ai/logic/brain
 */

/** GDD 6.6 hover rule defaults (BALANCE.combat.hover). */
export const HOVER_RULE = { height: 12, seconds: 6 };
/** A target this far above a ground-only enemy is out of its reach (throw instead). */
const OUT_OF_REACH = 2.5;

/**
 * @typedef {{ id:string, min:number, max:number, weight:number, cooldown:number, token:'melee'|'ranged',
 *   vsAir:boolean, airOnly:boolean, alone:boolean }} TechEntry
 */

/**
 * The per-think sensed snapshot (one shared object, filled by the service).
 * @returns {object}
 */
export function createSense() {
  return {
    now: 0, dt: 0.1,
    x: 0, y: 0, z: 0, alt: 0, hpFrac: 1, busy: false, flyer: false, groundOnly: true,
    hasTarget: false, tx: 0, ty: 0, tz: 0, tAir: false, tThreat: false, dist: 0, dy: 0,
    homeDist: 0, homeDx: 0, homeDz: 0,
    allies: 0, allyDist: 0, allyDx: 0, allyDz: 0,
    sepX: 0, sepZ: 0, inSettlement: false,
  };
}

/**
 * Build the technique entries of an enemy from its technique defs.
 * @param {string[]} ids @param {(id:string) => any} find  technique lookup
 * @returns {TechEntry[]}
 */
export function techEntries(ids, find) {
  const out = [];
  for (const id of ids) {
    const d = find(id);
    const a = (d && d.ai) || {};
    out.push({
      id, min: a.minRange || 0, max: typeof a.maxRange === 'number' ? a.maxRange : 3, weight: typeof a.weight === 'number' ? a.weight : 1,
      cooldown: a.cooldown || 2, token: a.token === 'ranged' ? 'ranged' : 'melee', vsAir: !!a.vsAir, airOnly: !!a.airOnly, alone: !!a.alone,
    });
  }
  return out;
}

/**
 * Create a brain.
 * @param {'melee'|'charger'|'ranged'|'diver'|'boss'} kind
 * @param {any} params EnemyDef.params
 * @param {TechEntry[]} techs
 * @param {{ x:number, y:number, z:number }} home
 * @param {{ passive?:boolean, aggro?:boolean, leash?:number, flyer?:boolean, seed?:number, hover?:{ height:number, seconds:number } }} [opts]
 */
export function createBrain(kind, params, techs, home, opts) {
  const p = params || {};
  const o = opts || {};
  const weights = new Float64Array(techs.length);
  for (let i = 0; i < techs.length; i++) weights[i] = techs[i].weight;
  return {
    aiBrain: true,
    kind,
    state: 'idle',
    stateT: 0,
    targetId: 0,
    passive: !!o.passive,
    aggro: !!o.aggro,
    flyer: !!o.flyer,
    sight: p.sight || 45,
    leash: typeof o.leash === 'number' ? o.leash : p.leash || 80,
    engage: p.engage || (kind === 'ranged' ? 18 : kind === 'charger' ? 12 : 6),
    preferMin: p.prefer ? p.prefer[0] : 1.5,
    preferMax: p.prefer ? p.prefer[1] : 3,
    strafe: typeof p.strafe === 'number' ? p.strafe : 0.5,
    guardChance: p.guardChance || 0,
    fleeHp: p.fleeHp || 0,
    hover: typeof p.hover === 'number' ? p.hover : 4,
    boltDodge: p.boltDodge || 0,
    hoverRule: o.hover || HOVER_RULE,
    homeX: home.x, homeY: home.y, homeZ: home.z,
    techs,
    weights,
    tech: -1,
    nextAttackT: 0,
    strafeDir: (o.seed || 0) % 2 === 0 ? 1 : -1,
    strafeT: 1 + ((o.seed || 0) % 5) * 0.4,
    hoverT: 0,
    ignoreT: 0,
    coverHeal: false,
    fled: false,
    guardT: 0,
    guardRolled: false,
    wanderX: home.x, wanderZ: home.z, wanderT: 0,
    // outputs
    mx: 0, mz: 0, wantY: NaN, face: false, act: /** @type {string|null} */ (null), guard: false, heal: false, drop: false, alertAllies: false,
    // service-private fields
    origin: 0, campId: /** @type {string|null} */ (null), introT: 0, fleeKill: 0, beam: /** @type {any} */ (null), dodgeShot: 0, tokenKind: 0,
  };
}

/** @param {any} b @param {string} st */
function enter(b, st) {
  b.state = st;
  b.stateT = 0;
}

/** Steering output. @param {any} b @param {number} dx @param {number} dz @param {number} speed @param {any} s */
function steer(b, dx, dz, speed, s) {
  let x = dx * speed + s.sepX;
  let z = dz * speed + s.sepZ;
  const l = Math.sqrt(x * x + z * z);
  if (l > 1) { x /= l; z /= l; }
  b.mx = x;
  b.mz = z;
}

/** Unit vector from self to target (horizontal) into TMP. */
const DIR = { x: 0, z: 1 };
function toTarget(s) {
  const dx = s.tx - s.x;
  const dz = s.tz - s.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l > 1e-4) { DIR.x = dx / l; DIR.z = dz / l; } else { DIR.x = 0; DIR.z = 1; }
  return DIR;
}

/**
 * Orbit the target at `radius`: radial correction plus tangential strafe.
 * @param {any} b @param {any} s @param {number} radius @param {number} speed
 */
function orbit(b, s, radius, speed) {
  const d = toTarget(s);
  const err = s.dist - radius;
  const radial = Math.max(-1, Math.min(1, err / 3));
  const tan = b.strafe * b.strafeDir;
  steer(b, d.x * radial - d.z * tan, d.z * radial + d.x * tan, speed, s);
}

/** Is the entry usable now against this target? */
function eligible(b, i, s, api, prospective) {
  const t = b.techs[i];
  if (!(b.weights[i] > 0)) return false;
  const outOfReach = s.groundOnly && s.tAir && s.dy > OUT_OF_REACH;
  if (outOfReach && !t.vsAir) return false;
  if (t.airOnly && !outOfReach) return false;
  if (t.alone && s.allies > 0) return false;
  if (prospective) {
    const reach = t.token === 'melee' && b.kind !== 'ranged' && b.kind !== 'diver' ? b.engage + 8 : 6;
    if (s.dist > t.max + reach || s.dist < t.min - 6) return false;
  } else if (s.dist > t.max || s.dist < t.min) {
    return false;
  }
  return api.ready(t.id);
}

/**
 * Weighted pick among the eligible techniques. Returns the index or -1.
 * @param {any} b @param {any} s @param {any} api @param {boolean} prospective
 */
export function pickTech(b, s, api, prospective) {
  let total = 0;
  for (let i = 0; i < b.techs.length; i++) if (eligible(b, i, s, api, prospective)) total += b.weights[i];
  if (total <= 0) return -1;
  let r = api.rand() * total;
  for (let i = 0; i < b.techs.length; i++) {
    if (!eligible(b, i, s, api, prospective)) continue;
    r -= b.weights[i];
    if (r < 0) return i;
  }
  return -1;
}

/** Desired altitude of a flyer. */
function flyY(b, s) {
  if (!b.flyer) return NaN;
  const gy = s.y - s.alt;
  let y = gy + b.hover;
  if (s.hasTarget && b.state !== 'return' && b.state !== 'flee') {
    if (b.kind === 'diver') y = Math.max(y, s.ty + b.hover);
    else y = Math.max(y, s.ty + (b.kind === 'ranged' ? 2.5 : 0.8));
  }
  return y;
}

/** Try to start an attack from the circle. */
function tryAttack(b, s, api) {
  if (s.now < b.nextAttackT || s.busy) return false;
  const i = pickTech(b, s, api, true);
  if (i < 0) {
    b.nextAttackT = s.now + 0.5;
    return false;
  }
  const tk = b.techs[i].token;
  if (b.kind !== 'boss' && !api.request(tk)) {
    b.nextAttackT = s.now + 0.35 + api.rand() * 0.5;
    return false;
  }
  b.tech = i;
  enter(b, 'attack');
  return true;
}

/** End of an attack: give the token back and wait a beat. */
function afterAttack(b, s, api) {
  api.release();
  b.tech = -1;
  const gap = b.kind === 'boss' ? 0.5 + api.rand() * 0.9 : 1.0 + api.rand() * 1.4;
  b.nextAttackT = s.now + gap;
  enter(b, b.kind === 'diver' ? 'climb' : 'circle');
}

/**
 * One think of a brain.
 * @param {any} b brain @param {any} s Sense @param {{ rand():number, ready(id:string):boolean, request(kind:string):boolean, release():void }} api
 */
export function think(b, s, api) {
  const dt = s.dt;
  b.stateT += dt;
  b.act = null;
  b.heal = false;
  b.drop = false;
  b.alertAllies = false;
  b.face = false;
  b.mx = 0;
  b.mz = 0;
  if (b.ignoreT > 0) b.ignoreT -= dt;
  if (b.guardT > 0) {
    b.guardT -= dt;
    b.guard = b.guardT > 0;
  } else {
    b.guard = false;
  }
  if (b.passive) {
    b.state = 'idle';
    b.wantY = flyY(b, s);
    return;
  }

  // Leash and settlement safety: give up and walk home.
  if (b.state !== 'return' && b.state !== 'idle' && (s.homeDist > b.leash || s.inSettlement)) {
    api.release();
    b.drop = true;
    b.ignoreT = 3;
    enter(b, 'return');
  }
  // Lost the target.
  if (!s.hasTarget && b.state !== 'idle' && b.state !== 'return') {
    api.release();
    enter(b, s.homeDist > 4 ? 'return' : 'idle');
  }

  // GDD 6.6: a target hovering high above a ground-only enemy for 6 s makes it disengage and heal.
  if (s.hasTarget && s.groundOnly && b.kind !== 'boss') {
    if (s.tAir && s.dy > b.hoverRule.height) b.hoverT += dt;
    else b.hoverT = Math.max(0, b.hoverT - dt * 2);
    if (b.hoverT >= b.hoverRule.seconds && b.state !== 'return') {
      api.release();
      b.drop = true;
      b.coverHeal = true;
      b.ignoreT = 1e9;
      b.hoverT = 0;
      enter(b, 'return');
    }
  }

  // Flee once when badly hurt.
  if (s.hasTarget && b.fleeHp > 0 && !b.fled && s.hpFrac < b.fleeHp && b.state !== 'return') {
    b.fled = true;
    api.release();
    enter(b, 'flee');
  }

  if (b.strafeT > 0) b.strafeT -= dt;
  if (b.strafeT <= 0) {
    b.strafeDir = api.rand() < 0.5 ? -1 : 1;
    b.strafeT = 1.6 + api.rand() * 2.4;
  }

  switch (b.state) {
    case 'idle': {
      if (s.hasTarget) {
        b.alertAllies = true;
        enter(b, 'alert');
        b.face = true;
        break;
      }
      // Wander around home.
      b.wanderT -= dt;
      if (b.wanderT <= 0) {
        const a = api.rand() * Math.PI * 2;
        const r = 2 + api.rand() * 6;
        b.wanderX = b.homeX + Math.sin(a) * r;
        b.wanderZ = b.homeZ + Math.cos(a) * r;
        b.wanderT = 3 + api.rand() * 4;
      }
      const wx = b.wanderX - s.x;
      const wz = b.wanderZ - s.z;
      const wl = Math.sqrt(wx * wx + wz * wz);
      if (wl > 1) steer(b, wx / wl, wz / wl, 0.3, s);
      break;
    }
    case 'alert':
      b.face = true;
      if (b.stateT >= 0.4) enter(b, 'approach');
      break;
    case 'approach': {
      b.face = s.dist < 20;
      const d = toTarget(s);
      if (s.groundOnly && s.tAir && s.dy > OUT_OF_REACH && b.kind !== 'boss') {
        enter(b, 'skirmish');
        break;
      }
      const band = b.kind === 'ranged' ? b.preferMax : b.engage + 1;
      if (s.dist <= band) {
        enter(b, 'circle');
        break;
      }
      steer(b, d.x, d.z, 1, s);
      break;
    }
    case 'circle': {
      b.face = true;
      if (s.groundOnly && s.tAir && s.dy > OUT_OF_REACH && b.kind !== 'boss') {
        enter(b, 'skirmish');
        break;
      }
      if (b.kind === 'ranged') {
        const mid = (b.preferMin + b.preferMax) * 0.5;
        orbit(b, s, mid, 0.7);
      } else if (b.kind === 'diver') {
        orbit(b, s, b.engage, 0.8);
      } else {
        orbit(b, s, b.engage, s.dist > b.engage + 6 ? 1 : 0.55);
      }
      if (b.guardChance > 0 && s.tThreat && s.dist < 5) {
        if (!b.guardRolled) {
          b.guardRolled = true;
          if (api.rand() < b.guardChance) {
            b.guardT = 0.8;
            b.guard = true;
          }
        }
      } else if (!s.tThreat) {
        b.guardRolled = false;
      }
      if (!b.guard) tryAttack(b, s, api);
      break;
    }
    case 'skirmish': {
      // Stand off under the flyer and throw.
      b.face = true;
      if (!(s.tAir && s.dy > OUT_OF_REACH)) {
        enter(b, 'approach');
        break;
      }
      orbit(b, s, 9, 0.6);
      tryAttack(b, s, api);
      break;
    }
    case 'attack': {
      b.face = true;
      const t = b.tech >= 0 ? b.techs[b.tech] : null;
      if (!t || b.stateT > 3.5) {
        afterAttack(b, s, api);
        break;
      }
      const d = toTarget(s);
      if (s.dist > t.max * 0.9) steer(b, d.x, d.z, 1, s);
      else if (s.dist < t.min) steer(b, -d.x, -d.z, 0.8, s);
      if (s.dist <= t.max && s.dist >= t.min && !s.busy && api.ready(t.id)) b.act = t.id;
      break;
    }
    case 'recover': {
      b.face = true;
      if (!s.busy && b.stateT > 0.15) afterAttack(b, s, api);
      break;
    }
    case 'climb': {
      b.face = true;
      const d = toTarget(s);
      steer(b, -d.x, -d.z, 0.5, s);
      if (b.stateT > 1.2) enter(b, 'circle');
      break;
    }
    case 'flee': {
      const d = toTarget(s);
      steer(b, -d.x, -d.z, 1, s);
      if (b.stateT > 3) enter(b, 'regroup');
      break;
    }
    case 'regroup': {
      if (s.allies > 0 && s.allyDist > 6) steer(b, s.allyDx, s.allyDz, 1, s);
      else if (s.homeDist > 4) steer(b, s.homeDx, s.homeDz, 0.8, s);
      if (b.stateT > 2.5 || (s.allies > 0 && s.allyDist <= 6)) enter(b, 'approach');
      break;
    }
    case 'return': {
      if (s.homeDist < 3) {
        // Back at its post: full HP (after a leash, a settlement or the hover disengage alike).
        b.heal = true;
        b.coverHeal = false;
        enter(b, 'idle');
        break;
      }
      steer(b, s.homeDx, s.homeDz, 0.85, s);
      break;
    }
    default:
      enter(b, 'idle');
  }
  b.wantY = flyY(b, s);
}

/**
 * The service started the brain's technique: the brain waits for it to end.
 * @param {any} b
 */
export function started(b) {
  b.state = 'recover';
  b.stateT = 0;
}
