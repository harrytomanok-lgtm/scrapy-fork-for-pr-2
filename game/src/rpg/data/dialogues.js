/**
 * Dialogues (ARCHITECTURE 5.7; GDD 8.4, 8.5). Line keys are `<questId>.lNN` (MQ1 and MQ2 exactly as in the GDD),
 * `<npc>.idle.*` for idle talk; the text lives in strings_dialogue.js. Pure data.
 * @module rpg/data/dialogues
 */

/**
 * A linear dialogue: nodes n1..nN; `actions` run on the last node.
 * @param {string} id @param {Array<[string, string]>} lines [speaker, textKey] @param {any[]} [actions]
 */
function seq(id, lines, actions) {
  const nodes = {};
  lines.forEach(([speaker, text], i) => {
    nodes['n' + (i + 1)] = { speaker, text, next: i + 1 < lines.length ? 'n' + (i + 2) : null };
  });
  if (actions) nodes['n' + lines.length].actions = actions;
  return { id, start: 'n1', nodes };
}

/**
 * A side-quest offer: the giver's lines, then the player's choice: accept (starts the quest) or not now.
 * @param {string} id @param {string} questId @param {Array<[string, string]>} lines
 * @param {string} acceptKey @param {string} declineKey @param {string} thanksKey speaker line after accepting
 */
function offer(id, questId, lines, acceptKey, declineKey, thanksKey) {
  const d = seq(id, lines);
  const last = d.nodes['n' + lines.length];
  last.next = null;
  last.choices = [
    { text: acceptKey, next: 'yes', actions: [{ op: 'startQuest', quest: questId }] },
    { text: declineKey, next: null },
  ];
  d.nodes.yes = { speaker: lines[0][0], text: thanksKey, next: null };
  return d;
}

/** @param {string} npc @param {string|null} shop @param {number} lines number of greetings (one is picked by the first node) */
function idle(npc, shop) {
  const nodes = {
    n1: { speaker: npc, text: npc + '.idle.greet', choices: [] },
    talk: { speaker: npc, text: npc + '.idle.talk', next: null },
  };
  if (shop) nodes.n1.choices.push({ text: 'rpg.choice.shop', next: null, actions: [{ op: 'openScreen', screen: 'shop', params: { shopId: shop } }] });
  nodes.n1.choices.push({ text: 'rpg.choice.talk', next: 'talk' });
  nodes.n1.choices.push({ text: 'rpg.choice.bye', next: null });
  return { id: npc + '_idle', start: 'n1', nodes };
}

const S = 'sela';
const T = 'tavi';

export const DIALOGUES = [
  // MQ1 "The Spark": spoken by the tutorial scripts, two lines at most per box (GDD 8.4).
  seq('mq1_post', [[S, 'mq1.l01'], [T, 'mq1.l02']]),
  seq('mq1_post_hit', [[S, 'mq1.l03']]),
  // A returning player (MQ1 done in an earlier journey) may skip the training: the first choice keeps it.
  {
    id: 'mq1_skip', start: 'n1',
    nodes: {
      n1: { speaker: S, text: 'mq1.skip.l01', next: null, choices: [
        { text: 'rpg.choice.train', next: 'train' },
        { text: 'rpg.choice.skipTut', next: null, actions: [{ op: 'script', script: 'skip_tutorial' }] },
      ] },
      train: { speaker: S, text: 'mq1.l01', next: null },
    },
  },
  seq('mq1_wake', [[S, 'mq1.l04'], [T, 'mq1.l05'], [S, 'mq1.l06']]),
  seq('mq1_rings', [[T, 'mq1.l07'], [S, 'mq1.l08']]),
  seq('mq1_wisps', [[S, 'mq1.l09']]),
  seq('mq1_gather', [[S, 'mq1.l10']]),
  seq('mq1_awake', [[T, 'mq1.l11'], [S, 'mq1.l12']]),
  seq('mq1_boars', [[S, 'mq1.l13'], [S, 'mq1.l14']]),
  seq('mq1_home', [[S, 'mq1.l15']]),

  // MQ2 "Smoke over Sparkstead" (GDD 8.5).
  seq('mq2_dov', [['dov', 'mq2.l01']]),
  seq('mq2_mira', [['mira', 'mq2.l02']]),
  seq('mq2_raid', [['villager', 'mq2.l03'], ['choir_acolyte', 'mq2.l04']]),
  seq('mq2_durn', [['durn', 'mq2.l05'], [T, 'mq2.l06'], ['durn', 'mq2.l07']]),
  seq('mq2_kerrin', [['kerrin', 'mq2.l08'], [T, 'mq2.l09'], ['kerrin', 'mq2.l10']]),
  seq('mq2_siphon', [[S, 'mq2.l11'], [S, 'mq2.l12']]),
  seq('mq2_sela', [[S, 'mq2.l13'], [S, 'mq2.l14'], ['kerrin', 'mq2.l15'], [S, 'mq2.l16'], ['system', 'mq2.l17'], [S, 'mq2.l18']]),

  // MQ3 "Roots of Rot".
  seq('mq3_talia', [['talia', 'mq3.l01'], [T, 'mq3.l02'], ['talia', 'mq3.l03'], ['talia', 'mq3.l04']]),
  seq('mq3_talia_end', [['talia', 'mq3.l05'], [T, 'mq3.l06'], ['talia', 'mq3.l07'], ['system', 'mq3.l08']]),
  // MQ4 "The Glass Tide".
  seq('mq4_bren', [['bren', 'mq4.l01'], [T, 'mq4.l02'], ['bren', 'mq4.l03'], ['bren', 'mq4.l04'], ['system', 'mq4.l05']]),
  seq('mq4_bren_end', [['bren', 'mq4.l06'], [T, 'mq4.l07'], ['bren', 'mq4.l08']]),
  // MQ5 "The Burrow King".
  seq('mq5_yael', [['yael', 'mq5.l01'], [T, 'mq5.l02'], ['yael', 'mq5.l03']]),
  seq('mq5_yael_end', [['yael', 'mq5.l04'], [T, 'mq5.l05'], ['yael', 'mq5.l06']]),
  // MQ6 "Pale Wings".
  seq('mq6_noa', [['noa', 'mq6.l01'], [T, 'mq6.l02'], ['noa', 'mq6.l03'], ['noa', 'mq6.l04']]),
  seq('mq6_noa_end', [['noa', 'mq6.l05'], [T, 'mq6.l06'], ['noa', 'mq6.l07'], ['system', 'mq6.l08'], ['noa', 'mq6.l09']]),
  // MQ7 "The Last Vein" and the finale.
  seq('mq7_sela', [[S, 'mq7.l01'], ['kerrin', 'mq7.l02'], [T, 'mq7.l03'], [S, 'mq7.l04']]),
  seq('mq7_tethers', [['vorrhal', 'mq7.l05'], [S, 'mq7.l06'], [T, 'mq7.l07']]),
  seq('mq7_zenith', [[S, 'mq7.l08'], ['vorrhal', 'mq7.l09']]),
  seq('mq7_ending', [['system', 'mq7.l10'], [S, 'mq7.l11'], ['kerrin', 'mq7.l12']]),
  seq('mq7_epilogue', [[S, 'mq7.l13'], [T, 'mq7.l14'], [S, 'mq7.l15']]),

  // Side quests.
  offer('sq1_offer', 'sq1', [['ilan', 'sq1.l01'], ['ilan', 'sq1.l02']], 'sq1.l03', 'sq1.l04', 'sq1.l05'),
  offer('sq2_offer', 'sq2', [['rina', 'sq2.l01'], ['rina', 'sq2.l02']], 'sq2.l03', 'sq2.l04', 'sq2.l05'),
  seq('sq2_rina_end', [['rina', 'sq2.l06'], ['rina', 'sq2.l07']]),
  offer('sq3_offer', 'sq3', [['gal', 'sq3.l01'], ['gal', 'sq3.l02']], 'sq3.l03', 'sq3.l04', 'sq3.l05'),
  offer('sq4_offer', 'sq4', [['yael', 'sq4.l01'], ['yael', 'sq4.l02']], 'sq4.l03', 'sq4.l04', 'sq4.l05'),
  seq('sq4_yael_end', [['yael', 'sq4.l06'], ['yael', 'sq4.l07']]),

  // Idle talk.
  idle('sela', null), idle('kerrin', null), idle('dov', 'dov_stall'), idle('mira', null), idle('ilan', null), idle('rina', null),
  idle('gal', null), idle('eli', 'aster_market'), idle('bren', null), idle('talia', 'talia_herbs'), idle('yael', 'yael_outpost'),
  idle('oren', 'ridgerest_provisions'), idle('noa', null),
];
