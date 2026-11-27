// Finds combo chains from the ability codes in the card library: which effect causes which event, and which card waits for it.
// Uses the engine's vocabulary (engine/vocab/chains.ts), so new codes and timings are understood without changes here.
// Examples:
//   npm run chains                              # opponent's turn, starting from G GUARDIAN
//   npm run chains -- --vc "Night Fog" --gb 2   # give the vanguard and GB to prune paths whose conditions fail
//   npm run chains -- --turn own --start Obadiah
import { cardByKey, cards } from "../src/data/cards";
import type { Ability, Card } from "../src/engine/types";
import { causedBy, setsOff } from "../src/engine/vocab/chains";

interface Args { turn: "own" | "opp"; start?: string; vc?: string; gb?: number; depth: number }

function parseArgs(argv: string[]): Args {
  const a: Args = { turn: "opp", depth: 6 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === "--turn" && (v === "own" || v === "opp")) { a.turn = v; i++; }
    else if (argv[i] === "--start") { a.start = v; i++; }
    else if (argv[i] === "--vc") { a.vc = v; i++; }
    else if (argv[i] === "--gb") { a.gb = Number(v); i++; }
    else if (argv[i] === "--depth") { a.depth = Number(v); i++; }
  }
  return a;
}

interface Node { card: Card; ab: Ability; idx: number }

// Codes usable only on our turn / the opponent's turn
const OWN_ONLY = ["step(stride, own)", "phase-start(battle, own)", "attack(", "battle-end("];
const OPP_ONLY = ["step(guard, opp)", "enter(GC", "discarded("];

function turnOk(ab: Ability, turn: Args["turn"]): boolean {
  const t = ab.timing ?? "";
  if (turn === "opp") {
    if ((ab.cond ?? []).includes("own-turn") || ["ACT", "STRIDE", "ULTIMATE STRIDE"].includes(ab.kind)) return false;
    return !OWN_ONLY.some((x) => t.startsWith(x));
  }
  return ab.kind !== "G GUARDIAN" && !OPP_ONLY.some((x) => t.startsWith(x));
}

function condOk(node: Node, args: Args, vcName?: string): boolean {
  if (args.vc && node.ab.zone === "VC" && !node.card.name.includes(args.vc)) return false;
  for (const c of node.ab.cond ?? []) {
    const gb = c.match(/^GB\((\d+)\)$/);
    if (gb && args.gb !== undefined && +gb[1] > args.gb) return false;
    for (const [, word] of c.matchAll(/vc-name\("([^"]+)"\)/g)) if (vcName !== undefined && !vcName.includes(word)) return false;
  }
  return true;
}

// The Hollow keyword's own "hollow this unit when placed" ability: true for every Hollow card, so it's left out as noise
const isHollowKeyword = (ab: Ability) => ab.effect[0] === "hollow(self)" && ab.timing === "enter(RC, self)";

// ---------- Resources along a chain: CB/SB paid, CC/SC regained ----------

type Tally = Record<"CB" | "SB" | "CC" | "SC" | "CC?" | "SC?" | "choice", number>;
const EMPTY: Tally = { CB: 0, SB: 0, CC: 0, SC: 0, "CC?": 0, "SC?": 0, choice: 0 };

function addResources(tally: Tally, ab: Ability): Tally {
  const t = { ...tally };
  for (const item of ab.cost ?? []) {
    const m = item.match(/^(CB|SB)\((\d+)/);
    if (m) t[m[1] as "CB" | "SB"] += +m[2];
  }
  for (const item of ab.effect) {
    let m = item.match(/^damage-facedown\((\d+)\)$/);
    if (m) { t.CB += +m[1]; continue; }   // flipping our own damage face down uses the same resource as CB
    if (item.startsWith("choose(")) { t.choice++; continue; }
    m = item.match(/^(CC|SC)\((\d+)(, if=[^)]*)?\)/);
    if (m) t[(m[1] + (m[3] ? "?" : "")) as keyof Tally] += +m[2];
  }
  return t;
}

function fmt(t: Tally): string {
  const gains: string[] = [];
  for (const k of ["CC", "SC"] as const) {
    if (t[k]) gains.push(`${k}+${t[k]}`);
    if (t[`${k}?`]) gains.push(`${k}+${t[`${k}?`]} conditional`);
  }
  if (t.choice) gains.push(`CC/SC+${t.choice} choice`);
  return `  {CB ${t.CB}, SB ${t.SB}${gains.length ? ` | regains ${gains.join(", ")}` : ""}}`;
}

const label = (n: Node) => `${n.card.name} [${n.ab.kind}${n.ab.zone ? ` ${n.ab.zone}` : ""} #${n.idx}]`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodes: Node[] = cards.flatMap((card) => card.abilities.map((ab, i) => ({ card, ab, idx: i + 1 })));
  let vcName: string | undefined;
  if (args.vc) {
    const match = cards.find((c) => c.name.includes(args.vc!));
    if (!match) throw new Error(`No card whose name contains '${args.vc}'`);
    vcName = match.name;
  }

  const consumers = (from: Node, seen: Set<Node>) => causedBy(from.ab).flatMap((cause) => nodes
    .filter((n) => !seen.has(n) && !isHollowKeyword(n.ab) && turnOk(n.ab, args.turn) && condOk(n, args, vcName))
    .filter((n) => setsOff(cardByKey, cause, from.card, n.card, n.ab))
    .map((n) => n));

  const walk = (from: Node, seen: Set<Node>, depth: number, out: string[], tally: Tally) => {
    if (depth >= args.depth) return;
    const next = new Set(seen).add(from);
    for (const n of new Set(consumers(from, next))) {
      const t = addResources(tally, n.ab);
      out.push(`${"    ".repeat(depth + 1)}└ ${n.ab.timing} → ${label(n)}${fmt(t)}`);
      walk(n, next, depth + 1, out, t);
    }
  };

  const entry = args.turn === "opp" ? ["G GUARDIAN"] : ["STRIDE", "ULTIMATE STRIDE", "ACT"];
  const pool = cards.filter((c) => !args.start || c.name.includes(args.start));
  if (!pool.length) throw new Error(`No card whose name contains '${args.start}'`);
  const starts = pool.flatMap((card) => {
    const usable = nodes.filter((n) => n.card === card && turnOk(n.ab, args.turn));
    const entries = usable.filter((n) => entry.includes(n.ab.kind));
    return entries.length || !args.start ? entries : usable;
  });

  for (const s of starts) {
    const out: string[] = [];
    const t = addResources(EMPTY, s.ab);
    walk(s, new Set(), 0, out, t);
    if (out.length) console.log(`${label(s)}${fmt(t)}\n${out.join("\n")}\n`);
  }
}

main();
