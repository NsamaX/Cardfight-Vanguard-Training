// A practice table for Claude to try out card abilities: a scenario file sets up both sides (any cards in any zone, the deck order
// from the top), then Claude plays both sides from the command line. Every action is written to .temp/sandbox.json (a replay with
// a start board), which the app shows live at http://localhost:3000/?sandbox (dev server only). Uses the bundled cards and decks.
//   npm run sandbox -- new <scenario.yaml>     set up the board from a scenario; prints it and the first decision
//   npm run sandbox -- act '<json>' ['<json>' ...]   play actions in order, each by whoever the game waits for
//   npm run sandbox -- show                    print the board now
//
// Scenario (YAML or JSON). A card is its key ("G-BT06/040TH") or its exact name. Everything but `deck` is optional.
//   title: Nightrose retire test
//   seed: 1                  # for shuffles during the game
//   turn: 5                  # odd turns belong to the first player
//   turnPlayer: me           # me (bottom of the board) | bot
//   phase: main              # ride | stride | main | battle (the turn's stand and draw are already done)
//   me:
//     deck: Granblue Nightrose   # a bundled deck: its G zone, and the rest of its main deck shuffled under deckTop
//     vc: <card>
//     rc: { front_left: <card>, back_center: <card> }
//     rested: [front_left]
//     hand: [<card>, ...]
//     soul / drop / bind: [...]
//     damage: [...]          # face up
//     damageDown: [...]      # face down (counter blast already paid)
//     deckTop: [<card>, ...]    # first = top of the deck
//     gZone: [...]           # face down; default: the deck's G zone
//     gFaceUp: [...]
//   bot: { ... the same ... }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { cardByKey as db, cards } from "../src/data/cards";
import { presetDecks } from "../src/data/decks";
import { apply, refreshAwaiting } from "../src/engine/game";
import { shuffle } from "../src/engine/rng";
import { other, RuleError } from "../src/engine/rules";
import type { Action, CardInstance, Circle, GameState, PlayerId, PlayerState } from "../src/engine/types";
import { translate } from "../src/i18n";
import type { Replay } from "../src/replay/types";
import { table } from "./table";

const ROOT = join(import.meta.dirname, "..");
const SANDBOX_FILE = join(ROOT, ".temp/sandbox.json");

interface Side {
  deck: string;
  vc?: string;
  rc?: Partial<Record<Exclude<Circle, "vc">, string>>;
  rested?: Circle[];
  hand?: string[]; soul?: string[]; drop?: string[]; bind?: string[];
  damage?: string[]; damageDown?: string[];
  deckTop?: string[];
  gZone?: string[]; gFaceUp?: string[];
}
interface Scenario { title?: string; seed?: number; turn?: number; turnPlayer?: PlayerId; phase?: "ride" | "stride" | "main" | "battle"; me: Side; bot: Side }

const PHASES = { ride: ["ride", "ride"], stride: ["ride", "stride"], main: ["main", undefined], battle: ["battle", "attack"] } as const;

function cardOf(ref: string): string {
  if (db[ref]) return ref;
  const byName = cards.find((c) => c.name.toLowerCase() === ref.toLowerCase());
  if (byName) return byName.key;
  const near = cards.filter((c) => c.name.toLowerCase().includes(ref.toLowerCase())).map((c) => `${c.name} (${c.key})`);
  throw new Error(`No card "${ref}"${near.length ? `; did you mean: ${near.join(", ")}` : ""}`);
}

function build(sc: Scenario): Replay {
  const turn = sc.turn ?? 3, turnPlayer = sc.turnPlayer ?? "me";
  const [phase, step] = PHASES[sc.phase ?? "main"];
  const seed = sc.seed ?? 1;
  const decks = Object.fromEntries((["me", "bot"] as const).map((p) => {
    const d = presetDecks.find((x) => x.name === sc[p].deck || x.id === sc[p].deck);
    if (!d) throw new Error(`${p}: no deck "${sc[p].deck}" (decks: ${presetDecks.map((x) => x.name).join(", ")})`);
    return [p, d];
  })) as Replay["decks"];

  const s = {
    seed, rngState: seed, turn, turnPlayer, firstPlayer: turn % 2 ? turnPlayer : other(turnPlayer), phase, step,
    nextUid: 1, mulliganDone: ["me", "bot"], rodeThisTurn: phase !== "ride", strodeThisTurn: false, battlesThisTurn: 0,
    events: [], queue: [], players: {} as GameState["players"],
  } as GameState;
  const inst = (ref: string, faceUp = true): CardInstance =>
    ({ uid: `c${s.nextUid++}`, key: cardOf(ref), rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });

  for (const p of ["me", "bot"] as const) {
    const side = sc[p], deck = decks[p];
    const ps: PlayerState = { circles: {}, guardian: [], hand: [], deck: [], drop: [], soul: [], damage: [], gZone: [], bind: [], removed: [] };
    ps.circles.vc = inst(side.vc ?? deck.starter);
    for (const [c, k] of Object.entries(side.rc ?? {})) if (k) ps.circles[c as Circle] = inst(k);
    for (const c of side.rested ?? []) {
      if (!ps.circles[c]) throw new Error(`${p}: rested ${c} has no unit`);
      ps.circles[c]!.rested = true;
    }
    ps.hand = (side.hand ?? []).map((k) => inst(k));
    ps.soul = (side.soul ?? []).map((k) => inst(k));
    ps.drop = (side.drop ?? []).map((k) => inst(k));
    ps.bind = (side.bind ?? []).map((k) => inst(k));
    ps.damage = [...(side.damageDown ?? []).map((k) => inst(k, false)), ...(side.damage ?? []).map((k) => inst(k))];
    const top = (side.deckTop ?? []).map((k) => inst(k, false));

    // The rest of the main deck: one copy less of each card placed somewhere above
    const pool = new Map(Object.entries(deck.main));
    for (const u of [...Object.values(ps.circles), ...ps.hand, ...ps.soul, ...ps.drop, ...ps.bind, ...ps.damage, ...top]) {
      const n = pool.get(u!.key) ?? 0;
      if (n > 0) pool.set(u!.key, n - 1);
    }
    let rest = [...pool].flatMap(([k, n]) => Array<string>(n).fill(k));
    [rest, s.rngState] = shuffle(rest, s.rngState);
    ps.deck = [...top, ...rest.map((k) => inst(k, false))];

    const gDown = side.gZone ?? Object.entries(deck.g_zone).flatMap(([k, n]) => Array<string>(n).fill(k));
    ps.gZone = [...gDown.map((k) => inst(k, false)), ...(side.gFaceUp ?? []).map((k) => inst(k))];
    s.players[p] = ps;
  }
  refreshAwaiting(s);
  return {
    version: 1, id: `sandbox-${Date.now()}`, createdAt: new Date().toISOString(), title: sc.title ?? "Sandbox",
    seed, firstPlayer: s.firstPlayer, decks, start: s, actions: [], turn, cards,
  };
}

function replay(r: Replay): GameState {
  let s = structuredClone(r.start!);
  for (const a of r.actions) s = apply(db, s, a.player, a.action).state;
  return s;
}

const view = table(db, { me: "Me", bot: "Bot" }, { label: { me: "ME (me)", bot: "BOT (bot)" }, open: ["me", "bot"], deckTop: 5 });
const print = (s: GameState) => console.log(`${view.board(s, "me")}\n${view.decision(s)}`);
const write = (r: Replay) => { mkdirSync(join(ROOT, ".temp"), { recursive: true }); writeFileSync(SANDBOX_FILE, JSON.stringify(r)); };
const load = (): Replay => {
  if (!existsSync(SANDBOX_FILE)) throw new Error("No sandbox yet: npm run sandbox -- new <scenario.yaml>");
  return JSON.parse(readFileSync(SANDBOX_FILE, "utf8"));
};

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "new") {
    if (!args[0]) throw new Error("Usage: npm run sandbox -- new <scenario.yaml>");
    const r = build(parse(readFileSync(args[0], "utf8")) as Scenario);
    write(r);
    print(r.start!);
  } else if (cmd === "act") {
    const r = load();
    let s = replay(r);
    try {
      for (const json of args) {
        const player = s.awaiting?.player;
        if (!player) throw new Error("The game isn't waiting for anyone");
        const action = JSON.parse(json) as Action;
        const res = apply(db, s, player, action);   // throws a RuleError if the action isn't allowed
        r.actions.push({ player, action });
        s = res.state;
        console.log(`> ${player}: ${json}\n${view.log(res.events)}`);
      }
    } finally {
      r.turn = s.turn;
      r.winner = s.winner;
      write(r);   // the actions before a refused one are kept
    }
    print(s);
  } else if (cmd === "show") {
    print(replay(load()));
  } else {
    console.log("Commands: new <scenario.yaml> | act '<json>' ['<json>' ...] | show");
  }
}

try { main(); } catch (e) { console.error(e instanceof RuleError ? translate("en", e.msg) : e instanceof Error ? e.message : e); process.exit(1); }
