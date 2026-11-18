/**
 * Terrain rendering (ARCHITECTURE 4.1, ART_UX 1.8): 256 m chunks at LOD0 (grid cell) and LOD1 (8 m), 512 m
 * super-chunks at LOD2 (16 m), all with skirts, plus one far mesh of the whole square. One terrain shader built
 * from `render.glsl` and `render.globals`: baked sRGB vertex colour, three toon bands, fog, and a canopy tint
 * (region foliage with a soft value pattern) that takes over the forest floor where the tree instances have
 * faded, so forests read from the air. LOD distances are 3D distances from the focus; chunk builds per frame
 * follow the tier budget.
 * @module world/terrain
 */

import { BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, Color, Sphere, Vector3, DoubleSide } from 'three';
import { PALETTE } from '../core/palette.js';
import { WORLD_HALF } from '../core/constants.js';
import { REGIONS } from './gen/layout.js';

const CHUNK = 256;
const CN = 28;
const SUPER = 512;
const SN = 14;
const FAR_SEG = 128;
const PREFETCH = 96;
/** Mesh kinds. */
const K0 = 0;
const K1 = 1;
const K2 = 2;
const POOL = [24, 56, 80];

const VERT = (glsl) => /* glsl */ `
${glsl.common}
attribute vec4 aNormal;
attribute vec4 aColor;
uniform vec3 uFoliage[7];
uniform vec3 uShade[7];
uniform float uSink;
uniform float uSinkRadius;
uniform float uCanopyNear;
uniform float uCanopyFar;
varying vec3 vGround;
varying vec3 vCanopy;
varying vec3 vShade;
varying float vCanopyAmt;
varying float vDens;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 p = position;
  float dist = length(p - uCamPos);
  p.y -= uSink * 70.0 * (1.0 - smoothstep(uSinkRadius - 140.0, uSinkRadius, dist));
  vec3 g = pow(aColor.rgb, vec3(2.2));
  float dens = aColor.a;
  int ri = int(clamp(aNormal.w * 127.0 + 0.5, 0.0, 6.0));
  vCanopy = uFoliage[ri];
  vShade = uShade[ri];
  vGround = g * (1.0 - 0.16 * dens);
  vDens = dens;
  vCanopyAmt = dens * smoothstep(uCanopyNear, uCanopyFar, dist);
  vNormalW = normalize(aNormal.xyz + vec3(0.0, 0.0001, 0.0));
  vPosW = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = (glsl) => /* glsl */ `
${glsl.common}
${glsl.lighting}
${glsl.fog}
varying vec3 vGround;
varying vec3 vCanopy;
varying vec3 vShade;
varying float vCanopyAmt;
varying float vDens;
varying vec3 vNormalW;
varying vec3 vPosW;
float th(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(th(i), th(i + vec2(1.0, 0.0)), f.x), mix(th(i + vec2(0.0, 1.0)), th(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 n = normalize(vNormalW);
  float dist = length(uCamPos - vPosW);
  float bump = tn(vPosW.xz * 0.085) * 0.65 + tn(vPosW.xz * 0.031 + 17.0) * 0.35;
  float amt = clamp(vCanopyAmt * 1.5 - (1.0 - bump) * 0.55, 0.0, 1.0);
  vec3 canopy = vCanopy * (0.55 + 0.8 * bump);
  // Painted ground (ART_UX 1.2/1.8): soft-edged patches of the region's shade colour and lighter sunlit
  // patches from the same value noise, then a fine stipple near the camera so the foreground is never a flat fill.
  float flat01 = smoothstep(0.55, 0.85, n.y);
  float dark = smoothstep(0.56, 0.64, bump) * 0.3 * flat01;
  float lite = smoothstep(0.36, 0.28, bump) * 0.09 * flat01;
  vec3 ground = mix(vGround, vShade, dark) * (1.0 + lite);
  vec3 base = mix(ground, canopy, amt);
  float grain = tn(vPosW.xz * 0.33) - 0.5;
  float fine = tn(vPosW.xz * 1.9 + grain) - 0.5;
  float nearK = 1.0 - smoothstep(40.0, 180.0, dist);
  base *= 1.0 + grain * 0.16 * nearK + fine * 0.13 * (1.0 - smoothstep(6.0, 45.0, dist));
  vec3 ln = normalize(n + vec3(bump - 0.5, 0.0, tn(vPosW.xz * 0.085 + 5.0) - 0.5) * amt * 0.9);
  // Terrain takes no rim light: the view vector is the normal itself.
  vec3 c = toonLight(base, ln, ln);
  c = applyFog(c, vPosW);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * @param {any} ctx
 * @param {ReturnType<import('./gen/grid.js').createGrid>} grid
 */
export function createTerrain(ctx, grid) {
  const glsl = ctx.render.glsl;
  const g = ctx.render.globals;
  const foliage = REGIONS.map((r) => new Color(PALETTE.biome[r.biome].foliage).multiplyScalar(0.88));
  // region shade colours for the painted ground patches (Color stores linear values, like the foliage)
  const shade = REGIONS.map((r) => new Color(PALETTE.biome[r.biome].shade));

  /** @param {boolean} far */
  function material(far) {
    const m = new ShaderMaterial({
      uniforms: {
        uTime: g.uTime, uSunDir: g.uSunDir, uSunColor: g.uSunColor, uAmbSky: g.uAmbSky, uAmbGround: g.uAmbGround,
        uShadowTint: g.uShadowTint, uFogColor: g.uFogColor, uFogDensity: g.uFogDensity, uFogHeight: g.uFogHeight,
        uRimColor: g.uRimColor, uCamPos: g.uCamPos, uWind: g.uWind,
        uFoliage: { value: foliage },
        uShade: { value: shade },
        uSink: { value: far ? 1 : 0 },
        uSinkRadius: { value: 1152 },
        uCanopyNear: { value: 300 },
        uCanopyFar: { value: 420 },
      },
      vertexShader: VERT(glsl),
      fragmentShader: FRAG(glsl),
      side: DoubleSide,
    });
    if (far) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = 2;
      m.polygonOffsetUnits = 8;
    }
    return m;
  }
  const chunkMat = material(false);
  const farMat = material(true);

  // ------------------------------------------------------------- bounds
  const cMin = new Float32Array(CN * CN);
  const cMax = new Float32Array(CN * CN);
  const sMin = new Float32Array(SN * SN);
  const sMax = new Float32Array(SN * SN);

  /** Recompute the height bounds of chunk (ci, cj) and its super-chunk. */
  function bounds(ci, cj) {
    let lo = Infinity;
    let hi = -Infinity;
    const x0 = -WORLD_HALF + ci * CHUNK;
    const z0 = -WORLD_HALF + cj * CHUNK;
    for (let z = 0; z <= CHUNK; z += 8) {
      for (let x = 0; x <= CHUNK; x += 8) {
        const h = grid.heightAt(x0 + x, z0 + z);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    cMin[cj * CN + ci] = lo - 8;
    cMax[cj * CN + ci] = hi;
    const si = ci >> 1;
    const sj = cj >> 1;
    let a = Infinity;
    let b = -Infinity;
    for (let q = 0; q < 4; q++) {
      const k = (sj * 2 + (q >> 1)) * CN + si * 2 + (q & 1);
      if (cMin[k] < a) a = cMin[k];
      if (cMax[k] > b) b = cMax[k];
    }
    sMin[sj * SN + si] = a;
    sMax[sj * SN + si] = b;
  }
  for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) bounds(i, j);

  /** 3D distance from (fx, fy, fz) to the box of a square tile. */
  function boxDist(fx, fy, fz, x0, z0, size, lo, hi) {
    let dx = fx < x0 ? x0 - fx : fx > x0 + size ? fx - x0 - size : 0;
    let dz = fz < z0 ? z0 - fz : fz > z0 + size ? fz - z0 - size : 0;
    let dy = fy < lo ? lo - fy : fy > hi ? fy - hi : 0;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ------------------------------------------------------------- shared index buffers
  /** @param {number} seg @returns {{ index:BufferAttribute, perim:Int32Array }} */
  function layout(seg) {
    const n = seg + 1;
    const perim = new Int32Array(seg * 4);
    let p = 0;
    for (let i = 0; i < seg; i++) perim[p++] = i;
    for (let j = 0; j < seg; j++) perim[p++] = j * n + seg;
    for (let i = seg; i > 0; i--) perim[p++] = seg * n + i;
    for (let j = seg; j > 0; j--) perim[p++] = j * n;
    const base = n * n;
    const tri = seg * seg * 2 + seg * 4 * 2;
    const idx = n * n + seg * 4 > 65535 ? new Uint32Array(tri * 3) : new Uint16Array(tri * 3);
    let k = 0;
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * n + i;
        idx[k++] = a; idx[k++] = a + n; idx[k++] = a + 1;
        idx[k++] = a + 1; idx[k++] = a + n; idx[k++] = a + n + 1;
      }
    }
    const m = seg * 4;
    for (let q = 0; q < m; q++) {
      const t0 = perim[q];
      const t1 = perim[(q + 1) % m];
      const b0 = base + q;
      const b1 = base + ((q + 1) % m);
      idx[k++] = t0; idx[k++] = b0; idx[k++] = t1;
      idx[k++] = t1; idx[k++] = b0; idx[k++] = b1;
    }
    return { index: new BufferAttribute(idx, 1), perim };
  }

  const seg0 = Math.round(CHUNK / Math.max(4, grid.cell));
  const SEG = [seg0, 32, 32];
  const SIZE = [CHUNK, CHUNK, SUPER];
  const layouts = seg0 === 32 ? (() => { const l = layout(32); return [l, l, l]; })() : (() => { const l = layout(32); return [layout(seg0), l, l]; })();

  // ------------------------------------------------------------- mesh pool
  /** @typedef {{ mesh:any, kind:number, idx:number, key:number, used:number, ready:boolean, dirty:boolean }} Rec */
  /** @type {Rec[][]} */
  const pools = [[], [], []];
  /** @type {Map<number, Rec>} */
  const byKey = new Map();
  let frameId = 0;
  const center = new Vector3();
  const col4 = new Float32Array(3);
  const tmpN = { x: 0, y: 1, z: 0 };

  /** @param {number} kind @returns {Rec} */
  function newRec(kind) {
    const seg = SEG[kind];
    const nv = (seg + 1) * (seg + 1) + seg * 4;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute('aNormal', new BufferAttribute(new Int8Array(nv * 4), 4, true));
    geo.setAttribute('aColor', new BufferAttribute(new Uint8Array(nv * 4), 4, true));
    geo.setIndex(layouts[kind].index);
    geo.boundingSphere = new Sphere(new Vector3(), 1);
    const mesh = new Mesh(geo, chunkMat);
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    ctx.render.layers.world.add(mesh);
    return { mesh, kind, idx: -1, key: -1, used: -1, ready: false, dirty: false };
  }

  /** Fill a mesh with tile `idx` of `kind`. @param {Rec} rec */
  function fill(rec) {
    const kind = rec.kind;
    const seg = SEG[kind];
    const size = SIZE[kind];
    const tiles = kind === K2 ? SN : CN;
    const ti = rec.idx % tiles;
    const tj = (rec.idx / tiles) | 0;
    const x0 = -WORLD_HALF + ti * size;
    const z0 = -WORLD_HALF + tj * size;
    const step = size / seg;
    const n = seg + 1;
    const geo = rec.mesh.geometry;
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.aNormal.array;
    const col = geo.attributes.aColor.array;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < n; j++) {
      const z = z0 + j * step;
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step;
        const k = j * n + i;
        const h = grid.heightAt(x, z);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        const e = step;
        const nx = grid.heightAt(x - e, z) - grid.heightAt(x + e, z);
        const nz = grid.heightAt(x, z - e) - grid.heightAt(x, z + e);
        const ny = 2 * e;
        const l = 127 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nor[k * 4] = Math.round(nx * l); nor[k * 4 + 1] = Math.round(ny * l); nor[k * 4 + 2] = Math.round(nz * l);
        nor[k * 4 + 3] = grid.regionIndexAt(x, z);
        if (kind === K2) {
          const o = step * 0.25;
          col[k * 4] = 0; col[k * 4 + 1] = 0; col[k * 4 + 2] = 0;
          let r = 0; let gg = 0; let b = 0;
          for (let q = 0; q < 4; q++) {
            grid.tintAt(x + ((q & 1) ? o : -o), z + ((q & 2) ? o : -o), col4, 0);
            r += col4[0]; gg += col4[1]; b += col4[2];
          }
          col[k * 4] = r * 63.75; col[k * 4 + 1] = gg * 63.75; col[k * 4 + 2] = b * 63.75;
        } else {
          grid.tintAt(x, z, col4, 0);
          col[k * 4] = col4[0] * 255; col[k * 4 + 1] = col4[1] * 255; col[k * 4 + 2] = col4[2] * 255;
        }
        col[k * 4 + 3] = grid.canopyAt(x, z) * 255;
      }
    }
    const perim = layouts[kind].perim;
    const base = n * n;
    const drop = Math.max(8, step);
    for (let q = 0; q < perim.length; q++) {
      const s = perim[q];
      const d = base + q;
      pos[d * 3] = pos[s * 3]; pos[d * 3 + 1] = pos[s * 3 + 1] - drop; pos[d * 3 + 2] = pos[s * 3 + 2];
      nor[d * 4] = nor[s * 4]; nor[d * 4 + 1] = nor[s * 4 + 1]; nor[d * 4 + 2] = nor[s * 4 + 2]; nor[d * 4 + 3] = nor[s * 4 + 3];
      col[d * 4] = col[s * 4]; col[d * 4 + 1] = col[s * 4 + 1]; col[d * 4 + 2] = col[s * 4 + 2]; col[d * 4 + 3] = col[s * 4 + 3];
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aNormal.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    center.set(x0 + size / 2, (lo + hi) / 2, z0 + size / 2);
    const hh = (hi - lo) / 2 + drop;
    geo.boundingSphere.center.copy(center);
    geo.boundingSphere.radius = Math.sqrt(size * size * 0.5 + hh * hh);
    rec.ready = true;
    rec.dirty = false;
  }

  /** Take a mesh for (kind, idx): a free one, a new one, or the least recently used. @returns {Rec|null} */
  function acquire(kind, idx) {
    const pool = pools[kind];
    let rec = null;
    for (let i = 0; i < pool.length; i++) {
      const r = pool[i];
      if (r.used !== frameId && (rec === null || r.used < rec.used)) rec = r;
    }
    if ((rec === null || rec.used >= 0) && pool.length < POOL[kind]) {
      rec = newRec(kind);
      pool.push(rec);
    }
    if (rec === null) return null;
    if (rec.key >= 0) byKey.delete(rec.key);
    rec.kind = kind;
    rec.idx = idx;
    rec.key = kind * 4096 + idx;
    rec.ready = false;
    rec.mesh.visible = false;
    byKey.set(rec.key, rec);
    return rec;
  }

  // ------------------------------------------------------------- selection
  const MAXQ = 64;
  const qKind = new Int32Array(MAXQ);
  const qIdx = new Int32Array(MAXQ);
  const qDist = new Float32Array(MAXQ);
  let qN = 0;
  let pendingTotal = 0;

  /** Keep the closest wanted-but-not-ready tiles. */
  function enqueue(kind, idx, d) {
    pendingTotal++;
    if (qN < MAXQ) {
      qKind[qN] = kind; qIdx[qN] = idx; qDist[qN] = d; qN++;
      return;
    }
    let worst = 0;
    for (let i = 1; i < qN; i++) if (qDist[i] > qDist[worst]) worst = i;
    if (qDist[worst] > d) {
      qKind[worst] = kind; qIdx[worst] = idx; qDist[worst] = d;
    }
  }

  /** Mark a tile as used this frame; show it when ready. @returns {boolean} drawn */
  function use(kind, idx, d, show) {
    const rec = byKey.get(kind * 4096 + idx);
    if (rec && rec.ready) {
      rec.used = frameId;
      rec.mesh.visible = show;
      if (rec.dirty) enqueue(kind, idx, d - 10000);
      return true;
    }
    enqueue(kind, idx, d);
    return false;
  }

  /** Make a ready tile visible as a stand-in for a missing finer one. */
  function fallback(kind, idx) {
    const rec = byKey.get(kind * 4096 + idx);
    if (!rec || !rec.ready) return false;
    rec.used = frameId;
    rec.mesh.visible = true;
    return true;
  }

  function select(fx, fy, fz) {
    const ranges = ctx.render.caps.lodRanges;
    const R0 = ranges[0];
    const R1 = ranges[1];
    const R2 = ranges[2];
    frameId++;
    qN = 0;
    pendingTotal = 0;
    for (let sj = 0; sj < SN; sj++) {
      for (let si = 0; si < SN; si++) {
        const s = sj * SN + si;
        const x0 = -WORLD_HALF + si * SUPER;
        const z0 = -WORLD_HALF + sj * SUPER;
        const d = boxDist(fx, fy, fz, x0, z0, SUPER, sMin[s], sMax[s]);
        if (d > R2 + PREFETCH) continue;
        if (d > R1) {
          use(K2, s, d, d <= R2);
          continue;
        }
        for (let q = 0; q < 4; q++) {
          const ci = si * 2 + (q & 1);
          const cj = sj * 2 + (q >> 1);
          const c = cj * CN + ci;
          const dc = boxDist(fx, fy, fz, -WORLD_HALF + ci * CHUNK, -WORLD_HALF + cj * CHUNK, CHUNK, cMin[c], cMax[c]);
          if (dc <= R0) {
            if (!use(K0, c, dc, true) && !fallback(K1, c)) fallback(K2, s);
          } else if (!use(K1, c, dc, true)) fallback(K2, s);
        }
      }
    }
    farMat.uniforms.uSinkRadius.value = R2;
    const tr = ctx.render.caps.treeRadius;
    chunkMat.uniforms.uCanopyNear.value = tr * 0.7;
    chunkMat.uniforms.uCanopyFar.value = tr * 1.02;
    farMat.uniforms.uCanopyNear.value = tr * 0.7;
    farMat.uniforms.uCanopyFar.value = tr * 1.02;
  }

  /** Hide unused tiles. */
  function hideUnused() {
    for (let k = 0; k < 3; k++) {
      const pool = pools[k];
      for (let i = 0; i < pool.length; i++) if (pool[i].used !== frameId) pool[i].mesh.visible = false;
    }
  }

  /** Build up to `budget` queued tiles, closest first. @returns {number} built */
  function buildQueued(budget) {
    let built = 0;
    while (built < budget && qN > 0) {
      let best = 0;
      for (let i = 1; i < qN; i++) if (qDist[i] < qDist[best]) best = i;
      const kind = qKind[best];
      const idx = qIdx[best];
      qN--;
      qKind[best] = qKind[qN]; qIdx[best] = qIdx[qN]; qDist[best] = qDist[qN];
      let rec = byKey.get(kind * 4096 + idx);
      if (!rec) rec = acquire(kind, idx);
      if (!rec) continue;
      fill(rec);
      rec.used = frameId;
      built++;
    }
    return built;
  }

  // ------------------------------------------------------------- far mesh
  /** @type {any} */
  let far = null;
  const FN = FAR_SEG + 1;
  const FCELL = (WORLD_HALF * 2) / FAR_SEG;

  /** Write far vertex (i, j). */
  function farVertex(i, j, pos, nor, col) {
    const x = -WORLD_HALF + i * FCELL;
    const z = -WORLD_HALF + j * FCELL;
    const k = j * FN + i;
    pos[k * 3] = x; pos[k * 3 + 1] = grid.heightAt(x, z); pos[k * 3 + 2] = z;
    const e = FCELL * 0.5;
    const nx = grid.heightAt(x - e, z) - grid.heightAt(x + e, z);
    const nz = grid.heightAt(x, z - e) - grid.heightAt(x, z + e);
    const ny = 2 * e;
    const l = 127 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    nor[k * 4] = Math.round(nx * l); nor[k * 4 + 1] = Math.round(ny * l); nor[k * 4 + 2] = Math.round(nz * l);
    nor[k * 4 + 3] = grid.regionIndexAt(x, z);
    let r = 0; let gg = 0; let b = 0; let c = 0;
    for (let q = -2; q <= 2; q++) {
      for (let p = -2; p <= 2; p++) {
        grid.tintAt(x + p * 10, z + q * 10, col4, 0);
        r += col4[0]; gg += col4[1]; b += col4[2];
        c += grid.canopyAt(x + p * 10, z + q * 10);
      }
    }
    col[k * 4] = (r / 25) * 255; col[k * 4 + 1] = (gg / 25) * 255; col[k * 4 + 2] = (b / 25) * 255; col[k * 4 + 3] = (c / 25) * 255;
  }

  function buildFar() {
    const nv = FN * FN;
    const geo = new BufferGeometry();
    const pos = new Float32Array(nv * 3);
    const nor = new Int8Array(nv * 4);
    const col = new Uint8Array(nv * 4);
    for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) farVertex(i, j, pos, nor, col);
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aNormal', new BufferAttribute(nor, 4, true));
    geo.setAttribute('aColor', new BufferAttribute(col, 4, true));
    const idx = new Uint16Array(FAR_SEG * FAR_SEG * 6);
    let k = 0;
    for (let j = 0; j < FAR_SEG; j++) {
      for (let i = 0; i < FAR_SEG; i++) {
        const a = j * FN + i;
        idx[k++] = a; idx[k++] = a + FN; idx[k++] = a + 1;
        idx[k++] = a + 1; idx[k++] = a + FN; idx[k++] = a + FN + 1;
      }
    }
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.boundingSphere = new Sphere(new Vector3(0, 0, 0), WORLD_HALF * 1.5);
    far = new Mesh(geo, farMat);
    far.frustumCulled = false;
    far.matrixAutoUpdate = false;
    ctx.render.layers.world.add(far);
  }
  buildFar();

  // ------------------------------------------------------------- api
  return {
    /** Per-frame LOD selection and build budget. */
    update(fx, fy, fz) {
      select(fx, fy, fz);
      buildQueued(ctx.render.caps.chunkBuilds);
      hideUnused();
    },
    /** Build everything the focus needs now. */
    flush(fx, fy, fz) {
      for (let guard = 0; guard < 40; guard++) {
        select(fx, fy, fz);
        if (qN === 0) break;
        buildQueued(1000);
      }
      select(fx, fy, fz);
      hideUnused();
    },
    /** @returns {number} tiles waiting for a build */
    pending: () => pendingTotal,
    /** Grid edit around (x, z, r): refresh bounds, mark tiles dirty, refresh far vertices. */
    edited(x, z, r) {
      const i0 = Math.max(0, Math.floor((x - r + WORLD_HALF) / CHUNK));
      const i1 = Math.min(CN - 1, Math.floor((x + r + WORLD_HALF) / CHUNK));
      const j0 = Math.max(0, Math.floor((z - r + WORLD_HALF) / CHUNK));
      const j1 = Math.min(CN - 1, Math.floor((z + r + WORLD_HALF) / CHUNK));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          bounds(i, j);
          for (let k = 0; k < 2; k++) {
            const rec = byKey.get(k * 4096 + j * CN + i);
            if (rec) rec.dirty = true;
          }
          const rec = byKey.get(2 * 4096 + (j >> 1) * SN + (i >> 1));
          if (rec) rec.dirty = true;
        }
      }
      if (far) {
        const geo = far.geometry;
        const fi0 = Math.max(0, Math.floor((x - r - FCELL + WORLD_HALF) / FCELL));
        const fi1 = Math.min(FN - 1, Math.ceil((x + r + FCELL + WORLD_HALF) / FCELL));
        const fj0 = Math.max(0, Math.floor((z - r - FCELL + WORLD_HALF) / FCELL));
        const fj1 = Math.min(FN - 1, Math.ceil((z + r + FCELL + WORLD_HALF) / FCELL));
        for (let j = fj0; j <= fj1; j++) for (let i = fi0; i <= fi1; i++) farVertex(i, j, geo.attributes.position.array, geo.attributes.aNormal.array, geo.attributes.aColor.array);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aNormal.needsUpdate = true;
        geo.attributes.aColor.needsUpdate = true;
      }
    },
    /** Visible terrain tiles (diagnostics). */
    visibleCount() {
      let n = 0;
      for (let k = 0; k < 3; k++) for (const r of pools[k]) if (r.mesh.visible) n++;
      return n;
    },
    dispose() {
      for (let k = 0; k < 3; k++) {
        for (const r of pools[k]) {
          if (r.mesh.parent) r.mesh.parent.remove(r.mesh);
          r.mesh.geometry.dispose();
        }
        pools[k].length = 0;
      }
      byKey.clear();
      if (far) {
        if (far.parent) far.parent.remove(far);
        far.geometry.dispose();
        far = null;
      }
      chunkMat.dispose();
      farMat.dispose();
    },
  };
}
