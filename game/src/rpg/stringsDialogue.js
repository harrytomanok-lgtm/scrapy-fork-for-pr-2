/**
 * Dialogue lines of the rpg package (GDD 8.4, 8.5: MQ1 and MQ2 exactly as written there; the rest in the same
 * warm, direct, slightly dry tone). Hebrew is written as Hebrew, with `{g:masculine/feminine}` for words that
 * depend on the player's form of address. Rows are [key, en, he].
 * @module rpg/stringsDialogue
 */

/** @type {Array<[string, string, string]>} */
const ROWS = [
  // MQ1 "The Spark" (GDD 8.4)
  ['mq1.l01', 'Again. Toward the post. Your feet are thinking too much.', 'שוב. אל העמוד. הרגליים שלך חושבות יותר מדי.'],
  ['mq1.l02', 'My feet are thinking about breakfast.', 'הרגליים שלי חושבות על ארוחת בוקר.'],
  ['mq1.l03', 'Then hit the post like it stole your breakfast.', 'אז {g:תכה/תכי} בעמוד כאילו הוא גנב לך אותה.'],
  ['mq1.l04', '...That light. That is not the dawn.', '...האור הזה. זו לא הזריחה.'],
  ['mq1.l05', 'Sela, something is burning in my chest!', 'סלע, משהו בוער לי בחזה!'],
  ['mq1.l06', "Your Ora is waking. Don't fight it. Jump!", 'האורה שלך מתעוררת. אל {g:תילחם/תילחמי} בה. {g:קפוץ/קפצי}!'],
  ['mq1.l07', "I'm... I'm not coming down!", 'אני... אני לא {g:יורד/יורדת}!'],
  ['mq1.l08', 'Good. Now fly faster than your fear. Through the rings!', 'יפה. עכשיו {g:טוס/טוסי} מהר יותר מהפחד. דרך הטבעות!'],
  ['mq1.l09', 'Wisps. They feed on that light. Strike them from where you are.', 'רוחות גחלת. הן ניזונות מהאור הזה. {g:פגע/פגעי} בהן מהמקום שלך.'],
  ['mq1.l10', 'Too many? Then stop shooting. Breathe. Gather the light.', 'יותר מדי? אז {g:תפסיק/תפסיקי} לירות. {g:תנשום/תנשמי}. {g:אסוף/אספי} את האור.'],
  ['mq1.l11', '...Did I do that?', '...אני עשיתי את זה?'],
  ['mq1.l12', 'You did. And every Lanterned on this island felt it. Including the wrong ones.', 'כן. וכל מאיר באי הרגיש את זה. גם מי שלא היה צריך.'],
  ['mq1.l13', 'Boars. Something has driven them mad. Calm them the hard way.', 'חזירי חט. משהו שיגע אותם. {g:תרגיע/תרגיעי} אותם בדרך הקשה.'],
  ['mq1.l14', "Red light means don't block. Vanish.", 'אור אדום אומר: לא לחסום. {g:היעלם/היעלמי}.'],
  ['mq1.l15', 'Back to Sparkstead. Touch the Ringstone. It will remember you.', 'חזרה לבית הניצוץ. {g:גע/געי} באבן הטבעת. היא תזכור אותך.'],
  ['mq1.skip.l01', "You move like you've done this before. Drills, or straight to Sparkstead?", '{g:אתה זז/את זזה} כמו מי שכבר עשה את זה. תרגולים, או ישר לבית הניצוץ?'],

  // MQ2 "Smoke over Sparkstead" (GDD 8.5)
  ['mq2.l01', "Tavi! You're glowing. Is that contagious? Take these Sunfruit, just in case.", 'טאבי! {g:אתה זוהר/את זוהרת}. זה מדבק? {g:קח/קחי} פירות שמש, ליתר ביטחון.'],
  ['mq2.l02', 'Your hands will break before the posts do. Wear these.', 'הידיים שלך יישברו לפני העמודים. {g:תלבש/תלבשי} את אלה.'],
  ['mq2.l03', 'Smoke at the well! Figures in grey hoods!', 'עשן ליד הבאר! דמויות בברדסים אפורים!'],
  ['mq2.l04', 'Another little light. The Choir will sing you quiet.', 'עוד אור קטן. המקהלה תשיר אותך אל השקט.'],
  ['mq2.l05', 'So you lit up the sky this morning? I expected someone taller.', 'אז {g:אתה זה שהאיר/את זו שהאירה} את השמיים הבוקר? ציפיתי למישהו גבוה יותר.'],
  ['mq2.l06', 'I grow fast.', 'אני {g:גדל/גדלה} מהר.'],
  ['mq2.l07', 'Vorrhal will drain you like he drains this land!', 'וורהאל ירוקן אותך כמו שהוא מרוקן את הארץ הזאת!'],
  ['mq2.l08', 'Took you long enough. I dropped two of them while you were posing.', 'לקח לך זמן. הורדתי שניים בזמן שעשית פוזות.'],
  ['mq2.l09', 'Kerrin. Kind of you to arrive after the fight.', 'קרין. נחמד מצדך להגיע אחרי הקרב.'],
  ['mq2.l10', 'First to the Siphon gets to tell Sela about it. Move.', 'מי שמגיע ראשון למגדל מספר לסלע. {g:זוז/זוזי}.'],
  ['mq2.l11', 'It is drinking the Vein. Feel how cold the ground is?', 'הוא שותה את העורק. {g:אתה מרגיש/את מרגישה} כמה האדמה קרה?'],
  ['mq2.l12', 'Strike the core when it opens. Not before.', '{g:הכה/הכי} בליבה כשהיא נפתחת. לא לפני.'],
  ['mq2.l13', 'Vorrhal was one of us. The strongest. He lost his light, and decided no one should keep theirs.', 'וורהאל היה אחד מאיתנו. החזק מכולנו. הוא איבד את האור שלו, והחליט שלאף אחד לא מגיע לשמור על שלו.'],
  ['mq2.l14', 'Four more Siphons. If they all drink, the Wellspring goes dark, and everything it feeds goes with it.', 'עוד ארבעה מגדלים. אם כולם ישתו, המעיין יכבה, ואיתו כל מה שהוא מזין.'],
  ['mq2.l15', "Then we split up. I'll take the hard ones.", 'אז מתפצלים. אני לוקח את הקשים.'],
  ['mq2.l16', 'Tavi, wait. When the light overflowed in you this morning, you nearly changed. Next time, let it.', 'טאבי, {g:חכה/חכי}. כשהאור עלה על גדותיו הבוקר, כמעט השתנית. בפעם הבאה, {g:תן/תני} לזה לקרות.'],
  ['mq2.l17', 'Ember Form unlocked. Press the Form button.', 'צורת גחלת נפתחה. יש ללחוץ על כפתור הצורה.'],
  ['mq2.l18', 'The island is yours to cross. Go where your Ora leads.', 'האי פתוח לפניך. {g:לך/לכי} לאן שהאורה מובילה.'],

  // MQ3 "Roots of Rot"
  ['mq3.l01', 'Sela sent a glowing child to my camp. The Thornwood must be worse than I thought.', 'סלע שלחה {g:ילד זוהר/ילדה זוהרת} למחנה שלי. כנראה שביער הקוצים המצב גרוע יותר ממה שחשבתי.'],
  ['mq3.l02', 'I prefer "apprentice". What happened to the forest?', 'אני {g:מעדיף "חניך"/מעדיפה "חניכה"}. מה קרה ליער?'],
  ['mq3.l03', 'The boars eat roots that drink from the Siphon. Now they are all thorn and fury.', 'החזירים אוכלים שורשים ששותים ממגדל היניקה. עכשיו הם רק קוצים וזעם.'],
  ['mq3.l04', 'Thin the herd. Then find what is nesting in Bramble Hollow. I can hear it breathing at night.', '{g:תדלל/תדללי} את העדר. ואז {g:תמצא/תמצאי} מה מקנן בשקע הסנה. בלילות אני שומעת אותו נושם.'],
  ['mq3.l05', 'The roots are warm again. I can smell sap instead of rot.', 'השורשים שוב חמים. אני מריחה שרף במקום ריקבון.'],
  ['mq3.l06', 'That horned thing nearly buried me.', 'הדבר עם הקרניים כמעט קבר אותי.'],
  ['mq3.l07', 'And you came back up. Sela taught you a ring that falls from the sky. Use it next time, before the burying.', 'ויצאת משם. סלע לימדה אותך טבעת שנופלת מהשמיים. בפעם הבאה {g:תשתמש/תשתמשי} בה לפני הקבורה.'],
  ['mq3.l08', 'Ringfall learned. Fill the Surge gauge to unleash it.', 'צלילת הטבעת נלמדה. יש למלא את מד הנחשול כדי לשחרר אותה.'],

  // MQ4 "The Glass Tide"
  ['mq4.l01', 'Mind the lenses. Every one of them took me a winter.', '{g:תיזהר/תיזהרי} עם העדשות. כל אחת מהן לקחה לי חורף שלם.'],
  ['mq4.l02', 'Sela says you can make light into a spear.', 'סלע אומרת {g:שאתה יודע/שאת יודעת} להפוך אור לחנית.'],
  ['mq4.l03', 'Not a spear. A line. The beacon gathers light through a ring and lets it out all at once.', 'לא חנית. קו. המגדלור אוסף אור דרך טבעת ומשחרר אותו בבת אחת.'],
  ['mq4.l04', 'Your hands can do the same. Charge it, then aim at the saltglass. Three clean hits and I will believe you.', 'גם הידיים שלך יכולות. {g:תטען/תטעני}, ואז {g:תכוון/תכווני} אל זכוכית המלח. שלוש פגיעות נקיות ואאמין לך.'],
  ['mq4.l05', 'Dawn Lance learned. Hold the technique button to charge it.', 'רומח השחר נלמד. יש להחזיק את כפתור הטכניקה כדי לטעון אותו.'],
  ['mq4.l06', 'The beacon is turning again. Ships will see the coast tonight.', 'המגדלור שוב מסתובב. הלילה הספינות יראו את החוף.'],
  ['mq4.l07', 'And the Choir will see it too.', 'וגם המקהלה תראה אותו.'],
  ['mq4.l08', 'Let them look. Take this charm. The tide gives back what it takes, if you are patient.', 'שיסתכלו. {g:קח/קחי} את הקמע הזה. הגאות מחזירה את מה שהיא לוקחת, למי שסבלני.'],

  // MQ5 "The Burrow King"
  ['mq5.l01', 'You want to go into the Burrow Pit? Good. I want my copper back.', '{g:אתה רוצה/את רוצה} לרדת לבור המחילות? מצוין. אני רוצה את הנחושת שלי בחזרה.'],
  ['mq5.l02', 'I came for the Siphon, not for copper.', 'באתי בשביל המגדל, לא בשביל נחושת.'],
  ['mq5.l03', 'Something with too many teeth is guarding both. Kill it, and we are both happy.', 'משהו עם יותר מדי שיניים שומר על שניהם. {g:תהרוג/תהרגי} אותו, ושנינו מרוצים.'],
  ['mq5.l04', 'The ground stopped shaking. My mules are eating again.', 'האדמה הפסיקה לרעוד. הפרדות שלי שוב אוכלות.'],
  ['mq5.l05', 'It was bigger than the pit.', 'הוא היה גדול יותר מהבור.'],
  ['mq5.l06', 'Then you are bigger than it. Here, wyrmhide. It turned my blade once. It will turn worse things.', 'אז {g:אתה גדול/את גדולה} ממנו. הנה, עור תולע. פעם הוא עצר את הלהב שלי. הוא יעצור גם דברים גרועים יותר.'],

  // MQ6 "Pale Wings"
  ['mq6.l01', 'The wind has stopped over Still Wind. A monastery of wind, without wind.', 'הרוח נעצרה מעל מנזר הרוח הדוממת. מנזר של רוח, בלי רוח.'],
  ['mq6.l02', 'Is that bad?', 'זה רע?'],
  ['mq6.l03', 'Iskra nests on the summit and swallows every breeze. Ring the three bells on the peaks. She will come to silence them.', 'איסקרה מקננת על הפסגה ובולעת כל משב. {g:צלצל/צלצלי} בשלושת הפעמונים שעל הפסגות. היא תבוא להשתיק אותם.'],
  ['mq6.l04', 'Then she will be in the open, and so will you. Fly well.', 'אז היא תהיה בשטח פתוח, וגם {g:אתה/את}. {g:עוף/עופי} היטב.'],
  ['mq6.l05', 'Listen. The bells are ringing on their own.', '{g:תקשיב/תקשיבי}. הפעמונים מצלצלים מעצמם.'],
  ['mq6.l06', 'She fought like a storm.', 'היא נלחמה כמו סערה.'],
  ['mq6.l07', 'Because you were one. Your light changed shape up there. Let it keep that shape.', 'כי {g:אתה היית/את היית} סערה. האור שלך שינה צורה שם למעלה. {g:תן/תני} לו לשמור עליה.'],
  ['mq6.l08', 'Tempest Form unlocked. Cycle Forms with the Form button.', 'צורת סערה נפתחה. אפשר להחליף צורות בכפתור הצורה.'],
  ['mq6.l09', 'The Siphon in the pines is still drinking. Go, before the wind forgets us again.', 'המגדל שבין האורנים עדיין שותה. {g:לך/לכי}, לפני שהרוח תשכח אותנו שוב.'],

  // MQ7 "The Last Vein" and the finale
  ['mq7.l01', 'Four Siphons are silent. Vorrhal felt every one of them break.', 'ארבעה מגדלים שותקים. וורהאל הרגיש כל אחד מהם נשבר.'],
  ['mq7.l02', 'His Vanguard holds the Court gate. I counted three. I could take them, but I am being generous.', 'החלוצים שלו מחזיקים בשער החצר. ספרתי שלושה. יכולתי לטפל בהם, אבל אני נדיב היום.'],
  ['mq7.l03', 'Then I go through the gate, and through him.', 'אז אני {g:עובר/עוברת} דרך השער, ודרכו.'],
  ['mq7.l04', 'Remember what he lost. Do not let him take yours.', '{g:תזכור/תזכרי} מה הוא איבד. אל {g:תיתן/תתני} לו לקחת את שלך.'],
  ['mq7.l05', 'You shine so brightly, little light. Let me hold it for you.', 'את{g:ה/} {g:זורח/זורחת} כל כך, אור קטן. {g:תן/תני} לי להחזיק אותו בשבילך.'],
  ['mq7.l06', 'Tavi! The Siphons you broke left threads of the Vein. Carry them to the Spire!', 'טאבי! המגדלים ששברת השאירו חוטים של העורק. {g:תביא/תביאי} אותם אל מגדל המעיין!'],
  ['mq7.l07', 'My Ora is gone... but the threads are warm.', 'האורה שלי נעלמה... אבל החוטים חמים.'],
  ['mq7.l08', 'The Wellspring answers you. Become what it remembers!', 'המעיין עונה לך. {g:תהיה/תהיי} מה שהוא זוכר!'],
  ['mq7.l09', 'No... that light was mine once...', 'לא... האור הזה היה פעם שלי...'],
  ['mq7.l10', 'The Wellspring Spire burns again. Light runs down every Vein of Kethra.', 'מגדל המעיין בוער שוב. אור זורם בכל עורקי קתרה.'],
  ['mq7.l11', 'He is only a man now. Tired, and very small.', 'עכשיו הוא רק אדם. עייף, וקטן מאוד.'],
  ['mq7.l12', 'Fine. You were faster. This time.', 'טוב. היית {g:מהיר/מהירה} יותר. הפעם.'],
  ['mq7.l13', 'The island will need a Lanterned who flies. Take this mantle. It was mine.', 'האי יצטרך {g:מאיר שעף/מאירה שעפה}. {g:קח/קחי} את הגלימה הזאת. היא הייתה שלי.'],
  ['mq7.l14', 'Where do I start?', 'מאיפה {g:אני מתחיל/אני מתחילה}?'],
  ['mq7.l15', 'Anywhere. That is the point of wings.', 'מכל מקום. בשביל זה יש כנפיים.'],

  // SQ1 "Windmill Down"
  ['sq1.l01', 'Last night the wind went mad and tore the blades off my mill. They are scattered over half the meadow.', 'אתמול בלילה הרוח השתגעה ותלשה את הכנפיים מהטחנה שלי. הן מפוזרות על חצי אחו.'],
  ['sq1.l02', 'And now the wisps nest in the wreck. Without the mill there is no flour, and without flour, no Dov.', 'ועכשיו רוחות הגחלת מקננות בהריסות. בלי טחנה אין קמח, ובלי קמח אין את דב.'],
  ['sq1.l03', "I'll bring the blades back.", 'אני אחזיר את הכנפיים.'],
  ['sq1.l04', 'Not now, Ilan.', 'לא עכשיו, אילן.'],
  ['sq1.l05', 'Bless your glowing hands. Mind the wisps, they bite.', 'ברוכות הידיים הזוהרות שלך. {g:תיזהר/תיזהרי} מהרוחות, הן נושכות.'],
  // SQ2 "Lost Bells"
  ['sq2.l01', 'My flock follows the bells, and the bells are gone. The storm hung them on the hilltops like laundry.', 'העדר שלי הולך אחרי הפעמונים, והפעמונים נעלמו. הסערה תלתה אותם על הגבעות כמו כביסה.'],
  ['sq2.l02', 'You fly, don\'t you? Ring them once and I will hear where they are.', '{g:אתה עף/את עפה}, נכון? {g:תצלצל/תצלצלי} בהם פעם אחת ואשמע איפה הם.'],
  ['sq2.l03', "I'll ring them for you.", 'אני אצלצל בהם בשבילך.'],
  ['sq2.l04', 'Maybe later.', 'אולי אחר כך.'],
  ['sq2.l05', 'Three bells, three hills. The sheep and I will be listening.', 'שלושה פעמונים, שלוש גבעות. אני והכבשים נקשיב.'],
  ['sq2.l06', 'There! Even the stubborn ram came home. You have a shepherd\'s ear.', 'הנה! אפילו האיל העקשן חזר הביתה. יש לך אוזן של רועה.'],
  ['sq2.l07', 'Take this charm. It caught the wind for my grandmother; it will catch it for you.', '{g:קח/קחי} את הקמע הזה. הוא תפס את הרוח בשביל סבתא שלי, ויתפוס אותה גם בשבילך.'],
  // SQ3 "First Ring"
  ['sq3.l01', 'Fourteen rings through the windmill valley. Nobody has flown them under a minute. Nobody can fly, but still.', 'ארבע־עשרה טבעות דרך עמק הטחנות. אף אחד עוד לא עבר אותן בפחות מדקה. אף אחד גם לא עף, אבל בכל זאת.'],
  ['sq3.l02', 'You can fly. Want to make history?', '{g:אתה יכול/את יכולה} לעוף. רוצה לעשות היסטוריה?'],
  ['sq3.l03', 'Start the clock.', 'להפעיל את השעון!'],
  ['sq3.l04', 'Another time.', 'בפעם אחרת.'],
  ['sq3.l05', 'The first gate is by the old marker. Through every ring, in order. Go!', 'השער הראשון ליד אבן הציון הישנה. דרך כל טבעת, לפי הסדר. קדימה!'],
  // SQ4 "Copper Hearts"
  ['sq4.l01', 'The rust golems in the dunes have hearts of pure copper. Well, rust cores. Close enough.', 'לגולמי החלודה בדיונות יש לבבות מנחושת טהורה. טוב, ליבות חלודה. כמעט אותו דבר.'],
  ['sq4.l02', 'Bring me three and I will make you something that hits harder than a golem.', '{g:תביא/תביאי} לי שלוש ואכין לך משהו שמכה חזק יותר מגולם.'],
  ['sq4.l03', 'Three cores. Easy.', 'שלוש ליבות. קל.'],
  ['sq4.l04', 'I like my bones unbroken.', 'אני {g:אוהב/אוהבת} את העצמות שלי שלמות.'],
  ['sq4.l05', 'Easy, says the child. Hit them where the plates meet.', 'קל, {g:אומר הילד/אומרת הילדה}. {g:תכה/תכי} בהם איפה שהלוחות נפגשים.'],
  ['sq4.l06', 'Still warm. You did not waste a single one.', 'עוד חמות. לא בזבזת אף אחת.'],
  ['sq4.l07', 'As promised: a charm with a golem\'s heart. Your hits will stagger mountains.', 'כמו שהבטחתי: קמע עם לב של גולם. המכות שלך יטלטלו הרים.'],

  // Idle talk
  ['sela.idle.greet', 'Your light is steadier today. Good.', 'האור שלך יציב יותר היום. טוב.'],
  ['sela.idle.talk', 'Ora is not a weapon. It is a promise you keep with your whole body.', 'אורה היא לא נשק. היא הבטחה שמקיימים עם כל הגוף.'],
  ['kerrin.idle.greet', 'Look who it is. Still glowing?', 'תראו מי פה. עדיין {g:זוהר/זוהרת}?'],
  ['kerrin.idle.talk', 'I counted my Siphons. I am ahead. Do not check.', 'ספרתי את המגדלים שלי. אני מוביל. אל {g:תבדוק/תבדקי}.'],
  ['dov.idle.greet', 'Fresh fruit, fresh cloth, fresh prices! Well. Two out of three.', 'פירות טריים, בדים טריים, מחירים טריים! טוב. שניים מתוך שלושה.'],
  ['dov.idle.talk', 'A Sunfruit a day keeps the Choir away. I made that up. It sells well.', 'פרי שמש ביום מרחיק את המקהלה. המצאתי את זה. זה נמכר מצוין.'],
  ['mira.idle.greet', 'Hands first. Let me see them. Fine, they are still attached.', '{g:תראה/תראי} לי את הידיים. טוב, הן עדיין מחוברות.'],
  ['mira.idle.talk', 'Wrap tight at the wrist, loose at the knuckle. Then hit like you mean it.', 'לעטוף חזק בשורש כף היד, רפוי במפרקים. ואז להכות כמו שמתכוונים.'],
  ['ilan.idle.greet', 'Listen to her turn. Best sound in the meadow.', '{g:תקשיב/תקשיבי} איך היא מסתובבת. הצליל הכי יפה באחו.'],
  ['ilan.idle.talk', 'Flour on my sleeves, wind in my ears. A miller asks for nothing more.', 'קמח על השרוולים, רוח באוזניים. טוחן לא צריך יותר מזה.'],
  ['rina.idle.greet', 'Careful where you land. That one is Dalia, and she bites.', '{g:תיזהר/תיזהרי} איפה {g:שאתה נוחת/שאת נוחתת}. זאת דליה, והיא נושכת.'],
  ['rina.idle.talk', 'Sheep know weather. When they all face the Spire, something is coming.', 'כבשים מרגישות את מזג האוויר. כשכולן פונות אל מגדל המעיין, משהו מתקרב.'],
  ['gal.idle.greet', 'Ready for another lap? The rings are not getting any slower.', '{g:מוכן/מוכנה} להקפה נוספת? הטבעות לא נהיות איטיות יותר.'],
  ['gal.idle.talk', 'Low over the ridge, then dive. Height is just speed you have not used yet.', 'נמוך מעל הרכס, ואז צלילה. גובה זה רק מהירות שעוד לא ניצלת.'],
  ['eli.idle.greet', 'Welcome to Haven Aster. If it floats, I sell it.', '{g:ברוך הבא/ברוכה הבאה} למעגן אסטר. אם זה צף, אני מוכר את זה.'],
  ['eli.idle.talk', 'The tide brings saltglass every morning. The merchants bring the rest.', 'הגאות מביאה זכוכית מלח כל בוקר. הסוחרים מביאים את כל השאר.'],
  ['bren.idle.greet', 'Mind the lenses. Always mind the lenses.', '{g:זהיר/זהירה} עם העדשות. תמיד {g:זהיר/זהירה} עם העדשות.'],
  ['bren.idle.talk', 'A kite is a lens for the wind. Everything good is a lens for something.', 'עפיפון הוא עדשה בשביל הרוח. כל דבר טוב הוא עדשה בשביל משהו.'],
  ['talia.idle.greet', 'Mind the drying racks. And your feet.', '{g:זהיר/זהירה} עם מתקני הייבוש. וגם עם הרגליים.'],
  ['talia.idle.talk', 'Every herb here was a weed until someone was hurt enough to try it.', 'כל עשב כאן היה עשב שוטה, עד שמישהו נפגע מספיק כדי לנסות אותו.'],
  ['yael.idle.greet', 'Copperwatch outpost. Trade is open, questions cost extra.', 'מוצב מצפה הנחושת. המסחר פתוח, שאלות בתוספת תשלום.'],
  ['yael.idle.talk', 'The dunes move a little every night. My prices move with them.', 'הדיונות זזות קצת בכל לילה. המחירים שלי זזים איתן.'],
  ['oren.idle.greet', 'Cold up here, Lanterned. Buy something warm.', 'קר כאן למעלה, {g:מאיר/מאירה}. כדאי לקנות משהו חם.'],
  ['oren.idle.talk', 'The ridge road is safe until it is not. I sell for both cases.', 'דרך הרכס בטוחה, עד שהיא לא. אני מוכר לשני המקרים.'],
  ['noa.idle.greet', 'Breathe in with the wind, out with the mountain.', 'לשאוף עם הרוח, לנשוף עם ההר.'],
  ['noa.idle.talk', 'Stillness is not the absence of wind. It is the wind, at peace with you.', 'דממה היא לא היעדר רוח. היא הרוח, בשלום איתך.'],
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

export const DIALOGUE_STRINGS = Object.freeze(tables(ROWS));
