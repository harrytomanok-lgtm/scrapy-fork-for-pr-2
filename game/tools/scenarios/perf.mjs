/**
 * Integration performance scenarios: the low-tier frame budget of the merged game (ARCHITECTURE 7.1).
 * perf-budget asserts at most 85 draw calls at rest (the spawn, above every settlement, at every region centre),
 * at most 120 with 12 enemies in a fight, and at most 250k triangles and 24 programs everywhere.
 * perf-probe (run with --only perf-probe) prints the draw-call breakdown of each view for diagnosis.
 */

const REST = 85;
const FIGHT = 120;
const TRIS = 250000;
const PROGRAMS = 24;

/**
 * In the page: put the player at (x, z) (alt > 0 flies), camera yaw/pitch/dist, settle streaming, render, measure.
 * @param {any} g
 * @param {{ x:number, z:number, alt?:number, yaw:number, pitch:number, dist?:number, steps?:number, top?:number }} o
 */
function viewAt(g, o) {
  g.teleport(o.x, o.z, { alt: o.alt || 0, yaw: o.yaw });
  g.setCamera({ yaw: o.yaw, pitch: o.pitch, dist: o.dist });
  g.step(3);
  g.cmd.flushBuilds();
  g.step(o.steps || 3);
  g.cmd.flushBuilds();
  g.render();
  const s = g.stats();
  const b = g.cmd.drawBreakdown({ top: o.top || 12 });
  return { drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs, groups: b.groups, layers: b.layers };
}

/** In the page: every view of the rest budget. @param {any} g */
function restViews(g) {
  const views = [];
  const p = g.player();
  views.push({ label: 'spawn', x: p.x, z: p.z, yaw: p.yaw || 0, pitch: -0.1 });
  const settlements = g.ctx.defs.all('settlement').map((d) => d.id);
  for (const id of settlements) {
    const lm = g.ctx.world.landmark(id);
    if (!lm) continue;
    // above the settlement looking down at it from the south-east, and over the rooftops
    views.push({ label: id + ' air', x: lm.x + 50, z: lm.z + 70, alt: 45, yaw: Math.atan2(-50, -70), pitch: -0.35, dist: 10 });
    views.push({ label: id + ' top', x: lm.x, z: lm.z, alt: 25, yaw: 0.8, pitch: -0.5, dist: 10 });
    views.push({ label: id + ' street', x: lm.x + 20, z: lm.z + 30, yaw: Math.atan2(-20, -30), pitch: 0.02, dist: 7 });
  }
  for (const r of g.ctx.world.regions) {
    const yaw = r.id === 'spire' ? 0.6 : Math.atan2(-r.cx, -r.cz);
    views.push({ label: r.id + ' ground', x: r.cx, z: r.cz, yaw, pitch: -0.05 });
    views.push({ label: r.id + ' air', x: r.cx, z: r.cz, alt: r.id === 'spire' ? 160 : 90, yaw, pitch: -0.32 });
  }
  return views;
}

/** @param {any} s @param {number} limit @param {string} label @param {any} assert */
function check(assert, s, limit, label) {
  assert.ok(s.drawCalls > 0, `${label}: something was drawn`);
  assert.ok(s.drawCalls <= limit, `${label}: draw calls ${s.drawCalls} <= ${limit}`);
  assert.ok(s.triangles <= TRIS, `${label}: triangles ${s.triangles} <= ${TRIS}`);
  assert.ok(s.programs <= PROGRAMS, `${label}: programs ${s.programs} <= ${PROGRAMS}`);
}

/** @param {any} s */
function fmt(s) {
  return s.groups.map((x) => `${x.key}=${x.calls}`).join(' ');
}

/** In the page: spawn 12 enemies in a ring around the player and start a fight. @param {any} g */
function fight(g) {
  const ids = g.ctx.defs.all('enemy').filter((d) => !d.boss).map((d) => d.id);
  const out = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const p = g.player();
    const id = g.spawn(ids[i % ids.length], { x: p.x + Math.sin(a) * (5 + (i % 3) * 3), z: p.z + Math.cos(a) * (5 + (i % 3) * 3), aggro: true });
    out.push(id);
  }
  return out;
}

export const scenarios = [
  {
    name: 'perf-budget',
    query: 'hour=15',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const views = await game(restViews);
      const results = [];
      for (const v of views) {
        const s = await game(viewAt, v);
        results.push({ label: v.label, s });
        console.log(`  ${v.label}: ${s.drawCalls} calls, ${s.triangles} tris, ${s.programs} programs`);
        check(assert, s, REST, v.label);
      }
      const worst = results.reduce((a, b) => (b.s.drawCalls > a.s.drawCalls ? b : a));
      console.log(`  worst at rest: ${worst.label} ${worst.s.drawCalls} calls: ${fmt(worst.s)}`);
      // the fight: 12 enemies around the player at the spawn, the player attacking
      const p0 = await game((g) => {
        const lm = g.ctx.world.landmark('sparkstead');
        return { x: lm.x + 40, z: lm.z + 60 };
      });
      await game(viewAt, { x: p0.x, z: p0.z, yaw: 0, pitch: -0.15 });
      const n = await game(fight);
      assert.equal(n.filter((id) => id > 0).length, 12, 'twelve enemies spawned');
      let peak = { drawCalls: 0, triangles: 0, programs: 0, groups: [] };
      for (let i = 0; i < 8; i++) {
        const s = await game((g) => {
          g.press('attack');
          g.step(12);
          g.render();
          const st = g.stats();
          const b = g.cmd.drawBreakdown({ top: 12 });
          return { drawCalls: st.drawCalls, triangles: st.triangles, programs: st.programs, groups: b.groups };
        });
        if (s.drawCalls > peak.drawCalls) peak = s;
        check(assert, s, FIGHT, 'fight frame ' + i);
      }
      console.log(`  fight peak: ${peak.drawCalls} calls, ${peak.triangles} tris: ${fmt(peak)}`);
      await shot('perf-fight');
    },
  },
  {
    // the phone: portrait at full resolution, standing at the spawn in Sparkstead
    name: 'perf-portrait',
    query: 'hour=15&res=1',
    width: 412,
    height: 915,
    async run({ game, assert, shot }) {
      const s = await game((g) => {
        g.step(30);
        g.render();
        const st = g.stats();
        const b = g.cmd.drawBreakdown({ top: 12 });
        return { drawCalls: st.drawCalls, triangles: st.triangles, programs: st.programs, groups: b.groups };
      });
      console.log(`  portrait spawn: ${s.drawCalls} calls, ${s.triangles} tris: ${fmt(s)}`);
      check(assert, s, REST, 'portrait spawn');
      await shot('perf-portrait-spawn');
    },
  },
  {
    // look checks: Sparkstead from the air, a region vista, the village at night
    name: 'perf-shots',
    query: 'hour=16',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const lm = await game((g) => {
        const l = g.ctx.world.landmark('sparkstead');
        return { x: l.x, z: l.z };
      });
      const air = await game(viewAt, { x: lm.x - 70, z: lm.z + 95, alt: 30, yaw: Math.atan2(70, -95), pitch: -0.22, dist: 10 });
      check(assert, air, REST, 'sparkstead air');
      await shot('perf-sparkstead-air');
      const vista = await game(viewAt, { x: -2300, z: -300, alt: 60, yaw: Math.atan2(2300, 300), pitch: -0.12 });
      check(assert, vista, REST, 'thornwood vista');
      await shot('perf-vista');
      await game((g) => g.setHour(22));
      const night = await game(viewAt, { x: lm.x + 22, z: lm.z + 34, yaw: Math.atan2(-30, -34), pitch: 0.02, dist: 7 });
      check(assert, night, REST, 'sparkstead night');
      await shot('perf-night');
    },
  },
  {
    name: 'perf-probe',
    query: 'hour=15',
    width: 640,
    height: 360,
    async run({ game }) {
      const views = await game(restViews);
      for (const v of views) {
        const s = await game(viewAt, { ...v, top: 14 });
        console.log(`  ${v.label}: ${s.drawCalls} calls ${s.triangles} tris | ${JSON.stringify(s.layers)} | ${fmt(s)}`);
      }
    },
  },
];
