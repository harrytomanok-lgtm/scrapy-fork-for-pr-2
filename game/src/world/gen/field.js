/**
 * The analytic world field: noise, island mask, the seven regions by warped Voronoi, per-region height recipes,
 * landmark stamps, paths, ground colour and forest density. Everything the bake writes into the grid and the
 * layers comes from here. Pure and allocation-free after creation; deterministic for a seed (no Math.random).
 * @module world/gen/field
 */

import { hash2 } from '../../core/rng.js';
import { PALETTE } from '../../core/palette.js';
import {
  REGIONS, LANDMARKS, PATHS, GEN, NR, R_MEADOWS, R_COAST, R_THORNWOOD, R_RUSTDUNE, R_FROSTSPINE, R_STORMWELL, R_SPIRE,
} from './layout.js';

const TS = 256;
const TM = TS - 1;

/** @param {number} a @param {number} b @param {number} x */
function sstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** sRGB bytes of a hex colour. @param {number} hex @returns {number[]} */
function rgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Gorge polyline through Thornwood (to Bramble Hollow). */
const GORGE = Object.freeze([-1650, 330, -1950, -60, -2250, -420, -2580, -860, -2820, -1250, -3050, -1500]);

/**
 * Create the field for a world seed.
 * @param {number} seed
 */
export function createField(seed) {
  seed >>>= 0;
  // ------------------------------------------------------------- value noise (lattice table)
  const table = new Float32Array(TS * TS);
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) table[j * TS + i] = (hash2(i, j, seed ^ 0x51ed27) / 4294967296) * 2 - 1;

  /** Value noise in [-1, 1]; `k` decorrelates fields. */
  function vn(x, z, k) {
    x += k * 71.37;
    z += k * 113.71;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    let fx = x - ix;
    let fz = z - iz;
    fx = fx * fx * (3 - 2 * fx);
    fz = fz * fz * (3 - 2 * fz);
    const x0 = ix & TM;
    const x1 = (ix + 1) & TM;
    const r0 = (iz & TM) * TS;
    const r1 = ((iz + 1) & TM) * TS;
    const a = table[r0 + x0];
    const b = table[r0 + x1];
    const c = table[r1 + x0];
    const d = table[r1 + x1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  /** Fractal sum, normalised to about [-1, 1]. Octaves are rotated to hide the lattice. */
  function fbm(x, z, oct, k) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * vn(x, z, k + o * 7);
      norm += amp;
      const nx = x * 1.6 - z * 1.2;
      z = x * 1.2 + z * 1.6;
      x = nx;
      amp *= 0.5;
    }
    return sum / norm;
  }

  /** Ridged fractal in [0, 1]. */
  function ridged(x, z, oct, k) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let prev = 1;
    for (let o = 0; o < oct; o++) {
      let v = 1 - Math.abs(vn(x, z, k + o * 5));
      v *= v;
      sum += v * amp * (0.35 + 0.65 * prev);
      prev = v;
      norm += amp;
      const nx = x * 1.7 - z * 1.1;
      z = x * 1.1 + z * 1.7;
      x = nx;
      amp *= 0.5;
    }
    return sum / norm;
  }

  // ------------------------------------------------------------- regions
  const weights = new Float64Array(NR);
  const BLEND = GEN.regionBlend * 2;

  /**
   * Fill `weights` with each region's blend weight at (x, z) (sum 1) and return the owning region index:
   * nearest noise-warped centre, `spire` inside its radius.
   */
  function regionWeights(x, z) {
    const wx = x + GEN.regionWarp * fbm(x / 1100, z / 1100, 2, 1);
    const wz = z + GEN.regionWarp * fbm(x / 1100 + 37.2, z / 1100 + 71.9, 2, 2);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < NR; i++) {
      if (i === R_SPIRE) continue;
      const r = REGIONS[i];
      const dx = wx - r.cx;
      const dz = wz - r.cz;
      const d = Math.sqrt(dx * dx + dz * dz);
      weights[i] = d;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    let sum = 0;
    for (let i = 0; i < NR; i++) {
      if (i === R_SPIRE) continue;
      let w = 1 - (weights[i] - bestD) / BLEND;
      w = w > 0 ? w * w : 0;
      weights[i] = w;
      sum += w;
    }
    const rr = Math.sqrt(x * x + z * z);
    const sp = sstep(GEN.spireRadius + 130, GEN.spireRadius - 20, rr);
    const k = (1 - sp) / sum;
    for (let i = 0; i < NR; i++) if (i !== R_SPIRE) weights[i] *= k;
    weights[R_SPIRE] = sp;
    return rr < GEN.spireRadius ? R_SPIRE : best;
  }

  // ------------------------------------------------------------- per-region height recipes
  /** Distance from (x, z) to the gorge polyline. */
  function gorgeDist(x, z) {
    let best = Infinity;
    for (let i = 0; i < GORGE.length - 2; i += 2) {
      const ax = GORGE[i];
      const az = GORGE[i + 1];
      const bx = GORGE[i + 2];
      const bz = GORGE[i + 3];
      const dx = bx - ax;
      const dz = bz - az;
      let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - ax - dx * t;
      const ez = z - az - dz * t;
      const d = ex * ex + ez * ez;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** Dune profile 0..1: long gentle windward slopes and short lee faces under the crest. */
  function duneShape(x, z) {
    const u = (x * 0.8 + z * 0.6) / 21 + 3.2 * vn(x / 300, z / 300, 41);
    const f = u / (Math.PI * 2) - Math.floor(u / (Math.PI * 2));
    const s = f < 0.78 ? f / 0.78 : 1 - (f - 0.78) / 0.22;
    return s * s * (3 - 2 * s);
  }

  /** Height of region `i`'s recipe at (x, z), before the island mask. */
  function regionHeight(i, x, z) {
    switch (i) {
      case R_MEADOWS: {
        const roll = 0.5 + 0.5 * fbm(x / 640, z / 640, 4, 10);
        return 26 + 48 * roll * roll + 5 * vn(x / 150, z / 150, 11) + 1.2 * vn(x / 37, z / 37, 12);
      }
      case R_COAST: {
        const flat = 4.5 + 3.5 * fbm(x / 520, z / 520, 3, 20);
        // Turquoise lagoons cut into the salt flats.
        const lagoon = sstep(0.24, 0.36, fbm(x / 330 + 3, z / 330 - 7, 3, 22));
        return flat + 1.4 * vn(x / 55, z / 55, 21) - 6.2 * lagoon;
      }
      case R_THORNWOOD: {
        const hill = 0.5 + 0.5 * fbm(x / 470, z / 470, 4, 30);
        const ridge = ridged(x / 820, z / 820, 3, 31);
        let h = 48 + 70 * hill + 55 * ridge * ridge + 3 * vn(x / 60, z / 60, 32);
        const gd = gorgeDist(x + 45 * vn(x / 300, z / 300, 33), z + 45 * vn(x / 300 + 9, z / 300 + 4, 34));
        const floor = 10 + 4 * vn(x / 120, z / 120, 35);
        const wall = sstep(80, 30, gd);
        h = h + (floor - h) * wall;
        return h;
      }
      case R_RUSTDUNE: {
        const base = 32 + 22 * (0.5 + 0.5 * fbm(x / 720, z / 720, 3, 40));
        const dune = 19 * duneShape(x, z) * (0.6 + 0.4 * vn(x / 400, z / 400, 42));
        const m = fbm(x / 560 + 11, z / 560 + 5, 3, 43);
        const mask = sstep(0.2, 0.27, m);
        let top = 92 + 26 * sstep(0.3, 0.5, m);
        const t = top / 9;
        top = (Math.floor(t) + sstep(0.4, 0.6, t - Math.floor(t))) * 9;
        return base + dune + (top - base - dune) * mask;
      }
      case R_FROSTSPINE: {
        const r = REGIONS[R_FROSTSPINE];
        const dc = Math.sqrt((x - r.cx) * (x - r.cx) + (z - r.cz) * (z - r.cz));
        const range = sstep(1900, 450, dc + 260 * vn(x / 600, z / 600, 50));
        const rg = ridged(x / 950, z / 950, 5, 51);
        return 70 + 90 * (0.5 + 0.5 * fbm(x / 500, z / 500, 3, 52)) + 640 * range * Math.pow(rg, 1.5);
      }
      case R_STORMWELL: {
        return 3 + 9 * fbm(x / 430, z / 430, 3, 60) + 3.5 * vn(x / 90, z / 90, 61);
      }
      default: {
        // Spire plateau: terraced rings stepping down to the rim.
        const rr = Math.sqrt(x * x + z * z);
        const ring = sstep(470, 120, rr);
        const steps = Math.floor(ring * 4) + sstep(0.35, 0.65, ring * 4 - Math.floor(ring * 4));
        return 96 + 13 * steps + 2.5 * vn(x / 80, z / 80, 70);
      }
    }
  }

  // ------------------------------------------------------------- island mask
  /** Coastline radius of the mask in the direction of (x, z). */
  function coastRadius(x, z) {
    const r = Math.sqrt(x * x + z * z);
    const inv = r > 1e-6 ? 1 / r : 0;
    return GEN.coastRadius + GEN.coastWarp * fbm(x * inv * 2.4 + 50, z * inv * 2.4 + 50, 3, 80);
  }

  /** Sea stacks of the Saltglass Coast: flat-topped glassy pillars along the shore. */
  function seaStack(x, z, h, coastW, r, cr) {
    if (coastW < 0.25 || r < cr - 900 || r > cr + 60) return h;
    const cell = 150;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let out = h;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const hh = hash2(cx + di, cz + dj, seed ^ 0x5eac);
        if ((hh & 1023) > 430) continue;
        const px = (cx + di + 0.2 + 0.6 * ((hh >>> 10) & 255) / 255) * cell;
        const pz = (cz + dj + 0.2 + 0.6 * ((hh >>> 18) & 255) / 255) * cell;
        const rad = 9 + 13 * ((hh >>> 26) & 63) / 63;
        const d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
        if (d >= rad) continue;
        const top = 18 + 34 * (((hh >>> 4) & 63) / 63) + 2 * vn(x / 9, z / 9, 90);
        const s = sstep(rad, rad * 0.72, d) * coastW;
        const v = h + (top - h) * s;
        if (v > out) out = v;
      }
    }
    return out;
  }

  /** Land factor of the last `rawHeight` call (1 inland, 0 open sea). */
  let lastLand = 0;
  let lastRegion = 0;

  /** Height before stamps; leaves the blend in `weights`, the owner in `lastRegion`. */
  function rawHeight(x, z) {
    lastRegion = regionWeights(x, z);
    let h = 0;
    for (let i = 0; i < NR; i++) {
      const w = weights[i];
      if (w > 0) h += w * regionHeight(i, x, z);
    }
    const r = Math.sqrt(x * x + z * z);
    const cr = coastRadius(x, z);
    const t = (cr - r) / GEN.shelf;
    const land = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    lastLand = land;
    h = h * land + (GEN.seaFloor + 6 * vn(x / 400, z / 400, 81)) * (1 - land);
    h = seaStack(x, z, h, weights[R_COAST], r, cr);
    return h;
  }

  // ------------------------------------------------------------- stamps
  /** Stamp table: x, z, inner, outer, kind (0 flat, 1 basin), target, depth. */
  const stampCount = LANDMARKS.filter((l) => l.stamp && (l.stamp.kind === 'flatten' || l.stamp.kind === 'plateau' || l.stamp.kind === 'basin' || l.stamp.kind === 'spire')).length;
  const st = new Float64Array(stampCount * 7);
  {
    let k = 0;
    for (const lm of LANDMARKS) {
      const s = lm.stamp;
      if (!s || (s.kind !== 'flatten' && s.kind !== 'plateau' && s.kind !== 'basin' && s.kind !== 'spire')) continue;
      const raw = rawHeight(lm.x, lm.z);
      const falloff = s.falloff !== undefined ? s.falloff : 40;
      st[k] = lm.x;
      st[k + 1] = lm.z;
      st[k + 2] = s.radius;
      st[k + 3] = s.radius + falloff;
      if (s.kind === 'basin') {
        st[k + 4] = 1;
        st[k + 5] = raw;
        st[k + 6] = s.height || s.radius * 0.3;
        if (lm.type === 'arena') {
          // a boss arena is fought on dry ground: the rim sits at least 6 m up and the floor at least 3 m above
          // the sea (bramble_hollow's raw ground is low, so its 25 m bowl used to flood the whole arena)
          st[k + 5] = Math.max(raw, 6);
          st[k + 6] = Math.min(st[k + 6], st[k + 5] - 3);
        }
      } else {
        st[k + 4] = 0;
        const base = Math.max(raw, lm.type === 'settlement' || lm.type === 'siphon' ? 6 : 3);
        st[k + 5] = base + (s.kind === 'plateau' ? s.height || 0 : 0);
        st[k + 6] = 0;
      }
      k += 7;
    }
  }

  /** Full analytic height (raw plus stamps). Leaves the blend in `weights`. */
  function height(x, z) {
    let h = rawHeight(x, z);
    for (let k = 0; k < st.length; k += 7) {
      const dx = x - st[k];
      const dz = z - st[k + 1];
      const d2 = dx * dx + dz * dz;
      const outer = st[k + 3];
      if (d2 >= outer * outer) continue;
      const d = Math.sqrt(d2);
      const inner = st[k + 2];
      const w = sstep(outer, inner, d);
      if (st[k + 4] === 1) {
        const q = d < inner ? d / inner : 1;
        const bowl = st[k + 5] - st[k + 6] * (1 - q * q);
        h += (bowl - h) * w;
      } else {
        h += (st[k + 5] - h) * w;
      }
    }
    return h;
  }

  /** 1 inside a settlement or siphon flatten radius, fading over 20 m. */
  function settlementAt(x, z) {
    let s = 0;
    for (const lm of LANDMARKS) {
      if (lm.type !== 'settlement' || !lm.stamp) continue;
      const d = Math.sqrt((x - lm.x) * (x - lm.x) + (z - lm.z) * (z - lm.z));
      const v = sstep(lm.stamp.radius + 20, lm.stamp.radius, d);
      if (v > s) s = v;
    }
    return s;
  }

  // ------------------------------------------------------------- paths
  const lmById = Object.create(null);
  for (const l of LANDMARKS) lmById[l.id] = l;
  const pathSeg = new Float64Array(PATHS.length * 4);
  PATHS.forEach((p, i) => {
    pathSeg[i * 4] = lmById[p[0]].x;
    pathSeg[i * 4 + 1] = lmById[p[0]].z;
    pathSeg[i * 4 + 2] = lmById[p[1]].x;
    pathSeg[i * 4 + 3] = lmById[p[1]].z;
  });

  /** Distance to the nearest path centre line (the line meanders with noise). */
  function pathDist(x, z) {
    const mx = x + 34 * vn(x / 210, z / 210, 100);
    const mz = z + 34 * vn(x / 210 + 5, z / 210 + 3, 101);
    let best = Infinity;
    for (let i = 0; i < pathSeg.length; i += 4) {
      const ax = pathSeg[i];
      const az = pathSeg[i + 1];
      const dx = pathSeg[i + 2] - ax;
      const dz = pathSeg[i + 3] - az;
      let t = ((mx - ax) * dx + (mz - az) * dz) / (dx * dx + dz * dz);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = mx - ax - dx * t;
      const ez = mz - az - dz * t;
      const d = ex * ex + ez * ez;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // ------------------------------------------------------------- colour
  const B = REGIONS.map((r) => {
    const p = PALETTE.biome[r.biome];
    return { ground: rgb(p.ground), shade: rgb(p.shade), cliff: rgb(p.cliff), foliage: rgb(p.foliage) };
  });
  const SNOW = rgb(PALETTE.snow);
  const PATH_C = rgb(PALETTE.path);
  const SAND = B[R_COAST].ground;
  const SEABED = B[R_COAST].shade;
  const RED_LEAF = rgb(PALETTE.flora.redLeaf);
  const FOAM = rgb(PALETTE.ocean.foam);
  const FLOWER_Y = rgb(PALETTE.biome.meadows.accent);
  const FLOWER_V = rgb(PALETTE.flora.brambleFlower);
  const FLOWER_W = rgb(PALETTE.paper);
  const col = new Float64Array(3);
  const acc = new Float64Array(3);

  /**
   * Ground colour (sRGB 0..255 into `out[0..2]`) at a point whose blend is in `weights`.
   * @param {number} x @param {number} z @param {number} h height @param {number} slope 0 flat .. 1 vertical
   * @param {number} path distance to the path line @param {number} settle settlement factor 0..1
   * @param {Uint8Array} out @param {number} o offset @param {number} [field] flower field mask 0..1 (fieldAt)
   */
  function groundColour(x, z, h, slope, path, settle, out, o, field) {
    const patch = fbm(x / 75, z / 75, 2, 110);
    const dither = (hash2(Math.floor(x / 8), Math.floor(z / 8), seed ^ 0xd17) / 4294967296) * 0.3 - 0.15;
    const leaf = vn(x / 170, z / 170, 111);
    const strata = 0.88 + 0.12 * Math.sin(h * 0.55 + patch * 2);
    const cliffT = sstep(0.44, 0.56, slope + dither * 0.12);
    // The Spire plateau keeps its pale palette down its rim cliffs.
    const rr = Math.sqrt(x * x + z * z);
    const spW = sstep(650, 545, rr);
    if (spW > weights[R_SPIRE]) {
      const k = weights[R_SPIRE] < 1 ? (1 - spW) / (1 - weights[R_SPIRE]) : 0;
      for (let i = 0; i < NR; i++) if (i !== R_SPIRE) weights[i] *= k;
      weights[R_SPIRE] = spW;
    }
    acc[0] = 0; acc[1] = 0; acc[2] = 0;
    for (let i = 0; i < NR; i++) {
      const w = weights[i];
      if (w <= 0) continue;
      const b = B[i];
      const s = sstep(-0.3, 0.85, patch + dither) * 0.55;
      const f = sstep(0.25, 0.8, leaf) * 0.3;
      let extra = 0;
      let salt = 0;
      let crack = 0;
      if (i === R_RUSTDUNE) {
        const ds = 1 - duneShape(x, z);
        extra = ds * ds * 0.8 + sstep(80, 95, h) * 0.25;
      }
      else if (i === R_FROSTSPINE) extra = (1 - sstep(380, 500, h)) * 0.55;
      else if (i === R_COAST) {
        salt = sstep(0.05, 0.45, vn(x / 95, z / 95, 23)) * 0.75;
        const cv = vn(x / 48, z / 48, 24);
        crack = (1 - sstep(0.0, 0.07, cv < 0 ? -cv : cv)) * 0.35;
      }
      for (let c = 0; c < 3; c++) {
        let v = b.ground[c] + (b.shade[c] - b.ground[c]) * s;
        v += (b.shade[c] - v) * extra;
        v += (b.foliage[c] - v) * f;
        if (i === R_MEADOWS) v += (RED_LEAF[c] - v) * sstep(0.55, 0.85, vn(x / 260, z / 260, 112)) * 0.12;
        if (salt > 0) v += (FOAM[c] - v) * salt;
        if (crack > 0) v += (b.shade[c] - v) * crack;
        v += (b.cliff[c] * strata - v) * cliffT;
        acc[c] += v * w;
      }
    }
    col[0] = acc[0]; col[1] = acc[1]; col[2] = acc[2];
    // flower fields: a dappled wash of the region's flower colours, so a field reads from the air
    if (field > 0) {
      const sp = sstep(-0.1, 0.5, vn(x / 7, z / 7, 132));
      const pick = vn(x / 23, z / 23, 133);
      const wm = weights[R_MEADOWS] + weights[R_FROSTSPINE];
      const fa = wm >= weights[R_THORNWOOD] + weights[R_COAST] ? (pick > 0.15 ? FLOWER_Y : pick > -0.35 ? RED_LEAF : FLOWER_W) : (pick > 0.2 ? FLOWER_W : FLOWER_V);
      const k = field * (0.12 + 0.3 * sp);
      for (let c = 0; c < 3; c++) col[c] += (fa[c] - col[c]) * k;
    }
    // Snow line (Frostspine above 520 m, dithered, not on sheer cliffs).
    const fs = weights[R_FROSTSPINE];
    if (fs > 0.05) {
      const line = 520 + 45 * patch + 60 * dither;
      const snow = sstep(line - 25, line + 15, h) * (1 - sstep(0.55, 0.72, slope)) * Math.min(1, fs * 1.6);
      for (let c = 0; c < 3; c++) col[c] += (SNOW[c] - col[c]) * snow;
    }
    // Beaches and the sea bed.
    if (h < 2.6) {
      const sand = h > 0 ? sstep(2.6, 0.7, h) * 0.85 : 1;
      for (let c = 0; c < 3; c++) col[c] += (SAND[c] - col[c]) * sand;
      if (h < 0) {
        const deep = sstep(0, 14, -h);
        for (let c = 0; c < 3; c++) col[c] += (SEABED[c] * 0.8 - col[c]) * deep;
      }
    }
    // Packed earth in settlements, then paths.
    let pm = settle * 0.28;
    if (h > 0.4) {
      const p = sstep(7.5, 2.5, path) * (1 - sstep(0.35, 0.5, slope)) * 0.9;
      if (p > pm) pm = p;
    }
    if (pm > 0) for (let c = 0; c < 3; c++) col[c] += (PATH_C[c] * (0.94 + 0.12 * dither) - col[c]) * pm;
    for (let c = 0; c < 3; c++) {
      const v = col[c];
      out[o + c] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5;
    }
  }

  // ------------------------------------------------------------- forest density
  /**
   * Composition per region (world pass): the share of the land that is grove, the stocking inside a grove and the
   * density of lone trees in the open. Groves are clumps of a 240 m noise with a soft 40 m edge, so the land reads
   * as woods, clearings and fields rather than an even scatter.
   */
  const COVER = new Float64Array([0.34, 0.18, 0.86, 0.1, 0.46, 0.3, 0.14]);
  const STOCK = new Float64Array([0.8, 0.62, 0.96, 0.32, 0.72, 0.5, 0.5]);
  const LONE = new Float64Array([0.035, 0.03, 0.12, 0.05, 0.04, 0.05, 0.03]);

  /**
   * Forest density 0..1 at a point whose blend is in `weights`.
   * @param {number} x @param {number} z @param {number} h @param {number} slope @param {number} path @param {number} settle
   */
  function forest(x, z, h, slope, path, settle) {
    if (h < 1.6) return 0;
    let cover = 0;
    let stock = 0;
    let lone = 0;
    for (let i = 0; i < NR; i++) {
      const w = weights[i];
      if (w <= 0) continue;
      cover += w * COVER[i];
      stock += w * STOCK[i];
      lone += w * LONE[i];
    }
    const fs = weights[R_FROSTSPINE];
    if (fs > 0) {
      const tl = 1 - fs * sstep(430, 540, h);
      cover *= tl;
      lone *= tl;
    }
    // the clump noise is about normal around 0 with sd 0.3: the threshold keeps `cover` of the land in groves
    const clump = fbm(x / 240, z / 240, 3, 120) + 0.25 * vn(x / 60, z / 60, 121);
    const t = (0.5 - cover) * 0.62;
    let d = stock * sstep(t - 0.05, t + 0.07, clump) + lone;
    d *= 1 - sstep(0.42, 0.58, slope);
    d *= sstep(4, 14, path);
    d *= 1 - settle;
    return d < 0 ? 0 : d > 1 ? 1 : d;
  }

  /**
   * Flower field mask 0..1 (open, gentle, dry land; strongest in the Meadows): baked into the flags layer and the
   * ground tint so the fields read from the air, and used by the scatter for the flower patches.
   */
  function fieldAt(x, z, h, slope, path, settle) {
    if (h < 2 || slope > 0.3 || settle > 0.3) return 0;
    let k = 0;
    k += weights[R_MEADOWS] * 1.0 + weights[R_COAST] * 0.45 + weights[R_THORNWOOD] * 0.6 + weights[R_FROSTSPINE] * 0.35 * (1 - sstep(300, 420, h));
    if (k <= 0) return 0;
    const n = vn(x / 140, z / 140, 130) + 0.3 * vn(x / 38, z / 38, 131);
    return sstep(0.3, 0.55, n) * k * sstep(5, 12, path);
  }

  return {
    seed,
    weights,
    vn,
    fbm,
    regionWeights,
    rawHeight,
    height,
    coastRadius,
    pathDist,
    settlementAt,
    groundColour,
    forest,
    fieldAt,
    /** Land factor and owner region of the last `rawHeight`/`height` call. */
    get lastLand() { return lastLand; },
    get lastRegion() { return lastRegion; },
  };
}
