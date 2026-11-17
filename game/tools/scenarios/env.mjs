/**
 * env package scenarios (ARCHITECTURE 8.2): the day cycle from one spot, Sparkstead and Haven Aster (settlement
 * screenshots within the low-tier draw-call and triangle budgets), every prop kind in a row with its states cycled.
 */

const LOW = { drawCalls: 120, triangles: 250000, programs: 24 };

/**
 * In the page: stand the player at an offset from a landmark, look at a target, settle streaming.
 * @param {any} g @param {{ id:string, dx:number, dz:number, tx:number, tz:number, pitch:number, dist?:number, alt?:number }} o
 */
function viewAt(g, o) {
  const lm = g.ctx.world.landmark(o.id);
  const x = lm.x + o.dx;
  const z = lm.z + o.dz;
  const yaw = Math.atan2(lm.x + o.tx - x, lm.z + o.tz - z);
  g.teleport(x, z, { yaw, alt: o.alt });
  g.setCamera({ yaw, pitch: o.pitch, dist: o.dist });
  g.step(3);
  g.cmd.flushBuilds();
  g.step(3);
  g.cmd.flushBuilds();
  g.render();
  const s = g.stats();
  return { drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs };
}

/** @param {any} assert @param {any} s @param {string} label */
function budget(assert, s, label) {
  console.log(`  ${label}: ${s.drawCalls} calls, ${s.triangles} tris, ${s.programs} programs`);
  assert.ok(s.drawCalls > 0, `${label}: something was drawn`);
  assert.ok(s.drawCalls <= LOW.drawCalls, `${label}: draw calls ${s.drawCalls} <= ${LOW.drawCalls}`);
  assert.ok(s.triangles <= LOW.triangles, `${label}: triangles ${s.triangles} <= ${LOW.triangles}`);
  assert.ok(s.programs <= LOW.programs, `${label}: programs ${s.programs} <= ${LOW.programs}`);
}

export const scenarios = [
  {
    name: 'env-day-cycle',
    query: 'hour=12',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const info = await game((g) => g.cmd.envInfo());
      assert.ok(info.sky, 'the sky dome exists');
      assert.equal(info.settlements.built, 9, 'nine settlements built');
      const hours = [6, 12, 18, 21, 0];
      const seen = [];
      for (const h of hours) {
        await game((g, hh) => g.setHour(hh), h);
        const s = await game(viewAt, { id: 'sparkstead', dx: 34, dz: 58, tx: -10, tz: -6, pitch: 0.05, dist: 9 });
        const r = await game((g) => {
          const gl = g.ctx.render.globals;
          return {
            s: null, hour: g.ctx.env.hour, phase: g.ctx.env.phase, night: g.ctx.env.isNight,
            sun: gl.uSunColor.value.toArray(), fog: gl.uFogColor.value.toArray(), dir: gl.uSunDir.value.toArray(),
          };
        });
        r.s = s;
        budget(assert, r.s, 'hour ' + h);
        assert.ok(Math.abs(r.hour - h) < 1e-6, `hour ${h} set (clock frozen by flags.hour)`);
        assert.ok(r.dir[1] > 0.1, `hour ${h}: the light is above the horizon`);
        seen.push(r);
        await shot('env-day-' + String(h).padStart(2, '0'));
      }
      assert.equal(seen[1].phase, 'day', 'noon is day');
      assert.equal(seen[4].night, true, 'midnight is night');
      assert.ok(seen[1].sun[0] + seen[1].sun[1] > seen[4].sun[0] + seen[4].sun[1] + 1, 'noon is much brighter than midnight');
      // the sky toward the setting sun, and the night sky over the Spire (stars, moon, the Seam)
      await game((g) => g.setHour(17.4));
      await game(viewAt, { id: 'sparkstead', dx: 0, dz: 20, tx: -100, tz: 42, pitch: 0.28, dist: 7 });
      await shot('env-sky-sunset');
      await game((g) => g.setHour(23.5));
      await game((g) => {
        const lm = g.ctx.world.landmark('sparkstead');
        const yaw = Math.atan2(-lm.x, -lm.z);
        g.setCamera({ yaw, pitch: 0.55, dist: 7 });
        g.step(2);
      });
      await shot('env-sky-night');
      const ev = await game((g) => g.events(['env:hour']).map((e) => e.payload || e));
      assert.ok(ev.length >= 5, `env:hour emitted on each change (${ev.length})`);
      // the clock runs: one game hour per real minute at scale 1
      const adv = await game((g) => {
        g.ctx.env.setHour(10);
        g.ctx.env.setClockScale(1);
        const h0 = g.ctx.env.hour;
        g.step(600);
        const h1 = g.ctx.env.hour;
        g.ctx.env.setClockScale(0);
        return h1 - h0;
      });
      assert.ok(Math.abs(adv - 10 / 60) < 0.01, `600 ticks advance the clock by 1/6 hour (${adv.toFixed(4)})`);
    },
  },
  {
    name: 'env-sparkstead',
    query: 'hour=16',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const s = await game(viewAt, { id: 'sparkstead', dx: -70, dz: 95, tx: 0, tz: 0, pitch: -0.22, dist: 10, alt: 30 });
      budget(assert, s, 'sparkstead aerial');
      await shot('env-sparkstead');
      const s2 = await game(viewAt, { id: 'sparkstead', dx: 22, dz: 34, tx: -8, tz: 0, pitch: 0.02, dist: 7 });
      budget(assert, s2, 'sparkstead street');
      await shot('env-sparkstead-street');
      const spots = await game((g) => {
        const out = { x: 0, y: 0, z: 0, yaw: 0 };
        const res = {};
        for (const id of ['ringstone', 'a', 'b', 'c', 'stall', 'forge', 'well']) res[id] = g.ctx.env.spot('sparkstead', id, out) ? { x: out.x, y: out.y, z: out.z } : null;
        return res;
      });
      for (const [id, p] of Object.entries(spots)) assert.ok(p && Number.isFinite(p.y), `spot ${id} resolved on the ground`);
      // dusk: lanterns and windows light
      await game((g) => g.setHour(21.5));
      const s3 = await game(viewAt, { id: 'sparkstead', dx: 22, dz: 34, tx: -8, tz: 0, pitch: 0.02, dist: 7 });
      budget(assert, s3, 'sparkstead night');
      await shot('env-sparkstead-night');
    },
  },
  {
    name: 'env-haven-aster',
    query: 'hour=10',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const s = await game(viewAt, { id: 'haven_aster', dx: 60, dz: 120, tx: -10, tz: -10, pitch: -0.18, dist: 10, alt: 35 });
      budget(assert, s, 'haven aster aerial');
      await shot('env-haven-aster');
      const s2 = await game(viewAt, { id: 'haven_aster', dx: 6, dz: 30, tx: 0, tz: -30, pitch: 0.12, dist: 7 });
      budget(assert, s2, 'haven aster plaza');
      await shot('env-haven-aster-plaza');
      const info = await game((g) => ({ s: g.ctx.env.settlement('haven_aster'), env: g.cmd.envInfo() }));
      assert.ok(info.s && info.s.spots.length >= 5, 'haven aster has its spots');
      assert.ok(info.env.settlements.colliders > 50, `settlement colliders registered (${info.env.settlements.colliders})`);
      console.log(`  settlements: ${JSON.stringify(info.env.settlements)}`);
    },
  },
  {
    name: 'env-props',
    query: 'hour=15',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const kinds = ['ringstone', 'shrine', 'chest', 'ringGate', 'trainingPost', 'bell', 'fallenBlade', 'saltPillar', 'crate', 'lightPillar', 'campfire', 'tent', 'signpost', 'siphon'];
      const r = await game((g, list) => {
        const lm = g.ctx.world.landmark('sparkstead');
        const ox = lm.x + 70;
        const oz = lm.z - 40;
        window.__envProps = [];
        const res = [];
        for (let i = 0; i < list.length; i++) {
          const k = list[i];
          const x = ox + (i - 6) * 5.2 + (k === 'siphon' ? 22 : 0);
          const z = oz + (k === 'siphon' ? -26 : 0);
          const y = g.ctx.world.heightAt(x, z) + (k === 'ringGate' ? 5.5 : 0);
          const h = g.ctx.env.spawnProp(k, x, y, z, { yaw: k === 'ringGate' ? 0 : 0.35 });
          window.__envProps.push(h);
          res.push({ kind: h.kind, id: h.id, hasObject: !!h.object });
        }
        g.teleport(ox, oz + 26, { yaw: Math.PI });
        g.setCamera({ yaw: Math.PI, pitch: 0.12, dist: 8 });
        g.step(3);
        g.cmd.flushBuilds();
        g.step(2);
        return res;
      }, kinds);
      assert.equal(r.length, kinds.length, 'every prop kind spawned');
      for (const p of r) assert.ok(p.hasObject, `${p.kind} has an object`);
      const STATES = {
        ringstone: ['idle', 'active'], shrine: ['ready', 'claimed'], chest: ['locked', 'closed', 'open'], siphon: ['closed', 'open', 'destroyed'],
        ringGate: ['idle', 'next', 'passed'], trainingPost: ['idle', 'broken'], bell: ['idle', 'used'], fallenBlade: ['idle', 'used'],
        saltPillar: ['idle', 'used', 'broken'], crate: ['idle', 'used', 'broken'], lightPillar: ['on', 'off'], campfire: ['idle'], tent: ['idle'], signpost: ['idle'],
      };
      for (let si = 0; si < 3; si++) {
        const s = await game((g, o) => {
          for (const h of window.__envProps) {
            const st = o.STATES[h.kind];
            h.setState(st[Math.min(o.si, st.length - 1)]);
            h.setGlow(o.si === 1 ? 0.8 : 0);
          }
          g.step(30);
          g.render();
          const st = g.stats();
          return { drawCalls: st.drawCalls, triangles: st.triangles, programs: st.programs, states: window.__envProps.map((h) => h.state) };
        }, { STATES, si });
        budget(assert, s, 'props state ' + si);
        for (const side of [-1, 1]) {
          await game((g, sd) => {
            const lm = g.ctx.world.landmark('sparkstead');
            const x = lm.x + 70 + sd * 17 - 2;
            const z = lm.z - 40 + 15;
            g.teleport(x, z, { yaw: Math.PI });
            g.setCamera({ yaw: Math.PI, pitch: 0.1, dist: 5 });
            g.step(2);
          }, side);
          await shot('env-props-' + si + (side < 0 ? 'a' : 'b'));
        }
      }
      const after = await game((g) => {
        const n0 = g.cmd.envInfo().props;
        for (const h of window.__envProps) h.dispose();
        window.__envProps = [];
        return { n0, n1: g.cmd.envInfo().props };
      });
      assert.ok(after.n0 >= 14 && after.n1 === after.n0 - 14, `props disposed (${after.n0} -> ${after.n1})`);
    },
  },
  {
    name: 'env-settlements',
    query: 'hour=15',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const ids = ['copperwatch', 'ridgerest', 'still_wind', 'talias_camp', 'tide_beacon', 'selas_ledge', 'spire_approach'];
      for (const id of ids) {
        const s = await game(viewAt, { id, dx: 32, dz: 44, tx: 0, tz: 0, pitch: -0.12, dist: 9, alt: 10 });
        budget(assert, s, id);
        await shot('env-settle-' + id);
      }
    },
  },
];
