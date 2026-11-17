import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDS, CREATURE_CLIPS, isId } from '../../src/core/ids.js';
import { FEEL } from '../../src/core/feel.js';
import { MOD_DEFAULTS } from '../../src/core/formulas.js';

const doc = (name) => readFileSync(new URL('../../docs/' + name, import.meta.url), 'utf8');
const GDD = doc('GDD.md');
const ART = doc('ART_UX.md');
const ARCH = doc('ARCHITECTURE.md');

/** Text of the section that starts with `heading` up to the next heading of any level. */
function section(md, heading) {
  const start = md.indexOf('\n' + heading);
  assert.ok(start >= 0, 'heading not found: ' + heading);
  const body = md.slice(start + heading.length + 1);
  const next = body.search(/\n#{1,4} /);
  return next < 0 ? body : body.slice(0, next);
}

/** Table rows of a section as arrays of trimmed cells (header and separator rows included as parsed). */
function rows(text) {
  return text.split('\n').filter((l) => l.startsWith('|') && !/^\|[\s|:-]+\|$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

/** Backtick tokens of a cell. */
function ticks(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** First-cell ids of the rows of a table, optionally keeping only rows whose last cell starts with a tag. */
function firstCellIds(text, tag) {
  const out = [];
  for (const r of rows(text)) {
    if (tag && !r[r.length - 1].startsWith(tag)) continue;
    out.push(...ticks(r[0]));
  }
  return out;
}

const sorted = (a) => [...a].sort();
const sameSet = (actual, expected, msg) => assert.deepEqual(sorted(new Set(actual)), sorted(new Set(expected)), msg);

test('no list has duplicates and every id is a non-empty string', () => {
  for (const [kind, list] of Object.entries(IDS)) {
    assert.equal(new Set(list).size, list.length, kind + ' has duplicates');
    for (const id of list) assert.ok(typeof id === 'string' && id.length > 0, kind);
  }
  assert.equal(isId('enemy', 'tusk_boar'), true);
  assert.equal(isId('enemy', 'nope'), false);
  assert.equal(isId('nokind', 'x'), false);
});

test('IDS is frozen', () => {
  assert.ok(Object.isFrozen(IDS));
  assert.ok(Object.isFrozen(IDS.enemy));
});

test('vfx equals the recipe ids of ART_UX 3.2 (P0 rows)', () => {
  const ids = [];
  for (const r of rows(section(ART, '### 3.2 Effects'))) {
    if (r[r.length - 1] !== 'P0') continue;
    let prev = '';
    for (const t of ticks(r[0])) {
      const id = t.startsWith('_') ? prev.replace(/_[^_]+$/, '') + t : t;
      ids.push(id);
      prev = id;
    }
  }
  sameSet(IDS.vfx, ids);
});

test('sfx equals the audio ids of ART_UX 9.2', () => {
  sameSet(IDS.sfx, firstCellIds(section(ART, '### 9.2 SFX recipes')));
});

test('feel equals the class ids of ART_UX section 4 and FEEL has one row per id', () => {
  const ids = firstCellIds(section(ART, '## 4. Game feel table'));
  sameSet(IDS.feel, ids);
  sameSet(Object.keys(FEEL), ids);
});

test('prop equals the prop kinds of ARCHITECTURE 4.2', () => {
  sameSet(IDS.prop, firstCellIds(section(ARCH, '### 4.2 `ctx.env` and `ctx.audio`')));
});

test('clip equals the standard clip ids of ARCHITECTURE 4.5', () => {
  const text = section(ARCH, '### 4.5 `ctx.actors`');
  const line = text.split('\n').find((l) => l.startsWith('**Standard clip ids**'));
  const head = line.slice(0, line.indexOf('plus boss-specific'));
  const ids = ticks(head.replace('`attack1`..`attack6`', '`attack1`, `attack2`, `attack3`, `attack4`, `attack5`, `attack6`'));
  sameSet(IDS.clip, ids);
  const starred = [...head.matchAll(/`([^`]+)`\*/g)].map((m) => m[1]);
  const creatureOnly = ticks(head.slice(head.indexOf('creature and boss clips')));
  sameSet(CREATURE_CLIPS, [...starred, ...creatureOnly]);
});

test('modKey equals the closed rpg.mods() key list of ARCHITECTURE 4.11, and MOD_DEFAULTS covers it', () => {
  const text = section(ARCH, '### 4.11 `ctx.rpg`');
  const from = text.indexOf('CLOSED key set');
  const open = text.indexOf('{', from);
  const close = text.indexOf('}', text.indexOf('siphonRegenMult', open));
  const keys = text.slice(open + 1, close).replace(/\/\*.*?\*\//g, '').replace(/\/\//g, '')
    .split(/[\s,]+/).filter(Boolean);
  sameSet(IDS.modKey, keys);
  sameSet(Object.keys(MOD_DEFAULTS), keys);
});

test('enemy, boss and technique lists equal the GDD roster, bosses and technique table', () => {
  const roster = section(GDD, '### 7.2 Roster');
  const enemies = [];
  const attacks = [];
  for (const r of rows(roster)) {
    if (r[r.length - 1] !== 'P0') continue;
    enemies.push(...ticks(r[0]));
    attacks.push(...ticks(r[9]));
  }
  const bosses = firstCellIds(section(GDD, '### 7.3 Bosses'), 'P0');
  sameSet(IDS.boss, bosses);
  sameSet(IDS.enemy, [...enemies, ...bosses]);
  const playerTechs = firstCellIds(section(GDD, '### 5.3 Technique table'), 'P0');
  sameSet(IDS.technique, [...playerTechs, ...attacks]);
});

test('form, item, shop, lootTable, npc, quest, region and landmark lists equal the GDD tables', () => {
  sameSet(IDS.form, firstCellIds(section(GDD, '### 5.5 Forms'), 'P0').filter((id) => id !== '-'));
  const consumables = section(GDD, '### 10.3 Consumables');
  const items = [...firstCellIds(section(GDD, '### 10.2 Equipment')), ...firstCellIds(consumables),
    ...ticks(consumables.split('\n').find((l) => l.startsWith('Quest item')))];
  sameSet(IDS.item, items);
  sameSet(IDS.shop, firstCellIds(section(GDD, '### 10.4 Shops')));
  sameSet(IDS.lootTable, firstCellIds(section(GDD, '### 10.5 Drop tables')));
  const npcs = rows(section(GDD, '## 11. NPCs')).filter((r) => !r[3].startsWith('Antagonists')).flatMap((r) => ticks(r[0]));
  sameSet(IDS.npc, npcs);
  sameSet(IDS.quest, [...firstCellIds(section(GDD, '### 8.2 Main story')), ...firstCellIds(section(GDD, '### 8.6 Side quests'), 'P0')]);
  sameSet(IDS.region, firstCellIds(section(GDD, '### 3.2 Regions')));
  sameSet(IDS.landmark, firstCellIds(section(GDD, '### 3.3 Landmarks'), 'P0'));
});

test('derived lists are consistent with their sources', () => {
  for (const s of IDS.settlement) assert.ok(isId('landmark', s), 'settlement ' + s + ' is a landmark');
  for (const s of IDS.spawnTable) assert.ok(isId('region', s));
  sameSet(IDS.spawnTable, IDS.region.filter((r) => r !== 'stormwell' && r !== 'spire'));
  for (const e of IDS.enemy) assert.ok(isId('actorSpec', e), 'enemy ' + e + ' has an actor spec');
  for (const n of IDS.npc) assert.ok(isId('actorSpec', 'npc_' + n), 'npc ' + n + ' has an actor spec');
  for (let i = 1; i <= 5; i++) {
    assert.ok(isId('landmark', 'siphon_' + i));
    assert.ok(isId('object', 'siphon_' + i));
    assert.ok(isId('object', 'tether_' + i));
  }
  const palettes = firstCellIds(section(ART, '### 9.3 Adaptive generative music'));
  sameSet(IDS.music, [...palettes, 'combat', 'boss']);
  for (const id of CREATURE_CLIPS) assert.ok(isId('clip', id));
});
