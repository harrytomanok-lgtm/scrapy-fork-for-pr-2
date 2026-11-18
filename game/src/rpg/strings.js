/**
 * UI strings of the rpg package: interact prompts, toasts, banners, quest objectives, tutorial prompts, shop and
 * technique-tree reasons, race medals, object names. Hebrew UI verbs are infinitives (ART_UX 7.1). Rows are
 * [key, en, he].
 * @module rpg/strings
 */

/** @type {Array<[string, string, string]>} */
const ROWS = [
  // interact prompts
  ['rpg.prompt.talk', 'Talk', 'לדבר'],
  ['rpg.prompt.ringstone', 'Attune', 'לכוונן'],
  ['rpg.prompt.shrine', 'Claim the shrine', 'לתבוע את המקדש'],
  ['rpg.prompt.chest', 'Open', 'לפתוח'],
  ['rpg.prompt.race', 'Start the race', 'להתחיל את המרוץ'],
  ['rpg.prompt.use', 'Use', 'להשתמש'],
  ['rpg.prompt.bell', 'Ring the bell', 'לצלצל בפעמון'],
  ['rpg.prompt.blade', 'Lift the blade', 'להרים את הכנף'],
  ['rpg.prompt.tether', 'Take the thread', 'לאחוז בחוט'],
  // dialogue choices (UI verbs)
  ['rpg.choice.shop', 'Trade', 'לסחור'],
  ['rpg.choice.talk', 'Chat', 'לשוחח'],
  ['rpg.choice.bye', 'Farewell', 'להתראות'],
  // toasts and banners
  ['rpg.toast.item', '{item} x{count}', '{item} x{count}'],
  ['rpg.toast.shells', 'Shells +{n}', 'צדפים +{n}'],
  ['rpg.toast.tether', 'Thread delivered: {n} / {total}', 'חוט נמסר: {n} / {total}'],
  ['rpg.banner.shrine', 'Ora Shrine {n} / {total}: +1 TP', 'מקדש אורה {n} / {total}: עוד נקודת טכניקה'],
  ['rpg.banner.siphon', 'Siphon silenced', 'המגדל הושתק'],
  ['rpg.banner.awakening', 'Resonance rising', 'התהודה עולה'],
  ['rpg.banner.mq7', 'The way to the Court is open', 'הדרך אל החצר פתוחה'],
  ['rpg.banner.freeRoam', 'The island is yours', 'האי שלך'],
  ['rpg.race.medal.bronze', 'Bronze: {seconds} s', 'ארד: {seconds} שנ׳'],
  ['rpg.race.medal.silver', 'Silver: {seconds} s', 'כסף: {seconds} שנ׳'],
  ['rpg.race.medal.gold', 'Gold: {seconds} s', 'זהב: {seconds} שנ׳'],
  // reasons
  ['rpg.node.needLevel', 'Requires a higher level', 'נדרשת רמה גבוהה יותר'],
  ['rpg.node.needTech', 'Requires the technique', 'נדרשת הטכניקה'],
  ['rpg.node.needNode', 'Requires the previous rank', 'נדרשת הדרגה הקודמת'],
  ['rpg.node.needTp', 'Not enough TP', 'אין מספיק נקודות טכניקה'],
  ['rpg.shop.poor', 'Not enough Shells', 'אין מספיק צדפים'],
  ['rpg.shop.full', 'Cannot carry more', 'אין מקום לעוד'],
  ['rpg.shop.unknown', 'Not for sale', 'לא למכירה'],
  // tutorial prompts
  ['rpg.tut.move', 'Move', 'לזוז'],
  ['rpg.tut.attack', 'Attack', 'לתקוף'],
  ['rpg.tut.jump', 'Jump', 'לקפוץ'],
  ['rpg.tut.fly', 'Jump again to take off', 'לקפוץ שוב כדי להמריא'],
  ['rpg.tut.boost', 'Hold Dash to boost', 'להחזיק התחמקות כדי להאיץ'],
  ['rpg.tut.bolt', 'Fire an Ora Bolt', 'לירות קליע אורה'],
  ['rpg.tut.gather', 'Hold to Gather', 'להחזיק כדי לאסוף'],
  ['rpg.tut.lock', 'Lock on', 'לנעול מטרה'],
  ['rpg.tut.lockTap', 'Tap an enemy to lock on', 'לגעת באויב כדי לנעול'],
  ['rpg.tut.land', 'Hold Descend to land', 'להחזיק ירידה כדי לנחות'],
  ['rpg.tut.flicker', 'Dash to vanish', 'להתחמק כדי להיעלם'],
  ['rpg.tut.heavy', 'Hold Attack: Breaker', 'להחזיק התקפה: שובר'],
  ['rpg.tut.rings', 'Fly through the rings ({count}/{need})', 'לעוף דרך הטבעות ({count}/{need})'],
  // objects
  ['object.training_post.name', 'Training post', 'עמוד אימונים'],
  ['object.saltglass_pillar.name', 'Saltglass pillar', 'עמוד זכוכית מלח'],
  ['object.siphon_1.name', 'Siphon Spire I', 'מגדל היניקה I'],
  ['object.siphon_2.name', 'Siphon Spire II', 'מגדל היניקה II'],
  ['object.siphon_3.name', 'Siphon Spire III', 'מגדל היניקה III'],
  ['object.siphon_4.name', 'Siphon Spire IV', 'מגדל היניקה IV'],
  ['object.siphon_5.name', 'Siphon Spire V', 'מגדל היניקה V'],

  // quest objectives: quest.<questId>.<stepId>, args { count, need }
  ['quest.mq1.s1', 'Walk to the training post', 'ללכת אל עמוד האימונים'],
  ['quest.mq1.s2', 'Strike the post', 'להכות בעמוד'],
  ['quest.mq1.s3', 'Jump, take off and fly through the rings', 'לקפוץ, להמריא ולעוף דרך הטבעות'],
  ['quest.mq1.s4', 'Boost through the ring line', 'להאיץ דרך שורת הטבעות'],
  ['quest.mq1.s5', 'Strike down the Ember Wisps ({count}/{need})', 'להפיל את רוחות הגחלת ({count}/{need})'],
  ['quest.mq1.s6', 'Gather the light to full', 'לאסוף את האור עד הסוף'],
  ['quest.mq1.s7', 'Calm the Tusk Boars ({count}/{need})', 'להרגיע את חזירי החט ({count}/{need})'],
  ['quest.mq1.s8', 'Touch the Ringstone in Sparkstead', 'לגעת באבן הטבעת בבית הניצוץ'],
  ['quest.mq2.s1', 'Talk to Dov', 'לדבר עם דב'],
  ['quest.mq2.s2', 'Talk to Mira at the forge', 'לדבר עם מירה ליד הנפחייה'],
  ['quest.mq2.s3', 'Drive the Choir from the well ({count}/{need})', 'לגרש את המקהלה מהבאר ({count}/{need})'],
  ['quest.mq2.s4', 'Defeat Captain Durn', 'להביס את קפטן דורן'],
  ['quest.mq2.s5', 'Talk to Kerrin', 'לדבר עם קרין'],
  ['quest.mq2.s6', 'Race to Siphon Spire I', 'לטוס אל מגדל היניקה הראשון'],
  ['quest.mq2.s7', 'Destroy the Siphon core', 'להשמיד את ליבת המגדל'],
  ['quest.mq2.s8', 'Report to Sela', 'לדווח לסלע'],
  ['quest.mq3.s1', "Find Talia at her camp", 'למצוא את טליה במחנה שלה'],
  ['quest.mq3.s2', 'Thin the Bramble Boars ({count}/{need})', 'לדלל את חזירי הסנה ({count}/{need})'],
  ['quest.mq3.s3', 'Enter Bramble Hollow', 'להיכנס לשקע הסנה'],
  ['quest.mq3.s4', 'Defeat Bramblehorn', 'להביס את קרן הסנה'],
  ['quest.mq3.s5', 'Destroy Siphon Spire II', 'להשמיד את מגדל היניקה השני'],
  ['quest.mq3.s6', 'Return to Talia', 'לחזור אל טליה'],
  ['quest.mq4.s1', 'Meet Bren at the Tide Beacon', 'לפגוש את ברן במגדלור הגאות'],
  ['quest.mq4.s2', 'Focus the Dawn Lance on the saltglass ({count}/{need})', 'למקד את חנית השחר בזכוכית המלח ({count}/{need})'],
  ['quest.mq4.s3', 'Defend the beacon ({count}/{need})', 'להגן על המגדלור ({count}/{need})'],
  ['quest.mq4.s4', 'Destroy Siphon Spire III', 'להשמיד את מגדל היניקה השלישי'],
  ['quest.mq4.s5', 'Return to Bren', 'לחזור אל ברן'],
  ['quest.mq5.s1', 'Talk to Yael in Copperwatch', 'לדבר עם יעל במשמר הנחושת'],
  ['quest.mq5.s2', 'Descend into the Burrow Pit', 'לרדת לבור המחילות'],
  ['quest.mq5.s3', 'Defeat Gorrumaw', 'להביס את גורומאו'],
  ['quest.mq5.s4', 'Destroy Siphon Spire IV', 'להשמיד את מגדל היניקה הרביעי'],
  ['quest.mq5.s5', 'Return to Yael', 'לחזור אל יעל'],
  ['quest.mq6.s1', 'Seek Abbess Noa at Still Wind', 'לחפש את אם המנזר נועה ברוח הדוממת'],
  ['quest.mq6.s2', 'Ring the wind bells ({count}/{need})', 'לצלצל בפעמוני הרוח ({count}/{need})'],
  ['quest.mq6.s3', 'Climb to the Paleglass Summit', 'לטפס אל פסגת הזכוכית החיוורת'],
  ['quest.mq6.s4', 'Defeat Iskra', 'להביס את איסקרה'],
  ['quest.mq6.s5', 'Return to Noa', 'לחזור אל נועה'],
  ['quest.mq6.s6', 'Destroy Siphon Spire V', 'להשמיד את מגדל היניקה החמישי'],
  ['quest.mq7.s1', 'Meet Sela at the Spire Approach', 'לפגוש את סלע במבואות הצריח'],
  ['quest.mq7.s2', 'Break the Vanguard at the Court gate ({count}/{need})', 'לשבור את משמר החלוץ בשער החצר ({count}/{need})'],
  ['quest.mq7.s3', 'Defeat Vorrhal', 'להביס את וורהאל'],
  ['quest.mq7.s4', 'Relight the Wellspring Spire', 'להצית מחדש את צריח המעיין'],
  ['quest.mq7.s5', 'Talk to Sela', 'לדבר עם סלע'],
  ['quest.mq7.tether', 'Carry the threads to the Spire ({count}/{need})', 'לשאת את החוטים אל הצריח ({count}/{need})'],
  ['quest.sq1.s1', 'Find the fallen mill blades ({count}/{need})', 'למצוא את כנפי הטחנה שנפלו ({count}/{need})'],
  ['quest.sq1.s2', 'Clear the wisps from the mill ({count}/{need})', 'לגרש את הרוחות מהטחנה ({count}/{need})'],
  ['quest.sq2.s1', 'Ring the lost bells ({count}/{need})', 'לצלצל בפעמונים האבודים ({count}/{need})'],
  ['quest.sq2.s2', 'Return to Rina', 'לחזור אל רינה'],
  ['quest.sq3.s1', 'Fly the Windmill Run (bronze or better)', 'לעוף במסלול הטחנות (ארד ומעלה)'],
  ['quest.sq4.s1', 'Break Rust Golems ({count}/{need})', 'לשבור גולמי חלודה ({count}/{need})'],
  ['quest.sq4.s2', 'Collect rust cores ({count}/{need})', 'לאסוף ליבות חלודה ({count}/{need})'],
  ['quest.sq4.s3', 'Bring the cores to Yael', 'להביא את הליבות אל יעל'],
];

/** @param {Array<[string, string, string]>} rows */
function tables(rows) {
  const he = {};
  const en = {};
  for (const [k, e, h] of rows) {
    en[k] = e;
    he[k] = h;
  }
  return { he, en };
}

export const RPG_STRINGS = Object.freeze(tables(ROWS));
