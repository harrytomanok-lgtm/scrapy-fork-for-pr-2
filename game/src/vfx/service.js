/**
 * The gfx `ctx.vfx` service (ARCHITECTURE 4.4, ART_UX 3): bursts from the recipe table, attached emitters, beams,
 * shockwaves, the four aura styles (plus the enemy variant), ground decals and telegraphs, afterimages, trails,
 * projectile visuals, XP orbs, pickup pillars, glow sprites, and every automatic event-driven effect of 4.4.
 * All visuals use rng.fx; no allocation in the frame path.
 * @module vfx/service
 */

import { Color, Vector3, NormalBlending, AdditiveBlending } from 'three';
import { PALETTE } from '../core/palette.js';
import { RECIPES, CELL } from './logic/recipes.js';
import { createParticles } from './particles.js';
import { createMeshFx, fringeOf } from './meshfx.js';
import { createAtlas } from './atlas.js';

const MAX_EMITTERS = 48;
const MAX_AURAS = 16;
const MAX_PROJ = 128;
const MAX_ORBS = 64;
const MAX_PICKUPS = 64;
const MAX_ICONS = 16;
const MAX_AFTER = 4;
const MAX_LIGHTS = 4;
const MAX_BOOST = 8;
const TAU = Math.PI * 2;

/** Colour tokens of the recipe table. */
const TOKENS = {
  ora: PALETTE.ora, oraCore: PALETTE.oraCore, hostile: PALETTE.hostile, ember: PALETTE.ember, tempest: PALETTE.tempest,
  zenith: PALETTE.zenith, kerrin: PALETTE.kerrin, paper: PALETTE.paper, ink: PALETTE.ink, smoke: PALETTE.smoke,
  scorch: PALETTE.scorch, scorchRim: PALETTE.scorchRim, white: 0xffffff, red: PALETTE.telegraph.red,
  violet: PALETTE.telegraph.violet, foam: PALETTE.ocean.foam, path: PALETTE.path, common: PALETTE.rarity.common,
  fine: PALETTE.rarity.fine, rare: PALETTE.rarity.rare, corruption: PALETTE.corruption,
};
/** Aura styles: shader style id, default colour. */
const AURA_STYLE = { base: 1, ember: 2, tempest: 3, zenith: 4, enemy: 5 };
const AURA_COLOR = { base: PALETTE.ora, ember: PALETTE.ember, tempest: PALETTE.tempest, zenith: PALETTE.zenith, enemy: PALETTE.hostile };
/** Full-screen flashes for feel classes (fx:impact), through the flash budget. */
const IMPACT_FLASH = { finisher: 0.12, burst: 0.06, ultimate: 0.35, transform: 0.16, bossDeath: 0.3, craterBig: 0.15, perfectGuard: 0.1, levelUp: 0.08 };
const DECAL_KIND = { scorch: 0, crack: 1, ring: 2, shape: 3, shock: 4, glyph: 5, glow: 6 };

/** @param {any} ctx */
export function createVfx(ctx) {
  const parts = createParticles(ctx);
  const pool = parts.pool;
  const mfx = createMeshFx(ctx);
  let built = false;
  let lastReal = -1;
  let nextHandle = 1;
  let warnedRecipe = '';

  // scratch
  const cBody = new Color();
  const cFringe = new Color();
  const cTok = new Color();
  const cTmp = new Color();
  const cFlB = new Color();
  const cFlT = new Color();
  /**
   * Flame aura colours by aura style (body, tips), derived from palette tokens once. Ember is orange-red with only
   * the tips gold (lead note: it read golden-yellow on bright grass, like a generic golden aura).
   */
  const FLAME_BODY = [new Color(PALETTE.ora), new Color(PALETTE.ora), new Color(PALETTE.scorchRim).lerp(new Color(PALETTE.flora.redLeaf), 0.82),
    new Color(PALETTE.tempest).offsetHSL(0.015, 0.25, -0.1), new Color(PALETTE.zenith).lerp(new Color(PALETTE.structure.lantern), 0.18)];
  const FLAME_TIP = [new Color(PALETTE.oraCore), new Color(PALETTE.oraCore).lerp(new Color(PALETTE.ora), 0.4), new Color(PALETTE.biome.meadows.accent),
    new Color(PALETTE.biome.frostspine.accent).lerp(new Color(PALETTE.ora), 0.35), new Color(PALETTE.structure.lantern)];
  const v1 = new Vector3();
  const v2 = new Vector3();
  const v3 = new Vector3();
  const tmpOpts = { dirX: 0, dirY: 0, dirZ: 0, color: /** @type {number|undefined} */ (undefined), scale: 1, count: /** @type {number|undefined} */ (undefined) };
  const waveOpts = { radius: 6, seconds: 0.28, color: PALETTE.ora, ground: true, sphere: false };
  /** Defaults when a caller passes no options. */
  const EMPTY = Object.freeze({});
  const decalOpts = { color: /** @type {number|undefined} */ (undefined), seconds: /** @type {number|undefined} */ (undefined), shape: 'circle', dirX: 0, dirZ: 1, length: 0, fill: 0 };

  function isLow() {
    const r = ctx.render;
    return !r || r.tier !== 'high';
  }
  function rnd() {
    return ctx.rng.fx.next();
  }

  /** @param {any} token @param {any} out @returns {any} */
  function tokenColor(token, out) {
    if (token === 'body') return out.copy(cBody);
    if (token === 'fringe') return out.copy(cFringe);
    if (token === 'core') return out.setRGB(1, 1, 1);
    if (typeof token === 'number') return out.setHex(token);
    const h = TOKENS[token];
    return out.setHex(typeof h === 'number' ? h : 0xffffff);
  }

  /** @param {any} R recipe @param {number|undefined} hex */
  function setBody(R, hex) {
    if (typeof hex === 'number') cBody.setHex(hex);
    else tokenColor(R.body, cBody);
    fringeOf(cBody, cFringe);
  }

  /**
   * Emit one particle of a layer.
   * @param {any} L @param {number} x @param {number} y @param {number} z @param {number} dx @param {number} dy @param {number} dz
   * @param {number} sc @param {number} hdrMul
   */
  function emitLayer(L, x, y, z, dx, dy, dz, sc, hdrMul) {
    const i = pool.alloc();
    if (i < 0) return -1;
    const r = (L.r || 0) * sc;
    let ux = rnd() * 2 - 1;
    let uy = rnd() * 2 - 1;
    let uz = rnd() * 2 - 1;
    let ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let vx = ux;
    let vy = uy;
    let vz = uz;
    const sh = L.sh;
    if (sh === 'hemi') {
      vy = Math.abs(uy) * 0.8 + 0.2;
      ox = ux * r * rnd(); oz = uz * r * rnd();
    } else if (sh === 'up') {
      const a = rnd() * TAU;
      const d = rnd() * r;
      ox = Math.cos(a) * d; oz = Math.sin(a) * d;
      vx = ux * 0.3; vy = 1; vz = uz * 0.3;
    } else if (sh === 'ring' || sh === 'disc') {
      const a = rnd() * TAU;
      vx = Math.cos(a); vz = Math.sin(a); vy = sh === 'ring' ? 0.06 + rnd() * 0.12 : 0.04;
      const d = sh === 'ring' ? r : r * rnd();
      ox = vx * d; oz = vz * d; oy = 0.15;
    } else if (sh === 'dir' || sh === 'shield') {
      const w = sh === 'dir' ? (L.dir || 0.7) * 2.2 : 1.6;
      vx = dx * w + ux; vy = dy * w + uy; vz = dz * w + uz;
      const l2 = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      vx /= l2; vy /= l2; vz /= l2;
      if (sh === 'shield') {
        ox = vx * r; oy = vy * r * 0.8 + 0.2; oz = vz * r;
      }
    } else if (sh === 'inward') {
      ox = ux * r; oy = Math.abs(uy) * r * 0.6; oz = uz * r;
      ul = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      vx = -ox / ul; vy = -oy / ul; vz = -oz / ul;
    } else if (sh === 'column') {
      const a = rnd() * TAU;
      const d = rnd() * 0.45 * sc;
      ox = Math.cos(a) * d; oz = Math.sin(a) * d; oy = rnd() * r;
      vx = ux * 0.15; vy = 1; vz = uz * 0.15;
    } else if (sh === 'still') {
      vx = 0; vy = 0; vz = 0;
    } else {
      ox = ux * r * rnd(); oy = uy * r * rnd(); oz = uz * r * rnd();
    }
    const sp = (L.sp[0] + (L.sp[1] - L.sp[0]) * rnd()) * (sc > 1 ? Math.sqrt(sc) : sc);
    let py = y + oy;
    // gnd: dust that starts on the ground under an airborne burst
    if (L.gnd && ctx.world) py = ctx.world.heightAt(x + ox, z + oz) + 0.25;
    pool.px[i] = x + ox; pool.py[i] = py; pool.pz[i] = z + oz;
    pool.vx[i] = vx * sp; pool.vy[i] = vy * sp + (L.lift || 0) * (0.6 + 0.4 * rnd()); pool.vz[i] = vz * sp;
    pool.life[i] = L.life[0] + (L.life[1] - L.life[0]) * rnd();
    const sj = 0.8 + 0.4 * rnd();
    // cap: a white core scaled up by a big caller never swallows the hero standing in it
    const cap = L.cap || 1e9;
    pool.s0[i] = Math.min(cap, L.sz[0] * sc * sj);
    pool.s1[i] = Math.min(cap, L.sz[1] * sc * sj);
    pool.rot[i] = sh === 'still' && L.cell !== CELL.star && !L.rr ? 0 : rnd() * TAU;
    pool.rotV[i] = L.rv || 0;
    tokenColor(L.col, cTok);
    const hdr = (L.hdr || 1) * hdrMul;
    pool.cr[i] = cTok.r * hdr; pool.cg[i] = cTok.g * hdr; pool.cb[i] = cTok.b * hdr;
    pool.ca[i] = (typeof L.a === 'number' ? L.a : 1) * (L.col === 'fringe' ? 0.6 : 1);
    pool.grav[i] = L.g || 0;
    pool.drag[i] = L.dr || 0;
    pool.core[i] = L.k || 0;
    pool.stretch[i] = L.m === 1 ? L.st || 0 : 0;
    if (L.tail) {
      // a fixed-length tail behind the burst direction (a comet), centred half a tail back
      const tl = L.tail * Math.min(2, sc);
      pool.px[i] = x - dx * tl * 0.5; pool.py[i] = y - dy * tl * 0.5; pool.pz[i] = z - dz * tl * 0.5;
      pool.vx[i] = dx * 0.01; pool.vy[i] = dy * 0.01; pool.vz[i] = dz * 0.01;
      pool.stretch[i] = -tl;
    }
    pool.fadeIn[i] = L.fi || 0;
    pool.mat[i] = L.m;
    pool.cell[i] = L.cell;
    pool.frames[i] = L.fb || 1;
    return i;
  }

  /** @param {string} id @returns {any} */
  function recipeOf(id) {
    const R = RECIPES[id];
    if (R) return R;
    if (warnedRecipe !== id) {
      ctx.log.warn('vfx', 'unknown recipe', id);
      warnedRecipe = id;
    }
    return RECIPES.bolt_hit;
  }

  function build() {
    const render = ctx.render;
    if (built || !render || !render.layers || !render.glsl) return;
    built = true;
    const atlas = createAtlas();
    parts.build(render, atlas);
    mfx.build(render);
    pool.setCap(render.caps ? render.caps.particles : 800);
  }

  // ------------------------------------------------------------------ emitters (attach, trail)
  const emitters = [];
  for (let i = 0; i < MAX_EMITTERS; i++) {
    emitters.push({
      id: 0, R: /** @type {any} */ (null), entId: 0, socket: 'chest', color: -1, dying: false, fade: 0, fadeTotal: 0,
      acc: new Float32Array(4), lx: 0, ly: 0, lz: 0, has: false, ttl: 0, t: 0, spin: 0, sizeMul: 1, lifeMul: 1, trail: false, full: false,
    });
  }
  /** @param {any} ent @param {string} socket @param {any} out */
  function socketPos(ent, socket, out) {
    const a = ctx.actors;
    if (a && typeof a.socket === 'function') return a.socket(ent, socket, out);
    return out.set(ent.pos.x, ent.pos.y + ent.height * 0.6, ent.pos.z);
  }
  /** @returns {any} */
  function freeEmitter() {
    for (let i = 0; i < emitters.length; i++) if (emitters[i].id === 0) return emitters[i];
    return null;
  }

  // ------------------------------------------------------------------ beams
  const NULL_BEAM = { set() {}, end() {} };
  /** @param {any} b */
  function beamHandle(b) {
    const gen = ++b.gen;
    return {
      /** @param {number} ax @param {number} ay @param {number} az @param {number} bx @param {number} by @param {number} bz @param {number} radius @param {number} intensity */
      set(ax, ay, az, bx, by, bz, radius, intensity) {
        if (b.gen !== gen || b.ending) return;
        b.ax = ax; b.ay = ay; b.az = az; b.bx = bx; b.by = by; b.bz = bz;
        if (radius > 0) b.baseRadius = radius;
        b.intensity = intensity >= 0 ? intensity : 1;
        b.hasSet = true;
      },
      /** @param {number} [fadeSeconds] */
      end(fadeSeconds = 0.18) {
        if (b.gen !== gen) return;
        endBeam(b, fadeSeconds);
      },
    };
  }
  /** @param {any} b @param {number} fade */
  function endBeam(b, fade) {
    if (!b.active || b.ending) return;
    b.ending = true;
    b.fade = Math.max(0.02, fade);
    b.fadeT = b.fade;
    if (b.kind === 0 && b.hasSet) {
      // five dissolving rings along the beam
      const dx = b.bx - b.ax;
      const dy = b.by - b.ay;
      const dz = b.bz - b.az;
      for (let k = 1; k <= 5; k++) {
        const i = pool.alloc();
        if (i < 0) break;
        const f = k / 6;
        pool.px[i] = b.ax + dx * f; pool.py[i] = b.ay + dy * f; pool.pz[i] = b.az + dz * f;
        pool.vx[i] = 0; pool.vy[i] = 0.4; pool.vz[i] = 0;
        pool.life[i] = 0.35 + 0.1 * k; pool.s0[i] = b.baseRadius * 3; pool.s1[i] = b.baseRadius * 6;
        pool.rot[i] = 0; pool.rotV[i] = 0;
        pool.cr[i] = cTmp.copy(b.mat.uniforms.uColor.value).r * 1.6; pool.cg[i] = cTmp.g * 1.6; pool.cb[i] = cTmp.b * 1.6; pool.ca[i] = 0.8;
        pool.grav[i] = 0; pool.drag[i] = 0; pool.core[i] = 0.4; pool.stretch[i] = 0; pool.fadeIn[i] = 0;
        pool.mat[i] = 0; pool.cell[i] = CELL.ring; pool.frames[i] = 1;
      }
    }
  }
  /**
   * @param {number} color @param {number} radius @param {number} kind 0 beam, 1 pillar, 2 tether
   * @returns {any} beam record or null
   */
  function startBeam(color, radius, kind) {
    build();
    const b = mfx.freeBeam();
    if (!b) return null;
    b.active = true;
    b.ending = false;
    b.hasSet = false;
    b.t = 0;
    b.kind = kind;
    b.timed = -1;
    b.followA = 0;
    b.followB = 0;
    b.baseRadius = radius > 0 ? radius : 0.3;
    b.radius = b.baseRadius;
    b.intensity = 1;
    b.ringT = 0;
    b.power = 0;
    b.mat.uniforms.uColor.value.setHex(color);
    fringeOf(b.mat.uniforms.uColor.value, b.mat.uniforms.uFringe.value);
    b.mat.uniforms.uPulse.value = kind === 2 ? 1 : kind === 1 ? 0 : 0.35;
    b.mat.uniforms.uSpeed.value = kind === 1 ? 3 : kind === 2 ? 6 : 16;
    b.mat.uniforms.uCore.value = kind === 2 ? 0.25 : 0.9;
    b.handle = beamHandle(b);
    return b;
  }

  // ------------------------------------------------------------------ auras
  const auras = [];
  for (let i = 0; i < MAX_AURAS; i++) {
    const a = {
      entId: 0, shell: /** @type {any} */ (null), cur: 0, target: 0, color: new Color(PALETTE.ora), fringe: new Color(), style: 1,
      flareT: 0, releasing: false, acc: 0, acc2: 0, dustT: 0, wasFull: false, gen: 0, handle: /** @type {any} */ (null), phase: 0,
      glowId: 0, gx: 0, gz: 0, gr: 0, flame: /** @type {any} */ (null), flowT: 0, swell: 0, colK: 0, transT: 0, wasTrans: false,
      gatherT: 0, acc3: 0, ringT: 0,
    };
    auras.push(a);
  }
  const NULL_AURA = { set() {}, dispose() {} };
  /** @param {number} entId */
  function isGathering(entId) {
    const e = ctx.ents.get(entId);
    return !!(e && e.combat && e.combat.gathering);
  }
  /** @param {any} a */
  function auraHandle(a) {
    const gen = ++a.gen;
    return {
      /** @param {number} intensity @param {number} [color] @param {string} [style] */
      set(intensity, color, style) {
        if (a.gen !== gen) return;
        const st = style && AURA_STYLE[style] ? style : 'base';
        const t = intensity > 1 ? 1 : intensity > 0 ? intensity : 0;
        // a Form fading out (its owner already reports the base style) keeps its flame on the way down instead of
        // swapping to the base shell for a moment (a green egg around the hero after leaving a Form)
        const fadingForm = a.style >= 2 && a.style <= 4 && AURA_STYLE[st] === 1 && t <= a.target && !(a.entId && isGathering(a.entId));
        if (!fadingForm) {
          a.style = AURA_STYLE[st];
          a.color.setHex(typeof color === 'number' ? color : AURA_COLOR[st]);
          fringeOf(a.color, a.fringe);
        }
        if (a.target <= 0.01 && t > 0.01) a.flareT = 0.15;
        a.target = t;
        a.releasing = false;
      },
      dispose() {
        if (a.gen !== gen) return;
        a.gen++;
        a.releasing = true;
        a.target = 0;
      },
    };
  }

  // ------------------------------------------------------------------ projectiles, orbs, pickups, icons, afterimages, lights
  const projs = [];
  for (let i = 0; i < MAX_PROJ; i++) projs.push({ entId: 0, hitId: 'bolt_hit', color: new Color(), fringe: new Color(), lx: 0, ly: 0, lz: 0, has: false });
  const orbs = [];
  for (let i = 0; i < MAX_ORBS; i++) orbs.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 });
  const pickups = [];
  for (let i = 0; i < MAX_PICKUPS; i++) pickups.push({ entId: 0, color: new Color(), acc: 0, t: 0 });
  const icons = [];
  for (let i = 0; i < MAX_ICONS; i++) icons.push({ entId: 0, t: 0, seconds: 0, color: new Color() });
  const afters = [];
  for (let i = 0; i < MAX_AFTER; i++) afters.push({ on: false, mesh: /** @type {any} */ (null), mat: /** @type {any} */ (null), t: 0, seconds: 0.3, x: 0, y: 0, z: 0, h: 1.8, color: new Color() });
  const lights = [];
  for (let i = 0; i < MAX_LIGHTS; i++) lights.push({ h: /** @type {any} */ (null), t: 0, seconds: 0, x: 0, y: 0, z: 0, color: 0, i: 0, r: 0 });
  /** The player's boost stage (move:boost) for the speed streaks; the weather layer (env fog override). */
  let pBoost = 0;
  let speedK = 0;
  let speedT = 0;
  let weatherTarget = 0;
  let weatherK = 0;
  let weatherT = 0;
  const boostEnt = new Int32Array(MAX_BOOST);
  const boostHandle = new Int32Array(MAX_BOOST);

  /** @param {number} x @param {number} y @param {number} z @param {number} color @param {number} intensity @param {number} radius @param {number} seconds */
  function flashLight(x, y, z, color, intensity, radius, seconds) {
    const r = ctx.render;
    if (!r || !r.caps || r.caps.pointLights <= 0) return;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const L = lights[i];
      if (L.h) continue;
      const h = r.light.claim(1);
      if (!h) return;
      L.h = h; L.t = 0; L.seconds = seconds; L.x = x; L.y = y; L.z = z; L.color = color; L.i = intensity; L.r = radius;
      return;
    }
  }

  // ------------------------------------------------------------------ the service
  const vfx = {
    /**
     * @param {string} recipeId @param {number} x @param {number} y @param {number} z
     * @param {{ dirX?:number, dirY?:number, dirZ?:number, color?:number, scale?:number, count?:number }} [opts]
     */
    burst(recipeId, x, y, z, opts) {
      build();
      if (!built) return;
      const R = recipeOf(recipeId);
      const o = /** @type {any} */ (opts || EMPTY);
      let sc = typeof o.scale === 'number' && o.scale > 0 ? o.scale : 1;
      if (R.sigil) {
        // the Ringfall sigil is carved in the air between the hero hanging at the peak and the ground he dives to
        // (the caller places it on the ground), at its authored size
        const p = ctx.player;
        if (p && Math.abs(p.pos.x - x) < 4 && Math.abs(p.pos.z - z) < 4 && p.pos.y > y + 4) y += (p.pos.y - y) * 0.45;
        sc = Math.min(sc, 1);
      }
      const low = isLow();
      const hdrMul = low ? 0.8 : 1;
      let dx = o.dirX || 0;
      let dy = o.dirY || 0;
      let dz = o.dirZ || 0;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dl > 1e-5) {
        dx /= dl; dy /= dl; dz /= dl;
      } else {
        dy = 1;
      }
      setBody(R, o.color);
      const layers = R.layers;
      for (let l = 0; l < layers.length; l++) {
        const L = layers[l];
        if (!L.n) continue;
        if (L.hi && low) continue;
        let n = low ? (typeof L.lo === 'number' ? L.lo : Math.ceil(L.n / 2)) : L.n;
        if (typeof o.count === 'number' && o.count >= 0 && L.n > 1) n = Math.min(n, o.count);
        if (sc > 1.5 && L.n > 1) n = Math.min(120, Math.round(n * Math.min(2, Math.sqrt(sc))));
        for (let k = 0; k < n; k++) emitLayer(L, x, y, z, dx, dy, dz, sc, hdrMul);
      }
      if (R.shock) {
        tokenColor(R.shock.col, cTmp);
        waveOpts.radius = R.shock.r * sc;
        waveOpts.seconds = R.shock.t;
        waveOpts.color = cTmp.getHex();
        waveOpts.sphere = !!R.shock.sphere && !(low && R.shock.r * sc < 6);
        waveOpts.ground = !!R.shock.ground;
        vfx.shockwave(x, y, z, waveOpts);
      }
      if (R.decal) {
        decalOpts.color = undefined;
        decalOpts.seconds = R.decal.t;
        decalOpts.shape = 'circle';
        vfx.decal(R.decal.kind, x, z, R.decal.r * sc, decalOpts);
      }
      if (R.flash && ctx.fx) ctx.fx.flash(0xffffff, R.flash, 0.1);
      if (R.light) flashLight(x, y + 1, z, cBody.getHex(), R.light.i, R.light.r * sc, R.light.t);
      if (R.pillar) {
        tokenColor(R.pillar.col, cTmp);
        const b = startBeam(cTmp.getHex(), R.pillar.w * 0.5 * sc, 1);
        if (b) {
          const y0 = R.pillar.y0 ? y + R.pillar.y0 : y - 0.5;
          b.handle.set(x, y0, z, x, y + R.pillar.h * sc, z, R.pillar.w * 0.5 * sc, 1);
          b.timed = R.pillar.t;
        }
      }
    },

    /**
     * Continuous emitter following an entity socket.
     * @param {string} recipeId @param {number} entId @param {string} [socket] @param {{ color?:number }} [opts] @returns {number}
     */
    attach(recipeId, entId, socket = 'chest', opts) {
      build();
      const e = freeEmitter();
      const id = nextHandle++;
      if (!e) return id;
      e.id = id;
      e.R = recipeOf(recipeId);
      e.entId = entId;
      e.socket = socket || 'chest';
      e.color = opts && typeof opts.color === 'number' ? opts.color : -1;
      e.dying = false;
      e.fade = 0;
      e.fadeTotal = 0;
      e.acc.fill(0);
      e.has = false;
      e.ttl = 0;
      e.t = 0;
      e.spin = 0;
      e.sizeMul = 1;
      e.lifeMul = 1;
      e.trail = false;
      e.full = false;
      return id;
    },

    /** @param {number} handle @param {number} [fadeSeconds] */
    detach(handle, fadeSeconds = 0.2) {
      for (let i = 0; i < emitters.length; i++) {
        const e = emitters[i];
        if (e.id !== handle || e.dying) continue;
        e.dying = true;
        e.fade = Math.max(0.001, fadeSeconds);
        e.fadeTotal = e.fade;
      }
    },

    /** @param {{ color?:number, radius?:number, ownerId?:number }} [opts] */
    beam(opts) {
      const b = startBeam(opts && typeof opts.color === 'number' ? opts.color : PALETTE.ora, opts && opts.radius ? opts.radius : 0.35, 0);
      if (!b) return NULL_BEAM;
      // the owner's released charge (0..1) sets how thick and loud the beam looks
      const owner = opts && opts.ownerId ? ctx.ents.get(opts.ownerId) : null;
      b.power = owner && owner === ctx.player && owner.combat ? Math.max(0, Math.min(1, owner.combat.charge)) : 1;
      b.splashAcc = 0;
      return b.handle;
    },

    /**
     * @param {number} x @param {number} y @param {number} z
     * @param {{ radius?:number, seconds?:number, color?:number, ground?:boolean, sphere?:boolean }} [opts]
     */
    shockwave(x, y, z, opts) {
      build();
      if (!built) return;
      const o = /** @type {any} */ (opts || EMPTY);
      const radius = o.radius > 0 ? o.radius : 6;
      const seconds = o.seconds > 0 ? o.seconds : 0.28;
      const color = typeof o.color === 'number' ? o.color : PALETTE.ora;
      const ground = o.ground !== false;
      if (ground) {
        const d = mfx.freeDecal();
        if (d) {
          mfx.startDecal(d);
          d.kind = 4;
          d.seconds = seconds * 1.3;
          d.autoFill = 0;
          const u = d.mat.uniforms;
          u.uKind.value = 4;
          u.uColor.value.setHex(color).multiplyScalar(1.4);
          u.uAlpha.value = 1;
          mfx.drape(d, 0, x, z, radius, 0, 0, 1, 0);
        }
      }
      if (o.sphere) {
        const s = mfx.freeShell();
        if (s) {
          s.active = true;
          s.kind = 0;
          s.t = 0;
          s.seconds = seconds;
          s.radius = radius;
          s.x = x; s.y = y; s.z = z;
          s.mat.uniforms.uStyle.value = 0;
          s.mat.uniforms.uColor.value.setHex(color);
          fringeOf(s.mat.uniforms.uColor.value, s.mat.uniforms.uFringe.value);
          s.mat.uniforms.uIntensity.value = 1.25;
          s.mesh.position.set(x, y, z);
          s.mesh.scale.setScalar(0.01);
          s.mesh.visible = true;
        }
      }
    },

    /** @param {number} entId */
    aura(entId) {
      build();
      for (let i = 0; i < auras.length; i++) {
        const a = auras[i];
        if (a.entId !== 0) continue;
        const s = mfx.freeShell();
        if (!s) return NULL_AURA;
        s.active = true;
        s.kind = 1;
        s.entId = entId;
        s.mesh.visible = false;
        a.entId = entId;
        a.shell = s;
        a.cur = 0;
        a.target = 0;
        a.flareT = 0;
        a.releasing = false;
        a.wasFull = false;
        a.phase = 0;
        a.style = 1;
        a.color.setHex(PALETTE.ora);
        fringeOf(a.color, a.fringe);
        a.handle = auraHandle(a);
        return a.handle;
      }
      return NULL_AURA;
    },

    /**
     * @param {'scorch'|'crack'|'ring'|'shape'|'shock'|'glyph'} kind @param {number} x @param {number} z @param {number} radius
     * @param {{ color?:number, seconds?:number, shape?:'circle'|'line'|'cone', dirX?:number, dirZ?:number, length?:number, fill?:number, angle?:number }} [opts]
     * @returns {number}
     */
    decal(kind, x, z, radius, opts) {
      build();
      if (!built) return 0;
      const d = mfx.freeDecal();
      if (!d) return 0;
      const o = /** @type {any} */ (opts || EMPTY);
      const k = typeof DECAL_KIND[kind] === 'number' ? DECAL_KIND[kind] : 2;
      const id = mfx.startDecal(d);
      const u = d.mat.uniforms;
      d.kind = k;
      d.autoFill = 0;
      d.fill = typeof o.fill === 'number' ? o.fill : 0;
      const def = k === 0 ? 12 : k === 1 ? 6 : k === 4 ? 0.35 : k === 5 ? 1.6 : -1;
      d.seconds = typeof o.seconds === 'number' && o.seconds > 0 ? o.seconds : def;
      u.uKind.value = k;
      u.uSeed.value = rnd() * 10;
      u.uAlpha.value = 1;
      u.uFill.value = d.fill;
      u.uT.value = 0;
      const color = typeof o.color === 'number' ? o.color : k === 0 ? PALETTE.scorch : k === 1 ? PALETTE.ink : k === 5 ? PALETTE.ora : k === 4 ? PALETTE.paper : PALETTE.telegraph.white;
      u.uColor.value.setHex(color);
      // the cooling rim of a scorch glows; on big craters a full-strength rim floods the screen orange
      u.uColor2.value.setHex(PALETTE.scorchRim).multiplyScalar(k === 0 ? (radius > 6 ? 0.42 : 0.7) : 1);
      u.uStyle.value = color === PALETTE.telegraph.red ? 1 : color === PALETTE.telegraph.violet ? 2 : 0;
      if (k >= 2) u.uColor.value.multiplyScalar(k === 2 || k === 3 ? 1.25 : 1.4);
      const r = radius > 0 ? radius : 1;
      const shape = o.shape === 'line' ? 1 : o.shape === 'cone' ? 2 : 0;
      u.uShape.value = k === 3 ? shape : 0;
      if (k === 3 && shape === 1) {
        const L = o.length > 0 ? o.length : r * 4;
        u.uAspect.value = L / (2 * r);
        mfx.drape(d, 1, x, z, r, L, o.dirX || 0, typeof o.dirZ === 'number' ? o.dirZ : 1, 0);
      } else if (k === 3 && shape === 2) {
        const L = o.length > 0 ? o.length : r;
        u.uCone.value = typeof o.angle === 'number' ? o.angle : 0.52;
        mfx.drape(d, 2, x, z, 0, L, o.dirX || 0, typeof o.dirZ === 'number' ? o.dirZ : 1, 0);
      } else {
        mfx.drape(d, 0, x, z, r, 0, 0, 1, k <= 1 ? rnd() * TAU : 0);
      }
      return id;
    },

    /** @param {number} id @param {number} fill 0..1 */
    setDecalFill(id, fill) {
      const d = mfx.findDecal(id);
      if (!d) return;
      d.fill = fill < 0 ? 0 : fill > 1 ? 1 : fill;
      d.autoFill = 0;
    },

    /** @param {number} id */
    removeDecal(id) {
      const d = mfx.findDecal(id);
      if (!d || d.out > 0) return;
      d.out = 0.15;
      d.outT = 0.15;
    },

    /** @param {number} entId @param {number} [seconds] @param {number} [color] */
    afterimage(entId, seconds = 0.3, color) {
      build();
      const ent = ctx.ents.get(entId);
      if (!ent) return;
      const cap = ctx.render && ctx.render.caps ? ctx.render.caps.afterimages || 1 : 1;
      let live = 0;
      let slot = null;
      for (let i = 0; i < MAX_AFTER; i++) {
        if (afters[i].on) live++;
        else if (!slot) slot = afters[i];
      }
      if (!slot || live >= cap) return;
      slot.on = true;
      slot.t = 0;
      slot.seconds = Math.max(0.05, seconds);
      slot.color.setHex(typeof color === 'number' ? color : PALETTE.ora);
      slot.x = ent.pos.x; slot.y = ent.pos.y; slot.z = ent.pos.z; slot.h = ent.height || 1.8;
      slot.mesh = null;
      const a = ctx.actors;
      const snap = a && typeof a.snapshot === 'function' ? a.snapshot(ent) : null;
      if (snap && snap.isMesh && ctx.render) {
        if (!slot.mat) slot.mat = ctx.render.materials.unlit({ color: PALETTE.ora, transparent: true, depthWrite: false });
        slot.mat.uniforms.uColor.value.copy(slot.color).multiplyScalar(1.3);
        slot.mat.uniforms.uOpacity.value = 0.5;
        snap.material = slot.mat;
        slot.mesh = snap;
        if (!snap.parent) ctx.render.layers.vfx.add(snap);
      }
    },

    /** @param {number} entId @param {string} socket @param {{ color?:number, width?:number, seconds?:number }} [opts] @returns {number} */
    trail(entId, socket, opts) {
      const id = vfx.attach('trail', entId, socket || 'chest', opts);
      for (let i = 0; i < emitters.length; i++) {
        const e = emitters[i];
        if (e.id !== id) continue;
        e.sizeMul = opts && opts.width > 0 ? opts.width / 0.3 : 1;
        e.lifeMul = opts && opts.seconds > 0 ? opts.seconds / 0.25 : 1;
      }
      return id;
    },

    /**
     * Gallery and debug: emit the continuous layers of a recipe once, as if an emitter ran for `seconds`.
     * @param {string} recipeId @param {number} x @param {number} y @param {number} z @param {number} [seconds]
     */
    preview(recipeId, x, y, z, seconds = 0.5) {
      build();
      if (!built) return;
      const R = recipeOf(recipeId);
      const low = isLow();
      setBody(R, undefined);
      for (let l = 0; l < R.layers.length; l++) {
        const L = R.layers[l];
        if (!L.rate || (L.hi && low)) continue;
        const rate = low ? (typeof L.lo === 'number' ? L.lo : L.rate * 0.5) : L.rate;
        const n = Math.round(rate * seconds);
        for (let k = 0; k < n; k++) emitLayer(L, x, y, z, 0, 1, 0, 1, low ? 0.8 : 1);
      }
    },

    /** @returns {number} live particles */
    count() {
      return pool.live;
    },

    /** Debug and test view of the pools. */
    /**
     * Weather layer (an addition for env.setFog): 'snow' draws wind-blown snow around the camera at `amount`
     * (0..1, eased); 'none' or 0 stops it.
     * @param {'snow'|'none'} kind @param {number} [amount]
     */
    weather(kind, amount = 1) {
      weatherTarget = kind === 'snow' ? Math.max(0, Math.min(1, amount)) : 0;
    },

    debugState() {
      let em = 0;
      for (let i = 0; i < emitters.length; i++) if (emitters[i].id) em++;
      let bm = 0;
      for (let i = 0; i < mfx.beams.length; i++) if (mfx.beams[i].active) bm++;
      let dc = 0;
      for (let i = 0; i < mfx.decals.length; i++) if (mfx.decals[i].active) dc++;
      let sh = 0;
      for (let i = 0; i < mfx.shells.length; i++) if (mfx.shells[i].active) sh++;
      let ob = 0;
      for (let i = 0; i < orbs.length; i++) if (orbs[i].on) ob++;
      let pj = 0;
      for (let i = 0; i < projs.length; i++) if (projs[i].entId) pj++;
      return { particles: pool.live, cap: pool.cap, emitters: em, beams: bm, decals: dc, shells: sh, orbs: ob, projectiles: pj, speed: speedK, weather: weatherK };
    },

    /**
     * Gallery and tests: drop every one-shot effect (particles, emitters, timed beams and decals, sphere waves, orbs,
     * afterimages, icons, lights) so the next effect is seen alone. Auras and beams owned by a running technique stay.
     */
    debugReset() {
      pool.clear();
      for (let i = 0; i < emitters.length; i++) emitters[i].id = 0;
      for (let i = 0; i < MAX_BOOST; i++) boostEnt[i] = 0;
      for (let i = 0; i < orbs.length; i++) orbs[i].on = false;
      for (let i = 0; i < icons.length; i++) icons[i].entId = 0;
      for (let i = 0; i < afters.length; i++) afters[i].t = afters[i].seconds;
      for (let i = 0; i < mfx.shells.length; i++) {
        const s = mfx.shells[i];
        if (s.active && s.kind === 0) { s.active = false; s.mesh.visible = false; }
      }
      for (let i = 0; i < mfx.decals.length; i++) {
        const d = mfx.decals[i];
        if (d.active && d.seconds > 0) { d.active = false; d.mesh.visible = false; }
      }
      for (let i = 0; i < mfx.beams.length; i++) {
        const b = mfx.beams[i];
        if (b.active && (b.timed > 0 || b.followA)) endBeam(b, 0.02);
      }
      pBoost = 0;
      speedK = 0;
    },

    /** Remove every pooled mesh. */
    dispose() {
      parts.dispose();
      mfx.dispose();
      for (let i = 0; i < afters.length; i++) {
        const a = afters[i];
        if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
        if (a.mat) a.mat.dispose();
      }
      built = false;
    },
  };

  // ------------------------------------------------------------------ per-frame update
  // ------------------------------------------------------------------ hit flashes (actors.flash, after the sim)
  const MAX_FLASH = 16;
  const flashId = new Int32Array(MAX_FLASH);
  const flashSec = new Float32Array(MAX_FLASH);
  let flashN = 0;
  let lastDustT = -1;
  /** @param {number} entId @param {number} seconds */
  function queueFlash(entId, seconds) {
    if (!entId || flashN >= MAX_FLASH) return;
    flashId[flashN] = entId;
    flashSec[flashN] = seconds;
    flashN++;
  }
  /** Lengthen the white hit flash of bodies struck hard (combat sets a short one during the hit). @param {any} c */
  function applyFlashes(c) {
    const a = c.actors;
    for (let i = 0; i < flashN; i++) {
      const ent = c.ents.get(flashId[i]);
      if (ent && ent.alive && a && typeof a.flash === 'function') a.flash(ent, flashSec[i]);
    }
    flashN = 0;
  }

  /** @param {any} c @param {number} dt @param {number} alpha @param {boolean} low */
  function updateEmitters(c, dt, alpha, low) {
    const hdrMul = low ? 0.8 : 1;
    for (let i = 0; i < emitters.length; i++) {
      const e = emitters[i];
      if (e.id === 0) continue;
      const ent = c.ents.get(e.entId);
      if (!ent || !ent.alive) {
        e.id = 0;
        continue;
      }
      let k = 1;
      if (e.dying) {
        e.fade -= dt;
        if (e.fade <= 0) {
          e.id = 0;
          continue;
        }
        k = e.fade / e.fadeTotal;
      }
      if (e.ttl > 0) {
        e.ttl -= dt;
        if (e.ttl <= 0 && !e.dying) {
          e.dying = true;
          e.fade = 0.2;
          e.fadeTotal = 0.2;
        }
      }
      e.t += dt;
      socketPos(ent, e.socket, v1);
      if (!e.has) {
        e.lx = v1.x; e.ly = v1.y; e.lz = v1.z;
        e.has = true;
      }
      const R = e.R;
      setBody(R, e.color >= 0 ? e.color : undefined);
      const mx = v1.x - e.lx;
      const my = v1.y - e.ly;
      const mz = v1.z - e.lz;
      const ml = Math.sqrt(mx * mx + my * my + mz * mz);
      const layers = R.layers;
      for (let l = 0; l < layers.length && l < 4; l++) {
        const L = layers[l];
        if (!L.rate || (L.hi && low)) continue;
        const rate = low ? (typeof L.lo === 'number' ? L.lo : L.rate * 0.5) : L.rate;
        e.acc[l] += rate * dt * k;
        let n = Math.floor(e.acc[l]);
        e.acc[l] -= n;
        if (n > 12) n = 12;
        for (let j = 0; j < n; j++) {
          const f = (j + 1) / n;
          const px = e.lx + mx * f;
          const py = e.ly + my * f;
          const pz = e.lz + mz * f;
          const pi = emitLayer(L, L.trail ? px : v1.x, L.trail ? py : v1.y, L.trail ? pz : v1.z, 0, 1, 0, e.sizeMul, hdrMul);
          if (pi >= 0 && L.trail && ml > 1e-3) {
            pool.vx[pi] = (mx / ml) * 0.05; pool.vy[pi] = (my / ml) * 0.05; pool.vz[pi] = (mz / ml) * 0.05;
            pool.stretch[pi] = -Math.max(0.2, Math.min(3, (ml / n) * 2.5));
            pool.life[pi] *= e.lifeMul;
          }
        }
      }
      if (R.ringSpin) {
        // the charge ring grows with the owner's real charge (0..1), else with time held
        const cs = ent.combat;
        const g = cs && cs.charge > 0 ? Math.min(1, cs.charge) : Math.min(1, e.t / 2);
        e.spin += dt * TAU * (1 + 5 * g);
        const s = (0.5 + 0.6 * g) * 2 * (e.dying ? k : 1);
        const h = (1.4 + 0.6 * g) * hdrMul;
        const throb = g >= 1 ? 1 + 0.12 * Math.sin(e.t * 26) : 1;
        parts.sprite(0, v1.x, v1.y, v1.z, s * throb, 0, CELL.ring, cBody.r * h, cBody.g * h, cBody.b * h, 0.9 * k, 0.5, 0, 0, 0, 0);
        parts.sprite(0, v1.x, v1.y, v1.z, s * 0.85, e.spin, CELL.glyph, 1.4, 1.4, 1.4, 0.7 * k, 0.3, 0, 0, 0, 0);
        parts.sprite(0, v1.x, v1.y, v1.z, s * (0.5 + 0.5 * g), 0, CELL.dot, cBody.r * h, cBody.g * h, cBody.b * h, (0.5 + 0.4 * g) * k, 1, 0, 0, 0, 0);
        // a soft halo around the whole body grows with the charge
        parts.sprite(0, v1.x, v1.y, v1.z, 1.2 + 2.2 * g, 0, CELL.dot, cBody.r, cBody.g, cBody.b, 0.25 * g * k, 0.2, 0, 0, 0, 0);
        if (g >= 1 && !e.full && !e.dying) {
          // fully charged: a ring pulse and sparks, once
          e.full = true;
          tmpOpts.dirX = 0; tmpOpts.dirY = 1; tmpOpts.dirZ = 0; tmpOpts.scale = 0.7; tmpOpts.color = cBody.getHex(); tmpOpts.count = undefined;
          vfx.burst('perfect', v1.x, v1.y, v1.z, tmpOpts);
        }
      }
      e.lx = v1.x; e.ly = v1.y; e.lz = v1.z;
    }
  }

  /** @param {any} c @param {number} dt @param {boolean} low */
  function updateBeams(c, dt, low) {
    const beams = mfx.beams;
    const r = c.render;
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      if (!b.active) continue;
      b.t += dt;
      if (b.timed > 0) {
        b.timed -= dt;
        if (b.timed <= 0) endBeam(b, b.kind === 1 ? 0.4 : 0.2);
      }
      if (b.followA) {
        const ea = c.ents.get(b.followA);
        const eb = c.ents.get(b.followB);
        if (!ea || !ea.alive || !eb || !eb.alive) {
          endBeam(b, 0.1);
        } else {
          socketPos(ea, 'chest', v2);
          socketPos(eb, 'chest', v3);
          b.ax = v2.x; b.ay = v2.y; b.az = v2.z; b.bx = v3.x; b.by = v3.y; b.bz = v3.z;
          b.hasSet = true;
        }
      }
      let k = 1;
      if (b.ending) {
        b.fadeT -= dt;
        if (b.fadeT <= 0) {
          b.active = false;
          b.mesh.visible = false;
          b.gen++;
          if (b.light) {
            b.light.release();
            b.light = null;
          }
          continue;
        }
        k = b.fadeT / b.fade;
      }
      if (!b.hasSet) {
        b.mesh.visible = false;
        continue;
      }
      // a Dawn Lance reads its charge: thinner when loosed early, full width (and brighter pulses) when charged
      const pw = b.kind === 0 ? b.power : 1;
      b.radius = b.baseRadius * (b.kind === 0 ? 0.62 + 0.38 * pw : 1) * (b.ending ? 0.3 + 0.7 * k : 1);
      b.mat.uniforms.uPulse.value = b.kind === 2 ? 1 : b.kind === 1 ? 0 : 0.5 + 0.7 * pw;
      const len = mfx.placeBeam(b);
      if (len <= 0) continue;
      const grow = b.kind === 0 ? Math.min(1, (b.t * 400) / len) : Math.min(1, b.t * 8);
      const u = b.mat.uniforms;
      u.uGrow.value = grow;
      // no bloom on low: the beam body itself carries the glow, so it is not dimmed there
      u.uIntensity.value = (1.0 + 0.7 * Math.min(1.5, b.intensity)) * (b.kind === 0 ? 1 + 0.25 * pw : low ? 0.8 : 1);
      u.uAlpha.value = Math.min(1, b.intensity * (b.kind === 0 ? 1.25 : 1)) * k;
      const col = u.uColor.value;
      const dx = (b.bx - b.ax) / len;
      const dy = (b.by - b.ay) / len;
      const dz = (b.bz - b.az) / len;
      const tip = len * grow;
      const tx = b.ax + dx * tip;
      const ty = b.ay + dy * tip;
      const tz = b.az + dz * tip;
      const rr = b.radius;
      const h = low ? 1.3 : 1.8;
      const ia = Math.min(1, b.intensity) * k;
      if (b.kind === 0) {
        // the ring the beam leaves through, glow sprites at both ends, end cap
        // the ring the beam leaves through stays a hand-sized ring (1-2 m), never a screen-sized glyph
        b.ringT += dt * 9;
        const ringS = Math.min(rr * 3.2, 1.1 + 0.9 * pw);
        parts.sprite(0, b.ax, b.ay, b.az, ringS, b.ringT, CELL.glyph, col.r * h, col.g * h, col.b * h, 0.85 * ia, 0.4, 0, 0, 0, 0);
        parts.sprite(0, b.ax, b.ay, b.az, ringS * 0.8, 0, CELL.dot, col.r * h, col.g * h, col.b * h, 0.9 * ia, 1, 0, 0, 0, 0);
        // the impact splash where the beam ends: a hot core, a spinning star and sparks thrown back
        parts.sprite(0, tx, ty, tz, rr * 3.4, 0, CELL.dot, col.r * h, col.g * h, col.b * h, 0.9 * ia, 1, 0, 0, 0, 0);
        parts.sprite(0, tx, ty, tz, rr * 3.2, b.t * 4, CELL.star, 1.6, 1.6, 1.6, 0.85 * ia, 1, 0, 0, 0, 0);
        if (grow >= 1 && !b.ending && dt > 0) {
          b.splashAcc += (low ? 30 : 50) * dt;
          let ns = Math.floor(b.splashAcc);
          b.splashAcc -= ns;
          if (ns > 4) ns = 4;
          for (let q = 0; q < ns; q++) {
            const pi = pool.alloc();
            if (pi < 0) break;
            let ux = rnd() * 2 - 1 - dx * 1.6;
            let uy = rnd() * 2 - 1 - dy * 1.6 + 0.4;
            let uz = rnd() * 2 - 1 - dz * 1.6;
            const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
            const sp = 7 + rnd() * 8;
            ux /= ul; uy /= ul; uz /= ul;
            pool.px[pi] = tx; pool.py[pi] = ty; pool.pz[pi] = tz;
            pool.vx[pi] = ux * sp; pool.vy[pi] = uy * sp; pool.vz[pi] = uz * sp;
            pool.life[pi] = 0.14 + rnd() * 0.1; pool.s0[pi] = 0.12; pool.s1[pi] = 0.04; pool.rot[pi] = 0; pool.rotV[pi] = 0;
            pool.cr[pi] = 2; pool.cg[pi] = 2; pool.cb[pi] = 2; pool.ca[pi] = 1;
            pool.grav[pi] = 6; pool.drag[pi] = 4; pool.core[pi] = 1; pool.stretch[pi] = 0.05; pool.fadeIn[pi] = 0;
            pool.mat[pi] = 1; pool.cell[pi] = CELL.streak; pool.frames[pi] = 1;
          }
        }
        // travelling pulses: bright knots racing from the hand to the tip (all tiers; glow sprites, no draw call)
        if (tip > 2) {
          const np = low ? 4 : 6;
          const pspd = 34 + 20 * pw;
          for (let q = 0; q < np; q++) {
            let s = (b.t * pspd + (q * tip) / np) % tip;
            if (s < 0) s += tip;
            const f = s / tip;
            const a = Math.min(1, f * 6) * Math.min(1, (1 - f) * 6) * ia;
            parts.sprite(0, b.ax + dx * s, b.ay + dy * s, b.az + dz * s, rr * (2.2 + 0.8 * pw), 0, CELL.dot, col.r * h, col.g * h, col.b * h, 0.7 * a, 1, 0, 0, 0, 0);
          }
        }
        if (!low) {
          let m = 0;
          for (let s = 4; s < tip - 1 && m < 24; s += 4, m++) {
            parts.sprite(0, b.ax + dx * s, b.ay + dy * s, b.az + dz * s, rr * 3.4, 0, CELL.ring, col.r * h, col.g * h, col.b * h, 0.35 * ia, 0.3, 0, 0, 0, 0);
          }
          if (!b.light && r && r.caps.pointLights > 0 && !b.ending) b.light = r.light.claim(2);
          if (b.light) b.light.set(b.ax, b.ay, b.az, col.getHex(), 2.2 * ia, 16);
        } else {
          // glow sprite fallback for bloom along the beam body
          const mid = tip * 0.5;
          parts.sprite(1, b.ax + dx * mid, b.ay + dy * mid, b.az + dz * mid, rr * 5, 0, CELL.streak, col.r, col.g, col.b, 0.45 * ia, 0, tip, dx, dy, dz);
        }
      } else if (b.kind === 1) {
        parts.sprite(0, b.ax, b.ay + 0.5, b.az, rr * 6, 0, CELL.dot, col.r * h, col.g * h, col.b * h, 0.8 * ia, 1, 0, 0, 0, 0);
      } else {
        parts.sprite(0, b.ax, b.ay, b.az, rr * 6, 0, CELL.dot, col.r * h, col.g * h, col.b * h, 0.7 * ia, 1, 0, 0, 0, 0);
      }
    }
  }

  /** Drop an aura's ground light. @param {any} a */
  function auraGlowOff(a) {
    if (a.glowId) vfx.removeDecal(a.glowId);
    a.glowId = 0;
  }

  /**
   * The Form ground light (ART_UX 2.3 'the body becomes a lantern'; light on the ground replaces bloom on low):
   * one persistent draped decal that follows the body, strength by aura level.
   * @param {any} a @param {number} x @param {number} z @param {number} k strength 0..1
   */
  function auraGlow(a, x, z, k, radius) {
    let d = a.glowId ? mfx.findDecal(a.glowId) : null;
    if (!d || d.out > 0) {
      decalOpts.color = a.color.getHex(); decalOpts.seconds = undefined; decalOpts.shape = 'circle';
      a.glowId = vfx.decal('glow', x, z, radius, decalOpts);
      d = a.glowId ? mfx.findDecal(a.glowId) : null;
      if (!d) return;
      a.gx = x;
      a.gz = z;
      a.gr = radius;
    }
    const dx = x - a.gx;
    const dz = z - a.gz;
    if (dx * dx + dz * dz > 0.04 || Math.abs(radius - a.gr) > 0.12) {
      mfx.drape(d, 0, x, z, radius, 0, 0, 1, 0);
      a.gx = x;
      a.gz = z;
      a.gr = radius;
    }
    const u = d.mat.uniforms;
    u.uColor.value.copy(a.style >= 2 && a.style <= 4 ? FLAME_BODY[a.style] : a.color).multiplyScalar(1.25);
    u.uRing.value = a.style;
    d.fill = k;
  }

  /** Release an aura's flame planes. @param {any} a */
  function flameOff(a) {
    const f = a.flame;
    if (!f) return;
    f.active = false;
    f.entId = 0;
    f.back.visible = false;
    f.front.visible = false;
    a.flame = null;
  }

  /**
   * The persistent Form (and Gather) flame aura: two camera-facing planes of the flame shader around the body,
   * the back one behind the body (the body hides its middle), the front one with wisps and streaks only.
   * @param {any} a @param {number} x @param {number} y feet @param {number} z @param {number} h @param {number} rad
   * @param {number} k strength @param {number} swell 0..1+ @param {number} col transformation column 0..1 @param {boolean} low
   */
  function flameAura(a, x, y, z, h, rad, k, swell, col, low) {
    let f = a.flame;
    if (!f) {
      const list = mfx.flames;
      for (let i = 0; i < list.length; i++) if (!list[i].active) { f = list[i]; break; }
      if (!f) return;
      f.active = true;
      f.entId = a.entId;
      a.flame = f;
    }
    const cp = ctx.render && ctx.render.globals ? ctx.render.globals.uCamPos.value : null;
    let dx = cp ? cp.x - x : 0;
    let dz = cp ? cp.z - z : 1;
    const dl = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= dl;
    dz /= dl;
    const yaw = Math.atan2(dx, dz);
    const st = a.style >= 1 && a.style <= 4 ? a.style : 1;
    const gather = st === 1;
    const hw = (rad + (gather ? 0.5 : 0.78)) * (1 + 0.22 * swell) * (1 - 0.35 * col);
    const hh = h * (gather ? 0.72 : 0.95) * (1 + 0.14 * swell + 1.1 * col);
    const py = y - 0.1 + hh;
    const style = gather ? 9 : st + 4;
    cFlB.copy(gather ? a.color : FLAME_BODY[st]);
    cFlT.copy(FLAME_TIP[st]);
    const inten = (low ? 1.2 : 1.35) * (1 + 0.25 * swell + 0.3 * col);
    const alphaK = Math.min(1, k * 1.2) * (gather ? 0.8 : 1);
    // Ember's front wisps are alpha-blended too: additive orange over bright green grass adds up to yellow
    f.front.material.blending = st === 2 ? NormalBlending : AdditiveBlending;
    for (let l = 0; l < 2; l++) {
      const m = l === 0 ? f.back : f.front;
      const off = l === 0 ? -0.3 : 0.38;
      m.position.set(x + dx * off, py, z + dz * off);
      m.rotation.set(0, yaw, 0);
      m.scale.set(hw, hh, 1);
      m.visible = true;
      const u = m.material.uniforms;
      u.uStyle.value = style + l * 5;
      u.uColor.value.copy(cFlB);
      u.uFringe.value.copy(cFlT);
      u.uIntensity.value = l === 0 ? 1 : inten;
      u.uAlpha.value = alphaK * (l === 0 ? 1 : 0.9);
      u.uPhase.value = a.flowT;
      u.uFlare.value = Math.min(1.2, swell * 0.8 + col * 0.6);
    }
  }

  /**
   * Gather (charging Ora): energy streams inward toward the chest, small stones and motes lift around the feet.
   * @param {any} a @param {number} dt @param {number} h @param {number} rad @param {boolean} low
   */
  function gatherFx(a, dt, h, rad, low) {
    const charge = Math.min(1, a.gatherT / 2.5);
    a.acc3 += (low ? 26 : 50) * (0.6 + 0.6 * charge) * dt;
    let n = Math.floor(a.acc3);
    a.acc3 -= n;
    if (n > 6) n = 6;
    const tx = v1.x;
    const ty = v1.y + h * 0.55;
    const tz = v1.z;
    for (let q = 0; q < n; q++) {
      const pi = pool.alloc();
      if (pi < 0) break;
      const ang = rnd() * TAU;
      const r0 = rad + 1.8 + rnd() * 1.4;
      const sx = tx + Math.cos(ang) * r0;
      const sy = v1.y + 0.1 + rnd() * h * 1.2;
      const sz = tz + Math.sin(ang) * r0;
      let ex = tx - sx;
      let ey = ty - sy;
      let ez = tz - sz;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
      const sp = 5 + 3 * charge + rnd() * 1.5;
      ex /= d; ey /= d; ez /= d;
      const fr = rnd() < 0.3;
      tokenColor(fr ? 'fringe' : 'body', cTok);
      const hh = 1.7 * (low ? 0.85 : 1);
      pool.px[pi] = sx; pool.py[pi] = sy; pool.pz[pi] = sz;
      pool.vx[pi] = ex * sp; pool.vy[pi] = ey * sp; pool.vz[pi] = ez * sp;
      pool.life[pi] = Math.max(0.1, (d - rad * 0.6) / sp);
      pool.s0[pi] = 0.075; pool.s1[pi] = 0.03;
      pool.rot[pi] = 0; pool.rotV[pi] = 0;
      pool.cr[pi] = cTok.r * hh; pool.cg[pi] = cTok.g * hh; pool.cb[pi] = cTok.b * hh; pool.ca[pi] = fr ? 0.7 : 1;
      pool.grav[pi] = 0; pool.drag[pi] = 0; pool.core[pi] = 0.6; pool.stretch[pi] = 0.11; pool.fadeIn[pi] = 0.25;
      pool.mat[pi] = 1; pool.cell[pi] = CELL.streak; pool.frames[pi] = 1;
    }
    // stones lifting off the ground around the feet, higher as the charge grows
    const stones = low ? 8 : 12;
    const base = v1.y + 0.1 + 0.55 * charge;
    for (let q = 0; q < stones; q++) {
      const ang = a.phase * 0.8 + (q * TAU) / stones;
      const rr = rad + 0.9 + 0.35 * Math.sin(q * 2.1 + a.phase * 0.5);
      const yy = base + 0.4 * Math.sin(q * 1.7 + a.phase * 1.6) * charge + (q % 3) * 0.15 * charge;
      parts.sprite(2, v1.x + Math.cos(ang) * rr, yy, v1.z + Math.sin(ang) * rr, 0.1 + 0.05 * (q % 3), ang * 3, CELL.pebble,
        0.75, 0.68, 0.6, Math.min(1, a.gatherT * 2), 0, 0, 0, 0, 0);
    }
    // a growing ring of light on the ground and a dust ring pushed out every 0.5-0.8 s
    auraGlow(a, v1.x, v1.z, 0.6 + 0.4 * charge, 1.6 + 1.6 * charge);
    a.dustT -= dt;
    if (a.dustT <= 0) {
      a.dustT = 0.8 - 0.3 * charge;
      waveOpts.radius = rad + 2 + 1.5 * charge; waveOpts.seconds = 0.5; waveOpts.color = PALETTE.paper; waveOpts.sphere = false; waveOpts.ground = true;
      vfx.shockwave(v1.x, v1.y, v1.z, waveOpts);
    }
  }

  /**
   * The transformation (about 1-1.5 s, ART_UX 3.2 without the screen white-out): debris and motes lift around the
   * hero inside a rising column of the Form flame and a growing ground light; transformEnd throws them outward.
   * @param {any} a @param {number} dt @param {number} rad @param {boolean} low
   */
  function transformFx(a, dt, rad, low) {
    const e = Math.min(1, a.transT / 1.1);
    a.acc3 += (low ? 22 : 40) * dt;
    let n = Math.floor(a.acc3);
    a.acc3 -= n;
    if (n > 5) n = 5;
    for (let q = 0; q < n; q++) {
      const pi = pool.alloc();
      if (pi < 0) break;
      const ang = rnd() * TAU;
      const rr = rad + 0.5 + rnd() * (1.5 + 2 * e);
      const stone = rnd() < 0.5;
      pool.px[pi] = v1.x + Math.cos(ang) * rr; pool.py[pi] = v1.y + 0.05; pool.pz[pi] = v1.z + Math.sin(ang) * rr;
      pool.vx[pi] = (rnd() - 0.5) * 0.4; pool.vy[pi] = stone ? 1.2 + rnd() * 1.6 : 2.5 + rnd() * 3; pool.vz[pi] = (rnd() - 0.5) * 0.4;
      pool.life[pi] = stone ? 1.0 + rnd() * 0.5 : 0.6 + rnd() * 0.5;
      pool.rot[pi] = rnd() * TAU; pool.rotV[pi] = stone ? (rnd() - 0.5) * 4 : 0; pool.fadeIn[pi] = 0.1; pool.frames[pi] = 1;
      pool.grav[pi] = stone ? -0.3 : -0.8; pool.drag[pi] = 0.6; pool.stretch[pi] = 0;
      if (stone) {
        pool.mat[pi] = 2; pool.cell[pi] = CELL.pebble; pool.s0[pi] = 0.12 + rnd() * 0.1; pool.s1[pi] = 0.1; pool.core[pi] = 0;
        pool.cr[pi] = 0.72; pool.cg[pi] = 0.64; pool.cb[pi] = 0.56; pool.ca[pi] = 1;
      } else {
        const hh = 1.8 * (low ? 0.85 : 1);
        pool.mat[pi] = 0; pool.cell[pi] = CELL.spark; pool.s0[pi] = 0.16; pool.s1[pi] = 0.04; pool.core[pi] = 0.6;
        pool.cr[pi] = cFlT.r * hh; pool.cg[pi] = cFlT.g * hh; pool.cb[pi] = cFlT.b * hh; pool.ca[pi] = 1;
      }
    }
    auraGlow(a, v1.x, v1.z, 0.7 + 0.3 * e, 1.8 + 2.6 * e);
  }

  /** The end of the transformation: a dust ring and the lifted debris thrown outward. @param {number} rad */
  function transformEnd(rad) {
    waveOpts.radius = rad + 7; waveOpts.seconds = 0.6; waveOpts.color = PALETTE.paper; waveOpts.sphere = false; waveOpts.ground = true;
    vfx.shockwave(v1.x, v1.y, v1.z, waveOpts);
    for (let q = 0; q < 16; q++) {
      const pi = pool.alloc();
      if (pi < 0) break;
      const ang = (q / 16) * TAU + rnd() * 0.3;
      const sp = 7 + rnd() * 5;
      pool.px[pi] = v1.x + Math.cos(ang) * (rad + 0.6); pool.py[pi] = v1.y + 0.3 + rnd() * 0.8; pool.pz[pi] = v1.z + Math.sin(ang) * (rad + 0.6);
      pool.vx[pi] = Math.cos(ang) * sp; pool.vy[pi] = 2 + rnd() * 3; pool.vz[pi] = Math.sin(ang) * sp;
      pool.life[pi] = 0.7 + rnd() * 0.4; pool.rot[pi] = rnd() * TAU; pool.rotV[pi] = (rnd() - 0.5) * 8; pool.fadeIn[pi] = 0; pool.frames[pi] = 1;
      pool.grav[pi] = 12; pool.drag[pi] = 1.2; pool.stretch[pi] = 0; pool.mat[pi] = 2; pool.cell[pi] = CELL.pebble;
      pool.s0[pi] = 0.14 + rnd() * 0.1; pool.s1[pi] = 0.12; pool.core[pi] = 0;
      pool.cr[pi] = 0.72; pool.cg[pi] = 0.64; pool.cb[pi] = 0.56; pool.ca[pi] = 1;
    }
  }

  /** @param {any} c @param {number} dt @param {number} alpha @param {boolean} low */
  function updateAuras(c, dt, alpha, low) {
    const hdrMul = low ? 0.8 : 1;
    for (let i = 0; i < auras.length; i++) {
      const a = auras[i];
      if (a.entId === 0) continue;
      const ent = c.ents.get(a.entId);
      const s = a.shell;
      if (!ent || (!ent.alive && a.cur <= 0.01)) {
        a.entId = 0;
        a.gen++;
        s.active = false;
        s.mesh.visible = false;
        auraGlowOff(a);
        flameOff(a);
        continue;
      }
      if (a.releasing) {
        a.cur -= dt / 0.25;
        if (a.cur <= 0) {
          a.entId = 0;
          s.active = false;
          s.mesh.visible = false;
          auraGlowOff(a);
          flameOff(a);
          continue;
        }
      } else {
        a.cur += (a.target - a.cur) * Math.min(1, dt * 10);
      }
      if (a.flareT > 0) a.flareT -= dt;
      const cur = a.cur;
      const form = a.style >= 2 && a.style <= 4;
      const cs = ent.combat;
      const transforming = !!(cs && cs.state === 'transform');
      // the player's Gather and charge (Dawn Lance, Breaker) both wear the flame: the shell egg is for enemies
      const gathering = a.style === 1 && !!(cs && (cs.gathering || (cs.charge > 0 && cs.state === 'windup' && ent === c.player)));
      if (cur <= 0.01) {
        s.mesh.visible = false;
        auraGlowOff(a);
        flameOff(a);
        a.gatherT = 0;
        continue;
      }
      c.ents.renderPos(ent, alpha, v1);
      const h = ent.height > 0 ? ent.height : 1.8;
      const rad = ent.radius > 0 ? ent.radius : 0.5;
      const flare = a.flareT > 0 ? a.flareT / 0.15 : 0;
      const grow = 1 + flare * 0.25;
      // Forms and the player's Gather wear the flame aura instead of the shell (lead decision, overriding ART_UX
      // 2.3's 'no shell at rest'); beam charge and the enemy aura keep the cheap shell.
      const flameOn = form || gathering;
      if (flameOn) {
        s.mesh.visible = false;
        const attacking = !!(cs && (cs.state === 'windup' || cs.state === 'active'));
        a.swell += ((attacking ? 1 : 0) - a.swell) * Math.min(1, dt * (attacking ? 14 : 3));
        const surgeK = cs && cs.surge > 0 ? Math.min(1, cs.surge / 100) : 0;
        if (transforming) {
          if (!a.wasTrans) { a.transT = 0; a.wasTrans = true; }
          a.transT += dt;
          a.colK = Math.min(1, a.colK + dt * 3);
        } else {
          if (a.wasTrans) { a.wasTrans = false; a.swell = 1.3; transformEnd(rad); }
          a.colK = Math.max(0, a.colK - dt * 2.5);
        }
        a.flowT += dt * (0.9 + 0.7 * a.swell + 0.4 * a.colK);
        if (gathering) a.gatherT += dt; else a.gatherT = 0;
        flameAura(a, v1.x, v1.y, v1.z, h, rad, cur, a.swell + 0.45 * surgeK, a.colK, low);
        if (transforming) transformFx(a, dt, rad, low);
      } else {
        flameOff(a);
        a.gatherT = 0;
        a.wasTrans = false;
        a.colK = 0;
        s.mesh.position.set(v1.x, v1.y + h * 0.5, v1.z);
        s.mesh.scale.set((rad * 1.3 + 0.3) * grow, h * 0.68 * grow, (rad * 1.3 + 0.3) * grow);
        // a Form or Gather fading out to nothing never flashes the shell egg on its way down
        s.mesh.visible = a.target > 0.01 || a.releasing;
        const u = s.mat.uniforms;
        u.uStyle.value = a.style;
        u.uColor.value.copy(a.color);
        u.uFringe.value.copy(a.fringe);
        u.uIntensity.value = (1.1 + 0.9 * cur) * hdrMul;
        u.uAlpha.value = Math.min(1, cur * 1.1) * (low ? 0.85 : 1);
        u.uFlare.value = flare;
      }
      const speed = a.style === 3 ? 1.9 : a.style === 4 ? 0.5 : a.style === 2 ? 1.2 : 0.9;
      a.phase += dt * speed * (0.6 + 1.6 * cur);
      if (!form) s.mat.uniforms.uPhase.value = a.phase;
      cBody.copy(a.color);
      cFringe.copy(a.fringe);
      // rising streaks (40/s on high, 15/s on low at full); Forms keep them thin and few: they are accents
      a.acc += (low ? 15 : 40) * cur * dt * (form ? 0.9 + 0.6 * a.swell : gathering ? 0.4 : 1);
      let n = Math.floor(a.acc);
      a.acc -= n;
      if (n > 8) n = 8;
      for (let k = 0; k < n; k++) {
        const ang = rnd() * TAU;
        const rr = rad * (0.8 + 0.7 * rnd());
        const pi = pool.alloc();
        if (pi < 0) break;
        const fr = a.style === 5 || rnd() < 0.3;
        tokenColor(fr ? 'fringe' : 'body', cTok);
        const hh = (a.style === 4 ? 1.4 : 1.8) * hdrMul;
        pool.px[pi] = v1.x + Math.cos(ang) * rr; pool.py[pi] = v1.y + rnd() * h * 0.4; pool.pz[pi] = v1.z + Math.sin(ang) * rr;
        const vy = (a.style === 2 ? 4.5 : a.style === 4 ? 2.4 : 3.6) + rnd() * 2 * cur;
        pool.vx[pi] = (rnd() - 0.5) * 0.4; pool.vy[pi] = vy; pool.vz[pi] = (rnd() - 0.5) * 0.4;
        pool.life[pi] = 0.35 + rnd() * 0.3;
        pool.s0[pi] = a.style === 2 ? 0.09 : 0.06; pool.s1[pi] = 0.02;
        pool.rot[pi] = 0; pool.rotV[pi] = 0;
        pool.cr[pi] = cTok.r * hh; pool.cg[pi] = cTok.g * hh; pool.cb[pi] = cTok.b * hh; pool.ca[pi] = fr ? 0.6 : 0.95;
        pool.grav[pi] = 0; pool.drag[pi] = 0.5; pool.core[pi] = 0.5; pool.stretch[pi] = a.style === 4 ? 0.05 : 0.09; pool.fadeIn[pi] = 0.1;
        pool.mat[pi] = 1; pool.cell[pi] = CELL.streak; pool.frames[pi] = 1;
      }
      // style accents: Ember motes rising from the body, Zenith star motes (Tempest has its ribbons instead)
      if (a.style !== 3) {
        a.acc2 += (a.style === 2 ? (low ? 26 : 32) * (1 + 0.6 * a.swell) : a.style === 4 ? 12 : 6) * cur * dt;
        let m = Math.floor(a.acc2);
        a.acc2 -= m;
        if (m > 4) m = 4;
        if (low && !form) m = 0;
        for (let k = 0; k < m; k++) {
          const ang = rnd() * TAU;
          const pi = pool.alloc();
          if (pi < 0) break;
          const y0 = v1.y + (0.25 + rnd() * 0.7) * h;
          pool.px[pi] = v1.x + Math.cos(ang) * rad * 0.9; pool.py[pi] = y0; pool.pz[pi] = v1.z + Math.sin(ang) * rad * 0.9;
          pool.rot[pi] = rnd() * TAU; pool.rotV[pi] = 0; pool.fadeIn[pi] = 0; pool.frames[pi] = 1; pool.drag[pi] = 1;
          pool.vx[pi] = (rnd() - 0.5) * 0.7; pool.vy[pi] = a.style === 2 ? 1.2 + rnd() * 1.6 : 0.6; pool.vz[pi] = (rnd() - 0.5) * 0.7;
          pool.life[pi] = a.style === 2 ? 0.9 + rnd() * 0.7 : 0.5 + rnd() * 0.5; pool.s0[pi] = a.style === 4 ? 0.2 : 0.17; pool.s1[pi] = 0.04; pool.stretch[pi] = 0;
          pool.mat[pi] = 0; pool.cell[pi] = a.style === 4 ? CELL.star : CELL.spark; pool.grav[pi] = a.style === 2 ? -0.6 : 0; pool.core[pi] = 0.6;
          const hh = 1.8 * hdrMul;
          const hot = a.style === 2 && rnd() < 0.35;
          pool.cr[pi] = (a.style === 4 || hot ? 1 : cBody.r) * hh; pool.cg[pi] = (a.style === 4 || hot ? 0.95 : cBody.g) * hh; pool.cb[pi] = (a.style === 4 || hot ? 0.85 : cBody.b) * hh;
          pool.ca[pi] = 1;
        }
      }
      if (form) {
        const k = Math.min(1, cur * 1.15);
        // lantern glow: soft additive sprites on the chest and hands stand in for bloom (all tiers)
        const pulse = 0.85 + 0.15 * Math.sin(a.phase * 3.1);
        const gl = 1.15 * hdrMul;
        if (c.actors && c.actors.socket) {
          c.actors.socket(ent, 'chest', v2);
          parts.sprite(0, v2.x, v2.y, v2.z, h * 0.75 * pulse, 0, CELL.dot, cBody.r * gl, cBody.g * gl, cBody.b * gl, 0.42 * k, 0.15, 0, 0, 0, 0);
          c.actors.socket(ent, 'handR', v2);
          parts.sprite(0, v2.x, v2.y, v2.z, 0.42 * pulse, 0, CELL.dot, cBody.r * gl, cBody.g * gl, cBody.b * gl, 0.75 * k, 0.5, 0, 0, 0, 0);
          c.actors.socket(ent, 'handL', v2);
          parts.sprite(0, v2.x, v2.y, v2.z, 0.42 * pulse, 0, CELL.dot, cBody.r * gl, cBody.g * gl, cBody.b * gl, 0.75 * k, 0.5, 0, 0, 0, 0);
          c.actors.socket(ent, 'head', v2);
          parts.sprite(0, v2.x, v2.y + 0.05, v2.z, 0.55, 0, CELL.dot, cBody.r * gl, cBody.g * gl, cBody.b * gl, 0.28 * k, 0.1, 0, 0, 0, 0);
        }
        const fy = Math.sin(ent.yaw);
        const fz = Math.cos(ent.yaw);
        if (a.style === 3) {
          // Tempest: three paper-cut wind ribbons on tilted orbits around the body (no lightning, no arcs)
          for (let r = 0; r < 3; r++) {
            const tilt = r === 0 ? 0.45 : r === 1 ? -0.38 : 0.12;
            const az = r * 2.1;
            const orb = rad + 0.45 + r * 0.12;
            const cy = v1.y + h * (0.32 + r * 0.2);
            const head = a.phase * (2.6 + r * 0.5) + r * 2.0;
            for (let q = 0; q < 6; q++) {
              const th = head - q * 0.24;
              const ox = Math.cos(th) * orb;
              const oz = Math.sin(th) * orb;
              const oy = Math.sin(th + az) * orb * tilt;
              const tx = -Math.sin(th);
              const tz = Math.cos(th);
              const ty = Math.cos(th + az) * tilt;
              const fade = (1 - q / 6) * k;
              const w = 1.5 * hdrMul;
              parts.sprite(1, v1.x + ox, cy + oy, v1.z + oz, 0.07 + 0.03 * (1 - q / 6), 0, CELL.streak, cFringe.r * w, cFringe.g * w, cFringe.b * w, 0.9 * fade, 0.6, 0.34, tx, ty, tz);
            }
          }
          // a gust ring at the feet every 0.9 s
          a.dustT -= dt;
          if (a.dustT <= 0 && cur > 0.3) {
            a.dustT = 0.9;
            waveOpts.radius = rad + 2.4; waveOpts.seconds = 0.55; waveOpts.color = a.fringe.getHex(); waveOpts.sphere = false; waveOpts.ground = true;
            vfx.shockwave(v1.x, v1.y, v1.z, waveOpts);
          }
        } else if (a.style === 4) {
          // Zenith: six slow motes orbiting behind the shoulders and a thin halo
          for (let q = 0; q < 6; q++) {
            const th = a.phase * 0.9 + (q * TAU) / 6;
            const rr = rad + 0.55;
            const yy = v1.y + h * (0.55 + 0.25 * Math.sin(th * 2 + q));
            parts.sprite(0, v1.x + Math.cos(th) * rr - fy * 0.15, yy, v1.z + Math.sin(th) * rr - fz * 0.15, 0.16, th, CELL.star, 1.6 * hdrMul, 1.55 * hdrMul, 1.7 * hdrMul, 0.85 * k, 0.6, 0, 0, 0, 0);
          }
          parts.sprite(0, v1.x - fy * 0.12, v1.y + h + 0.22, v1.z - fz * 0.12, 0.62, a.phase, CELL.ring, 1.5 * hdrMul, 1.5 * hdrMul, 1.6 * hdrMul, 0.5 * k, 0.5, 0, 0, 0, 0);
        } else if (a.style === 2) {
          // Ember: the sash burns, a trail of hot sparks behind the back
          if (c.actors && c.actors.socket) {
            c.actors.socket(ent, 'back', v2);
            for (let q = 0; q < 3; q++) {
              const sx = v2.x - fy * (0.15 + q * 0.18);
              const sz = v2.z - fz * (0.15 + q * 0.18);
              parts.sprite(0, sx, v2.y - 0.25 - q * 0.22, sz, 0.34 - q * 0.06, 0, CELL.dot, 1.6 * hdrMul, 1.05 * hdrMul, 0.6 * hdrMul, 0.55 * k, 0.4, 0, 0, 0, 0);
            }
          }
        }
        if (!transforming) {
          auraGlow(a, v1.x, v1.z, (0.8 + 0.2 * Math.sin(a.phase * 2.3)) * Math.min(1, k * (1 + 0.3 * a.swell)), 2.9 + 0.5 * a.swell);
          // Ember and Zenith push a soft dust ring out from the feet (Tempest has its gust ring)
          if (a.style !== 3) {
            a.ringT -= dt;
            if (a.ringT <= 0 && cur > 0.3) {
              a.ringT = a.style === 4 ? 2.2 : 1.5;
              waveOpts.radius = rad + 2.6; waveOpts.seconds = 0.7; waveOpts.color = PALETTE.paper; waveOpts.sphere = false; waveOpts.ground = true;
              vfx.shockwave(v1.x, v1.y, v1.z, waveOpts);
            }
          }
        }
      } else if (gathering) {
        gatherFx(a, dt, h, rad, low);
      } else {
        auraGlowOff(a);
      }
      if (!low) {
        // orbiting pebbles and the ground dust ring every 600 ms (Gather and charge; Forms have their own)
        if (!form && !gathering) {
          const base = v1.y + 0.15 + 0.5 * cur;
          for (let k = 0; k < 12; k++) {
            const ang = a.phase * 1.3 + (k * TAU) / 12;
            const rr = rad + 0.9 + 0.25 * Math.sin(k * 2.1 + a.phase);
            const yy = base + 0.35 * Math.sin(k * 1.7 + a.phase * 2) * cur;
            parts.sprite(2, v1.x + Math.cos(ang) * rr, yy, v1.z + Math.sin(ang) * rr, 0.12 + 0.05 * (k % 3), ang, CELL.pebble,
              0.75, 0.68, 0.6, Math.min(1, cur * 1.5), 0, 0, 0, 0, 0);
          }
          a.dustT -= dt;
          if (a.dustT <= 0 && cur > 0.3) {
            a.dustT = 0.6;
            waveOpts.radius = rad + 2.2; waveOpts.seconds = 0.5; waveOpts.color = PALETTE.paper; waveOpts.sphere = false; waveOpts.ground = true;
            vfx.shockwave(v1.x, v1.y, v1.z, waveOpts);
          }
        }
      }
      if (cur > 0.98 && !a.wasFull && !a.releasing) {
        a.wasFull = true;
        waveOpts.radius = rad + 3.5; waveOpts.seconds = 0.32; waveOpts.color = a.color.getHex(); waveOpts.sphere = false; waveOpts.ground = true;
        vfx.shockwave(v1.x, v1.y, v1.z, waveOpts);
        parts.sprite(0, v1.x, v1.y + h * 0.5, v1.z, h * 2.5, 0, CELL.ring, a.color.r * 2, a.color.g * 2, a.color.b * 2, 0.8, 0.5, 0, 0, 0, 0);
        if (ctx.fx) ctx.fx.flash(a.color.getHex(), 0.1, 0.12);
      } else if (cur < 0.9) {
        a.wasFull = false;
      }
    }
  }

  /** Fractional part of a hash of i (stable per streak). @param {number} i @param {number} k */
  function h01(i, k) {
    const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * Speed (ART_UX 3.x boost feel, FOV-independent): while the player boosts, world-space wind streaks stream past
   * the body along its velocity, and at the sonic stage the screen speed lines (render overlay, also on low) run.
   * @param {any} c @param {number} dt @param {number} alpha @param {boolean} low
   */
  function updateSpeed(c, dt, alpha, low) {
    const p = c.player;
    const mv = p && p.alive ? p.move : null;
    const flying = !!mv && (mv.mode === 'fly' || mv.mode === 'air');
    const v = p ? Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y + p.vel.z * p.vel.z) : 0;
    const target = !p || !p.alive || pBoost === 0 || v < 8 ? 0 : pBoost === 2 ? 1 : flying ? 0.45 : 0.3;
    speedK += (target - speedK) * Math.min(1, dt * (target > speedK ? 6 : 3));
    if (speedK < 0.02 || !p) return;
    if (pBoost === 2 && ctx.render && typeof ctx.render.speedLines === 'function') ctx.render.speedLines(0.35 + 0.65 * speedK);
    speedT += dt;
    c.ents.renderPos(p, alpha, v1);
    const inv = 1 / Math.max(0.001, v);
    const dx = p.vel.x * inv;
    const dy = p.vel.y * inv;
    const dz = p.vel.z * inv;
    // a frame around the velocity axis
    let ux = 0; let uy = 1; let uz = 0;
    if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; }
    let rx = dy * uz - dz * uy; let ry = dz * ux - dx * uz; let rz = dx * uy - dy * ux;
    const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const qx = ry * dz - rz * dy; const qy = rz * dx - rx * dz; const qz = rx * dy - ry * dx;
    const n = Math.round((low ? 34 : 56) * speedK);
    const span = 34;
    const cy = v1.y + (p.height || 1.8) * 0.5;
    const rate = (v + 20) / span;
    for (let i = 0; i < n; i++) {
      const ph = speedT * rate * (0.8 + 0.4 * h01(i, 1)) + h01(i, 2);
      const f = ph - Math.floor(ph);
      const along = (0.6 - f) * span;
      const ang = h01(i, 3) * TAU;
      const rad = 1.6 + 5.5 * h01(i, 4);
      const ox = Math.cos(ang) * rad;
      const oy = Math.sin(ang) * rad;
      const px = v1.x + dx * along + rx * ox + qx * oy;
      const py = cy + dy * along + ry * ox + qy * oy;
      const pz = v1.z + dz * along + rz * ox + qz * oy;
      const fade = Math.min(1, f * 5) * Math.min(1, (1 - f) * 4) * speedK;
      const len = (2 + 4 * h01(i, 5)) * (0.5 + 0.5 * speedK);
      const w = 0.07 + 0.07 * h01(i, 6);
      parts.sprite(1, px, py, pz, w, 0, CELL.streak, 1.3, 1.35, 1.4, 0.6 * fade, 0.3, len, dx, dy, dz);
    }
  }

  /**
   * Weather layer (driven by env.setFog's `snow`): wind-blown snow streaks in a box around the camera.
   * @param {any} c @param {number} dt @param {boolean} low
   */
  function updateWeather(c, dt, low) {
    weatherK += (weatherTarget - weatherK) * Math.min(1, dt * 1.5);
    if (weatherK < 0.02) return;
    const cam = c.three && c.three.camera;
    if (!cam) return;
    weatherT += dt;
    const W = ctx.render && ctx.render.globals ? ctx.render.globals.uWind.value : null;
    const wx = W ? W.x * 7 : 5;
    const wz = W ? W.z * 7 : 2;
    const n = Math.round((low ? 170 : 300) * weatherK);
    const B = 20;
    const H = 14;
    const cx = cam.position.x;
    const cy = cam.position.y;
    const cz = cam.position.z;
    const fall = 5.5;
    for (let i = 0; i < n; i++) {
      const sp = 0.75 + 0.5 * h01(i, 7);
      // positions wrap inside the box around the camera, so the snow never runs out and never pops
      let x = h01(i, 8) * B + wx * weatherT * sp - cx;
      let y = h01(i, 9) * H - fall * weatherT * sp - cy;
      let z = h01(i, 10) * B + wz * weatherT * sp - cz;
      x -= Math.floor(x / B) * B; y -= Math.floor(y / H) * H; z -= Math.floor(z / B) * B;
      const px = cx + x - B * 0.5;
      const py = cy + y - H * 0.5;
      const pz = cz + z - B * 0.5;
      const edge = Math.min(1, Math.min(x, B - x, z, B - z) / 3) * Math.min(1, Math.min(y, H - y) / 2);
      // normal-blended soft flakes: additive white would vanish against the bright fog
      parts.sprite(2, px, py, pz, 0.12 + 0.12 * h01(i, 11), 0, CELL.dot, 1, 1, 1, 0.95 * edge * weatherK, 0.8, 0, 0, 0, 0);
    }
  }

  /** @param {any} c @param {number} dt */
  function updateShells(c, dt) {
    const shells = mfx.shells;
    for (let i = 0; i < shells.length; i++) {
      const s = shells[i];
      if (!s.active || s.kind !== 0) continue;
      s.t += dt;
      const k = Math.min(1, s.t / s.seconds);
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      const rr = Math.max(0.01, s.radius * e);
      s.mesh.scale.setScalar(rr);
      // a shockwave sphere that has swept past the camera would wash the whole screen (and hide the player in
      // the crater): it fades out while the camera is inside it
      let inside = 1;
      const cp = ctx.render && ctx.render.globals ? ctx.render.globals.uCamPos.value : null;
      if (cp) {
        const d = cp.distanceTo(s.mesh.position);
        if (d < rr) inside = d > rr * 0.85 ? (d - rr * 0.85) / (rr * 0.15) : 0;
      }
      s.mat.uniforms.uAlpha.value = Math.pow(1 - k, 1.4) * inside;
      // fully faded spheres around the camera are not drawn at all (a screen of overdraw on the phone)
      s.mesh.visible = inside > 0.01;
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
  }

  /** @param {number} dt */
  function updateDecals(dt) {
    const decals = mfx.decals;
    for (let i = 0; i < decals.length; i++) {
      const d = decals[i];
      if (!d.active) continue;
      d.age += dt;
      const u = d.mat.uniforms;
      let a = Math.min(1, d.age / 0.08);
      let t;
      if (d.seconds > 0) {
        t = d.age / d.seconds;
        if (t >= 1) {
          d.active = false;
          d.mesh.visible = false;
          continue;
        }
        if (d.kind === 2 || d.kind === 3) a *= t > 0.85 ? (1 - t) / 0.15 : 1;
      } else {
        t = d.age * 0.5;
      }
      if (d.autoFill > 0) d.fill = Math.min(1, d.age / d.autoFill);
      if (d.out > 0) {
        d.outT -= dt;
        if (d.outT <= 0) {
          d.active = false;
          d.mesh.visible = false;
          continue;
        }
        a *= d.outT / d.out;
      }
      u.uT.value = t;
      u.uFill.value = d.fill;
      u.uAlpha.value = a;
      if (d.kind === 4) u.uRing.value = 1 - (1 - t) * (1 - t) * (1 - t);
    }
  }

  /** @param {any} c @param {number} dt @param {number} alpha @param {boolean} low */
  function updateProjectiles(c, dt, alpha, low) {
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      if (p.entId === 0) continue;
      const ent = c.ents.get(p.entId);
      if (!ent || !ent.alive) {
        p.entId = 0;
        continue;
      }
      c.ents.renderPos(ent, alpha, v1);
      let dx = ent.vel.x;
      let dy = ent.vel.y;
      let dz = ent.vel.z;
      let dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dl < 1e-3 && p.has) {
        dx = v1.x - p.lx; dy = v1.y - p.ly; dz = v1.z - p.lz;
        dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      if (dl < 1e-4) {
        dx = 0; dy = 0; dz = 1; dl = 1;
      }
      dx /= dl; dy /= dl; dz /= dl;
      const col = p.color;
      const h = low ? 1.4 : 2;
      const sz = Math.max(0.25, (ent.radius || 0.3));
      // soft halo, fringe, bright elongated core and a short trail (three-layer rule; the trail on every tier)
      parts.sprite(0, v1.x, v1.y, v1.z, sz * 4.8, 0, CELL.dot, col.r * h, col.g * h, col.b * h, 0.75, 0.3, 0, 0, 0, 0);
      parts.sprite(0, v1.x, v1.y, v1.z, sz * 2.6, 0, CELL.dot, p.fringe.r * 1.4, p.fringe.g * 1.4, p.fringe.b * 1.4, 0.6, 0, 0, 0, 0, 0);
      parts.sprite(1, v1.x - dx * 0.25, v1.y - dy * 0.25, v1.z - dz * 0.25, sz * 1.5, 0, CELL.streak, 2.4, 2.4, 2.4, 1, 1, sz * 3.8, dx, dy, dz);
      if (p.has) {
        const tl = Math.min(3.2, 1.2 + sz * 4);
        parts.sprite(1, v1.x - dx * tl * 0.55, v1.y - dy * tl * 0.55, v1.z - dz * tl * 0.55, sz * 1.6, 0, CELL.streak,
          col.r * h, col.g * h, col.b * h, 0.6, 0.3, tl, dx, dy, dz);
      }
      if (!low && p.has) {
        const pi = pool.alloc();
        if (pi >= 0) {
          pool.px[pi] = v1.x - dx * 0.3; pool.py[pi] = v1.y - dy * 0.3; pool.pz[pi] = v1.z - dz * 0.3;
          pool.vx[pi] = dx * 0.05; pool.vy[pi] = dy * 0.05; pool.vz[pi] = dz * 0.05;
          pool.life[pi] = 0.14; pool.s0[pi] = sz * 1.1; pool.s1[pi] = sz * 0.2; pool.rot[pi] = 0; pool.rotV[pi] = 0;
          pool.cr[pi] = col.r * 1.6; pool.cg[pi] = col.g * 1.6; pool.cb[pi] = col.b * 1.6; pool.ca[pi] = 0.8;
          pool.grav[pi] = 0; pool.drag[pi] = 0; pool.core[pi] = 0.3; pool.stretch[pi] = -0.6; pool.fadeIn[pi] = 0;
          pool.mat[pi] = 1; pool.cell[pi] = CELL.streak; pool.frames[pi] = 1;
        }
      }
      p.lx = v1.x; p.ly = v1.y; p.lz = v1.z;
      p.has = true;
    }
  }

  /** @param {any} c @param {number} dt @param {boolean} low */
  function updateOrbs(c, dt, low) {
    const pl = c.player;
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];
      if (!o.on) continue;
      o.t += dt;
      if (o.t < 0.35 || !pl || !pl.alive) {
        o.vy -= 14 * dt;
        const dr = Math.max(0, 1 - 1.5 * dt);
        o.vx *= dr; o.vz *= dr;
        if (!pl && o.t > 1.5) {
          o.on = false;
          continue;
        }
      } else {
        const tx = pl.pos.x - o.x;
        const ty = pl.pos.y + 1.1 - o.y;
        const tz = pl.pos.z - o.z;
        const d = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (d < 0.7 || o.t > 3.5) {
          o.on = false;
          vfx.burst('xp_orb', o.x, o.y, o.z);
          continue;
        }
        const sp = 16 + o.t * 22;
        const k = Math.min(1, dt * 7);
        o.vx += ((tx / d) * sp - o.vx) * k;
        o.vy += ((ty / d) * sp - o.vy) * k;
        o.vz += ((tz / d) * sp - o.vz) * k;
      }
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      if (ctx.world) {
        const g = ctx.world.heightAt(o.x, o.z) + 0.3;
        if (o.y < g) {
          o.y = g;
          if (o.vy < 0) o.vy *= -0.4;
        }
      }
      const h = low ? 1.5 : 2;
      parts.sprite(0, o.x, o.y, o.z, 0.75, 0, CELL.dot, 0.5 * h, 0.95 * h, 0.88 * h, 0.9, 0.9, 0, 0, 0, 0);
      parts.sprite(0, o.x, o.y, o.z, 0.32, o.t * 6, CELL.spark, 2, 2, 2, 1, 1, 0, 0, 0, 0);
    }
  }

  /** @param {any} c @param {number} dt @param {number} alpha @param {boolean} low */
  function updatePickups(c, dt, alpha, low) {
    const L = RECIPES.pickup.layers[0];
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i];
      if (p.entId === 0) continue;
      const ent = c.ents.get(p.entId);
      if (!ent || !ent.alive) {
        p.entId = 0;
        continue;
      }
      p.t += dt;
      c.ents.renderPos(ent, alpha, v1);
      const col = p.color;
      const pulse = 0.8 + 0.2 * Math.sin(p.t * 4);
      parts.sprite(1, v1.x, v1.y + 0.75, v1.z, 0.24, 0, CELL.streak, col.r * 1.5, col.g * 1.5, col.b * 1.5, 0.75 * pulse, 0.6, 1.6, 0, 1, 0);
      parts.sprite(0, v1.x, v1.y + 0.25, v1.z, 0.9, 0, CELL.dot, col.r * 1.3, col.g * 1.3, col.b * 1.3, 0.55 * pulse, 0.4, 0, 0, 0, 0);
      p.acc += (low ? 3 : 5) * dt;
      if (p.acc >= 1) {
        p.acc -= 1;
        cBody.copy(col);
        fringeOf(cBody, cFringe);
        emitLayer(L, v1.x, v1.y + 0.4, v1.z, 0, 1, 0, 1, low ? 0.8 : 1);
      }
    }
  }

  /** @param {any} c @param {number} dt @param {number} alpha */
  function updateIcons(c, dt, alpha) {
    for (let i = 0; i < icons.length; i++) {
      const ic = icons[i];
      if (ic.entId === 0) continue;
      ic.t += dt;
      const ent = c.ents.get(ic.entId);
      if (!ent || !ent.alive || ic.t >= ic.seconds) {
        ic.entId = 0;
        continue;
      }
      c.ents.renderPos(ent, alpha, v1);
      const pop = Math.min(1, ic.t / 0.12);
      const s = (0.9 + 0.12 * Math.sin(ic.t * 18)) * (0.6 + 0.4 * pop);
      const y = v1.y + (ent.height || 1.8) + 0.8;
      parts.sprite(0, v1.x, y, v1.z, s * 1.25, 0, CELL.dot, ic.color.r * 0.8, ic.color.g * 0.8, ic.color.b * 0.8, 0.5, 0, 0, 0, 0, 0);
      parts.sprite(0, v1.x, y, v1.z, s, 0, CELL.warn, ic.color.r * 1.6, ic.color.g * 1.6, ic.color.b * 1.6, pop, 0.4, 0, 0, 0, 0);
    }
  }

  /** @param {number} dt @param {boolean} low */
  function updateAfterimages(dt, low) {
    for (let i = 0; i < afters.length; i++) {
      const a = afters[i];
      if (!a.on) continue;
      a.t += dt;
      const k = 1 - a.t / a.seconds;
      if (k <= 0) {
        a.on = false;
        if (a.mesh) {
          if (a.mesh.parent) a.mesh.parent.remove(a.mesh);
          const act = ctx.actors;
          if (act && typeof act.releaseSnapshot === 'function') act.releaseSnapshot(a.mesh);
          a.mesh = null;
        }
        continue;
      }
      if (a.mesh) {
        a.mat.uniforms.uOpacity.value = 0.5 * k;
      } else {
        // fallback silhouette: a stack of soft glow sprites and horizontal speed lines
        const c = a.color;
        const hh = low ? 1.1 : 1.4;
        for (let s = 0; s < 4; s++) {
          const y = a.y + a.h * (0.15 + 0.25 * s);
          parts.sprite(0, a.x, y, a.z, a.h * (s === 3 ? 0.32 : 0.42), 0, CELL.dot, c.r * hh, c.g * hh, c.b * hh, 0.55 * k, 0.2, 0, 0, 0, 0);
        }
        parts.sprite(1, a.x, a.y + a.h * 0.55, a.z, a.h * 0.38, 0, CELL.streak, c.r * hh, c.g * hh, c.b * hh, 0.5 * k, 0.2, a.h * 0.95, 0, 1, 0);
      }
    }
  }

  /** @param {number} dt */
  function updateLights(dt) {
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const L = lights[i];
      if (!L.h) continue;
      L.t += dt;
      const k = 1 - L.t / L.seconds;
      if (k <= 0) {
        L.h.release();
        L.h = null;
        continue;
      }
      L.h.set(L.x, L.y, L.z, L.color, L.i * k, L.r);
    }
  }

  const updateSystem = {
    id: 'vfx.update',
    phase: 'vfx',
    /**
     * Real frame time; a frame pass with dt 0 after stepped ticks uses the sim time that passed instead. In test mode
     * without autoplay the sim is stepped by hand while the rAF loop keeps drawing: effects then follow the sim clock
     * only, so a screenshot shows the tick the scenario stepped to, not however much wall time the renderer took.
     * @param {any} c @param {number} frameDt @param {number} alpha
     */
    frame(c, frameDt, alpha) {
      const real = c.time.real;
      const simDt = lastReal < 0 ? 0 : real - lastReal;
      lastReal = real;
      const f = c.flags;
      const manual = !!(f && f.test && !f.autoplay);
      const dt = Math.min(0.1, !manual && frameDt > 0 ? frameDt : Math.max(0, simDt));
      if (!built) return;
      const low = isLow();
      parts.clearSprites();
      applyFlashes(c);
      updateEmitters(c, dt, alpha, low);
      updateAuras(c, dt, alpha, low);
      updateSpeed(c, dt, alpha, low);
      updateWeather(c, dt, low);
      updateShells(c, dt);
      updateDecals(dt);
      updateOrbs(c, dt, low);
      updateAfterimages(dt, low);
      updateLights(dt);
      if (dt > 0) pool.step(dt);
      updateBeams(c, dt, low);
      updateProjectiles(c, dt, alpha, low);
      updatePickups(c, dt, alpha, low);
      updateIcons(c, dt, alpha);
      parts.upload(c.three.camera, low);
    },
  };

  // ------------------------------------------------------------------ automatic effects (4.4)
  /** @param {number} entId @returns {number} team colour */
  function teamColor(entId) {
    const e = ctx.ents.get(entId);
    return e && e.team === 2 ? PALETTE.hostile : PALETTE.ora;
  }
  /** The Ora colour of an actor: its Form colour, else Ora (hostile for team 2). @param {any} ent @returns {number} */
  function formColor(ent) {
    const fid = ent.combat ? ent.combat.formId : null;
    if (fid) {
      const f = ctx.defs.find('form', fid);
      if (f && typeof f.color === 'number') return f.color;
    }
    return ent.team === 2 ? PALETTE.hostile : PALETTE.ora;
  }
  let strikeN = 0;
  /**
   * A short ribbon of light behind a limb for `seconds`.
   * @param {number} entId @param {string} socket @param {number} color @param {number} seconds @param {number} width multiplier
   */
  function limbTrail(entId, socket, color, seconds, width) {
    tmpOpts.color = color;
    const h = vfx.attach('limb_trail', entId, socket, tmpOpts);
    for (let i = 0; i < emitters.length; i++) {
      const em = emitters[i];
      if (em.id !== h) continue;
      em.ttl = seconds;
      em.sizeMul = width;
    }
  }
  /** @param {number} dx @param {number} dy @param {number} dz @param {number} scale @param {number|undefined} color */
  function bopts(dx, dy, dz, scale, color) {
    tmpOpts.dirX = dx; tmpOpts.dirY = dy; tmpOpts.dirZ = dz; tmpOpts.scale = scale; tmpOpts.color = color; tmpOpts.count = undefined;
    return tmpOpts;
  }

  const auto = {
    /** @param {any} e combat:hit (pooled) */
    hit(e) {
      const cls = e.class;
      if (cls === 'boltHit') return;
      const color = teamColor(e.attackerId);
      let id = 'hit_light';
      let weight = 0;
      if (e.perfect) id = 'perfect';
      else if (e.blocked) id = 'guard_block';
      else if (cls === 'finisher' || cls === 'ultimate') { id = 'hit_finisher'; weight = 2; }
      else if (cls === 'heavyHit' || cls === 'burst' || cls === 'wallSlam' || e.crit) { id = 'hit_heavy'; weight = 1; }
      else if (cls === 'beamTick') id = 'beam_hit';
      vfx.burst(id, e.x, e.y, e.z, bopts(e.dirX, 0.15, e.dirZ, 1, color));
      if (weight === 0) return;
      // the struck body reacts in light: a longer white flash than the light-hit default (applied after the sim)
      queueFlash(e.targetId, weight === 2 ? 0.16 : 0.11);
      // heavy blows near the ground kick up dust and debris; finishers also ring and crack the ground. Throttled so
      // a Nova Ring through a crowd does not spend a decal (one draw call each) per target.
      const real = ctx.time.real;
      if (real - lastDustT < 0.12 || !ctx.world) return;
      const gy = ctx.world.heightAt(e.x, e.z);
      if (e.y - gy > 2.4) return;
      lastDustT = real;
      vfx.burst('impact_dust', e.x, gy + 0.15, e.z, bopts(e.dirX, 1, e.dirZ, weight === 2 ? 1.25 : 0.85, undefined));
      if (weight === 2) {
        decalOpts.color = undefined; decalOpts.seconds = 4; decalOpts.shape = 'circle';
        vfx.decal('crack', e.x, e.z, 1.7, decalOpts);
        waveOpts.radius = 3.6; waveOpts.seconds = 0.3; waveOpts.color = color; waveOpts.sphere = false; waveOpts.ground = true;
        vfx.shockwave(e.x, gy, e.z, waveOpts);
      }
    },
    /** @param {any} e combat:techStart */
    techStart(e) {
      if (e.techId === 'strike_string') strikeN = 0;
    },
    /**
     * Technique moments the combat package leaves to vfx: the Nova Ring wall of light, limb trails on strong strikes,
     * the Pursuit and Ringfall comet trails.
     * @param {any} e combat:techPhase
     */
    techPhase(e) {
      const ent = ctx.ents.get(e.entId);
      if (!ent || !ent.alive || ent.team === 2) return;
      const id = e.techId;
      const ph = e.phase;
      const color = formColor(ent);
      if (id === 'nova_ring' && ph === 'active') {
        vfx.burst('nova', ent.pos.x, ent.pos.y + 1, ent.pos.z, bopts(0, 1, 0, 1.35, color));
      } else if (id === 'strike_string' && ph === 'active') {
        const n = strikeN++;
        if (n >= 2) limbTrail(ent.id, n === 2 ? 'handR' : n === 3 ? 'handL' : 'feet', color, 0.24, 1);
      } else if (id === 'breaker' && ph === 'active') {
        limbTrail(ent.id, 'handR', color, 0.3, 1.3);
      } else if (id === 'meteor_heel' && ph === 'windup') {
        limbTrail(ent.id, 'feet', color, 0.55, 1.4);
      } else if (id === 'pursuit' && ph === 'active') {
        limbTrail(ent.id, 'chest', color, 0.3, 2.2);
      } else if (id === 'ringfall') {
        if (ph === 'windup') limbTrail(ent.id, 'chest', color, 1.1, 1.6);
        else if (ph === 'active') limbTrail(ent.id, 'chest', color, 0.45, 2.6);
      }
    },
    /** @param {any} e projectile:spawned (pooled) */
    projectileSpawned(e) {
      build();
      for (let i = 0; i < projs.length; i++) {
        const p = projs[i];
        if (p.entId !== 0) continue;
        p.entId = e.entId;
        p.color.setHex(typeof e.color === 'number' ? e.color : PALETTE.ora);
        fringeOf(p.color, p.fringe);
        p.hitId = RECIPES[e.fxId + '_hit'] ? e.fxId + '_hit' : 'bolt_hit';
        p.has = false;
        if (ctx.render) ctx.render.blob.add(e.entId, 0.3);
        const ent = ctx.ents.get(e.entId);
        if (ent) vfx.burst('muzzle', ent.pos.x, ent.pos.y, ent.pos.z, bopts(ent.vel.x, ent.vel.y, ent.vel.z, 1, p.color.getHex()));
        return;
      }
    },
    /** @param {any} e projectile:removed (pooled) */
    projectileRemoved(e) {
      let color = PALETTE.ora;
      let hitId = 'bolt_hit';
      for (let i = 0; i < projs.length; i++) {
        const p = projs[i];
        if (p.entId !== e.entId) continue;
        color = p.color.getHex();
        hitId = p.hitId;
        p.entId = 0;
      }
      if (ctx.render) ctx.render.blob.remove(e.entId);
      if (e.hit) vfx.burst(hitId, e.x, e.y, e.z, bopts(0, 1, 0, 1, color));
    },
    /** @param {any} e combat:telegraph */
    telegraph(e) {
      const ent = ctx.ents.get(e.entId);
      const col = e.kind === 'red' ? PALETTE.telegraph.red : e.kind === 'violet' ? PALETTE.telegraph.violet : PALETTE.telegraph.white;
      const seconds = e.seconds > 0 ? e.seconds : 0.6;
      const ex = ent ? ent.pos.x : e.x;
      const ey = ent ? ent.pos.y : e.y;
      const ez = ent ? ent.pos.z : e.z;
      const eh = ent ? ent.height || 1.8 : 1.8;
      vfx.burst(e.kind === 'red' ? 'tele_red' : e.kind === 'violet' ? 'tele_violet' : 'tele_white', ex, ey + eh + 0.3, ez);
      decalOpts.color = col;
      decalOpts.seconds = seconds;
      decalOpts.fill = 0;
      decalOpts.shape = 'circle';
      vfx.decal('ring', ex, ez, Math.max(1.3, (ent ? ent.radius : 0.6) * 2.4), decalOpts);
      const shape = e.shape;
      if (shape === 'circle' || shape === 'line' || shape === 'cone' || (shape === 'ring' && e.radius > 2)) {
        decalOpts.shape = shape === 'ring' ? 'circle' : shape;
        decalOpts.dirX = e.dirX || 0;
        decalOpts.dirZ = e.dirX || e.dirZ ? e.dirZ : 1;
        decalOpts.length = e.radius;
        const id = vfx.decal('shape', shape === 'circle' || shape === 'ring' ? e.x : ex, shape === 'circle' || shape === 'ring' ? e.z : ez,
          shape === 'line' ? Math.max(0.9, (ent ? ent.radius : 0.6) * 1.4) : e.radius, decalOpts);
        const d = mfx.findDecal(id);
        if (d) d.autoFill = seconds;
      }
      if (e.kind === 'red') {
        for (let i = 0; i < icons.length; i++) {
          const ic = icons[i];
          if (ic.entId !== 0 && ic.entId !== e.entId) continue;
          ic.entId = e.entId;
          ic.t = 0;
          ic.seconds = seconds;
          ic.color.setHex(col);
          break;
        }
      } else if (e.kind === 'violet' && ent && ctx.player) {
        const b = startBeam(col, 0.06, 2);
        if (b) {
          b.followA = e.entId;
          b.followB = ctx.player.id;
          b.timed = seconds;
        }
      }
    },
    /** @param {any} e combat:flicker */
    flicker(e) {
      const color = teamColor(e.entId);
      vfx.afterimage(e.entId, 0.3, color);
      for (let i = 0; i < afters.length; i++) {
        const a = afters[i];
        if (a.on && a.t === 0) {
          a.x = e.fromX; a.y = e.fromY; a.z = e.fromZ;
          if (a.mesh) a.mesh.position.set(e.fromX, e.fromY, e.fromZ);
        }
      }
      const dx = e.toX - e.fromX;
      const dz = e.toZ - e.fromZ;
      vfx.burst('flicker_out', e.fromX, e.fromY + 1, e.fromZ, bopts(dx, 0, dz, 1, color));
      vfx.burst('flicker_in', e.toX, e.toY + 1, e.toZ, bopts(dx, 0, dz, 1, color));
      waveOpts.radius = 2.5; waveOpts.seconds = 0.25; waveOpts.color = color; waveOpts.sphere = false; waveOpts.ground = true;
      vfx.shockwave(e.toX, e.toY, e.toZ, waveOpts);
    },
    /** @param {any} e actor:died */
    died(e) {
      if (e.kind !== 'enemy' && e.kind !== 'boss') return;
      const choir = typeof e.defId === 'string' && e.defId.indexOf('choir') === 0;
      const boss = e.kind === 'boss';
      vfx.burst(choir ? 'death_choir' : 'death_beast', e.x, e.y + 0.9, e.z, bopts(0, 1, 0, boss ? 2.5 : 1, undefined));
      if (boss) vfx.burst('explosion_l', e.x, e.y + 1.5, e.z, bopts(0, 1, 0, 1.2, PALETTE.hostile));
      let n = boss ? 12 : Math.min(8, 3 + Math.floor((e.level || 1) / 5));
      if (isLow()) n = Math.min(n, boss ? 6 : 3);
      for (let i = 0, k = 0; i < orbs.length && k < n; i++) {
        const o = orbs[i];
        if (o.on) continue;
        o.on = true;
        o.t = 0;
        const a = rnd() * TAU;
        const sp = 3 + rnd() * 4;
        o.x = e.x; o.y = e.y + 1; o.z = e.z;
        o.vx = Math.cos(a) * sp; o.vz = Math.sin(a) * sp; o.vy = 4 + rnd() * 4;
        k++;
      }
    },
    /** @param {any} e actor:knocked */
    knocked(e) {
      // a body launched or hurled off the ground leaves a puff of dust and debris where it stood
      const ent = ctx.ents.get(e.entId);
      if (ent && e.speed >= 8 && ctx.world) {
        const gy = ctx.world.heightAt(ent.pos.x, ent.pos.z);
        if (ent.pos.y - gy < 0.8) vfx.burst('impact_dust', ent.pos.x, gy + 0.15, ent.pos.z, bopts(0, 1, 0, Math.min(1.3, 0.6 + e.speed / 30), undefined));
      }
      if (!e.hurtle) return;
      const h = vfx.attach('hurtle_trail', e.entId, 'chest');
      for (let i = 0; i < emitters.length; i++) if (emitters[i].id === h) emitters[i].ttl = 1.1;
    },
    /** @param {any} e actor:slam */
    slam(e) {
      vfx.burst('slam', e.x, e.y + 0.3, e.z, bopts(0, 1, 0, Math.max(0.7, Math.min(2, e.speed / 18)), undefined));
    },
    /** @param {any} e world:crater */
    crater(e) {
      const r = e.radius > 0 ? e.radius : 4;
      vfx.burst('crater', e.x, e.y + 0.5, e.z, bopts(0, 1, 0, Math.max(0.6, r / 8), undefined));
      decalOpts.color = undefined;
      decalOpts.seconds = 18;
      decalOpts.shape = 'circle';
      vfx.decal('scorch', e.x, e.z, r * 1.15, decalOpts);
      waveOpts.radius = r * 1.8; waveOpts.seconds = 0.45; waveOpts.color = PALETTE.paper; waveOpts.sphere = false; waveOpts.ground = true;
      vfx.shockwave(e.x, e.y, e.z, waveOpts);
    },
    /** @param {any} e world:propDestroyed */
    propDestroyed(e) {
      vfx.burst('debris', e.x, e.y + 1, e.z);
    },
    levelUp() {
      const p = ctx.player;
      if (p) vfx.burst('level_up', p.pos.x, p.pos.y + 0.2, p.pos.z, bopts(0, 1, 0, 1, undefined));
    },
    /** @param {any} e move:boost */
    boost(e) {
      let slot = -1;
      if (ctx.player && e.entId === ctx.player.id) pBoost = e.stage;
      for (let i = 0; i < MAX_BOOST; i++) if (boostEnt[i] === e.entId) slot = i;
      if (e.stage === 0) {
        if (slot >= 0) {
          vfx.detach(boostHandle[slot], 0.3);
          boostEnt[slot] = 0;
        }
        return;
      }
      const ent = ctx.ents.get(e.entId);
      if (!ent) return;
      const color = teamColor(e.entId);
      if (slot < 0) {
        for (let i = 0; i < MAX_BOOST; i++) {
          if (boostEnt[i] === 0) {
            slot = i;
            boostEnt[i] = e.entId;
            boostHandle[i] = vfx.attach('boost_trail', e.entId, 'back', bopts(0, 0, 0, 1, color));
            break;
          }
        }
      }
      if (e.stage === 2) vfx.burst('sonic_ring', ent.pos.x, ent.pos.y + (ent.height || 1.8) * 0.55, ent.pos.z, bopts(ent.vel.x, ent.vel.y, ent.vel.z, 1, undefined));
    },
    /** @param {any} e actor:landed */
    landed(e) {
      if (e.speed >= 12) vfx.burst('land_ring', e.x, e.y + 0.1, e.z, bopts(0, 1, 0, Math.min(2.2, e.speed / 16), undefined));
      else if (e.speed >= 6 && !isLow()) vfx.burst('step_dust', e.x, e.y + 0.1, e.z);
    },
    /** @param {any} e pickup:spawned */
    pickup(e) {
      build();
      for (let i = 0; i < pickups.length; i++) {
        const p = pickups[i];
        if (p.entId !== 0) continue;
        p.entId = e.entId;
        p.t = 0;
        p.acc = 0;
        const hex = e.rarity === 'fine' ? PALETTE.rarity.fine : e.rarity === 'rare' ? PALETTE.rarity.rare
          : e.kind === 'xp' ? PALETTE.ora : e.kind === 'shells' ? PALETTE.ember : PALETTE.rarity.common;
        p.color.setHex(hex);
        return;
      }
    },
    /** @param {any} e fx:impact (pooled) */
    impact(e) {
      const a = IMPACT_FLASH[e.classId];
      if (a && ctx.fx) ctx.fx.flash(0xffffff, a, e.classId === 'transform' ? 0.1 : 0.12);
      if (e.classId === 'ultimate' && ctx.render) ctx.render.vignette(PALETTE.ink, 0.6, 1.0);
      if (e.classId === 'bossDeath' && ctx.render) ctx.render.desaturate(0.6, 2.0);
    },
    /** @param {any} e quality:changed */
    quality() {
      const r = ctx.render;
      if (built && r && r.caps) pool.setCap(r.caps.particles);
    },
  };

  return { vfx, updateSystem, auto, build };
}
