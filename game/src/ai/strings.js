/**
 * Bilingual strings of the ai package (ARCHITECTURE 4.14): boss phase banners and intro lines, and the names of the
 * enemy and boss techniques. Enemy and boss names live in core/strings.js.
 * @module ai/strings
 */

/** @type {Array<[string, string, string]>} [key, en, he] */
const ROWS = [
  ['boss.durn.intro', 'Durn: "The Choir takes what it is owed."', 'דורן: "המקהלה לוקחת את מה שמגיע לה."'],
  ['boss.bramblehorn.intro', 'The hollow shakes. Something huge wakes in the brambles.', 'החורשה רועדת. משהו עצום מתעורר בין הסנה.'],
  ['boss.bramblehorn.phase2', 'Bramblehorn rages: roots tear through the ground', 'קרן הסנה משתולל: שורשים קורעים את הקרקע'],
  ['boss.gorrumaw.intro', 'The pit floor cracks. The Burrow King rises.', 'קרקעית הבור נסדקת. מלך המחילות עולה.'],
  ['boss.gorrumaw.phase2', 'Gorrumaw\'s armour shatters: he goes berserk', 'השריון של גורומאו מתנפץ: הוא משתולל'],
  ['boss.iskra.intro', 'Frost on the wind. Iskra Pale-Wing descends.', 'כפור ברוח. איסקרה חיוורת הכנף יורדת.'],
  ['boss.iskra.phase2', 'A blizzard swallows the summit', 'סופת שלגים בולעת את הפסגה'],
  ['boss.vorrhal.intro', 'Vorrhal: "You carried the light this far. I will take it from here."', 'וורהאל: "נשאת את האור עד כאן. מכאן אני אקח אותו."'],
  ['boss.vorrhal.phase2', 'Vorrhal climbs the Spire and calls his Vanguard', 'וורהאל מטפס על המעיין וקורא לחלוצים שלו'],
  ['boss.vorrhal.phase3', 'Vorrhal roots himself to the Spire', 'וורהאל משתרש אל המעיין'],
  ['tech.wisp_spit.name', 'Ember Spit', 'יריקת גחלת'],
  ['tech.wisp_dive.name', 'Ember Dive', 'צלילת גחלת'],
  ['tech.boar_gore.name', 'Gore', 'נגיחה'],
  ['tech.boar_charge.name', 'Tusk Charge', 'הסתערות חט'],
  ['tech.boar_charge_red.name', 'Bramble Charge', 'הסתערות סנה'],
  ['tech.acolyte_string.name', 'Choir String', 'שרשרת המקהלה'],
  ['tech.acolyte_rush.name', 'Shoulder Rush', 'הסתערות כתף'],
  ['tech.caster_volley.name', 'Glass Volley', 'מטח זכוכית'],
  ['tech.caster_tether.name', 'Drain Tether', 'קשר שאיבה'],
  ['tech.crab_pinch.name', 'Pinch', 'צביטה'],
  ['tech.crab_slam.name', 'Shell Slam', 'חבטת שריון'],
  ['tech.golem_hammer.name', 'Hammer Fists', 'אגרופי פטיש'],
  ['tech.golem_stomp.name', 'Stomp', 'רקיעה'],
  ['tech.golem_boulder.name', 'Boulder', 'סלע מושלך'],
  ['tech.harrier_dive.name', 'Frost Dive', 'צלילת כפור'],
  ['tech.harrier_gust.name', 'Gust', 'משב'],
  ['tech.vanguard_string.name', 'Vanguard String', 'שרשרת החלוץ'],
  ['tech.vanguard_lance.name', 'Glass Lance', 'רומח זכוכית'],
  ['tech.vanguard_smash.name', 'Smash', 'ריסוק'],
  ['tech.enemy_rock.name', 'Thrown Rock', 'אבן מושלכת'],
  ['tech.durn_string.name', 'Captain\'s String', 'שרשרת הקפטן'],
  ['tech.durn_charge.name', 'Shoulder Charge', 'הסתערות כתף'],
  ['tech.bh_horn_charge.name', 'Horn Charge', 'הסתערות קרניים'],
  ['tech.bh_antler_sweep.name', 'Antler Sweep', 'סחיפת קרניים'],
  ['tech.bh_root_lines.name', 'Root Lines', 'קווי שורשים'],
  ['tech.bh_wall_leap.name', 'Wall Leap', 'זינוק מהקיר'],
  ['tech.gm_roll.name', 'Armoured Roll', 'גלגול משוריין'],
  ['tech.gm_quake.name', 'Quake Slam', 'חבטת רעידה'],
  ['tech.gm_berserk.name', 'Berserk', 'השתוללות'],
  ['tech.gm_rock_rain.name', 'Rock Rain', 'גשם סלעים'],
  ['tech.ik_blade_string.name', 'Ice Blades', 'להבי קרח'],
  ['tech.ik_flicker_slash.name', 'Flicker Slash', 'חיתוך הבהוב'],
  ['tech.ik_ice_spears.name', 'Ice Spears', 'חניתות קרח'],
  ['tech.ik_shatterdive.name', 'Shatterdive', 'צלילת ניפוץ'],
  ['tech.vh_tether.name', 'Dimming Tether', 'קשר העמעום'],
  ['tech.vh_void_bolts.name', 'Void-Glass Bolts', 'קליעי זכוכית ריק'],
  ['tech.vh_glass_strike.name', 'Glass Strike', 'מכת זכוכית'],
  ['tech.vh_spire_crystals.name', 'Spire Crystals', 'גבישי המעיין'],
];

/** @type {{ he:Record<string, string>, en:Record<string, string> }} */
export const AI_STRINGS = { he: {}, en: {} };
for (const [k, en, he] of ROWS) {
  AI_STRINGS.en[k] = en;
  AI_STRINGS.he[k] = he;
}
