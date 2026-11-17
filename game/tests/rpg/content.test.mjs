import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDefs } from '../../src/core/defs.js';
import { IDS } from '../../src/core/ids.js';
import { STRINGS } from '../../src/core/strings.js';
import { standinDefs } from '../../src/standins/content.js';
import { ITEMS, SHOPS, LOOT_TABLES } from '../../src/rpg/data/items.js';
import { NPCS, OBJECTS, COURSES } from '../../src/rpg/data/world.js';
import { QUESTS } from '../../src/rpg/data/quests.js';
import { DIALOGUES } from '../../src/rpg/data/dialogues.js';
import { RPG_STRINGS } from '../../src/rpg/strings.js';
import { DIALOGUE_STRINGS } from '../../src/rpg/stringsDialogue.js';
import { STEP_TYPES } from '../../src/rpg/logic/questEngine.js';

const MINE = { item: ITEMS, shop: SHOPS, lootTable: LOOT_TABLES, npc: NPCS, object: OBJECTS, course: COURSES, quest: QUESTS, dialogue: DIALOGUES };

function registry() {
  const defs = createDefs({ strict: true });
  const all = standinDefs();
  for (const kind of Object.keys(all)) defs.register(kind, all[kind]);
  for (const kind of Object.keys(MINE)) defs.register(kind, MINE[kind]);
  return defs;
}

const has = (lang, key) => key in RPG_STRINGS[lang] || key in DIALOGUE_STRINGS[lang] || key in STRINGS[lang];

test('defs.validate passes with the rpg content over the stand-ins', () => {
  const r = registry().validate({ throwOnError: false });
  assert.deepEqual(r.errors, []);
});

test('every id of IDS for the kinds rpg owns is defined, and nothing extra', () => {
  for (const kind of ['item', 'shop', 'lootTable', 'npc', 'quest', 'object', 'course']) {
    const ids = MINE[kind].map((d) => d.id).sort();
    assert.deepEqual(ids, IDS[kind].slice().sort(), kind);
  }
});

test('every id referenced by quests, shops, loot, NPCs and dialogues exists in rpg data or in IDS', () => {
  const mine = (kind, id) => MINE[kind] && MINE[kind].some((d) => d.id === id);
  const ok = (kind, id) => mine(kind, id) || (IDS[kind] && IDS[kind].includes(id));
  const dlg = (id) => DIALOGUES.some((d) => d.id === id);
  const actions = (list, where) => {
    for (const a of list || []) {
      if (a.item) assert.ok(ok('item', a.item), where + ' item ' + a.item);
      if (a.quest) assert.ok(ok('quest', a.quest), where + ' quest ' + a.quest);
      if (a.tech) assert.ok(ok('technique', a.tech), where + ' tech ' + a.tech);
      if (a.form) assert.ok(ok('form', a.form), where);
      if (a.group) assert.ok(ok('group', a.group), where + ' group ' + a.group);
      if (a.boss) assert.ok(ok('boss', a.boss), where);
      if (a.npc) assert.ok(ok('npc', a.npc), where);
      if (a.settlement) assert.ok(ok('settlement', a.settlement), where);
      if (a.op === 'openScreen' && a.params && a.params.shopId) assert.ok(ok('shop', a.params.shopId), where);
    }
  };
  for (const q of QUESTS) {
    if (q.giver) assert.ok(ok('npc', q.giver));
    for (const s of q.steps) {
      const w = q.id + '.' + s.id;
      assert.ok(STEP_TYPES.includes(s.type), w + ' type');
      if (s.npc) assert.ok(ok('npc', s.npc), w);
      if (s.dialogue) assert.ok(dlg(s.dialogue), w + ' dialogue ' + s.dialogue);
      if (s.type === 'talk' || s.type === 'deliver') assert.ok(s.npc, w + ' needs an npc');
      for (const k of ['enemy', 'boss', 'item', 'landmark', 'object', 'course', 'tech']) {
        const kind = { enemy: 'enemy', boss: 'boss', item: 'item', landmark: 'landmark', object: 'object', course: 'course', tech: 'technique' }[k];
        if (s[k]) assert.ok(ok(kind, s[k]), w + ' ' + k + ' ' + s[k]);
      }
      for (const o of s.objects || []) assert.ok(ok('object', o), w);
      if (s.script) assert.ok(/registerScript\('/.test(SCRIPTS) && SCRIPTS.includes("'" + s.script + "'"), w + ' script ' + s.script);
      actions(s.onStart, w);
      actions(s.onComplete, w);
    }
    actions(q.rewards, q.id);
  }
  for (const s of SHOPS) for (const id of s.stock) assert.ok(ok('item', id), s.id);
  for (const n of NPCS) {
    assert.ok(ok('actorSpec', n.specId), n.id);
    assert.ok(dlg(n.idleDialogue), n.id);
    if (n.shop) assert.ok(ok('shop', n.shop), n.id);
    if (n.home.settlement) assert.ok(ok('settlement', n.home.settlement), n.id);
  }
  for (const d of DIALOGUES) {
    for (const nid of Object.keys(d.nodes)) {
      const n = d.nodes[nid];
      actions(n.actions, d.id);
      for (const c of n.choices || []) actions(c.actions, d.id);
    }
  }
  for (const c of COURSES) assert.ok(ok('item', c.goldReward));
  for (const s of SCRIPTS.match(/say\('([a-z0-9_]+)'\)/g) || []) assert.ok(dlg(s.slice(5, -2)), 'scripted dialogue ' + s);
});

const SCRIPTS = readFileSync(fileURLToPath(new URL('../../src/rpg/scripts.js', import.meta.url)), 'utf8');

test('every string key used by rpg content exists in both languages', () => {
  const keys = new Set();
  for (const d of DIALOGUES) {
    for (const n of Object.values(d.nodes)) {
      keys.add(n.text);
      for (const c of n.choices || []) keys.add(c.text);
    }
  }
  for (const q of QUESTS) {
    keys.add('quest.' + q.id + '.title');
    for (const s of q.steps) keys.add('quest.' + q.id + '.' + s.id);
  }
  for (const n of NPCS) keys.add('npc.' + n.id + '.name');
  for (const it of ITEMS) keys.add('item.' + it.id + '.name');
  for (const o of OBJECTS) if (o.promptKey) keys.add(o.promptKey);
  const src = readFileSync(fileURLToPath(new URL('../../src/rpg/activities.js', import.meta.url)), 'utf8') + SCRIPTS +
    readFileSync(fileURLToPath(new URL('../../src/rpg/questService.js', import.meta.url)), 'utf8');
  for (const m of src.match(/'rpg\.[a-zA-Z.]+'/g) || []) if (!m.endsWith(".'")) keys.add(m.slice(1, -1));
  for (const m of ['bronze', 'silver', 'gold']) keys.add('rpg.race.medal.' + m);
  for (const k of keys) {
    assert.ok(has('he', k), 'he: ' + k);
    assert.ok(has('en', k), 'en: ' + k);
  }
  for (const lang of ['he', 'en']) {
    for (const k of Object.keys(RPG_STRINGS[lang])) assert.ok(k in RPG_STRINGS[lang === 'he' ? 'en' : 'he'], k);
    for (const k of Object.keys(DIALOGUE_STRINGS[lang])) assert.ok(k in DIALOGUE_STRINGS[lang === 'he' ? 'en' : 'he'], k);
  }
});

test('MQ1 and MQ2 lines match the GDD keys and speakers', () => {
  for (let i = 1; i <= 15; i++) assert.ok(('mq1.l' + String(i).padStart(2, '0')) in DIALOGUE_STRINGS.en);
  for (let i = 1; i <= 18; i++) assert.ok(('mq2.l' + String(i).padStart(2, '0')) in DIALOGUE_STRINGS.en);
  assert.equal(DIALOGUE_STRINGS.en['mq1.l01'], 'Again. Toward the post. Your feet are thinking too much.');
  assert.equal(DIALOGUE_STRINGS.he['mq2.l17'], 'צורת גחלת נפתחה. יש ללחוץ על כפתור הצורה.');
  const used = new Map();
  for (const d of DIALOGUES) for (const n of Object.values(d.nodes)) used.set(n.text, n.speaker);
  for (let i = 1; i <= 15; i++) assert.ok(used.has('mq1.l' + String(i).padStart(2, '0')), 'mq1 line used ' + i);
  for (let i = 1; i <= 18; i++) assert.ok(used.has('mq2.l' + String(i).padStart(2, '0')), 'mq2 line used ' + i);
  const speakers = { 'mq2.l01': 'dov', 'mq2.l02': 'mira', 'mq2.l03': 'villager', 'mq2.l04': 'choir_acolyte', 'mq2.l05': 'durn', 'mq2.l08': 'kerrin',
    'mq2.l15': 'kerrin', 'mq2.l17': 'system', 'mq1.l02': 'tavi', 'mq1.l01': 'sela' };
  for (const k of Object.keys(speakers)) assert.equal(used.get(k), speakers[k], k);
});

test('MQ2 matches the contract example; MQ7 needs four Siphons', () => {
  const mq2 = QUESTS.find((q) => q.id === 'mq2');
  assert.deepEqual(mq2.steps.map((s) => s.type), ['talk', 'talk', 'kill', 'defeat', 'talk', 'goto', 'destroy', 'talk']);
  assert.ok(mq2.rewards.some((a) => a.op === 'unlockForm' && a.form === 'ember'));
  assert.ok(mq2.rewards.some((a) => a.op === 'unlockTech' && a.tech === 'nova_ring' && a.slot === 0));
  assert.equal(mq2.rewards.filter((a) => a.op === 'startQuest').length, 4);
  assert.equal(QUESTS.find((q) => q.id === 'mq7').prereq.siphons, 4);
});
