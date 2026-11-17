import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefs } from '../../src/core/defs.js';

/** A small, fully valid content set touching every cross-reference of ARCHITECTURE section 5. */
function fixture() {
  return {
    actorSpec: [
      { id: 'hero_a', forms: { ember: {}, tempest: {}, zenith: {} }, clips: { attack1: 'humanoid.attack1' } },
      { id: 'npc_dov' }, { id: 'tusk_boar' }, { id: 'durn' },
    ],
    clip: [{ id: 'humanoid.attack1' }],
    technique: [
      {
        id: 'strike_string', user: 'player', anim: { windup: 'attack1', active: 'attack1', recover: 'idle' },
        hits: [{ feel: 'lightHit' }], projectiles: [{ feel: 'boltHit', fxId: 'bolt' }], beam: { feel: 'beamTick' },
        chain: [{ anim: { active: 'attack2' }, hits: [{ feel: 'finisher' }] }],
        fx: { color: 'ora', windup: 'muzzle', hit: 'hit_light' }, sfx: { windup: 'whoosh', hit: 'hit_light' }, unlock: { quest: 'mq1' },
      },
      { id: 'boar_gore', user: 'enemy', anim: { active: 'bh_custom_clip' }, hits: [{ feel: 'hurtLight' }], fx: { color: 0x7b3cff } },
    ],
    techNode: [
      { id: 'n1', techId: 'strike_string', rank: 2, requires: { tech: 'strike_string' } },
      { id: 'n2', passive: { meleePct: 0.06 }, requires: { node: 'n1' } },
    ],
    form: [{ id: 'ember', formKey: 'ember', unlock: { quest: 'mq1' } }],
    enemy: [
      { id: 'tusk_boar', specId: 'tusk_boar', tier: 'grunt', brain: 'charger', techs: ['boar_gore'], lootTable: 'grunt', regions: ['meadows'] },
      { id: 'bramble_boar', specId: 'tusk_boar', tier: 'grunt', brain: 'charger', techs: [], lootTable: 'grunt', regions: [], variantOf: 'tusk_boar' },
      { id: 'durn', specId: 'durn', tier: 'boss', brain: 'boss', techs: ['boar_gore'], lootTable: 'boss', regions: [] },
    ],
    boss: [{
      id: 'durn', enemyId: 'durn', arena: { landmarkId: 'sparkstead' },
      phases: [{ hpBelow: 1, techs: [{ id: 'boar_gore', weight: 1 }], onEnter: [{ op: 'banner', kind: 'boss', key: 'x' }] }],
    }],
    group: [{ id: 'g1', members: [{ enemy: 'tusk_boar', count: 2 }] }],
    spawnTable: [{ id: 'meadows', entries: [{ enemy: 'tusk_boar', weight: 1, group: [1, 2] }], camps: [{ tier: 1, group: 'g1' }] }],
    item: [{ id: 'sunfruit' }, { id: 'copper_knuckles', mods: { poisePct: 0.1 } }],
    shop: [{ id: 'dov_stall', stock: ['sunfruit'] }],
    lootTable: [{ id: 'grunt' }, { id: 'boss' }],
    quest: [{
      id: 'mq1', giver: 'dov', prereq: { quests: [] },
      steps: [{
        id: 's1', npc: 'dov', dialogue: 'd1', landmark: 'sparkstead', enemy: 'tusk_boar', region: 'meadows', boss: 'durn',
        item: 'sunfruit', objects: ['post'], object: 'post', tech: 'strike_string', course: 'run',
        marker: { npc: 'dov' }, onStart: [{ op: 'giveItem', item: 'sunfruit' }], onComplete: [{ op: 'startQuest', quest: 'mq1' }],
      }, { id: 's2', type: 'goto', marker: { landmark: 'sparkstead' } }, { id: 's3', type: 'destroy', marker: { object: 'post' } }],
      rewards: [
        { op: 'unlockTech', tech: 'strike_string' }, { op: 'unlockForm', form: 'ember' }, { op: 'spawnGroup', group: 'g1', x: 0, z: 0 },
        { op: 'startBoss', boss: 'durn' }, { op: 'teleport', x: 0, z: 0, landmark: 'sparkstead' },
        { op: 'moveNpc', npc: 'dov', settlement: 'sparkstead', spot: 'a' }, { op: 'giveXp', amount: 10 },
      ],
    }],
    npc: [{ id: 'dov', specId: 'npc_dov', shop: 'dov_stall', idleDialogue: 'd1', home: { settlement: 'sparkstead', spot: 'stall' } }],
    dialogue: [{
      id: 'd1', start: 'n1',
      nodes: {
        n1: { speaker: 'dov', text: 'a', next: 'n2' },
        n2: { speaker: 'durn', text: 'b', next: 'n3', actions: [{ op: 'heal' }] },
        n3: { speaker: 'tavi', text: 'c', choices: [{ text: 'd', next: null, actions: [{ op: 'giveShells', amount: 5 }], if: { quest: 'mq1' } }] },
      },
    }],
    object: [{ id: 'post', prop: 'trainingPost', quest: 'mq1' }],
    course: [{ id: 'run', goldReward: 'sunfruit' }],
    region: [{ id: 'meadows', chestTable: 'grunt', musicKey: 'warm' }],
    landmark: [{ id: 'sparkstead' }],
    settlement: [{ id: 'sparkstead' }],
  };
}

/** Register a fixture, after applying `mutate` to it. */
function build(mutate) {
  const f = fixture();
  if (mutate) mutate(f);
  const defs = createDefs({ strict: true });
  for (const [kind, list] of Object.entries(f)) defs.register(kind, list);
  return defs;
}

const one = (f, kind, id) => f[kind].find((d) => d.id === id);

test('register, get, find, all, has, kinds', () => {
  const defs = createDefs();
  defs.register('item', [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
  assert.equal(defs.get('item', 'a').v, 1);
  assert.equal(defs.find('item', 'zzz'), null);
  assert.equal(defs.find('nokind', 'a'), null);
  assert.deepEqual(defs.all('item').map((d) => d.id), ['a', 'b']);
  assert.deepEqual(defs.all('nokind'), []);
  assert.equal(defs.has('item', 'b'), true);
  assert.deepEqual(defs.kinds(), ['item']);
  assert.throws(() => defs.get('item', 'zzz'), /missing item:zzz/);
  assert.throws(() => defs.register('item', [{ v: 1 }]), /string id/);
  assert.throws(() => defs.register('item', { id: 'x' }), /array/);
});

test('re-registering an id replaces it and keeps its position', () => {
  const defs = createDefs();
  defs.register('enemy', [{ id: 'tusk_boar', standin: true }, { id: 'ember_wisp', standin: true }]);
  defs.register('enemy', [{ id: 'tusk_boar', standin: false, poise: 20 }, { id: 'choir_acolyte' }]);
  assert.equal(defs.get('enemy', 'tusk_boar').standin, false);
  assert.equal(defs.get('enemy', 'tusk_boar').poise, 20);
  assert.deepEqual(defs.all('enemy').map((d) => d.id), ['tusk_boar', 'ember_wisp', 'choir_acolyte']);
});

test('definitions are deeply frozen', () => {
  const defs = createDefs();
  defs.register('item', [{ id: 'a', stats: { mgt: 2 } }]);
  assert.ok(Object.isFrozen(defs.get('item', 'a')));
  assert.ok(Object.isFrozen(defs.get('item', 'a').stats));
});

test('non-strict get logs once and returns null', () => {
  const warnings = [];
  const defs = createDefs({ strict: false, log: { warn: (...a) => warnings.push(a) } });
  assert.equal(defs.get('item', 'nope'), null);
  assert.equal(defs.get('item', 'nope'), null);
  assert.equal(warnings.length, 1);
});

test('the valid fixture validates', () => {
  const res = build().validate();
  assert.deepEqual(res, { ok: true, errors: [] });
});

/** [label, mutate, expected fragment of the error] : one dangling id per cross-reference kind. */
const BROKEN = [
  ['technique anim (player) -> clip id', (f) => { one(f, 'technique', 'strike_string').anim.active = 'moonwalk'; }, 'technique:strike_string anim.active'],
  ['technique chain anim -> clip id', (f) => { one(f, 'technique', 'strike_string').chain[0].anim.active = 'spin9'; }, 'chain[0].anim.active'],
  ['technique hit feel -> feel id', (f) => { one(f, 'technique', 'strike_string').hits[0].feel = 'mega'; }, 'hits[0].feel'],
  ['technique chain hit feel -> feel id', (f) => { one(f, 'technique', 'strike_string').chain[0].hits[0].feel = 'x'; }, 'chain[0].hits[0].feel'],
  ['technique projectile fxId -> vfx id', (f) => { one(f, 'technique', 'strike_string').projectiles[0].fxId = 'laser'; }, 'projectiles[0].fxId'],
  ['technique projectile feel -> feel id', (f) => { one(f, 'technique', 'strike_string').projectiles[0].feel = 'x'; }, 'projectiles[0].feel'],
  ['technique beam feel -> feel id', (f) => { one(f, 'technique', 'strike_string').beam.feel = 'x'; }, 'beam.feel'],
  ['technique fx -> vfx id', (f) => { one(f, 'technique', 'strike_string').fx.hit = 'sparkle'; }, 'fx.hit'],
  ['technique sfx -> sfx id', (f) => { one(f, 'technique', 'strike_string').sfx.hit = 'boing'; }, 'sfx.hit'],
  ['technique unlock.quest -> quest', (f) => { one(f, 'technique', 'strike_string').unlock.quest = 'mq99'; }, 'unlock.quest'],
  ['techNode techId -> technique', (f) => { one(f, 'techNode', 'n1').techId = 'nope'; }, 'techNode:n1 techId'],
  ['techNode requires.tech -> technique', (f) => { one(f, 'techNode', 'n1').requires.tech = 'nope'; }, 'requires.tech'],
  ['techNode requires.node -> techNode', (f) => { one(f, 'techNode', 'n2').requires.node = 'n9'; }, 'requires.node'],
  ['techNode passive key -> modKey', (f) => { one(f, 'techNode', 'n2').passive = { meleePercent: 0.1 }; }, 'unknown modifier key "meleePercent"'],
  ['form unlock.quest -> quest', (f) => { one(f, 'form', 'ember').unlock.quest = 'mq99'; }, 'form:ember unlock.quest'],
  ['form formKey -> hero forms block', (f) => { one(f, 'form', 'ember').formKey = 'eclipse'; }, 'form:ember formKey'],
  ['enemy specId -> actorSpec', (f) => { one(f, 'enemy', 'tusk_boar').specId = 'pig'; }, 'enemy:tusk_boar specId'],
  ['enemy techs -> technique', (f) => { one(f, 'enemy', 'tusk_boar').techs.push('boar_fly'); }, 'enemy:tusk_boar techs[1]'],
  ['enemy lootTable -> lootTable', (f) => { one(f, 'enemy', 'tusk_boar').lootTable = 'gold'; }, 'enemy:tusk_boar lootTable'],
  ['enemy regions -> region', (f) => { one(f, 'enemy', 'tusk_boar').regions = ['moon']; }, 'enemy:tusk_boar regions[0]'],
  ['enemy variantOf -> enemy', (f) => { one(f, 'enemy', 'bramble_boar').variantOf = 'wild_boar'; }, 'variantOf'],
  ['boss enemyId -> enemy', (f) => { one(f, 'boss', 'durn').enemyId = 'nobody'; }, 'boss:durn enemyId'],
  ['boss enemy must be tier/brain boss', (f) => { one(f, 'enemy', 'durn').brain = 'melee'; }, 'must have tier and brain "boss"'],
  ['boss arena.landmarkId -> landmark', (f) => { one(f, 'boss', 'durn').arena.landmarkId = 'nowhere'; }, 'arena.landmarkId'],
  ['boss phase techs -> technique', (f) => { one(f, 'boss', 'durn').phases[0].techs[0].id = 'durn_unknown'; }, 'phases[0].techs[0]'],
  ['boss phase onEnter -> action op', (f) => { one(f, 'boss', 'durn').phases[0].onEnter = [{ op: 'explode' }]; }, 'phases[0].onEnter[0]'],
  ['group member enemy -> enemy', (f) => { one(f, 'group', 'g1').members[0].enemy = 'ghost'; }, 'group:g1 members[0].enemy'],
  ['spawnTable id -> region', (f) => { f.spawnTable[0].id = 'atlantis'; }, 'spawnTable:atlantis id'],
  ['spawnTable entry enemy -> enemy', (f) => { f.spawnTable[0].entries[0].enemy = 'ghost'; }, 'entries[0].enemy'],
  ['spawnTable camp group -> group', (f) => { f.spawnTable[0].camps[0].group = 'g9'; }, 'camps[0].group'],
  ['item mods key -> modKey', (f) => { one(f, 'item', 'copper_knuckles').mods = { strength: 2 }; }, 'item:copper_knuckles mods'],
  ['shop stock -> item', (f) => { one(f, 'shop', 'dov_stall').stock.push('cake'); }, 'shop:dov_stall stock[1]'],
  ['quest giver -> npc', (f) => { one(f, 'quest', 'mq1').giver = 'stranger'; }, 'quest:mq1 giver'],
  ['quest prereq.quests -> quest', (f) => { one(f, 'quest', 'mq1').prereq.quests = ['mq0']; }, 'prereq.quests[0]'],
  ['quest step npc -> npc', (f) => { one(f, 'quest', 'mq1').steps[0].npc = 'x'; }, 'steps[0].npc'],
  ['quest step dialogue -> dialogue', (f) => { one(f, 'quest', 'mq1').steps[0].dialogue = 'x'; }, 'steps[0].dialogue'],
  ['quest step landmark -> landmark', (f) => { one(f, 'quest', 'mq1').steps[0].landmark = 'x'; }, 'steps[0].landmark'],
  ['quest step enemy -> enemy', (f) => { one(f, 'quest', 'mq1').steps[0].enemy = 'x'; }, 'steps[0].enemy'],
  ['quest step region -> region', (f) => { one(f, 'quest', 'mq1').steps[0].region = 'x'; }, 'steps[0].region'],
  ['quest step boss -> boss', (f) => { one(f, 'quest', 'mq1').steps[0].boss = 'x'; }, 'steps[0].boss'],
  ['quest step item -> item', (f) => { one(f, 'quest', 'mq1').steps[0].item = 'x'; }, 'steps[0].item'],
  ['quest step objects -> object', (f) => { one(f, 'quest', 'mq1').steps[0].objects = ['post', 'x']; }, 'steps[0].objects[1]'],
  ['quest step object -> object', (f) => { one(f, 'quest', 'mq1').steps[0].object = 'x'; }, 'steps[0].object'],
  ['quest step tech -> technique', (f) => { one(f, 'quest', 'mq1').steps[0].tech = 'x'; }, 'steps[0].tech'],
  ['quest step course -> course', (f) => { one(f, 'quest', 'mq1').steps[0].course = 'x'; }, 'steps[0].course'],
  ['quest marker npc -> npc', (f) => { one(f, 'quest', 'mq1').steps[0].marker = { npc: 'x' }; }, 'steps[0].marker.npc'],
  ['quest marker landmark -> landmark', (f) => { one(f, 'quest', 'mq1').steps[1].marker = { landmark: 'x' }; }, 'steps[1].marker.landmark'],
  ['quest marker object -> object', (f) => { one(f, 'quest', 'mq1').steps[2].marker = { object: 'x' }; }, 'steps[2].marker.object'],
  ['action giveItem -> item', (f) => { one(f, 'quest', 'mq1').steps[0].onStart[0].item = 'x'; }, 'steps[0].onStart[0].item'],
  ['action startQuest -> quest', (f) => { one(f, 'quest', 'mq1').steps[0].onComplete[0].quest = 'x'; }, 'steps[0].onComplete[0].quest'],
  ['action unlockTech -> technique', (f) => { one(f, 'quest', 'mq1').rewards[0].tech = 'x'; }, 'rewards[0].tech'],
  ['action unlockForm -> form', (f) => { one(f, 'quest', 'mq1').rewards[1].form = 'x'; }, 'rewards[1].form'],
  ['action spawnGroup -> group', (f) => { one(f, 'quest', 'mq1').rewards[2].group = 'x'; }, 'rewards[2].group'],
  ['action startBoss -> boss', (f) => { one(f, 'quest', 'mq1').rewards[3].boss = 'x'; }, 'rewards[3].boss'],
  ['action teleport landmark -> landmark', (f) => { one(f, 'quest', 'mq1').rewards[4].landmark = 'x'; }, 'rewards[4].landmark'],
  ['action moveNpc npc -> npc', (f) => { one(f, 'quest', 'mq1').rewards[5].npc = 'x'; }, 'rewards[5].npc'],
  ['action moveNpc settlement -> settlement', (f) => { one(f, 'quest', 'mq1').rewards[5].settlement = 'x'; }, 'rewards[5].settlement'],
  ['action op -> known op', (f) => { one(f, 'quest', 'mq1').rewards.push({ op: 'win' }); }, 'unknown action op "win"'],
  ['npc specId -> actorSpec', (f) => { one(f, 'npc', 'dov').specId = 'x'; }, 'npc:dov specId'],
  ['npc shop -> shop', (f) => { one(f, 'npc', 'dov').shop = 'x'; }, 'npc:dov shop'],
  ['npc idleDialogue -> dialogue', (f) => { one(f, 'npc', 'dov').idleDialogue = 'x'; }, 'npc:dov idleDialogue'],
  ['npc home.settlement -> settlement', (f) => { one(f, 'npc', 'dov').home.settlement = 'x'; }, 'home.settlement'],
  ['dialogue start -> node', (f) => { one(f, 'dialogue', 'd1').start = 'n0'; }, 'dialogue:d1 start'],
  ['dialogue next -> node', (f) => { one(f, 'dialogue', 'd1').nodes.n1.next = 'n7'; }, 'nodes.n1.next'],
  ['dialogue choice next -> node', (f) => { one(f, 'dialogue', 'd1').nodes.n3.choices[0].next = 'n7'; }, 'nodes.n3.choices[0].next'],
  ['dialogue speaker -> npc/boss/enemy', (f) => { one(f, 'dialogue', 'd1').nodes.n1.speaker = 'ghost'; }, 'nodes.n1.speaker'],
  ['dialogue node actions -> action refs', (f) => { one(f, 'dialogue', 'd1').nodes.n2.actions = [{ op: 'giveItem', item: 'x' }]; }, 'nodes.n2.actions[0].item'],
  ['dialogue choice actions -> action refs', (f) => { one(f, 'dialogue', 'd1').nodes.n3.choices[0].actions = [{ op: 'startBoss', boss: 'x' }]; }, 'choices[0].actions[0].boss'],
  ['dialogue choice if.quest -> quest', (f) => { one(f, 'dialogue', 'd1').nodes.n3.choices[0].if.quest = 'x'; }, 'choices[0].if.quest'],
  ['object prop -> prop kind', (f) => { one(f, 'object', 'post').prop = 'statue'; }, 'object:post prop'],
  ['object quest -> quest', (f) => { one(f, 'object', 'post').quest = 'x'; }, 'object:post quest'],
  ['course goldReward -> item', (f) => { one(f, 'course', 'run').goldReward = 'x'; }, 'course:run goldReward'],
  ['region chestTable -> lootTable', (f) => { one(f, 'region', 'meadows').chestTable = 'x'; }, 'region:meadows chestTable'],
  ['region musicKey -> music', (f) => { one(f, 'region', 'meadows').musicKey = 'jazz'; }, 'region:meadows musicKey'],
  ['actorSpec clips -> clip', (f) => { one(f, 'actorSpec', 'hero_a').clips.attack1 = 'humanoid.x'; }, 'actorSpec:hero_a clips.attack1'],
  ['settlement id -> landmark', (f) => { f.settlement.push({ id: 'atlantis' }); }, 'settlement:atlantis id'],
];

for (const [label, mutate, fragment] of BROKEN) {
  test('validate catches a dangling reference: ' + label, () => {
    const defs = build(mutate);
    const res = defs.validate({ throwOnError: false });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes(fragment)), 'expected "' + fragment + '" in ' + JSON.stringify(res.errors));
    assert.throws(() => defs.validate(), /defs\.validate/, 'strict validate throws');
  });
}

test('enemy technique anim may use boss-specific clip ids', () => {
  const defs = build((f) => { one(f, 'technique', 'boar_gore').anim.active = 'gm_roll_curl'; });
  assert.equal(defs.validate().ok, true);
});
