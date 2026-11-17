/**
 * The combat package (ARCHITECTURE 8.6): techniques, damage, Forms and targeting. Replaces the stand-in
 * `ctx.combat` and registers the player techniques, Forms and technique-tree nodes with their strings.
 * Systems: `combat.player` (intent, order 10), `combat.run` (combat), `combat.visuals` (frame vfx).
 * @module combat
 */

import { createCombatEngine } from './logic/engine.js';
import { createPlayerDriver } from './logic/driver.js';
import { registerScripts } from './logic/scripts.js';
import { playerTechniques } from './data/techniques.js';
import { formDefs, techNodeDefs } from './data/forms.js';
import { COMBAT_STRINGS } from './strings.js';
import { createVisuals } from './visuals.js';

export const pkg = {
  id: 'combat',
  /** @param {any} ctx */
  install(ctx) {
    ctx.i18n.addStrings(COMBAT_STRINGS);
    ctx.defs.register('technique', playerTechniques());
    ctx.defs.register('form', formDefs());
    ctx.defs.register('techNode', techNodeDefs());
    const engine = createCombatEngine(ctx);
    registerScripts(engine.combat);
    ctx.provide('combat', engine.combat, 'combat');
    ctx.systems.add(createPlayerDriver(ctx, engine));
    ctx.systems.add(engine.runSystem);
    const visuals = createVisuals(ctx, engine);
    ctx.systems.add(visuals.system);
    ctx.bus.on('actor:slam', engine.on.slam);
    ctx.bus.on('actor:removed', engine.on.removed);
    ctx.bus.on('game:ended', () => {
      engine.on.ended();
      visuals.clear();
    });
  },
};
