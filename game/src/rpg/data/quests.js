/**
 * Quests MQ1-MQ7 and SQ1-SQ4 (ARCHITECTURE 5.6; GDD 8.2, 8.6). Rewards come from BALANCE.quests; objective text
 * keys are `quest.<questId>.<stepId>`. Pure data.
 * @module rpg/data/quests
 */

import { BALANCE } from '../../core/balance.js';

/** XP, Shells and TP of a quest from BALANCE, followed by `extra` actions. */
function rewards(id, extra) {
  const r = BALANCE.quests[id];
  const out = [];
  if (r.xp) out.push({ op: 'giveXp', amount: r.xp });
  if (r.shells) out.push({ op: 'giveShells', amount: r.shells });
  if (r.tp) out.push({ op: 'giveTp', amount: r.tp });
  return out.concat(extra || []);
}

const SPARKSTEAD_WELL = { x: -1414, z: 1562 };

export const QUESTS = [
  {
    id: 'mq1', kind: 'main', order: 1, giver: 'sela', prereq: {}, autoStart: true,
    steps: [
      { id: 's1', type: 'script', script: 'tut_move', marker: { object: 'training_post' },
        onStart: [{ op: 'moveNpc', npc: 'sela', settlement: 'selas_ledge', spot: 'a' }] },
      { id: 's2', type: 'destroy', object: 'training_post', marker: { object: 'training_post' } },
      { id: 's3', type: 'script', script: 'tut_fly' },
      { id: 's4', type: 'script', script: 'tut_boost' },
      { id: 's5', type: 'kill', enemy: 'ember_wisp', count: 4, marker: { tag: 'mq1_wisps' }, onStart: [{ op: 'script', script: 'mq1_wisps' }] },
      { id: 's6', type: 'script', script: 'tut_awakening' },
      { id: 's7', type: 'kill', enemy: 'tusk_boar', count: 2, marker: { tag: 'mq1_boars' }, onStart: [{ op: 'script', script: 'mq1_boars' }],
        onComplete: [{ op: 'giveXp', amount: BALANCE.quests.mq1.stepXp }] },
      { id: 's8', type: 'reach', flag: 'attuned.ringstone_sparkstead', marker: { landmark: 'sparkstead' },
        onStart: [{ op: 'script', script: 'mq1_home' }] },
    ],
    rewards: rewards('mq1', [
      { op: 'moveNpc', npc: 'sela', settlement: 'sparkstead', spot: 'a' },
    ]),
  },
  {
    id: 'mq2', kind: 'main', order: 2, giver: 'dov', prereq: { quests: ['mq1'] }, autoStart: true,
    steps: [
      { id: 's1', type: 'talk', npc: 'dov', dialogue: 'mq2_dov', marker: { npc: 'dov' }, onComplete: [{ op: 'giveItem', item: 'sunfruit', count: 3 }] },
      { id: 's2', type: 'talk', npc: 'mira', dialogue: 'mq2_mira', marker: { npc: 'mira' }, onComplete: [{ op: 'giveItem', item: 'training_wraps', level: 1 }] },
      { id: 's3', type: 'kill', tag: 'mq2_raid', count: 4, marker: SPARKSTEAD_WELL,
        onStart: [{ op: 'script', script: 'mq2_raid' }, { op: 'spawnGroup', group: 'mq2_raid', x: -1410, z: 1560, questTag: 'mq2_raid', aggro: true }] },
      { id: 's4', type: 'defeat', boss: 'durn', marker: { landmark: 'sparkstead' },
        onStart: [{ op: 'script', script: 'mq2_durn' }, { op: 'startBoss', boss: 'durn' }] },
      { id: 's5', type: 'talk', npc: 'kerrin', dialogue: 'mq2_kerrin', marker: { npc: 'kerrin' } },
      { id: 's6', type: 'goto', landmark: 'siphon_1', radius: 70, marker: { landmark: 'siphon_1' } },
      { id: 's7', type: 'destroy', object: 'siphon_1', marker: { landmark: 'siphon_1' }, onStart: [{ op: 'script', script: 'mq2_siphon' }] },
      { id: 's8', type: 'talk', npc: 'sela', dialogue: 'mq2_sela', marker: { npc: 'sela' } },
    ],
    rewards: rewards('mq2', [
      { op: 'unlockForm', form: 'ember' }, { op: 'unlockTech', tech: 'nova_ring', slot: 0 },
      { op: 'startQuest', quest: 'mq3' }, { op: 'startQuest', quest: 'mq4' }, { op: 'startQuest', quest: 'mq5' }, { op: 'startQuest', quest: 'mq6' },
      { op: 'openScreen', screen: 'map' },
    ]),
  },
  {
    id: 'mq3', kind: 'main', order: 3, giver: 'talia', prereq: { quests: ['mq2'] },
    steps: [
      { id: 's1', type: 'talk', npc: 'talia', dialogue: 'mq3_talia', marker: { npc: 'talia' } },
      { id: 's2', type: 'kill', enemy: 'bramble_boar', count: 6, marker: { landmark: 'bramble_hollow' } },
      { id: 's3', type: 'goto', landmark: 'bramble_hollow', radius: 90, marker: { landmark: 'bramble_hollow' } },
      { id: 's4', type: 'defeat', boss: 'bramblehorn', marker: { landmark: 'bramble_hollow' }, onStart: [{ op: 'startBoss', boss: 'bramblehorn' }] },
      { id: 's5', type: 'destroy', object: 'siphon_2', marker: { landmark: 'siphon_2' } },
      { id: 's6', type: 'talk', npc: 'talia', dialogue: 'mq3_talia_end', marker: { npc: 'talia' } },
    ],
    rewards: rewards('mq3', [{ op: 'unlockTech', tech: 'ringfall', slot: 'ultimate' }]),
  },
  {
    id: 'mq4', kind: 'main', order: 4, giver: 'bren', prereq: { quests: ['mq2'] },
    steps: [
      { id: 's1', type: 'talk', npc: 'bren', dialogue: 'mq4_bren', marker: { npc: 'bren' },
        onComplete: [{ op: 'unlockTech', tech: 'dawn_lance', slot: 1 }] },
      { id: 's2', type: 'useTechnique', tech: 'dawn_lance', count: 3, targetTag: 'saltglass_pillar', marker: { object: 'saltglass_pillar' } },
      // Bren's thanks for holding the beacon (a reward between the Dawn Lance and the Siphon: the reward-cadence gap).
      { id: 's3', type: 'kill', tag: 'mq4_wave', count: 8, marker: { landmark: 'tide_beacon' },
        onStart: [{ op: 'script', script: 'mq4_wave' }], onComplete: [{ op: 'giveItem', item: 'saltglass_wraps', level: 7 }] },
      { id: 's4', type: 'destroy', object: 'siphon_3', marker: { landmark: 'siphon_3' } },
      { id: 's5', type: 'talk', npc: 'bren', dialogue: 'mq4_bren_end', marker: { npc: 'bren' } },
    ],
    rewards: rewards('mq4', [{ op: 'giveItem', item: 'tide_charm', level: 8 }]),
  },
  {
    id: 'mq5', kind: 'main', order: 5, giver: 'yael', prereq: { quests: ['mq2'] },
    steps: [
      { id: 's1', type: 'talk', npc: 'yael', dialogue: 'mq5_yael', marker: { npc: 'yael' } },
      { id: 's2', type: 'goto', landmark: 'burrow_pit', radius: 110, marker: { landmark: 'burrow_pit' } },
      { id: 's3', type: 'defeat', boss: 'gorrumaw', marker: { landmark: 'burrow_pit' }, onStart: [{ op: 'startBoss', boss: 'gorrumaw' }] },
      { id: 's4', type: 'destroy', object: 'siphon_4', marker: { landmark: 'siphon_4' } },
      { id: 's5', type: 'talk', npc: 'yael', dialogue: 'mq5_yael_end', marker: { npc: 'yael' } },
    ],
    rewards: rewards('mq5', [{ op: 'giveItem', item: 'wyrmhide_charm', level: 16 }]),
  },
  {
    id: 'mq6', kind: 'main', order: 6, giver: 'noa', prereq: { quests: ['mq2'] },
    steps: [
      { id: 's1', type: 'talk', npc: 'noa', dialogue: 'mq6_noa', marker: { npc: 'noa' } },
      // The bells answer with the monastery's charm (a reward on the long climb to Iskra: the reward-cadence gap).
      { id: 's2', type: 'interact', objects: ['bell_1', 'bell_2', 'bell_3'], onComplete: [{ op: 'giveItem', item: 'stillwind_charm', level: 20 }] },
      { id: 's3', type: 'goto', landmark: 'paleglass_summit', radius: 100, marker: { landmark: 'paleglass_summit' } },
      { id: 's4', type: 'defeat', boss: 'iskra', marker: { landmark: 'paleglass_summit' }, onStart: [{ op: 'startBoss', boss: 'iskra' }] },
      { id: 's5', type: 'talk', npc: 'noa', dialogue: 'mq6_noa_end', marker: { npc: 'noa' }, onComplete: [{ op: 'unlockForm', form: 'tempest' }] },
      { id: 's6', type: 'destroy', object: 'siphon_5', marker: { landmark: 'siphon_5' } },
    ],
    rewards: rewards('mq6', [{ op: 'giveItem', item: 'frost_charm', level: 22 }]),
  },
  {
    id: 'mq7', kind: 'main', order: 7, giver: 'sela', prereq: { quests: ['mq2'], siphons: BALANCE.siphon.mq7Required }, autoStart: true,
    steps: [
      { id: 's1', type: 'talk', npc: 'sela', dialogue: 'mq7_sela', marker: { npc: 'sela' },
        onStart: [{ op: 'moveNpc', npc: 'sela', settlement: 'spire_approach', spot: 'a' }, { op: 'moveNpc', npc: 'kerrin', settlement: 'spire_approach', spot: 'b' },
          { op: 'banner', kind: 'quest', key: 'rpg.banner.mq7' }] },
      { id: 's2', type: 'kill', tag: 'mq7_gate', count: 3, marker: { landmark: 'dim_court' },
        onStart: [{ op: 'spawnGroup', group: 'mq7_gate', x: 0, z: 420, questTag: 'mq7_gate', aggro: true }] },
      { id: 's3', type: 'defeat', boss: 'vorrhal', marker: { landmark: 'dim_court' }, onStart: [{ op: 'startBoss', boss: 'vorrhal' }] },
      { id: 's4', type: 'script', script: 'ending' },
      { id: 's5', type: 'talk', npc: 'sela', dialogue: 'mq7_epilogue', marker: { npc: 'sela' } },
    ],
    rewards: rewards('mq7', [{ op: 'giveItem', item: 'lantern_mantle', level: 26 }, { op: 'setFlag', key: 'credits', value: true },
      { op: 'banner', kind: 'quest', key: 'rpg.banner.freeRoam' }]),
  },
  {
    id: 'sq1', kind: 'side', order: 11, giver: 'ilan', prereq: { quests: ['mq1'] },
    steps: [
      { id: 's1', type: 'interact', objects: ['fallen_blade_1', 'fallen_blade_2', 'fallen_blade_3'] },
      { id: 's2', type: 'kill', enemy: 'ember_wisp', count: 5, marker: { landmark: 'sparkstead' } },
    ],
    rewards: rewards('sq1', [{ op: 'giveItem', item: 'sunfruit', count: 3 }]),
  },
  {
    id: 'sq2', kind: 'side', order: 12, giver: 'rina', prereq: { quests: ['mq1'] },
    steps: [
      { id: 's1', type: 'interact', objects: ['lost_bell_1', 'lost_bell_2', 'lost_bell_3'] },
      { id: 's2', type: 'talk', npc: 'rina', dialogue: 'sq2_rina_end', marker: { npc: 'rina' } },
    ],
    rewards: rewards('sq2', [{ op: 'giveItem', item: 'wind_charm', level: 4 }]),
  },
  {
    id: 'sq3', kind: 'side', order: 13, giver: 'gal', prereq: { quests: ['mq1'] },
    steps: [
      { id: 's1', type: 'race', course: 'windmill_run', medal: 'bronze' },
    ],
    rewards: rewards('sq3', [{ op: 'giveItem', item: 'racers_wraps', level: 3 }]),
  },
  {
    id: 'sq4', kind: 'side', order: 14, giver: 'yael', prereq: { quests: ['mq2'] },
    steps: [
      { id: 's1', type: 'kill', enemy: 'rust_golem', count: 3, marker: { landmark: 'copperwatch' } },
      { id: 's2', type: 'collect', item: 'rust_core', count: 3 },
      { id: 's3', type: 'deliver', item: 'rust_core', count: 3, npc: 'yael', dialogue: 'sq4_yael_end', marker: { npc: 'yael' } },
    ],
    rewards: rewards('sq4', [{ op: 'giveItem', item: 'golem_core_charm', level: 14 }]),
  },
];
