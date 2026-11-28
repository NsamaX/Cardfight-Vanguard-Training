# Cardfight Vanguard Training — Project Guide

A web app for practicing Cardfight!! Vanguard (G era): a rules engine that runs every phase and card ability, a bot
opponent, online play between friends, replays, and card / deck / sleeve building. Guests play the bundled default set;
signed-in players (Google) get their own copy of it in Supabase. What the app does for players: [README.md](README.md).

## Tech Stack

| Layer          | Technology                                             |
| -------------- | ------------------------------------------------------ |
| Framework      | Next.js 16 (App Router), one page (`src/app/page.tsx`) |
| Language       | TypeScript                                             |
| UI             | React 19, plain CSS (`src/app/globals.css`)            |
| Backend        | Supabase: Postgres + RLS, Auth (Google), Realtime, Storage (card images, sleeves) |
| Tests          | Vitest (+ jsdom for components)                        |
| Hosting        | Vercel (https://vanguard.vijuksama.com)                |
| Tools          | vite-node scripts in `scripts/`, Python in `tools/`    |

---

## Project Structure

| Path                    | Responsibility |
| ----------------------- | -------------- |
| `src/app/`              | Next.js entry (layout, page) and `api/sandbox/` (dev only: the sandbox file for `/?sandbox`) |
| `src/components/`       | React UI, data and callbacks via props: `GameApp` (which screen), `board/` (the board), `deck/` (deck and card screens), `ReplayViewer`, `SandboxView`, `OnlineRoom` |
| `src/hooks/`            | Screen state: `useBoard` (clicks → engine actions), `useLibrary` (load/save cards, decks, sleeves), `useMatch` (online lockstep), `useAuth`, `useCardFlight` (card animations) |
| `src/lib/`              | Non-React helpers: board rules (`board.ts`), deck editing, ability drafts and the code picker for the card editor, card text ↔ plain text (`cardText.ts`), settings, Supabase access (`library.ts`, `online.ts`, `supabase.ts`), image resizing |
| `src/engine/`           | Game state and rules: phases and actions (`game.ts`), ability resolver (`abilities.ts`), CONT and card-driven rules (`cont.ts`), code parser (`code.ts`), ability vocabulary (`vocab/`), shared types (`types.ts`) |
| `src/bot/`              | The bot: rules (`policy.ts`), search (`search.ts`), evaluation, `arena.ts` (bot vs bot), `lab/` (combo lab boards and search) |
| `src/data/`             | In-memory card registry (bundled set, replaced by the Supabase library at runtime), default decks, deck validation, combos, sleeves |
| `src/replay/`           | Replay format (`types.ts`), playback (`play.ts`), guest storage |
| `src/i18n/`             | Dictionaries (`en.ts` defines the keys, `ja.ts`) and `useT()` |
| `content/`              | Default cards, decks, combos, card images, sleeves (YAML; source of `src/data/content.json` and `sync-defaults`) |
| `supabase/migrations/`  | Database schema, RLS, and the online-match functions |
| `scripts/`              | Command-line tools (see Scripts) |
| `tools/`                | `clean_images.py`: card and sleeve images from raw scans |
| `documents/`            | Development reference: rules, timing, ability codes (see Documentation), and the README screenshot |
| `.temp/`                | Git-ignored: raw scans, `TODO.md`, playtest notes, sandbox scenarios and state |

### Design

The engine is pure: `apply(db, state, player, action)` returns a new state plus events and randomizes only from the seed.
That gives undo/redo (keep old states), replays (seed or a start board + actions), the bot (answers the same `Decision`s
through `Bot.decide()`), online play, and the sandbox. The engine emits text as `Msg` keys, translated when displayed.

### Ability Engine

Card abilities are data: each card file lists its abilities as codes ([vocabulary.md](documents/vocabulary.md)), and the engine runs them.

| File                  | Job |
| --------------------- | --- |
| `engine/code.ts`      | Parses a code string into a name, positional and named arguments |
| `engine/vocab/`       | Every code declared once with its forms and meaning: `filters.ts`, `counters.ts`, `conditions.ts`, `selectors.ts`, `timings.ts`, `ops/` (costs and effects), `chains.ts` (moves each op causes) |
| `engine/abilities.ts` | Events → queued AUTO abilities → each ability's steps, asking the player midway; `at=` delays the rest of an ability |
| `engine/cont.ts`      | CONT effects (recomputed after every change) and rules a card can change (stride cost, G guardian discard) |
| `engine/game.ts`      | Phases, battle, and the player's actions |

To support a new card text: find the closest code in vocabulary.md; if none fits, add one to `engine/vocab/` with its
`forms` and `text`, then `npm run vocab-doc`. An unknown condition never holds and an unknown code is skipped;
`npm run check-cards` and the tests report them.

### Online Play

`join_match` rolls the seed and first player in the database and stores both decks with their card data in the `matches`
row (a guest card whose key the host uses with different data is renamed `<key>~2`). Each client runs the engine locally.
Actions go into `match_actions` with a `seq`; the other client gets them through Realtime (poll every 4 s as a fallback).
Host = engine `me`, guest = `bot`; the board shows the local side at the bottom. Rooms pair only on the same commit
(`NEXT_PUBLIC_BUILD_ID` from `next.config.ts`), so the dev server must be restarted after a commit. Rematches:
`ready_rematch` → `set_match_deck` → `start_match`.

### Bot

Plays the `bot` side; knows both decklists but not the deck order. Levels: Normal (rules only, `policy.ts`), Hard (rules +
plays options forward to the end of the turn with hidden information randomized), Nightmare (Hard + sees your hand),
Beta (= Nightmare; the only level players can pick for now). It doesn't ultimate stride or use G zone ACTs yet.

---

## Content Files

| Folder                           | Contents |
| -------------------------------- | -------- |
| `content/cards/<clan>/g/`        | G units and G guardians |
| `content/cards/<clan>/normal/`   | Normal units, including non-trigger grade 0 |
| `content/cards/<clan>/trigger/`  | Trigger units |
| `content/decks/`                 | Default decks (the file name is the deck id) |
| `content/combos/`                | Combo tutorials (loader exists, no screen yet) |
| `content/nations.yaml`           | Clans of each nation (ultimate stride needs the nations to match) |
| `content/images/<clan>/`         | Card images, 544×793 PNG, named by card code with `/` → `_` |
| `content/sleeves/`               | Sleeve images, 440×640 |

`<clan>` is the card's `clan` in lowercase with spaces → `-`. **Card code** = the first part of the first `ids` entry
(`"G-CHB03/S11TH SP"` → `G-CHB03/S11TH`). **Card fields:** `ids`, `name`, `format`, `type`, `trigger`, `grade`, `power`,
`shield`, `critical`, `skill`, `trigger_power`, `race`, `clan`, `abilities` (codes the engine runs: `kind`, `zone`,
`timing`, `cond`, `cost`, `effect`, optional `follows`), `text` (the real card text in Markdown, grouped by kind), `notes`.
**Deck fields:** `name`, `format`, `starter` (counted in `main`), `main` (50), `g_zone` (max 16), `sleeve`, `g_sleeve`, `cover`.
Add a card or sleeve from an image with the `/add-card` skill.

---

## Getting Started

```bash
npm install
cp .env.example .env   # Supabase URL and keys; CLAUDE_EMAIL / CLAUDE_PASSWORD for npm run seat
npm run dev            # http://localhost:3000
```

`dev`, `build`, `test`, `typecheck` and the scripts first run `npm run content` (YAML in `content/` → `src/data/content.json`).
Restart the dev server after editing content files.

### Scripts

| Command                       | When to use |
| ----------------------------- | ----------- |
| `npm run dev`                 | Development server |
| `npm run build`               | Production build |
| `npm test`                    | All tests once (`scripts/test.mjs` fixes the drive-letter case on Windows) |
| `npm run typecheck`           | `tsc --noEmit` over `src/` (scripts are not included) |
| `npm run content`             | Regenerate `src/data/content.json` |
| `npm run sync-defaults`       | Upload `content/` to Supabase (needs `SUPABASE_SECRET_KEY`) |
| `npm run sandbox`             | Claude's card-testing table (see [.claude/tools.md](.claude/tools.md)) |
| `npm run seat`                | Claude as the second player of an online match |
| `npm run combos -- <deck>`    | Strongest turns of a deck, by playing them with the engine |
| `npm run chains`              | Combo chains from the ability codes |
| `npm run check-cards`         | Ability codes in `content/cards/` the engine doesn't run |
| `npm run vocab-doc`           | Regenerate sections 1–8 of `documents/vocabulary.md` |

---

## Conventions

- **UI text:** add the key to `src/i18n/en.ts` and `ja.ts` (typecheck fails if they differ). Engine and lib use
  `msg("key", {...})` / `throw new RuleError("key", {...})`; components use `const t = useT()`.
- **A rule or card bug** gets a test in `src/engine/*.test.ts` with the fix.
- **Commits** go on `main`; the message says what changed for the player.

---

## Documentation

| Document | Read when |
| -------- | --------- |
| [documents/rules-g.md](documents/rules-g.md) | Changing game rules or writing card ability code |
| [documents/timing-g.md](documents/timing-g.md) | Working out when an ability resolves during a turn |
| [documents/vocabulary.md](documents/vocabulary.md) | Writing or reading the ability codes in card files |
| [.claude/tools.md](.claude/tools.md) | Testing cards, playing online, finding combos, adding cards |
| `.temp/TODO.md` | Picking the next task |
