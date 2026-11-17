/**
 * Bilingual strings of the gameplay stand-ins (ARCHITECTURE 4.14, 8.0): the stand-in HUD and screens
 * (`ui.*`), the stand-in interact prompts (`standin.*`) and the stand-in quest objectives and dialogue lines.
 * Hebrew UI verbs are infinitives (ART_UX 7.1). Owning packages register their own tables, which win.
 * @module standins/strings
 */

/**
 * Build `{ he, en }` tables from rows of [key, en, he].
 * @param {Array<[string, string, string]>} rows
 * @returns {{ he:Record<string, string>, en:Record<string, string> }}
 */
function tables(rows) {
  const he = {};
  const en = {};
  for (const [key, e, h] of rows) {
    en[key] = e;
    he[key] = h;
  }
  return { he, en };
}

/** Stand-in HUD and screens. @type {Array<[string, string, string]>} */
const UI = [
  ['ui.title.continue', 'Continue the journey', 'להמשיך את המסע'],
  ['ui.title.newGame', 'New Journey', 'מסע חדש'],
  ['ui.title.noSave', 'No saved journey yet', 'עדיין אין מסע שמור'],
  ['ui.common.language', 'Language', 'שפה'],
  ['ui.common.close', 'Close', 'סגירה'],
  ['ui.common.yes', 'Yes', 'כן'],
  ['ui.pause.title', 'Paused', 'הפסקה'],
  ['ui.pause.resume', 'Back to the journey', 'לחזור למסע'],
  ['ui.pause.save', 'Save the journey', 'לשמור את המסע'],
  ['ui.pause.quit', 'Save and return to the title', 'לשמור ולחזור למסך הפתיחה'],
  ['ui.pause.points', 'Stat points to spend: {n}', 'נקודות לחלוקה: {n}'],
  ['ui.pause.xp', 'XP {xp} / {need}', 'ניסיון {xp} / {need}'],
  ['ui.pause.hp', 'HP {hp} / {max}', 'חיים {hp} / {max}'],
  ['ui.pause.ora', 'Ora {ora} / {max}', 'אורה {ora} / {max}'],
  ['ui.pause.add', 'Add a point to {stat}', 'להוסיף נקודה ל{stat}'],
  ['ui.hud.pause', 'Pause', 'הפסקה'],
  ['ui.hud.level', 'Lv {level}', 'רמה {level}'],
  ['ui.death.rise', 'Rise again', 'לקום שוב'],
  ['ui.dialogue.next', 'Next', 'הלאה'],
  ['ui.banner.levelUp', 'Level {level}', 'רמה {level}'],
  ['ui.banner.questDone', 'Quest complete', 'המשימה הושלמה'],
  ['ui.banner.break', 'Break!', 'שבירה!'],
  ['ui.banner.perfect', 'Perfect!', 'מושלם!'],
  ['ui.toast.points', 'New stat points: {n}', 'נקודות חדשות: {n}'],
  ['ui.toast.questStarted', 'New quest: {title}', 'משימה חדשה: {title}'],
  ['ui.toast.ringstone', 'The Ringstone remembers you', 'אבן הטבעת זוכרת אותך'],
  ['ui.toast.item', '{name} x{count}', '{name} x{count}'],
  ['ui.toast.shells', 'Shells +{n}', 'צדפים +{n}'],
  ['standin.prompt.talk', 'Talk', 'לדבר'],
  ['standin.prompt.ringstone', 'Attune', 'לכוונן'],
  ['standin.prompt.use', 'Use', 'להשתמש'],
];

/** Stand-in quest objectives and dialogue lines. @type {Array<[string, string, string]>} */
const CONTENT = [
  ['quest.mq1.s1', 'Talk to Sela', 'לדבר עם סלע'],
  ['quest.mq1.s2', 'Defeat a Tusk Boar ({count}/{need})', 'להביס חזיר חט ({count}/{need})'],
  ['mq1.l01', 'There you are. The meadows are restless today.', 'הנה את{g:ה/}. האחו חסר מנוחה היום.'],
  ['mq1.l02', 'A tusk boar keeps trampling the path. Calm it for me.', 'חזיר חט רומס את השביל שוב ושוב. תרגיע{g:/י} אותו בשבילי.'],
  ['mq1.l03', 'Keep your light close, Tavi.', 'שמור{g:/י} את האור שלך קרוב, טאבי.'],
  ['standin.idle.greet', 'Good light to you.', 'אור טוב לך.'],
];
for (const q of ['mq2', 'mq3', 'mq4', 'mq5', 'mq6', 'mq7', 'sq1', 'sq2', 'sq3', 'sq4']) {
  CONTENT.push([`quest.${q}.s1`, 'The story continues in a later build', 'הסיפור ממשיך בגרסה מאוחרת יותר']);
}

/** Strings of the stand-in ui. */
export const UI_STRINGS = Object.freeze(tables(UI));
/** Strings of the stand-in content (quest objectives, dialogue). */
export const CONTENT_STRINGS = Object.freeze(tables(CONTENT));
