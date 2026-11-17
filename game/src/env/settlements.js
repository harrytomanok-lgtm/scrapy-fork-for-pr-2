/**
 * Settlements (ARCHITECTURE 4.2, 5.13; ART_UX 1.10): built on boot from defs kind 'settlement' at the landmark
 * positions, on resolved ground (terraced plinths where the ground slopes). Every settlement is one merged,
 * palette-indexed toon mesh (one draw call) sharing one material; kites of all settlements are one instanced mesh
 * bobbing along the shared wind; the Sparkstead windmill rotor and the Tide Beacon lens ring are the only extra
 * meshes. Lanterns and windows light at dusk through the material's per-slot emissive. Colliders go to the world.
 * @module env/settlements
 */

import { Mesh, InstancedMesh, Color, Matrix4, Vector3, Quaternion, Euler, DynamicDrawUsage } from 'three';
import { PALETTE } from '../core/palette.js';
import { IDS } from '../core/ids.js';
import { createBuilder, SLOT, SLOT_HEX, mat, frame, prim } from './kit.js';
import { FOOTPRINT, REQUIRED_SPOTS } from './data/settlements.js';

const SOLID = 1;
/** Settlements farther than this from the camera are hidden (fog has eaten them). */
const HIDE_DIST = 2400;
const KITE_COLORS = PALETTE.structure.kites;

/** Building dimensions: [radius, wall height, roof height]. */
const HOUSE = { house_s: [3, 3.0, 1.7], house_m: [4, 3.6, 2.1], house_l: [5.5, 4.0, 2.5] };

/**
 * @param {any} ctx
 */
export function createSettlements(ctx) {
  /** @type {Record<string, { id:string, x:number, z:number, radius:number, spots:any[] }>} */
  const infos = Object.create(null);
  /** @type {any[]} */
  const meshes = [];
  /** @type {number[]} */
  const colliders = [];
  /** @type {any} */
  let material = null;
  /** @type {any} */
  let kiteMesh = null;
  /** @type {any} */
  let kiteMaterial = null;
  /** Kite instances: pivot x,y,z, base yaw offset, phase, length scale. */
  const kites = [];
  /** Spinning parts: { mesh, axis:'z'|'y', speed }. */
  const spinners = [];
  let built = false;
  let time = 0;
  let tris = 0;

  const lantern = new Color(PALETTE.structure.lantern);
  const windowDay = new Color(PALETTE.ink);
  const tmpM = new Matrix4();
  const tmpQ = new Quaternion();
  const tmpE = new Euler();
  const tmpP = new Vector3();
  const tmpS = new Vector3(1, 1, 1);

  /** @returns {any} */
  function W() {
    return ctx.world;
  }

  /** Ground under a footprint: min and max of the terrain at the centre and a ring of 8 samples. */
  function footprintGround(x, z, r) {
    const w = W();
    let lo = w.heightAt(x, z);
    let hi = lo;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = w.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    return { lo, hi };
  }

  /** @param {any} c */
  function addCollider(c) {
    const w = W();
    if (!w || typeof w.addCollider !== 'function') return;
    const id = w.addCollider(Object.assign({ r: 0, h: 0, hx: 0, hz: 0, yaw: 0, flags: SOLID, propKey: 0 }, c));
    if (id) colliders.push(id);
  }

  /**
   * Terraced plinth where the ground slopes; returns the floor height.
   * @param {any} B builder @param {number} x @param {number} z @param {number} r @param {number} slot
   */
  function plinth(B, x, z, r, slot) {
    const g = footprintGround(x, z, r * 1.1);
    if (g.hi - g.lo < 0.25) return g.lo;
    const top = g.hi + 0.15;
    const h = top - g.lo + 0.6;
    B.add(prim.drum(r * 1.15, r * 1.22, h, 12), mat(x, g.lo - 0.6, z), slot, undefined, 0.35);
    return top;
  }

  // ---------------------------------------------------------------- building kit
  /** @param {any} B @param {any} f frame @param {string} kind @param {string} style */
  function house(B, f, kind, style) {
    const [r, wallH, roofH] = HOUSE[kind];
    const stone = style === 'mountain';
    const stilts = style === 'outpost';
    let y0 = 0;
    if (stilts) {
      // raised floor on six posts with a ladder
      y0 = 2.4;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.5;
        B.add(prim.drum(0.16, 0.2, y0 + 0.3, 5), f.m(Math.cos(a) * r * 0.85, -0.3, Math.sin(a) * r * 0.85), SLOT.WOOD, undefined, 0.3);
      }
      B.add(prim.drum(r * 1.18, r * 1.12, 0.35, 12), f.m(0, y0 - 0.35, 0), SLOT.WOOD_LIGHT, undefined, 0.4);
      for (let i = 0; i < 2; i++) B.add(prim.box(0.1, y0 + 0.4, 0.1), f.m(-0.45 + i * 0.9, -0.2, r * 1.25, 0, -0.32), SLOT.WOOD);
      for (let k = 0; k < 4; k++) B.add(prim.cbox(1, 0.07, 0.12), f.m(0, 0.4 + k * 0.6, r * 1.25 + 0.65 - k * 0.2, 0, -0.32), SLOT.WOOD_LIGHT);
    }
    const taper = 0.9;
    // walls: clay drum (stone lower half in the mountains), terracotta base band, eave band
    if (stone) {
      B.add(prim.drum(r * 0.97, r * 1.02, wallH * 0.45, 10), f.m(0, y0 - 0.3, 0), SLOT.STONE, undefined, 0.3);
      B.add(prim.drum(r * taper, r * 0.96, wallH * 0.6, 10, true), f.m(0, y0 + wallH * 0.4, 0), SLOT.CLAY, undefined, 0.1);
    } else {
      B.add(prim.drum(r * taper, r, wallH + 0.3, 10, true), f.m(0, y0 - 0.3, 0), SLOT.CLAY, undefined, 0.22);
      B.add(prim.drum(r * 1.03, r * 1.05, 0.85, 10, true), f.m(0, y0 - 0.3, 0), SLOT.TERRA, undefined, 0.2);
    }
    B.add(prim.drum(r * taper + 0.06, r * taper + 0.08, 0.3, 10, true), f.m(0, y0 + wallH - 0.35, 0), SLOT.TERRA);
    // shallow verdigris cone roof with a ring finial (snow cap in the mountains)
    const roofR = r * 1.24;
    B.add(prim.cone(roofR, roofH, 10), f.m(0, y0 + wallH - 0.1, 0), SLOT.COPPER, undefined, 0.15);
    if (stone) B.add(prim.cone(roofR * 0.78, roofH * 0.8, 10), f.m(0, y0 + wallH - 0.1 + roofH * 0.22, 0), SLOT.SNOW);
    if (kind === 'house_l') {
      // upper drum (a second storey) above the first roof
      B.add(prim.drum(r * 0.5, r * 0.55, 1.6, 8, true), f.m(0, y0 + wallH + roofH * 0.45, 0), SLOT.CLAY);
      B.add(prim.cone(r * 0.72, 1.3, 8), f.m(0, y0 + wallH + roofH * 0.45 + 1.5, 0), SLOT.COPPER);
    }
    const top = y0 + wallH - 0.1 + roofH + (kind === 'house_l' ? 1.4 : 0);
    B.add(prim.drum(0.05, 0.07, 0.7, 4, true), f.m(0, top - 0.25, 0), SLOT.IRON);
    B.add(prim.ring(0.36, 0.06, 3, 7), f.m(0, top + 0.7, 0), SLOT.COPPER);
    // round door with a teal curtain and a terracotta frame
    const lean = Math.atan((r * (1 - taper)) / wallH);
    const dz = r * (1 - (1 - taper) * (1.1 / wallH)) + 0.04;
    B.add(prim.disc(0.95, 10), f.m(0, y0 + 1.1, dz, 0, -lean), SLOT.TERRA);
    B.add(prim.disc(0.8, 10), f.m(0, y0 + 1.1, dz + 0.03, 0, -lean), SLOT.CURTAIN);
    B.add(prim.box(1.6, 0.18, 0.7), f.m(0, y0 - 0.1, dz + 0.25), SLOT.STONE, undefined, 0);
    // two round windows (lit at night)
    for (const side of [-1.85, 1.85, Math.PI]) {
      if (kind === 'house_s' && side === Math.PI) continue;
      const wy = y0 + wallH * 0.62;
      const rr = r * (1 - (1 - taper) * (wallH * 0.62 / wallH)) + 0.04;
      B.add(prim.disc(0.34, 7), f.m(Math.sin(side) * rr, wy, Math.cos(side) * rr, side, -lean), SLOT.WINDOW);
    }
    return top;
  }

  /** @param {any} B @param {any} f @param {number[]} banner */
  function windmill(B, f, banner) {
    const H = 12;
    B.add(prim.drum(2.5, 3.6, H, 10, true), f.m(0, -0.3, 0), SLOT.CLAY, undefined, 0.25);
    B.add(prim.drum(3.68, 3.72, 1, 10, true), f.m(0, -0.3, 0), SLOT.TERRA);
    B.add(prim.drum(2.62, 2.85, 0.4, 10, true), f.m(0, H * 0.55, 0), SLOT.TERRA);
    B.add(prim.cone(3.2, 2.8, 10), f.m(0, H - 0.2, 0), SLOT.COPPER, undefined, 0.1);
    B.add(prim.ring(0.4, 0.07, 3, 7), f.m(0, H + 3, 0), SLOT.COPPER);
    B.add(prim.disc(1.0, 10), f.m(0, 1.2, 3.45, 0, -0.09), SLOT.CURTAIN);
    for (let i = 0; i < 3; i++) B.add(prim.disc(0.32, 7), f.m(Math.sin(1.6 + i * 1.5) * 3.0, 4 + i * 2.4, Math.cos(1.6 + i * 1.5) * 3.0, 1.6 + i * 1.5, -0.09), SLOT.WINDOW);
    // hub housing toward +z
    B.add(prim.drum(0.55, 0.7, 1.6, 8), f.m(0, H - 1.0, 2.1, 0, Math.PI / 2), SLOT.WOOD);
    // the rotor with four kite sails: its own mesh, spun every frame
    const R = createBuilder();
    R.add(prim.ball(0.55, 8, 5), mat(0, 0, 0), SLOT.IRON);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      R.add(prim.cbox(0.22, 8.5, 0.22), mat(Math.sin(a) * 4.2, Math.cos(a) * 4.2, 0, 0, 0, -a), SLOT.WOOD);
      // a diamond kite sail on each spar
      const cx = Math.sin(a) * 5.6;
      const cy = Math.cos(a) * 5.6;
      const ux = Math.sin(a);
      const uy = Math.cos(a);
      const px = Math.cos(a);
      const py = -Math.sin(a);
      const tip = [cx + ux * 3.2, cy + uy * 3.2, 0.12];
      const bot = [cx - ux * 3.0, cy - uy * 3.0, 0.12];
      const l = [cx + px * 1.5, cy + py * 1.5, 0.12];
      const rr = [cx - px * 1.2 + ux * 0.6, cy - py * 1.2 + uy * 0.6, 0.12];
      const col = KITE_COLORS[i % 3];
      for (const zz of [0.12, -0.12]) {
        tip[2] = zz; bot[2] = zz; l[2] = zz; rr[2] = zz;
        if (zz > 0) {
          R.tri(tip.slice(), l.slice(), bot.slice(), SLOT.CLOTH, col);
          R.tri(tip.slice(), bot.slice(), rr.slice(), SLOT.CLOTH, col);
        } else {
          R.tri(tip.slice(), bot.slice(), l.slice(), SLOT.CLOTH, col);
          R.tri(tip.slice(), rr.slice(), bot.slice(), SLOT.CLOTH, col);
        }
      }
    }
    const mesh = new Mesh(R.build(), material);
    mesh.position.set(f.wx(0, 3.1), f.y + H - 0.2, f.wz(0, 3.1));
    mesh.rotation.set(0, f.yaw, 0, 'YXZ');
    mesh.name = 'env.windmillRotor';
    spinners.push({ mesh, speed: 0.55, axis: 'z' });
    tris += R.triangles;
    return mesh;
  }

  /** @param {any} B @param {any} f */
  function well(B, f) {
    B.add(prim.drum(1.5, 1.6, 1.0, 10, true), f.m(0, -0.2, 0), SLOT.STONE, undefined, 0.3);
    B.add(prim.drum(1.62, 1.62, 0.18, 10), f.m(0, 0.78, 0), SLOT.STONE);
    B.add(prim.disc(1.35, 10), f.m(0, 0.5, 0, 0, -Math.PI / 2), SLOT.CURTAIN);
    for (const sx of [-1.35, 1.35]) B.add(prim.box(0.16, 2.4, 0.16), f.m(sx, 0.7, 0), SLOT.WOOD);
    B.add(prim.cbox(2.9, 0.14, 0.14), f.m(0, 2.6, 0), SLOT.WOOD);
    B.add(prim.cone(1.9, 1.0, 8), f.m(0, 3.0, 0), SLOT.COPPER, undefined, 0.15);
    B.add(prim.drum(0.22, 0.2, 0.4, 6), f.m(0, 1.6, 0), SLOT.WOOD_LIGHT);
  }

  /**
   * Market stall: four posts, a striped awning in the banner colours, a counter with goods at the front.
   * @param {any} B @param {any} f @param {number[]} banner
   */
  function stall(B, f, banner) {
    const w = 3.6;
    const d = 2.6;
    for (const sx of [-w / 2, w / 2]) {
      for (const sz of [-d / 2, d / 2]) B.add(prim.box(0.14, sz > 0 ? 2.4 : 2.9, 0.14), f.m(sx, -0.1, sz), SLOT.WOOD);
    }
    for (let i = 0; i < 6; i++) {
      const col = i % 2 === 0 ? banner[0] : banner[1];
      B.add(prim.cbox(w / 6 + 0.02, 0.08, d + 0.7), f.m(-w / 2 + (i + 0.5) * (w / 6), 2.62, 0.05, 0, 0.19), SLOT.CLOTH, col);
    }
    // scalloped valance at the front
    for (let i = 0; i < 6; i++) {
      const col = i % 2 === 0 ? banner[1] : banner[0];
      B.add(prim.cbox(w / 6, 0.32, 0.04), f.m(-w / 2 + (i + 0.5) * (w / 6), 2.25, d / 2 + 0.4), SLOT.CLOTH, col);
    }
    B.add(prim.box(w - 0.2, 1.0, 0.7), f.m(0, -0.05, d / 2 - 0.1), SLOT.WOOD_LIGHT, undefined, 0.35);
    B.add(prim.box(w, 0.08, 0.85), f.m(0, 0.95, d / 2 - 0.1), SLOT.WOOD);
    // goods
    const goods = [PALETTE.ember, KITE_COLORS[0], PALETTE.biome.meadows.foliage, KITE_COLORS[1], PALETTE.paper];
    for (let i = 0; i < 5; i++) {
      const gx = -1.3 + i * 0.65;
      if (i % 2 === 0) B.add(prim.ball(0.2, 6, 4), f.m(gx, 1.18, d / 2 - 0.15), SLOT.CLOTH, goods[i]);
      else B.add(prim.drum(0.18, 0.2, 0.36, 6), f.m(gx, 1.0, d / 2 - 0.1), SLOT.CLOTH, goods[i]);
    }
    addCollider({ shape: 'box', x: f.wx(0, d / 2 - 0.1), y: f.y, z: f.wz(0, d / 2 - 0.1), hx: w / 2, hz: 0.4, h: 1.1, yaw: f.yaw });
  }

  /** Kite pole with one or two kites (instanced). @param {any} B @param {any} f @param {number[]} banner @param {number} seed */
  function kitePole(B, f, banner, seed) {
    const H = 10 + (seed % 3);
    B.add(prim.drum(0.1, 0.17, H, 6), f.m(0, -0.2, 0), SLOT.WOOD, undefined, 0.2);
    B.add(prim.drum(0.35, 0.4, 0.5, 8), f.m(0, -0.2, 0), SLOT.STONE);
    B.add(prim.ring(0.32, 0.05, 3, 7), f.m(0, H + 0.1, 0), SLOT.COPPER);
    // pennant
    B.tri([f.wx(0, 0), f.y + H - 0.4, f.wz(0, 0)], [f.wx(0, 0), f.y + H - 1.4, f.wz(0, 0)], [f.wx(1.6, 0), f.y + H - 0.9, f.wz(1.6, 0)], SLOT.CLOTH, banner[0]);
    B.tri([f.wx(0, 0), f.y + H - 0.4, f.wz(0, 0)], [f.wx(1.6, 0), f.y + H - 0.9, f.wz(1.6, 0)], [f.wx(0, 0), f.y + H - 1.4, f.wz(0, 0)], SLOT.CLOTH, banner[0]);
    addCollider({ shape: 'capsule', x: f.x, y: f.y, z: f.z, r: 0.3, h: H });
    kites.push({ x: f.x, y: f.y + H - 0.2, z: f.z, yaw: 0.25 * ((seed % 5) - 2), phase: seed * 1.7, len: 1, color: KITE_COLORS[seed % 3] });
    if (seed % 2 === 0) kites.push({ x: f.x, y: f.y + H * 0.7, z: f.z, yaw: -0.4, phase: seed * 0.9 + 2, len: 0.7, color: KITE_COLORS[(seed + 1) % 3] });
  }

  /** @param {any} B @param {any} f */
  function lanternPost(B, f) {
    B.add(prim.drum(0.06, 0.09, 2.7, 5), f.m(0, -0.1, 0), SLOT.WOOD);
    B.add(prim.cbox(0.06, 0.06, 0.6), f.m(0, 2.5, 0.25), SLOT.WOOD);
    B.add(prim.drum(0.15, 0.18, 0.36, 6), f.m(0, 2.0, 0.5), SLOT.LANTERN);
    B.add(prim.cone(0.25, 0.18, 6), f.m(0, 2.36, 0.5), SLOT.COPPER);
    addCollider({ shape: 'capsule', x: f.x, y: f.y, z: f.z, r: 0.15, h: 2.7 });
  }

  /** Round tent. @param {any} B @param {any} f @param {number[]} banner */
  function tent(B, f, banner) {
    B.add(prim.drum(2.0, 2.2, 0.9, 8, true), f.m(0, -0.1, 0), SLOT.CLOTH, banner[0], 0.25);
    B.add(prim.cone(2.15, 1.9, 8), f.m(0, 0.75, 0), SLOT.CLOTH, banner[1], 0.1);
    B.add(prim.drum(0.05, 0.05, 0.8, 4, true), f.m(0, 2.5, 0), SLOT.WOOD);
    B.add(prim.box(1.0, 1.2, 0.1), f.m(0, -0.05, 2.12, 0, -0.06), SLOT.CURTAIN);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.78;
      B.add(prim.cbox(0.04, 0.04, 1.6), f.m(Math.sin(a) * 2.6, 0.5, Math.cos(a) * 2.6, a, 0.55), SLOT.WOOD_LIGHT);
    }
    addCollider({ shape: 'disc', x: f.x, y: f.y, z: f.z, r: 2.2, h: 2.6 });
  }

  /** Haven Aster's 60 m kite tower. @param {any} B @param {any} f @param {number[]} banner */
  function kiteTower(B, f, banner) {
    const H = 52;
    B.add(prim.drum(4.6, 4.8, 3, 10), f.m(0, -0.5, 0), SLOT.STONE, undefined, 0.3);
    B.add(prim.drum(2.2, 3.8, H, 10, true), f.m(0, 2.4, 0), SLOT.CLAY, undefined, 0.15);
    for (let i = 1; i < 5; i++) {
      const y = 2.4 + i * (H / 5);
      const rr = 3.8 - (1.6 * (y - 2.4)) / H;
      B.add(prim.drum(rr + 0.08, rr + 0.1, 0.7, 10, true), f.m(0, y, 0), SLOT.TERRA);
    }
    B.add(prim.drum(3.4, 2.4, 1.0, 10), f.m(0, H + 1.4, 0), SLOT.WOOD, undefined, 0.2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      B.add(prim.box(0.12, 1.1, 0.12), f.m(Math.sin(a) * 3.2, H + 2.4, Math.cos(a) * 3.2), SLOT.WOOD);
    }
    B.add(prim.cone(3.8, 2.6, 10), f.m(0, H + 3.5, 0), SLOT.COPPER, undefined, 0.1);
    B.add(prim.drum(0.12, 0.16, 6, 5), f.m(0, H + 5.5, 0), SLOT.WOOD);
    B.add(prim.ring(0.6, 0.09, 3, 8), f.m(0, H + 12.2, 0), SLOT.COPPER);
    B.add(prim.disc(1.1, 10), f.m(0, 3.4, 3.8, 0, -0.03), SLOT.CURTAIN);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const y = 10 + i * 6.5;
      const rr = 3.8 - (1.6 * (y - 2.4)) / H + 0.03;
      B.add(prim.disc(0.4, 7), f.m(Math.sin(a) * rr, y, Math.cos(a) * rr, a, -0.03), SLOT.WINDOW);
    }
    // long banners down the shaft
    for (const a of [Math.PI / 2, -Math.PI / 2]) B.add(prim.cbox(0.9, 14, 0.06), f.m(Math.sin(a) * 3.05, 38, Math.cos(a) * 3.05, a, 0.03), SLOT.CLOTH, banner[0]);
    addCollider({ shape: 'disc', x: f.x, y: f.y, z: f.z, r: 4.6, h: H + 4 });
    for (let i = 0; i < 4; i++) {
      kites.push({ x: f.x, y: f.y + H + 8 - i * 0.5, z: f.z, yaw: -0.6 + i * 0.4, phase: i * 2.1, len: 2.2 + i * 0.35, color: KITE_COLORS[i % 3] });
    }
  }

  /** Copper signal mast. @param {any} B @param {any} f @param {number[]} banner */
  function mast(B, f, banner) {
    const H = 18;
    B.add(prim.drum(0.8, 1.0, 0.8, 8), f.m(0, -0.3, 0), SLOT.STONE);
    B.add(prim.drum(0.16, 0.26, H, 6), f.m(0, 0.3, 0), SLOT.WOOD, undefined, 0.2);
    B.add(prim.cbox(3.2, 0.14, 0.14), f.m(0, H - 2.5, 0), SLOT.WOOD);
    B.add(prim.cbox(2.2, 0.12, 0.12), f.m(0, H - 5.2, 0), SLOT.WOOD);
    B.add(prim.drum(1.15, 1.15, 0.12, 12), f.m(0, H - 0.2, 0.25, 0, Math.PI / 2), SLOT.COPPER);
    B.add(prim.ring(1.2, 0.09, 3, 12), f.m(0, H - 0.14, 0.3), SLOT.TERRA);
    for (const sx of [-1.5, 1.5]) B.add(prim.cbox(0.5, 1.6, 0.04), f.m(sx, H - 3.4, 0), SLOT.CLOTH, banner[0]);
    addCollider({ shape: 'capsule', x: f.x, y: f.y, z: f.z, r: 0.6, h: H });
    kites.push({ x: f.x, y: f.y + H + 0.5, z: f.z, yaw: 0.3, phase: 4.2, len: 1.3, color: KITE_COLORS[0] });
  }

  /** The Still Wind ring cloister around the plaza. @param {any} B @param {any} f */
  function cloister(B, f) {
    const R = 24;
    const N = 20;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.sin(a) * R;
      const z = Math.cos(a) * R;
      B.add(prim.drum(0.38, 0.46, 4.2, 6), f.m(x, -0.2, z), SLOT.CLAY, undefined, 0.2);
      B.add(prim.drum(0.6, 0.6, 0.5, 6), f.m(x, -0.3, z), SLOT.STONE);
      addCollider({ shape: 'disc', x: f.wx(x, z), y: f.y - 0.3, z: f.wz(x, z), r: 0.5, h: 4.5 });
    }
    B.add(prim.drum(R + 0.7, R + 0.7, 0.45, 32, true), f.m(0, 4.0, 0), SLOT.TERRA);
    B.add(prim.drum(R - 0.7, R - 0.7, 0.45, 32, true), f.m(0, 4.0, 0), SLOT.TERRA);
    B.add(prim.drum(R - 1.4, R + 2.4, 1.4, 32, true), f.m(0, 4.4, 0), SLOT.COPPER, undefined, 0.1);
    B.add(prim.drum(R - 1.4, R - 1.4, 0.25, 32, true), f.m(0, 5.8, 0), SLOT.COPPER);
    B.add(prim.drum(R + 1.2, R + 1.4, 0.3, 32, true), f.m(0, -0.25, 0), SLOT.STONE);
    // three wind bells hanging at the gates
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / N;
      const x = Math.sin(a) * R;
      const z = Math.cos(a) * R;
      B.add(prim.drum(0.02, 0.02, 0.8, 3, true), f.m(x, 3.2, z), SLOT.IRON);
      B.add(prim.cone(0.4, 0.6, 8, true), f.m(x, 2.7, z), SLOT.COPPER);
    }
    // inner garden ring of pale stones around the Ringstone
    B.add(prim.drum(9.2, 9.4, 0.25, 24, true), f.m(0, -0.12, 0), SLOT.STONE);
  }

  /** The Tide Beacon lighthouse with a turning lens ring. @param {any} B @param {any} f */
  function beacon(B, f) {
    const H = 26;
    B.add(prim.drum(4.6, 4.9, 1.2, 12), f.m(0, -0.6, 0), SLOT.STONE, undefined, 0.3);
    B.add(prim.drum(3.0, 4.2, H, 12, true), f.m(0, 0.4, 0), SLOT.CLAY, undefined, 0.15);
    for (const y of [5, 12, 19]) {
      const rr = 4.2 - (1.2 * (y - 0.4)) / H;
      B.add(prim.drum(rr + 0.08, rr + 0.1, 1.1, 12, true), f.m(0, y, 0), SLOT.TERRA);
    }
    B.add(prim.drum(4.0, 3.2, 0.6, 12), f.m(0, H + 0.4, 0), SLOT.STONE);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      B.add(prim.box(0.08, 1.0, 0.08), f.m(Math.sin(a) * 3.8, H + 1.0, Math.cos(a) * 3.8), SLOT.IRON);
    }
    B.add(prim.ring(3.8, 0.06, 3, 16), f.m(0, H + 2.0, 0, 0, Math.PI / 2), SLOT.IRON);
    B.add(prim.drum(2.0, 2.0, 2.8, 10, true), f.m(0, H + 1.0, 0), SLOT.LANTERN);
    B.add(prim.cone(2.8, 2.4, 10), f.m(0, H + 3.8, 0), SLOT.COPPER, undefined, 0.1);
    B.add(prim.ring(0.45, 0.07, 3, 7), f.m(0, H + 6.7, 0), SLOT.COPPER);
    B.add(prim.disc(1.0, 10), f.m(0, 1.6, 4.17, 0, -0.045), SLOT.CURTAIN);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.8;
      const y = 7 + i * 4.5;
      const rr = 4.2 - (1.2 * (y - 0.4)) / H + 0.03;
      B.add(prim.disc(0.42, 7), f.m(Math.sin(a) * rr, y, Math.cos(a) * rr, a, -0.045), SLOT.WINDOW);
    }
    addCollider({ shape: 'disc', x: f.x, y: f.y, z: f.z, r: 4.6, h: H + 6 });
    // lens ring: a separate mesh turning slowly
    const L = createBuilder();
    L.add(prim.ring(2.45, 0.16, 4, 16), mat(0, 0, 0, 0, Math.PI / 2), SLOT.COPPER);
    for (let i = 0; i < 2; i++) L.add(prim.cbox(1.3, 1.9, 0.2), mat(Math.sin(i * Math.PI) * 2.45, 0, Math.cos(i * Math.PI) * 2.45, i * Math.PI), SLOT.GLOW);
    const mesh = new Mesh(L.build(), material);
    mesh.position.set(f.x, f.y + H + 2.4, f.z);
    mesh.name = 'env.beaconLens';
    spinners.push({ mesh, speed: 0.35, axis: 'y' });
    tris += L.triangles;
    return mesh;
  }

  /**
   * Jetty: finds the nearest water from (x, z) and runs a plank deck out from the shore.
   * @param {any} B @param {number} x0 @param {number} z0 @param {number} cx settlement centre @param {number} cz
   * @returns {boolean}
   */
  function jetty(B, x0, z0, cx, cz) {
    const w = W();
    if (typeof w.waterDepthAt !== 'function') return false;
    let best = null;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const ux = Math.sin(a);
      const uz = Math.cos(a);
      for (let d = 8; d <= 320; d += 4) {
        const x = x0 + ux * d;
        const z = z0 + uz * d;
        if (w.waterDepthAt(x, z) > 0.6) {
          const dc = Math.hypot(x - cx, z - cz);
          if (!best || dc < best.dc) best = { x, z, ux, uz, dc, d };
          break;
        }
      }
    }
    if (!best) return false;
    // walk back to the shore
    let sx = best.x;
    let sz = best.z;
    for (let k = 0; k < 20 && w.waterDepthAt(sx, sz) > 0; k++) {
      sx -= best.ux;
      sz -= best.uz;
    }
    const yaw = Math.atan2(best.ux, best.uz);
    const len = 24;
    const sea = typeof w.seaLevel === 'number' ? w.seaLevel : 0;
    const deckY = Math.max(sea, w.heightAt(sx, sz)) + 0.9;
    const f = frame(sx - best.ux * 3, deckY, sz - best.uz * 3, yaw);
    B.add(prim.box(3.2, 0.25, len + 3), f.m(0, -0.25, (len + 3) / 2), SLOT.WOOD_LIGHT, undefined, 0.3);
    for (let i = 0; i < 14; i++) B.add(prim.cbox(3.3, 0.04, 0.1), f.m(0, 0.01, 1 + i * 2), SLOT.WOOD);
    for (let i = 0; i <= 4; i++) {
      for (const sxl of [-1.5, 1.5]) {
        const lz = 3 + i * (len / 4);
        const gy = w.heightAt(f.wx(sxl, lz), f.wz(sxl, lz));
        const h = deckY - gy + 0.6;
        B.add(prim.drum(0.15, 0.17, h, 5), f.m(sxl, -h + 0.6, lz), SLOT.WOOD, undefined, 0.4);
      }
    }
    // lantern post at the end
    B.add(prim.drum(0.06, 0.08, 2.4, 5), f.m(1.3, 0, len + 2.5), SLOT.WOOD);
    B.add(prim.drum(0.15, 0.18, 0.36, 6), f.m(1.3, 2.0, len + 2.5), SLOT.LANTERN);
    B.add(prim.cone(0.25, 0.18, 6), f.m(1.3, 2.36, len + 2.5), SLOT.COPPER);
    addCollider({ shape: 'box', x: f.wx(0, (len + 3) / 2), y: deckY - 0.6, z: f.wz(0, (len + 3) / 2), hx: 1.6, hz: (len + 3) / 2, h: 0.6, yaw, flags: 2 });
    return true;
  }

  /** Paved plaza around the Ringstone, conformed to the ground. @param {any} B @param {number} x @param {number} z @param {number} r */
  function plaza(B, x, z, r) {
    const w = W();
    const seg = 28;
    const rings = [0, 4.2, 5.0, r - 1.2, r];
    const slots = [SLOT.STONE, SLOT.TERRA, SLOT.PATH, SLOT.TERRA];
    /** @param {number} rr @param {number} a */
    const pt = (rr, a) => {
      const px = x + Math.sin(a) * rr;
      const pz = z + Math.cos(a) * rr;
      return [px, w.heightAt(px, pz) + 0.09, pz];
    };
    for (let k = 0; k < rings.length - 1; k++) {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const tint = k === 2 && i % 2 === 0 ? 0xf0e4d0 : undefined;
        if (rings[k] === 0) {
          B.tri(pt(0, 0), pt(rings[1], a0), pt(rings[1], a1), slots[k], tint);
        } else {
          const p00 = pt(rings[k], a0);
          const p01 = pt(rings[k], a1);
          const p10 = pt(rings[k + 1], a0);
          const p11 = pt(rings[k + 1], a1);
          B.tri(p00, p10, p11, slots[k], tint);
          B.tri(p00, p11, p01, slots[k], tint);
        }
      }
    }
  }

  // ---------------------------------------------------------------- build
  /** @param {any} lm @param {any} def */
  function buildOne(lm, def) {
    const w = W();
    const id = lm.id;
    const radius = lm.stamp && lm.stamp.radius ? lm.stamp.radius : 60;
    const style = def && def.style ? def.style : 'village';
    const banner = def && def.banner ? def.banner : [PALETTE.biome.meadows.accent, PALETTE.structure.terracotta];
    const B = createBuilder();
    const extra = [];
    if (style !== 'camp' && style !== 'ledge') plaza(B, lm.x, lm.z, style === 'town' ? 18 : 14);
    const list = def && Array.isArray(def.buildings) ? def.buildings : [];
    for (let i = 0; i < list.length; i++) {
      const bl = list[i];
      const x = lm.x + bl.dx;
      const z = lm.z + bl.dz;
      const yaw = bl.yaw || 0;
      if (bl.kind === 'jetty') {
        jetty(B, x, z, lm.x, lm.z);
        continue;
      }
      const r = FOOTPRINT[bl.kind] || 1;
      const floor = r > 1 && bl.kind !== 'cloister' ? plinth(B, x, z, r, style === 'mountain' ? SLOT.STONE : SLOT.TERRA) : w.heightAt(x, z);
      const f = frame(x, floor, z, yaw);
      switch (bl.kind) {
        case 'house_s':
        case 'house_m':
        case 'house_l': {
          const top = house(B, f, bl.kind, style);
          addCollider({ shape: 'disc', x, y: floor - 0.3, z, r: HOUSE[bl.kind][0] * (style === 'outpost' ? 1.15 : 1.0), h: top + 0.3 });
          break;
        }
        case 'windmill':
          extra.push(windmill(B, f, banner));
          addCollider({ shape: 'disc', x, y: floor - 0.3, z, r: 3.6, h: 15 });
          break;
        case 'well':
          well(B, f);
          addCollider({ shape: 'disc', x, y: floor - 0.2, z, r: 1.6, h: 1.0 });
          break;
        case 'stall': stall(B, f, banner); break;
        case 'kitePole': kitePole(B, f, banner, i + id.length); break;
        case 'lantern': lanternPost(B, f); break;
        case 'tent': tent(B, f, banner); break;
        case 'kiteTower': kiteTower(B, f, banner); break;
        case 'mast': mast(B, f, banner); break;
        case 'cloister': cloister(B, f); break;
        case 'beacon': extra.push(beacon(B, f)); break;
        default: break;
      }
    }
    if (!B.empty) {
      const mesh = new Mesh(B.build(), material);
      mesh.name = 'env.settlement.' + id;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      ctx.render.layers.props.add(mesh);
      meshes.push({ mesh, x: lm.x, z: lm.z, extra });
      tris += B.triangles;
      for (const e of extra) ctx.render.layers.props.add(e);
    }
    // spots
    const spots = [];
    const given = def && Array.isArray(def.spots) ? def.spots : [];
    for (const sp of given) spots.push({ id: sp.id, dx: sp.dx, dz: sp.dz, yaw: sp.yaw || 0 });
    for (let i = 0; i < REQUIRED_SPOTS.length; i++) {
      const sid = REQUIRED_SPOTS[i];
      if (spots.some((p) => p.id === sid)) continue;
      const a = (i / REQUIRED_SPOTS.length) * Math.PI * 2 + 0.5;
      spots.push({ id: sid, dx: Math.sin(a) * 9, dz: Math.cos(a) * 9, yaw: a + Math.PI });
    }
    infos[id] = {
      id, x: lm.x, z: lm.z, radius,
      spots: spots.map((p) => ({ id: p.id, x: lm.x + p.dx, y: w.heightAt(lm.x + p.dx, lm.z + p.dz), z: lm.z + p.dz, yaw: p.yaw })),
    };
  }

  function buildKites() {
    if (!kites.length) return;
    const K = createBuilder();
    // pivot at the pole top; the kite flies downwind along local +z
    const ink = PALETTE.ink;
    K.add(prim.cbox(0.025, 0.025, 7.4), mat(0, 2.3, 3.5, 0, -0.62), SLOT.CLAY, ink);
    const kx = 0;
    const ky = 4.6;
    const kz = 6.4;
    const tilt = 0.45;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    /** @param {number} u @param {number} v @param {number} o */
    const p = (u, v, o) => [kx + u, ky + v * ct, kz + v * st + o];
    const top = p(0, 1.05, 0);
    const bot = p(0, -1.45, 0);
    const l = p(-0.85, 0.15, 0);
    const r = p(0.85, 0.15, 0);
    K.tri(top, l, bot, SLOT.CLAY);
    K.tri(top, bot, r, SLOT.CLAY);
    K.tri(top, bot, l, SLOT.CLAY, 0xb0b0b0);
    K.tri(top, r, bot, SLOT.CLAY, 0xb0b0b0);
    // cross spars and a ribbon tail
    K.add(prim.cbox(1.7, 0.04, 0.04), mat(kx, ky + 0.15 * ct, kz + 0.15 * st + 0.03), SLOT.CLAY, ink);
    for (let i = 0; i < 4; i++) {
      const v0 = -1.45 - i * 0.45;
      const a = p(i % 2 === 0 ? 0.06 : -0.06, v0, 0.05 + i * 0.12);
      const b2 = p(i % 2 === 0 ? -0.18 : 0.18, v0 - 0.5, 0.11 + i * 0.12);
      const c = p(i % 2 === 0 ? 0.18 : -0.18, v0 - 0.5, 0.11 + i * 0.12);
      K.tri(a, b2, c, SLOT.CLAY, 0xffffff);
      K.tri(a, c, b2, SLOT.CLAY, 0xffffff);
    }
    const geo = K.build();
    kiteMaterial = ctx.render.materials.toon({ color: 0xffffff });
    kiteMesh = new InstancedMesh(geo, kiteMaterial, kites.length);
    kiteMesh.name = 'env.kites';
    kiteMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    kiteMesh.frustumCulled = false;
    const c = new Color();
    for (let i = 0; i < kites.length; i++) kiteMesh.setColorAt(i, c.setHex(kites[i].color));
    kiteMesh.instanceColor.needsUpdate = true;
    ctx.render.layers.props.add(kiteMesh);
    tris += K.triangles * kites.length;
    updateKites(0, null);
  }

  /** @param {number} dt @param {any} wind */
  function updateKites(dt, wind) {
    if (!kiteMesh) return;
    const wx = wind ? wind.x : 0.8;
    const wz = wind ? wind.z : 0.6;
    const gust = wind ? wind.y : 0.15;
    const base = Math.atan2(wx, wz);
    for (let i = 0; i < kites.length; i++) {
      const k = kites[i];
      const t = time + k.phase;
      // 0.5 Hz bob, slower roll and yaw wander
      const pitch = Math.sin(t * Math.PI) * 0.1 + (0.15 - gust) * 0.8;
      const roll = Math.sin(t * 2.3 + 1) * 0.12;
      const yaw = base + k.yaw + Math.sin(t * 0.7) * 0.15;
      tmpE.set(pitch, yaw, roll, 'YXZ');
      tmpQ.setFromEuler(tmpE);
      tmpP.set(k.x, k.y, k.z);
      tmpS.set(1, 1, 1).multiplyScalar(1).set(k.len * 0.35 + 0.65, k.len * 0.35 + 0.65, k.len);
      tmpM.compose(tmpP, tmpQ, tmpS);
      kiteMesh.setMatrixAt(i, tmpM);
    }
    kiteMesh.instanceMatrix.needsUpdate = true;
  }

  return {
    /** Build every settlement of IDS at its landmark (once). */
    build() {
      if (built) return;
      const w = W();
      const render = ctx.render;
      if (!w || !render || !render.layers || !render.materials) return;
      built = true;
      material = render.materials.toon({ palette: true, vertexColors: true });
      material.name = 'env.structure';
      const pal = material.uniforms.uPalette.value;
      for (let i = 0; i < 16; i++) pal[i].setHex(SLOT_HEX[i]);
      for (const id of IDS.settlement) {
        const lm = w.landmark(id);
        if (!lm) continue;
        const def = ctx.defs ? ctx.defs.find('settlement', id) : null;
        try {
          buildOne(lm, def);
        } catch (err) {
          ctx.log.warn('env', 'settlement build failed', id, err && err.message);
        }
      }
      buildKites();
    },

    /**
     * Per frame: lanterns and windows by the clock, kites, rotors, distance culling.
     * @param {number} dt @param {number} lanternK 0..1 @param {any} wind @param {any} cam
     */
    frame(dt, lanternK, wind, cam) {
      if (!material) return;
      time += dt;
      const em = material.uniforms.uEmissive.value;
      em[SLOT.LANTERN] = lanternK * 1.4;
      em[SLOT.WINDOW] = lanternK * 1.1;
      em[SLOT.GLOW] = 0.35 + lanternK * 1.2;
      material.uniforms.uPalette.value[SLOT.WINDOW].copy(windowDay).lerp(lantern, lanternK);
      for (let i = 0; i < spinners.length; i++) {
        const s = spinners[i];
        if (s.axis === 'z') s.mesh.rotation.z += dt * s.speed * (0.6 + (wind ? wind.y * 3 : 0.45));
        else s.mesh.rotation.y += dt * s.speed;
      }
      if (cam) {
        const px = cam.position.x;
        const pz = cam.position.z;
        for (let i = 0; i < meshes.length; i++) {
          const m = meshes[i];
          const dx = m.x - px;
          const dz = m.z - pz;
          const vis = dx * dx + dz * dz < HIDE_DIST * HIDE_DIST;
          m.mesh.visible = vis;
          for (let j = 0; j < m.extra.length; j++) m.extra[j].visible = vis;
        }
      }
      updateKites(dt, wind);
    },

    /** @param {string} id */
    info(id) {
      return infos[id] || null;
    },

    /** @param {string} sid @param {string} spotId @param {any} out */
    spot(sid, spotId, out) {
      const s = infos[sid];
      if (!s) return false;
      for (let i = 0; i < s.spots.length; i++) {
        const p = s.spots[i];
        if (p.id !== spotId) continue;
        out.x = p.x;
        out.y = p.y;
        out.z = p.z;
        out.yaw = p.yaw;
        return true;
      }
      return false;
    },

    stats() {
      return { built: Object.keys(infos).length, meshes: meshes.length, kites: kites.length, colliders: colliders.length, triangles: tris };
    },

    dispose() {
      for (const m of meshes) {
        if (m.mesh.parent) m.mesh.parent.remove(m.mesh);
        m.mesh.geometry.dispose();
        for (const e of m.extra) {
          if (e.parent) e.parent.remove(e);
          e.geometry.dispose();
        }
      }
      meshes.length = 0;
      spinners.length = 0;
      if (kiteMesh) {
        if (kiteMesh.parent) kiteMesh.parent.remove(kiteMesh);
        kiteMesh.geometry.dispose();
        kiteMesh.dispose();
        kiteMaterial.dispose();
        kiteMesh = null;
      }
      kites.length = 0;
      if (material) material.dispose();
      material = null;
      const w = W();
      if (w) for (const id of colliders) w.removeCollider(id);
      colliders.length = 0;
      built = false;
    },
  };
}
