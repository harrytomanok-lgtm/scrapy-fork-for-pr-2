# KETHRA: Veins of Light. Art, UX and Audio Direction

Binding version 2. Companion documents: `GDD.md` (design) and `ARCHITECTURE.md` (engineering contract). Names, ids and numbers here match those documents. Everything is procedural: primitives, noise, GLSL, canvas-generated textures, WebAudio synthesis. No image, model or sound files.
Priority tags: **P0** must ship, **P1** should, **P2** nice to have. Quality tiers in P0: **low** (phone default) and **high** (desktop). A **medium** tier is P1; where this document gives a medium value it is marked as such and is not built or verified in P0.

---

## 1. Art direction

### 1.1 Visual thesis (P0)
**A sunlit ink-and-paper world where Ora is the only thing that truly glows.**
The world is matte, warm and hand-printed: flat cel bands, ink outlines on characters, a limited palette, strong aerial perspective. Energy is the opposite: saturated, additive, animated. Every frame sells the contrast between a calm painted landscape and liquid light tearing across it.

### 1.2 Rules that keep it intentional (P0)
1. **Palette tokens only.** Every colour comes from `PALETTE` (ARCHITECTURE 5.12). No ad-hoc RGB in code.
2. **Three value groups.** World shadows never darker than 25% value; world lit surfaces never brighter than 85%; Ora effects never darker than 70% and are the only things allowed to reach white.
3. **Two colours are reserved for hostile cues in the world.** Violet `#7B3CFF` is the enemy's Ora (siphon-glass, corruption, hostile energy): nothing friendly is violet. Red `#FF3B3B` is used only for enemy unblockable telegraphs: no player effect, Form, aura, shockwave or prop light is red or coral. (The HP bar and UI warnings are DOM elements and keep the `--danger` token.) Shape repeats the rule: player rings and shockwaves are always **solid, unbroken** rings, red telegraphs are always **notched** rings with a triangle icon.
4. **Aerial perspective**: distant terrain fades into a hue-shifted fog colour (never grey); mountain layers read as 3-4 flat value planes.
5. **Authored silhouettes**: every landmark has a unique top silhouette readable from 1.5 km (the Spire, kite tower of Haven Aster, the Arches, Copperwatch's mast, Paleglass Summit's glass fin, Siphon Spires with violet light pillars).
6. **No default-engine look**: no grey standard materials, no untinted ambient, no visible tiling, no horizon gap (ocean and a far island mesh reach the horizon).
7. **Motion language**: the world moves slowly (sway 0.3-0.6 Hz); energy moves fast with anticipation, snap, settle.

### 1.3 Region palettes (P0)
| Region | ground | groundShade | cliff | foliage | accent | fogDay |
|--------|--------|-------------|-------|---------|--------|--------|
| Emberreach Meadows | `#9DBF5A` | `#4E7A4A` | `#C9A77C` | `#6FA347` and red-leaf `#C8553A` | `#E8C547` | `#BFD8E6` |
| Saltglass Coast | `#E9DCC0` | `#B79E86` | `#D9C3A5` | `#8FA78C` | `#5FD3D0` | `#CFE8EA` |
| Thornwood | `#4F7A5F` | `#26453E` | `#6D7466` | `#2F6B57` | `#C77DD8` (bramble flowers, not emissive) | `#9FB7B0` |
| Rustdune Wastes | `#D9925A` | `#9A5A3C` | `#B5533A` | `#8C8A4C` | `#4FC3B0` (oxidised copper) | `#F0CFA8` |
| Frostspine Peaks | `#EEF3F7` | `#9BB3CE` | `#7D8AA3` | `#4C6E78` | `#7FD1FF` | `#DCE7F2` |
| Stormwell Basin | `#56616B` | `#2C3540` | `#3F4852` | `#3E6E5E` | `#8CFF9E` (green lightning) | `#7F8E96` |
| Spire Heart | `#D8D2EC` | `#8E86B8` | `#B9B0DD` | `#7FBFAE` | `#FFFFFF` | `#D5CFF0` |

Shared: ocean deep `#1C4E6E`, shallow `#3FA3A8`, foam `#F4F1E6`; path earth `#C2A178`; snow `#F4F7FA` above 520 m in Frostspine; scorch `#2E2530` with rim glow `#FF9A4A`; Siphon corruption ground `#3A3344` within 80 m of a standing Siphon.
Region borders blend over 150 m with a noise dither so they read as hand-painted.

### 1.4 Time of day (P0)
One game day = 24 real minutes. Five keys, interpolated in linear space.
| Key | Hour | Sun colour | Sun intensity | Ambient sky | Ambient ground | Fog tint | Shadow tint |
|-----|------|-----------|---------------|-------------|----------------|----------|-------------|
| Dawn | 05:30 | `#FFB38A` | 0.8 | `#8FA6D8` | `#6B5A6E` | `#F2C7B5` | `#5A4A7A` |
| Day | 12:00 | `#FFF4DE` | 1.25 | `#A8D4F2` | `#8A9A6A` | region fogDay | `#4A5A8A` |
| Golden | 17:30 | `#FFC56B` | 1.0 | `#E8B98F` | `#7A6A50` | `#F5CFA0` | `#6A4A7A` |
| Dusk | 19:30 | `#FF7E6B` | 0.45 | `#5C5A9A` | `#3A3550` | `#9A7FA8` | `#3A2F5A` |
| Night | 00:00 | moon `#AFC4FF` | 0.35 | `#1E2A4E` | `#141A2A` | `#2A3558` | `#1A1F3A` |
Night stays readable: diffuse floor 0.22. At night Ora effects are the main light source and village lanterns glow `#FFB65C`.

### 1.5 Lighting, shadows, fog (P0)
- One directional light (sun or moon) and one hemisphere ambient, both implemented as shared shader uniforms. No PBR.
- Shadows: **low** blob shadows only (one instanced quad batch, radial gradient, opacity 0.45, colour `#1A1F3A`) under every actor and projectile; they also give altitude reading in flight. **high**: one 2048 shadow map for characters and near trees in a 90 m box around the player, plus blobs outside. (medium, P1: 1024, characters only, 60 m.)
- Fog: exponential-squared height fog, density 0.00018 (0.00028 at dawn), height falloff 0.004; colour = region fogDay x time tint; toward the sun it lerps 35% to the sun colour. The Spire and light pillars are drawn with half fog so they are visible from anywhere.
- Dynamic point lights: low 0, high 2 (medium, P1: 1), claimed by charged beams, ultimates and transformations only.

### 1.6 Sky (P0)
One sky dome shader drawn first: vertical gradient (zenith, horizon, below-horizon; day `#4F8FD6` -> `#CDE6F2` -> fog), hard sun disc with a soft halo, moon disc with a pale ring. **Painted clouds**: bands sampled from one pre-baked 256 px tiling noise texture (no per-pixel fbm), quantised to three tones (`#FFFFFF`, `#E4E9F2`, `#B8C2DA`, tinted by time) with a darker rim at the threshold; two layers scrolling 2 and 3.5 m/s (low: one layer). Night: hash stars and **the Seam**, a faint violet scar across the sky above the Spire (where the Uncrowning tore it). Green lightning flickers inside the cloud band over the Stormwell (P1).

### 1.7 Cel shading (P0)
One toon shader family (`render.materials`), used by characters, props and buildings:
- **Three diffuse bands**: `NdotL < -0.05` shadow, `< 0.45` mid, else lit; band edges smoothed over a fixed 0.04 range (no screen-space derivatives).
- Shadow band = base x shadow tint (never base x 0.5). Mid = base x 0.82 mixed 10% toward the shadow tint. Lit = base x sun colour.
- **Rim**: `smoothstep(0.62, 0.72, 1 - NdotV) * max(0, dot(N, sunDir) + 0.4)`, colour = sky ambient lightened 40%, strength 0.35. In a Form or while Gathering the rim takes the Ora colour at strength 0.9.
- Specular only on the "glossy" flag (metal trims, eyes, ice, siphon-glass): one hard highlight at 0.92.
- **Outlines**: inverted hull extruded in clip space for constant width: 2.0 px at 1080p scaled by render height (minimum 1 px); colour = base x 0.25 shifted toward ink `#1B1626`. Low: player, locked target and the 6 nearest characters. Medium: characters within 60 m and landmark props. High: characters within 100 m, props within 40 m.
- Terrain: the same three bands on per-vertex colours baked from the palette, a slope cliff swap above slope 0.62 with a noisy edge, and one detail noise texture sampled at two scales (plus or minus 6% value).
- Emissive Ora surfaces write values above 1.0 for bloom on high; on low a camera-facing additive glow sprite replaces bloom.
- Depth-edge ink lines on terrain ridges: P1, high only.

### 1.8 Terrain and water (P0)
- Terrain colour = palette blend by region weight, cliff swap, snow line, baked path mask, corruption tint near standing Siphons, scorch from craters.
- Craters: bowl radius r, depth up to 0.3 r, raised lip 0.08 r; scorch `#2E2530` with a rim glow that cools over 6 s; a ring of rubble chips.
- **Water**: one ocean plane following the camera, toon shader. Depth comes from the baked height grid, not from a rendered depth buffer: after the bake the world package uploads one 512 x 512 single-channel texture of `seaLevel - height` over the whole world square and the water shader samples it by world x,z. This gives two depth bands (shallow turquoise to 6 m, deep beyond), a shoreline foam band (0-1.5 m depth, animated noise breakup) and correct lake and crater edges on every tier at no per-frame cost; a crater below sea level updates the affected texels. Hashed sun-glint sparkles; vertex waves on high only. Lakes are basins below sea level. No reflection or refraction. Flying under 6 m above water faster than 30 m/s leaves a spray wake.
- **The island from the air**: the flight fantasy must not look bald. Tree and rock instances fade out with 3D distance from the camera, so the far terrain carries the forests itself: the same scatter hash that places trees bakes a canopy tint (the region foliage colour, darkened 12%) and a soft value "canopy bump" pattern into the vertex colours of the far island mesh and of the lowest terrain LOD. From 400 m up, a forest reads as a textured dark-green mass with clearings, paths and settlements cut into it.

### 1.9 Vegetation and props (P0)
Chunky, faceted, readable at 300 m; 6-60 triangles for small props, flat bands, no outline on low.
| Type | Build | Where |
|------|-------|-------|
| Kite cedar | 3-5 icosahedron canopy blobs on a tapered six-sided trunk, `#6FA347` | Meadows |
| Ember maple | same build, canopy `#C8553A` | Meadows, Haven Aster |
| Salt palm | fan of 5 flat leaves on a curved trunk | Coast |
| Bramble tree | thick twisted trunk, dark canopy slabs, thorn cones, flowers `#C77DD8` | Thornwood |
| Rust cactus | stacked capsules with copper-green tips | Rustdune |
| Frost pine | three stacked cones, white-tipped | Frostspine |
| Marsh reed and crystal spike | thin cones; hexagonal prisms, accent emissive 30% | Stormwell, Spire Heart |
| Rocks and pillars | squashed dodecahedra with displaced vertices; cliff palette; **destructible** into 4-6 pooled chunks | everywhere |
| Grass | instanced 3-blade cards within 70 m on high (medium, P1: 40 m), bends away from the player and flattens under auras and shockwaves; off on low | grassy regions |
Wind sway in the vertex shader (amplitude 0.15 m at the top, 0.4 Hz, phase from world position). Vegetation draw calls: low 12, high 30. Tree instances drawn at once: at most 1,200 on low (40 triangles each, nearest first), 4,000 on high.

### 1.10 Kethran culture and structures (P0)
The visual language of Kethra is **kites, rings and terraces**.
- **Houses**: round, slightly tapered drums of whitewashed clay `#EDE3D0` with a terracotta base band `#B4644A`; shallow verdigris copper cone roofs `#5E9E8A` with a ring finial; round door with a teal curtain `#1F5C63`. Three sizes, 40-120 triangles.
- **Kite poles**: tall poles flying diamond kites in `#E8C547`, `#C8463A`, `#3F7FBF`, bobbing at 0.5 Hz along the shared wind vector. They make every settlement visible from far away.
- **Ringstone**: a tall standing stone with a carved ring that glows `#7FE3D4` when activated and throws a thin light pillar.
- **Ora Shrine**: a floating stone ring 4 m wide rotating over a disc, teal core; dims when claimed.
- **Chest**: a drum-shaped lacquer box with a ring handle; lid pops with a light burst.
- **Ring gate** (races): a 9 m torus of light, teal, turning gold when passed.
- **Siphon Spire**: a 40 m black-iron thorn driven into the ground, wrapped in violet siphon-glass tubes, core at 6 m that opens like a three-petal shutter; violet light pillar; grey dead ground around it. Destroyed: it cracks, the pillar turns teal and fades, colour returns.
- **Settlements**: Sparkstead (8 houses, windmill with kite sails, well), Haven Aster (16 buildings, harbour jetty, a 60 m kite tower, market awnings), Copperwatch (5 drum huts on stilts, a copper signal mast), Ridgerest (6 stone-based drums with snow roofs), Still Wind monastery (a ring cloister with three wind bells on nearby peaks), the Tide Beacon (a 30 m whitewashed lighthouse drum with a slowly turning lens ring at its top, two signal kites and the keeper's round hut at its foot), camps (2 tents, a kite pole, a fire).
- **Wellspring Spire**: a 900 m hexagonal crystal pillar, pale `#D8D2EC` with a slow inner pulse; the Shattered Crown is about 40 floating crystal-rock shards.

---

## 2. Characters (built from primitives)

### 2.1 Construction rules (P0)
- Capsules, spheres, rounded boxes, cones, lathe shapes, merged into **one rigid-skinned mesh per character** (each part bound to one bone). Budgets: hero 1,800 triangles, named NPC 900, grunt 700, heavy 1,200, boss 3,500. LOD1 is about 40%.
- Proportions: adults are 6.5 heads tall with large hands (x1.15) and feet (x1.2) and broad shoulders, so poses read at phone size.
- **Faces are geometry, not textures**: dark almond eye shapes with a white glint, brow boxes on two small brow bones, a mouth box on a jaw bone. Expressions (neutral, angry, shout, hurt, happy, KO) are brow and jaw poses. A painted face atlas is P2.
- Hair: swept, layered tufts from flattened cones and curved ribbons. Never an upward spiky crown, never gold.

### 2.2 Tavi, the hero (P0)
Silhouette keys readable at 40 px: **one long asymmetric sash** trailing from the left shoulder (three spring bones; twice body length in flight), a **high-collared sleeveless short coat** with a split back hem, **wrapped forearms**, wide gathered trousers tucked into **tall soft boots**, long dark hair tied low in a single wrapped tail with a bronze ring.
| Part | Colour |
|------|--------|
| Coat (changes with Garb) | ink teal `#1F4E5F`, lining `#E9DCC0` |
| Sash | oxblood `#8E2C3A` with a cream stripe `#EFE3C8` |
| Trousers | charcoal plum `#3B3346` |
| Boots and wraps (wraps change with Wraps) | warm sand `#C9AE84` |
| Belt ring | bronze `#B08A4A` |
| Skin, hair, eyes | `#E0B48C`, `#1C1A24`, amber `#D8A23A` |
| Ora (base) | teal-white: body `#7FF2E0`, core `#FFFFFF` |
Presets: `hero_a` (broader shoulders, shorter tail) and `hero_b` (slimmer build, longer tail, side lock). Garb palettes (P0): six coat colour pairs from the gear list. Choosing the Ora hue, skin and hair presets: P1.

### 2.3 Forms (P0: Ember, Tempest, scripted Zenith)
**The body becomes a lantern.**
| Form | Seams | Sash and mantle | Head | Aura | Colour |
|------|-------|-----------------|------|------|--------|
| Ember | Glowing vein lines from the sternum along arms and neck (emissive strips, slow flow) | Sash ignites into an additive ribbon of light | Irises take the Form colour; pupils, hair and skin are unchanged | No shell at rest: 20-30 slow ember motes rising from the seams and the sash. The Gather aura (3.2) appears only while Gathering | amber-peach `#FFB070`, core `#FFF1DC` |
| Tempest | Seams thicken, pulse at 1.2 Hz | **Mantle**: four translucent ribbon strips from the shoulders. Hair stays down and keeps its colour | Two swept-back **wind-vanes of light** at the temples | Paper-cut **wind ribbons**: three or four flat streaks circling the body on tilted orbits and a gust ring at the feet. No lightning and no arcs | indigo-white `#8FA8FF`, ribbons `#E8F0FF` |
| Zenith | Body, skin and hair keep their own colours; the seams and the sash run with prism light cycling teal -> indigo -> peach | Mantle becomes six floating **crystal blades** fanned behind the shoulders, each refracting the seam colour | Eyes stay amber with a prism glint | Slow orbiting motes and thin light rings sliding up the blades | seams and blades prism-white `#F4F1FF` with the cycling fringe |
Below 20% Ora in a Form the seams flicker as a warning. Eclipse Form (dark body, violet-free silver rim): P1.

### 2.4 Named characters and villagers (P0)
| Character | Design |
|-----------|--------|
| Sela | Old Lanterned master: lean, straight-backed, silver hair in a high knot, long sand-coloured wrap coat `#C9AE84` with a teal sash `#1F5C63`, a walking staff with a ring head, faint teal seams on the hands |
| Kerrin | Rival: stockier than Tavi, short dark-red hair `#6B2A2A` swept to one side, cropped slate jacket `#3F5566` with a yellow sash `#E8C547`; in idle he spins his sash ring on one finger and catches it; Ora colour jade `#6CFF9A` |
| Dov | Round merchant, wide-brim hat, apron `#B4644A`, a huge ladle on his back |
| Mira | Smith: rolled sleeves, leather apron `#6B4A3A`, hammer at the belt, hair wrapped in a red cloth |
| Bren | Beacon keeper: broad-shouldered and weathered, a grey braid under a knitted cap, oilskin coat `#5F8A8F` with rolled sleeves, a brass lens ring on a cord at the chest, a folded signal kite on the back |
| Yael | Outpost trader: sun hood `#D9925A`, copper goggles pushed up, satchel |
| Abbess Noa | Tall, grey cowl `#9BB3CE`, a string of small wind bells across the chest |
| Talia, Eli, Oren, Ilan, Rina, Gal | Villager generator plus one unique prop each: herb basket, ledger, pack frame, flour sack, shepherd's crook, kite on the back |
| Villagers | Generator: 3 builds x 2 heights x 4 skin tones x 6 outfit palettes x 4 hair shapes x 4 headwear; wrap tunic with a wide sash and a ring brooch; one bright accent per settlement |

### 2.5 Enemies (P0)
Shared identity: **every hostile carries violet siphon-glass `#7B3CFF`** (emissive, glossy). Choir members are grey and charcoal people; beasts are natural creatures with violet crystal growths and violet eyes.
| Enemy | Design | Telegraph origin |
|-------|--------|------------------|
| Ember Wisp | Teardrop ember body `#FF9A4A` with a violet core, three trailing ribbon tails, one eye | core brightens |
| Tusk Boar / Bramble Boar | Barrel body, huge shoulders, two forward tusks, small crystal ridge on the back; hide `#8A6A4E` / dark green `#3E5A46` with thorn cones | hooves scrape, tusk glint |
| Choir Acolyte | Stone-grey hooded robe `#8A8590` over charcoal `#2B2730`, a dark woven veil instead of a face, one siphon-glass vial on the chest, short iron baton | vial flares |
| Choir Caster | Taller, thinner, hovering; robe split into four hanging strips; two vials orbit the hands | hands and vials |
| Scuttlecrab | Wide flat shell of salt-white plates `#E9DCC0`, big front claws used as a shield, violet barnacles | claws lift |
| Rust Golem | Stacked iron-red blocks `#B5533A` with copper-green seams, hammer forearms, core in the chest. (Storm Golem, P1: slate blocks `#3F4852` with green seams) | chest core |
| Frost Harrier | Ice-blue bird `#9BB3CE`, long swept wings made of flat blades, violet eyes and beak tip | wings fold before the dive |
| Choir Vanguard | Armoured Choir duelist: grey plate over charcoal, a half-cape, a glaive of violet glass, three vials on the back like a rack | glaive and back rack |

### 2.6 Bosses (P0)
| Boss | Design |
|------|--------|
| Captain Durn | Acolyte build x1.25, officer's shoulder cape `#5A2A3A`, two vials, a heavy flanged mace |
| Bramblehorn | 6 m quadruped: stag-boar body of dark bark `#3E3A32`, a crown of thorned antlers 5 m wide wrapped in violet glass, moss back, glowing violet furrows on the flanks |
| Gorrumaw | 7 m armoured burrower: overlapping copper-rust plates `#B5533A` (rolls into a ball), blunt digging claws, a maw of crystal teeth; plates fall off in phase 2 revealing pale skin `#E0C8B0` |
| Iskra Pale-Wing | Human-sized Choir lieutenant: pale silver-white armour `#DCE7F2`, two wing-like fans of ice blades from the shoulder blades, twin ice sabres, a single violet vial at the throat |
| Vorrhal the Dimmed | 2.4 m, gaunt: a long charcoal robe whose hem dissolves upward into grey motes, dead grey seams where a Lanterned's light would be, a collar of seven siphon-glass tubes feeding his chest, no visible Ora of his own. Phase 2: the tubes blaze violet. Phase 3: a faceted siphon-glass shell closes around him at the Spire wall and cracks with teal light each time a tether is threaded |

### 2.7 Animation style (P0)
Snappy anticipation and overshoot; held key poses for 2-3 frames on impacts; locomotion blends by speed; flight leans into velocity with the arms swept back at boost; idle breathing; head and chest turn toward the lock target. Standard clip ids are listed in ARCHITECTURE 4.5.

---

## 3. VFX bible

### 3.1 Global rules (P0)
- Instanced quads, **one draw call per material**: additive soft, additive streak, alpha dust. Live particle caps: low 800, high 3,500 (medium, P1: 1,800).
- One 512 px canvas atlas: soft dot, star burst, streak, ring, smoke puff (4-frame flipbook), chip.
- **Three-layer colour rule** for every energy effect: core (90% white), body (the Ora colour), fringe (hue shifted -25 degrees, darker, 60% opacity).
- Overdraw cap on low: additive particles may cover at most 40% of the screen; farthest and oldest are culled first.
- Bloom: low off (glow sprites instead); high 4 levels at quarter resolution, threshold 0.85, strength 0.8 (medium, P1: 3 levels, strength 0.6).
- **Flash budget (all modes)**: a "flash" is any full-screen or larger-than-a-quarter-screen change in brightness. At most 3 flashes start in any one second and none changes screen luminance with an alpha above 0.4; further requests in that second are dropped. Photosensitivity mode tightens this to 2 per second and alpha 0.25. Muzzle flashes, hit sparks and glints are small local sprites and never full-screen.
- Every effect has a low-tier fallback listed below.

### 3.2 Effects (times in ms)
| Effect (recipe ids) | Spec | Low fallback | Tag |
|---------------------|------|--------------|-----|
| **Gather aura** (`aura`) | A lantern-glow shell (the character re-rendered 1.25x along normals, fresnel additive) crossed by **rising ring bands**: three horizontal bands of light that climb from the feet to above the head and repeat, faster as the charge grows; rising streaks 40/s; ground dust ring every 600 ms; 12 orbiting pebbles; grass flatten; at full: a solid burst ring and one flash. Start 150 ms flare, release 250 ms fade. Shown only while Gathering, in a transformation, and as the enemy variant (violet) | shell and 15 particles/s | P0 |
| **Ora Bolt** (`bolt`, `bolt_hit`, `muzzle`) | Elongated core billboard, 0.6 m streak trail; palm flash: a 0.5 m local sprite for 80 ms with 3 sparks (never a screen flash); hit: star burst 120 ms, 6 sparks, small puff | no trail ribbon | P0 |
| **Dawn Lance** (`beam_charge`, beam handle, `beam_hit`) | Charge 500-2000 ms: the sash winds around the leading forearm and closes into a **ring of light** in front of one outstretched palm; the ring spins up from 1 to 6 turns per s and widens from 0.5 to 1.1 m while thin streaks are drawn in along its rim; camera pushes in 6%. Fire: the beam leaves through the ring: cylinder with scrolling noise (white core 30% radius, body, fringe), grows at 400 m/s, ring sprites every 4 m, end-cap sphere, scorch line on the ground, pooled light at the ring. End: thins over 180 ms leaving 5 dissolving rings, the sash unwinds | 6-sided cylinder, no rings along the beam | P0 |
| **Nova Ring** (`nova`) | Sphere shockwave to the technique radius over 280 ms, ground ring decal, radial chips, dust ring, grass flatten, 6% white flash | no dust ring | P0 |
| **Ringfall** (`ult_rise`, `ult_sigil`, `ult_dive`, `ult_impact`) | 0 ms rise 40 m with 0.35x slow motion and a low hero camera; 600 ms a 14 m **sigil ring** is carved in the sky (three concentric rotating arcs); 1100 ms dive through it as a comet with a long trail; impact: 30 m dome, two shockwave rings, crater r 20, rock chunks, 1.5 s light column, letterbox bars slide in and out. Total 3.0 s; skippable to the impact after the first view | half particles, one ring | P0 |
| **Flicker Step** (`flicker_out`, `flicker_in`, afterimage) | 0-60 ms the character dissolves into horizontal speed lines; one afterimage (frozen pose clone, flat Ora-tinted, 50% alpha, fades in 300 ms; up to 3 on high); reappear with a ring pulse | one afterimage | P0 |
| **Boost and Sonic Boost** (`boost_trail`, `sonic_ring`) | Streak particles and sash whip; Sonic: a white cone ring scaling 0 -> 8 m in 220 ms, shock flash, screen speed lines by speed | no cloud parting | P0 |
| **Melee hits** (`hit_light`, `hit_heavy`, `hit_finisher`) | Light: 4 star sparks and a burst (90 ms), white with an Ora fringe. Heavy: 10 sparks and an impact ring along the hit normal. Finisher: six flat ink-splash triangles `#1B1626` and a white flash | fewer sparks | P0 |
| **Guard** (`guard_shell`, `guard_block`, `perfect`) | Hexagon-tile hemisphere in front, 1.4 m, 35% opacity; on block the tiles flash and ripple, 3 sparks. Perfect: ring burst and bell | plain hemisphere | P0 |
| **Transformation** (`transform_in`, `transform_burst`) | 0 ms world slows to 0.1x, camera moves to the front three-quarter; 0-600 ms seams draw in; 600-900 ms crouch, aura implodes; 900 ms white flash 100 ms, horizontal shockwave 40 m, pebbles blown away, grass flattened to 30 m; 900-1200 ms mantle unfurls with overshoot. Short version 500 ms | half particles, no decal | P0 |
| **Explosions** (`explosion_s`, `_m`, `_l`) | White core (80 ms up, 200 ms fade), hue dome, 6-24 smoke puffs `#3A3346`, chips, ground ring, scorch decal from M, light 250 ms on high | fewer puffs | P0 |
| **Hurtle and wall slam** (`hurtle_trail`, `slam`) | White streak trail on the flying body; on impact dust burst, chips, crack decal, rock chunks if a prop broke | no decal | P0 |
| **Craters** (`crater`) | Terrain bowl when r >= 6 m, scorch with cooling rim, rubble ring, dust | decal only below r 6 | P0 |
| **Telegraphs** (`tele_white`, `tele_red`, `tele_violet`) | White: glint and plain expanding ring. Red: **notched** ring and a triangle icon over the enemy. Violet: spiral and a tether line. Ground-targeted attacks draw their shape (circle, line, cone) on the ground and fill up over the wind-up. Red appears nowhere else in the world (1.2 rule 3) | same (never reduced) | P0 |
| **Finale tethers** (`tether`, `tether_thread`) | A 0.4 m ribbon of teal light (beam handle) from its ground anchor to the carrier's hand, with pulses travelling toward the Spire; anchor = a solid teal ring on the ground and a thin pillar. On threading: ring burst at the Spire base and one pulse racing up the pillar; the siphon-glass shell gains a teal crack | ribbon without pulses | P0 |
| **Enemy death** (`death_choir`, `death_beast`, `xp_orb`) | Flash white 60 ms, freeze, dissolve upward over 700 ms (Choir: grey dust and a shattering vial; beasts: the violet growths burst and the body fades to motes); 3-12 teal XP orbs arc out and home to the player with a rising pitch tick | 3 orbs | P0 |
| **Level-up** (`level_up`) | 12 m light pillar from below (900 ms), ring of glyph sprites at the feet, banner, 0.5x slow motion for 300 ms, bars sweep full | pillar and banner | P0 |
| **Pickups and POIs** (`pickup`, `pillar`) | Floating, rotating, rarity pillar 1.5 m (Fine `#7FD18B`, Rare `#5FB6FF`); Ringstone and quest pillars are thin teal or amber beams to the sky | same | P0 |
| **Siphon** (`siphon_idle`, `siphon_core`, `siphon_break`) | Violet pillar, tubes pulsing downward, grey motes drawn in from the ground; core open = bright shutter and a ring; break = cracks, violet -> teal burst 120 m, colour returns | fewer motes | P0 |
| **Water spray, footstep dust, landing ring** (`spray`, `step_dust`, `land_ring`) | small alpha puffs | off except landing | P0 |
| Weather, manga impact frame (one inverted posterised frame on finishers), beam clash, lightning | | | P1 |

---

## 4. Game feel table (P0)

This table is the data in `src/core/feel.js`; `ctx.fx.impact(classId)` applies a row. **Hit-stop freezes all gameplay** (not camera, VFX or UI). Shake uses trauma units into a trauma-squared shake (max offset 0.6 m, max roll 3 degrees, decay 1.4 per s). Vibration uses `navigator.vibrate`, feature-detected once; it does nothing on iOS and inside most embedded cross-origin pages, so no cue depends on it. Gamepad rumble is P1: the column is kept as data and `input.rumble` is a no-op in P0.

| Class id | Event | Hit-stop | Shake | FOV kick | Slow-mo | Phone vibrate | Gamepad rumble (strong, weak, ms) |
|----------|-------|----------|-------|----------|---------|---------------|-----------------------------------|
| `lightHit` | Light melee hit | 45 ms | 0.08 | 0 | - | 10 ms | 0, 0.3, 60 |
| `heavyHit` | Breaker, heavy hit | 90 ms | 0.20 | -2 deg | - | 25 ms | 0.5, 0.2, 120 |
| `finisher` | Launch, smash, Meteor Heel | 140 ms | 0.35 | -4 deg | 0.5x 200 ms | 40 ms | 0.8, 0.3, 180 |
| `boltHit` | Ora Bolt hit | 0 | 0.03 | 0 | - | none | 0, 0.15, 40 |
| `beamTick` | Beam tick (10 Hz) | 0 | 0.06 | +6 deg while firing | - | 15 ms | 0.6, 0.6, 100 |
| `burst` | Nova Ring | 60 ms | 0.30 | +5 deg | - | 35 ms | 0.7, 0.3, 200 |
| `ultimate` | Ringfall impact | 200 ms | 0.80 | +12 deg, back over 600 ms | 0.35x 1.0 s | 60, 40, 90 | 1.0, 1.0, 500 |
| `hurtLight` | Player takes a light hit | 40 ms | 0.12 | 0 | - | 15 ms | 0, 0.4, 80 |
| `hurtHeavy` | Player takes a heavy hit | 100 ms | 0.40 | -3 deg | - | 50 ms | 0.9, 0.4, 250 |
| `perfectGuard` | Perfect guard | 120 ms | 0.10 | -2 deg | 0.6x 250 ms | 20 ms | 0, 0.6, 80 |
| `perfectFlicker` | Perfect Flicker | 0 | 0 | +4 deg | 0.4x 500 ms | 8 ms | 0, 0.2, 40 |
| `flicker` | Flicker Step | 0 | 0.03 | +3 deg | - | none | 0, 0.2, 40 |
| `boostStart` | Boost start | 0 | 0.05 | +8 deg (held) | - | none | 0, 0.2, 60 |
| `sonicBoom` | Sonic Boost | 0 | 0.25 | +14 deg peak, settles +10 | - | 30 ms | 0.6, 0.3, 150 |
| `wallSlam` | Enemy slams into scenery | 70 ms | 0.25 | 0 | - | 20 ms | 0.4, 0.2, 100 |
| `transform` | Transformation burst | 0 | 0.60 | +10 deg | 0.1x for 900 ms | 30, 30, 80 | 1.0, 0.6, 400 |
| `bossDeath` | Boss death | 300 ms | 0.70 | +8 deg | 0.25x 2.0 s | 80, 60, 120 | 1.0, 1.0, 800 |
| `levelUp` | Level-up | 0 | 0.10 | +3 deg | 0.5x 300 ms | 20 ms | 0, 0.5, 200 |
| `landHeavy` | Landing from over 20 m | 0 | 0.15 | 0 | - | 15 ms | 0.3, 0.1, 80 |
| `craterBig` | Crater r >= 10 m | 0 | 0.45 | +4 deg | - | 40 ms | 0.8, 0.4, 250 |

Settings: Screen shake 0-100% (Reduced Motion sets 25% and FOV kicks 30%), Vibration on or off. Flashes in this table go through the flash budget of 3.1 in every mode.

---

## 5. Camera language (P0)

Third-person spring arm with collision against terrain and solid colliders (sphere cast 0.3 m). All changes use critically damped springs.

| Mode | Distance | Height offset | Pitch | FOV landscape / portrait | Behaviour |
|------|----------|---------------|-------|--------------------------|-----------|
| `explore` (ground) | 5.5 m | 1.6 m | -12 deg | 60 / 72 | Recentres behind movement after 1.5 s without camera input (1.0 s on touch) at 70 deg/s; looks 2 m ahead of velocity |
| `flight` (sprint, cruise) | 7.5 m | 1.2 m | -6 deg | 66 / 78 | Follows velocity strongly in yaw; rolls up to 6 degrees into turns. Pitch: see camera-pitch flight below |
| `boost` | 9 m | 1.0 m | velocity-aligned | 76 / 88 | Speed lines; camera lags 0.12 s |
| `lock` | 6.5 m, widening to 14 m with separation | 1.8 m | framing | 62 / 74 | Player on one third, target on the opposite third, target always on screen; 250 ms ease on switch |
| `combat` (group combat, no lock) | 7 m | 2.0 m | -15 deg | 64 / 76 | Frames the nearest threat if it is off screen for more than 1 s |
| `dialogue` | 2.2 m over the shoulder | 1.6 m | 0 | 40 | Alternates speaker framing per line |
| `cinematic` | scripted shots | - | - | 45-55 | Boss intro: wide 1.5 s, push on the boss with a name card 1.5 s, 400 ms ease back. Transformation: 3.2 m front three-quarter, orbits 40 degrees. Ultimate: low hero angle, follows the dive, wide on impact. All skippable after the first view |

Portrait framing: the camera rises 0.6 m and pulls back 1.5 m more; the player sits at 62% of screen height because the control deck covers the bottom 32%. Landscape: player at 55% height. The camera never passes through terrain; characters within 1 m of the camera dither to 40%.
**Camera-pitch flight** (always on for touch; a setting for keyboard and gamepad): in flight the camera pitch is the climb angle. The player's drag sets the pitch (-70 to +70 degrees) and the stick flies along the camera's forward vector, so one drag up climbs and one drag down dives while the left thumb steers. The pitch holds while the stick is deflected, has a soft magnet to level inside +/-8 degrees, and eases back to -6 degrees over 1.5 s once the stick is released. Auto-recentre in flight affects yaw only. With the setting off, pitch follows velocity as before and Jump and Descend change altitude.
Sensitivity defaults: touch 0.25 deg per px, mouse 0.12 deg per px, stick 180 deg per s, keyboard look (arrow keys) 120 deg per s. Invert Y option.

---

## 6. Controls and HUD

### 6.1 Principles (P0)
- One action layer (GDD 5.1) fed by touch, keyboard and mouse, and gamepad. Prompts show the glyph of the last-used device and switch instantly.
- Touch controls are **not mirrored in Hebrew** (thumb memory beats reading direction). A "Left-handed layout" setting swaps sides. HUD text panels follow the language direction, but the compass, target frame, toasts and banners are centred physically in both directions, so nothing slides over the action buttons in Hebrew.
- Contextual visibility keeps the screen clean: Descend only in flight, Form only when a Form is unlocked, Ultimate only at full Surge, technique buttons only when a technique is slotted, Gather only once it is learned, Interact only near something. The right thumb never has more than ten targets.
- Minimum touch target 48 px, minimum gap 8 px, in both orientations (the layout test fails on anything smaller).
- **Gesture hygiene** on the game layers (canvas, touch, HUD): `touch-action: none`, `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none`, `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: none`; `contextmenu` is cancelled; `touchstart` listeners are registered non-passive and call `preventDefault`. Long presses (Form, quick item) therefore never open a text-selection magnifier, a callout menu, double-tap zoom or the back-swipe. Text is selectable only inside the journey-code box and the fatal-error block.

### 6.2 Touch, landscape (P0; reference 844 x 390 CSS px; positions from the safe-area edges)
| Control | Size | Position and behaviour |
|---------|------|------------------------|
| Virtual stick | base 120, knob 52 | Floating: appears where the left thumb lands inside the left 40% x bottom 60% zone (`data-action="move"`). Dead zone 10%, travel 48 px. Idle ghost ring at left 28, bottom 28. In flight with camera-pitch flight the stick moves along the view direction, pitch included |
| Camera drag | - | Anywhere on the right 60% that is not a button (`data-action="look"`); a short tap there on an enemy locks on (48 px tolerance). In flight a drag up or down is also the climb or dive |
| ATTACK | 76 | Anchor of the arc at right 22, bottom 22. Tap = Strike String, hold 350 ms = Breaker |
| BOLT | 60 | 10 o'clock of Attack. Tap or hold = Ora Bolt |
| DASH | 60 | 12 o'clock. Press = Flicker Step; held 0.2 s = sprint or boost; **double tap = boost latch**: the button keeps a lit ring and boost stays on until the stick is released or Dash is tapped again, so the right thumb is free for the camera |
| GUARD | 56 | 8 o'clock |
| JUMP | 60 | 7 o'clock, nearest the bottom edge. Tap = jump, second tap = take off, hold in flight = ascend (fine control) |
| DESCEND | 48 | Flight sub-layout only: appears left of Jump while flying, hidden on the ground |
| GATHER | 56 | **Left side**, directly above the stick zone (left 24, bottom 242). Hold = Gather. The left thumb is free for it because movement is capped at 2 m/s while Gathering |
| ITEM | 48 | Left side, right of Gather (left 92, bottom 246). Shows the quick item's icon and count; tap = use, long-press = next item |
| TECH 1, TECH 2 | 48 each | Above the arc at 1 and 2 o'clock; a radial fill ring shows charge or cooldown |
| FORM | 48 | Top of the arc; glows in the selected Form's colour; long-press cycles Forms |
| ULTIMATE | 56 | Appears above FORM at full Surge, pulsing |
| Lock | no button | Tap an enemy in the camera zone to lock; swipe left or right on the target frame (6.6) to switch target; tap the target frame to release |
| Interact pill | 64 high | Appears centred above the arc with an icon and a verb in the infinitive ("Talk / לדבר", "Open / לפתוח") |
| Pause, Map | 48 each | Top end corner |

### 6.3 Touch, portrait (P0; reference 400 x 860)
The bottom 32% (about 275 px) is the **control deck** with a soft gradient `rgba(15,12,24,0 -> 0.35)`. A utility row sits at the top-left of the deck: Gather 52 and Item 48. The stick (base 108) floats in the left half of the deck below that row. Action arc scaled 0.9 around Attack 68: Bolt 54, Dash 54, Guard 50, Jump 54, arc radius 92; Descend 48 appears left of Jump only in flight. Tech 1, Tech 2, Form (48 each) and Ultimate (52) stack in a column on the right edge above the arc. There is no Lock button. Camera drag: the whole upper 68% outside HUD widgets. Interact pill centred above the deck. Controls hide during dialogue and menus. On screens narrower than 380 px the arc radius shrinks but no target goes below 48 px; the layout test asserts this at 400 x 860 and 360 x 640.

### 6.4 Keyboard and mouse (P0)
| Action | Key |
|--------|-----|
| Move | W A S D |
| Camera | Mouse. Pointer lock is requested on the first click. If it is refused (embedded pages often refuse it): the arrow keys turn the camera, holding the right or middle mouse button and dragging also looks, and the auto-camera stays active, so the game is fully playable without pointer lock, including on a laptop trackpad |
| Keyboard look | Arrow keys (always available, 120 deg per s) |
| Jump, take off (double tap), ascend (hold) | Space |
| Descend | C |
| Flicker Step (press), sprint or boost (hold) | Shift |
| Attack, Breaker (hold) | Left mouse button |
| Ora Bolt | Right mouse button |
| Guard | Q |
| Gather | F |
| Technique 1, 2 | 1, 2 |
| Ultimate | R |
| Form | T |
| Lock-on, switch | Tab; mouse wheel switches |
| Interact | E |
| Quick item | H |
| Map, Quests, Inventory, Techniques, Character | M, J, I, K, U |
| Pause | Esc or P. While pointer lock is active the browser uses the first Esc to release the lock, so losing pointer lock during play opens the pause menu |
Ctrl is never bound (Ctrl+W closes the tab). Rebinding: P1.

### 6.5 Gamepad, standard mapping (P0)
Left stick move, right stick camera, **A** jump and ascend, **B** Flicker and boost (hold), **X** Attack (hold = Breaker), **Y** Ora Bolt, **RB** Guard, **LB** Gather, **RT** descend, **LT** modifier: LT+X Technique 1, LT+Y Technique 2, LT+A Form, LT+B Ultimate. **R3** lock-on, right-stick flick while locked switches target. D-pad up Interact, down quick item, right cycle item, left map. View = map, Menu = pause. Radial dead zone 0.18. Camera-pitch flight is a setting (off by default on gamepad). Rumble is P1. If the Gamepad API is blocked by the embedding page, the pad is simply absent and no pad glyphs are shown.

### 6.6 HUD (P0 unless noted; inset 16 px + safe-area insets)
| Element | Landscape phone | Portrait | Desktop |
|---------|-----------------|----------|---------|
| Medallion | 48 px circle at the top start: level number inside, **Surge ring** around it; a small dot badge when stat points or TP are unspent (tap opens Character) | 40 px | 64 px |
| HP bar | Next to the medallion, 220 x 12, coral `#E8505B` on `#2A2233`, trailing chip bar `#FFD0A0` after 400 ms; continuous | 180 x 10 | 320 x 14 |
| Ora bar | Under HP, 200 x 8, Ora colour, tick marks every 25 Ora (shape differs from HP for colour-blind users); shows Burnout as a grey hatch | 160 x 8 | 300 x 10 |
| **Resonance** | Beside the medallion: `RES 1,240` in the display font, 18 px, digit-roll animation on change, flash on transform | 15 px | 22 px |
| XP | 2 px line along the bottom edge, full width | same | same |
| Compass strip | Top centre, y 16-38, width `clamp(120px, 100vw - 2 x (bars block + 24px), 280px)`, ticks every 15 degrees, POI pips within 400 m, quest diamond, the Spire always | row 2, full width minus 32 | 420 x 24 |
| Target frame | Physical top centre under the compass (y 44-76): name, level, HP 240 x 8, poise bar 4 px, RES tinted by ratio. Touch: swipe = switch target, tap = release | row 3, 200 px wide | same as landscape |
| Boss bar | Replaces the target frame: 60% width, 10 px, phase notches, name above | 90% width | 50% width |
| Quest tracker | End side under Pause and Map: title and one objective, 220 px, 13 px text | row 3, one line, tap expands; hidden while a target or boss frame is shown | 280 px |
| Damage numbers | World-anchored, pop 0.8 m, rise and fade 700 ms; normal `#FFFFFF`, crit `#FFD45A` (+30% size), player damage `#FF6A6A` (smaller); 2 px ink outline; setting to turn off | 85% size | same |
| Toasts | Physical top centre in both languages, below the target-frame slot (from y 84), at most 2, 240 px, in 180 ms, live 3 s | centred directly above the control deck, at most 2 | top centre below the target frame, at most 3 |
| Banners | Physically centred at 28% of the screen height: level up, quest complete, region reveal (2.2 s), Resonance milestone, "Break!", "Perfect!" | same | same |
| Off-screen attack arcs | Screen edge, telegraph colour and shape | same | same |
| Tutorial prompt | Touch: a pulsing ghost over the real button plus one line of text. Others: key or button glyph centred low | same | same |
| Save icon | Spinning light at the bottom end corner for 1 s | same | same |
| Session-only warning | While storage is unavailable: a 24 px amber icon beside Pause, always visible; tap opens the journey-code panel | same | same |
| Quick-item chip | Touch: the ITEM button of the touch layout (6.2). Keyboard and gamepad: a 44 px chip with icon, count and key glyph under the bars | touch layout | under the bars |
| Combo counter, minimap | End side mid-height; 120 px circle | | P1 |
HUD auto-fade: with full HP and Ora and no combat for 4 s the bars fade to 35%; they return on any change.

**Portrait stack** (px from the safe-area top, 400 px wide): row 1 (0-56) medallion, HP and Ora bars, Resonance, then Pause and Map at the end; row 2 (64-86) the compass; row 3 (92-120) the target or boss frame, which replaces the one-line quest tracker while a target is locked or a boss is active. Toasts sit directly above the control deck and banners at 28% height, so the three never share a slot.
**Landscape stack**: bars at the top start, compass centred (16-38), Pause and Map at the top end; target or boss frame centred (44-76); toasts centred from 84; quest tracker at the end side under Pause and Map.
**Layout rule**, asserted by the `ui-hud` scenarios at 844 x 390, 640 x 360, 400 x 860 and 360 x 640 in Hebrew and in English: no two visible HUD rectangles intersect, and no HUD rectangle intersects a touch control (`data-action` rectangles).

---

## 7. Screens and UI identity

### 7.1 Identity: "kite paper and ring" (P0)
- **Shapes**: panels are cut-paper slabs: rectangles with one 12 px diagonal corner cut at the top start, a 2 px ink border, over a darker slab offset 4 px. Section headers sit on a ribbon. Selection is a **ring** behind the icon.
- **Colour tokens**: `--ink #1B1626`, `--paper #F3EBDD`, `--paper-dim #D9CDB8`, `--panel rgba(27,22,38,0.86)`, `--line #4A3F5C`, `--accent #7FF2E0` (follows the active Form colour), `--warn #FFB547`, `--danger #E8505B`, `--ok #7FD18B`, `--hp #E8505B`, `--rarity-c #F3EBDD`, `--rarity-f #7FD18B`, `--rarity-r #5FB6FF`. Dark ink panels with paper-coloured text; paper-coloured title ribbons with ink text.
- **Typography**: one Google Fonts stylesheet loading **Secular One** (display: titles, numbers, banners) and **Rubik** 400, 500, 700 (body); both cover Hebrew and Latin. Body stack: `"Rubik", "Noto Sans Hebrew", "Arial Hebrew", "Segoe UI", system-ui, sans-serif`. Display stack: `"Secular One", "Rubik", "Arial Hebrew", system-ui, sans-serif`. `font-display: swap`, fixed line heights so a failed font load never shifts layout.
- **Type scale** (rem, base 16 px, text-size setting 90 / 100 / 115 / 130%): banner 2.5, title 1.75, h2 1.25, body 1.0, small 0.8125 (never under 12 px). HUD numbers use tabular figures.
- **Icons**: inline SVG drawn in-house, 2 px stroke, round caps, 24 px grid.
- **Motion**: enter 180 ms (ease-out, 12 px from the start side, fade), exit 120 ms, button press scale 0.94 for 80 ms with a ring pulse; nothing in the UI animates longer than 400 ms except banners. Reduced Motion: fades only.
- **RTL**: `dir` and `lang` are set on the `#app` root; all layout uses logical properties; directional icons mirror with `.flip-rtl`; numbers, Resonance and timers stay left-to-right inside `<bdi>`; bars fill from the start side. Touch controls do not mirror, and the compass, target frame, toasts and banners are centred physically; only the text inside them follows the language.
- **Wording**: every Hebrew UI verb (buttons, pills, prompts, system lines) is an infinitive: לדבר, לפתוח, לאסוף, לקנות, לקום. Never an imperative, which would need a gender and can read as a noun. `{g:}` forms are reserved for dialogue. `tools/lint-strings.mjs` flags bare imperatives in UI string tables.
- **Safe areas**: every edge-pinned element uses `max(16px, env(safe-area-inset-*))`; the page uses `height: 100%`, never `100vh`.
- No `alert`, `confirm` or `prompt`: confirmations are in-UI modals.

### 7.2 Screens (P0 unless noted)
All menus pause the simulation (the title shows a live flyover). Menus dim the game to 60% (high also blurs). A level-up is **not** a screen: it is a banner, a light pillar and a medallion badge, and the game keeps running.
| Screen id | Content |
|-----------|---------|
| `loading` | Ink background; a ring fills as the island bakes while the island outline is drawn inside it from the real height data; rotating one-line lore tips; "Shaping the island... 64% / מעצבים את האי" |
| `title` | Flyover of Haven Aster's kite tower at golden hour. Logo in Secular One with a slow light sweep, subtitle in both languages. Buttons: Continue, New Journey, Restore from code, Settings, language pill (עב / EN). The first tap also unlocks audio |
| `newgame` | Preset `hero_a` or `hero_b` with a live preview, form of address (Hebrew only), difficulty. If a journey exists, an in-UI confirmation offers to copy its journey code first. (Choosing among three slots: P1) |
| `pause` | Resume, Character, Techniques, Inventory, Quests, Map, Settings, Controls, Save (journey code), Save and quit to title. Shared tab bar on sub-screens (swipe, LB and RB, Q and E) |
| `character` | Hero preview on the start side; Resonance large at the top; four stats with base + gear and plus buttons (48 px) when points are available; allocation style chips (Balanced, Brawler, Blaster, Manual); derived values list |
| `techniques` | Three branch tabs (Fist, Flare, Spirit); rows with icon, name, rank pips, TP cost, Learn button; detail sheet with description and numbers; two slot pickers and the Ultimate slot. Ring-tree view: P1 |
| `inventory` | Slots (Wraps, Garb, Charm, Charm) on the start side; 64 px item cells with rarity ring and letter badge (C, F, R); compare sheet with deltas in `--ok` and `--danger`; consumables row with the quick-item selector. Portrait: slots on top, grid below |
| `quests` | Tabs Main and Side; list then detail (portrait: push); Track button |
| `map` | The island drawn from the height data as a **parchment map**: contour lines every 50 m `#8C7A5E`, region tints at 40%, ink coastline, wave hatching; undiscovered areas under paper clouds; icons for settlements, Ringstones, shrines, Siphons, quests; player arrow; pinch zoom and drag. Fast travel: P1 |
| `shop` | Merchant name ribbon; Buy and Sell tabs; rows 64 px with price in Shells, quantity stepper; purchase plays the coin chime |
| `dialogue` | Bottom panel, max 720 px, 3 lines; speaker name on a ribbon tab at the top start; text types at 45 characters per s (tap completes, tap again advances); choices as 48 px ribbon buttons. Portrait: sits where the control deck was |
| `savecode` | Two tabs. Copy: the journey code in a selectable, read-only text box with a Copy button (shown only if the clipboard works; otherwise "Select all and copy"). Restore: a text box to paste a code, a Restore button, and a clear message if the code is damaged or from a newer version. Nothing is downloaded |
| `settings` | Tabs: Language; Graphics (quality auto, low, high); Audio (master, music, SFX); Controls (sensitivity, invert Y, camera-pitch flight, left-handed, vibration); Accessibility (section 8.2); Gameplay (difficulty of this journey, damage numbers, short transformations) |
| `controls` | Diagram of the current device's layout |
| `death` | World desaturates over 800 ms; panel "Your light fades / האור שלך דועך" with "Rise at the Ringstone / לקום באבן הטבעת" and, in boss fights, "Retry / לנסות שוב" |
| `ending` | Credits card over the relit Spire, "Continue your journey" |
| `fatal` | Error text in a selectable block, Reload, Try low quality |
| character creation, layout editor, rebinding, photo mode | P1, P1, P1, P2 |

---

## 8. Onboarding and accessibility

### 8.1 Onboarding (P0)
The first ten minutes of the GDD are the tutorial. Prompts follow the last-used device; each shows until the action succeeds twice; a hint appears if the player is hit three times by the same telegraph kind ("Red means Flicker / אדום = צעד הבהוב"). The `controls` screen is always available.

### 8.2 Accessibility
| Feature | Tag |
|---------|-----|
| Text size 90-130% | P0 |
| Reduced Motion: no camera roll, no speed lines, shake 25%, FOV kicks 30%, UI fades only | P0 |
| Flash budget in every mode (3.1): at most 3 large flashes per s, luminance alpha 0.4 or less. Photosensitivity mode: 2 per s, alpha 0.25 | P0 |
| Colour-blind safety: telegraphs use colour **and** shape (red = notched ring and triangle; player rings are always solid); rarity uses a letter badge; HP and Ora bars differ in shape | P0 |
| Off-screen attack arcs: every important audio cue has a visual twin | P0 |
| Screen shake slider, vibration toggle, damage numbers toggle | P0 |
| Hold-to-toggle for Guard and Gather, auto-combo, aim-assist strength, colour-blind filters | P1 |

---

## 9. Audio direction

### 9.1 Architecture and mix (P0)
- Graph: `voices -> bus (sfx, ui, music) -> master compressor (threshold -18 dB, ratio 4, attack 5 ms, release 120 ms) -> master gain -> destination`. Music ducks -6 dB under big impacts by gain automation (80 ms attack, 400 ms release).
- **One-shots are pre-rendered; only loops are synthesised live.** Building a fresh oscillator and filter graph for every bolt, hit and XP tick would create 50-150 audio nodes per second in a barrage and causes garbage-collection stalls and crackle on phones. Instead every one-shot recipe of 9.2 is rendered once into an `AudioBuffer` with an `OfflineAudioContext` (2 detune variants on low, 3 on high; about 45 s of mono audio in total), in time-sliced batches behind the loading and title screens. Playing a sound takes one pooled voice: `AudioBufferSourceNode -> gain -> panner`, with pitch variation by `playbackRate`. Live synthesis is kept for four loops only: `wind_loop`, `gather_loop`, `beam_loop`, `siphon_loop`. A sound requested before its buffer exists is skipped silently. Budget: at most 120 live audio nodes during a 10 s Flare Barrage (asserted by a scenario).
- Shared resources created once: white, pink and brown noise buffers (2 s), a soft-clip curve, one generated reverb impulse (2.2 s) used on high only; low uses a feedback delay.
- Voices: 24 on low, 32 on high. Per-recipe caps (bolt 6, hits 8, steps 2, explosions 4, UI 3); steal the oldest and quietest. Same-id sounds within 30 ms merge.
- Spatialisation: StereoPanner and distance gain `1 / (1 + d/15)`, plus a lowpass from 18 kHz at 0 m to 2 kHz at 150 m. No HRTF.
- Mix targets: impacts 0 dB, techniques -3 dB, foley -10 dB, music -9 dB exploring and -6 dB in combat, UI -12 dB. Every SFX gets plus or minus 4% detune and 1.5 dB gain variation.
- The AudioContext starts on the first user gesture; a muted-speaker icon shows until then. In menus the music is lowpassed to 800 Hz at -6 dB. Hidden tab: suspend.

### 9.2 SFX recipes (P0; ids are the `audio.play` ids)
Notation: `osc(type, f)`, `noise(colour)`, `bp / lp / hp(f, Q)`, envelope A/D in ms, `->` sweep. Ids ending in `_loop` are live loops; every other id is a pre-rendered one-shot (long ones such as `beam_charge` are rendered at full length and stopped early).
| id | Recipe |
|----|--------|
| `step_grass`, `step_stone`, `step_snow`, `step_water` | brown noise lp 900, env 2/60; stone: bp 1800 Q2; snow: noise hp 3k env 10/120; water: pink noise bp 1200, env 2/90. Sand plays `step_grass` at pitch 0.7 |
| `jump` | sine 220->330 80 ms and a noise puff hp 2k 40 ms |
| `land`, `land_heavy` | sine 90->40 env 2/180 and brown noise lp 400 env 2/250; heavy adds a 55 Hz thump |
| `takeoff` | pink noise bp 600->2400 Q1 over 400 ms and sine 180->360 |
| `wind_loop` | pink noise -> bp (500 + speed x 20 Hz, Q 0.7) and an octave-up band; gain by speed; 0.3 Hz LFO |
| `flicker_out`, `flicker_in` | two saw blips 1200->2400 40 ms with a 30 ms gap and hp noise shimmer; in: sine 1600->800 50 ms |
| `boost_start` | noise bp sweep 3k->800 in 180 ms and sine 400->120 |
| `sonic_boom` | sine 60 Hz env 1/400 through soft clip, noise lp 2.5k env 1/300, a delayed tail |
| `whoosh` | noise bp 800->2k 90 ms |
| `hit_light` | noise bp 1500 Q1 env 1/50 and sine 180->90 env 1/70 |
| `hit_heavy` | noise bp 900 Q0.8 env 1/120, sine 120->45 env 1/220 soft-clipped, click (square 2 kHz 5 ms) |
| `hit_finisher` | `hit_heavy` plus a 55 Hz thump 400 ms and reverb send |
| `gather_loop`, `gather_full` | pink noise bp 300 Q0.5 with 18 Hz tremolo and saw 55 Hz through lp 300->1400 rising with the hold; full: chime (sines 880 + 1320, env 5/600) |
| `bolt_fire`, `bolt_hit` | square 900->1400 60 ms and hp noise 4k 30 ms, alternating pitch; hit: noise bp 2k Q1.5 env 1/90 and sine 300->100 |
| `beam_charge`, `beam_loop`, `beam_end` | three detuned saws (110, 110.7, 220.4) lp 200->3000 with a rising sine 200->800 and crackle clicks; loop: saw 82 + square 164 -> soft clip -> lp 2.2k with 6 Hz LFO, noise bp 1200; end: lp closes over 180 ms |
| `nova` | sine 70->30 500 ms and noise lp 3k->400 env 1/500 |
| `explosion_s`, `explosion_m`, `explosion_l` | brown noise lp (1.5k, 1k, 700) env 2/(300, 600, 1200), sub sine (80, 60, 45) soft-clipped, sparse crackle tail |
| `rock_break`, `crater` | noise bp 400 Q1 env 1/300 and 6 pebble clicks; crater adds `explosion_m` at -6 dB |
| `ult_rise`, `ult_impact` | pad of 4 sines with an 800 ms attack over `beam_charge`; impact: `explosion_l` x1.5 and a 1.2 s sub drop 50->25 Hz, music ducked 12 dB for 1.5 s |
| `guard_on`, `guard_block`, `perfect` | sines 500 + 750 env 5/100 with bp noise 3k Q8; block: noise bp 2.5k Q6 env 1/120; perfect: block and a bell (sines 1046, 1568, 2093, decay 700 ms) |
| `transform_rise`, `transform_burst`, `burnout` | pink noise and a saw chord sweeping lp 200->6k over 900 ms with accelerating 60 Hz heartbeats; burst: `explosion_m`, bell chord in the Form's key, reverse swell; burnout: descending triangle 600->150 and a fizz |
| `tele_white`, `tele_red`, `tele_violet` | short rising ping 1.2 kHz; harsh two-pulse square 300 Hz; wobbling sine 400 Hz with vibrato |
| `enemy_growl`, `enemy_death`, `boss_roar` | saw 90 Hz through two formant bandpasses with pitch wobble; death: the same through lp 3k->200 over 700 ms; roar: saws 60 and 61.3 and square 30, formant sweep, env 100/1500 |
| `player_hurt`, `player_death`, `heal` | noise bp 700 thud and sine 250->120; pad dropping a tritone; rising triangle triplet |
| `xp_orb`, `pickup_item`, `shells` | sine blip rising a pentatonic step per orb; triangle arpeggio and sparkle; two sine pings 2.6k and 3.1k |
| `level_up`, `quest_start`, `quest_step`, `quest_complete`, `discover` | major arpeggio with a sustained chord; two-note kite horn (square through bp 800 Q3, a fifth up); one horn note; horn and chord pad; bell chord and a flute motif |
| `ringstone`, `shrine`, `chest_open`, `ring_gate`, `race_start`, `race_end` | glassy sine swell 660 + 990; shimmering bell cluster; wooden clack and sparkle; sine ping rising by gate index; three ticks and a horn; horn fanfare |
| `siphon_loop`, `siphon_core`, `siphon_break` | low detuned saw drone 40 Hz with slow downward sweeps; metallic shutter clank; glass shatter (noise hp 4k bursts), then a rising pad |
| `ui_move`, `ui_confirm`, `ui_back`, `ui_error`, `ui_open`, `ui_close`, `dialogue_tick` | sine 1400 env 1/30; sine 880->1320 env 2/80; sine 1100->700; two square pulses 200 Hz; noise swish bp 1k->3k and reverse; triangle tick at the speaker's pitch |
Ambience beds per region and weather sounds: P1.

### 9.3 Adaptive generative music (P0: exploration, combat, boss intensity, stingers; P1: authored boss motifs)
A look-ahead scheduler (25 ms timer, 100 ms horizon) drives a pattern engine: each state has a scale, tempo, chord progression (4-8 bars) and parts that choose notes by weighted rules (chord tones on strong beats) from a seeded generator. Layers crossfade over 2 s; state changes land on the next bar. Low tier plays at most 4 parts.

Instruments: **kite-flute** (sine plus triangle, delayed vibrato, breath noise), **plucked lute** (noise burst into a feedback delay with a lowpass), **pad** (three detuned saws, lp 900, slow envelope), **bell** (FM sine, ratio 3.5), **frame drum** (sine 110->50 and noise), **shaker** (hp noise), **bass** (triangle and sub), **brass stab** (two saws through a fast filter envelope). Like the SFX, each instrument is pre-rendered into a few short sample buffers (one per octave; drums one each) and notes are played as buffer sources with `playbackRate`, so a note costs two nodes.

P0 ships **three exploration palettes** plus combat and boss music; a separate scale per region is P1.

| Palette | Used in | Scale (root) | Tempo | Day | Night |
|---------|---------|--------------|-------|-----|-------|
| `warm` | Meadows, Coast, Rustdune | D major pentatonic | 84 | flute lead, lute arps, soft pad | pad and bell, sparse flute |
| `cold` | Thornwood, Frostspine, Stormwell, Spire Heart | B Dorian | 58 | bell, airy pad, long flute notes | bell only |
| `corrupted` | within 300 m of a standing Siphon, at Choir camps, in the Dim Court | C sharp minor with a raised fourth | 64 | low drone, bass pulses, reversed swells | drone and bell |
| settlement overlay | any settlement | palette of its region, +8 BPM | | adds lute and shaker | lantern bell |

Density: dawn 40%, day 70%, golden 80%, dusk 50%, night 30%. Exploration leaves 8-20 s of silence between phrases.
**Combat**: same key, 132 BPM; frame drums (kick on 1 and 2.5, rim on 3, sixteenth shaker), root-fifth bass ostinato, a flat sixth for tension. Intensity 0-3 from `combat:state` threat: drums; plus bass; plus brass stabs; plus flute melody. **Boss** = intensity 3 at 140 BPM, modulating up a minor third on each phase. Leaving combat: 4 s tail ending on a bar.
**Stingers**: transformation (two-bar fill, drum roll accelerating, bell chord: Ember +0, Tempest +5 semitones, Zenith +7 with a Lydian fourth; the combat layer stays in that key while the Form lasts), level-up, quest complete, discovery, death, Resonance milestone.

---

## 10. Priority checklist

**P0**: palette and seven region palettes (the Stormwell as terrain colours only); five-key day cycle; toon materials with rim and outlines; sky with painted clouds and the Seam; terrain colouring, cliffs, scorch, canopy tint on far terrain; toon water with baked depth; six vegetation families (Stormwell reeds as simple scatter), rocks, destructibles; houses, kite poles, Ringstones, shrines, chests, ring gates, Siphons, six settlements and the Tide Beacon, camps, the Spire and Crown; Tavi (two presets), three Forms; named NPCs and the villager generator; nine enemy looks; five bosses; all VFX in 3.2 except the P1 row; the flash budget; the feel table; camera modes with camera-pitch flight; touch layouts in both orientations; keyboard and mouse; gamepad; the full HUD with the layout rule; all P0 screens including the journey code; onboarding; core accessibility; low and high tiers; audio graph with pre-rendered SFX, all listed SFX, three exploration palettes, combat and boss music, stingers.
**P1**: the medium tier, Stormwell props and Storm Golem look, per-region music scales, gamepad rumble, depth-edge ink, weather, ambience beds, minimap, combo counter, character creation, layout editor, rebinding, manga impact frame, authored boss motifs, ring-tree technique view, colour-blind filters, Eclipse Form art, three save slots.
**P2**: painted face atlas, photo mode, more hair and outfit meshes.
