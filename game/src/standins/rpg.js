/**
 * Stand-in `ctx.rpg` (ARCHITECTURE 4.11, 8.0): level and XP (multi-level-ups, auto allocation by style), stat
 * allocation, stats through `formulas.derivePlayerStats` (gear and Form included), Resonance (with the Gather
 * ramp), Shells, items (add, remove, equip, use, quick item), technique unlock, nodes and slots, Forms, shops,
 * loot rolls with pickups, flags, respawn at the Ringstone or the boss retry point, kill XP, the
 * `tutorial=0` shortcut on `game:newGame`, and the hp / ora / surge save hooks.
 * System: `standin.rpg.pickups` (post): pickups, heal over time, the Gather Resonance ramp.
 * The quick-item input lives in the stand-in quests system (`quests.run`, 4.12). Replaced by the rpg package.
 * @module standins/rpg
 */

import { BALANCE } from '../core/balance.js';
import * as F from '../core/formulas.js';

const OWNER = 'standin:rpg';
const STATS = Object.freeze(['mgt', 'spr', 'vit', 'swf']);
const EQUIP_SLOTS = Object.freeze(['wraps', 'garb', 'charm1', 'charm2']);
const SHELL_DEF = Object.freeze({ mult: Object.freeze({ shells: 1 }) });
const PICKUP_LIFE = 120;
const PICKUP_SPEED = 14;
const COLLECT_RADIUS = 1.4;

/**
 * Create the stand-in rpg service.
 * @param {any} ctx
 */
function createRpg(ctx) {
  /** The player entity bound by attachPlayer (an entity, not a service). @type {any} */
  let playerEnt = null;
  const eff = { mgt: 5, spr: 5, vit: 5, swf: 5, def: 0 };
  const mods = F.createMods();
  const slotsObj = { slots: [null, null], ultimate: null };
  /** @type {any} */
  let derived = null;
  let res = 0;
  let gathering = false;
  let gatherT = 0;
  let healLeft = 0;
  let healRate = 0;
  /** @type {Record<string, number>|null} */
  let bossSnapshot = null;
  /** @type {string|null} */
  let retryBoss = null;
  const unsubs = [];
  const pRes = { value: 0, prev: 0, milestone: null };
  const pStats = {};

  const S = () => ctx.store.state;
  const P = () => ctx.store.state.player;
  const INV = () => ctx.store.state.inv;
  const ent = () => (playerEnt && playerEnt.stats && ctx.ents.get(playerEnt.id) === playerEnt ? playerEnt : null);

  /** @param {number} uid */
  const rowOf = (uid) => INV().items.find((r) => r.uid === uid) || null;
  const isEquipped = (uid) => {
    const eq = INV().equip;
    return eq.wraps === uid || eq.garb === uid || eq.charm1 === uid || eq.charm2 === uid;
  };

  /** Recompute effective base, mods, derived stats and Resonance; emits rpg:stats (and rpg:resonance on change). */
  function recompute() {
    const p = P();
    for (const k of STATS) eff[k] = p.base[k];
    eff.def = 0;
    for (const k of Object.keys(F.MOD_DEFAULTS)) mods[k] = F.MOD_DEFAULTS[k];
    const eq = INV().equip;
    for (const s of EQUIP_SLOTS) {
      const uid = eq[s];
      if (uid === null || uid === undefined) continue;
      const row = rowOf(uid);
      const def = row ? ctx.defs.find('item', row.itemId) : null;
      if (!def) continue;
      if (def.stats) for (const k of Object.keys(def.stats)) eff[k] = (eff[k] || 0) + F.itemValue(def.stats[k], row.level);
      F.addMods(mods, def.mods);
    }
    for (const nid of p.nodes) {
      const n = ctx.defs.find('techNode', nid);
      if (n && n.passive) F.addMods(mods, n.passive);
    }
    const e = ent();
    const formId = e && e.combat ? e.combat.formId : null;
    const form = formId ? ctx.defs.find('form', formId) : null;
    if (form) {
      mods.flickerCostMult *= form.flickerCostMult;
      mods.surgePct += form.mult.surge - 1;
    }
    derived = F.derivePlayerStats(eff, p.level, mods, form, { awakened: !!p.awakened, gatherMult: gathering ? F.gatherResMult(gatherT) : 1 });
    if (e) {
      const st = e.stats;
      for (const k of Object.keys(derived)) if (k !== 'hp' && k !== 'ora') st[k] = derived[k];
      e.level = p.level;
      ctx.combat.heal(e, 0);
      ctx.combat.addOra(e, 0);
    }
    setResonance(derived.resonance);
    ctx.bus.emit('rpg:stats', pStats);
  }

  function setResonance(v) {
    if (v === res) return;
    const prev = res;
    res = v;
    const e = ent();
    if (e) e.stats.resonance = v;
    pRes.value = v; pRes.prev = prev; pRes.milestone = prev > 0 ? F.resonanceMilestone(prev, v) : null;
    ctx.bus.emit('rpg:resonance', pRes);
  }

  /** Spend unspent points by a style. */
  function spendBy(style) {
    const p = P();
    while (p.statPoints > 0) {
      const index = p.base.mgt + p.base.spr + p.base.vit + p.base.swf - 4 * BALANCE.level.startStat;
      const stat = F.styleStat(style, index);
      if (!stat) return;
      p.base[stat]++;
      p.statPoints--;
    }
  }

  function fullRestore() {
    const e = ent();
    if (!e) return;
    ctx.combat.heal(e, e.stats.hpMax);
    ctx.combat.addOra(e, e.stats.oraMax);
  }

  /** Roll a loot table with rng.sim; `give(kind, itemId, count, level, rarity)` receives each result. */
  function roll(tableId, level, give) {
    const t = ctx.defs.find('lootTable', tableId);
    if (!t) return;
    const rng = ctx.rng.sim;
    const diff = P().difficulty;
    const s = t.shells || {};
    if (typeof s.min === 'number') give('shells', null, rng.int(s.min, s.max), level, null);
    else if (typeof s.perIndex === 'number') give('shells', null, s.perIndex, level, null);
    else if (typeof s.chance === 'number' && rng.chance(s.chance)) {
      give('shells', null, Math.round(F.enemyShells(SHELL_DEF, level, diff) * (s.mult || 1)), level, null);
    }
    const nCons = typeof t.consumableCount === 'number' ? t.consumableCount : 1;
    if (t.consumable > 0 && rng.chance(Math.min(1, t.consumable))) {
      for (let i = 0; i < nCons; i++) give('item', rng.chance(0.65) ? 'sunfruit' : 'ora_draught', 1, 1, 'common');
    }
    const g = t.gear;
    if (g && g.chance > 0 && rng.chance(g.chance)) {
      const w = g.weights;
      const total = w.common + w.fine + w.rare;
      let x = rng.next() * total;
      const rarity = x < w.common ? 'common' : (x -= w.common) < w.fine ? 'fine' : 'rare';
      const pool = ctx.defs.all('item').filter((d) => d.type === 'gear' && d.drops && d.rarity === rarity);
      if (pool.length) give('item', pool[Math.floor(rng.next() * pool.length)].id, 1, Math.max(1, level), rarity);
    }
  }

  /** @param {string} kind @param {string|null} itemId @param {number} amount @param {number} level @param {string|null} rarity */
  function spawnPickup(kind, itemId, amount, level, rarity, x, y, z, i) {
    if (amount <= 0) return;
    const e = ctx.ents.create('pickup');
    if (!e) return;
    const a = i * 2.39996;
    const px = x + Math.sin(a) * 0.8;
    const pz = z + Math.cos(a) * 0.8;
    const g = ctx.world ? ctx.world.heightAt(px, pz) : y;
    e.team = 0;
    e.defId = itemId || kind;
    e.radius = 0.3;
    e.height = 0.6;
    e.pos.set(px, Math.max(g, y) + 0.4, pz);
    e.prev.copy(e.pos);
    e.data = { standinPickup: true, kind, itemId, amount, level, rarity, life: PICKUP_LIFE };
    ctx.bus.emit('pickup:spawned', { entId: e.id, kind, itemId, rarity });
  }

  const rpg = {
    /** @param {any} e the player entity */
    attachPlayer(e) {
      if (!e) return;
      playerEnt = e;
      const p = P();
      e.level = p.level;
      e.nameKey = 'core.player.name';
      gathering = false;
      gatherT = 0;
      res = 0;
      e.stats = null;
      recompute();
      const st = Object.assign({}, derived);
      st.hp = Math.max(1, Math.min(st.hpMax, typeof p.hp === 'number' && p.hp > 0 ? p.hp : st.hpMax));
      st.ora = Math.max(0, Math.min(st.oraMax, typeof p.ora === 'number' ? p.ora : st.oraMax));
      e.stats = st;
    },

    get level() {
      return P().level;
    },
    get xp() {
      return P().xp;
    },
    xpToNext() {
      return F.xpToNext(P().level);
    },

    /** @param {number} amount @param {string} [source='debug'] */
    grantXp(amount, source = 'debug') {
      const p = P();
      const n = Math.max(0, Math.round(amount || 0));
      if (n <= 0) return;
      const cap = BALANCE.level.cap;
      p.xp += n;
      ctx.bus.emit('rpg:xp', { amount: n, total: p.xp, source });
      while (p.level < cap && p.xp >= F.xpToNext(p.level)) {
        p.xp -= F.xpToNext(p.level);
        p.level++;
        p.statPoints += BALANCE.level.statPointsPerLevel;
        p.tp += BALANCE.level.tpPerLevel;
        if (p.autoStyle !== 'manual') spendBy(p.autoStyle);
        recompute();
        fullRestore();
        ctx.bus.emit('rpg:levelUp', { level: p.level, statPoints: p.statPoints, tp: p.tp });
      }
      if (p.level >= cap) p.xp = 0;
    },

    /** @param {number} level */
    setLevel(level) {
      const p = P();
      const L = Math.max(1, Math.min(BALANCE.level.cap, Math.round(level)));
      p.level = L;
      p.xp = 0;
      for (const k of STATS) p.base[k] = BALANCE.level.startStat;
      p.statPoints = F.statPointsAt(L);
      p.tp = (L - 1) * BALANCE.level.tpPerLevel;
      if (p.autoStyle !== 'manual') spendBy(p.autoStyle);
      recompute();
      fullRestore();
    },

    get statPoints() {
      return P().statPoints;
    },
    /** @returns {{ mgt:number, spr:number, vit:number, swf:number }} effective values (allocation plus gear); do not mutate */
    base() {
      return eff;
    },

    /** @param {string} stat @param {number} [n=1] */
    allocate(stat, n = 1) {
      const p = P();
      const k = Math.floor(n);
      if (STATS.indexOf(stat) < 0 || !(k >= 1) || p.statPoints < k) return false;
      p.base[stat] += k;
      p.statPoints -= k;
      recompute();
      return true;
    },

    /** @param {'brawler'|'blaster'|'balanced'} style */
    autoAllocate(style) {
      if (!BALANCE.styles[style]) return;
      spendBy(style);
      recompute();
    },

    stats() {
      const e = ent();
      return e ? e.stats : derived;
    },

    resonance() {
      return res;
    },

    awaken() {
      P().awakened = true;
      recompute();
    },

    get difficulty() {
      const s = S();
      return s && s.player ? s.player.difficulty : 'warrior';
    },
    /** @param {string} id */
    setDifficulty(id) {
      if (BALANCE.difficulty[id]) P().difficulty = id;
    },

    get tp() {
      return P().tp;
    },
    /** @param {number} n */
    addTp(n) {
      P().tp = Math.max(0, P().tp + Math.round(n || 0));
    },

    /** @param {string} techId */
    hasTech(techId) {
      const s = S();
      return !!(s && s.player && s.player.techs.indexOf(techId) >= 0);
    },
    /** @param {string} techId */
    unlockTech(techId) {
      if (rpg.hasTech(techId) || !ctx.defs.find('technique', techId)) return;
      P().techs.push(techId);
      ctx.bus.emit('rpg:techLearned', { nodeId: techId, techId, rank: 1 });
    },
    /** @param {string} techId */
    rank(techId) {
      if (!rpg.hasTech(techId)) return 0;
      let r = 1;
      for (const nid of P().nodes) {
        const n = ctx.defs.find('techNode', nid);
        if (n && n.techId === techId && typeof n.rank === 'number') r = Math.max(r, n.rank);
      }
      return r;
    },
    nodes() {
      const p = P();
      return ctx.defs.all('techNode').map((n) => {
        const owned = p.nodes.indexOf(n.id) >= 0;
        const rq = n.requires || {};
        let reasonKey = null;
        if (rq.level && p.level < rq.level) reasonKey = 'core.stat.level';
        else if (rq.tech && !rpg.hasTech(rq.tech)) reasonKey = 'tech.' + rq.tech + '.name';
        else if (rq.node && p.nodes.indexOf(rq.node) < 0) reasonKey = 'core.term.tp';
        else if (p.tp < n.tp) reasonKey = 'core.term.tp';
        return { id: n.id, branch: n.branch, techId: n.techId || null, rank: n.rank || 0, tp: n.tp,
          state: owned ? 'owned' : reasonKey ? 'locked' : 'available', reasonKey: owned ? null : reasonKey };
      });
    },
    /** @param {string} nodeId */
    learn(nodeId) {
      const row = rpg.nodes().find((n) => n.id === nodeId);
      if (!row || row.state !== 'available') return false;
      const p = P();
      p.tp -= row.tp;
      p.nodes.push(nodeId);
      if (row.techId && !rpg.hasTech(row.techId)) p.techs.push(row.techId);
      ctx.bus.emit('rpg:techLearned', { nodeId, techId: row.techId, rank: row.rank || 1 });
      recompute();
      return true;
    },
    slots() {
      const p = P();
      slotsObj.slots[0] = p.slots[0];
      slotsObj.slots[1] = p.slots[1];
      slotsObj.ultimate = p.ultimate;
      return slotsObj;
    },
    /** @param {0|1|'ultimate'} index @param {string|null} techId */
    setSlot(index, techId) {
      const p = P();
      if (index !== 0 && index !== 1 && index !== 'ultimate') return false;
      if (techId) {
        const def = ctx.defs.find('technique', techId);
        if (!def || !rpg.hasTech(techId)) return false;
        if (index === 'ultimate' ? def.slot !== 'ultimate' : def.slot !== 'slot') return false;
      }
      if (index === 'ultimate') p.ultimate = techId || null;
      else {
        p.slots[index] = techId || null;
        if (techId && p.slots[1 - index] === techId) p.slots[1 - index] = null;
      }
      ctx.bus.emit('rpg:loadout', {});
      return true;
    },
    forms() {
      return P().forms;
    },
    /** @param {string} formId */
    unlockForm(formId) {
      const p = P();
      if (!ctx.defs.find('form', formId) || p.forms.indexOf(formId) >= 0) return;
      p.forms.push(formId);
      if (!p.selectedForm) p.selectedForm = formId;
      ctx.bus.emit('rpg:formUnlocked', { formId });
    },
    get selectedForm() {
      return P().selectedForm;
    },
    /** @param {string} formId */
    selectForm(formId) {
      if (P().forms.indexOf(formId) >= 0) P().selectedForm = formId;
    },
    mods() {
      return mods;
    },

    get shells() {
      return INV().shells;
    },
    /** @param {number} n @param {string} [source] */
    addShells(n, source) {
      void source;
      const k = Math.round(n || 0);
      if (!k) return;
      const inv = INV();
      inv.shells = Math.max(0, inv.shells + k);
      ctx.bus.emit('rpg:shells', { amount: k, total: inv.shells });
    },
    /** @param {number} n */
    spendShells(n) {
      const k = Math.round(n || 0);
      if (k < 0 || INV().shells < k) return false;
      rpg.addShells(-k, 'spend');
      return true;
    },

    /** @param {string} itemId @param {number} [count=1] @param {{ level?:number }} [opts] */
    addItem(itemId, count = 1, opts) {
      const def = ctx.defs.find('item', itemId);
      if (!def) return 0;
      const inv = INV();
      const n = Math.max(1, Math.floor(count || 1));
      if (def.type !== 'gear') {
        const cap = typeof def.cap === 'number' ? def.cap : BALANCE.economy.carryCap;
        let row = inv.items.find((r) => r.itemId === itemId);
        const have = row ? row.count : 0;
        const add = Math.min(n, cap - have);
        if (add <= 0) return 0;
        if (!row) {
          row = { uid: inv.nextUid++, itemId, level: 1, count: 0 };
          inv.items.push(row);
        }
        row.count += add;
        ctx.bus.emit('rpg:item', { itemId, uid: row.uid, delta: add, count: row.count });
        return row.uid;
      }
      let uid = 0;
      const level = opts && typeof opts.level === 'number' ? Math.max(1, Math.round(opts.level)) : Math.max(1, P().level);
      for (let i = 0; i < n; i++) {
        uid = inv.nextUid++;
        inv.items.push({ uid, itemId, level, count: 1 });
        ctx.bus.emit('rpg:item', { itemId, uid, delta: 1, count: 1 });
      }
      return uid;
    },
    /** @param {string} itemId @param {number} [count=1] */
    removeItem(itemId, count = 1) {
      const n = Math.max(1, Math.floor(count || 1));
      if (rpg.count(itemId) < n) return false;
      const inv = INV();
      let left = n;
      for (let i = inv.items.length - 1; i >= 0 && left > 0; i--) {
        const r = inv.items[i];
        if (r.itemId !== itemId) continue;
        const take = Math.min(left, r.count);
        r.count -= take;
        left -= take;
        if (r.count <= 0) {
          for (const s of EQUIP_SLOTS) if (inv.equip[s] === r.uid) rpg.unequip(/** @type {any} */ (s));
          inv.items.splice(i, 1);
        }
        ctx.bus.emit('rpg:item', { itemId, uid: r.uid, delta: -take, count: Math.max(0, r.count) });
      }
      return true;
    },
    /** @param {string} itemId */
    count(itemId) {
      let n = 0;
      for (const r of INV().items) if (r.itemId === itemId) n += r.count;
      return n;
    },
    items() {
      return INV().items.map((r) => ({ uid: r.uid, itemId: r.itemId, level: r.level, count: r.count, equipped: isEquipped(r.uid) }));
    },
    /** @param {number} uid */
    itemStats(uid) {
      const row = rowOf(uid);
      const def = row ? ctx.defs.find('item', row.itemId) : null;
      if (!def) return {};
      const stats = {};
      if (def.stats) for (const k of Object.keys(def.stats)) stats[k] = F.itemValue(def.stats[k], row.level);
      return { itemId: def.id, level: row.level, slot: def.slot || null, rarity: def.rarity || null, stats, mods: Object.assign({}, def.mods || {}),
        effect: def.effect ? Object.assign({}, def.effect) : null };
    },
    /** @param {number} uid */
    equip(uid) {
      const row = rowOf(uid);
      const def = row ? ctx.defs.find('item', row.itemId) : null;
      if (!def || def.type !== 'gear' || !def.slot) return false;
      const eq = INV().equip;
      let slot = def.slot;
      if (slot === 'charm') slot = eq.charm1 === null || eq.charm1 === uid ? 'charm1' : eq.charm2 === uid || eq.charm2 === null ? 'charm2' : 'charm1';
      for (const s of EQUIP_SLOTS) if (eq[s] === uid && s !== slot) eq[s] = null;
      eq[slot] = uid;
      ctx.bus.emit('rpg:equip', { slot, uid, itemId: row.itemId });
      const e = ent();
      if (e && def.palette && ctx.actors) ctx.actors.setPalette(e, def.palette);
      recompute();
      return true;
    },
    /** @param {'wraps'|'garb'|'charm1'|'charm2'} slot */
    unequip(slot) {
      const eq = INV().equip;
      if (EQUIP_SLOTS.indexOf(slot) < 0 || eq[slot] === null) return false;
      eq[slot] = null;
      ctx.bus.emit('rpg:equip', { slot, uid: null, itemId: null });
      recompute();
      return true;
    },
    equipped() {
      return INV().equip;
    },
    /** @param {string} itemId */
    useItem(itemId) {
      const def = ctx.defs.find('item', itemId);
      const e = ent();
      if (!def || def.type !== 'consumable' || !def.effect || !e || !e.alive || rpg.count(itemId) <= 0) return false;
      const fx = def.effect;
      if (fx.kind === 'heal') {
        const total = e.stats.hpMax * fx.pct * (1 + F.mod(mods, 'healPct'));
        const secs = fx.seconds || 0;
        if (secs > 0) {
          healLeft += total;
          healRate = Math.max(healRate, total / secs);
        } else {
          ctx.combat.heal(e, total);
        }
      } else if (fx.kind === 'ora') {
        ctx.combat.addOra(e, e.stats.oraMax * fx.pct);
      }
      rpg.removeItem(itemId, 1);
      ctx.bus.emit('rpg:itemUsed', { itemId });
      return true;
    },
    get quickItem() {
      return INV().quick;
    },
    cycleQuickItem() {
      const ids = ctx.defs.all('item').filter((d) => d.type === 'consumable').map((d) => d.id);
      if (!ids.length) return;
      const inv = INV();
      const i = ids.indexOf(inv.quick);
      inv.quick = ids[(i + 1) % ids.length];
    },

    /** @param {string} shopId */
    shop(shopId) {
      const s = ctx.defs.find('shop', shopId);
      if (!s) return [];
      const lvl = P().level;
      return s.stock.map((itemId, index) => {
        const def = ctx.defs.find('item', itemId);
        const gear = def && def.type === 'gear';
        const level = gear ? s.level : 1;
        const price = Math.round((gear ? F.itemPrice(def.rarity || 'common', level) : F.consumablePrice(itemId, lvl)) * (s.priceMult || 1));
        return { index, itemId, level, price, canAfford: INV().shells >= price };
      });
    },
    /** @param {string} shopId @param {number} index @param {number} [count=1] */
    buy(shopId, index, count = 1) {
      const row = rpg.shop(shopId)[index];
      if (!row) return { ok: false, reasonKey: 'core.save.failed' };
      const n = Math.max(1, Math.floor(count));
      const total = row.price * n;
      if (INV().shells < total) return { ok: false, reasonKey: 'core.term.shells' };
      const uid = rpg.addItem(row.itemId, n, { level: row.level });
      if (!uid) return { ok: false, reasonKey: 'item.' + row.itemId + '.name' };
      rpg.spendShells(total);
      return { ok: true, reasonKey: null };
    },
    /** @param {number} uid @param {number} [count=1] */
    sell(uid, count = 1) {
      const row = rowOf(uid);
      const def = row ? ctx.defs.find('item', row.itemId) : null;
      if (!def || def.type === 'quest') return { ok: false, shells: 0 };
      const n = Math.max(1, Math.min(row.count, Math.floor(count)));
      const buy = def.type === 'gear' ? F.itemPrice(def.rarity || 'common', row.level) : F.consumablePrice(def.id, P().level);
      const shells = F.sellPrice(buy) * n;
      if (def.type === 'gear') {
        for (const s of EQUIP_SLOTS) if (INV().equip[s] === uid) rpg.unequip(/** @type {any} */ (s));
        const inv = INV();
        inv.items.splice(inv.items.indexOf(row), 1);
        ctx.bus.emit('rpg:item', { itemId: def.id, uid, delta: -1, count: 0 });
      } else {
        rpg.removeItem(def.id, n);
      }
      rpg.addShells(shells, 'sell');
      return { ok: true, shells };
    },

    /** @param {string} tableId @param {number} level @param {number} x @param {number} y @param {number} z */
    dropLoot(tableId, level, x, y, z) {
      let i = 0;
      roll(tableId, level, (kind, itemId, count, lvl, rarity) => {
        spawnPickup(kind, itemId, count, lvl, rarity, x, y, z, i++);
      });
    },
    /** @param {string} tableId @param {number} level */
    giveLoot(tableId, level) {
      const out = [];
      roll(tableId, level, (kind, itemId, count, lvl) => {
        if (kind === 'shells') rpg.addShells(count, 'loot');
        else rpg.addItem(itemId, count, { level: lvl });
        out.push({ kind, itemId, count });
      });
      return out;
    },

    /** @param {string} key */
    flag(key) {
      const f = S().quests.flags;
      return f[key];
    },
    /** @param {string} key @param {any} value */
    setFlag(key, value) {
      S().quests.flags[key] = value;
    },

    /** @param {{ retry?:boolean }} [opts] */
    respawn(opts) {
      const e = ent();
      if (!e) return;
      const p = P();
      const retry = !!(opts && opts.retry && retryBoss);
      let x = p.x;
      let z = p.z;
      let ringstoneId = null;
      if (retry) {
        const bd = ctx.defs.find('boss', retryBoss);
        const lm = bd && ctx.world ? ctx.world.landmark(bd.arena.landmarkId) : null;
        if (lm) {
          x = lm.x + bd.arena.retry.dx;
          z = lm.z + bd.arena.retry.dz;
        }
        if (bossSnapshot) {
          for (const id of Object.keys(bossSnapshot)) {
            const have = rpg.count(id);
            if (have < bossSnapshot[id]) rpg.addItem(id, bossSnapshot[id] - have);
          }
        }
      } else {
        const poi = ctx.world ? ctx.world.pois('ringstone').find((q) => q.id === p.respawn) : null;
        if (poi) {
          x = poi.x;
          z = poi.z;
          ringstoneId = poi.id;
        }
      }
      const y = ctx.world ? ctx.world.heightAt(x, z) : 0;
      ctx.move.teleport(e, x, y, z, e.yaw);
      ctx.move.setMode(e, 'ground');
      ctx.combat.revive(e, 1);
      healLeft = 0;
      ctx.bus.emit('player:respawned', { ringstoneId, retry });
    },

    /** Drop private state and the save hooks. */
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      for (const e of ctx.ents.list('pickup')) if (e.data && e.data.standinPickup) ctx.ents.destroy(e.id);
      playerEnt = null;
    },
  };

  const tickSystem = {
    id: 'standin.rpg.pickups',
    phase: 'post',
    owner: OWNER,
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      const e = ent();
      if (e && healLeft > 0 && e.alive) {
        const h = Math.min(healLeft, healRate * dt);
        healLeft -= h;
        c.combat.heal(e, h);
        if (healLeft <= 1e-6) { healLeft = 0; healRate = 0; }
      }
      if (e && gathering) {
        gatherT += dt;
        if (gatherT <= BALANCE.resonance.gather.rampSeconds + dt) {
          const formId = e.combat ? e.combat.formId : null;
          const p = c.store.state.player;
          setResonance(F.resonance(eff, p.level, mods, F.formResMult(formId), F.gatherResMult(gatherT), !!p.awakened));
        }
      }
      const list = c.ents.list('pickup');
      for (let i = 0; i < list.length; i++) {
        const k = list[i];
        const d = k.data;
        if (!k.alive || !d || !d.standinPickup) continue;
        d.life -= dt;
        if (d.life <= 0) {
          c.ents.destroy(k.id);
          continue;
        }
        if (!e || !e.alive) continue;
        const dx = e.pos.x - k.pos.x;
        const dy = e.pos.y + 0.8 - k.pos.y;
        const dz = e.pos.z - k.pos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist <= COLLECT_RADIUS) {
          if (d.kind === 'shells') rpg.addShells(d.amount, 'pickup');
          else if (d.kind === 'xp') rpg.grantXp(d.amount, 'pickup');
          else if (d.itemId) rpg.addItem(d.itemId, d.amount, { level: d.level });
          c.bus.emit('pickup:collected', { kind: d.kind, itemId: d.itemId, amount: d.amount });
          c.ents.destroy(k.id);
        } else if (dist <= BALANCE.pickups.magnetRadius) {
          const s = Math.min(dist, PICKUP_SPEED * dt) / dist;
          k.pos.x += dx * s;
          k.pos.y += dy * s;
          k.pos.z += dz * s;
        }
      }
    },
  };

  const on = {
    /** Kill XP, loot and counters (4.11 Deaths). @param {any} p actor:died */
    died(p) {
      const s = S();
      if (p.kind === 'player') return;
      if (p.kind !== 'enemy' && p.kind !== 'boss') return;
      const pl = ctx.player;
      const src = p.sourceId ? ctx.ents.get(p.sourceId) : null;
      const playerSide = !!p.sourceId && ((pl && p.sourceId === pl.id) || (src !== null && src.team === 1));
      if (!playerSide) return;
      const def = ctx.defs.find('enemy', p.defId);
      if (!def) return;
      s.stats.kills++;
      const xp = F.enemyXp(def, p.level, P().level, P().difficulty);
      rpg.grantXp(xp, 'kill');
      rpg.dropLoot(def.lootTable, p.level, p.x, p.y, p.z);
    },
    playerDied() {
      const s = S();
      s.stats.deaths++;
      const loss = F.difficultyRow(P().difficulty).shellLoss;
      if (loss > 0) {
        const n = Math.floor(INV().shells * loss);
        if (n > 0) rpg.addShells(-n, 'death');
      }
    },
    recompute() {
      if (ent()) recompute();
    },
    /** @param {any} p combat:gather */
    gather(p) {
      if (!playerEnt || p.entId !== playerEnt.id) return;
      gathering = p.on;
      gatherT = 0;
      recompute();
    },
    /** @param {any} p boss:start */
    bossStart(p) {
      retryBoss = p.bossId;
      bossSnapshot = {};
      for (const d of ctx.defs.all('item')) if (d.type === 'consumable') bossSnapshot[d.id] = rpg.count(d.id);
    },
    /** @param {any} p boss:end */
    bossEnd(p) {
      if (!p.defeated) return;
      const w = S().world;
      if (w.bosses.indexOf(p.bossId) < 0) w.bosses.push(p.bossId);
      const bd = ctx.defs.find('boss', p.bossId);
      if (bd && bd.rewards && bd.rewards.shells) rpg.addShells(bd.rewards.shells, 'boss');
      retryBoss = null;
      bossSnapshot = null;
    },
    /** The tutorial=0 shortcut (4.11). */
    newGame() {
      if (ctx.flags.tutorial !== 0) return;
      const s = S();
      const p = s.player;
      const q = s.quests;
      if (q.done.indexOf('mq1') < 0) q.done.push('mq1');
      delete q.active.mq1;
      if (p.techs.indexOf('gather') < 0) p.techs.push('gather');
      p.awakened = true;
      p.canFly = true;
      p.respawn = 'ringstone_sparkstead';
      const rs = ctx.world ? ctx.world.pois('ringstone').find((r) => r.id === 'ringstone_sparkstead') : null;
      if (rs) {
        p.x = rs.x;
        p.z = rs.z;
        p.y = 0;
      }
      if (s.world.ringstones.indexOf('ringstone_sparkstead') < 0) s.world.ringstones.push('ringstone_sparkstead');
      if (!q.active.mq2 && q.done.indexOf('mq2') < 0) q.active.mq2 = { step: 0, counts: {} };
      q.tracked = 'mq2';
    },
    ended() {
      playerEnt = null;
      gathering = false;
      healLeft = 0;
      healRate = 0;
      retryBoss = null;
      bossSnapshot = null;
    },
  };

  /** Save hooks of 4.11: hp, ora and surge. */
  function hooks() {
    unsubs.push(ctx.save.onBeforeSave((state) => {
      const e = ent();
      if (!e || !state || !state.player) return;
      state.player.hp = Math.round(e.stats.hp);
      state.player.ora = Math.round(e.stats.ora);
      state.player.surge = e.combat ? Math.round(e.combat.surge) : 0;
    }));
    unsubs.push(ctx.save.onAfterLoad((state) => {
      const e = ent();
      if (!e || !state || !state.player) return;
      const st = e.stats;
      if (typeof state.player.hp === 'number' && state.player.hp > 0) st.hp = Math.min(st.hpMax, state.player.hp);
      if (typeof state.player.ora === 'number') st.ora = Math.max(0, Math.min(st.oraMax, state.player.ora));
    }));
  }

  return { rpg, tickSystem, on, hooks };
}

/**
 * Install the stand-in rpg service under the owner 'standin:rpg'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { rpg, tickSystem, on, hooks } = createRpg(ctx);
  ctx.provide('rpg', rpg, OWNER);
  ctx.systems.add(tickSystem);
  hooks();
  ctx.bus.on('actor:died', on.died, OWNER);
  ctx.bus.on('player:died', on.playerDied, OWNER);
  ctx.bus.on('combat:form', on.recompute, OWNER);
  ctx.bus.on('combat:gather', on.gather, OWNER);
  ctx.bus.on('boss:start', on.bossStart, OWNER);
  ctx.bus.on('boss:end', on.bossEnd, OWNER);
  ctx.bus.on('game:newGame', on.newGame, OWNER);
  ctx.bus.on('game:ended', on.ended, OWNER);
}
