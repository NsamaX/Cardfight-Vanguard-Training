# Claude's Tools

What Claude can run in this project to play, test and inspect the game without a browser. All are run from the project
root; each `npm run` script regenerates `src/data/content.json` first.

## Sandbox — test card abilities

`scripts/sandbox.ts`. Set up any board from a scenario file, then play both sides; the user watches live at
http://localhost:3000/?sandbox (dev server only; the page polls `.temp/sandbox.json` through `/api/sandbox` every second
and follows the newest step). Uses the bundled cards and decks, so no Supabase or sign-in is needed.

```bash
npm run sandbox -- new .temp/sandbox/<name>.yaml        # set up; prints the board and the first decision
npm run sandbox -- act '<json>' ['<json>' ...]          # each action is played by whoever the game waits for
npm run sandbox -- show
```

- Scenario format: the header of `scripts/sandbox.ts`. Cards by code or exact name; per side `deck`, `vc`, `rc`,
  `rested`, `hand`, `soul`, `drop`, `bind`, `damage` (face up), `damageDown`, `deckTop` (first = top), `gZone`,
  `gFaceUp`, `rodeLastTurn`; plus `turn`, `turnPlayer`, `phase` (ride | stride | main | battle), `seed`.
- The rest of the deck is the deck list less the placed cards, shuffled under `deckTop`. Use `deckTop` to fix drive and
  damage checks.
- Each output ends with the pending decision and the JSON that answers it (uids in `[c12]`). An action the rules refuse
  prints the reason and is not recorded; the ones before it in the same call are kept.
- The board can't be edited mid-game and there is no undo: start a new scenario instead.
- Keep scenarios in `.temp/sandbox/`. A scenario that tests one card: set up only what its condition and cost need, then
  check the result and the negative cases (condition not met, wrong cost).
- Screenshot for docs: `"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --window-size=1920,1080 --virtual-time-budget=25000 --screenshot=<file> "http://localhost:3000/?sandbox"`,
  then crop the right panel (the dev server's "Compiling" badge sits there).

## Seat — a player in an online match

`scripts/seat.ts`. Claude joins an online game with the user (a second Supabase account: `CLAUDE_EMAIL` /
`CLAUDE_PASSWORD` in `.env`) and sees only what a player may see.

```bash
SEAT_DECK="Granblue Nightrose" npm run seat -- create   # open a room (default deck "Genesis Regalia"); prints the code
npm run seat -- join <code>
npm run seat -- wait [minutes]                          # until it's Claude's decision or the game ends
npm run seat -- act '<json>'
npm run seat -- show | ready | start | leave
```

Rooms pair by commit hash: don't commit during a game, and the user restarts the dev server after a commit.
Notes from past games: `.temp/playtest-notes.md`.

## Analysis

| Command | What it gives |
| ------- | ------------- |
| `npm run combos -- <deck> [--goal pressure,attacks,farm] [--replay <file> --turn <n>]` | A deck's strongest turns, searched with the real engine on generated boards (opponent can't be hit, no trigger luck). Writes `.temp/combos-<deck id>/index.md` and a replay per combo |
| `npm run chains [-- --turn own\|opp --start <name> --vc <name> --gb <n> --depth <n>]` | Which effect causes which event and which card waits for it, with running CB/SB totals |
| `npm run check-cards` | Ability codes in card files the engine doesn't run yet |
| `npm run vocab-doc` | Rewrites the generated part of `documents/vocabulary.md` (a test fails when it's stale) |
| `ARENA=1 A=hard B=normal N=20 npm test -- src/bot/arena` | Bot vs bot strength (`MS=100` thinks faster) |

## Checks

| Command | What it checks |
| ------- | -------------- |
| `npm test` | Every test (engine rules, cards, bot, board, online) |
| `npm run typecheck` | `src/` only; scripts need a temporary tsconfig that includes them |

## Cards and Images

- `/add-card` skill (`.claude/skills/add-card/`): add a card or sleeve from an image the user placed in `.temp/`.
- `python tools/clean_images.py` (PyYAML, numpy, Pillow): raw scans in `.temp/` → `content/images/<clan>/`, sleeves in
  `.temp/sleeves/` → `content/sleeves/` (listed in `SOURCES` / `SLEEVES`).
- `npm run sync-defaults`: upload `content/` to Supabase after a card, deck or image changes.
