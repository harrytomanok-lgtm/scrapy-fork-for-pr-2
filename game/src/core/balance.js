/**
 * BALANCE: every tunable number of the GDD in one place (ARCHITECTURE 4.17).
 * Technique data, enemy data and items read their numbers from here; no number is typed twice.
 * Any object named `mods` in this table uses only keys of IDS.modKey (asserted by tests/core/balance.test.mjs).
 * Pure data module.
 * @module core/balance
 */

/** @param {object} o @returns {object} */
function deepFreeze(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(o);
}

export const BALANCE = deepFreeze({
  /** GDD 4.1 levels and XP. xpToNext(L) = round(a * L^pow + b * L) */
  level: {
    cap: 40,
    curve: { a: 60, pow: 1.5, b: 40 },
    statPointsPerLevel: 3,
    tpPerLevel: 1,
    startStat: 5,
  },

  /** GDD 4.1 enemy XP: round(base * Le^pow * xpMult) x the level-difference factor. */
  xp: {
    enemy: { base: 12, pow: 1.3 },
    /** Applied in order; the first matching rule wins. `below` = player level - enemy level. */
    levelDiff: [
      { minBelow: 8, mult: 0.25 },
      { minBelow: 5, mult: 0.5 },
      { maxBelow: -4, mult: 1.5 },
    ],
    bossXpMult: 6,
    /** Bonus XP as a share of the player's current xpToNext. */
    bonus: { siphon: 0.15, camp: 0.10, campRefill: 0.03 },
    /** GDD 9 discovery XP. */
    discovery: { landmark: 30, poi: 10 },
  },

  /** GDD 4.2 allocation styles. Each list is the repeating order of points. */
  styles: {
    brawler: ['mgt', 'mgt', 'vit'],
    blaster: ['spr', 'spr', 'swf'],
    balanced: ['mgt', 'spr', 'vit', 'swf'],
  },

  /** GDD 4.3 derived values. */
  derived: {
    hp: { base: 100, perVit: 18, perLevel: 6 },
    ora: { base: 100, perSpr: 5 },
    oraRegen: { base: 3, perSpr: 0.05, inCombatMult: 0.5, siphonZoneMult: 0.5 },
    gather: { base: 35, perSpr: 1.0 },
    rating: { base: 20, perStat: 4, perLevel: 3 },
    defense: { perVit: 2, perLevel: 1 },
    crit: { base: 0.05, perSwf: 0.003, cap: 0.35, mult: 1.5 },
    run: { base: 9, perSwf: 0.04, cap: 12, sprintMult: 1.6 },
    fly: { base: 30, perSwf: 0.2, cap: 42 },
    boost: { base: 75, perSwf: 0.8, cap: 120, sonicMult: 1.5 },
    cdr: { perSwf: 0.004, cap: 0.30 },
    /** The player is never staggered by poise (GDD 6.4): poise 0 and combat ignores it for the player. */
    playerPoise: 0,
  },

  /** GDD 4.4 Resonance. */
  resonance: {
    base: 40,
    perLevel: 0.1,
    awakenMult: 0.2,
    gather: { max: 1.15, rampSeconds: 1 },
    form: { base: 1, ember: 1.5, tempest: 2.5, zenith: 6 },
    enemy: { base: 20, perLevel: 3 },
    tierMult: { grunt: 1, heavy: 1.5, elite: 2, boss: 4 },
    /** Lock-on tint thresholds as enemy / player ratios. */
    tint: { grey: 0.5, amber: 1.3, danger: 2.0 },
    milestones: [1000, 5000, 10000, 25000, 50000, 100000],
  },

  /** GDD 4.5 Technique Points: 1 per level (39), 1 per shrine (10), main quest rewards (6, in `quests`). */
  tp: { shrines: 10, shrineTp: 1, total: 55 },

  /**
   * GDD 8.2 and 8.6 quest rewards. `stepXp` is XP granted by a step (MQ1 step 7); `xp` is the reward on completion.
   */
  quests: {
    mq1: { xp: 40, stepXp: 60, shells: 0, tp: 0 },
    mq2: { xp: 300, shells: 150, tp: 1 },
    mq3: { xp: 900, shells: 400, tp: 1 },
    mq4: { xp: 600, shells: 300, tp: 1 },
    mq5: { xp: 1500, shells: 700, tp: 2 },
    mq6: { xp: 2200, shells: 1000, tp: 1 },
    mq7: { xp: 5000, shells: 2000, tp: 0 },
    sq1: { xp: 150, shells: 120, tp: 0 },
    sq2: { xp: 200, shells: 0, tp: 0 },
    sq3: { xp: 200, shells: 0, tp: 0 },
    sq4: { xp: 800, shells: 500, tp: 0 },
  },

  /** GDD 5.2 damage rule. */
  damage: { min: 1, defenseK: 100, roll: [0.95, 1.05] },

  /**
   * GDD 5.3 and 5.4 player techniques. Powers are multipliers of the rating; cooldowns in seconds before
   * Swiftness reduction; costs in Ora. `ranks[i]` is rank i + 1 with its TP price and effect.
   * Knock speeds in m/s.
   */
  tech: {
    strike_string: {
      slot: 'core', ora: 0, cooldown: 0, hitSeconds: 0.28,
      hits: [
        { power: 0.30, poise: 4 }, { power: 0.30, poise: 4 }, { power: 0.35, poise: 5 }, { power: 0.40, poise: 6 },
        { power: 0.60, poise: 10, knock: { kind: 'push', speed: 10 } },
      ],
      cancelFromHit: 2,
      lunge: { dist: 10, speed: 30 },
      juggle: { gravityScale: 0.3, maxSeconds: 4 },
      ranks: [
        { tp: 0 },
        { tp: 2, extraHit: { power: 0.80, poise: 10, knock: { kind: 'push', speed: 10 } } },
        { tp: 3, powerMult: 1.2 },
      ],
    },
    breaker: {
      slot: 'core', ora: 0, cooldown: 0.8, holdSeconds: 0.35, power: 1.2, poise: 30,
      charge: { min: 0, max: 1.0, maxMult: 2.0 },
      launch: { minHeight: 8, maxHeight: 12, up: 14 },
      smash: { afterHits: 3, speed: 30 },
      ranks: [{ tp: 0 }, { tp: 2, guardBreak: true, poiseMult: 1.5 }],
    },
    meteor_heel: {
      slot: 'core', ora: 8, cooldown: 3, power: 1.6, poise: 30, knock: { kind: 'spike', speed: 35 },
      crater: { radius: 6 }, unlockLevel: 4,
      ranks: [{ tp: 0 }, { tp: 2, powerMult: 1.25, craterRadius: 9 }],
    },
    pursuit: { slot: 'core', ora: 8, cooldown: 0, window: 1.0, nextHitBonus: 0.3, ranks: [{ tp: 0 }] },
    ora_bolt: {
      slot: 'core', ora: 6, cooldown: 0.2, power: 0.22, poise: 2,
      falloff: { fullRange: 30, endRange: 90, endMult: 0.5 },
      ranks: [{ tp: 0 }, { tp: 2, count: 2, powerMult: 0.6 }, { tp: 3, pierce: 1 }],
    },
    flare_barrage: {
      slot: 'slot', oraPerBolt: 3, cooldown: 5, power: 0.20, poise: 1, boltsPerSec: 10, seconds: 2.5, unlockLevel: 3,
      ranks: [{ tp: 1 }, { tp: 2, finalBolt: { power: 1.5, knock: { kind: 'push', speed: 10 } } }],
    },
    dawn_lance: {
      slot: 'slot', ora: 30, cooldown: 8,
      charge: { min: 0.5, max: 2.0, maxMult: 2.5, oraPerSec: 15 },
      beam: { range: 60, seconds: 1.6, tick: 0.1, power: 0.16, poise: 6, radius: 1.2, knock: { kind: 'push', speed: 8 } },
      unlockQuest: 'mq4',
      ranks: [{ tp: 0 }, { tp: 2, beamRadius: 1.8 }, { tp: 3, powerMult: 1.3 }],
    },
    nova_ring: {
      slot: 'slot', ora: 30, cooldown: 10, power: 1.8, radius: 10, poise: 25, knock: { kind: 'radial', speed: 18 },
      unlockQuest: 'mq2',
      ranks: [{ tp: 0 }, { tp: 2, radius: 14 }, { tp: 3, burn: { power: 0.3, every: 0.5, seconds: 3 } }],
    },
    ringfall: {
      slot: 'ultimate', ora: 0, surge: 100, cooldown: 0,
      powerCentre: 16.0, powerEdge: 8.0, radius: 22, poise: 100, knock: { kind: 'radial', speed: 18 },
      crater: { radius: 20, depth: 5 }, unlockQuest: 'mq3',
      ranks: [{ tp: 0 }, { tp: 3, powerMult: 1.3 }],
    },
    guard: {
      slot: 'core', oraPerBlock: 3, arcDeg: 120, blockedMult: 0.2, breakStagger: 1,
      perfect: { window: 0.15, attackerStagger: 0.8, surge: 8 },
      ranks: [{ tp: 0 }],
    },
    flicker_step: {
      slot: 'core', ora: 8, cooldown: 0.5, dist: 7, invulnerable: 0.3,
      perfect: { window: 0.2, slowScale: 0.4, slowSeconds: 0.5, surge: 8 },
      ranks: [{ tp: 0 }, { tp: 2, ora: 4 }],
    },
    boost: {
      slot: 'core', oraPerSec: 6, sonicOraPerSec: 10, sonicAfter: 2, holdThreshold: 0.2, latchWindow: 0.3, reenableOra: 10,
      ranks: [{ tp: 0 }],
    },
    gather: {
      slot: 'core', moveCap: 2, rampSeconds: 1, interruptLockout: 0.5, unlockQuest: 'mq1',
      ranks: [{ tp: 0 }, { tp: 2, mods: { gatherDmgTakenMult: 0.75 } }],
    },
  },

  /** GDD 5.3 passives bought with TP. Each entry of `ranks` is one purchasable node. */
  passives: {
    iron_fists: { branch: 'fist', ranks: [{ tp: 1, mods: { meleePct: 0.06 } }, { tp: 2, mods: { meleePct: 0.06 } }, { tp: 3, mods: { meleePct: 0.06 } }] },
    bright_core: { branch: 'flare', ranks: [{ tp: 1, mods: { oraPct: 0.06 } }, { tp: 2, mods: { oraPct: 0.06 } }, { tp: 3, mods: { oraPct: 0.06 } }] },
    deep_well: { branch: 'spirit', ranks: [{ tp: 2, mods: { oraPoolPct: 0.10 } }, { tp: 3, mods: { oraPoolPct: 0.10 } }] },
    second_breath: { branch: 'spirit', ranks: [{ tp: 4, mods: { secondBreath: 1 } }], cooldown: 300, hpLeft: 1, invulnerable: 2 },
  },

  /** GDD 5.5 Forms. mult.dmg / def / speed / res are applied by formulas only; surge reaches combat as mods.surgePct. */
  forms: {
    ember: { order: 1, cost: 40, drain: 3, hpDrainPct: 0, mult: { dmg: 1.25, def: 1.10, speed: 1.10, res: 1.5, surge: 1 }, mods: { flickerCostMult: 1 }, unlockQuest: 'mq2' },
    tempest: { order: 2, cost: 70, drain: 5, hpDrainPct: 0, mult: { dmg: 1.60, def: 1.20, speed: 1.25, res: 2.5, surge: 1 }, mods: { flickerCostMult: 0.5 }, unlockQuest: 'mq6' },
    zenith: { order: 3, cost: 150, drain: 10, hpDrainPct: 0, mult: { dmg: 2.2, def: 1.40, speed: 1.35, res: 6, surge: 1 }, mods: { flickerCostMult: 1 }, scripted: true, freeUseLevel: 36 },
  },
  formRules: {
    transformSeconds: 1.2, shortSeconds: 0.5, shockRadius: 8,
    endBelowHpPct: 0.10,
    burnout: { noRegenSeconds: 5, lockoutSeconds: 12 },
  },

  /** GDD 5.6 Surge. */
  surge: {
    max: 100, meleeHit: 1.5, oraHit: 0.5, perfect: 8, wallSlam: 4,
    hpLoss: { perPct: 0.05, gain: 2 },
    decay: { perSec: 2, afterSeconds: 12 },
  },

  /** GDD 6 combat rules. */
  combat: {
    softLock: { coneDeg: 60, meleeRange: 25, oraRange: 90 },
    hardLock: { breakRange: 150, losSeconds: 2 },
    inCombatSeconds: 6,
    knock: { push: [4, 10], launchUp: 14, smash: 30, spike: 35, radial: 18 },
    hurtle: { minSpeed: 18, stopSpeed: 6 },
    slam: { minSpeed: 14, damageFraction: 0.3, surge: 4, hitStopMs: 70 },
    crater: { deformRadius: 6, maxDepthFraction: 0.3, lipFraction: 0.08 },
    poise: { refillSeconds: 3, breakStagger: 2, bossBreakStagger: 3, brokenDamageMult: 1.25 },
    telegraph: { windup: [0.5, 1.2], bossWindup: [0.8, 2.0] },
    tokens: { melee: 2, ranged: 2 },
    activeCap: { low: 12, high: 24 },
    hover: { height: 12, seconds: 6 },
    flyerBand: [10, 30],
  },

  /** GDD 6.8 death and respawn. */
  death: { slowSeconds: 1.5, respawnInvulnerable: 3, masterShellLoss: 0.10 },

  /** GDD 6.9 difficulty table. */
  difficulty: {
    story: { enemyDmg: 0.5, enemyHp: 0.75, telegraph: 1.3, perfectWindow: 1.5, attackers: 2, reward: 1.0, shellLoss: 0 },
    warrior: { enemyDmg: 1.0, enemyHp: 1.0, telegraph: 1.0, perfectWindow: 1.0, attackers: 4, reward: 1.0, shellLoss: 0 },
    master: { enemyDmg: 1.4, enemyHp: 1.25, telegraph: 0.85, perfectWindow: 1.0, attackers: 6, reward: 1.2, shellLoss: 0.10 },
  },

  /**
   * GDD 7.1 enemy scaling. HP = round(hpMult * (base + perLevel*Le + quad*Le^2) * difficultyHp).
   * Balance pass (tools/balance-sim.mjs): HP base 40 -> 75 and quad 0.35 -> 0.25 so a same-level grunt takes 1-2
   * Strike Strings from L1 to L30 (the GDD curve gave 0.6 strings at L1-L3 and 2.1 at L30); ATK 8 + 4 Le ->
   * 9 + 3.5 Le so a full-HP player survives 11-17 grunt hits (10-11 before, the low edge of 9-18 once fights got
   * longer); Shells 3 + 1.2 Le -> 3 + 1.0 Le for about 600 per hour from kills at L10 (GDD 10.1).
   */
  enemyScale: {
    hp: { base: 75, perLevel: 12, quad: 0.25 },
    atk: { base: 9, perLevel: 3.5 },
    def: { perLevel: 2 },
    shells: { base: 3, perLevel: 1.0 },
    /** Locomotion defaults for enemies (not in the GDD): ground run speed and flight cruise in m/s. */
    move: { run: 7, fly: 16 },
    /** Mean power of the P0 grunt attacks of GDD 7.2 (about 0.98), used for the hits-to-die target. */
    referenceHitPower: 1.0,
    /** GDD 7.1 targets (Warrior, same level, typical allocation, no gear). */
    targets: { stringsToKillGrunt: [1, 2], gruntHitsSurvived: [9, 18] },
  },

  /**
   * GDD 7.2 roster. levels [min, max]; mult = hp / atk / def / xp / shells.
   * Fight pacing pass (tools/balance-sim.mjs stageGruntStrings): with the route's gear and Technique Points three
   * early enemies fell in 2.7 s. hp and atk multipliers changed (GDD 7.2 values in brackets): wisp 2.8 / 0.45
   * (0.5 / 0.6), bramble boar 4.2 / 0.8 (1.2 / 1.1), acolyte 3.9 / 0.75 (1 / 1), caster 3.4 / 0.75 (0.8 / 1), crab
   * 3.2 / 0.7 (1.6 / 0.9), golem 4.5 / 1.1 (3 / 1.5), harrier 3.6 / 0.95 (0.9 / 1.3), vanguard 4 / 1.1 (2.5 / 1.5), so a
   * grunt takes about 2-3 Strike Strings and a group of 3-4 lasts about 8-15 s on Warrior; ATK is lower so the longer
   * fights cost about the HP they did. tusk_boar keeps the GDD values (tests/core/formulas.test.mjs pins them).
   */
  enemies: {
    ember_wisp: { tier: 'grunt', movement: 'fly', brain: 'ranged', levels: [1, 10], mult: { hp: 2.8, atk: 0.45, def: 0.5, xp: 0.5, shells: 0.5 }, poise: 0 },
    tusk_boar: { tier: 'grunt', movement: 'ground', brain: 'charger', levels: [1, 8], mult: { hp: 1.0, atk: 1.0, def: 1.0, xp: 1.0, shells: 1.0 }, poise: 20 },
    bramble_boar: { tier: 'grunt', movement: 'ground', brain: 'charger', levels: [8, 14], mult: { hp: 4.2, atk: 0.8, def: 1.0, xp: 1.1, shells: 1.0 }, poise: 25, variantOf: 'tusk_boar' },
    choir_acolyte: { tier: 'grunt', movement: 'ground', brain: 'melee', levels: [2, 28], mult: { hp: 3.9, atk: 0.75, def: 1.0, xp: 1.0, shells: 1.2 }, poise: 25, guardChance: 0.3 },
    choir_caster: { tier: 'grunt', movement: 'hover', brain: 'ranged', levels: [4, 28], mult: { hp: 3.4, atk: 0.75, def: 0.8, xp: 1.1, shells: 1.2 }, poise: 15, keepRange: 25 },
    scuttlecrab: { tier: 'grunt', movement: 'ground', brain: 'melee', levels: [5, 12], mult: { hp: 3.2, atk: 0.7, def: 1.6, xp: 1.3, shells: 1.3 }, poise: 50, frontGuard: { angleDeg: 120, damageMult: 0.2 } },
    rust_golem: { tier: 'heavy', movement: 'ground', brain: 'melee', levels: [13, 22], mult: { hp: 4.5, atk: 1.1, def: 2.0, xp: 3.0, shells: 3.0 }, poise: 80 },
    frost_harrier: { tier: 'grunt', movement: 'fly', brain: 'diver', levels: [19, 28], mult: { hp: 3.6, atk: 0.95, def: 0.8, xp: 1.2, shells: 1.0 }, poise: 15 },
    choir_vanguard: { tier: 'elite', movement: 'fly', brain: 'melee', levels: [22, 28], mult: { hp: 4.0, atk: 1.1, def: 1.5, xp: 4.0, shells: 4.0 }, poise: 60, boltDodge: 0.25 },
  },

  /**
   * GDD 7.2 enemy attacks: telegraph kind and power per hit (x ATK). Vanguard string power and enemy
   * windups are not in the GDD and are tuned values inside the 0.5-1.2 s windup band.
   */
  enemyTech: {
    // Balance pass: 0.8 -> 0.6 and a longer windup; the wisp is the first enemy of the game.
    wisp_spit: { telegraph: 'white', power: 0.6, windup: 0.7 },
    wisp_dive: { telegraph: 'red', power: 1.4, windup: 1.0, selfDestruct: true },
    boar_gore: { telegraph: 'white', power: 0.9, windup: 0.5 },
    boar_charge: { telegraph: 'white', power: 1.3, windup: 0.8, dist: 20, knock: { kind: 'smash', speed: 30 } },
    acolyte_string: { telegraph: 'white', powers: [0.6, 0.6, 0.9], windup: 0.5 },
    acolyte_rush: { telegraph: 'red', power: 1.4, windup: 0.9 },
    caster_volley: { telegraph: 'white', power: 0.6, count: 3, windup: 0.7 },
    caster_tether: { telegraph: 'violet', drainPerSec: 15, seconds: 2, windup: 0.8 },
    crab_pinch: { telegraph: 'white', power: 1.0, windup: 0.5 },
    crab_slam: { telegraph: 'red', power: 1.5, radius: 4, windup: 1.0 },
    golem_hammer: { telegraph: 'white', powers: [1.2, 1.2], windup: 0.8 },
    golem_stomp: { telegraph: 'red', power: 1.6, radius: 8, windup: 1.2 },
    golem_boulder: { telegraph: 'white', power: 1.2, windup: 0.9 },
    harrier_dive: { telegraph: 'red', power: 1.5, windup: 1.0 },
    harrier_gust: { telegraph: 'white', power: 0.7, windup: 0.6 },
    vanguard_string: { telegraph: 'white', powers: [0.6, 0.6, 0.6, 0.9], windup: 0.5 },
    vanguard_lance: { telegraph: 'white', chargeSeconds: 1, tickPower: 0.25, tick: 0.1, windup: 1.0 },
    vanguard_smash: { telegraph: 'red', power: 1.6, windup: 1.0 },
  },

  /**
   * GDD 7.3 bosses. phases = HP fractions at which each phase starts. index = loot `boss` shell multiplier.
   * Balance pass: hpMult raised (GDD 6 / 14 / 18 / 16 / 24) for fights of about 55 / 85 / 100 / 110 / 170 s at
   * Warrior (measured in the browser: Durn at hpMult 6 fell in 8 s); boss ATK is 0.75 (ai/data/enemies).
   * Re-balance after the combat input latch (presses during hit-stop register): the measured rotation deals about
   * 1.6x the damage per second it did, so every boss hpMult was raised by that factor (48 / 80 / 72 / 88 / 100 before)
   * to keep the fight lengths and healing items of the first pass.
   */
  bosses: {
    durn: { index: 1, level: 4, hpMult: 77, poise: 80, phases: [1.0], addsAt: 0.5, adds: 2, fleeAtZero: true, arena: { landmarkId: 'sparkstead', radius: 60 } },
    bramblehorn: { index: 2, level: 12, hpMult: 130, poise: 200, phases: [1.0, 0.5], craterRadius: 8, arena: { landmarkId: 'bramble_hollow', radius: 90 } },
    gorrumaw: { index: 3, level: 18, hpMult: 116, poise: 250, phases: [1.0, 0.5], armourDefMult: 0.5, arena: { landmarkId: 'burrow_pit', radius: 110 } },
    iskra: { index: 4, level: 22, hpMult: 138, poise: 220, phases: [1.0, 0.5], craterRadius: 12, diveHeight: 200, arena: { landmarkId: 'paleglass_summit', radius: 100 } },
    vorrhal: { index: 5, level: 26, hpMult: 156, poise: 300, phases: [1.0, 0.6, 0.25], hpPerSiphonStanding: 0.10, adds: 2, arena: { landmarkId: 'dim_court', radius: 120 } },
  },
  bossRules: { resetExtra: 60, introSeconds: 3, xpMult: 6 },

  /** GDD 8.3 Siphon Spires. */
  siphon: { hpMult: 6, cycleSeconds: 8, openSeconds: 4, closedDefMult: 10, zoneRadius: 80, corruptedMusicRadius: 300, mq7Required: 4 },

  /** GDD 3.4 and 9 world activities. */
  world: {
    camps: { perRegion: 5, refillDays: 1, minFromSettlement: 250, minApart: 300 },
    discoveryRadius: 60,
    poiCoverage: 500,
    race: { rewards: { bronze: 100, silver: 250, gold: 500 }, windmill_run: { bronze: 75, silver: 55, gold: 42 } },
  },

  /** GDD 3.1 time. */
  time: { dayMinutes: 24, startHour: 7, dayStart: 6, dayEnd: 20 },

  /** GDD 10 items and economy. Balance pass: price base 40 -> 70 so Shells still matter after MQ3 (income was 3x the spending). */
  economy: {
    gearPerLevel: 0.08,
    price: { base: 70, perLevel: 0.15, rarityMult: { common: 1, fine: 2.5, rare: 6 } },
    sellFraction: 0.25,
    carryCap: 5,
    shellsPerHour: { 10: 600, 25: 2500 },
  },
  /** GDD 10.2 gear base effects. stats scale with item level; mods are percentages and never scale. */
  gear: {
    training_wraps: { slot: 'wraps', rarity: 'common', stats: { mgt: 2 } },
    racers_wraps: { slot: 'wraps', rarity: 'fine', stats: { swf: 3, mgt: 2 } },
    bramble_wraps: { slot: 'wraps', rarity: 'fine', stats: { mgt: 4 }, mods: { critAdd: 0.03 } },
    saltglass_wraps: { slot: 'wraps', rarity: 'fine', stats: { spr: 4, swf: 2 } },
    copper_knuckles: { slot: 'wraps', rarity: 'rare', stats: { mgt: 6 }, mods: { poisePct: 0.10 } },
    stormcaller_wraps: { slot: 'wraps', rarity: 'rare', stats: { spr: 6 }, mods: { oraPct: 0.08 } },
    apprentice_garb: { slot: 'garb', rarity: 'common', stats: { def: 4 } },
    meadow_garb: { slot: 'garb', rarity: 'fine', stats: { def: 8, vit: 2 } },
    tidewoven_garb: { slot: 'garb', rarity: 'fine', stats: { def: 10, spr: 3 } },
    dunewalker_garb: { slot: 'garb', rarity: 'rare', stats: { def: 16, vit: 4 }, mods: { boostCostPct: -0.10 } },
    frostweave_garb: { slot: 'garb', rarity: 'rare', stats: { def: 20, vit: 5 } },
    lantern_mantle: { slot: 'garb', rarity: 'rare', stats: { def: 18, spr: 5 }, mods: { resPct: 0.05 } },
    sunfruit_charm: { slot: 'charm', rarity: 'common', mods: { healPct: 0.20 } },
    wind_charm: { slot: 'charm', rarity: 'fine', mods: { boostSpeedPct: 0.05 } },
    ember_charm: { slot: 'charm', rarity: 'fine', mods: { surgePct: 0.10 } },
    tide_charm: { slot: 'charm', rarity: 'fine', mods: { oraRegenPct: 0.15 } },
    golem_core_charm: { slot: 'charm', rarity: 'rare', mods: { poisePct: 0.15 } },
    frost_charm: { slot: 'charm', rarity: 'rare', mods: { perfectStaggerMult: 2 } },
    stillwind_charm: { slot: 'charm', rarity: 'rare', mods: { gatherPct: 0.20 } },
    wyrmhide_charm: { slot: 'charm', rarity: 'rare', mods: { hpPct: 0.08 } },
  },
  /** GDD 10.3 consumables. price = base + perLevel * player level. */
  consumables: {
    sunfruit: { effect: { kind: 'heal', pct: 0.30, seconds: 1 }, price: { base: 30, perLevel: 2 } },
    ora_draught: { effect: { kind: 'ora', pct: 0.50 }, price: { base: 45, perLevel: 3 } },
  },
  /** GDD 10.4 shops. Talia's Herbs has no stated level: it sells consumables only, priced by player level. */
  shops: {
    dov_stall: { level: 3, priceMult: 1 },
    aster_market: { level: 8, priceMult: 1 },
    talia_herbs: { level: 10, priceMult: 0.8 },
    yael_outpost: { level: 15, priceMult: 1 },
    ridgerest_provisions: { level: 22, priceMult: 1 },
  },
  /** GDD 10.5 drop tables. boss shells = perIndex x boss index; consumable `count` items always drop. */
  loot: {
    grunt: { shells: { chance: 1, mult: 1 }, consumable: 0.08, gear: { chance: 0.03, weights: { common: 70, fine: 27, rare: 3 } } },
    heavy: { shells: { chance: 1, mult: 2 }, consumable: 0.12, gear: { chance: 0.06, weights: { common: 50, fine: 40, rare: 10 } } },
    elite: { shells: { chance: 1, mult: 4 }, consumable: 0.30, gear: { chance: 0.25, weights: { common: 0, fine: 60, rare: 40 } } },
    // Boss Shells 500 -> 250 per index (the GDD lump paid more than the whole shop of the region).
    boss: { shells: { perIndex: 250 }, consumable: 1, consumableCount: 2, gear: { chance: 0, weights: { common: 0, fine: 0, rare: 0 } } },
    chest_t1: { shells: { min: 60, max: 150 }, consumable: 0.60, gear: { chance: 0.25, weights: { common: 60, fine: 38, rare: 2 } } },
    chest_t2: { shells: { min: 150, max: 350 }, consumable: 0.60, gear: { chance: 0.30, weights: { common: 30, fine: 55, rare: 15 } } },
    chest_t3: { shells: { min: 350, max: 700 }, consumable: 0.60, gear: { chance: 0.35, weights: { common: 0, fine: 60, rare: 40 } } },
  },
  pickups: { magnetRadius: 6 },

  /** ARCHITECTURE 4.6 movement constants (from GDD 3.1, 4.3 and 5.4). */
  move: {
    groundAccel: 40, gravity: 28, jumpSpeed: 11, walkableSlope: 0.4, groundSnap: 0.6,
    flightDamping: 6, autoLand: 1.2, swimDepth: 1.2,
    ceiling: 1500, ceilingFadeFrom: 1350,
  },

  /**
   * GDD 4.1 XP route, simulated by formulas.simulateRoute in tests/core/balance.test.mjs.
   * Each band runs [from, to) minutes. Enemies are at the player's level (`enemyLevelOffset` 0).
   * Quest XP comes from `quests` (xp + stepXp); quests, camps, Siphons, bosses and discoveries are spread evenly across the band.
   * Discoveries are a mix of landmarks (30 XP) and minor POIs (10 XP); `discoveryXp` is the mean, with
   * about one discovery in four a landmark.
   * Tuned (GDD 4.1 tuning rule): the average xpMult of band A is 0.70 (GDD 0.85) and of band B 1.10 (GDD 1.2);
   * with the GDD values L10 lands at minute 38 and L20 at minute 105, before the target windows. Band C is 1.0
   * (GDD 1.5): with 1.5 the player met Iskra (L22) at L25 and started MQ7 at L30, above the finale's 24-28.
   */
  route: {
    discoveryXp: 15,
    mq7StartMinute: 270,
    targets: { level10: [40, 50], level20: [110, 130], mq7MinLevel: 25 },
    bands: [
      {
        id: 'A', from: 0, to: 45, killsPerMin: 1.8, enemyLevelOffset: 0, xpMult: 0.70,
        quests: ['mq1', 'mq2', 'sq1', 'sq2', 'sq3'],
        camps: 5, siphons: 1, bosses: ['durn'], discoveries: 25,
      },
      {
        id: 'B', from: 45, to: 120, killsPerMin: 0.8, enemyLevelOffset: 0, xpMult: 1.10,
        quests: ['mq3', 'mq4', 'mq5', 'sq4'],
        camps: 10, siphons: 3, bosses: ['bramblehorn', 'gorrumaw'], discoveries: 40,
      },
      {
        id: 'C', from: 120, to: 270, killsPerMin: 0.4, enemyLevelOffset: 0, xpMult: 1.0,
        quests: ['mq6'],
        camps: 6, siphons: 1, bosses: ['iskra'], discoveries: 30,
      },
    ],
  },
});
