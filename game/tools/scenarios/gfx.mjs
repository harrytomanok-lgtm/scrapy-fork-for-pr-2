/**
 * gfx scenarios (ARCHITECTURE 8.3): materials, the VFX gallery, beam and auras, tiers.
 * Run with `node tools/scenarios.mjs gfx [--only name]`. Screenshots go to tools/out/shots.
 */

/** Boot state shared by every scenario: test journey running, HUD on top. */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  return p;
}

export const scenarios = [
  {
    name: 'gfx-materials',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const progAfterCompile = await game((g) => g.stats().programs);
      await game((g) => {
        g.setHour(12);
        g.cmd.gfxTestRow({});
        g.setCamera({ pitch: 0.12, dist: 4 });
        g.step(20);
      });
      await shot('gfx-materials-noon');
      const s = await game((g) => g.stats());
      assert.ok(s.programs <= 24, `programs on low <= 24 (got ${s.programs})`);
      assert.equal(s.programs, progAfterCompile, 'no program linked after compile');
      assert.ok(s.drawCalls <= 120, `draw calls <= 120 (got ${s.drawCalls})`);
      await game((g) => {
        g.setHour(0);
        g.step(20);
      });
      await shot('gfx-materials-midnight');
      const s2 = await game((g) => g.stats());
      assert.equal(s2.programs, progAfterCompile, 'no program linked at night');
      console.log(`    programs after compile: ${progAfterCompile}, draw calls ${s.drawCalls}, triangles ${s.triangles}`);
    },
  },
  {
    name: 'gfx-vfx-gallery',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const prog0 = await game((g) => g.stats().programs);
      const n = await game((g) => {
        g.setHour(12);
        g.ai(false);
        g.setCamera({ pitch: -0.7, dist: 24 });
        g.step(2);
        const k = g.cmd.gfxGallery({ dist: 16, cols: 8, spacing: 5 });
        g.step(4);
        return k;
      });
      assert.ok(n >= 46, 'every IDS.vfx recipe triggered');
      await shot('gfx-vfx-gallery-a');
      let maxP = 0;
      for (let i = 0; i < 4; i++) {
        const p = await game((g) => {
          g.step(5);
          return g.stats().particles;
        });
        maxP = Math.max(maxP, p);
      }
      await shot('gfx-vfx-gallery-b');
      const s = await game((g) => g.stats());
      assert.ok(maxP <= 800, `particles on low <= 800 (max ${maxP})`);
      assert.ok(maxP > 100, `the gallery emitted particles (max ${maxP})`);
      assert.equal(s.programs, prog0, 'no program linked by the gallery');
      console.log(`    gallery: max particles ${maxP}, draw calls ${s.drawCalls}, programs ${s.programs}`);
    },
  },
  {
    name: 'gfx-beam-aura',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const prog0 = await game((g) => g.stats().programs);
      const ids = await game((g) => {
        g.setHour(17.5);
        g.ai(false);
        g.setCamera({ pitch: -0.18, dist: 5 });
        const r = g.cmd.gfxBeamAura({ dist: 9 });
        for (let i = 0; i < 10; i++) g.step(3);
        return r;
      });
      assert.equal(ids.length, 4, 'four actors with auras');
      await shot('gfx-beam-aura');
      const st = await game((g) => g.cmd.gfxVfxState());
      assert.ok(st.beams >= 1, 'a beam is live');
      assert.ok(st.shells >= 4, 'four aura shells are live');
      const s = await game((g) => g.stats());
      assert.equal(s.programs, prog0, 'no program linked by beams and auras');
      await game((g) => {
        g.setHour(0);
        g.step(6);
      });
      await shot('gfx-beam-aura-night');
    },
  },
];
