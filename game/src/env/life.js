/**
 * Ambient life (world pass): what moves in the world besides the player and the enemies. Five instanced meshes,
 * each one draw call when anything of it is in view, updated in the frame phase without allocations:
 * - birds: flocks circling over the land by day (gulls on the Coast, dark swifts inland, none at night or high in
 *   the Frostspine), flapping by flipping the wing dihedral through the instance matrix;
 * - motes around the player: butterflies over the flowers by day, drifting seeds in the Meadows and the Stormwell,
 *   blowing sand in the Rustdune, falling snow in the Frostspine, rising crystal motes at the Spire;
 * - fireflies at night (emissive) in the Meadows, the Thornwood, the Coast and the Stormwell;
 * - fish rings: rings that spread on open water near the camera and sink away;
 * - chimney smoke: puffs rising and leaning with the wind from the settlement chimneys and camp fires.
 * Visual only (rng-free hashes of time and index): no simulation state, no colliders.
 * @module env/life
 */

import { BufferGeometry, BufferAttribute, InstancedMesh, InstancedBufferAttribute, Color, DynamicDrawUsage } from 'three';
import { PALETTE } from '../core/palette.js';

const BIRDS = 36;
const FLOCKS = 3;
const MOTES = 160;
const FLIES = 48;
const RINGS = 10;
const PUFFS = 112;
const PUFF_LIFE = 5;

/** @param {number} i @param {number} k @returns {number} 0..1 */
function h01(i, k) {
  let x = (i * 374761393 + k * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** @param {number[]} p @param {number[]} c */
function geo(p, c) {
  const g = new BufferGeometry();
  const n = new Float32Array(p.length);
  for (let i = 0; i < n.length; i += 3) n[i + 1] = 1;
  g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
  g.setAttribute('normal', new BufferAttribute(n, 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(c), 3));
  g.computeBoundingSphere();
  return g;
}

/** A bird or a butterfly: a small body and two wings whose tips lift with +y scale (flap by scaling y). */
function wingGeometry() {
  const p = [];
  const c = [];
  const tri = (a, b, d, k) => {
    p.push(...a, ...b, ...d);
    c.push(k, k, k, k, k, k, k, k, k);
  };
  // wings: root along the body (z), tips out to +-x and up (+y)
  tri([0, 0, 0.25], [0, 0, -0.2], [0.62, 0.22, -0.05], 1);
  tri([0, 0, 0.25], [-0.62, 0.22, -0.05], [0, 0, -0.2], 1);
  // body and a tail
  tri([0, 0.02, 0.32], [-0.05, 0, -0.3], [0.05, 0, -0.3], 0.55);
  tri([0, 0, -0.25], [-0.12, 0, -0.45], [0.12, 0, -0.45], 0.7);
  return geo(p, c);
}

/** A small diamond (fireflies, sand, snow, seeds use the wing mesh; this is the glow and the puff). */
function puffGeometry() {
  const p = [];
  const c = [];
  // a rounded puff: a hexagonal body with a domed top and a flat underside
  const t = [0, 0.5, 0];
  const b = [0, -0.3, 0];
  const N = 6;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const m0 = [Math.cos(a0) * 0.5, 0, Math.sin(a0) * 0.5];
    const m1 = [Math.cos(a1) * 0.5, 0, Math.sin(a1) * 0.5];
    const u0 = [Math.cos(a0 + 0.5) * 0.36, 0.32, Math.sin(a0 + 0.5) * 0.36];
    const u1 = [Math.cos(a1 + 0.5) * 0.36, 0.32, Math.sin(a1 + 0.5) * 0.36];
    p.push(...m0, ...u0, ...m1, ...m1, ...u0, ...u1, ...u0, ...t, ...u1, ...m0, ...m1, ...b);
    c.push(1, 1, 1, 1.12, 1.12, 1.12, 1, 1, 1, 1, 1, 1, 1.12, 1.12, 1.12, 1.12, 1.12, 1.12, 1.12, 1.12, 1.12, 1.18, 1.18, 1.18, 1.12, 1.12, 1.12, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.72, 0.72, 0.72);
  }
  return geo(p, c);
}

/** A flat ring (annulus) lying in the xz plane. */
function ringGeometry() {
  const p = [];
  const c = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const o0 = [Math.cos(a0), 0, Math.sin(a0)];
    const o1 = [Math.cos(a1), 0, Math.sin(a1)];
    const i0 = [Math.cos(a0) * 0.86, 0, Math.sin(a0) * 0.86];
    const i1 = [Math.cos(a1) * 0.86, 0, Math.sin(a1) * 0.86];
    p.push(...i0, ...o1, ...o0, ...i0, ...i1, ...o1);
    for (let k = 0; k < 6; k++) c.push(1, 1, 1);
  }
  return geo(p, c);
}

/**
 * @param {any} ctx
 * @param {() => Array<{x:number,y:number,z:number}>} chimneys settlement chimney tops (read once after build)
 */
export function createLife(ctx, chimneys) {
  const P = PALETTE;
  const meshes = [];
  /** @type {any[]} */
  const mats = [];
  /** @param {any} g @param {number} n @param {any} opts @param {string} name */
  function mk(g, n, opts, name) {
    const mat = ctx.render.materials.toon(Object.assign({ vertexColors: true, instanced: true, doubleSide: true }, opts));
    const m = new InstancedMesh(g, mat, n);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    m.instanceColor.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.name = 'env.life.' + name;
    ctx.render.layers.props.add(m);
    meshes.push(m);
    mats.push(mat);
    return m;
  }
  const wing = wingGeometry();
  const birds = mk(wing, BIRDS, {}, 'birds');
  const motes = mk(wing, MOTES, {}, 'motes');
  const flies = mk(puffGeometry(), FLIES, { emissive: P.structure.lantern, emissiveIntensity: 2.2, color: P.structure.lantern }, 'fireflies');
  const rings = mk(ringGeometry(), RINGS, { emissive: P.ocean.foam, emissiveIntensity: 0.25 }, 'rings');
  const puffs = mk(puffGeometry(), PUFFS, {}, 'smoke');
  // the shadow pass must not adopt these (tiny, moving): a negative near-hide marks them as non-casters
  for (const m of meshes) if (m.material.uniforms.uNearHide) m.material.uniforms.uNearHide.value = -0.0001;

  const c = new Color();
  const col = {
    gull: new Color(P.paper), swift: new Color(P.ink).lerp(new Color(P.biome.stormwell.cliff), 0.4),
    seed: new Color(P.paper), snow: new Color(P.snow), sand: new Color(P.biome.rustdune.ground).lerp(new Color(P.paper), 0.25),
    crystal: new Color(P.biome.spire.ground), smoke: new Color(P.paper).lerp(new Color(P.biome.frostspine.shade), 0.35),
    fly: new Color(P.structure.lantern),
  };
  const fliesCol = [new Color(P.biome.meadows.accent), new Color(P.flora.redLeaf), new Color(P.structure.kites[2]), new Color(P.paper), new Color(P.flora.brambleFlower)];
  const flock = new Float32Array(FLOCKS * 6); // ax, ay, az, radius, speed, phase
  let flockInit = false;
  const ringT = new Float32Array(RINGS).fill(99);
  const ringX = new Float32Array(RINGS);
  const ringZ = new Float32Array(RINGS);
  let ringSeq = 0;
  let time = 0;
  /** @type {Float32Array|null} chimney tops xyz */
  let chim = null;
  let chimN = 0;

  /** Write a matrix: position, yaw, uniform scale s with a separate y scale sy. */
  function put(m, i, x, y, z, yaw, s, sy, pitch) {
    const e = m.instanceMatrix.array;
    const o = i * 16;
    const cy = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // R = Ry(yaw) * Rx(pitch), scaled by (s, sy, s)
    e[o] = cy * s; e[o + 1] = 0; e[o + 2] = -sn * s; e[o + 3] = 0;
    e[o + 4] = sn * sp * sy; e[o + 5] = cp * sy; e[o + 6] = cy * sp * sy; e[o + 7] = 0;
    e[o + 8] = sn * cp * s; e[o + 9] = -sp * s; e[o + 10] = cy * cp * s; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
  }
  /** @param {any} m @param {number} i @param {Color} cc @param {number} k */
  function tint(m, i, cc, k) {
    const a = m.instanceColor.array;
    a[i * 3] = cc.r * k; a[i * 3 + 1] = cc.g * k; a[i * 3 + 2] = cc.b * k;
  }
  /** @param {any} m @param {number} n */
  function done(m, n) {
    m.count = n;
    m.visible = n > 0;
    if (n > 0) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }

  return {
    /**
     * @param {number} dt seconds @param {any} cam the camera @param {any} wind (x, z direction, y gust)
     * @param {number} night 0 day .. 1 night
     */
    frame(dt, cam, wind, night) {
      const w = ctx.world;
      if (!cam || !w || typeof w.heightAt !== 'function') return;
      time += dt > 0.1 ? 0.1 : dt;
      const t = time;
      const cx = cam.position.x;
      const cy = cam.position.y;
      const cz = cam.position.z;
      const p = ctx.player;
      const px = p && p.alive ? p.pos.x : cx;
      const py = p && p.alive ? p.pos.y : cy;
      const pz = p && p.alive ? p.pos.z : cz;
      const region = w.regionAt(px, pz);
      const wx = wind ? wind.x : 0.8;
      const wz = wind ? wind.z : 0.6;
      const day = 1 - night;

      // ---- birds: flocks circle anchors 150-450 m ahead of the camera, by day
      let nb = 0;
      const me = cam.matrixWorld.elements;
      const fl = Math.hypot(me[8], me[10]) || 1;
      const fwdX = -me[8] / fl;
      const fwdZ = -me[10] / fl;
      if (day > 0.4 && region !== 'frostspine') {
        for (let f = 0; f < FLOCKS; f++) {
          const o = f * 6;
          const dx = flock[o] - cx;
          const dz = flock[o + 2] - cz;
          if (!flockInit || dx * dx + dz * dz > 650 * 650) {
            const d = 160 + 120 * f + 60 * h01(f, Math.floor(t));
            const side = (f - 1) * 0.7;
            flock[o] = cx + (fwdX * Math.cos(side) - fwdZ * Math.sin(side)) * d;
            flock[o + 2] = cz + (fwdZ * Math.cos(side) + fwdX * Math.sin(side)) * d;
            flock[o + 1] = 0;
            flock[o + 3] = 40 + 50 * h01(f, 3);
            flock[o + 4] = (0.18 + 0.1 * h01(f, 4)) * (f % 2 ? 1 : -1);
            flock[o + 5] = 6.28 * h01(f, 5);
          }
          const ax = flock[o];
          const az = flock[o + 2];
          const ground = Math.max(w.heightAt(ax, az), 0);
          const coast = w.regionAt(ax, az) === 'coast';
          const ang = flock[o + 5] + t * flock[o + 4];
          const r = flock[o + 3];
          const per = BIRDS / FLOCKS;
          for (let i = 0; i < per; i++) {
            const k = f * per + i;
            const lag = i * 0.09 * Math.sign(flock[o + 4]);
            const a = ang - lag;
            const rr = r + (h01(k, 1) - 0.5) * 18;
            const x = ax + Math.cos(a) * rr + Math.sin(t * 0.7 + k) * 2;
            const z = az + Math.sin(a) * rr + Math.cos(t * 0.6 + k) * 2;
            const y = ground + 32 + 14 * h01(f, 9) + (h01(k, 2) - 0.5) * 10 + Math.sin(t * 0.9 + k) * 1.5;
            const flap = Math.sin(t * (coast ? 5 : 9) + k * 1.7);
            const glide = coast ? 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.8 + k)) : 1;
            const tx = -Math.sin(a) * Math.sign(flock[o + 4]);
            const tz = Math.cos(a) * Math.sign(flock[o + 4]);
            put(birds, nb, x, y, z, Math.atan2(tx, tz), coast ? 1.6 : 1.1, (coast ? 1.6 : 1.1) * (0.25 + 0.75 * flap * glide), 0);
            tint(birds, nb, coast ? col.gull : col.swift, 0.9 + 0.2 * h01(k, 3));
            nb++;
          }
        }
        flockInit = true;
      }
      done(birds, nb);

      // ---- motes around the player
      let nm = 0;
      const alt = py - w.heightAt(px, pz);
      if (alt < 40) {
        if (region === 'frostspine') {
          // falling snow in a 26 m box that follows the player, drifting with the wind
          for (let i = 0; i < 140 && nm < MOTES; i++) {
            const B = 26;
            const fall = 1.2 + 0.8 * h01(i, 1);
            let x = h01(i, 2) * B + wx * t * 1.5;
            let y = h01(i, 3) * 16 - fall * t;
            let z = h01(i, 4) * B + wz * t * 1.5;
            x = ((x % B) + B) % B - B / 2;
            y = ((y % 16) + 16) % 16;
            z = ((z % B) + B) % B - B / 2;
            put(motes, nm, px + x, py - 3 + y, pz + z, t * 2 + i, 0.22, 0.22, 1.2);
            tint(motes, nm++, col.snow, 1);
          }
        } else if (region === 'rustdune') {
          // sand blowing low and fast along the wind
          for (let i = 0; i < 110 && nm < MOTES; i++) {
            const B = 30;
            const sp = 7 + 5 * h01(i, 1);
            let x = h01(i, 2) * B + wx * t * sp;
            let z = h01(i, 4) * B + wz * t * sp;
            x = ((x % B) + B) % B - B / 2;
            z = ((z % B) + B) % B - B / 2;
            const gx = px + x;
            const gz = pz + z;
            const y = w.heightAt(gx, gz) + 0.15 + 1.4 * h01(i, 3) * h01(i, 5) + 0.3 * Math.sin(t * 3 + i);
            put(motes, nm, gx, y, gz, Math.atan2(wx, wz), 0.09, 0.05, 0);
            tint(motes, nm++, col.sand, 0.9 + 0.2 * h01(i, 6));
          }
        } else if (region === 'spire') {
          for (let i = 0; i < 50 && nm < MOTES; i++) {
            const B = 30;
            let y = h01(i, 3) * 12 + t * (0.5 + 0.4 * h01(i, 1));
            y %= 12;
            const gx = px + (h01(i, 2) - 0.5) * B + Math.sin(t * 0.5 + i) * 0.8;
            const gz = pz + (h01(i, 4) - 0.5) * B + Math.cos(t * 0.4 + i) * 0.8;
            put(motes, nm, gx, w.heightAt(gx, gz) + y, gz, t + i, 0.14, 0.14, 0.8);
            tint(motes, nm++, col.crystal, 1.2);
          }
        } else if (day > 0.5) {
          // butterflies over the flowers, drifting seeds in the wind
          const nbf = region === 'meadows' ? 18 : region === 'coast' || region === 'thornwood' ? 10 : 0;
          for (let i = 0; i < nbf; i++) {
            const hx = px + (h01(i, 2) - 0.5) * 36;
            const hz = pz + (h01(i, 4) - 0.5) * 36;
            const x = hx + Math.sin(t * 0.7 + i) * 3 + Math.sin(t * 2.3 + i * 2) * 0.6;
            const z = hz + Math.cos(t * 0.6 + i * 1.3) * 3;
            const y = w.heightAt(x, z) + 0.6 + 0.6 * h01(i, 3) + Math.abs(Math.sin(t * 1.7 + i)) * 0.5;
            const flap = Math.sin(t * 14 + i * 3);
            put(motes, nm, x, y, z, t * 0.6 + i * 2, 0.45, 0.45 * flap, 0);
            tint(motes, nm++, fliesCol[i % (region === 'thornwood' ? 5 : 4)], 1.1);
          }
          if (region === 'meadows' || region === 'stormwell' || region === 'coast') {
            for (let i = 0; i < 40 && nm < MOTES; i++) {
              const B = 40;
              const sp = 2 + 1.5 * h01(i, 1);
              let x = h01(i, 7) * B + wx * t * sp;
              let z = h01(i, 8) * B + wz * t * sp;
              x = ((x % B) + B) % B - B / 2;
              z = ((z % B) + B) % B - B / 2;
              const gx = px + x;
              const gz = pz + z;
              const y = w.heightAt(gx, gz) + 1.2 + 3 * h01(i, 9) + Math.sin(t * 0.8 + i) * 0.6;
              put(motes, nm, gx, y, gz, t * 1.5 + i, 0.07, 0.07, 1.1);
              tint(motes, nm++, col.seed, 1.15);
            }
          }
        }
      }
      done(motes, nm);

      // ---- fireflies at night
      let nf = 0;
      if (night > 0.35 && alt < 40 && (region === 'meadows' || region === 'thornwood' || region === 'coast' || region === 'stormwell')) {
        const k = Math.min(1, (night - 0.35) * 3);
        for (let i = 0; i < FLIES; i++) {
          const hx = px + (h01(i, 12) - 0.5) * 44;
          const hz = pz + (h01(i, 14) - 0.5) * 44;
          const x = hx + Math.sin(t * 0.4 + i) * 2.5;
          const z = hz + Math.cos(t * 0.33 + i * 1.7) * 2.5;
          const y = w.heightAt(x, z) + 0.5 + 1.8 * h01(i, 13) + Math.sin(t * 0.9 + i) * 0.4;
          const blink = Math.max(0, Math.sin(t * (1.2 + h01(i, 15)) + i * 2.1));
          const s = 0.11 * k * (0.3 + 0.7 * blink);
          put(flies, nf, x, y, z, 0, s, s, 0);
          tint(flies, nf++, col.fly, 1);
        }
      }
      done(flies, nf);

      // ---- fish rings on open water near the camera
      let nr = 0;
      if (alt < 120) {
        for (let i = 0; i < RINGS; i++) {
          ringT[i] += dt;
          if (ringT[i] > 2.8 + 3 * h01(i, ringSeq)) {
            ringSeq++;
            const a = h01(ringSeq, 1) * 6.283;
            const d = 12 + 80 * h01(ringSeq, 2);
            const x = px + Math.cos(a) * d;
            const z = pz + Math.sin(a) * d;
            if (w.waterDepthAt(x, z) > 0.8) {
              ringX[i] = x;
              ringZ[i] = z;
              ringT[i] = 0;
            } else {
              ringT[i] = 2;
            }
          }
          const u = ringT[i] / 2.4;
          if (u >= 1) continue;
          const s = 0.3 + 2.4 * u;
          const sea = typeof w.seaLevel === 'number' ? w.seaLevel : 0;
          put(rings, nr, ringX[i], sea + 0.06 - u * u * 0.25, ringZ[i], 0, s, 1, 0);
          tint(rings, nr++, col.seed, 1 - 0.3 * u);
        }
      }
      done(rings, nr);

      // ---- chimney smoke near the camera (rising, swelling, leaning downwind, then shrinking away)
      if (!chim) {
        const list = chimneys();
        chim = new Float32Array(list.length * 3);
        chimN = list.length;
        for (let i = 0; i < chimN; i++) {
          chim[i * 3] = list[i].x; chim[i * 3 + 1] = list[i].y; chim[i * 3 + 2] = list[i].z;
        }
      }
      let ns = 0;
      for (let ci = 0; ci < chimN && ns < PUFFS; ci++) {
        const x0 = chim[ci * 3];
        const y0 = chim[ci * 3 + 1];
        const z0 = chim[ci * 3 + 2];
        const dx = x0 - cx;
        const dz = z0 - cz;
        if (dx * dx + dz * dz > 450 * 450) continue;
        for (let j = 0; j < 7 && ns < PUFFS; j++) {
          const age = (t + j * (PUFF_LIFE / 7) + ci * 0.37) % PUFF_LIFE;
          const u = age / PUFF_LIFE;
          const s = (0.9 + 3.2 * u) * (u > 0.7 ? (1 - u) / 0.3 : 1);
          put(puffs, ns, x0 + wx * u * 6 + Math.sin(t + j) * 0.3, y0 + u * 9, z0 + wz * u * 6, j + t * 0.3, s, s * 0.8, 0);
          tint(puffs, ns++, col.smoke, 1.05 - 0.2 * u + 0.15 * night);
        }
      }
      done(puffs, ns);
    },
    /** Diagnostics. */
    count() {
      return { birds: birds.count, motes: motes.count, fireflies: flies.count, rings: rings.count, smoke: puffs.count };
    },
    dispose() {
      for (const m of meshes) {
        if (m.parent) m.parent.remove(m);
        m.dispose();
      }
      for (const m of mats) m.dispose();
      wing.dispose();
      flies.geometry.dispose();
      rings.geometry.dispose();
      puffs.geometry.dispose();
      meshes.length = 0;
    },
  };
}
