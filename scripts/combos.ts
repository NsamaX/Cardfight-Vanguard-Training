// Combo lab: plays whole turns with the real engine to find the strongest lines for a deck
// Writes .temp/combos-<deck id>/index.md (each combo named by the cards that drove it, what it gives, and every step as text)
// and one replay file per combo, to open with the Replays button in the app
//   npm run combos -- nightrose                                   # generated boards (each grade 3 vanguard × GB1 / GB3)
//   npm run combos -- nightrose --replay .temp/game.json --turn 9 # also search from the turn player's board in a saved replay
//   options: --goal pressure,attacks,farm (default all)  --beam <n> (default 10, wider = slower and stronger)
//            --ms <n> (time per board and goal)  --top <n> (lines per goal)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { deckCombos } from "../src/bot/combos";
import { labBoard, makeUnhittable, type Scenario } from "../src/bot/lab/board";
import { DEFAULT_FIND, GOALS, findLines, type Goal, type Line } from "../src/bot/lab/find";
import { comboName, describeLine, shortNames, stepText } from "../src/bot/lab/notation";
import { cardByKey as db } from "../src/data/cards";
import { presetDecks } from "../src/data/decks";
import { isG } from "../src/engine/rules";
import type { Deck, GameState } from "../src/engine/types";
import { parseReplayFile, replayTimeline } from "../src/replay/play";
import type { Replay } from "../src/replay/types";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const query = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"))?.toLowerCase();
const deck = query && presetDecks.find((d) => d.id === query || d.name.toLowerCase().includes(query) || d.id.includes(query));
if (!deck) {
  console.log(`Usage: npm run combos -- <deck> [--replay <file> --turn <n>] [--goal <list>] [--beam <n>] [--ms <n>] [--top <n>]\nDecks:${presetDecks.map((d) => `${d.id} (${d.name})`).join(", ")}`);
  process.exit(1);
}
const cfg = { ...DEFAULT_FIND, beam: Number(opt("beam") ?? DEFAULT_FIND.beam), ms: Number(opt("ms") ?? DEFAULT_FIND.ms), top: Number(opt("top") ?? 2) };
const goals = (opt("goal")?.split(",") ?? GOALS).filter((g): g is Goal => (GOALS as string[]).includes(g));
const num = (n: number) => n.toLocaleString("en");
const GOAL_TEXT: Record<Goal, string> = {
  pressure: "most pressure (Shield the opponent must spend, criticals, shots)",
  attacks: `most attacks at ${num(DEFAULT_FIND.ref)}+ Power`,
  farm: "farm (cards, CB, and soul at the end of the turn)",
};
const ROOT = resolve(import.meta.dirname, "..");
const outDir = resolve(ROOT, opt("out") ?? `.temp/combos-${deck.id}`);
const name = shortNames(db, [...Object.keys(deck.main), ...Object.keys(deck.g_zone)]);

// ---------- Boards ----------

// Generated boards: a rich hand/drop/soul from the cards the chain analysis marks as combo pieces, so the search finds the
// biggest lines; one board per grade 3 vanguard with vanguard abilities, at GB1 and GB3 after striding
function generated(d: Deck): { name: string; s: GameState }[] {
  const an = deckCombos(db, d);
  const pool = new Map(Object.entries(d.main));
  const take = (k: string) => { const n = pool.get(k) ?? 0; if (n <= 0) return false; pool.set(k, n - 1); return true; };
  const units = Object.keys(d.main).filter((k) => !isG(db[k]));
  const ranked = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => units.includes(k));
  const vcs = units.filter((k) => db[k].grade === 3 && db[k].abilities.some((a) => (a.zone ?? "").includes("VC") || /enter\(VC|stride\(own/.test(a.timing ?? "")));
  const boards: { name: string; s: GameState }[] = [];
  for (const vc of vcs.slice(0, 3)) for (const gFaceUp of [0, 2]) {
    pool.clear();
    for (const [k, n] of Object.entries(d.main)) pool.set(k, n);
    take(vc);
    const pick = (list: string[], n: number) => { const o: string[] = []; for (const k of list) if (o.length < n && take(k)) o.push(k); return o; };
    // Combo pieces first, then the strongest other units so every deck gets a full board
    const filler = units.filter((k) => !db[k].trigger).sort((a, b) => db[b].grade - db[a].grade || (db[b].power ?? 0) - (db[a].power ?? 0));
    const hand = pick([...ranked(an.handPiece).filter((k) => !db[k].trigger), ...filler.filter((k) => db[k].grade <= 2), ...filler], 5);
    const drop = pick([...ranked(an.setupPiece.drop), ...filler], 6);
    const soulWanted = pick(ranked(an.setupPiece.soul), 3);
    const soul = [...soulWanted, ...pick(units.filter((k) => db[k].grade <= 1), 5 - soulWanted.length)];
    const sc: Scenario = { name: `${name(vc)} · GB${gFaceUp + 1}`, vc, hand, drop, soul, cb: 4, damage: 5, gFaceUp };
    boards.push({ name: sc.name, s: labBoard(db, d, sc) });
  }
  return boards;
}

function fromReplay(file: string, turn: number): { name: string; s: GameState } {
  const src = parseReplayFile(readFileSync(file, "utf8"));
  if (!src || "kind" in src) throw new Error(`${file}: not a replay with recorded actions`);
  const states = replayTimeline(db, src).states;
  const at = states.find((x) => x.turn === turn && x.phase === "ride" && x.step === "stride" && x.awaiting?.kind === "next-phase")
    ?? states.find((x) => x.turn === turn && x.phase === "main" && x.awaiting?.kind === "next-phase");
  if (!at) throw new Error(`${file}: turn ${turn} has no stride step or main phase`);
  const s = structuredClone(at);
  makeUnhittable(s, s.turnPlayer);
  s.noTriggers = true;
  return { name: `Replay ${file.split(/[\\/]/).pop()} · turn ${turn} (${s.turnPlayer})`, s };
}

// ---------- Output ----------

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function boardText(s: GameState): string[] {
  const ps = s.players[s.turnPlayer];
  const list = (l: { key: string }[]) => l.map((c) => name(c.key)).join(", ") || "-";
  const rc = Object.entries(ps.circles).filter(([c, u]) => c !== "vc" && u).map(([, u]) => name(u!.key));
  return [
    `- VC: ${ps.circles.vc ? name(ps.circles.vc.key) : "-"}${rc.length ? ` · RC: ${rc.join(", ")}` : ""}`,
    `- Hand: ${list(ps.hand)}`, `- Drop: ${list(ps.drop)}`, `- Soul: ${list(ps.soul)}`,
    `- CB ${ps.damage.filter((d) => d.faceUp).length} (damage ${ps.damage.length}) · G face up ${ps.gZone.filter((g) => g.faceUp).length}`,
  ];
}

function summary(l: Line): string {
  const r = l.result;
  const strong = r.attacks.filter((a) => a.power >= cfg.ref).length;
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  return [`${r.attacks.length} attacks (${strong} at ${num(cfg.ref)}+)`, r.shots && `${r.shots} shot`, `hand ${sign(r.hand)}`, `CB ${sign(r.cb)}`]
    .filter(Boolean).join(", ");
}

function replayOf(start: GameState, l: Line, title: string): Replay {
  return {
    version: 1, id: slug(title), createdAt: new Date().toISOString(), title, seed: start.seed, firstPlayer: start.firstPlayer,
    decks: { me: deck as Deck, bot: deck as Deck }, start, bot: "off", actions: l.actions.map(({ p, a }) => ({ player: p, action: a })), turn: start.turn,
  };
}

const boards = generated(deck);
const rp = opt("replay");
if (rp) boards.push(fromReplay(rp, Number(opt("turn") ?? 0)));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const md: string[] = [
  `# Combos: ${deck.name}`, "",
  "Found by playing whole turns with the game engine. The opponent never guards and can't be hit, so every attack is counted;",
  "checks reveal cards without trigger effects, so results don't depend on luck. RC1 RC2 = front row (left, right), RC3 RC4 RC5 = back row (left, center, right).",
  "Each combo has a replay file: open it with the Replays button in the app to watch it step by step.", "",
];
for (const b of boards) {
  md.push(`## ${b.name}`, "", ...boardText(b.s), "");
  for (const goal of goals) {
    const t0 = Date.now();
    const lines = findLines(db, b.s, { ...cfg, goal });
    console.log(`${b.name} · ${goal}: ${lines[0] ? summary(lines[0]) : "nothing"} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    lines.forEach((l, i) => {
      const steps = describeLine(db, b.s, l);
      const title = `${comboName(steps, name) || "Plain attacks"}`;
      const file = `${slug(b.name)}-${goal}-${i + 1}.json`;
      writeFileSync(join(outDir, file), JSON.stringify(replayOf(b.s, l, `${title} (${b.name})`)));
      md.push(`### ${title}`, "", `Goal: ${GOAL_TEXT[goal]} · ${summary(l)} · replay \`${file}\``, "");
      steps.map((x) => stepText(x, name)).filter(Boolean).forEach((t, j) => md.push(`${j + 1}. ${t}`));
      md.push("");
    });
  }
}
writeFileSync(join(outDir, "index.md"), md.join("\n"));
console.log(`Wrote ${relative(ROOT, outDir)}`);
