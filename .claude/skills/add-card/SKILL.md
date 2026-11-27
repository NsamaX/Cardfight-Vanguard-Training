---
name: add-card
description: Add a new card or sleeve to the default library from an image the user placed in .temp/ (or .temp/sleeves/). Use when the user asks to add a card or sleeve from a picture.
---

# Add a card or sleeve from an image

Follow the sections in order and finish with the report at the end.

Reference docs: the card file format in [README.md](../../../README.md#content-files), [vocabulary.md](../../../documents/vocabulary.md) (ability codes), [timing-g.md](../../../documents/timing-g.md) (timing), [rules-g.md](../../../documents/rules-g.md) (rules).

## What the user provides

| What | Where | File name |
|---|---|---|
| Raw card image | `.temp/` | Anything, e.g. `VGE_BT02-014EN.webp` |
| Raw sleeve image | `.temp/sleeves/` | Anything |

If the user doesn't name the file, look for files in `.temp/` not yet in `SOURCES` (and files in `.temp/sleeves/` not yet in `SLEEVES`) of `tools/clean_images.py`. If there are several, ask which ones to add.

Never edit or delete files in `.temp/`: the script rebuilds every image from them on each run.

---

## Part 1: Add a card

### Step 1: Read the card image

Open the image and note the following. If anything is unreadable (too small, cropped, blurry), ask the user. Don't guess.

| Data | Where on the card |
|---|---|
| Card number and rarity | Bottom left, e.g. `BT02/014TH RR` |
| Card name | Name bar at the bottom |
| Grade | Top left (G units and G guardians = 4) |
| Power / Critical | Bottom bar |
| Shield | Left bar (cards without a Shield bar, such as grade 3 and G units, omit it) |
| Skill icon | Under the grade (Boost, Intercept, Twin Drive, Triple Drive) |
| Trigger icon and the Power on it | Top right (Critical, Heal, Stand, Draw) |
| Race and clan | Bottom bar under the name |
| Ability text | Text box |

**Card language:** `name`, `race`, `clan`, and `text` are in English as on the EN card. `ids` use the Thai card number (ending in `TH`), because decks and images reference cards by that number.
- **English card image:** use the name, race, clan, and text from the image verbatim, then ask the user for the Thai card number.
- **Other language:** ask the user for the English name and text. If the user asks you to translate, use the same terminology as other library cards and note in `notes` which language it was translated from.
- **Reprint from another era (e.g. D-PV01, V-SS10):** stats and abilities may differ from the G version (e.g. Shield 15000 or a +10000 trigger). Ask the user which values to use, and note in `notes` which version the image is and where the values came from.

### Step 2: Check whether the card already exists

Search `content/cards/` for the name. If a card with the same name and word-for-word identical ability text exists (only a different printing), don't create a new file: add the number to that file's `ids` and explain why in `notes` (see `Tommy the Ghostie Brothers.yaml`). Then skip to step 6.

### Step 3: Create the card file

**Folder:** `content/cards/<clan>/<type>/`, where `<clan>` is the `clan` field in lowercase with spaces → `-` (e.g. `granblue`, `cray-elemental`, `genesis`)

| Type | Folder |
|---|---|
| G unit, G guardian | `content/cards/<clan>/g/` |
| Normal unit (including non-trigger grade 0) | `content/cards/<clan>/normal/` |
| Trigger unit | `content/cards/<clan>/trigger/` |

**File name:** the card name without `,` plus `.yaml`, e.g. `Undying Departed, Grenache` → `Undying Departed Grenache.yaml`

**Fields (in this order):**

```yaml
ids: ["BT02/014TH RR"]          # number + rarity as printed; the part before the space is the card code
name: "Gust Jinn"               # exactly as on the card, including ,
format: [G]
type: normal                    # normal | trigger | g-unit | g-guardian
trigger: critical               # triggers only: critical | heal | stand | draw
grade: 1
power: 6000                     # number / G units as the string "15000+" / G guardians have none
shield: 0                       # per the Shield bar; no bar = omit (treated as 0)
critical: 1
skill: boost                    # skill icon: boost | intercept | twin-drive | triple-drive (G guardians have none)
trigger_power: 5000             # triggers only: the Power on the trigger icon
race: "Demon"
clan: "Granblue"
abilities: [...]                # step 4
text: |                         # step 5
  ...
notes: |                        # optional
  ...
```

- If the rarity is cut off or there's a stamp, add it in parentheses in `ids`, e.g. `"BT02/026TH R (Fighters Road Thailand 2018 stamp)"`.
- A card with no abilities gets `abilities: []` and no `text`.

### Step 4: Write `abilities` (code the engine runs)

One entry per ability on the card, in card order, using only codes from [vocabulary.md](../../../documents/vocabulary.md).

```yaml
abilities:
  - kind: "AUTO"                # AUTO | ACT | CONT | STRIDE | ULTIMATE STRIDE | G GUARDIAN
    zone: "RC"                  # where it works: VC | RC | GC | VC/RC | hand | G zone (omit = anywhere)
    timing: "enter(RC, self)"   # AUTO, STRIDE, G GUARDIAN only
    cond: ["GB(1)", "1/turn"]   # conditions
    cost: ["CB(1)"]             # costs
    effect: ["draw(1)"]         # effects, in resolution order
```

- **Keywords:** Hollow = AUTO `enter(RC, self)` + effect `["hollow(self)", "retire(self, at=turn-end, if=self-hollowed)"]`; Sentinel = CONT `["keyword(Sentinel)"]`; Forerunner = see `Undying Departed Grenache.yaml`; Cray Elemental cards = CONT `["all-clan(self)"]`.
- **Words inside codes are English, as on the card:** clan names in `filter=` and `vc-clan(...)` match the `clan` field, e.g. `Granblue`; words in `name("...")` match the card name, e.g. `name("Nightrose")`.
- **STRIDE / G GUARDIAN:** copy the pattern from a library card of the same type.
- **No undefined codes:** if the card has an event, condition, or effect with no code yet, add the code to vocabulary.md first and tell the user the engine doesn't support it yet (see the next table).

**Codes the engine (`src/engine/abilities.ts`) actually runs today:**

| Part | Supported |
|---|---|
| kind | AUTO, ACT (CONT doesn't run at all, except for the Sentinel deck building check) |
| timing | `enter`, `stride`, `ridden-upon`, `attack`, `battle-end`, `to-drop` (`from=RC` or `from=soul`, the latter sent by Soul Blast), `retired`, `discarded`, `phase-start`, `attack-hit`, `to-soul(own)`, `turn-end`; `stride(own, filter=…)` checks the G unit's name |
| cond | `GB(n)`, `1/turn`, `own-turn`, `self-hollowed`, `vc-name(...)`, `heart-name(...)`, `vc-grade≥n`, `vc-clan(...)` |
| `if=` | `self-hollowed`, `called-has-hollow`, `called≥n`, `hollow-milled≥n`, `name-in-drop(...)`, `souled≥n`, `souled-name(...)`, `G-faceup≥n`, `G-faceup(filter)≥n`, `returned≥n`; any other condition skips the effect |
| cost / effect | `CB`, `CC`, `SB` (with `filter=`; the player picks when there's a choice), `SC`, `mill`, `draw`, `reveal`, `discard`, `retire-own`, `retire`, `soul-in`, `bind`, `flip-G-up`, `call`, `search`, `power`, `shield`, `critical`, `no-hit`, `choose`, `hollow`, `grant`, `return-to-deck`, `swap`, `damage-facedown`, `to-soul`, `look`, `to-hand`, `drive`, `stand` (also `at=battle-end`), `to-deck`, `to-deck-top`, `shuffle`; `grant` gives AUTO or ACT |

Codes outside this table can still be written (`tools/find_chains.py` uses them for combo search), but during play the effect is skipped with "Effect … isn't automated yet" in the history.

### Step 5: Write `text` (what the player reads)

Copy the English text from the card verbatim. Group by kind in this order: ULTIMATE STRIDE, STRIDE, G GUARDIAN, AUTO, ACT, CONT (one heading per kind).

```markdown
### AUTO

- Hollow
- **Condition:** GB1 | **Timing:** When this unit is placed on (RC) from your drop zone | **Cost:** CB1
  - **Effect:** You may pay the cost. If you do, choose up to one of your opponent's rear-guards, and retire it.

### CONT

- Sentinel
```

- The main line starts with `- ` and has **Zone** / **Condition** / **Timing** / **Cost** only where the card has them, separated by ` | `.
- **Effect** goes on a sub-line indented 2 spaces.
- Keywords are a single line, e.g. `- Hollow`.
- Clan names use `<<Granblue>>` as printed.
- Card icons are written as text: circles in parentheses, e.g. `(RC)`; costs abbreviated, e.g. `CB1`, `SC1`.

### Step 6: Make the card image

1. Add a line to `SOURCES` in `tools/clean_images.py`, alphabetically: `"file in .temp": "name in the card file"` (must match `name` exactly, or the script stops).
2. Run `python tools/clean_images.py`. It trims the background, resizes to 544×793, evens out brightness and saturation with the other cards, rounds the corners, and saves `content/images/<clan>/<card code with / replaced by _>.png`.
3. The script rebuilds every image in `SOURCES` each run. Entries with no raw file in `.temp/` print "Skipped", which is normal; images already in `content/images/<clan>/` are kept.
4. **Always look at the result** next to other cards in `content/images/<clan>/`: trimmed tight to the card, no white or black edge left, not tilted, colors not washed out or oversaturated. If something is off, tell the user the likely cause (e.g. the raw image has a non-white background or was shot at an angle). Don't change script values that apply to every card.

### Step 7: Update the docs

- **[vocabulary.md](../../../documents/vocabulary.md):** add the card name to the "Cards" column of every code it uses, add a row to the section 5 table if it causes or waits for an event that chains with other cards, and update the card count in the intro.
- **[timing-g.md](../../../documents/timing-g.md):** add the card name to the "Cards that act" column of the timings it acts at.
- Don't add the card to the sample deck unless the user asks.

### Step 8: Check

```
npm run typecheck
npm test
```

Both regenerate `src/data/content.json` from `content/` first, so a malformed YAML file fails here.

---

## Part 2: Add a sleeve

1. Add a line to `SLEEVES` in `tools/clean_images.py`: `"file in .temp/sleeves": "sleeve name"`. The name is lowercase English, no spaces, no extension, e.g. `"Sleeve_Nightrose_01.png": "nightrose"` (shown in the deck builder's sleeve list).
2. Run `python tools/clean_images.py`. It trims the background, resizes to 440×640 (cropping the overflow from the center, no stretching), and saves `content/sleeves/<name>.jpg`. Sleeves get no color adjustment or rounded corners.
3. Look at the result: no background or frame left, nothing important cropped.

---

## Publish to the app

The app reads the default set from Supabase, not from `content/`. Tell the user to run `npm run sync-defaults` (it needs `SUPABASE_SECRET_KEY` in `.env`, so only on their machine). Guests and new players get the whole set; players who already signed in get the new cards on their next load (cards they edited are kept).

## Report to the user

Cover all of these:
- Files created or changed, with paths
- Anything unreadable from the image, or guessed/translated (nothing guessed without saying so)
- Ability codes the engine doesn't support yet, and what happens during play
- The image check result, and the `npm run typecheck` / `npm test` results
- That `npm run sync-defaults` is needed to publish
