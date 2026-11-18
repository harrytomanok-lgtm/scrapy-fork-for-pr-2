/**
 * Bilingual strings of the combat package (ARCHITECTURE 4.14): technique and Form descriptions, technique-tree
 * node names and the combat callouts. Technique and Form names live in core/strings.js. Hebrew UI verbs are
 * infinitives (ART_UX 7.1).
 * @module combat/strings
 */

/** @type {Array<[string, string, string]>} [key, en, he] */
const ROWS = [
  ['tech.strike_string.desc', 'A rapid string of strikes. The first lunges to your target; from the second hit you can cancel into any technique.', 'שרשרת מכות מהירה. המכה הראשונה מזנקת אל המטרה; מהמכה השנייה אפשר לעבור לכל טכניקה.'],
  ['tech.breaker.desc', 'Hold Attack: launch a grounded enemy into the sky. After three string hits it smashes them away instead.', 'החזקת התקפה מעיפה אויב מהקרקע אל השמיים. אחרי שלוש מכות בשרשרת היא הודפת אותו הצידה.'],
  ['tech.meteor_heel.desc', 'Breaker in the air: drive the enemy into the ground hard enough to leave a crater.', 'שובר באוויר: ריסוק האויב אל הקרקע בעוצמה שמשאירה מכתש.'],
  ['tech.pursuit.desc', 'Dash right after a launch or a smash to appear beside the flying enemy. Your next hit is stronger.', 'זינוק מיד אחרי העפה או הדיפה מביא אותך אל צד האויב המעופף. המכה הבאה חזקה יותר.'],
  ['tech.ora_bolt.desc', 'A fast bolt of Ora. Hold to keep firing. Full damage up to 30 m.', 'קליע אורה מהיר. החזקה יורה ברצף. נזק מלא עד 30 מטר.'],
  ['tech.flare_barrage.desc', 'A storm of homing bolts for two and a half seconds. Each bolt costs Ora.', 'סערת קליעים מתבייתים למשך שתי שניות וחצי. כל קליע עולה אורה.'],
  ['tech.dawn_lance.desc', 'Hold to charge a beam of light through a ring in your palm. A full charge deals two and a half times the damage.', 'החזקה טוענת קרן אור דרך טבעת בכף היד. טעינה מלאה גורמת נזק גדול פי שניים וחצי.'],
  ['tech.nova_ring.desc', 'A ring of light bursts from you and throws every enemy around you outward.', 'טבעת אור מתפרצת ממך ומעיפה החוצה כל אויב סביבך.'],
  ['tech.ringfall.desc', 'Ultimate. Rise, then dive into the ground at the centre of a ring of light. Leaves a great crater.', 'מכת על. עלייה וצלילה אל הקרקע במרכז טבעת אור. משאירה מכתש עצום.'],
  ['tech.guard.desc', 'Hold to block hits from the front. Raise it just before impact for a perfect guard.', 'החזקה חוסמת מכות מלפנים. חסימה רגע לפני הפגיעה היא חסימה מושלמת.'],
  ['tech.flicker_step.desc', 'Vanish seven metres in the direction you move, untouchable for a moment. Dodge at the last instant to slow time.', 'היעלמות לשבעה מטרים לכיוון התנועה, עם חסינות רגעית. התחמקות ברגע האחרון מאטה את הזמן.'],
  ['tech.boost.desc', 'Hold Dash in flight to boost. After two seconds you break into Sonic Boost.', 'החזקת זינוק בטיסה מאיצה. אחרי שתי שניות פורצים להאצה על־קולית.'],
  ['tech.gather.desc', 'Hold to draw Ora from the air. Any hit interrupts you. It sustains a Form.', 'החזקה שואבת אורה מהאוויר. כל מכה קוטעת את האיסוף. כך גם מחזיקים צורה.'],
  ['form.ember.desc', 'Light leaks through the seams of your body. More damage, speed and Resonance; drains Ora.', 'אור דולף מהתפרים של הגוף. יותר נזק, מהירות ותהודה; שואבת אורה.'],
  ['form.tempest.desc', 'A mantle of wind ribbons. Much more power, and Flicker Step costs half.', 'מעטה של סרטי רוח. הרבה יותר עוצמה, וצעד הבהוב עולה חצי.'],
  ['form.zenith.desc', 'Prism light runs through every seam. The peak of your power.', 'אור פריזמה זורם בכל התפרים. שיא הכוח שלך.'],
  ['node.iron_fists_1.name', 'Iron Fists I', 'אגרופי ברזל א׳'],
  ['node.iron_fists_2.name', 'Iron Fists II', 'אגרופי ברזל ב׳'],
  ['node.iron_fists_3.name', 'Iron Fists III', 'אגרופי ברזל ג׳'],
  ['node.bright_core_1.name', 'Bright Core I', 'ליבה בוהקת א׳'],
  ['node.bright_core_2.name', 'Bright Core II', 'ליבה בוהקת ב׳'],
  ['node.bright_core_3.name', 'Bright Core III', 'ליבה בוהקת ג׳'],
  ['node.deep_well_1.name', 'Deep Well I', 'באר עמוקה א׳'],
  ['node.deep_well_2.name', 'Deep Well II', 'באר עמוקה ב׳'],
  ['node.second_breath_1.name', 'Second Breath', 'נשימה שנייה'],
  ['node.iron_fists.desc', '+6% melee damage.', '+6% נזק בקרב מגע.'],
  ['node.bright_core.desc', '+6% Ora damage.', '+6% נזק אורה.'],
  ['node.deep_well.desc', '+10% max Ora.', '+10% אורה מרבית.'],
  ['node.second_breath.desc', 'Once every five minutes a lethal hit leaves you at 1 HP, untouchable for two seconds.', 'פעם בחמש דקות, מכה קטלנית משאירה אותך עם נקודת חיים אחת וחסינות לשתי שניות.'],
  ['node.rank', 'Rank {rank}', 'דרגה {rank}'],
  ['combat.callout.burnout', 'Burnout', 'שחיקה'],
  ['combat.callout.break', 'Break!', 'שבירה!'],
  ['combat.callout.perfect', 'Perfect!', 'מושלם!'],
  ['combat.callout.guardBreak', 'Guard broken', 'החסימה נשברה'],
  ['combat.callout.secondBreath', 'Second Breath', 'נשימה שנייה'],
  ['combat.callout.combo', '{count} hits', '{count} מכות'],
  ['combat.callout.surgeFull', 'Surge ready', 'הנחשול מוכן'],
  ['combat.reason.noOra', 'Not enough Ora', 'אין מספיק אורה'],
  ['combat.reason.cooldown', 'Not ready yet', 'עדיין לא מוכן'],
  ['combat.reason.burnout', 'Burnout: cannot transform yet', 'שחיקה: אי אפשר להשתנות עדיין'],
];

/** @returns {{ he:Record<string, string>, en:Record<string, string> }} */
function tables() {
  /** @type {Record<string, string>} */
  const he = {};
  /** @type {Record<string, string>} */
  const en = {};
  for (const [k, e, h] of ROWS) {
    en[k] = e;
    he[k] = h;
  }
  return { he, en };
}

/** The combat string tables. */
export const COMBAT_STRINGS = Object.freeze(tables());
