/**
 * The rpg package (ARCHITECTURE 8.8): progression, items, shops, loot, quests, dialogue, interactables, NPCs,
 * world activities and all story content. One service root that provides both `ctx.rpg` (4.11) and
 * `ctx.quests` (4.12), replacing the stand-ins.
 * @module rpg
 */

import { createRpg } from './rpgService.js';
import { createQuests } from './questService.js';
import { registerScripts } from './scripts.js';
import { registerChallenges } from './challenges.js';
import { ITEMS, SHOPS, LOOT_TABLES } from './data/items.js';
import { NPCS, OBJECTS, COURSES } from './data/world.js';
import { QUESTS } from './data/quests.js';
import { DIALOGUES } from './data/dialogues.js';
import { RPG_STRINGS } from './strings.js';
import { DIALOGUE_STRINGS } from './stringsDialogue.js';

export const pkg = {
  id: 'rpg',
  /** @param {any} ctx */
  install(ctx) {
    ctx.i18n.addStrings(RPG_STRINGS);
    ctx.i18n.addStrings(DIALOGUE_STRINGS);
    ctx.defs.register('item', ITEMS);
    ctx.defs.register('shop', SHOPS);
    ctx.defs.register('lootTable', LOOT_TABLES);
    ctx.defs.register('npc', NPCS);
    ctx.defs.register('object', OBJECTS);
    ctx.defs.register('course', COURSES);
    ctx.defs.register('dialogue', DIALOGUES);
    ctx.defs.register('quest', QUESTS);

    const r = createRpg(ctx);
    ctx.provide('rpg', r.rpg, 'rpg');
    const q = createQuests(ctx, { isPlayerSide: r.isPlayerSide });
    ctx.provide('quests', q.quests, 'rpg');
    registerScripts(ctx);
    r.setTrialRetry(registerChallenges(ctx, { travel: (id) => q.activities.travel(id), raceStart: (id) => q.activities.raceStart(id),
      busyReason: () => q.activities.busyReason() }));

    ctx.systems.add(r.tickSystem);
    ctx.systems.add(q.runSystem);
    r.hooks();

    const bus = ctx.bus;
    bus.on('actor:died', r.on.died);
    bus.on('actor:died', q.on.died);
    bus.on('player:died', r.on.playerDied);
    bus.on('player:died', q.activities.playerDied);
    bus.on('combat:form', r.on.recompute);
    bus.on('combat:gather', r.on.gather);
    bus.on('boss:start', r.on.bossStart);
    bus.on('boss:end', r.on.bossEnd);
    bus.on('boss:end', q.on.bossEnd);
    bus.on('game:newGame', r.on.newGame);
    bus.on('game:loaded', q.on.loaded);
    bus.on('game:ended', q.on.ended);
    bus.on('game:ended', r.on.ended);
    bus.on('combat:techStart', q.on.techStart);
    bus.on('combat:hit', q.on.hit);
    bus.on('interact:used', q.on.used);
    bus.on('race:end', q.on.raceEnd);
    bus.on('camp:cleared', q.activities.campCleared);
    bus.on('rpg:item', q.on.poll);
    bus.on('rpg:levelUp', q.on.poll);
    bus.on('pickup:collected', q.activities.pickupCollected);

    if (ctx.debug && ctx.debug.register) {
      ctx.debug.register('rpgTalk', (npcId) => ctx.quests.talkTo(npcId));
      ctx.debug.register('rpgAdvance', (i) => ctx.quests.advance(i));
      ctx.debug.register('rpgDialogue', () => ctx.quests.dialogueState());
      ctx.debug.register('rpgObjects', () => ctx.quests.objects());
    }
  },
};
