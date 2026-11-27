# Cardfight Vanguard Training

A web app for practicing Cardfight!! Vanguard (G era) against a bot, with card and deck building. Built with Next.js, React, and Supabase.

- **Guests** play the default cards and decks against the bot.
- **Signed-in players** (Google) get their own copy of the default set, can create and edit cards, decks, and sleeves, and keep replays in the cloud, and play online against friends by sharing a 6-digit room code.

Game rules and ability codes used by the engine live in [documents/](documents/):
[rules-g.md](documents/rules-g.md) (rules), [timing-g.md](documents/timing-g.md) (when abilities resolve), [vocabulary.md](documents/vocabulary.md) (ability codes).

## Getting started

```
npm install
npm run dev           # http://localhost:3000
npm test
npm run typecheck
npm run build
```

`dev`, `build`, `test`, and `typecheck` first run `npm run content`, which converts the YAML in `content/` into `src/data/content.json`. Restart the dev server after editing content files.

### Supabase

Without Supabase settings the app still runs as an offline guest with the bundled default set (no card images, no sign-in).

1. Create a Supabase project and run the SQL files in `supabase/migrations/` in order, in the SQL Editor.
2. Enable the Google provider under Authentication > Sign In / Providers (needs an OAuth client from Google Cloud Console with the redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`). Add your site URLs under Authentication > URL Configuration.
3. Copy `.env.example` to `.env` (git-ignored) and fill it in:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   SUPABASE_SECRET_KEY=sb_secret_...        # only for sync-defaults, never in the browser
   ```
4. Upload the default set: `npm run sync-defaults`. Run it again whenever `content/` changes. Guests and players signing in for the first time get the whole set. Players who already signed in get the default cards and decks they haven't received yet, once each, on their next load; cards they edited and decks they deleted stay as they are.

To deploy on Vercel, set only the two `NEXT_PUBLIC_` variables there, and add the Vercel domain to the Supabase redirect URLs.

## Status

| Part | Status |
|---|---|
| Phases and battle (`engine/game.ts`) | Complete per [rules-g.md](documents/rules-g.md), except ultimate stride |
| Card abilities (`engine/abilities.ts`) | AUTO and ACT run automatically from the ability code in card files |
| Bot (`bot/`) | Beta (default, same as Nightmare; the only selectable level for now), plus Normal, Hard, Nightmare (locked) |
| Decks and sleeves | Guests view and use the defaults; signed-in players edit their own |
| Card editor | Signed-in players create/edit cards, including the image; card text is edited as plain text, ability codes are picked step by step |
| Replays (`replay/`) | Save, step through, change speed, download/open files, continue from any step |
| Languages (`i18n/`) | English (default), Japanese |
| Combo tutorial | Combo files and loader exist (`data/combos.ts`), no screen yet |
| Online play (`lib/online.ts`, `hooks/useMatch.ts`) | Signed-in players: create a room and share its 6-digit code, or join by code; play again in the same room (Ready, then Start on both sides); resume after a reload; no undo, replays, or deck editing during a match |

Not supported yet: CONT abilities (except Tommy's +2 grade for the stride cost), Sebreeze's ACT, Megiddo's ultimate stride, and "up to 3" mills (always mills 3).

## How to play

The bot plays the top side and starts with the Genesis Regalia deck (`BOT_DECK` in `src/data/decks.ts`; if the library has no deck of that id or name, the first deck); your side starts with the first other deck. Before **Start**, click either deck to see its whole list. **Start** puts the starting vanguards on VC and draws 5.

| To | Click |
|---|---|
| Mulligan | Hand cards to return → **Change** (none = **Confirm**) |
| Ride | Hand card → VC |
| Stride | In the stride step: G zone → a G unit → hand cards to discard (total grade 3+) → **Stride** |
| Call / move | Hand card → RC (main phase) / rear-guard → the other circle in its column |
| Use a pending ability or ACT | Yellow-bordered card → **Yes** / **No** |
| Attack | Your front-row unit (+ the grade 0–1 behind it to boost) → an opponent's front-row unit |
| Guard | Hand cards → **Yes**. Intercept: click a front-row grade 2. G guardian: G zone → G guardian → a Heal in hand → **Yes** |
| Trigger | Click the trigger card on the battle bar → unit for Power+5000 → (Critical/Stand) unit for the second effect |
| Undo / redo | Arrows on the left of the middle bar |
| Reorder the G zone | Open the G zone and drag cards onto each other |

Bottom-right buttons:
- **Reset**: new game, same decks.
- **Decks**: pick, view, edit, swap, and delete decks. While Decks is open, the right panel shows the card under the mouse.
  - In the editor, click a library card to add it and a deck row to remove it. The first grade 0 added becomes the starting vanguard (★ changes it) and the first card added becomes the deck cover; removing the last copy leaves the spot empty until the next card fills it. The Deck slot shows the starting vanguard.
  - Sleeves: click the Main or G slot to empty it, then click a sleeve in the Sleeves tab to fill it. A slot left empty uses the side's default sleeve.
  - Adding stops at the caps: 4 copies per name, 16 triggers, 4 Heals, 4 Sentinels. Triggers are a cap, not a requirement (the real rules ask for exactly 16).
  - **Delete** (next to Done) asks you to type the deck's name.
- **Replays**.
- **Online**: sign in and pick your deck. With the code box empty the button is **Create room** (gives a 6-digit code for your friend); typing a code turns it into **Join room**. Your side is always at the bottom and the other hand is face down. After a game both players press **Ready** (right of the middle bar) for the next one; before it starts each player may pick another deck (**Decks**, next to **Leave**), and it starts once both press **Start**. A game still running shows **Resume** here after a reload. **Leave** closes the room for both players.
- **Settings**: account, language, bot level, first player, seed. Opens on the first visit. **Apply** is enabled only after a change; the bot level takes effect at once, first player and seed from the next game (at once if the game hasn't started).

## Project structure

| Folder | Contents |
|---|---|
| `src/app/` | Next.js App Router entry (layout and page) |
| `src/components/` | React UI, data and callbacks via props (`board/` the board, `deck/` the deck and card screens) |
| `src/hooks/` | Screen state: `useBoard` (clicks → engine actions), `useLibrary` (load/save cards, decks, sleeves), `useAuth`, `useCardFlight` (card animations) |
| `src/lib/` | Non-React helpers: board rules (`board.ts`), deck editing, ability drafts and the step-by-step code picker for the card editor, card text ↔ plain text (`cardText.ts`), game settings, Supabase access (`library.ts`, `supabase.ts`), image resizing, number formatting |
| `src/engine/` | Game state, rules, phases, the check timing queue, and ability codes (`types.ts` holds the shared types) |
| `src/bot/` | The bot (see below) |
| `src/data/` | In-memory card registry (bundled set, replaced by the Supabase library at runtime), default decks, combos, default sleeves, deck validation |
| `src/replay/` | Replay format, playback, and guest storage |
| `src/i18n/` | Dictionaries (`en.ts` defines the keys, `ja.ts`) and `useT()` |
| `content/` | Default cards, decks, combos, card images, sleeves (source for `sync-defaults`) |
| `supabase/migrations/` | Database schema and row-level security |
| `scripts/` | `gen-content.mjs` (content → JSON), `sync-defaults.mjs` (content → Supabase), `test.mjs` |
| `tools/` | Python helpers (see Tools) |

### Design

The engine is pure: `apply(db, state, player, action)` returns a new state plus events and randomizes only from the seed. That gives undo/redo (keep old states), replays (seed + decks + actions), the bot (answers the same `Decision`s through `Bot.decide()`), and online play (see below).

### Online play

`join_match` rolls the seed and first player on the database and stores both decks with their card data in the `matches` row. Each client builds the game from that row (a guest card whose key the host also uses with different data is renamed `<key>~2`, so each side plays its own version) and runs the engine locally. Each game in a room is its own `matches` row: when both players press Ready, `ready_rematch` creates the next row in `setup`, where `set_match_deck` swaps a player's deck and `start_match` rolls the seed once both have pressed Start. Every action goes into `match_actions` with its place in the match as `seq`; the other client receives it through Realtime (with a poll every 4 s as a fallback) and plays it on its own board. The host plays the engine's `me` side and the guest the `bot` side; the board shows the local side at the bottom. Clients on different builds can't pair, since `join_match` compares the commit hash (`NEXT_PUBLIC_BUILD_ID`, set in `next.config.ts`). Both clients hold the whole game state, so this is meant for friendly games, not as protection against cheating. The engine emits text as `Msg` keys, translated when displayed, so switching language also re-translates the history.

### Bot

The bot always plays the bot side. It knows both decklists but not the deck order, and (except Beta and Nightmare) not your hand.

| Level | How it thinks |
|---|---|
| Beta | Same as Nightmare; the default and, for now, the only level you can pick (the others are shown locked) |
| Normal | Decision rules only (`bot/policy.ts`) |
| Hard | Rules + remembers revealed cards + plays every reasonable option forward to the end of the turn with the hidden information randomized; switches from the rule's choice only when clearly better (≤1.5 s) |
| Nightmare | Like Hard but knows your real hand |

The rules count remaining triggers, estimate the opponent's guard, check lethal across the turn, pick guards by expected cost, keep enough hand to survive next turn, and test costed abilities before paying. Measure strength with `ARENA=1 A=hard B=normal N=20 npm test -- src/bot/arena` (`MS=100` thinks faster).

### Adding UI text

Add the key to `src/i18n/en.ts`, then the same key to `ja.ts` (`npm run typecheck` fails if they differ). Use `{name}` placeholders. In the engine and lib use `msg("key", {...})` or `throw new RuleError("key", {...})`; in components use `const t = useT()`. For a new language, add a dictionary and register it in `src/i18n/index.ts`.

## Content files

| Folder | Contents |
|---|---|
| `content/cards/<clan>/g/` | G units and G guardians |
| `content/cards/<clan>/normal/` | Normal units, including non-trigger grade 0 |
| `content/cards/<clan>/trigger/` | Trigger units |
| `content/decks/` | Default decks (the first by file name is the starting deck) |
| `content/combos/` | Combo tutorials |
| `content/images/<clan>/` | Card images, 544×793 PNG, named by card code with `/` → `_` (e.g. `granblue/G-CHB03_S11TH.png`) |

`<clan>` is the card's `clan` in lowercase with spaces → `-`, e.g. `granblue`, `cray-elemental`, `genesis`. Images go to the bucket flat under `defaults/`, so moving a card to another folder doesn't change its image URL.
| `content/sleeves/` | Sleeve images, 440×640 |

**Card code:** the first part of the first entry in `ids`, e.g. `"G-CHB03/S11TH SP"` → `G-CHB03/S11TH`. Decks, combos, and image names use it. One file per card; reprints with identical text share a file.

**Card fields:** `ids`, `name`, `format`, `type`, `trigger`, `grade`, `power`, `shield` (omit = 0), `critical`, `skill` (`boost` | `intercept` | `twin-drive` | `triple-drive`), `trigger_power`, `race`, `clan`, `abilities`, `text`, and optional `notes`. Names and text are English as on the EN card; `ids` use the Thai printing.
- `abilities` is the code the engine runs: each entry has `kind`, `zone`, `timing`, `cond`, `cost`, `effect`, using codes from [vocabulary.md](documents/vocabulary.md). Optional `follows: true` marks an ability that builds on the one above it (e.g. Nightstorm's hollowed ability); it only indents it in the editor and inspector.
- `text` is the real card text in Markdown, grouped by kind (ULTIMATE STRIDE, STRIDE, G GUARDIAN, AUTO, ACT, CONT), with **Zone** / **Condition** / **Timing** / **Cost** on one line and **Effect** below. The inspector splits it into ability boxes. The card editor shows it as plain text (a kind line, then `Label: value` lines, a blank line between abilities) and saves it back in this layout.

**Deck fields:** `name`, `format` (`G`), `starter` (grade 0 card code, counted in `main`), `main` (code → count, 50 total), `g_zone` (code → count, max 16), optional `sleeve` / `g_sleeve` (file in `content/sleeves/`; unset = the side's default sleeve), optional `cover` (card code; unset = the first G unit, otherwise the highest grade). The file name is the deck id.

**Combo fields:** `id`, `name`, `difficulty` (1–5), `summary`, `tags`, `setup` (starting board), `steps` (actions with `hint`), `result`. See `content/combos/off-turn-shot.yaml`.

To add a card or sleeve from an image, use the `/add-card` Claude Code skill (`.claude/skills/add-card/`).

## Tools

The Python scripts need PyYAML; `clean_images.py` also needs numpy and Pillow.

- **`python tools/clean_images.py`** builds card images (`.temp/` → `content/images/<clan>/`, listed in `SOURCES`) and sleeves (`.temp/sleeves/` → `content/sleeves/`, listed in `SLEEVES`): trims the background, resizes, and for cards evens out color and rounds corners. Source files are never modified.
- **`npm run combos -- <deck>`** finds a deck's strongest turns by playing them with the real engine (`src/bot/lab/`) and writes a picture guide to `.temp/combos-<deck id>.html`. It builds test boards (each grade 3 vanguard with vanguard abilities, at GB1 and GB3 after striding, with a full hand, drop zone, and soul), then searches for the best line per goal: `pressure` (Shield the opponent must spend, criticals, shots), `attacks` (attacks reaching 11,000 Power), `farm` (cards, CB, and soul at the end of the turn). The opponent never guards and can't be hit, so every attack is counted; the deck has no triggers, so drive checks add nothing random. Each step shows the card image and where it went, e.g. `HAND → RC1`, with ● when it used its ability. Options: `--replay <file> --turn <n>` also searches from the turn player's board in a saved replay, `--goal pressure,attacks`, `--beam <n>` (default 10; wider is slower and finds more), `--ms <n>` (time limit per board and goal), `--top <n>` (lines per goal). `<deck>` is a deck id or part of the name in `content/decks/`.
- **`python tools/find_chains.py`** finds combo chains from card ability codes (which effect causes which event, and which card waits for it). Options: `--turn opp|own`, `--start <name>`, `--vc <name>`, `--gb <n>`, `--depth <n>`. Each line ends with running totals, e.g. `{CB 2, SB 1 | regains CC+1, SC+1}`. It doesn't check free RC space or what's actually in the drop zone.
