/**
 * places scenarios: the world gallery on the low tier at res=1 (phone size). Each scenario renders several views
 * and composes them, HUD-free (only the WebGL canvas is copied), into one contact sheet:
 * tools/out/shots/places-<sheet>.png. Every view also checks the low-tier budget (perf-budget numbers).
 *   places-regions-ground   each region at eye level, portrait
 *   places-regions-air      each region from 150 m, landscape
 *   places-villages-day     each settlement by day, portrait
 *   places-villages-night   each settlement at night, portrait
 *   places-landmarks-far    each landmark from about 500 m in flight, landscape
 *   places-landmarks-near   each landmark from close by, portrait
 * Run with `node tools/scenarios.mjs places [--only name]`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_SHOTS } from '../lib/harness.mjs';

const TRIS = 250000;
const REST = 100;
const PROGRAMS = 30;

/** Boot state: AI and ambient spawns off, nothing alive around, the clock frozen. */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  await game((g) => {
    g.ai(false);
    g.ambient(false);
    g.unlockAll();
    g.god(true);
    g.setLevel(25);
    g.setHour(12);
    g.killAll();
    g.step(2);
  });
}

/**
 * In the page: render one view and copy the canvas into tile `i` of the sheet (window.__sheet).
 * A view either follows the player (x, z, alt, yaw, pitch, dist) or uses a free stage camera (from, to): then the
 * player hides 4 m behind the camera so streaming centres on it.
 */
const SHOOT = `(g, o) => {
  g.setHour(o.hour);
  if (o.from) {
    const dx = o.to[0] - o.from[0];
    const dz = o.to[2] - o.from[2];
    const yaw = Math.atan2(dx, dz);
    const d = Math.hypot(dx, dz) || 1;
    const px = o.from[0] - (dx / d) * 4;
    const pz = o.from[2] - (dz / d) * 4;
    const gy = g.ctx.world.heightAt(px, pz);
    g.teleport(px, pz, { y: Math.max(gy + 0.2, o.from[1] - 2), fly: o.from[1] - gy > 3, yaw });
    g.cmd.actorsStage(o.from, o.to);
  } else {
    g.cmd.actorsStage(null);
    g.teleport(o.x, o.z, { alt: o.alt || 0, yaw: o.yaw });
    g.setCamera({ yaw: o.yaw, pitch: o.pitch, dist: o.dist });
  }
  g.step(3);
  g.cmd.flushBuilds();
  for (let i = 0; i < 4; i++) g.step(30);
  g.cmd.flushBuilds();
  if (!o.from && o.alt) g.teleport(o.x, o.z, { alt: o.alt, yaw: o.yaw });
  if (!o.from) g.setCamera({ yaw: o.yaw, pitch: o.pitch, dist: o.dist });
  g.step(o.settle || 20);
  g.cmd.flushBuilds();
  g.render();
  const s = g.stats();
  const src = g.ctx.three.renderer.domElement;
  const sh = window.__sheet;
  const col = o.i % sh.cols;
  const row = Math.floor(o.i / sh.cols);
  const c2 = sh.canvas.getContext('2d');
  c2.drawImage(src, col * sh.tw, row * sh.th, sh.tw, sh.th);
  c2.font = '600 13px sans-serif';
  c2.fillStyle = 'rgba(0,0,0,0.55)';
  c2.fillRect(col * sh.tw, row * sh.th, Math.min(sh.tw, 8 + o.name.length * 7.4), 19);
  c2.fillStyle = '#fff';
  c2.fillText(o.name, col * sh.tw + 4, row * sh.th + 14);
  return { drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs };
}`;

/** In the page: a dry, gentle spot near (x, z) (spiral search). */
const SPOT = `(g, x, z, minR) => {
  const w = g.ctx.world;
  const ok = (px, pz) => {
    const h = w.heightAt(px, pz);
    if (h < 3 || Math.hypot(px, pz) < (minR || 170)) return false;
    for (let a = 0; a < 8; a++) {
      const d = Math.abs(w.heightAt(px + Math.cos(a * 0.785) * 8, pz + Math.sin(a * 0.785) * 8) - h);
      if (d > 1.2) return false;
    }
    return w.waterDepthAt(px, pz) <= 0;
  };
  for (let r = 0; r < 900; r += 30) {
    const n = Math.max(1, Math.floor(r / 15));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}`;

/**
 * In the page: the clearest of 16 directions to look at a target from `dist` m at `up` m above the target, with
 * terrain line of sight. Returns { from, to }.
 */
const AIM = `(g, tx, ty, tz, dist, up, lookUp) => {
  const w = g.ctx.world;
  let best = null;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const fx = tx + Math.sin(a) * dist;
    const fz = tz + Math.cos(a) * dist;
    const fy = Math.max(w.heightAt(fx, fz) + 2, ty + up);
    let clear = 0;
    for (let k = 1; k < 24; k++) {
      const t = k / 24;
      const y = fy + (ty + lookUp - fy) * t;
      clear += y > w.heightAt(fx + (tx - fx) * t, fz + (tz - fz) * t) + 2 ? 1 : 0;
    }
    const score = clear * 10 - (fy - ty - up) * 0.05 + (i === 0 ? 0.01 : 0);
    if (!best || score > best.score) best = { score, from: [fx, fy, fz], to: [tx, ty + lookUp, tz] };
  }
  return best;
}`;

/**
 * Run a sheet: start the sheet canvas, shoot every view, check the budget, write the PNG.
 * @param {any} game @param {any} assert @param {string} name @param {any[]} views
 * @param {{ cols:number, scale:number, width:number, height:number, limit?:number }} o
 */
async function sheet(game, assert, name, views, o) {
  const cols = Math.min(o.cols, views.length);
  const rows = Math.ceil(views.length / cols);
  await game((g, c, r, tw, th) => {
    const cv = document.createElement('canvas');
    cv.width = c * tw;
    cv.height = r * th;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#222';
    c2.fillRect(0, 0, cv.width, cv.height);
    window.__sheet = { canvas: cv, cols: c, tw, th };
  }, cols, rows, Math.round(o.width * o.scale), Math.round(o.height * o.scale));
  for (let i = 0; i < views.length; i++) {
    const v = Object.assign({ i }, views[i]);
    const s = await game((g, src, vv) => (0, eval)('(' + src + ')')(g, vv), SHOOT, v);
    console.log(`  ${name} ${v.name}: ${s.drawCalls} dc, ${s.triangles} tris, ${s.programs} programs`);
    const lim = o.limit || REST;
    assert.ok(s.drawCalls <= lim && s.triangles <= TRIS && s.programs <= PROGRAMS, `${name} ${v.name}: within the low budget (${s.drawCalls} dc, ${s.triangles} tris, ${s.programs} programs)`);
  }
  const url = await game(() => window.__sheet.canvas.toDataURL('image/png'));
  mkdirSync(OUT_SHOTS, { recursive: true });
  writeFileSync(join(OUT_SHOTS, 'places-' + name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
  const errs = await game((g) => g.errors.filter((e) => e.indexOf('[error]') === 0 || e.indexOf('[fatal]') === 0));
  assert.equal(errs.length, 0, 'no errors: ' + errs.join(' | '));
}

/** In the page: region views (eye level or 150 m up). */
function regionViews(g, spotSrc, alt) {
  const spot = (0, eval)('(' + spotSrc + ')');
  const out = [];
  for (const r of g.ctx.world.regions) {
    const p = spot(g, r.id === 'spire' ? r.cx + 240 : r.cx, r.id === 'spire' ? r.cz + 240 : r.cz);
    const yaw = Math.atan2(-p.x, -p.z) + (r.id === 'spire' ? 0.35 : 0.6);
    if (alt) {
      const y = g.ctx.world.heightAt(p.x, p.z) + alt;
      out.push({ name: r.id + ' 150m', from: [p.x, y, p.z], to: [p.x + Math.sin(yaw) * 400, y - 150, p.z + Math.cos(yaw) * 400], hour: 11 });
    } else {
      out.push({ name: r.id, x: p.x, z: p.z, yaw, pitch: -0.04, dist: 6, hour: 11 });
    }
  }
  return out;
}

/** In the page: settlement views (day or night). */
function villageViews(g, hour) {
  const out = [];
  for (const d of g.ctx.defs.all('settlement')) {
    const lm = g.ctx.world.landmark(d.id);
    if (!lm) continue;
    const a = 0.7;
    const x = lm.x + Math.sin(a) * 34;
    const z = lm.z + Math.cos(a) * 34;
    const gy = g.ctx.world.heightAt(lm.x, lm.z);
    const fy = Math.max(g.ctx.world.heightAt(x, z), gy) + 9;
    out.push({ name: d.id + (hour > 20 || hour < 5 ? ' night' : ''), from: [x, fy, z], to: [lm.x, gy + 2, lm.z], hour });
  }
  return out;
}

/** In the page: landmark targets [name, x, y, z, lookUp]. */
function landmarkTargets(g) {
  const w = g.ctx.world;
  const out = [];
  const add = (name, x, z, up) => out.push([name, x, w.heightAt(x, z), z, up]);
  add('spire', 0, 0, 260);
  for (const id of ['tide_beacon', 'haven_aster', 'copperwatch', 'still_wind']) {
    const lm = w.landmark(id);
    if (lm) add(id, lm.x, lm.z, id === 'haven_aster' ? 25 : 12);
  }
  const sp = g.ctx.defs.find('settlement', 'sparkstead');
  const lm = w.landmark('sparkstead');
  const wm = sp.buildings.find((b) => b.kind === 'windmill');
  add('windmill', lm.x + wm.dx, lm.z + wm.dz, 8);
  if (w.places) for (const p of w.places()) add(p.id, p.x, p.z, p.lookUp || 10);
  return out;
}

/** @param {string} name @param {number} width @param {number} height @param {Function} make @param {any} o */
function scenario(name, width, height, make, o) {
  return {
    name: 'places-' + name,
    width,
    height,
    query: 'res=1',
    async run({ game, assert }) {
      await opening(game, assert);
      const views = await make(game);
      assert.ok(views.length > 0, 'views to shoot');
      await sheet(game, assert, name, views, Object.assign({ width, height }, o));
    },
  };
}

export const scenarios = [
  scenario('regions-ground', 412, 915, (game) => game(regionViews, SPOT, 0), { cols: 4, scale: 0.6 }),
  scenario('regions-air', 915, 412, (game) => game(regionViews, SPOT, 150), { cols: 2, scale: 0.6 }),
  scenario('villages-day', 412, 915, (game) => game(villageViews, 12), { cols: 5, scale: 0.55 }),
  scenario('villages-night', 412, 915, (game) => game(villageViews, 22.5), { cols: 5, scale: 0.55 }),
  scenario('landmarks-far', 915, 412, async (game) => {
    const t = await game(landmarkTargets);
    const out = [];
    for (const [name, x, y, z, up] of t) {
      const far = name === 'spire' ? 1400 : 500;
      const a = await game((g, src, ...args) => (0, eval)('(' + src + ')')(g, ...args), AIM, x, y, z, far, name === 'spire' ? 120 : 120, up * 0.5);
      out.push({ name: name + ' far', from: a.from, to: a.to, hour: 15 });
    }
    return out;
  }, { cols: 3, scale: 0.5 }),
  scenario('landmarks-near', 412, 915, async (game) => {
    const t = await game(landmarkTargets);
    const out = [];
    for (const [name, x, y, z, up] of t) {
      const near = name === 'spire' ? 260 : 60;
      const a = await game((g, src, ...args) => (0, eval)('(' + src + ')')(g, ...args), AIM, x, y, z, near, name === 'spire' ? 20 : 6, up * 0.6);
      out.push({ name: name + ' near', from: a.from, to: a.to, hour: 15 });
    }
    return out;
  }, { cols: 5, scale: 0.5 }),
];
