/**
 * NPCs, quest objects and race courses (ARCHITECTURE 5.7; GDD 8, 9, 11). Pure data.
 * Settlement spots used are the ones every settlement provides (a, b, c, stall); free-standing homes use coordinates.
 * @module rpg/data/world
 */

import { BALANCE } from '../../core/balance.js';
import { spireCircuit } from './challenges.js';

/** @param {string} id @param {object} home @param {object} [o] */
const npc = (id, home, o) => Object.assign({ id, specId: 'npc_' + id, home, idleDialogue: id + '_idle', voicePitch: 300 }, o || {});

export const NPCS = [
  npc('sela', { settlement: 'sparkstead', spot: 'a' }, { voicePitch: 290, face: 'neutral' }),
  npc('kerrin', { settlement: 'sparkstead', spot: 'b' }, { voicePitch: 260, face: 'happy' }),
  npc('dov', { settlement: 'sparkstead', spot: 'stall' }, { shop: 'dov_stall', voicePitch: 420, face: 'happy' }),
  npc('mira', { settlement: 'sparkstead', spot: 'c' }, { voicePitch: 330 }),
  npc('ilan', { x: -1488, z: 1604, yaw: 2.2 }, { voicePitch: 240 }),
  npc('rina', { x: -1750, z: 1250, yaw: 0.6 }, { voicePitch: 360, face: 'happy' }),
  npc('gal', { x: -1214, z: 1268, yaw: 2.6 }, { voicePitch: 380, face: 'happy' }),
  npc('eli', { settlement: 'haven_aster', spot: 'stall' }, { shop: 'aster_market', voicePitch: 280 }),
  npc('bren', { settlement: 'tide_beacon', spot: 'a' }, { voicePitch: 340 }),
  npc('talia', { settlement: 'talias_camp', spot: 'a' }, { shop: 'talia_herbs', voicePitch: 350 }),
  npc('yael', { settlement: 'copperwatch', spot: 'stall' }, { shop: 'yael_outpost', voicePitch: 360 }),
  npc('oren', { settlement: 'ridgerest', spot: 'stall' }, { shop: 'ridgerest_provisions', voicePitch: 230 }),
  npc('noa', { settlement: 'still_wind', spot: 'a' }, { voicePitch: 320, face: 'neutral' }),
];

/** Quest objects and Siphons (ObjectDef). Siphon positions are their landmarks; HP is hpMult x HP(region level). */
export const OBJECTS = [
  { id: 'training_post', prop: 'trainingPost', x: -1645, z: 1852, hpMult: 0.5, targetTag: 'post', quest: 'mq1' },
  { id: 'siphon_1', prop: 'siphon', x: -1000, z: 720, hpMult: BALANCE.siphon.hpMult, targetTag: 'siphon_1' },
  { id: 'siphon_2', prop: 'siphon', x: -2150, z: -215, hpMult: BALANCE.siphon.hpMult, targetTag: 'siphon_2' },
  { id: 'siphon_3', prop: 'siphon', x: 860, z: 2300, hpMult: BALANCE.siphon.hpMult, targetTag: 'siphon_3' },
  { id: 'siphon_4', prop: 'siphon', x: 1860, z: 1150, hpMult: BALANCE.siphon.hpMult, targetTag: 'siphon_4' },
  { id: 'siphon_5', prop: 'siphon', x: -1400, z: -2300, hpMult: BALANCE.siphon.hpMult, targetTag: 'siphon_5' },
  // MQ4: a saltglass pillar on the Tide Beacon headland; the Dawn Lance focuses through it. Too tough to break in three casts.
  { id: 'saltglass_pillar', prop: 'saltPillar', x: 205, z: 2910, hpMult: 60, targetTag: 'saltglass_pillar', quest: 'mq4' },
  // MQ6: the three wind bells on the peaks around the Still Wind monastery.
  { id: 'bell_1', prop: 'bell', x: -440, z: -2630, promptKey: 'rpg.prompt.bell', quest: 'mq6' },
  { id: 'bell_2', prop: 'bell', x: -150, z: -2650, promptKey: 'rpg.prompt.bell', quest: 'mq6' },
  { id: 'bell_3', prop: 'bell', x: -330, z: -2320, promptKey: 'rpg.prompt.bell', quest: 'mq6' },
  // SQ2: Rina's lost bells on the meadow hilltops.
  { id: 'lost_bell_1', prop: 'bell', x: -1890, z: 1170, promptKey: 'rpg.prompt.bell', quest: 'sq2' },
  { id: 'lost_bell_2', prop: 'bell', x: -1630, z: 1100, promptKey: 'rpg.prompt.bell', quest: 'sq2' },
  { id: 'lost_bell_3', prop: 'bell', x: -1830, z: 1400, promptKey: 'rpg.prompt.bell', quest: 'sq2' },
  // SQ1: the windmill's blades, blown into the fields around Ilan's mill.
  { id: 'fallen_blade_1', prop: 'fallenBlade', x: -1530, z: 1660, yaw: 0.7, promptKey: 'rpg.prompt.blade', quest: 'sq1' },
  { id: 'fallen_blade_2', prop: 'fallenBlade', x: -1440, z: 1668, yaw: 2.1, promptKey: 'rpg.prompt.blade', quest: 'sq1' },
  { id: 'fallen_blade_3', prop: 'fallenBlade', x: -1548, z: 1572, yaw: 4.0, promptKey: 'rpg.prompt.blade', quest: 'sq1' },
  // Finale: tether anchors on a ring around the Dim Court, created by the finale_tethers script (one per silenced Siphon).
  ...[1, 2, 3, 4, 5].map((n) => {
    const a = -Math.PI / 2 + (n - 3) * 0.55;
    return { id: 'tether_' + n, prop: 'lightPillar', x: Math.round(Math.cos(a) * 95), z: Math.round(300 - Math.sin(a) * 95),
      promptKey: 'rpg.prompt.tether', quest: 'mq7', script: true };
  }),
];

/** GDD 3.4 Windmill Run: 14 gates looping through the windmill valley, low and fast, with one climb over the ridge. */
export const COURSES = [{
  id: 'windmill_run', start: { x: -1200, z: 1250 },
  gates: [
    { x: -1170, z: 1215, alt: 14 }, { x: -1120, z: 1170, alt: 20 }, { x: -1060, z: 1130, alt: 26 }, { x: -995, z: 1115, alt: 32 },
    { x: -935, z: 1140, alt: 30 }, { x: -900, z: 1195, alt: 24 }, { x: -905, z: 1260, alt: 40 }, { x: -945, z: 1320, alt: 55 },
    { x: -1010, z: 1355, alt: 45 }, { x: -1080, z: 1360, alt: 32 }, { x: -1145, z: 1335, alt: 22 }, { x: -1195, z: 1295, alt: 16 },
    { x: -1235, z: 1240, alt: 14 }, { x: -1215, z: 1185, alt: 18 },
  ],
  medals: Object.assign({}, BALANCE.world.race.windmill_run), goldReward: 'ember_charm',
}, spireCircuit()];
