/**
 * The ai package (ARCHITECTURE 8.7): enemies, spawning, bosses. Replaces the stand-in `ctx.ai` and registers the
 * enemy and boss techniques, the enemy, boss, group and spawn-table definitions and their strings.
 * Systems: `ai.brains` (intent, order 20) and `ai.spawner` (post).
 * @module ai
 */

import { aiTechniques } from './data/techniques.js';
import { enemies, bosses, GROUPS, SPAWN_TABLES } from './data/enemies.js';
import { AI_STRINGS } from './strings.js';
import { createAi } from './service.js';

export const pkg = {
  id: 'ai',
  /** @param {any} ctx */
  install(ctx) {
    ctx.i18n.addStrings(AI_STRINGS);
    ctx.defs.register('technique', aiTechniques());
    ctx.defs.register('enemy', enemies());
    ctx.defs.register('boss', bosses());
    ctx.defs.register('group', GROUPS);
    ctx.defs.register('spawnTable', SPAWN_TABLES);
    const s = createAi(ctx);
    ctx.provide('ai', s.ai, 'ai');
    ctx.systems.add(s.brainSystem);
    ctx.systems.add(s.spawnerSystem);
    const bus = ctx.bus;
    bus.on('actor:died', s.on.died);
    bus.on('actor:damaged', s.on.damaged);
    bus.on('player:respawned', s.on.respawned);
    bus.on('player:died', s.on.playerDied);
    bus.on('game:ended', s.on.ended);
    if (ctx.debug && ctx.debug.register) {
      ctx.debug.register('aiState', (id) => ctx.ai.debugState(id));
      ctx.debug.register('aiTokens', () => ctx.ai.tokens());
      ctx.debug.register('aiCamps', () => ctx.ai.camps());
    }
  },
};
