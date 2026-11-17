# KETHRA: Veins of Light / קתרה: עורקי האור

Game Design Document, binding version 2. Companion documents: `ART_UX.md` (look, feel, UI, audio) and `ARCHITECTURE.md` (engineering contract).

Priority tags: **P0** = must ship, **P1** = should ship, **P2** = nice to have. Anything not tagged P0 must not block a P0 feature and must not be started before all P0 work in the same package is done.
Every player-visible name is given as **English / עברית**. Numbers in this document are the contract: they live in `src/core/balance.js` and are asserted by unit tests.

---

## 1. Pitch, world, vocabulary

### 1.1 Pitch
Kethra: Veins of Light is an open-world action RPG set on Kethra, a lone island-continent whose people channel **Ora**, the living light that flows through every creature. You are Tavi, an apprentice whose Ora wakes on the morning the Grey Choir starts draining the island. Within two minutes you are flying over meadows and firing bolts of light; within an hour you are punching beasts through boulders, carving craters and rewriting your body in light. Go anywhere from the first minute. Every hour, your **Resonance** number gets bigger.

### 1.2 Pillars
| # | Pillar | What it means in play |
|---|--------|-----------------------|
| 1 | Open-world freedom | One seamless island, no gates, flight after 90 seconds, something to find within 500 m of any point of the six content regions |
| 2 | Energy-warrior power fantasy | Free 3D flight, sonic boost, rapid bolts, charged beams, roaring aura, Forms, vanish dodges, enemies hurled through rocks, craters, a giant ultimate, a growing Resonance number |
| 3 | A real RPG | Levels, 4 stats, technique ranks, main and side quests, NPCs with dialogue, gear, shops, bosses, save with a portable journey code |
| 4 | Professional polish | Small and finished beats large and rough. Game feel, readable UI in Hebrew and English, 30 fps on a mid-range phone |

### 1.3 World and lore
- **Kethra / קתרה**: an island about 6.2 km across in an endless ocean. At its centre rises the **Wellspring Spire / מגדל המעיין**, a 900 m pillar of living crystal that pumps Ora through underground **Ora Veins / עורקי אורה** into the land.
- The ocean ends at the **Veilstorm / סערת הצעיף**, a permanent ring of storm and fog: the diegetic world edge.
- Five hundred years ago the Spire's crown tore loose in **the Uncrowning / נפילת הכתר**. It still floats around the peak as the **Shattered Crown / הכתר המנופץ**. Fighters called **the Lanterned / המאירים** have guarded the Spire since.
- **The threat**: Vorrhal the Dimmed, a Lanterned master whose Ora burned out in a failed attempt to mend the Spire, leads the **Grey Choir / המקהלה האפורה**: people who gave up their own light and now carry stolen Ora in violet siphon-glass. The Choir drives **Siphon Spires / מגדלי יניקה** into five Ora Veins. Each one greys a region and maddens its beasts. When enough stand, Vorrhal will drink the Wellspring itself.
- **The player's arc**: Tavi's Ora wakes violently when the first Siphon is lit. Tavi learns from Sela, silences the Siphons in any order, and faces Vorrhal at the Spire. In the finale the Veins the player freed surface as tethers of light, and the player carries them back into the Spire by hand (one per silenced Siphon; the more Siphons silenced, the weaker Vorrhal). When the last one is threaded, Tavi's seams overflow: this is the Zenith.

### 1.4 Rules of Ora (fiction = mechanics)
| Fiction | Mechanic |
|---------|----------|
| Ora is spent and refilled | **Ora pool** (teal bar). Techniques cost Ora. Slow passive regen (none while boosting or in a Form), fast active **Gather** |
| Ora can be compressed | Hold to charge: charged techniques scale up to x2.5 |
| The body is a vessel | Levels, stats, gear |
| Overflow reshapes the vessel | **Forms** (transformations) that drain Ora per second |
| Struggle feeds Ora | **Surge** meter fills by fighting and powers the Ultimate |
| Ora can be stolen | Choir tethers drain the player's Ora; Siphon zones halve passive regen |
| Ora can be felt | **Resonance / תהודה**: the intensity of someone's Ora as a number. It is sensed, never measured by a device. Shown for the player always and for a locked-on enemy |

### 1.5 Glossary (seed of the string table)
| Concept | English | עברית |
|---------|---------|-------|
| energy | Ora | אורה |
| power number | Resonance (RES) | תהודה |
| fighters | the Lanterned | המאירים |
| villains | the Grey Choir | המקהלה האפורה |
| villain machine | Siphon Spire | מגדל יניקה |
| world heart | Wellspring Spire | מגדל המעיין |
| charging | Gather | איסוף |
| ultimate meter | Surge | נחשול |
| transformation | Form | צורה |
| vanish dodge | Flicker Step | צעד הבהוב |
| currency | Shells | צדפים |
| save / respawn point | Ringstone | אבן הטבעת |
| technique-point shrine | Ora Shrine | מקדש אורה |
| world edge | Veilstorm | סערת הצעיף |
| technique points | Technique Points (TP) | נקודות טכניקה |

### 1.6 Originality rules (binding for all content)
No name, character, race, technique, item, place or plot beat from any existing franchise. Specifically forbidden looks and beats: golden or blond spiky-hair transformations, hair that lifts or changes colour in a Form, lightning-crackle auras, an all-white or silver-eyed "calm" Form, a full-body flame shell as a Form's resting look, orange-and-blue martial arts uniforms, tails, moon-triggered giant apes, eyepiece scanners, flying clouds, capsule houses, collecting N orbs for a wish, halo-in-afterlife imagery, crowds or lands passively donating energy to the hero, an old hermit master by the sea who teaches a beam, a beam charged as a sphere between two cupped hands, weighted training clothes that are shed, a rival who stands with crossed arms and defects to the villain, white-masked black spirit monsters, bonfire-style "kindle" and "rekindle" vocabulary. Our identity instead: **veins of light under the skin, a long sash that ignites into a ribbon of light, kites and rings, ink-and-paper world, violet siphon-glass enemies**. `tools/check-ip.mjs` enforces a term blocklist that also contains every term retired from earlier drafts of this design.

---

## 2. The first 10 minutes (P0)

Targets: **flight by 1:30, bolts by 2:00, first power-up (Ora Awakening, Resonance 176 -> 880) by 2:45, first enemy launched into a boulder by 4:00.** No text box longer than two short lines. Every prompt is the glyph of the real control for the last-used device, pulsing at the control's real position (touch) or centred low (keyboard, gamepad).

| Time | Beat | Teaches | How |
|------|------|---------|-----|
| 0:00 | Cold open, 10 s, skippable: camera sweeps from the Spire down to Sela's Ledge at dawn; a Siphon drills into the ground far away with a violet flash. Title card | Mood, threat | Camera path, no text |
| 0:10 | Tavi faces a training post. Sela: "Again. Toward the post." | Move | Ghost thumb on the stick zone; retires after 2 m |
| 0:25 | Strike the post three times; the third hit sends it flying off the ledge | Attack | Attack button pulses; hit-stop and shake on hit 3 |
| 0:40 | The Siphon fires, the ground shakes, Tavi glows. "Your Ora is waking. Jump!" | Jump | Jump button pulses |
| 0:55 | Tavi jumps and keeps rising. Slow-motion beat, music swell | Fly | Second Jump tap = take off. Touch prompt: push the stick and drag the view up to climb. Keyboard and gamepad prompt: hold Jump = rise, Descend = sink. Three glowing rings in the air |
| 1:30 | Through the rings; Sela flies alongside. "Faster!" | Boost | Hold Dash = boost (touch: double-tap Dash latches it); a longer ring line ends in a sonic ring |
| 2:00 | Four Ember Wisps drift toward the village | Ora Bolt, soft lock | Bolt button pulses; nearest wisp is highlighted |
| 2:20 | Six more wisps. "Stop shooting. Gather the light." | Gather | Hold Gather: aura roars, dust ring, camera pushes in, Ora bar fills |
| 2:45 | **Ora Awakening**: holding Gather at full Ora triggers a 1.5 s scripted burst. RES counter rolls 176 -> 880. Shockwave wipes the wisps. Banner "Resonance rising / התהודה עולה" | The number matters | Scripted spectacle |
| 3:10 | Land in the meadow. Two Tusk Boars charge (white glint on the hooves) | Lock-on, combo | Tap an enemy (touch) or press Lock (keyboard, gamepad). Five Attack taps = Strike String |
| 3:40 | A boar winds up with a **red** notched ring. Time slows to 30% for 1 s | Flicker Step | Dash button pulses in the slow-mo; success = afterimage, Tavi reappears behind the boar |
| 4:00 | Hold Attack = Breaker: the boar is launched into a boulder, which shatters | Heavy, environment | One-fight hint strip "tap tap tap, hold" |
| 4:30 | Level 2 lands as the boulder shatters (step 7 of MQ1 grants 60 XP). Fanfare, light pillar, banner; the three points are applied by the Balanced style with no pause | Levelling | A badge on the medallion points to the Character screen, where the style (or Manual) is chosen |
| 5:00 | Fly to Sparkstead (light pillar on the compass). Touch the Ringstone: autosave icon | Ringstone | Interact pill appears |
| 5:30 | Talk to Dov (3 Sunfruit) and Mira (Training Wraps, equip prompt opens on the item) | NPCs, items | Talk pill |
| 6:30 | Choir raid at the well: 3 Acolytes and 1 Caster | Guard | White glint: Guard button pulses. Perfect guard = bell and "Perfect!" |
| 8:00 | Captain Durn, mini-boss with a poise bar | Poise, Break | First break shows a one-line hint |
| 9:00 | Durn flees. Kerrin lands. Race to Siphon Spire I, destroy its core | Siphons | Core opens every 8 s for 4 s |
| 9:40 | Sela grants **Ember Form** and the **Nova Ring** scroll; the map opens once showing the four remaining Siphons and three nearby optional pillars (shrine, ring race, side quest) | Forms, techniques, freedom | Form button appears; map closes; the player is free |

Tutorial rules: each prompt retires after the action succeeds twice; the pause menu has a Controls page; nothing is forced after 10:00; skipping the cold open keeps all prompts; with `tutorial=0` (and in test mode) the game starts at the Sparkstead Ringstone as if MQ1 were finished: flight, Gather and the Ora Awakening are granted, MQ2 is active, and the journey begins at level 1 without the MQ1 XP.

---

## 3. World map

### 3.1 Coordinates and limits
World units are metres. Origin (0,0) is the Spire. **+x = east, +z = south, +y = up.** North is -z. World square is 7168 x 7168 m (x and z from -3584 to +3584), sea level y = 0.

| Limit | Value |
|-------|-------|
| Island coastline | radius about 3100 m from the origin, noise-warped by +/-250 m |
| Veilstorm push-back begins | radius 3300 m (gust grows smoothly, Sela one-liner once) |
| Veilstorm hard turn-around | radius 3450 m (player is turned and carried back to 3300 m, no damage) |
| Flight ceiling | 1500 m (thrust fades between 1350 and 1500 m) |
| Highest terrain | about 700 m (Frostspine) |
| Day length | 24 real minutes (day 06:00-20:00 = 14 min, night = 10 min). New game starts at 07:00 |

### 3.2 Regions (P0 as terrain, palette, props and enemy tables; Stormwell is P0 as terrain and palette only, its content is P1)
| id | Region | עברית | Centre (x, z) | Levels | Terrain and mood | P0 enemies |
|----|--------|-------|---------------|--------|------------------|------------|
| `meadows` | Emberreach Meadows | אחו הגחלים | (-1300, 1400) | 1-6 | Rolling grass, red-leafed trees, kite poles, rivers; warm dawn gold | Ember Wisp, Tusk Boar, Choir Acolyte |
| `coast` | Saltglass Coast | חוף זכוכית המלח | (700, 2400) | 5-10 | White salt flats, turquoise shallows, glassy sea stacks and arches | Scuttlecrab, Choir Caster, Ember Wisp |
| `thornwood` | Thornwood | יער הקוצים | (-2200, -400) | 8-14 | Dense green-violet forest, mist, a gorge | Bramble Boar (variant), Choir Acolyte, Choir Caster, Ember Wisp |
| `rustdune` | Rustdune Wastes | ישימון החלודה | (2000, 700) | 13-20 | Copper dunes, iron-red mesas, a sinkhole | Rust Golem, Choir Caster, Choir Acolyte |
| `frostspine` | Frostspine Peaks | רכסי הכפור | (-400, -2300) | 19-26 | Highest mountains, snow, wind-carved ice | Frost Harrier, Choir Vanguard, Choir Acolyte |
| `stormwell` | Stormwell Basin | אגן הסערה | (2000, -1700) | P1 content (24-32) | Dark slate basin, flooded crystal marsh. In P0: low-detail terrain, palette and scatter, no enemies, camps, shrines or Ringstone | none in P0 (P1: Choir Vanguard, storm variants) |
| `spire` | Spire Heart | לב המעיין | (0, 0), radius 450 m | finale 24-28 | Pale crystal plateau, the Spire, floating Crown shards | Choir Vanguard (finale only) |

Region of a point = nearest region centre by noise-warped distance; `spire` overrides inside its radius. Enemy level = region band interpolated by distance from Sparkstead side to far side, clamped to the band. Danger is fixed per region; the player may go anywhere at any time.

### 3.3 Landmarks (authored)
| id | Name | עברית | Type | (x, z) | Notes | Tag |
|----|------|-------|------|--------|-------|-----|
| `sparkstead` | Sparkstead | בית הניצוץ | Start village: Ringstone, Dov's stall, Mira, 8 houses, windmill, well | (-1430, 1580) | Flatten stamp r 110 | P0 |
| `selas_ledge` | Sela's Ledge | מדף סלע | Tutorial training ground | (-1650, 1860) | Plateau stamp r 60, +40 m, training posts | P0 |
| `haven_aster` | Haven Aster | מעגן אסטר | Main town: Ringstone, market, 16 buildings, kite tower | (-360, 1150) | Flatten r 160 | P0 |
| `siphon_1` | Siphon Spire I | מגדל יניקה I | Story objective | (-1000, 720) | Flatten r 50 | P0 |
| `windmill_run` | Windmill Run | מרוץ הטחנה | Ring race start | (-1200, 1250) | | P0 |
| `saltglass_arches` | Saltglass Arches | קשתות זכוכית המלח | Landmark arches, Ringstone, ring race start | (1150, 2800) | Arch stamps | P0 |
| `tide_beacon` | The Tide Beacon | משואת הגאות | Lighthouse with a great lens ring and signal kites; Bren, Ringstone | (150, 2950) | Flatten r 40 | P0 |
| `siphon_3` | Siphon Spire III | מגדל יניקה III | Story objective on a sea cliff | (860, 2300) | | P0 |
| `talias_camp` | Talia's Camp | המחנה של טליה | Ringstone, herbalist shop | (-1800, 150) | Flatten r 40 | P0 |
| `siphon_2` | Siphon Spire II | מגדל יניקה II | Story objective | (-2150, -215) | | P0 |
| `bramble_hollow` | Bramble Hollow | חלול הסנה | Boss arena (gorge basin r 90) | (-2580, -860) | Basin stamp | P0 |
| `copperwatch` | Copperwatch | מצפה הנחושת | Desert outpost: Ringstone, Yael's shop | (1580, 430) | Flatten r 80 | P0 |
| `burrow_pit` | Burrow King's Pit | בור מלך המחילות | Boss arena (sinkhole r 110) | (2300, 140) | Basin stamp | P0 |
| `siphon_4` | Siphon Spire IV | מגדל יניקה IV | Story objective | (1860, 1150) | | P0 |
| `ridgerest` | Ridgerest | מנוחת הרכס | Mountain village: Ringstone, provisioner | (-860, -2000) | Flatten r 90 | P0 |
| `still_wind` | Monastery of the Still Wind | מנזר הרוח הדוממת | Abbess Noa, Ringstone, three wind bells | (-300, -2500) | Flatten r 70 | P0 |
| `paleglass_summit` | Paleglass Summit | פסגת הזכוכית החיוורת | Boss arena (flattened peak r 100) | (100, -2750) | Spire stamp + flatten | P0 |
| `siphon_5` | Siphon Spire V | מגדל יניקה V | Story objective | (-1400, -2300) | | P0 |
| `stormwatch` | Stormwatch Camp | מחנה משמר הסערה | Ringstone, vista | (1500, -1900) | Flatten r 40 | P1 |
| `stormwell_eye` | Stormwell Eye | עין הסערה | Lake basin (P0: terrain and a discovery point only; P1: lightning spire and boss arena) | (2100, -1800) | Basin stamp | P0 terrain |
| `spire_approach` | Spire Approach | שער המעיין | Ringstone before the finale | (0, 520) | | P0 |
| `dim_court` | The Dim Court | החצר העמומה | Finale arena (terrace r 120) | (0, 300) | Flatten | P0 |
| `wellspring_spire` | Wellspring Spire | מגדל המעיין | 900 m crystal pillar visible from everywhere | (0, 0) | Collider capsule r 60 | P0 |
| `shattered_crown` | Shattered Crown | הכתר המנופץ | About 40 floating rocks at 500-900 m altitude, 300-700 m from the Spire; sphere colliders, chests float among them | around (0, 0) | Landable tops are P1 | P0 decor |
| `weeping_falls` | Weeping Falls | המפלים הבוכים | Training ground | (-2000, -1290) | | P1 |
| `iron_graveyard` | Iron Graveyard | בית הקברות של הברזל | Machine wrecks, golem nest | (2600, 1000) | | P1 |
| `drowned_observatory` | Drowned Observatory | מצפה הכוכבים הטבוע | Ruin | (1500, -1250) | | P1 |

### 3.4 Minor points of interest
| Type | Count | Placement | Tag |
|------|-------|-----------|-----|
| Ringstones | 9 | Sparkstead, Haven Aster, Saltglass Arches, Tide Beacon, Talia's Camp, Copperwatch, Ridgerest, Still Wind, Spire Approach (Stormwatch: P1) | P0 |
| Ora Shrines | 10 | (-1900, 1100), (-700, 1750), (300, 2450), (1500, 2400), (-2600, 100), (-1900, -900), (2450, 600), (1500, 1200), (-1300, -1900), (400, -2350). Two more in the Stormwell, (1900, -1300) and (2350, -1500): P1 | P0 |
| Enemy camps | 25 | 5 in each of Meadows, Coast, Thornwood, Rustdune and Frostspine, seeded placement, at least 250 m from settlements and 300 m apart; each camp has a spawn group and a chest that unlocks when the camp is cleared; camps refill after one in-game day | P0 |
| Treasure chests (free-standing) | 26 | 4 in each of the same five regions on peaks, sea stacks, ledges; 6 more float in the Shattered Crown | P0 |
| Ring race course | 1 | Windmill Run (Meadows, 14 gates) | P0 |
| Ring race courses | 5 more | Arch Dash (Coast, 18 gates) and one each in Thornwood, Rustdune, Frostspine, Stormwell | P1 |
| Echo Stones (lore) | 30 | cliffs, crown shards | P1 |

Placement rule: no point of the six content regions (every region except the Stormwell) is more than 500 m from a landmark or minor point of interest. Landmarks must be tall or glowing enough to read from 1.5 km; Ringstones and Siphons have light pillars.

---

## 4. Progression

### 4.1 Levels and XP (P0)
- **Level cap 40.** `xpToNext(L) = round(60 * L^1.5 + 40 * L)` (L1 = 100, L5 = 871, L10 = 2297, L20 = 6167, L26 = 8994).
- Enemy XP: `xp = round(12 * Le^1.3 * xpMult)`. Enemy 5-7 levels below the player: x0.5; 8 or more below: x0.25; 4 or more above: x1.5. Bosses use xpMult 6.
- Bonus XP, as a share of the player's current `xpToNext`: silencing a Siphon 15%; clearing a camp 10% the first time and 3% for a refilled camp.
- Each level grants **3 stat points** and **1 TP**, and fully restores HP and Ora. A level-up never opens a screen and never pauses: banner, light pillar, and the points are applied by the chosen style (section 4.2).
- Pacing targets: L10 at 40-50 min, L20 at 110-130 min, L25 or more when MQ7 starts (4-5 h; the finale is recommended for 24-28), L40 in post-game.
- XP budget. This route is data in `balance.js` and is simulated by `tests/core/balance.test.mjs`, which asserts the three pacing targets. If the test fails, enemy `xpMult` values and the bonus percentages are tuned; the level curve and the route stay fixed.

| Band | Minutes | Levels | Kills per minute (average, travel included) | Enemy level and average xpMult | Quest XP | Camps cleared | Siphons | Bosses | Discoveries |
|------|---------|--------|---------------------------------------------|--------------------------------|----------|---------------|---------|--------|-------------|
| A: Meadows, first steps on the Coast | 0-45 | 1 -> 10 | 1.8 | player level, 0.85 | MQ1 100, MQ2 300, SQ1-SQ3 550 | 5 | 1 | Durn | 25 |
| B: Coast, Thornwood, Rustdune | 45-120 | 10 -> 20 | 0.8 | player level, 1.2 | MQ3 900, MQ4 600, MQ5 1500, SQ4 800 | 10 | 3 | Bramblehorn, Gorrumaw | 40 |
| C: Frostspine, Spire Heart | 120-270 | 20 -> 25 or more | 0.4 | player level, 1.5 | MQ6 2200 | 6 | 1 | Iskra | 30 |

### 4.2 Stats (P0)
Four stats, each starts at 5.
| id | Stat | עברית | Effects |
|----|------|-------|---------|
| `mgt` | Might | עוצמה | Melee rating, poise damage |
| `spr` | Spirit | רוח | Ora rating, max Ora, Ora regen, Gather rate |
| `vit` | Vitality | חיוניות | Max HP, defense |
| `swf` | Swiftness | זריזות | Run, flight and boost speed, cooldown reduction, crit chance |

Allocation styles (applied automatically at each level-up, chosen in the Character screen): Brawler (2 mgt, 1 vit), Blaster (2 spr, 1 swf), Balanced (default: cycle mgt, spr, vit, then swf every fourth point), Manual / ידני (points are banked; a badge on the medallion shows unspent points). Respec at Sela for `150 * L` Shells: P1.

### 4.3 Derived values (P0, all in `formulas.js`)
| Value | Formula | L1, all stats 5 |
|-------|---------|-----------------|
| Max HP | `100 + 18*vit + 6*L`, then x(1 + hpPct) | 196 |
| Max Ora | `100 + 5*spr`, then x(1 + oraPoolPct) | 125 |
| Ora regen | `(3 + 0.05*spr)` per s out of combat, x(1 + oraRegenPct); x0.5 in combat; x0.5 inside a Siphon zone; **0 while boosting, while in a Form and during Burnout** | 3.25 |
| Gather rate | `(35 + 1.0*spr)` Ora per s, x(1 + gatherPct) | 40 |
| Melee rating | `20 + 4*mgt + 3*L` | 43 |
| Ora rating | `20 + 4*spr + 3*L` | 43 |
| Defense | `2*vit + L + gearDef` | 11 |
| Crit chance | `min(0.35, 0.05 + 0.003*swf)`; crit damage x1.5 | 6.5% |
| Run speed | `min(12, 9 + 0.04*swf)` m/s; sprint x1.6 | 9.2 |
| Flight cruise | `min(42, 30 + 0.2*swf)` m/s | 31 |
| Boost speed | `min(120, 75 + 0.8*swf)` m/s, x(1 + boostSpeedPct); Sonic stage x1.5 | 79 |
| Cooldown reduction | `min(0.30, 0.004*swf)` | 2% |

### 4.4 Resonance (P0)
```
RES = round( 40 * (mgt + spr + vit + swf) * (1 + 0.1*L) * (1 + gearResPct) * formResMult * gatherMult * awakenMult )
```
- `awakenMult` = 0.2 before the Ora Awakening, 1 after. `gatherMult` ramps 1.00 -> 1.15 over 1 s of Gathering (the number climbs while you roar). `formResMult`: Base 1, Ember 1.5, Tempest 2.5, Zenith 6.
- Examples: L1 = 880. L10 with 47 stat points = 3,760. L30 with 107 points = 17,120; in Tempest 42,800; in Zenith 102,720.
- Enemy Resonance: `round(40 * (20 + 3*(Le-1)) * (1 + 0.1*Le) * tierMult)`, tierMult: grunt 1, heavy 1.5, elite 2, boss 4.
- Lock-on shows the enemy number tinted by ratio to the player: grey below 50%, white, amber above 130%, red pulsing with "Danger / סכנה" above 200%.
- Milestone banners at RES 1,000 / 5,000 / 10,000 / 25,000 / 50,000 / 100,000.

### 4.5 Technique Points (P0)
Sources: 1 per level (39), 1 per Ora Shrine (10), main quests (6) = 55. All P0 ranks cost 55. A level-26 player has about 41: choices matter.

---

## 5. Techniques and Forms

### 5.1 Actions (device layouts are in ART_UX.md section 6)
| Action id | Meaning |
|-----------|---------|
| `attack` | tap = Strike String; hold 0.35 s = Breaker (Meteor Heel in the air) |
| `bolt` | tap or hold = Ora Bolt (hold auto-fires) |
| `dash` | press = Flicker Step; held 0.2 s or longer = sprint on the ground, boost in flight (touch: a double tap latches boost) |
| `guard` | hold = Guard |
| `jump` | tap = jump; tap again in the air = take off; hold in flight = ascend (fine control; with camera-pitch flight the view steers climbs and dives) |
| `descend` | hold in flight = sink; touching the ground lands |
| `gather` | hold = Gather |
| `tech1`, `tech2` | cast the technique in slot 1 or 2 (hold to charge if chargeable) |
| `ultimate` | cast the Ultimate when Surge is 100 |
| `form` | transform into the selected Form, or revert |
| `lock` | lock on, switch target, release (touch has no Lock button: tap an enemy to lock, swipe the target frame to switch, tap it to release) |
| `interact`, `item`, `map`, `pause` | talk or use, use the quick item, map, pause |

### 5.2 Damage rule (P0)
```
damage = max(1, round( power * rating * 100 / (100 + targetDefense)
                       * attackerDmgMult / targetDefMult * critMult * rand(0.95, 1.05) * difficultyMult ))
rating      = Melee rating for melee hits, Ora rating for Ora hits
charged     : power *= lerp(1.0, 2.5, (hold - min) / (max - min))
enemy hits  : rating = ATK(Le) of the enemy (section 7.1)
```

### 5.3 Technique table
Cooldowns are before Swiftness reduction. "Poise" is poise damage per hit. Knock classes: push (4-10 m/s), launch (up 14 m/s), smash (horizontal 30 m/s), spike (down 35 m/s), radial (outward 18 m/s). Any knock of 18 m/s or more puts the target in the **Hurtle** state (section 6.3).

| id | Technique | עברית | Slot | Ora | CD | Power | Poise | Knock | Unlock | Ranks | Tag |
|----|-----------|-------|------|-----|----|-------|-------|-------|--------|-------|-----|
| `strike_string` | Strike String | שרשרת מכות | core | 0 | - | 0.30 / 0.30 / 0.35 / 0.40 / 0.60 | 4/4/5/6/10 | hit 5: push 10 | start | R2 (2 TP): sixth hit 0.80 spin kick; R3 (3 TP): x1.2 damage | P0 |
| `breaker` | Breaker | שובר | core | 0 | 0.8 s | 1.2, charged to 2.4 over 1.0 s | 30 | ground: launch; after 3+ string hits: smash | start | R2 (2 TP): breaks enemy guard, +50% poise | P0 |
| `meteor_heel` | Meteor Heel | עקב המטאור | core (Breaker in the air) | 8 | 3 s | 1.6 | 30 | spike; ground impact = slam, crater r 6 | level 4 | R2 (2 TP): +25% damage, crater r 9 | P0 |
| `pursuit` | Pursuit | מרדף | core (Dash within 1.0 s after launching or smashing a target) | 8 | - | next hit +0.3 | - | teleport beside the flying target | start | - | P0 |
| `ora_bolt` | Ora Bolt | קליע אורה | core | 6 | 0.2 s | 0.22; full damage up to 30 m, falling to 50% at 90 m | 2 | none | start | R2 (2 TP): twin bolts, each 0.6 x power; R3 (3 TP): pierces 1 target | P0 |
| `flare_barrage` | Flare Barrage | מטר להבות | slot | 3 per bolt | 5 s | 0.20 per bolt, 10 bolts per s, up to 2.5 s (5.0 in total) | 1 | none | level 3 + 1 TP | R2 (2 TP): final big bolt 1.5, push 10 | P0 |
| `dawn_lance` | Dawn Lance | רומח השחר | slot | 30 + 15 per s of charge | 8 s | beam 60 m, 1.6 s, tick 0.1 s x 0.16 (2.56 in total); charge 0.5-2.0 s scales x1 to x2.5 (6.4 in total) | 6 per tick | push 8 | MQ4 | R2 (2 TP): beam radius 1.2 -> 1.8 m; R3 (3 TP): x1.3 damage | P0 |
| `nova_ring` | Nova Ring | טבעת נובה | slot | 30 | 10 s | 1.8, radius 10 m | 25 | radial | MQ2 | R2 (2 TP): radius 14 m; R3 (3 TP): burning ring, 0.3 per 0.5 s for 3 s | P0 |
| `ringfall` | Ringfall (Ultimate) | צלילת הטבעת | ultimate | Surge 100 | - | 16.0 at centre to 8.0 at 22 m | 100 | radial; crater r 20, depth 5 | MQ3 | R2 (3 TP): x1.3 damage | P0 |
| `guard` | Guard | הגנה | core | 3 per blocked hit | - | - | - | - | start | - | P0 |
| `flicker_step` | Flicker Step | צעד הבהוב | core | 8 | 0.5 s | - | - | 7 m vanish, 0.3 s invulnerable | start | R2 (2 TP): cost 4 | P0 |
| `boost` | Boost and Sonic Boost | האצה | core | 6 per s; Sonic 10 per s | - | - | - | - | start (flight) | Sonic stage after 2 s of continuous boost | P0 |
| `gather` | Gather | איסוף | core | gains Gather rate | - | - | - | - | MQ1 | R2 (2 TP): -25% damage taken while Gathering | P0 |
| `seeker_motes` | Seeker Motes | ניצוצות צייד | slot | 25 | 7 s | 6 x 0.6 homing | 3 | none | level 12 + 2 TP | | P1 |
| `comet_drive` | Comet Drive | מעוף השביט | slot | 30 | 9 s | 2.2 rush through enemies | 30 | smash | level 16 + 2 TP | | P1 |
| `ora_barrier` | Ora Barrier | מחסום אורה | slot | 30 | 12 s | reflects bolts 1.5 s | - | - | level 8 + 1 TP | | P1 |
| `ora_sense` | Ora Sense | חוש אורה | utility | 15 | 20 s | reveals enemies and POIs within 400 m | - | - | side quest | | P1 |
| `ninefold_lantern` | Ninefold Lantern (Ultimate 2) | תשעת הפנסים | ultimate | Surge 100 | - | nine converging beams | - | - | Stormwell chapter | | P1 |

Passives (P0, bought with TP in the same list): **Iron Fists I-III** (+6% melee damage each; 1, 2, 3 TP), **Bright Core I-III** (+6% Ora damage each; 1, 2, 3 TP), **Deep Well I-II** (+10% max Ora each; 2, 3 TP), **Second Breath** (4 TP: once per 5 minutes a lethal hit leaves 1 HP and 2 s of invulnerability).

Balance rules asserted by `tests/core/balance.test.mjs`: (1) the sustained power per second of the Strike String (1.95 over 1.4 s = 1.39) is higher than that of Ora Bolt at the same rank count (0.22 per 0.2 s = 1.10; with twin bolts 1.32), so melee is the main damage and bolts are the ranged finisher; (2) the Ultimate's centre power (16) is higher than the full output of every slot technique at its highest P0 rank (Flare Barrage 6.5, charged Dawn Lance 8.3, Nova Ring 3.6); (3) for every level from 1 to 40, boost and every Form are a net Ora drain (passive regen is suspended while they run).

Loadout: core techniques are always available. Two technique slots hold any unlocked slot technique (three P0 choices). One Ultimate slot. The Techniques screen (P0) is a list in three branches: **Fist / אגרוף**, **Flare / להבה**, **Spirit / רוח**. A drawn ring-tree view is P1.

### 5.4 Detailed rules for core techniques (P0)
- **Strike String**: each hit 0.28 s; the first hit lunges up to 10 m toward the soft-lock target at 30 m/s (this is the rush attack; there is no separate button). From hit 2 onward the string can cancel into Flicker, Breaker, Bolt or a slot technique. Works identically in the air; the target hangs with 0.3 gravity while being juggled (max 4 s).
- **Breaker**: on a grounded target launches it 8-12 m up. If at least 3 string hits preceded it, it is a **smash**: horizontal 30 m/s, Hurtle. In the air it is Meteor Heel.
- **Guard**: blocks hits from the frontal 120 degrees. Blocked damage x0.2, 3 Ora per blocked hit; at 0 Ora the guard breaks (stagger 1 s). **Perfect guard** (Guard pressed at most 0.15 s before impact): no damage, attacker staggered 0.8 s, +8 Surge. Red telegraphs cannot be guarded.
- **Flicker Step**: 7 m in the stick direction (backward if neutral), invulnerable 0.3 s, leaves an afterimage. **Perfect Flicker** (an attack is avoided by the invulnerability within 0.2 s of its start): 0.4x slow motion for 0.5 s, if locked on reappear behind the target, +8 Surge. Pressing Dash always performs the Flicker at once (no input delay on the dodge); a Dash held for 0.2 s or longer then becomes sprint or boost, so every boost opens with a Flicker as its burst start.
- **Gather**: movement capped at 2 m/s, aura intensity and `gatherMult` ramp over 1 s; any damaging hit interrupts (0.5 s lockout). Allowed while transformed (this is how a Form is sustained).
- **Boost**: hold Dash in flight for 0.2 s or longer (touch: double-tapping Dash latches boost until the stick is released or Dash is tapped again). Costs 6 Ora per s. After 2 s of continuous boost: **Sonic Boost** (x1.5 speed, 10 Ora per s, sonic ring, speed lines). Passive regen is suspended while boosting, so a full level-1 pool gives about 20 s of boost or 12 s of Sonic Boost, and 3 s of Gather refill it: boost, gather, boost is the travel rhythm. At 0 Ora, boost drops to cruise flight, which is free. On the ground, holding Dash sprints (no cost).
- **Flight steering**: with **camera-pitch flight** (always on for touch; a setting for keyboard and gamepad, off by default) the stick moves Tavi along the camera's forward vector including its pitch, so one drag of the view up or down climbs or dives while the left thumb keeps steering and the boost stays latched. Jump (rise) and Descend (sink) remain as fine control.
- **Dawn Lance**: an original one-arm pose. The sash winds around the leading forearm into a ring of light in front of one outstretched palm; charging spins the ring faster and widens it; the beam fires through the ring while the other arm is swept back for balance.
- **Ora Awakening** (MQ1 only): scripted; sets `awakened`.

### 5.5 Forms
Identity: **the body becomes a lantern.** Light leaks through glowing vein seams, the sash ignites into a ribbon of light, then an outer mantle of light forms. Hair, skin and eyes keep their own colours and shape in every Form: hair never lifts, never spikes and never turns gold; only the irises take a tint of the Form colour.

| id | Form | עברית | Unlock | Activate | Drain | Damage dealt | Damage taken | Speed | RES | Extra | Tag |
|----|------|-------|--------|----------|-------|--------------|--------------|-------|-----|-------|-----|
| - | Base | בסיס | - | - | - | x1 | /1 | x1 | x1 | Ora colour teal-white | P0 |
| `ember` | Ember Form | צורת גחלת | end of MQ2 | 40 Ora | 3 Ora/s | x1.25 | /1.10 | x1.10 | x1.5 | Amber-peach seams, sash becomes a ribbon of light, drifting ember motes (no body-wide flame) | P0 |
| `tempest` | Tempest Form | צורת סערה | MQ6 | 70 Ora | 5 Ora/s | x1.60 | /1.20 | x1.25 | x2.5 | Flicker cost halved; indigo-white seams, four-ribbon mantle, two swept wind-vanes of light at the temples, paper-cut wind ribbons circling the body (no lightning) | P0 |
| `zenith` | Zenith Form | צורת השיא | scripted in the MQ7 finale (no drain there) | free use: 150 Ora | free use: 10 Ora/s | x2.2 | /1.40 | x1.35 | x6 | The body keeps its own colours; prism light runs only in the seams and the sash; six floating crystal blades fan out behind the shoulders | P0 scripted, P1 free use at level 36 after the ending |
| `eclipse` | Eclipse Form | צורת ליקוי | Kerrin chapter | 110 Ora | 8 Ora/s and 0.5% HP/s | x1.9 | /1.3 | x1.3 | x4 | Attacks drain enemy Ora | P1 |

Rules: transforming takes 1.2 s, invulnerable (0.5 s short version after the first use of each Form), with an 8 m shockwave that pushes enemies back. Passive Ora regen is 0 while a Form is active: Gather is the only way to sustain it. A Form ends when Ora reaches 0, when the player presses Form again, or below 10% HP. Reaching 0 Ora causes **Burnout / שחיקה**: 5 s without Ora regen, 12 s before transforming again. The Form button transforms into the highest unlocked Form; long-press cycles the selected Form.

### 5.6 Surge (P0)
0-100. Gains: +1.5 per melee hit dealt, +0.5 per Ora hit dealt, +8 per perfect guard or perfect Flicker, +4 per wall slam, +2 per 5% of max HP lost. Decays 2 per s after 12 s out of combat. At 100 the Ultimate button appears and pulses.

---

## 6. Combat rules

### 6.1 Targeting (P0)
- **Soft lock** is always on: attacks aim at the best target in a 60-degree cone within 25 m (melee) or 90 m (Ora). Touch players never need hard lock in normal fights.
- **Hard lock**: tap an enemy (touch) or press Lock (keyboard, gamepad); the camera frames both; swipe the target frame (touch), flick the right stick or press Tab to switch. Breaks beyond 150 m or after 2 s without line of sight.

### 6.2 Combos and juggling (P0)
Strike String -> Breaker launches -> Dash = Pursuit -> air string -> Meteor Heel spikes the target into the ground (slam, crater). Three string hits -> Breaker = smash into scenery.

### 6.3 Knockback, Hurtle, slams, craters, destruction (P0)
- A target knocked at 18 m/s or more is in **Hurtle / העפה**: ballistic, spinning, dust trail, cannot act.
- A hurtling target that meets terrain or a solid prop at 14 m/s or more takes a **wall slam**: extra damage equal to 30% of the hit that launched it, +4 Surge for the attacker, 70 ms hit-stop, debris; rocks and trees in the way shatter.
- **Craters**: slams, Meteor Heel, Ringfall and boss slams mark the ground. Radius under 6 m: scorch decal and rubble ring only. Radius 6 m or more: the terrain is really deformed (bowl with a raised rim). Craters last for the session and are not saved.
- **Destructibles**: boulders, rock pillars, trees, crates. They have HP, shatter into debris, may drop Shells, and return when the game is reloaded.

### 6.4 Poise and stagger (P0)
Enemies have Poise (section 7). Hits subtract poise damage; poise refills fully 3 s after the last hit. At 0: **Break**: stagger 2 s (bosses 3 s) during which damage taken is +25%. Grunts with poise 0 flinch on every hit. The player is only staggered by guard break and by red or violet attacks.

### 6.5 Enemy telegraphs (P0)
| Kind | Colour and shape | Meaning | Answer |
|------|------------------|---------|--------|
| white | white glint and expanding plain ring | blockable | Guard (or perfect guard) |
| red | red notched ring and a triangle icon | unblockable | Flicker Step |
| violet | violet spiral | grab or Ora drain tether | Flicker, or hit the caster to interrupt |
Wind-ups last 0.5-1.2 s (bosses 0.8-2.0 s). Off-screen attacks show an arc at the screen edge.

### 6.6 Air and ground (P0)
The player fights anywhere. Ground-only enemies throw rocks or leap at a flying player; if the player hovers more than 12 m above ground-only enemies for 6 s they disengage, take cover and return to full HP, so hovering out of reach never wins a fight (together with the range falloff of Ora Bolt, section 5.3). Flying enemies keep 10-30 m and flank.

### 6.7 Encounter limits (P0)
At most **4 enemies attack at once** on Warrior (2 melee tokens, 2 ranged tokens); the rest circle and taunt. At most 12 enemies are active near the player on the low tier and 24 on high.

### 6.8 Death and respawn (P0)
HP 0 -> "Your light fades / האור שלך דועך" (1.5 s slow motion) -> choice: **Rise at the Ringstone** (last touched, full HP and Ora, 3 s invulnerable) or, during a boss fight, **Retry** (arena entrance, boss fully reset, consumables used in the attempt are refunded). No loss on Story and Warrior; on Master 10% of carried Shells are lost. Falling below sea level far from shore or entering the Veilstorm returns the player to land with no damage. Swimming is a slow surface mode; taking off from water is allowed.

### 6.9 Difficulty (P0; chosen per journey, stored in the save, changeable any time in Settings > Gameplay)
| | Story / סיפור | Warrior / לוחם (default) | Master / אמן |
|---|---|---|---|
| Enemy damage | x0.5 | x1.0 | x1.4 |
| Enemy HP | x0.75 | x1.0 | x1.25 |
| Telegraph time | x1.3 | x1.0 | x0.85 |
| Perfect windows | x1.5 | x1.0 | x1.0 |
| Simultaneous attackers | 2 | 4 | 6 |
| XP and Shells | x1.0 | x1.0 | x1.2 |

### 6.10 P1 and P2 combat features
Beam clash (P1), elite affixes and night "Gloam" variants (P1), auto-combo accessibility mode (P1), ally Kerrin in fights (P1), persistent craters (P2).

---

## 7. Enemies and bosses

### 7.1 Scaling (P0)
```
HP(Le)     = round( hpMult  * (40 + 12*Le + 0.35*Le^2) * difficultyHp )     // mult 1: L1 52, L10 195, L20 420, L30 715
ATK(Le)    = atkMult * (8 + 4*Le)                                           // hit damage = movePower * ATK * 100/(100 + playerDefense) * difficultyDmg
DEF(Le)    = defMult * 2 * Le
Shells(Le) = round( (3 + 1.2*Le) * shellMult )
XP(Le)     = round( 12 * Le^1.3 * xpMult )
```
Targets asserted by unit tests (Warrior, same level, typical allocation, no gear): a grunt with hpMult 1 dies to 1-2 Strike Strings; a full-HP player survives 9-18 grunt hits.

### 7.2 Roster
| id | Enemy | עברית | Regions | Lv | Moves as | Brain | hp / atk / def / xp / shells | Poise | Attacks (telegraph, power) | Tag |
|----|-------|-------|---------|----|----------|-------|------------------------------|-------|----------------------------|-----|
| `ember_wisp` | Ember Wisp | רוח גחלת | Meadows, Coast, Thornwood | 1-10 | fly | ranged | 0.5 / 0.6 / 0.5 / 0.5 / 0.5 | 0 | `wisp_spit` slow fireball (white, 0.8); `wisp_dive` when alone (red, 1.4, self-destructs) | P0 |
| `tusk_boar` | Tusk Boar | חזיר חט | Meadows | 1-8 | ground | charger | 1.0 / 1.0 / 1.0 / 1.0 / 1.0 | 20 | `boar_gore` (white, 0.9); `boar_charge` 20 m (white, 1.3, smash) | P0 |
| `bramble_boar` | Bramble Boar (variant of Tusk Boar) | חזיר הסנה | Thornwood | 8-14 | ground | charger | 1.2 / 1.1 / 1.0 / 1.1 / 1.0 | 25 | as Tusk Boar; second chained charge is red | P0 |
| `choir_acolyte` | Choir Acolyte | חניך המקהלה | Meadows, Thornwood, Rustdune, Frostspine | 2-28 | ground | melee | 1.0 / 1.0 / 1.0 / 1.0 / 1.2 | 25 | `acolyte_string` 3 hits (white, 0.6 / 0.6 / 0.9); `acolyte_rush` shoulder rush (red, 1.4); guards 30% of the time | P0 |
| `choir_caster` | Choir Caster | מטיל המקהלה | Coast, Thornwood, Rustdune (and the scripted MQ2 raid) | 4-28 | hover | ranged | 0.8 / 1.2 / 0.8 / 1.1 / 1.2 | 15 | `caster_volley` 3 bolts (white, 0.6 each); `caster_tether` drains 15 Ora per s for 2 s (violet), keeps 25 m | P0 |
| `scuttlecrab` | Scuttlecrab | סרטן סלע | Coast | 5-12 | ground | melee | 1.6 / 0.9 / 1.6 / 1.3 / 1.3 | 50 | frontal shell: hits from the front 120 degrees deal 20% unless staggered; `crab_pinch` (white, 1.0); `crab_slam` r 4 m (red, 1.5) | P0 |
| `rust_golem` | Rust Golem | גולם חלודה | Rustdune | 13-22 | ground | melee | 3.0 / 1.5 / 2.0 / 3.0 / 3.0 | 80 | `golem_hammer` 2 hits (white, 1.2); `golem_stomp` shockwave r 8 m, jumpable (red, 1.6); `golem_boulder` thrown at flyers (white, 1.2) | P0 |
| `storm_golem` | Storm Golem (variant) | גולם סערה | Stormwell | 24-32 | ground | melee | 3.0 / 1.5 / 2.0 / 3.0 / 3.0 | 90 | as Rust Golem | P1 |
| `frost_harrier` | Frost Harrier | נץ הכפור | Frostspine (Stormwell variant: P1) | 19-28 | fly | diver | 0.9 / 1.3 / 0.8 / 1.2 / 1.0 | 15 | circles high; `harrier_dive` (red streak, 1.5); `harrier_gust` (white, 0.7) | P0 |
| `choir_vanguard` | Choir Vanguard | חלוץ המקהלה | Frostspine, Spire Heart | 22-28 | fly | melee (duelist params) | 2.5 / 1.5 / 1.5 / 4.0 / 4.0 | 60 | `vanguard_string` 4 hits (white); `vanguard_lance` beam after 1 s charge (white, 0.25 per tick); `vanguard_smash` (red, 1.6); flickers away from 25% of bolts | P0 |
| `thornstalker`, `mire_moth`, `dune_wyrmling`, `rimeback_brute`, `storm_ray`, `skyshard_sentinel` | six more archetypes | | | | | | | | ambusher, area denial, burrower, grappler, beam flyer, turret | P1 |

Tiers for Resonance and loot: wisp, boar, acolyte, caster, crab, harrier = grunt; golems = heavy; vanguard = elite.

### 7.3 Bosses (P0: five; each has an arena, a 3 s intro shot with a name card, a segmented HP bar and a poise bar; leaving the arena radius + 60 m resets the fight, and re-entering the arena starts it again without the intro)
| id | Boss | עברית | Arena, level | hpMult, poise | Phases | Signature moves | Reward | Tag |
|----|------|-------|--------------|---------------|--------|-----------------|--------|-----|
| `durn` | Acolyte Captain Durn | קפטן דורן | Sparkstead well, L4 | 6, 80 | 1 | 4-hit string (white), shoulder charge (red), calls 2 Acolytes at 50% HP, flees at 0 | MQ2 progress | P0 |
| `bramblehorn` | Bramblehorn | קרן הסנה | Bramble Hollow, L12 | 14, 200 | 2 | Phase 1: horn charges that tear furrows (white), antler sweep (white). Phase 2 at 50%: root lines burst from the ground (red), leap from the gorge wall with a ground shadow (red, crater r 8) | MQ3 progress | P0 |
| `gorrumaw` | Gorrumaw, the Burrow King | גורומאו, מלך המחילות | Burrow King's Pit, L18 | 18, 250 | 2 | Phase 1: rolls as an armoured ball (bounces off walls; frontal armour like the crab; Breaker R1 staggers it only from behind), quake slams (red rings). Phase 2 at 50%: armour shatters (defense x0.5), berserk combos and rock rain (red circles) | MQ5 progress | P0 |
| `iskra` | Iskra Pale-Wing | איסקרה חיוורת הכנף | Paleglass Summit, L22 | 16, 220 | 2 | Aerial duelist. Phase 1: ice-blade strings, Flickers, ice spears from four sides (red lines). Phase 2 at 50%: blizzard (fog close-in) and Shatterdive from 200 m (red pillar, crater r 12) | MQ6 progress | P0 |
| `vorrhal` | Vorrhal the Dimmed | וורהאל העמום | The Dim Court, L26 | 24 (+10% per Siphon still standing), 300 | 3 | Phase 1: duel with drain tethers (violet) and void-glass bolts. Phase 2 at 60%: rises to the Spire wall, hurls Spire crystals (red circles), summons 2 Vanguards. Phase 3 at 25% (script `finale_tethers`): he drains the player to 0 Ora and roots himself to the Spire inside a siphon-glass shell. The Veins the player freed surface around the Court as **tethers of light**, one per silenced Siphon. The player flies to each, takes hold of it (Interact) and carries it to the Spire's base while the Vanguards harass; each threaded tether refills Ora and cracks the shell. The last one wakes **Zenith Form** (scripted, no drain), and the final exchange ends with a scripted Ringfall | Ending; free roam continues | P0 |
| `thalvek`, `kerrin_tethered` | Thalvek the Stormbound; the Tethered Rival | תלווק; היריב הכבול | Stormwell Eye; Shattered Crown | - | 3 | Storm chapter with a beam clash; Kerrin is captured and wired into a living Siphon, and the fight is to cut him free | Ninefold Lantern; Eclipse Form | P1 |

Boss rewards: the technique, Form, gear and TP tied to a boss are delivered by the rewards of its quest (section 8.2) and are counted once. A boss itself gives only its XP (xpMult 6), Shells and a `boss` loot roll.

---

## 8. Quests

### 8.1 Step types (P0 unless noted)
| Type | Params | Completes when |
|------|--------|----------------|
| `talk` | npcId, dialogueId | the dialogue ends |
| `goto` | x, z, radius, optional minAlt | the player is inside |
| `kill` | enemyId or tag, count, optional regionId | enough matching enemies died by the player's hand |
| `defeat` | bossId | the boss is defeated |
| `collect` | itemId, count | the inventory holds the count |
| `deliver` | itemId, count, npcId | talked to the NPC while holding the items (they are removed) |
| `interact` | objectId or list of objectIds | every listed object was used |
| `destroy` | objectId | the object's HP reached 0 |
| `useTechnique` | techId, count, optional targetTag | used (and hit, if a target tag is given) |
| `reach` | level or flag | the condition holds |
| `race` | courseId, medal | finished with at least the medal |
| `script` | scriptId | the registered script calls `done()` (tutorial beats, cutscenes, finale) |
| `survive`, `timeOfDay`, `choice`, `escort` | | P1, P1, P1, P2 |

Every step has an objective string, an optional map marker, and optional `onStart` / `onComplete` action lists (give item, XP, Shells, TP, unlock technique or Form, set flag, spawn group, set hour, toast, banner, teleport, heal, start quest, run script). Several quests may be active; one is tracked on the HUD.

### 8.2 Main story (P0: seven quests)
MQ1 and MQ2 are linear. Then **MQ3, MQ4, MQ5 and MQ6 are open in any order.** MQ7 unlocks when at least **four of the five Siphons** are silenced (Siphon I plus any three of the others). A Siphon left standing gives Vorrhal +10% HP.

| id | Title | עברית | Rec. level | Steps | Rewards |
|----|-------|-------|-----------|-------|---------|
| `mq1` | The Spark | הניצוץ | 1 | 1 script `tut_move` (reach the post) · 2 destroy `training_post` · 3 script `tut_fly` (jump, take off, 3 rings) · 4 script `tut_boost` (ring line) · 5 kill 4 `ember_wisp` · 6 script `tut_awakening` (Gather to full, scripted burst) · 7 kill 2 `tusk_boar` (scripted slow-motion on the first red telegraph; completing it grants 60 XP, so level 2 lands at the end of the fight) · 8 interact `ringstone_sparkstead` | 40 XP at the Ringstone (100 with step 7), flight, Gather |
| `mq2` | Smoke over Sparkstead | עשן מעל בית הניצוץ | 2-5 | 1 talk `dov` (3 Sunfruit) · 2 talk `mira` (Training Wraps) · 3 kill 3 `choir_acolyte` and 1 `choir_caster` at the well · 4 defeat `durn` · 5 talk `kerrin` · 6 goto `siphon_1` · 7 destroy `siphon_1` · 8 talk `sela` | 300 XP, 150 Shells, Ember Form, Nova Ring, 1 TP, map markers for Siphons II-V |
| `mq3` | Roots of Rot | שורשי הריקבון | 8-12 | 1 talk `talia` · 2 kill 6 `bramble_boar` · 3 goto `bramble_hollow` · 4 defeat `bramblehorn` · 5 destroy `siphon_2` · 6 talk `talia` | 900 XP, 400 Shells, Ringfall, 1 TP |
| `mq4` | The Glass Tide | גאות הזכוכית | 5-10 | 1 talk `bren` at the Tide Beacon (she teaches Dawn Lance, the beacon's way of focusing light through a ring) · 2 useTechnique `dawn_lance` x3 on `saltglass_pillar` targets · 3 kill the wave of 8 that attacks the beacon · 4 destroy `siphon_3` · 5 talk `bren` | 600 XP, 300 Shells, Dawn Lance, Tide Charm, 1 TP |
| `mq5` | The Burrow King | מלך המחילות | 13-18 | 1 talk `yael` · 2 goto `burrow_pit` · 3 defeat `gorrumaw` · 4 destroy `siphon_4` · 5 talk `yael` | 1500 XP, 700 Shells, Wyrmhide Charm, 2 TP |
| `mq6` | Pale Wings | כנפיים חיוורות | 19-24 | 1 talk `noa` · 2 interact the three wind bells `bell_1..3` on the peaks around the monastery · 3 goto `paleglass_summit` · 4 defeat `iskra` · 5 talk `noa` (Tempest Form) · 6 destroy `siphon_5` | 2200 XP, 1000 Shells, Tempest Form, Frost Charm, 1 TP |
| `mq7` | The Last Vein | העורק האחרון | 24-28 | 1 talk `sela` at Spire Approach · 2 kill 3 `choir_vanguard` at the Court gate · 3 defeat `vorrhal` (its third phase is the tether-carrying script `finale_tethers`) · 4 script `ending` (the Spire relights, credits card) · 5 talk `sela` (epilogue) | 5000 XP, 2000 Shells, Lanterned Mantle; free roam continues; Zenith free use is P1 |

P1 chapters: "Eye of the Storm" (Thalvek, a hidden sixth Siphon in the Stormwell, and all Stormwell content) and "The Rival Above" (Kerrin is captured and wired into a living Siphon above the Crown; cut him free).

### 8.3 Siphon Spires (P0)
A Siphon is an object with HP `6 * HP(regionLevel)` guarded by two waves of Choir. Its violet core opens for 4 s every 8 s; while closed it takes 10% damage. Inside 80 m the player's passive Ora regen is halved. Destroying it emits a region-wide light burst, removes Choir patrols from the camps in that region, grants bonus XP (section 4.1) and counts toward MQ7.

### 8.4 Dialogue for MQ1 "The Spark / הניצוץ" (P0)
Tone: warm, direct, a little dry. At most two lines of about 90 characters per box. Hebrew uses `{g:masculine/feminine}` for words that depend on the player's chosen form of address.

| key | Speaker | English | עברית |
|-----|---------|---------|-------|
| `mq1.l01` | Sela | Again. Toward the post. Your feet are thinking too much. | שוב. אל העמוד. הרגליים שלך חושבות יותר מדי. |
| `mq1.l02` | Tavi | My feet are thinking about breakfast. | הרגליים שלי חושבות על ארוחת בוקר. |
| `mq1.l03` | Sela | Then hit the post like it stole your breakfast. | אז {g:תכה/תכי} בעמוד כאילו הוא גנב לך אותה. |
| `mq1.l04` | Sela | ...That light. That is not the dawn. | ...האור הזה. זו לא הזריחה. |
| `mq1.l05` | Tavi | Sela, something is burning in my chest! | סלע, משהו בוער לי בחזה! |
| `mq1.l06` | Sela | Your Ora is waking. Don't fight it. Jump! | האורה שלך מתעוררת. אל {g:תילחם/תילחמי} בה. {g:קפוץ/קפצי}! |
| `mq1.l07` | Tavi | I'm... I'm not coming down! | אני... אני לא {g:יורד/יורדת}! |
| `mq1.l08` | Sela | Good. Now fly faster than your fear. Through the rings! | יפה. עכשיו {g:טוס/טוסי} מהר יותר מהפחד. דרך הטבעות! |
| `mq1.l09` | Sela | Wisps. They feed on that light. Strike them from where you are. | רוחות גחלת. הן ניזונות מהאור הזה. {g:פגע/פגעי} בהן מהמקום שלך. |
| `mq1.l10` | Sela | Too many? Then stop shooting. Breathe. Gather the light. | יותר מדי? אז {g:תפסיק/תפסיקי} לירות. {g:תנשום/תנשמי}. {g:אסוף/אספי} את האור. |
| `mq1.l11` | Tavi | ...Did I do that? | ...אני עשיתי את זה? |
| `mq1.l12` | Sela | You did. And every Lanterned on this island felt it. Including the wrong ones. | כן. וכל מאיר באי הרגיש את זה. גם מי שלא היה צריך. |
| `mq1.l13` | Sela | Boars. Something has driven them mad. Calm them the hard way. | חזירי חט. משהו שיגע אותם. {g:תרגיע/תרגיעי} אותם בדרך הקשה. |
| `mq1.l14` | Sela | Red light means don't block. Vanish. | אור אדום אומר: לא לחסום. {g:היעלם/היעלמי}. |
| `mq1.l15` | Sela | Back to Sparkstead. Touch the Ringstone. It will remember you. | חזרה לבית הניצוץ. {g:גע/געי} באבן הטבעת. היא תזכור אותך. |

### 8.5 Dialogue for MQ2 "Smoke over Sparkstead / עשן מעל בית הניצוץ" (P0)
| key | Speaker | English | עברית |
|-----|---------|---------|-------|
| `mq2.l01` | Dov | Tavi! You're glowing. Is that contagious? Take these Sunfruit, just in case. | טאבי! {g:אתה זוהר/את זוהרת}. זה מדבק? {g:קח/קחי} פירות שמש, ליתר ביטחון. |
| `mq2.l02` | Mira | Your hands will break before the posts do. Wear these. | הידיים שלך יישברו לפני העמודים. {g:תלבש/תלבשי} את אלה. |
| `mq2.l03` | Villager | Smoke at the well! Figures in grey hoods! | עשן ליד הבאר! דמויות בברדסים אפורים! |
| `mq2.l04` | Acolyte | Another little light. The Choir will sing you quiet. | עוד אור קטן. המקהלה תשיר אותך אל השקט. |
| `mq2.l05` | Captain Durn | So you lit up the sky this morning? I expected someone taller. | אז {g:אתה זה שהאיר/את זו שהאירה} את השמיים הבוקר? ציפיתי למישהו גבוה יותר. |
| `mq2.l06` | Tavi | I grow fast. | אני {g:גדל/גדלה} מהר. |
| `mq2.l07` | Captain Durn | Vorrhal will drain you like he drains this land! | וורהאל ירוקן אותך כמו שהוא מרוקן את הארץ הזאת! |
| `mq2.l08` | Kerrin | Took you long enough. I dropped two of them while you were posing. | לקח לך זמן. הורדתי שניים בזמן שעשית פוזות. |
| `mq2.l09` | Tavi | Kerrin. Kind of you to arrive after the fight. | קרין. נחמד מצדך להגיע אחרי הקרב. |
| `mq2.l10` | Kerrin | First to the Siphon gets to tell Sela about it. Move. | מי שמגיע ראשון למגדל מספר לסלע. {g:זוז/זוזי}. |
| `mq2.l11` | Sela | It is drinking the Vein. Feel how cold the ground is? | הוא שותה את העורק. {g:אתה מרגיש/את מרגישה} כמה האדמה קרה? |
| `mq2.l12` | Sela | Strike the core when it opens. Not before. | {g:הכה/הכי} בליבה כשהיא נפתחת. לא לפני. |
| `mq2.l13` | Sela | Vorrhal was one of us. The strongest. He lost his light, and decided no one should keep theirs. | וורהאל היה אחד מאיתנו. החזק מכולנו. הוא איבד את האור שלו, והחליט שלאף אחד לא מגיע לשמור על שלו. |
| `mq2.l14` | Sela | Four more Siphons. If they all drink, the Wellspring goes dark, and everything it feeds goes with it. | עוד ארבעה מגדלים. אם כולם ישתו, המעיין יכבה, ואיתו כל מה שהוא מזין. |
| `mq2.l15` | Kerrin | Then we split up. I'll take the hard ones. | אז מתפצלים. אני לוקח את הקשים. |
| `mq2.l16` | Sela | Tavi, wait. When the light overflowed in you this morning, you nearly changed. Next time, let it. | טאבי, {g:חכה/חכי}. כשהאור עלה על גדותיו הבוקר, כמעט השתנית. בפעם הבאה, {g:תן/תני} לזה לקרות. |
| `mq2.l17` | System | Ember Form unlocked. Press the Form button. | צורת גחלת נפתחה. יש ללחוץ על כפתור הצורה. |
| `mq2.l18` | Sela | The island is yours to cross. Go where your Ora leads. | האי פתוח לפניך. {g:לך/לכי} לאן שהאורה מובילה. |

The player character is **Tavi / טאבי**. On New Journey the player picks one of two presets (`hero_a`, `hero_b`: different build and hair) and the Hebrew form of address (masculine or feminine); this is P0 because Hebrew verbs are gendered. Gendered `{g:}` forms are used only in dialogue; every UI verb (buttons, prompts, system lines) is an infinitive, so it needs no gender. Dialogue for MQ3-MQ7 and the side quests follows the same tone and is written by the content package in both languages.

### 8.6 Side quests
| id | Title | עברית | Giver, place | Level | Steps | Reward | Tag |
|----|-------|-------|--------------|-------|-------|--------|-----|
| `sq1` | Windmill Down | הטחנה נפלה | Ilan, Sparkstead windmill | 3 | interact 3 fallen blades · kill 5 `ember_wisp` | 150 XP, 120 Shells, 3 Sunfruit | P0 |
| `sq2` | Lost Bells | הפעמונים האבודים | Rina, meadow hills | 4 | interact 3 `lost_bell` objects on hilltops · talk `rina` | 200 XP, Wind Charm | P0 |
| `sq3` | First Ring | הטבעת הראשונה | Gal, Windmill Run | 3 | race `windmill_run` with at least bronze | 200 XP, Racer's Wraps | P0 |
| `sq4` | Copper Hearts | לבבות נחושת | Yael, Copperwatch | 14 | kill 3 `rust_golem` · collect 3 `rust_core` · deliver to `yael` | 800 XP, 500 Shells, Golem-core Charm | P0 |
| `sq5`-`sq10` | The Salt Thief, Mother of Thorns, Echoes of the Lanterned, The Unshaken Bell, Kerrin's Pride, Champion of the Crucible | | | | | | P1 |

---

## 9. Sandbox activities ("do whatever you want")
| Activity | עברית | Description | Reward | Tag |
|----------|-------|-------------|--------|-----|
| Free flight and exploration | תעופה חופשית | Fly anywhere from minute two; region banners on first entry; landmarks and POIs are logged on the map | Discovery XP: 30 per landmark, 10 per minor POI | P0 |
| Enemy camps | מחנות אויב | 25 camps; clear all enemies to unlock the camp chest; camps refill after one in-game day | Chest loot, bonus XP (section 4.1) | P0 |
| Ora Shrines | מקדשי אורה | 10 shrines on peaks and hidden spots; touch to claim | +1 TP each | P0 |
| Treasure chests | תיבות אוצר | 26 chests on peaks, stacks, ledges and Crown shards | Shells, consumables, gear | P0 |
| Sky-ring races | מרוצי טבעות | Fly through ring gates against the clock; bronze, silver, gold | Bronze 100 Shells, silver 250, gold 500 and a gear piece (first time each) | P0 Windmill Run, P1 five more |
| Smashing the scenery | ניפוץ | Rocks, pillars and trees shatter; enemies can be hurled through them; craters stay for the session | Small Shell drops, Surge | P0 |
| Resonance milestones | אבני דרך של תהודה | Banners when RES passes thresholds | Pride | P0 |
| Day and night | יום ולילה | 24-minute cycle; lanterns light at dusk; night skies with the violet Seam | Mood (night-only content is P1) | P0 |
| Training trials, bounties on named elites, Starfall meteors, Echo Stones, arena ladder, gathering, weather, fast travel between Ringstones | | | | P1 |
| Photo mode | | | | P2 |

---

## 10. Items and economy

### 10.1 Currency (P0)
**Shells / צדפים** from enemies, chests, quests and selling. Pacing: about 600 per hour at level 10, 2500 per hour at level 25. Sell price = 25% of buy price.

### 10.2 Equipment (P0: four slots, three rarities)
Slots: **Wraps / תחבושות** (hands), **Garb / לבוש** (body; also recolours the outfit), **Charm / קמע** x2.
Rarity: **Common / רגיל** (letter C, paper white), **Fine / משובח** (F, green), **Rare / נדיר** (R, blue). Mythic (M, violet) is P1.
Gear stat values scale with item level: `value = base * (1 + 0.08 * itemLevel)`, rounded (percent values do not scale). Price = `40 * rarityMult * (1 + 0.15 * itemLevel)`, rarityMult 1 / 2.5 / 6.

| id | Item | עברית | Slot | Rarity | Base effects | Source |
|----|------|-------|------|--------|--------------|--------|
| `training_wraps` | Training Wraps | תחבושות אימון | wraps | C | +2 mgt | Mira (MQ2) |
| `racers_wraps` | Racer's Wraps | תחבושות הרץ | wraps | F | +3 swf, +2 mgt | SQ3 |
| `bramble_wraps` | Bramble Wraps | תחבושות הסנה | wraps | F | +4 mgt, +3% crit | Haven Aster, drops |
| `saltglass_wraps` | Saltglass Wraps | תחבושות זכוכית המלח | wraps | F | +4 spr, +2 swf | Haven Aster, drops |
| `copper_knuckles` | Copper Knuckles | אגרופי נחושת | wraps | R | +6 mgt, +10% poise damage | Copperwatch |
| `stormcaller_wraps` | Stormcaller Wraps | תחבושות קורא הסערה | wraps | R | +6 spr, +8% Ora damage | Ridgerest, drops |
| `apprentice_garb` | Apprentice Garb | לבוש חניך | garb | C | +4 defense | start |
| `meadow_garb` | Meadow Garb | לבוש האחו | garb | F | +8 defense, +2 vit | Dov, Haven Aster |
| `tidewoven_garb` | Tidewoven Garb | לבוש ארוג גאות | garb | F | +10 defense, +3 spr | Haven Aster |
| `dunewalker_garb` | Dunewalker Garb | לבוש הולך הדיונות | garb | R | +16 defense, +4 vit, -10% boost cost | Copperwatch |
| `frostweave_garb` | Frostweave Garb | לבוש ארוג כפור | garb | R | +20 defense, +5 vit | Ridgerest |
| `lantern_mantle` | Lanterned Mantle | גלימת המאירים | garb | R | +18 defense, +5 spr, +5% RES | MQ7 |
| `sunfruit_charm` | Sunfruit Charm | קמע פרי השמש | charm | C | +20% healing from consumables | Dov |
| `wind_charm` | Wind Charm | קמע הרוח | charm | F | +5% boost speed | SQ2 |
| `ember_charm` | Ember Charm | קמע הגחלת | charm | F | +10% Surge gain | chests |
| `tide_charm` | Tide Charm | קמע הגאות | charm | F | +15% Ora regen | MQ4 |
| `golem_core_charm` | Golem-core Charm | קמע ליבת הגולם | charm | R | +15% poise damage | SQ4 |
| `frost_charm` | Frost Charm | קמע הכפור | charm | R | perfect guard stagger lasts x2 | MQ6 |
| `stillwind_charm` | Stillwind Charm | קמע הרוח הדוממת | charm | R | +20% Gather rate | Ridgerest |
| `wyrmhide_charm` | Wyrmhide Charm | קמע עור התולע | charm | R | +8% max HP | MQ5 |

Gear upgrading at Mira's forge, materials and crafting: P1.

### 10.3 Consumables (P0; carry cap 5 each; one quick-item button, long-press cycles)
| id | Item | עברית | Effect | Price |
|----|------|-------|--------|-------|
| `sunfruit` | Sunfruit | פרי שמש | Heal 30% HP over 1 s | 30 + 2 x player level |
| `ora_draught` | Ora Draught | שיקוי אורה | Restore 50% Ora | 45 + 3 x player level |
Quest item (P0): `rust_core` / ליבת חלודה. More consumables (tonic, pepper, Surge ember): P1.

### 10.4 Shops (P0; fixed stock, item level = shop level)
| id | Shop | עברית | Place | Stock |
|----|------|-------|-------|-------|
| `dov_stall` | Dov's Stall | הדוכן של דב | Sparkstead | consumables, Apprentice Garb, Meadow Garb (L3), Sunfruit Charm |
| `aster_market` | Haven Aster Market (Eli) | שוק מעגן אסטר | Haven Aster | consumables, Bramble Wraps, Saltglass Wraps, Meadow Garb, Tidewoven Garb (L8) |
| `talia_herbs` | Talia's Herbs | העשבים של טליה | Talia's Camp | consumables at -20% |
| `yael_outpost` | Yael's Outpost | המוצב של יעל | Copperwatch | consumables, Copper Knuckles, Dunewalker Garb (L15) |
| `ridgerest_provisions` | Ridgerest Provisioner (Oren) | הספק של מנוחת הרכס | Ridgerest | consumables, Stormcaller Wraps, Frostweave Garb, Stillwind Charm (L22) |

### 10.5 Drop tables (P0)
| Table | Shells | Consumable | Gear chance (C / F / R weights) |
|-------|--------|------------|---------------------------------|
| `grunt` | 100%, x1 | 8% | 3% (70 / 27 / 3) |
| `heavy` | 100%, x2 | 12% | 6% (50 / 40 / 10) |
| `elite` | 100%, x4 | 30% | 25% (0 / 60 / 40) |
| `boss` | 500 x boss index | 100% x2 | none (the fixed rewards come from the quest, section 7.3) |
| `chest_t1` (Meadows, Coast) | 60-150 | 60% | 25% (60 / 38 / 2) |
| `chest_t2` (Thornwood, Rustdune) | 150-350 | 60% | 30% (30 / 55 / 15) |
| `chest_t3` (Frostspine, Crown) | 350-700 | 60% | 35% (0 / 60 / 40) |
Dropped gear has item level = enemy or region level and is picked from the gear list by slot at random (quest-only items excluded). Pickups fly to the player within 6 m.

---

## 11. NPCs (P0 unless noted)
| id | NPC | עברית | Role | Place |
|----|-----|-------|------|-------|
| `sela` | Sela | סלע | Mentor, an old Lanterned master | Sela's Ledge, later Sparkstead, then Spire Approach |
| `kerrin` | Kerrin | קרין | Rival apprentice; cocky ally in MQ2 and MQ7 (his capture and rescue chapter is P1) | Sparkstead, Spire Approach |
| `dov` | Dov | דב | Merchant, comic relief | Sparkstead |
| `mira` | Mira | מירה | Smith; gives the first Wraps | Sparkstead |
| `ilan` | Ilan | אילן | Miller, SQ1 | Sparkstead windmill |
| `rina` | Rina | רינה | Shepherd, SQ2 | (-1750, 1250) |
| `gal` | Gal | גל | Ring-race enthusiast, SQ3 | Windmill Run |
| `eli` | Eli | אלי | Market keeper | Haven Aster |
| `bren` | Bren | ברן | Keeper of the Tide Beacon, lens-grinder and maker of signal kites; teaches Dawn Lance, the beacon's way of focusing light through a ring | Tide Beacon |
| `talia` | Talia | טליה | Herbalist, MQ3 | Talia's Camp |
| `yael` | Yael | יעל | Outpost trader, MQ5, SQ4 | Copperwatch |
| `oren` | Oren | אורן | Provisioner | Ridgerest |
| `noa` | Abbess Noa | אם המנזר נועה | Grants the Tempest trial | Still Wind |
| `vorrhal`, `durn`, `iskra` | Vorrhal, Captain Durn, Iskra | וורהאל, דורן, איסקרה | Antagonists (bosses with intro lines) | arenas |
| villagers | 3 per settlement, one line each | | Ambient | settlements |
Changing barks by story progress, schedules and more named NPCs: P1.

---

## 12. Time, save, settings

- **Day and night (P0)**: section 3.1. Time stops in menus. Night changes lighting, lanterns and music density only. Gloam night variants, night-only shrines, sleeping at inns, weather: P1.
- **Save (P0)**: one journey slot (slots 2 and 3 are P1; the save API already takes a slot number). The journey autosaves: on touching a Ringstone, on quest step completion, on level-up, on boss defeat, and every 120 s out of combat. Never during combat or a cutscene. A spinning light icon shows saving.
- **Journey code (P0)**: because browser storage can be unavailable or wiped inside an embedded page, Pause > Save has **Copy journey code / העתקת קוד מסע**: the whole save as one compressed text string in a selectable text box (a Copy button is offered when the clipboard is available; nothing is downloaded), and **Restore from code / שחזור מקוד**, which accepts a pasted code. The title screen offers Restore from code as well. If storage is unavailable the journey lives in memory, a toast says "Progress is kept for this session only / ההתקדמות נשמרת רק עד סגירת המשחק", and a small warning icon stays on the HUD next to Pause; tapping it opens the journey-code panel. A save is always under 32 KB so the code stays pasteable.
- **Saved**: level, XP, stats, allocation style, TP, technique ranks, loadout, Forms, the flight unlock, inventory, equipment, Shells, quest states and flags, discovered POIs, Ringstones, shrines, chests, Siphons, race records, bosses defeated, camp clear days, hour and day, position (snapped to the last Ringstone on load), difficulty, form of address. **Not saved**: craters, destroyed props, enemy positions.
- **Settings (P0, stored separately from journeys)**: language, quality (auto, low, high), master, music and SFX volume, camera sensitivity, invert Y, camera-pitch flight (keyboard and gamepad), left-handed touch layout, vibration, screen shake 0-100%, reduced motion, photosensitivity mode, text size, damage numbers, short transformations. Difficulty is per journey (stored in the save) and is changed from Settings > Gameplay.
- Save slots 2 and 3, fast travel: P1.

---

## 13. Scope summary

### 13.1 P0 (the shippable game)
The whole island as terrain, with six content regions (Meadows, Coast, Thornwood, Rustdune, Frostspine, Spire Heart) and the Stormwell as low-detail terrain only; day and night; flight with camera-pitch steering, boost, sonic boost, sprint, swim; Strike String, Breaker, Meteor Heel, Pursuit, Ora Bolt, Flare Barrage, Dawn Lance, Nova Ring, Ringfall, Guard, Flicker Step, Gather; Ember and Tempest Forms and the scripted Zenith; Surge; soft and hard lock; poise, stagger, telegraphs; Hurtle, wall slams, craters, destructible rocks and trees; nine enemy definitions (eight archetypes and the Bramble Boar variant); five bosses (Durn 1 phase; Bramblehorn, Gorrumaw and Iskra 2 phases; Vorrhal 3 with the tether finale); MQ1-MQ7 and SQ1-SQ4; levels, four stats, Resonance, TP ranks and passives; twenty gear items, two consumables, five shops, drop tables; nine Ringstones, ten shrines, twenty-five camps, twenty-six chests, one ring race; one save slot with autosave and the journey code; three difficulties; Hebrew and English with gendered address; the first ten minutes; touch (portrait and landscape), keyboard and mouse, gamepad; two quality tiers (low and high); three exploration music palettes plus combat and boss music.

Moved from P0 to P1 so that the first ten minutes, the hero, the hit feel and flight get the polish time: all Stormwell content (enemies, camps, shrines, Ringstone, Storm Golem), the medium quality tier, save slots 2 and 3, the Arch Dash race, per-region music scales, gamepad rumble, the third phases of Gorrumaw and Iskra.

### 13.2 Cut order if the schedule slips (never cut the first ten minutes, flight feel, hit feel, the Resonance number, Ember Form, touch controls or Hebrew)
1. Everything P2, then everything P1.
2. Flare Barrage ranks, Second Breath.
3. SQ4, then SQ2.
4. The Bramble Boar variant becomes a plain recolour without the extra behaviour.
5. Gorrumaw phase 1 rolling becomes a plain charge.
6. Shattered Crown chests.
