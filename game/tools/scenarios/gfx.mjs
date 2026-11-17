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
    },
  },
];
