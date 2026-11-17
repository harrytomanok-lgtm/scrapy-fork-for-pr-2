/**
 * Items, shops and loot tables (ARCHITECTURE 5.5, 5.10; GDD 10). Numbers come from BALANCE (one source of truth);
 * this file adds what the balance sheet does not hold: drop eligibility, icons and the outfit palette overrides.
 * Pure data: no three, no DOM.
 * @module rpg/data/items
 */

import { BALANCE } from '../../core/balance.js';
import { PALETTE } from '../../core/palette.js';

/** Gear that only a quest or a race gives: never in a random drop (GDD 10.5). */
const QUEST_ONLY = Object.freeze(['racers_wraps', 'lantern_mantle', 'wind_charm', 'tide_charm', 'golem_core_charm', 'frost_charm', 'wyrmhide_charm']);

/** Outfit recolours when equipped (garb recolours the coat; wraps recolour the hand wraps). Palette tokens only. */
const ITEM_PALETTE = Object.freeze({
  training_wraps: { wraps: PALETTE.paper },
  racers_wraps: { wraps: PALETTE.structure.lantern },
  bramble_wraps: { wraps: PALETTE.flora.brambleFlower },
  saltglass_wraps: { wraps: PALETTE.biome.coast.accent },
  copper_knuckles: { wraps: PALETTE.structure.copper },
  stormcaller_wraps: { wraps: PALETTE.tempest },
  apprentice_garb: { coat: PALETTE.structure.terracotta },
  meadow_garb: { coat: PALETTE.biome.meadows.shade, coatLining: PALETTE.biome.meadows.accent },
  tidewoven_garb: { coat: PALETTE.structure.curtain, coatLining: PALETTE.biome.coast.accent },
  dunewalker_garb: { coat: PALETTE.biome.rustdune.shade, coatLining: PALETTE.biome.rustdune.accent },
  frostweave_garb: { coat: PALETTE.biome.frostspine.shade, coatLining: PALETTE.snow },
  lantern_mantle: { coat: PALETTE.ink, coatLining: PALETTE.structure.lantern },
});

/** @returns {object[]} every ItemDef of IDS.item */
function buildItems() {
  const out = [];
  for (const id of Object.keys(BALANCE.gear)) {
    const g = BALANCE.gear[id];
    const d = { id, type: 'gear', slot: g.slot, rarity: g.rarity, drops: QUEST_ONLY.indexOf(id) < 0, icon: g.slot };
    if (g.stats) d.stats = Object.assign({}, g.stats);
    if (g.mods) d.mods = Object.assign({}, g.mods);
    if (ITEM_PALETTE[id]) d.palette = Object.assign({}, ITEM_PALETTE[id]);
    out.push(d);
  }
  for (const id of Object.keys(BALANCE.consumables)) {
    const c = BALANCE.consumables[id];
    out.push({ id, type: 'consumable', effect: Object.assign({}, c.effect), cap: BALANCE.economy.carryCap, basePrice: c.price.base,
      pricePerLevel: c.price.perLevel, drops: true, icon: id === 'sunfruit' ? 'fruit' : 'draught' });
  }
  out.push({ id: 'rust_core', type: 'quest', cap: 9, drops: false, icon: 'core' });
  return out;
}

export const ITEMS = buildItems();

/** GDD 10.4 shops: fixed stock; gear at the shop level. */
const STOCK = Object.freeze({
  dov_stall: ['sunfruit', 'ora_draught', 'apprentice_garb', 'meadow_garb', 'sunfruit_charm'],
  aster_market: ['sunfruit', 'ora_draught', 'bramble_wraps', 'saltglass_wraps', 'meadow_garb', 'tidewoven_garb'],
  talia_herbs: ['sunfruit', 'ora_draught'],
  yael_outpost: ['sunfruit', 'ora_draught', 'copper_knuckles', 'dunewalker_garb'],
  ridgerest_provisions: ['sunfruit', 'ora_draught', 'stormcaller_wraps', 'frostweave_garb', 'stillwind_charm'],
});

export const SHOPS = Object.keys(STOCK).map((id) => ({ id, level: BALANCE.shops[id].level, priceMult: BALANCE.shops[id].priceMult, stock: STOCK[id].slice() }));

/** GDD 10.5 drop tables, straight from BALANCE.loot. */
export const LOOT_TABLES = Object.keys(BALANCE.loot).map((id) => Object.assign({ id }, JSON.parse(JSON.stringify(BALANCE.loot[id]))));
