/**
 * picture scenarios: the gallery of the rendered image on the low tier at res=1 (render polish). Six fixed views,
 * each in its phone orientation (meadows at ground level and the village at night in portrait 412x915; Sparkstead at
 * golden hour, a coast view over the water, flight at 150 m and a mountain vista in landscape 915x412), plus the
 * five time-of-day keys on one view. Every view checks the low-tier budget at rest with shadows on.
 * Shots go to tools/out/shots/picture-<tag>-<view>.png; the tag is $PICTURE_TAG (default 'now'), so before and after
 * pairs can be kept side by side.
 * Run with `node tools/scenarios.mjs picture [--only name]`.
 */

const TAG = (typeof process !== 'undefined' && process.env.PICTURE_TAG) || 'now';
/** Rest budget of the low tier with shadows on (perf.mjs REST), triangles and programs. */
const REST = 100;
const TRIS = 250000;
const PROGRAMS = 30;

/** Boot state: AI and ambient spawns off, everything unlocked, nothing alive around. */
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

/** In the page: place, aim, settle streaming, set the hour, render; returns the frame stats. */
const VIEW = `(g, o) => {
  g.setHour(o.hour);
  g.teleport(o.x, o.z, { alt: o.alt || 0, yaw: o.yaw });
  g.setCamera({ yaw: o.yaw, pitch: o.pitch, dist: o.dist });
  g.step(3);
  g.cmd.flushBuilds();
  for (let i = 0; i < 6; i++) g.step(40);
  g.cmd.flushBuilds();
  if (o.alt) g.teleport(o.x, o.z, { alt: o.alt, yaw: o.yaw });
  g.setCamera({ yaw: o.yaw, pitch: o.pitch, dist: o.dist });
  g.step(30);
  const s = g.stats();
  return { drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs };
}`;

/** In the page: a dry, gentle spot near (x, z) (spiral search; falls back to (x, z)). */
const SPOT = `(g, x, z) => {
  const w = g.ctx.world;
  const ok = (px, pz) => {
    const h = w.heightAt(px, pz);
    if (h < 3 || Math.hypot(px, pz) < 170) return false;
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

/** In the page: the six fixed views and the time-of-day view. */
function views(g, spotSrc) {
  const spot = (0, eval)('(' + spotSrc + ')');
  const W = g.ctx.world;
  const m = W.regions.find((r) => r.id === 'meadows');
  const mp = spot(g, m.cx, m.cz);
  const sp = W.landmark('sparkstead');
  const tb = W.landmark('tide_beacon');
  const rr = W.landmark('ridgerest');
  const ps = W.landmark('paleglass_summit');
  // coast: a dry spot near the Tide Beacon, looking along the shore out to sea (south)
  const cp = { x: tb.x - 140, z: tb.z - 320 };
  for (let i = 0; i < 160 && W.waterDepthAt(cp.x, cp.z + 4) <= 0.3; i++) cp.z += 4;
  cp.z -= 10;
  const out = {
    portrait: [
      { name: 'meadows', x: mp.x, z: mp.z, yaw: Math.atan2(-mp.x, -mp.z) + 0.25, pitch: -0.12, hour: 12 },
      { name: 'village-night', x: sp.x + 18, z: sp.z + 26, yaw: Math.atan2(-18, -26), pitch: -0.08, hour: 0 },
    ],
    landscape: [
      { name: 'sparkstead-golden', x: sp.x + 18, z: sp.z + 26, yaw: Math.atan2(-18, -26) + 0.5, pitch: -0.06, hour: 17.5 },
      { name: 'coast', x: cp.x, z: cp.z, yaw: -0.35, pitch: -0.2, hour: 14 },
      { name: 'flight-150', x: m.cx, z: m.cz, alt: 150, yaw: Math.atan2(-m.cx, -m.cz), pitch: -0.3, hour: 12 },
      { name: 'mountain-vista', x: rr.x + 300, z: rr.z + 700, alt: 260, yaw: Math.atan2(ps.x - rr.x - 300, ps.z - rr.z - 700), pitch: -0.1, hour: 10 },
    ],
    hours: [5.5, 12, 17.5, 20, 0].map((h) => ({ name: 'hour-' + String(h).replace('.', ''), x: mp.x, z: mp.z, yaw: Math.atan2(-mp.x, -mp.z) + 0.25, pitch: -0.1, hour: h })),
  };
  return out;
}

/** @param {string} label @param {any} s @param {any} assert */
function budget(assert, s, label) {
  assert.ok(s.drawCalls > 0 && s.drawCalls <= REST, `${label}: draw calls ${s.drawCalls} <= ${REST}`);
  assert.ok(s.triangles <= TRIS, `${label}: triangles ${s.triangles} <= ${TRIS}`);
  assert.ok(s.programs <= PROGRAMS, `${label}: programs ${s.programs} <= ${PROGRAMS}`);
}

/** @param {'portrait'|'landscape'|'hours'} set @param {number} width @param {number} height */
function gallery(set, width, height) {
  return {
    name: 'picture-' + set,
    width,
    height,
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const all = await game(views, SPOT);
      for (const v of all[set]) {
        const s = await game((g, src, o) => (0, eval)('(' + src + ')')(g, o), VIEW, v);
        console.log(`  ${set} ${v.name}: ${s.drawCalls} dc, ${s.triangles} tris, ${s.programs} programs`);
        budget(assert, s, v.name);
        await shot(`picture-${TAG}-${v.name}`);
      }
      const errs = await game((g) => g.errors.filter((e) => e.indexOf('[error]') === 0 || e.indexOf('[fatal]') === 0));
      assert.equal(errs.length, 0, 'no errors: ' + errs.join(' | '));
    },
  };
}

export const scenarios = [
  gallery('portrait', 412, 915),
  gallery('landscape', 915, 412),
  gallery('hours', 915, 412),
];
