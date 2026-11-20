/**
 * The `ctx.rpg` service (ARCHITECTURE 4.11): a thin wrapper of the pure logic in ./logic around `ctx.store`.
 * Owns the player's ActorStats except hp and ora, Resonance (with the Gather ramp), items, shops, loot pickups,
 * flags, respawn with the boss-retry refund, kill XP, the tutorial=0 shortcut and the hp / ora / surge save hooks.
 * System `rpg.pickups` (post): pickups, heal over time, the Gather Resonance ramp.
 * @module rpg/rpgService
 */

import { BALANCE } from '../core/balance.js';
import * as F from '../core/formulas.js';
import { TAG } from '../core/ents.js';
import * as P from './logic/progression.js';
import * as I from './logic/inventory.js';
import { gearPool, rollLoot } from './logic/loot.js';

const PICKUP_LIFE = 120;
const PICKUP_SPEED = 16;
const COLLECT_RADIUS = 1.4;
/** XP multiplier of a camp elite. */
const ELITE_XP = 3;
/**
 * Flying pickups up: in flight the magnet reaches further and pulls faster than the flight speed, and the pickup is
 * taken within a wider radius, so a pass at speed collects what it brushes (Ora shards in the air, drops in a fight).
 */
const FLY_MAGNET = 14;
const FLY_PICKUP_SPEED = 70;
const FLY_COLLECT_RADIUS = 3.5;

/**
 * @param {any} ctx
 */
export function createRpg(ctx) {
  /** The player entity bound by attachPlayer (held by id; entity objects are pooled). */
  let playerId = 0;
  /** Effective stats (allocation plus gear) and the aggregated mods: stable objects, refilled on recompute. */
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
  /** @type {any} */
  let pool = null;
  const lootOut = [];
  const unsubs = [];
  const pRes = { value: 0, prev: 0, milestone: null };
  const pStats = {};
  const pXp = { amount: 0, total: 0, source: '' };
  const pShells = { amount: 0, total: 0 };
  const look = {
    item: (id) => ctx.defs.find('item', id),
    node: (id) => ctx.defs.find('techNode', id),
  };

  const S = () => ctx.store.state;
  /** @type {null|{ available:boolean, run:()=>boolean, clear:()=>void }} */
  let trialRetry = null;
  const PL = () => ctx.store.state.player;
  const INV = () => ctx.store.state.inv;
  const ent = () => {
    if (!playerId) return null;
    const e = ctx.ents.get(playerId);
    return e && e.alive && e.stats ? e : null;
  };
  const anyEnt = () => (playerId ? ctx.ents.get(playerId) : null);

  function gear() {
    if (!pool) pool = gearPool(ctx.defs.all('item'));
    return pool;
  }

  /** Recompute effective base, mods, derived stats and Resonance; emits rpg:stats (and rpg:resonance on change). */
  function recompute() {
    const p = PL();
    const inv = INV();
    const e = anyEnt();
    const formId = e && e.combat ? e.combat.formId : null;
    const form = formId ? ctx.defs.find('form', formId) : null;
    P.effectiveBase(p, inv, look, eff);
    P.collectMods(p, inv, look, form, mods);
    derived = F.derivePlayerStats(eff, p.level, mods, form, { awakened: !!p.awakened, gatherMult: gathering ? F.gatherResMult(gatherT) : 1 });
    if (e && e.stats) {
      const st = e.stats;
      for (const k in derived) if (k !== 'hp' && k !== 'ora') st[k] = derived[k];
      e.level = p.level;
      if (e.combat) {
        ctx.combat.heal(e, 0);
        ctx.combat.addOra(e, 0);
      }
    }
    setResonance(derived.resonance);
    ctx.bus.emit('rpg:stats', pStats);
  }

  /** @param {number} v */
  function setResonance(v) {
    if (v === res) return;
    const prev = res;
    res = v;
    const e = anyEnt();
    if (e && e.stats) e.stats.resonance = v;
    pRes.value = v; pRes.prev = prev; pRes.milestone = prev > 0 ? F.resonanceMilestone(prev, v) : null;
    ctx.bus.emit('rpg:resonance', pRes);
  }

  function fullRestore() {
    const e = ent();
    if (!e || !e.combat) return;
    ctx.combat.heal(e, e.stats.hpMax);
    ctx.combat.addOra(e, e.stats.oraMax);
  }

  /** @param {string} kind @param {string|null} itemId @param {number} amount @param {number} level @param {string|null} rarity */
  function spawnPickup(kind, itemId, amount, level, rarity, x, y, z, i) {
    if (amount <= 0) return;
    const e = ctx.ents.create('pickup');
    if (!e) return;
    const a = i * 2.39996;
    const px = x + Math.sin(a) * 0.9;
    const pz = z + Math.cos(a) * 0.9;
    const g = ctx.world ? ctx.world.heightAt(px, pz) : y;
    e.team = 0;
    e.defId = itemId || kind;
    e.radius = 0.3;
    e.height = 0.6;
    e.pos.set(px, Math.max(g, y) + 0.5, pz);
    e.prev.copy(e.pos);
    e.data = { rpgPickup: true, kind, itemId, amount, level, rarity, life: PICKUP_LIFE };
    ctx.bus.emit('pickup:spawned', { entId: e.id, kind, itemId, rarity });
  }

  /** @param {number} uid */
  const rowOf = (uid) => P.rowOf(INV(), uid);

  const rpg = {
    /** @param {any} e the player entity */
    attachPlayer(e) {
      if (!e) return;
      playerId = e.id;
      const p = PL();
      e.level = p.level;
      e.nameKey = 'core.player.name';
      gathering = false;
      gatherT = 0;
      healLeft = 0;
      res = 0;
      pool = null;
      e.stats = null;
      recompute();
      const st = Object.assign({}, derived);
      st.hp = Math.max(1, Math.min(st.hpMax, typeof p.hp === 'number' && p.hp > 0 ? p.hp : st.hpMax));
      st.ora = Math.max(0, Math.min(st.oraMax, typeof p.ora === 'number' ? p.ora : st.oraMax));
      e.stats = st;
    },

    get level() {
      return PL().level;
    },
    /**
     * Addition to 4.11: true while the player is within BALANCE.siphon.zoneRadius (80 m) of a standing Siphon.
     * Combat halves passive Ora regen there (GDD 8.3). Updated 4 times per second by `rpg.pickups`.
     */
    get inSiphonZone() {
      return siphonZone;
    },
    get xp() {
      return PL().xp;
    },
    xpToNext() {
      return F.xpToNext(PL().level);
    },

    /** @param {number} amount @param {string} [source='debug'] */
    grantXp(amount, source = 'debug') {
      const p = PL();
      const n = Math.max(0, Math.round(amount || 0));
      if (n <= 0 || p.level >= BALANCE.level.cap) return;
      pXp.amount = n; pXp.total = p.xp + n; pXp.source = source;
      ctx.bus.emit('rpg:xp', pXp);
      P.addXp(p, n, onLevel);
    },

    /** @param {number} level */
    setLevel(level) {
      P.setLevel(PL(), level, look.node);
      recompute();
      fullRestore();
    },

    get statPoints() {
      return PL().statPoints;
    },
    /** Effective stats (allocation plus gear); the allocation alone is store.player.base. Do not mutate. */
    base() {
      return eff;
    },

    /** @param {string} stat @param {number} [n=1] */
    allocate(stat, n = 1) {
      if (!P.allocate(PL(), stat, n)) return false;
      recompute();
      return true;
    },

    /** Spend the banked points by a style (the level-up style itself is store.player.autoStyle). @param {string} style */
    autoAllocate(style) {
      if (!BALANCE.styles[style]) return;
      if (P.spendBy(PL(), style) > 0) recompute();
    },

    /** Set the level-up allocation style ('manual' banks points). @param {string} style */
    setStyle(style) {
      if (P.STYLES.indexOf(style) < 0) return;
      PL().autoStyle = style;
      if (style !== 'manual') rpg.autoAllocate(style);
    },

    stats() {
      const e = ent();
      return e ? e.stats : derived;
    },
    resonance() {
      return res;
    },

    awaken() {
      if (PL().awakened) return;
      PL().awakened = true;
      recompute();
    },

    get difficulty() {
      const s = S();
      return s && s.player ? s.player.difficulty : 'warrior';
    },
    /** @param {string} id */
    setDifficulty(id) {
      if (BALANCE.difficulty[id]) PL().difficulty = id;
    },

    get tp() {
      return PL().tp;
    },
    /** @param {number} n */
    addTp(n) {
      PL().tp = Math.max(0, PL().tp + Math.round(n || 0));
    },

    /** @param {string} techId */
    hasTech(techId) {
      const s = S();
      return !!(s && s.player && s.player.techs.indexOf(techId) >= 0);
    },
    /** @param {string} techId */
    unlockTech(techId) {
      if (rpg.hasTech(techId) || !ctx.defs.find('technique', techId)) return;
      PL().techs.push(techId);
      ctx.bus.emit('rpg:techLearned', { nodeId: techId, techId, rank: 1 });
    },
    /** @param {string} techId */
    rank(techId) {
      return P.techRank(PL(), techId, look.node);
    },
    nodes() {
      return P.nodeRows(PL(), ctx.defs.all('techNode'));
    },
    /** @param {string} nodeId */
    learn(nodeId) {
      const n = ctx.defs.find('techNode', nodeId);
      if (!P.learnNode(PL(), n)) return false;
      ctx.bus.emit('rpg:techLearned', { nodeId, techId: n.techId || null, rank: n.rank || 1 });
      recompute();
      return true;
    },
    slots() {
      const p = PL();
      slotsObj.slots[0] = p.slots[0];
      slotsObj.slots[1] = p.slots[1];
      slotsObj.ultimate = p.ultimate;
      return slotsObj;
    },
    /** @param {0|1|'ultimate'} index @param {string|null} techId */
    setSlot(index, techId) {
      if (!P.setSlot(PL(), index, techId, techId ? ctx.defs.find('technique', techId) : null)) return false;
      ctx.bus.emit('rpg:loadout', {});
      return true;
    },
    forms() {
      return PL().forms;
    },
    /** @param {string} formId */
    unlockForm(formId) {
      const p = PL();
      if (!ctx.defs.find('form', formId) || p.forms.indexOf(formId) >= 0) return;
      p.forms.push(formId);
      if (!p.selectedForm) p.selectedForm = formId;
      ctx.bus.emit('rpg:formUnlocked', { formId });
    },
    get selectedForm() {
      return PL().selectedForm;
    },
    /** @param {string} formId */
    selectForm(formId) {
      if (PL().forms.indexOf(formId) >= 0) PL().selectedForm = formId;
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
      const before = inv.shells;
      inv.shells = Math.max(0, inv.shells + k);
      pShells.amount = inv.shells - before; pShells.total = inv.shells;
      if (pShells.amount) ctx.bus.emit('rpg:shells', pShells);
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
      const level = opts && typeof opts.level === 'number' ? opts.level : PL().level;
      const r = I.addItem(INV(), def, count, level);
      if (!r.added) return 0;
      const row = rowOf(r.uid);
      ctx.bus.emit('rpg:item', { itemId, uid: r.uid, delta: r.added, count: def.type === 'gear' ? 1 : row ? row.count : r.added });
      return r.uid;
    },
    /** @param {string} itemId @param {number} [count=1] */
    removeItem(itemId, count = 1) {
      const inv = INV();
      const equippedBefore = inv.equip.wraps !== null || inv.equip.garb !== null || inv.equip.charm1 !== null || inv.equip.charm2 !== null;
      const ok = I.removeItem(inv, itemId, count, (row, taken) => {
        ctx.bus.emit('rpg:item', { itemId, uid: row.uid, delta: -taken, count: Math.max(0, row.count) });
      });
      if (ok && equippedBefore) recompute();
      return ok;
    },
    /** @param {string} itemId */
    count(itemId) {
      return I.countOf(INV(), itemId);
    },
    items() {
      const inv = INV();
      return inv.items.map((r) => ({ uid: r.uid, itemId: r.itemId, level: r.level, count: r.count, equipped: I.slotOf(inv, r.uid) !== null }));
    },
    /** @param {number} uid */
    itemStats(uid) {
      const row = rowOf(uid);
      const def = row ? ctx.defs.find('item', row.itemId) : null;
      return def ? I.itemStats(def, row) : {};
    },
    /** @param {number} uid */
    equip(uid) {
      const row = rowOf(uid);
      const def = row ? ctx.defs.find('item', row.itemId) : null;
      const slot = I.equip(INV(), uid, def);
      if (!slot) return false;
      ctx.bus.emit('rpg:equip', { slot, uid, itemId: row.itemId });
      const e = ent();
      if (e && def.palette && ctx.actors) ctx.actors.setPalette(e, def.palette);
      recompute();
      return true;
    },
    /** @param {'wraps'|'garb'|'charm1'|'charm2'} slot */
    unequip(slot) {
      if (!I.unequip(INV(), slot)) return false;
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
      if (!def || def.type !== 'consumable' || !def.effect || !e || !e.combat || e.combat.state === 'dead' || rpg.count(itemId) <= 0) return false;
      const fx = def.effect;
      if (fx.kind === 'heal') {
        if (e.stats.hp >= e.stats.hpMax && healLeft <= 0) return false;
        const total = e.stats.hpMax * fx.pct * (1 + F.mod(mods, 'healPct'));
        const secs = fx.seconds || 0;
        if (secs > 0) {
          healLeft += total;
          healRate = Math.max(healRate, total / secs);
        } else ctx.combat.heal(e, total);
      } else if (fx.kind === 'ora') {
        if (e.stats.ora >= e.stats.oraMax) return false;
        ctx.combat.addOra(e, e.stats.oraMax * fx.pct);
      }
      rpg.removeItem(itemId, 1);
      ctx.bus.emit('rpg:itemUsed', { itemId });
      return true;
    },
    get quickItem() {
      return INV().quick;
    },
    /** Cycle to the next consumable the player holds (or the next consumable at all when the bag is empty). */
    cycleQuickItem() {
      const ids = [];
      for (const d of ctx.defs.all('item')) if (d.type === 'consumable') ids.push(d.id);
      if (!ids.length) return;
      const inv = INV();
      const i = ids.indexOf(inv.quick);
      for (let k = 1; k <= ids.length; k++) {
        const id = ids[(i + k) % ids.length];
        if (I.countOf(inv, id) > 0 || k === ids.length) {
          inv.quick = id;
          return;
        }
      }
    },

    /** @param {string} shopId */
    shop(shopId) {
      const s = ctx.defs.find('shop', shopId);
      return s ? I.shopRows(s, look.item, PL().level, INV().shells) : [];
    },
    /** @param {string} shopId @param {number} index @param {number} [count=1] */
    buy(shopId, index, count = 1) {
      const s = ctx.defs.find('shop', shopId);
      const rows = s ? I.shopRows(s, look.item, PL().level, INV().shells) : [];
      let row = null;
      for (const r of rows) if (r.index === index) row = r;
      if (!row) return { ok: false, reasonKey: 'rpg.shop.unknown' };
      const def = ctx.defs.find('item', row.itemId);
      const n = Math.max(1, Math.floor(count || 1));
      if (def.type !== 'gear' && I.countOf(INV(), def.id) + n > I.capOf(def)) return { ok: false, reasonKey: 'rpg.shop.full' };
      const total = row.price * n;
      if (INV().shells < total) return { ok: false, reasonKey: 'rpg.shop.poor' };
      const uid = rpg.addItem(row.itemId, n, { level: row.level });
      if (!uid) return { ok: false, reasonKey: 'rpg.shop.full' };
      rpg.spendShells(total);
      return { ok: true, reasonKey: null };
    },
    /** @param {number} uid @param {number} [count=1] */
    sell(uid, count = 1) {
      const inv = INV();
      const row = rowOf(uid);
      const def = row ? ctx.defs.find('item', row.itemId) : null;
      if (!def || def.type === 'quest') return { ok: false, shells: 0 };
      const n = Math.max(1, Math.min(row.count, Math.floor(count || 1)));
      const shells = I.sellValue(def, row, PL().level, n);
      if (def.type === 'gear') {
        const s = I.slotOf(inv, uid);
        if (s) rpg.unequip(/** @type {any} */ (s));
        inv.items.splice(inv.items.indexOf(row), 1);
        ctx.bus.emit('rpg:item', { itemId: def.id, uid, delta: -1, count: 0 });
      } else rpg.removeItem(def.id, n);
      rpg.addShells(shells, 'sell');
      return { ok: true, shells };
    },

    /** @param {string} tableId @param {number} level @param {number} x @param {number} y @param {number} z */
    dropLoot(tableId, level, x, y, z) {
      dropFrom(tableId, level, x, y, z, null, 1);
    },
    /**
     * Roll a loot table into the bag. Rows report what was really added (`count`); stackables over the carry cap
     * are sold at once at the sell price (`soldCount`, `soldShells`), and quest items over the cap wait as a pickup
     * at the player (`dropped`).
     * @param {string} tableId @param {number} level
     */
    giveLoot(tableId, level) {
      const t = ctx.defs.find('lootTable', tableId);
      rollLoot(t, level, ctx.rng.sim, gear(), { difficulty: PL().difficulty }, lootOut);
      const out = [];
      for (const r of lootOut) {
        if (r.kind === 'shells') {
          rpg.addShells(r.count, 'loot');
          out.push({ kind: r.kind, itemId: r.itemId, count: r.count, soldCount: 0, soldShells: 0, dropped: 0 });
          continue;
        }
        const g = rpg.grantItem(r.itemId, r.count, { level: r.level });
        out.push({ kind: r.kind, itemId: r.itemId, count: g.added, soldCount: g.soldCount, soldShells: g.soldShells, dropped: g.dropped });
      }
      return out;
    },

    /**
     * Give items without losing any: what the bag cannot hold is sold at once at the sell price (Shells), except
     * quest items, which wait as a pickup at the player until there is room.
     * @param {string} itemId @param {number} [count=1] @param {{ level?:number }} [opts]
     * @returns {{ added:number, soldCount:number, soldShells:number, dropped:number }}
     */
    grantItem(itemId, count = 1, opts) {
      const res = { added: 0, soldCount: 0, soldShells: 0, dropped: 0 };
      const def = ctx.defs.find('item', itemId);
      if (!def) return res;
      const n = Math.max(1, Math.floor(count || 1));
      const level = opts && typeof opts.level === 'number' ? opts.level : PL().level;
      const before = def.type === 'gear' ? 0 : I.countOf(INV(), itemId);
      const uid = rpg.addItem(itemId, n, opts);
      res.added = def.type === 'gear' ? (uid ? n : 0) : Math.max(0, I.countOf(INV(), itemId) - before);
      const over = n - res.added;
      if (over <= 0) return res;
      if (def.type === 'quest') {
        const e = ent();
        if (e) spawnPickup('item', itemId, over, level, null, e.pos.x, e.pos.y, e.pos.z, 0);
        res.dropped = over;
        return res;
      }
      res.soldCount = over;
      res.soldShells = I.sellValue(def, { level }, PL().level, over);
      if (res.soldShells > 0) rpg.addShells(res.soldShells, 'sell');
      return res;
    },

    /**
     * The toasts of a grantItem result: what was added, and what was sold or left on the ground.
     * @param {string} itemId @param {{ added:number, soldCount:number, soldShells:number, dropped:number }} g
     */
    toastGrant(itemId, g) {
      const item = ctx.i18n.t('item.' + itemId + '.name');
      if (g.added > 0) {
        ctx.bus.emit('ui:toast', g.added === 1 ? { key: 'rpg.toast.itemOne', args: { item }, kind: 'good' }
          : { key: 'rpg.toast.item', args: { item, count: g.added }, kind: 'good' });
      }
      if (g.soldCount > 0) {
        ctx.bus.emit('ui:toast', g.soldCount === 1 ? { key: 'rpg.toast.bagFullOne', args: { item, n: g.soldShells }, kind: 'info' }
          : { key: 'rpg.toast.bagFull', args: { item, count: g.soldCount, n: g.soldShells }, kind: 'info' });
      }
      if (g.dropped > 0) ctx.bus.emit('ui:toast', { key: 'rpg.toast.bagFullDrop', args: { item }, kind: 'warn' });
    },

    /** @param {string} key */
    flag(key) {
      return S().quests.flags[key];
    },
    /** @param {string} key @param {any} value */
    setFlag(key, value) {
      S().quests.flags[key] = value;
    },

    /** @param {{ retry?:boolean }} [opts] */
    respawn(opts) {
      const e = anyEnt();
      if (!e || !e.stats) return;
      const p = PL();
      const retry = !!(opts && opts.retry && retryBoss);
      // A trial fight lost: its Retry runs it again (the trial puts the player back on the Ledge).
      const retryTrial = !!(opts && opts.retry && !retryBoss && trialRetry && trialRetry.available);
      if (!retryTrial && trialRetry) trialRetry.clear();
      let x = p.x;
      let z = p.z;
      let yaw = e.yaw;
      let ringstoneId = null;
      if (retry) {
        const bd = ctx.defs.find('boss', retryBoss);
        const lm = bd && ctx.world ? ctx.world.landmark(bd.arena.landmarkId) : null;
        if (lm) {
          x = lm.x + (bd.arena.retry ? bd.arena.retry.dx : 0);
          z = lm.z + (bd.arena.retry ? bd.arena.retry.dz : bd.arena.radius * 0.8);
          yaw = Math.atan2(lm.x - x, lm.z - z);
        }
        if (bossSnapshot) {
          for (const id of Object.keys(bossSnapshot)) {
            const have = rpg.count(id);
            if (have < bossSnapshot[id]) rpg.addItem(id, bossSnapshot[id] - have);
          }
        }
      } else {
        const poi = findRingstone(p.respawn);
        if (poi) {
          x = poi.x;
          z = poi.z;
          ringstoneId = poi.id;
        }
      }
      const y = ctx.world ? ctx.world.heightAt(x, z) : 0;
      ctx.move.teleport(e, x, y, z, yaw);
      ctx.move.setMode(e, 'ground');
      ctx.combat.revive(e, 1);
      healLeft = 0;
      ctx.bus.emit('player:respawned', { ringstoneId, retry: retry || retryTrial });
      if (retryTrial) trialRetry.run();
    },

    /** True when the death screen's Retry has a fight to put the player back into (a boss, or a trial fight). */
    get canRetry() {
      return !!retryBoss || !!(trialRetry && trialRetry.available);
    },

    /** Drop private state, pickups and the save hooks. */
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      for (const k of ctx.ents.list('pickup')) if (k.data && k.data.rpgPickup) ctx.ents.destroy(k.id);
      playerId = 0;
    },
  };

  /** @param {string} id */
  function findRingstone(id) {
    const list = ctx.world ? ctx.world.pois('ringstone') : [];
    for (const r of list) if (r.id === id) return r;
    return null;
  }

  /** @param {any} p store.player after a level was applied */
  function onLevel(p) {
    levelTechs(p, true);
    recompute();
    fullRestore();
    ctx.bus.emit('rpg:levelUp', { level: p.level, statPoints: p.statPoints, tp: p.tp });
  }

  /** Roll and spawn pickups. @param {any} source enemy def (shell mult) or null @param {number} bossIndex */
  function dropFrom(tableId, level, x, y, z, source, bossIndex) {
    const t = ctx.defs.find('lootTable', tableId);
    rollLoot(t, level, ctx.rng.sim, gear(), { difficulty: PL().difficulty, source, bossIndex }, lootOut);
    for (let i = 0; i < lootOut.length; i++) {
      const r = lootOut[i];
      spawnPickup(r.kind, r.itemId, r.count, r.level, r.rarity, x, y, z, i);
    }
  }

  let siphonZone = false;
  let zoneTick = 0;
  /** Is the player within the zone radius of a Siphon that is not silenced? @param {any} c @param {any} e */
  function checkSiphonZone(c, e) {
    const w = c.world;
    if (!e || !w || !w.pois) return false;
    const done = c.store.state.world.siphons;
    const r2 = BALANCE.siphon.zoneRadius * BALANCE.siphon.zoneRadius;
    const list = w.pois('siphon');
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const dx = s.x - e.pos.x;
      const dz = s.z - e.pos.z;
      if (dx * dx + dz * dz < r2 && done.indexOf(s.id) < 0) return true;
    }
    return false;
  }

  const tickSystem = {
    id: 'rpg.pickups',
    phase: 'post',
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      const e = ent();
      if (++zoneTick >= 15) {
        zoneTick = 0;
        siphonZone = checkSiphonZone(c, e);
      }
      if (e && healLeft > 0 && e.combat && e.combat.state !== 'dead') {
        const h = Math.min(healLeft, healRate * dt);
        healLeft -= h;
        c.combat.heal(e, h);
        if (healLeft <= 1e-6) { healLeft = 0; healRate = 0; }
      }
      if (e && gathering) {
        const before = gatherT;
        gatherT += dt;
        if (before <= BALANCE.resonance.gather.rampSeconds) {
          const formId = e.combat ? e.combat.formId : null;
          const p = c.store.state.player;
          setResonance(F.resonance(eff, p.level, mods, F.formResMult(formId), F.gatherResMult(gatherT), !!p.awakened));
        }
      }
      const list = c.ents.list('pickup');
      const flying = !!(e && e.move && e.move.mode === 'fly');
      const magnet = flying ? FLY_MAGNET : BALANCE.pickups.magnetRadius;
      const reach = flying ? FLY_COLLECT_RADIUS : COLLECT_RADIUS;
      const pull = flying ? FLY_PICKUP_SPEED : PICKUP_SPEED;
      for (let i = 0; i < list.length; i++) {
        const k = list[i];
        const d = k.data;
        if (!k.alive || !d || !d.rpgPickup) continue;
        d.life -= dt;
        if (d.life <= 0) {
          c.ents.destroy(k.id);
          continue;
        }
        if (!e) continue;
        const dx = e.pos.x - k.pos.x;
        const dy = e.pos.y + 0.8 - k.pos.y;
        const dz = e.pos.z - k.pos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist <= reach) {
          if (d.kind === 'shells') rpg.addShells(d.amount, 'pickup');
          else if (d.kind === 'xp') rpg.grantXp(d.amount, 'pickup');
          else if (d.itemId && !rpg.addItem(d.itemId, d.amount, { level: d.level })) continue;
          c.bus.post('pickup:collected', { kind: d.kind, itemId: d.itemId, amount: d.amount });
          c.ents.destroy(k.id);
        } else if (dist <= magnet) {
          const s = Math.min(dist, pull * dt) / dist;
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
      if (p.kind !== 'enemy' && p.kind !== 'boss') return;
      if (!isPlayerSide(p.sourceId)) return;
      const def = ctx.defs.find('enemy', p.defId);
      if (!def) return;
      S().stats.kills++;
      const pl = PL();
      let xp = F.enemyXp(def, p.level, pl.level, pl.difficulty);
      // Bosses use xpMult 6 (GDD 4.1); applied here unless the boss's enemy def already carries it.
      const ownMult = def.mult && typeof def.mult.xp === 'number' ? def.mult.xp : 1;
      if ((p.kind === 'boss' || def.tier === 'boss') && ownMult < BALANCE.bossRules.xpMult) xp = Math.round(xp * BALANCE.bossRules.xpMult / ownMult);
      // A camp elite (ai tags it ELITE) pays more and drops from the elite table.
      const ent = ctx.ents.get(p.entId);
      const elite = p.kind === 'enemy' && def.tier !== 'elite' && !!ent && (ent.tags & TAG.ELITE) !== 0;
      if (elite) xp *= ELITE_XP;
      rpg.grantXp(xp, 'kill');
      const bd = p.kind === 'boss' ? ctx.defs.find('boss', p.defId) : null;
      const bi = bd && BALANCE.bosses[bd.id] ? BALANCE.bosses[bd.id].index : 1;
      dropFrom(elite && ctx.defs.find('lootTable', 'elite') ? 'elite' : def.lootTable, p.level, p.x, p.y, p.z, def, bi);
    },
    playerDied() {
      S().stats.deaths++;
      const loss = F.difficultyRow(PL().difficulty).shellLoss;
      if (loss > 0) {
        const n = Math.floor(INV().shells * loss);
        if (n > 0) rpg.addShells(-n, 'death');
      }
    },
    recompute() {
      if (anyEnt()) recompute();
    },
    /** @param {any} p combat:gather */
    gather(p) {
      if (!playerId || p.entId !== playerId) return;
      gathering = !!p.on;
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
      retryBoss = null;
      bossSnapshot = null;
    },
    /** The tutorial=0 shortcut (4.11). */
    newGame() {
      if (ctx.flags.tutorial !== 0) {
        // A returning player (a journey in any slot, restored from a code or played here, got past MQ1) is offered
        // to skip the training when it starts (rpg/scripts tut_move).
        if (returningPlayer()) S().quests.flags['tut.skipOffer'] = true;
        return;
      }
      const s = S();
      const p = s.player;
      const q = s.quests;
      if (q.done.indexOf('mq1') < 0) q.done.push('mq1');
      delete q.active.mq1;
      if (p.techs.indexOf('gather') < 0) p.techs.push('gather');
      p.awakened = true;
      p.canFly = true;
      p.respawn = 'ringstone_sparkstead';
      const rs = findRingstone('ringstone_sparkstead');
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
      playerId = 0;
      gathering = false;
      healLeft = 0;
      healRate = 0;
      retryBoss = null;
      bossSnapshot = null;
    },
  };

  /**
   * Techniques that open at a level and cost no TP (Meteor Heel at level 4: rank 1 has no tree node, so nothing else
   * ever granted it). Learned on the level-up, with the usual techLearned event; `announce` false after a load.
   * @param {any} p store.player @param {boolean} announce
   */
  function levelTechs(p, announce) {
    for (const d of ctx.defs.all('technique')) {
      const lv = d.unlock && typeof d.unlock.level === 'number' ? d.unlock.level : 0;
      if (!lv || p.level < lv || p.techs.indexOf(d.id) >= 0 || ctx.defs.find('techNode', d.id + '_r1')) continue;
      if (announce) {
        rpg.unlockTech(d.id);
        ctx.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.banner.newTech', args: { name: ctx.i18n.t('tech.' + d.id + '.name') } });
      }
      else p.techs.push(d.id);
    }
  }

  /** True when a saved journey in any slot has finished MQ1. Read before the new journey is first saved. */
  function returningPlayer() {
    try {
      for (let n = 1; n <= 3; n++) {
        const st = ctx.save.load(n);
        if (st && st.quests && Array.isArray(st.quests.done) && st.quests.done.indexOf('mq1') >= 0) return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  /** @param {number} sourceId */
  function isPlayerSide(sourceId) {
    if (!sourceId) return false;
    if (sourceId === playerId) return true;
    const src = ctx.ents.get(sourceId);
    return !!src && src.team === 1;
  }

  /** Save hooks of 4.11: hp, ora and surge. */
  function hooks() {
    unsubs.push(ctx.save.onBeforeSave((state) => {
      const e = anyEnt();
      if (!e || !e.stats || !state || !state.player) return;
      state.player.hp = Math.round(e.stats.hp);
      state.player.ora = Math.round(e.stats.ora);
      state.player.surge = e.combat ? Math.round(e.combat.surge) : 0;
    }));
    unsubs.push(ctx.save.onAfterLoad((state) => {
      if (state && state.player && Array.isArray(state.player.techs)) levelTechs(state.player, false);
      const e = anyEnt();
      if (!e || !e.stats || !state || !state.player) return;
      const st = e.stats;
      if (typeof state.player.hp === 'number' && state.player.hp > 0) st.hp = Math.min(st.hpMax, state.player.hp);
      if (typeof state.player.ora === 'number') st.ora = Math.max(0, Math.min(st.oraMax, state.player.ora));
    }));
  }

  /** @param {{ available:boolean, run:()=>boolean, clear:()=>void }} r the challenge trials' retry */
  function setTrialRetry(r) {
    trialRetry = r || null;
  }

  return { rpg, tickSystem, on, hooks, isPlayerSide, setTrialRetry };
}
