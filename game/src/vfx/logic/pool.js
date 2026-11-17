/**
 * Particle pool bookkeeping (ART_UX 3.1): structure-of-arrays storage, densely packed live range [0, live),
 * emission with a live cap (at the cap the oldest particle is replaced), integration and expiry, and the low-tier
 * overdraw cull (farthest and oldest first). Pure and allocation-free after creation; no three, no DOM.
 * @module vfx/logic/pool
 */

/**
 * @typedef {object} ParticlePool
 * @property {number} max   storage size
 * @property {number} cap   live cap (<= max), set per tier
 * @property {number} live  live count; live particles occupy [0, live)
 * @property {Float32Array} px @property {Float32Array} py @property {Float32Array} pz
 * @property {Float32Array} vx @property {Float32Array} vy @property {Float32Array} vz
 * @property {Float32Array} age @property {Float32Array} life @property {Float32Array} s0 @property {Float32Array} s1
 * @property {Float32Array} rot @property {Float32Array} rotV @property {Float32Array} cr @property {Float32Array} cg
 * @property {Float32Array} cb @property {Float32Array} ca @property {Float32Array} drag @property {Float32Array} grav
 * @property {Float32Array} core @property {Float32Array} stretch @property {Float32Array} fadeIn
 * @property {Float32Array} dist @property {Float32Array} area   scratch per particle, kept in sync by kill()
 * @property {Uint8Array} mat @property {Uint8Array} cell @property {Uint8Array} frames
 * @property {Float64Array} born   emission sequence number (larger = younger)
 * @property {() => number} alloc  index of a fresh slot (replaces the oldest at the cap); the caller fills every field
 * @property {(i:number) => void} kill
 * @property {(n:number) => void} setCap
 * @property {(dt:number) => void} step
 * @property {() => number} oldest
 * @property {() => void} clear
 */

/** Float fields moved by kill(). */
const F_FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'rot', 'rotV', 'cr', 'cg', 'cb', 'ca',
  'drag', 'grav', 'core', 'stretch', 'fadeIn', 'dist', 'area'];
const U_FIELDS = ['mat', 'cell', 'frames'];

/**
 * @param {number} max storage size (the highest tier cap)
 * @returns {ParticlePool}
 */
export function createParticlePool(max) {
  /** @type {any} */
  const P = { max, cap: max, live: 0, born: new Float64Array(max) };
  for (const f of F_FIELDS) P[f] = new Float32Array(max);
  for (const f of U_FIELDS) P[f] = new Uint8Array(max);
  const fl = F_FIELDS.map((f) => P[f]);
  const ul = U_FIELDS.map((f) => P[f]);
  let seq = 0;

  P.oldest = function oldest() {
    let best = -1;
    let bs = Infinity;
    for (let i = 0; i < P.live; i++) {
      if (P.born[i] < bs) {
        bs = P.born[i];
        best = i;
      }
    }
    return best;
  };

  P.alloc = function alloc() {
    let i;
    if (P.live < P.cap) i = P.live++;
    else i = P.oldest();
    if (i < 0) return -1;
    P.born[i] = ++seq;
    P.age[i] = 0;
    return i;
  };

  P.kill = function kill(i) {
    const last = P.live - 1;
    if (i < 0 || i > last) return;
    if (i !== last) {
      for (let k = 0; k < fl.length; k++) fl[k][i] = fl[k][last];
      for (let k = 0; k < ul.length; k++) ul[k][i] = ul[k][last];
      P.born[i] = P.born[last];
    }
    P.live = last;
  };

  P.setCap = function setCap(n) {
    P.cap = Math.max(0, Math.min(P.max, n | 0));
    while (P.live > P.cap) P.kill(P.oldest());
  };

  P.step = function step(dt) {
    let i = 0;
    while (i < P.live) {
      const a = P.age[i] + dt;
      if (a >= P.life[i]) {
        P.kill(i);
        continue;
      }
      P.age[i] = a;
      const d = P.drag[i] > 0 ? Math.max(0, 1 - P.drag[i] * dt) : 1;
      P.vx[i] *= d;
      P.vy[i] = P.vy[i] * d - P.grav[i] * dt;
      P.vz[i] *= d;
      P.px[i] += P.vx[i] * dt;
      P.py[i] += P.vy[i] * dt;
      P.pz[i] += P.vz[i] * dt;
      i++;
    }
  };

  P.clear = function clear() {
    P.live = 0;
  };

  return /** @type {ParticlePool} */ (P);
}

/**
 * Overdraw cull (ART_UX 3.1): while the summed screen coverage of the counted particles (`area[i]`, a fraction of
 * the screen; 0 for particles that do not count) exceeds `maxArea`, kill the particle with the highest score
 * (normalised distance + normalised age, plus a term for its share of the coverage so a few huge sprites go before
 * many tiny sparks), at most `limit` per call. `dist[i]` must be filled by the caller.
 * @param {ParticlePool} P
 * @param {number} maxArea
 * @param {number} limit
 * @returns {number} particles removed
 */
export function cullCoverage(P, maxArea, limit) {
  let total = 0;
  let maxD = 1e-6;
  let maxA = 1e-9;
  for (let i = 0; i < P.live; i++) {
    total += P.area[i];
    if (P.area[i] > 0 && P.dist[i] > maxD) maxD = P.dist[i];
    if (P.area[i] > maxA) maxA = P.area[i];
  }
  let removed = 0;
  while (total > maxArea && removed < limit) {
    let best = -1;
    let bs = -Infinity;
    for (let i = 0; i < P.live; i++) {
      if (P.area[i] <= 0) continue;
      const s = P.dist[i] / maxD + P.age[i] / Math.max(1e-6, P.life[i]) + P.area[i] / maxA;
      if (s > bs) {
        bs = s;
        best = i;
      }
    }
    if (best < 0) break;
    total -= P.area[best];
    P.kill(best);
    removed++;
  }
  return removed;
}
