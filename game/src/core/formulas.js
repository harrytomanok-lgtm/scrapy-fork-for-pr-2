/**
 * Every formula of ARCHITECTURE 4.17 and the GDD (sections 4-7 and 10). Pure functions over BALANCE.
 * No three, no DOM, no randomness (callers pass rolls in).
 * @module core/formulas
 */
import { BALANCE } from './balance.js';

/**
 * @typedef {{ mgt:number, spr:number, vit:number, swf:number, def?:number }} BaseStats
 *   Effective stat values (allocation plus gear stats). `def` is the summed gear defense (GDD 4.3 `gearDef`).
 */
const B = BALANCE;

/**
 * Default value of every rpg.mods() key (IDS.modKey): `*Pct` and `critAdd` add from 0, `*Mult` keys multiply
 * from 1, `secondBreath` is 0 or 1.
 * @type {Readonly<Record<string, number>>}
 */
export const MOD_DEFAULTS = Object.freeze({
  meleePct: 0, oraPct: 0, poisePct: 0, surgePct: 0, gatherPct: 0, oraRegenPct: 0, boostCostPct: 0, boostSpeedPct: 0,
  healPct: 0, resPct: 0, critAdd: 0, hpPct: 0, oraPoolPct: 0,
  flickerCostMult: 1, secondBreath: 0, perfectStaggerMult: 1, gatherDmgTakenMult: 1, siphonRegenMult: 1,
});

/**
 * A fresh mods object with every key at its default.
 * @returns {Record<string, number>}
 */
export function createMods() {
  return { ...MOD_DEFAULTS };
}

/**
 * Fold `mods` into `out`: keys ending in `Mult` multiply, `secondBreath` takes the maximum, every other key adds.
 * Unknown keys are ignored (defs.validate rejects them at boot).
 * @param {Record<string, number>} out
 * @param {Record<string, number>|null|undefined} mods
 * @returns {Record<string, number>} out
 */
export function addMods(out, mods) {
  if (!mods) return out;
  for (const k in mods) {
    if (!(k in MOD_DEFAULTS)) continue;
    const v = mods[k];
    if (typeof v !== 'number') continue;
    if (k.endsWith('Mult')) out[k] = (typeof out[k] === 'number' ? out[k] : 1) * v;
    else if (k === 'secondBreath') out[k] = Math.max(out[k] || 0, v);
    else out[k] = (out[k] || 0) + v;
  }
  return out;
}

/**
 * Read one modifier with its default.
 * @param {Record<string, number>|null|undefined} mods
 * @param {string} key
 * @returns {number}
 */
export function mod(mods, key) {
  const v = mods ? mods[key] : undefined;
  return typeof v === 'number' ? v : MOD_DEFAULTS[key];
}

/** @param {number} v @param {number} a @param {number} b @returns {number} */
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** @param {string} id @returns {object} the difficulty row, Warrior when unknown */
export function difficultyRow(id) {
  return B.difficulty[id] || B.difficulty.warrior;
}

// ---------------------------------------------------------------- levels and XP

/**
 * XP needed to go from `level` to `level + 1` (GDD 4.1): round(60 * L^1.5 + 40 * L).
 * @param {number} level
 * @returns {number}
 */
export function xpToNext(level) {
  const c = B.level.curve;
  const L = Math.max(1, level);
  return Math.round(c.a * Math.pow(L, c.pow) + c.b * L);
}

/**
 * Total XP from level 1 to reach `level`.
 * @param {number} level
 * @returns {number}
 */
export function totalXpToLevel(level) {
  let sum = 0;
  for (let L = 1; L < level; L++) sum += xpToNext(L);
  return sum;
}

/**
 * Stat points granted by reaching `level` from level 1.
 * @param {number} level
 * @returns {number}
 */
export function statPointsAt(level) {
  return Math.max(0, level - 1) * B.level.statPointsPerLevel;
}

/**
 * The stat an allocation style assigns to the point with this index (0-based count of points ever auto-applied).
 * @param {'brawler'|'blaster'|'balanced'|'manual'} style
 * @param {number} pointIndex
 * @returns {'mgt'|'spr'|'vit'|'swf'|null} null for 'manual'
 */
export function styleStat(style, pointIndex) {
  const order = B.styles[style];
  if (!order) return null;
  return order[pointIndex % order.length];
}

/**
 * Level-difference factor for enemy XP (GDD 4.1).
 * @param {number} enemyLevel
 * @param {number} playerLevel
 * @returns {number}
 */
export function xpLevelFactor(enemyLevel, playerLevel) {
  const below = playerLevel - enemyLevel;
  const rules = B.xp.levelDiff;
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.minBelow !== undefined && below >= r.minBelow) return r.mult;
    if (r.maxBelow !== undefined && below <= r.maxBelow) return r.mult;
  }
  return 1;
}

/**
 * XP for killing an enemy (GDD 4.1, 7.1): round(12 * Le^1.3 * xpMult * levelFactor * difficultyReward).
 * @param {{ mult?:{ xp?:number } }} enemyDef
 * @param {number} level            enemy level
 * @param {number} playerLevel
 * @param {string} [difficulty='warrior']  GDD 6.9 "XP and Shells" row (an addition to the 4.17 signature)
 * @returns {number}
 */
export function enemyXp(enemyDef, level, playerLevel, difficulty = 'warrior') {
  const e = B.xp.enemy;
  const xpMult = enemyDef && enemyDef.mult && typeof enemyDef.mult.xp === 'number' ? enemyDef.mult.xp : 1;
  const Le = Math.max(1, level);
  return Math.round(e.base * Math.pow(Le, e.pow) * xpMult * xpLevelFactor(Le, playerLevel) * difficultyRow(difficulty).reward);
}

/**
 * Shells dropped by an enemy (GDD 7.1): round((3 + 1.2 * Le) * shellMult * difficultyReward).
 * @param {{ mult?:{ shells?:number } }} enemyDef
 * @param {number} level
 * @param {string} [difficulty='warrior']
 * @returns {number}
 */
export function enemyShells(enemyDef, level, difficulty = 'warrior') {
  const s = B.enemyScale.shells;
  const mult = enemyDef && enemyDef.mult && typeof enemyDef.mult.shells === 'number' ? enemyDef.mult.shells : 1;
  return Math.round((s.base + s.perLevel * Math.max(1, level)) * mult * difficultyRow(difficulty).reward);
}

/**
 * Bonus XP as a share of the player's current xpToNext (GDD 4.1).
 * @param {'siphon'|'camp'|'campRefill'} kind
 * @param {number} level  player level
 * @returns {number}
 */
export function bonusXp(kind, level) {
  const pct = B.xp.bonus[kind] || 0;
  return Math.round(pct * xpToNext(level));
}

// ---------------------------------------------------------------- derived player values (GDD 4.3)

/** @param {number} vit @param {number} level @param {object} [mods] @returns {number} */
export function hpMax(vit, level, mods) {
  const h = B.derived.hp;
  return Math.round((h.base + h.perVit * vit + h.perLevel * level) * (1 + mod(mods, 'hpPct')));
}

/** @param {number} spr @param {object} [mods] @returns {number} */
export function oraMax(spr, mods) {
  const o = B.derived.ora;
  return Math.round((o.base + o.perSpr * spr) * (1 + mod(mods, 'oraPoolPct')));
}

/**
 * Passive Ora regen per second (GDD 4.3). 0 while boosting, in a Form or in Burnout.
 * @param {number} spr
 * @param {object} [mods]
 * @param {{ inCombat?:boolean, inSiphonZone?:boolean, boosting?:boolean, inForm?:boolean, burnout?:boolean }} [state]
 * @returns {number}
 */
export function oraRegen(spr, mods, state) {
  if (state && (state.boosting || state.inForm || state.burnout)) return 0;
  const r = B.derived.oraRegen;
  let v = (r.base + r.perSpr * spr) * (1 + mod(mods, 'oraRegenPct'));
  if (state && state.inCombat) v *= r.inCombatMult;
  if (state && state.inSiphonZone) v *= r.siphonZoneMult * mod(mods, 'siphonRegenMult');
  return v;
}

/**
 * Gather rate in Ora per second (GDD 4.3).
 * @param {number} spr @param {object} [mods] @returns {number}
 */
export function gatherRate(spr, mods) {
  const g = B.derived.gather;
  return (g.base + g.perSpr * spr) * (1 + mod(mods, 'gatherPct'));
}

/**
 * Melee or Ora rating: 20 + 4 * stat + 3 * L.
 * @param {number} stat  mgt for melee, spr for Ora
 * @param {number} level
 * @returns {number}
 */
export function rating(stat, level) {
  const r = B.derived.rating;
  return r.base + r.perStat * stat + r.perLevel * level;
}

/** @param {number} swf @param {object} [mods] @returns {number} crit chance 0..cap */
export function critChance(swf, mods) {
  const c = B.derived.crit;
  return Math.min(c.cap, c.base + c.perSwf * swf + mod(mods, 'critAdd'));
}

/** @param {number} swf @returns {number} cooldown reduction 0..0.30 */
export function cooldownReduction(swf) {
  const c = B.derived.cdr;
  return Math.min(c.cap, c.perSwf * swf);
}

/**
 * A cooldown after Swiftness reduction.
 * @param {number} seconds @param {number} cdr @returns {number}
 */
export function cooldown(seconds, cdr) {
  return seconds * (1 - clamp(cdr, 0, B.derived.cdr.cap));
}

/**
 * Derived player stats (GDD 4.3) including gear (via base and mods) and the Form multipliers. This is the only
 * place Form multipliers enter the stats (ARCHITECTURE 4.11). `hp` and `ora` are returned at their maxima;
 * rpg keeps the current values. `resonance` uses `extra` (an addition to the 4.17 signature, defaults: awakened, no Gather).
 * @param {BaseStats} base
 * @param {number} level
 * @param {object} [mods]          rpg.mods() shape
 * @param {{ mult:{ dmg:number, def:number, speed:number, res:number } }|null} [form]   FormDef or null
 * @param {{ awakened?:boolean, gatherMult?:number }} [extra]
 * @returns {object} ActorStats (ARCHITECTURE 3.5)
 */
export function derivePlayerStats(base, level, mods, form, extra) {
  const d = B.derived;
  const L = Math.max(1, level);
  const hp = hpMax(base.vit, L, mods);
  const ora = oraMax(base.spr, mods);
  const fm = form && form.mult ? form.mult : null;
  return {
    hp, hpMax: hp, ora, oraMax: ora,
    meleeRating: rating(base.mgt, L),
    oraRating: rating(base.spr, L),
    defense: d.defense.perVit * base.vit + d.defense.perLevel * L + (base.def || 0),
    critChance: critChance(base.swf, mods),
    poise: d.playerPoise, poiseMax: d.playerPoise,
    resonance: resonance(base, L, mods, fm ? fm.res : 1, extra && typeof extra.gatherMult === 'number' ? extra.gatherMult : 1,
      extra && extra.awakened === false ? false : true),
    runSpeed: Math.min(d.run.cap, d.run.base + d.run.perSwf * base.swf),
    flySpeed: Math.min(d.fly.cap, d.fly.base + d.fly.perSwf * base.swf),
    boostSpeed: Math.min(d.boost.cap, d.boost.base + d.boost.perSwf * base.swf) * (1 + mod(mods, 'boostSpeedPct')),
    cdr: cooldownReduction(base.swf),
    dmgMult: fm ? fm.dmg : 1,
    defMult: fm ? fm.def : 1,
    speedMult: fm ? fm.speed : 1,
  };
}

// ---------------------------------------------------------------- Resonance (GDD 4.4)

/**
 * Player Resonance: round(40 * (mgt+spr+vit+swf) * (1 + 0.1 L) * (1 + resPct) * formResMult * gatherMult * awakenMult).
 * @param {BaseStats} base
 * @param {number} level
 * @param {object} [mods]
 * @param {number} [formResMult=1]
 * @param {number} [gatherMult=1]
 * @param {boolean} [awakened=true]
 * @returns {number}
 */
export function resonance(base, level, mods, formResMult = 1, gatherMult = 1, awakened = true) {
  const r = B.resonance;
  const sum = base.mgt + base.spr + base.vit + base.swf;
  return Math.round(r.base * sum * (1 + r.perLevel * level) * (1 + mod(mods, 'resPct')) * formResMult * gatherMult * (awakened ? 1 : r.awakenMult));
}

/**
 * The Resonance multiplier of a Form id (null = base).
 * @param {string|null} formId @returns {number}
 */
export function formResMult(formId) {
  if (!formId) return B.resonance.form.base;
  const v = B.resonance.form[formId];
  return typeof v === 'number' ? v : 1;
}

/**
 * gatherMult after `seconds` of continuous Gathering: ramps 1.00 -> 1.15 over 1 s.
 * @param {number} seconds @returns {number}
 */
export function gatherResMult(seconds) {
  const g = B.resonance.gather;
  return 1 + (g.max - 1) * clamp(seconds / g.rampSeconds, 0, 1);
}

/**
 * Enemy Resonance: round(40 * (20 + 3 * (Le - 1)) * (1 + 0.1 Le) * tierMult).
 * @param {number} level @param {'grunt'|'heavy'|'elite'|'boss'} tier @returns {number}
 */
export function enemyResonance(level, tier) {
  const r = B.resonance;
  const t = r.tierMult[tier] || 1;
  return Math.round(r.base * (r.enemy.base + r.enemy.perLevel * (level - 1)) * (1 + r.perLevel * level) * t);
}

/**
 * The lock-on tint of an enemy number relative to the player's (GDD 4.4).
 * @param {number} enemyRes @param {number} playerRes @returns {'grey'|'white'|'amber'|'danger'}
 */
export function resonanceTint(enemyRes, playerRes) {
  const t = B.resonance.tint;
  const ratio = playerRes > 0 ? enemyRes / playerRes : Infinity;
  if (ratio > t.danger) return 'danger';
  if (ratio > t.amber) return 'amber';
  if (ratio < t.grey) return 'grey';
  return 'white';
}

/**
 * The highest Resonance milestone crossed going from `prev` to `value`, or null.
 * @param {number} prev @param {number} value @returns {number|null}
 */
export function resonanceMilestone(prev, value) {
  const list = B.resonance.milestones;
  let hit = null;
  for (let i = 0; i < list.length; i++) if (prev < list[i] && value >= list[i]) hit = list[i];
  return hit;
}

// ---------------------------------------------------------------- enemies (GDD 7.1)

/** @param {number} hpMult @param {number} level @param {string} [difficulty] @returns {number} */
export function enemyHp(hpMult, level, difficulty = 'warrior') {
  const h = B.enemyScale.hp;
  return Math.round(hpMult * (h.base + h.perLevel * level + h.quad * level * level) * difficultyRow(difficulty).enemyHp);
}

/** ATK(Le) = atkMult * (8 + 4 Le). @param {number} atkMult @param {number} level @returns {number} */
export function enemyAtk(atkMult, level) {
  const a = B.enemyScale.atk;
  return atkMult * (a.base + a.perLevel * level);
}

/** DEF(Le) = defMult * 2 * Le. @param {number} defMult @param {number} level @returns {number} */
export function enemyDef(defMult, level) {
  return defMult * B.enemyScale.def.perLevel * level;
}

/**
 * Stats of an enemy or boss (GDD 7.1, 4.4). meleeRating = oraRating = ATK. The difficulty damage multiplier is
 * not folded in (combat passes it to `damage` as difficultyMult); the difficulty HP multiplier is.
 * @param {{ tier?:string, mult?:{ hp?:number, atk?:number, def?:number }, poise?:number, params?:{ runSpeed?:number, flySpeed?:number } }} enemyDef
 * @param {number} level
 * @param {string} [difficulty='warrior']
 * @param {{ hpMult?:number, poise?:number }} [opts]   override enemyDef.mult.hp and enemyDef.poise (bosses)
 * @returns {object} ActorStats (ARCHITECTURE 3.5)
 */
export function enemyStats(enemyDef, level, difficulty = 'warrior', opts) {
  const m = (enemyDef && enemyDef.mult) || {};
  const Le = Math.max(1, level);
  const hpMult = opts && typeof opts.hpMult === 'number' ? opts.hpMult : typeof m.hp === 'number' ? m.hp : 1;
  const poise = opts && typeof opts.poise === 'number' ? opts.poise : enemyDef && typeof enemyDef.poise === 'number' ? enemyDef.poise : 0;
  const hp = enemyHp(hpMult, Le, difficulty);
  const atk = enemyAtk(typeof m.atk === 'number' ? m.atk : 1, Le);
  const params = (enemyDef && enemyDef.params) || {};
  const mv = B.enemyScale.move;
  return {
    hp, hpMax: hp, ora: 100, oraMax: 100,
    meleeRating: atk, oraRating: atk,
    defense: enemyDef(typeof m.def === 'number' ? m.def : 1, Le),
    critChance: 0,
    poise, poiseMax: poise,
    resonance: enemyResonance(Le, (enemyDef && enemyDef.tier) || 'grunt'),
    runSpeed: typeof params.runSpeed === 'number' ? params.runSpeed : mv.run,
    flySpeed: typeof params.flySpeed === 'number' ? params.flySpeed : mv.fly,
    boostSpeed: 0,
    cdr: 0,
    dmgMult: 1, defMult: 1, speedMult: 1,
  };
}

// ---------------------------------------------------------------- damage (GDD 5.2)

/**
 * damage = max(1, round(power * rating * 100 / (100 + targetDefense) * attackerDmgMult / targetDefMult * critMult * roll * difficultyMult))
 * @param {number} power
 * @param {number} rating
 * @param {number} targetDefense
 * @param {number} attackerDmgMult
 * @param {number} targetDefMult
 * @param {number} critMult        1, or 1.5 on a crit
 * @param {number} roll            0.95..1.05 from rng.sim
 * @param {number} difficultyMult  enemy damage row for enemy hits on the player, else 1
 * @returns {number}
 */
export function damage(power, rating, targetDefense, attackerDmgMult, targetDefMult, critMult, roll, difficultyMult) {
  const K = B.damage.defenseK;
  const defMult = targetDefMult > 0 ? targetDefMult : 1;
  const v = power * rating * K / (K + Math.max(0, targetDefense)) * attackerDmgMult / defMult * critMult * roll * difficultyMult;
  return Math.max(B.damage.min, Math.round(v));
}

/**
 * Charge multiplier: 1 up to `minSeconds`, then linear to `maxMult` at `maxSeconds`.
 * @param {number} heldSeconds @param {number} minSeconds @param {number} maxSeconds @param {number} maxMult
 * @returns {number}
 */
export function chargeMult(heldSeconds, minSeconds, maxSeconds, maxMult) {
  if (maxSeconds <= minSeconds) return heldSeconds >= minSeconds ? maxMult : 1;
  const t = clamp((heldSeconds - minSeconds) / (maxSeconds - minSeconds), 0, 1);
  return 1 + (maxMult - 1) * t;
}

/**
 * Ora Bolt range falloff: full damage up to 30 m, falling to 50% at 90 m (and beyond).
 * @param {number} distance @returns {number}
 */
export function boltFalloff(distance) {
  const f = B.tech.ora_bolt.falloff;
  if (distance <= f.fullRange) return 1;
  const t = clamp((distance - f.fullRange) / (f.endRange - f.fullRange), 0, 1);
  return 1 + (f.endMult - 1) * t;
}

/**
 * Ringfall power at a distance from the impact: 16 at the centre to 8 at 22 m; 0 outside.
 * @param {number} distance @returns {number}
 */
export function ringfallPower(distance) {
  const r = B.tech.ringfall;
  if (distance > r.radius) return 0;
  const t = clamp(distance / r.radius, 0, 1);
  return r.powerCentre + (r.powerEdge - r.powerCentre) * t;
}

// ---------------------------------------------------------------- items and economy (GDD 10)

/**
 * Gear stat value at an item level: round(base * (1 + 0.08 * itemLevel)).
 * @param {number} base @param {number} itemLevel @returns {number}
 */
export function itemValue(base, itemLevel) {
  return Math.round(base * (1 + B.economy.gearPerLevel * itemLevel));
}

/**
 * Gear buy price: round(40 * rarityMult * (1 + 0.15 * itemLevel)).
 * @param {'common'|'fine'|'rare'} rarity @param {number} itemLevel @returns {number}
 */
export function itemPrice(rarity, itemLevel) {
  const p = B.economy.price;
  const rm = p.rarityMult[rarity] || 1;
  return Math.round(p.base * rm * (1 + p.perLevel * itemLevel));
}

/**
 * Consumable buy price at a player level (GDD 10.3); 0 for an unknown id.
 * @param {string} itemId @param {number} playerLevel @returns {number}
 */
export function consumablePrice(itemId, playerLevel) {
  const c = B.consumables[itemId];
  if (!c) return 0;
  return c.price.base + c.price.perLevel * playerLevel;
}

/**
 * Sell price: 25% of the buy price, rounded down.
 * @param {number} buyPrice @returns {number}
 */
export function sellPrice(buyPrice) {
  return Math.floor(buyPrice * B.economy.sellFraction);
}

/**
 * Enemy level inside a region band (GDD 3.2): the band interpolated by t, rounded and clamped.
 * @param {[number, number]} band @param {number} t 0..1 @returns {number}
 */
export function regionLevel(band, t) {
  const v = Math.round(band[0] + (band[1] - band[0]) * clamp(t, 0, 1));
  return clamp(v, Math.min(band[0], band[1]), Math.max(band[0], band[1]));
}

// ---------------------------------------------------------------- pacing (GDD 4.1)

/**
 * Pure pacing simulation of the XP route. Each minute the band's average kills give XP at the player's level
 * (plus `enemyLevelOffset`); quests (BALANCE.quests xp + stepXp), camps and Siphons (bonusXp at the current level),
 * bosses (enemyXp with the boss xpMult) and discoveries (route.discoveryXp) are spread evenly over the band.
 * @param {typeof BALANCE.route} route
 * @returns {Array<{ minute:number, level:number }>} the level at the start of every minute, and at the route end
 */
export function simulateRoute(route) {
  const cap = B.level.cap;
  const end = typeof route.mq7StartMinute === 'number' ? route.mq7StartMinute : route.bands[route.bands.length - 1].to;
  /** @type {Array<{ t:number, kind:string, id?:string }>} */
  const events = [];
  for (const band of route.bands) {
    const spread = (list, kind) => {
      const n = list.length;
      for (let i = 0; i < n; i++) events.push({ t: band.from + (i + 0.5) * (band.to - band.from) / n, kind, id: list[i] });
    };
    spread(band.quests || [], 'quest');
    spread(band.bosses || [], 'boss');
    spread(new Array(band.camps || 0).fill(''), 'camp');
    spread(new Array(band.siphons || 0).fill(''), 'siphon');
    spread(new Array(band.discoveries || 0).fill(''), 'discovery');
  }
  events.sort((a, b) => a.t - b.t);

  let level = 1;
  let xp = 0;
  let next = 0;
  const out = [];
  const grant = (amount) => {
    xp += amount;
    while (level < cap && xp >= xpToNext(level)) {
      xp -= xpToNext(level);
      level++;
    }
  };
  for (let m = 0; m < end; m++) {
    out.push({ minute: m, level });
    const band = route.bands.find((b) => m >= b.from && m < b.to);
    if (band) {
      const Le = Math.max(1, level + (band.enemyLevelOffset || 0));
      grant(band.killsPerMin * enemyXp({ mult: { xp: band.xpMult } }, Le, level));
    }
    while (next < events.length && events[next].t < m + 1) {
      const e = events[next++];
      if (e.kind === 'quest') {
        const q = B.quests[e.id];
        if (q) grant(q.xp + (q.stepXp || 0));
      } else if (e.kind === 'boss') {
        const b = B.bosses[e.id];
        if (b) grant(enemyXp({ mult: { xp: B.bossRules.xpMult } }, b.level, level));
      } else if (e.kind === 'camp') grant(bonusXp('camp', level));
      else if (e.kind === 'siphon') grant(bonusXp('siphon', level));
      else grant(route.discoveryXp);
    }
  }
  out.push({ minute: end, level });
  return out;
}
