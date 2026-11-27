// Combo lab: plays whole turns with the real engine to find the strongest lines for a deck, and writes them as a picture guide (HTML)
//   npm run combos -- nightrose                                   # generated boards (each grade 3 vanguard × GB1 / GB3)
//   npm run combos -- nightrose --replay .temp/game.json --turn 9 # also search from the turn player's board in a saved replay
//   options: --goal pressure,attacks,farm (default all)  --beam <n> (default 10, wider = slower and stronger)
//            --ms <n> (time per board and goal)  --top <n> (lines per goal)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { deckCombos } from "../src/bot/combos";
import { labBoard, makeUnhittable, type Scenario } from "../src/bot/lab/board";
import { DEFAULT_FIND, GOALS, findLines, type Goal, type Line } from "../src/bot/lab/find";
import { CIRCLE_LABEL, describeLine, type Move, type Step } from "../src/bot/lab/notation";
import { cardByKey as db } from "../src/data/cards";
import { presetDecks } from "../src/data/decks";
import { isG } from "../src/engine/rules";
import type { Deck, GameState } from "../src/engine/types";
import { parseReplayFile, replayTimeline } from "../src/replay/play";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const query = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"))?.toLowerCase();
const deck = query && presetDecks.find((d) => d.id === query || d.name.toLowerCase().includes(query) || d.id.includes(query));
if (!deck) {
  console.log(`Usage: npm run combos -- <deck> [--replay <file> --turn <n>] [--beam <n>] [--ms <n>] [--top <n>]\nDecks: ${presetDecks.map((d) => `${d.id} (${d.name})`).join(", ")}`);
  process.exit(1);
}
const cfg = { ...DEFAULT_FIND, beam: Number(opt("beam") ?? DEFAULT_FIND.beam), ms: Number(opt("ms") ?? DEFAULT_FIND.ms), top: Number(opt("top") ?? 2) };
const goals = (opt("goal")?.split(",") ?? GOALS).filter((g): g is Goal => (GOALS as string[]).includes(g));
const GOAL_TEXT: Record<Goal, string> = {
  pressure: "Most pressure: Shield the opponent must spend, criticals, shots",
  attacks: `Most attacks at ${(DEFAULT_FIND.ref).toLocaleString("en")}+ Power`,
  farm: "Farm: end the turn with the most cards, CB, and soul",
};
const ROOT = resolve(import.meta.dirname, "..");
const out = resolve(ROOT, opt("out") ?? `.temp/combos-${deck.id}.html`);

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
    const sc: Scenario = { name: `${db[vc].name} · GB${gFaceUp + 1}`, vc, hand, drop, soul, cb: 4, damage: 5, gFaceUp };
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
  return { name: `Replay ${file.split(/[\\/]/).pop()} · turn ${turn} (${s.turnPlayer})`, s };
}

// ---------- HTML ----------

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clanDir = (clan: string) => clan.toLowerCase().replaceAll(" ", "-");
const img = (key: string, cls = "") => {
  const c = db[key];
  const file = join(ROOT, "content/images", clanDir(c.clan), `${key.replaceAll("/", "_")}.png`);
  return `<img class="card ${cls}" src="${esc(relative(dirname(out), file).replaceAll("\\", "/"))}" title="${esc(c.name)}" alt="${esc(c.name)}">`;
};
const num = (n: number) => n.toLocaleString("en");

function move(m: Move): string {
  return `<div class="mv${m.opp ? " opp" : ""}">${img(m.key)}<div class="path">${m.opp ? "<b>OPP</b> " : ""}${m.from}${m.skill ? ' <i class="dot"></i>' : ""} → ${m.to}</div></div>`;
}

function step(s: Step): string {
  const parts = s.items.map((it) => it.kind === "move" ? move(it)
    : it.kind === "skill" ? `<div class="mv">${img(it.key)}<div class="path">${it.at} <i class="dot"></i></div></div>`
    : `<span class="cost">${it.text}</span>`);
  if (s.attack) {
    const a = s.attack;
    return `<div class="step atk"><div class="mv">${img(a.key)}<div class="path">${a.from}${a.booster ? ` + ${a.booster.from}` : ""}</div></div>`
      + `<div class="hit">⚔ ${num(a.power)}${a.crit > 1 ? ` ★${a.crit}` : ""}</div>${parts.join("")}</div>`;
  }
  return `<div class="step">${parts.join("")}</div>`;
}

function lineHtml(start: GameState, l: Line, i: number): string {
  const steps = describeLine(db, start, l);
  const r = l.result;
  const strong = r.attacks.filter((a) => a.power >= cfg.ref).length;
  const sum = [`${r.attacks.length} attacks (${strong} at ${num(cfg.ref)}+)`, r.shots && `${r.shots} shot`, `hand ${r.hand >= 0 ? "+" : ""}${r.hand}`, `CB ${r.cb >= 0 ? "+" : ""}${r.cb}`]
    .filter(Boolean).join(" · ");
  let phase = "";
  const cells = steps.map((x) => {
    const chip = x.phase !== phase ? `<span class="ph">${x.phase.toUpperCase()}</span>` : "";
    phase = x.phase;
    return chip + step(x);
  });
  return `<div class="line"><h3>Line ${i + 1} <small>score ${r.score.toFixed(1)} · ${sum}</small></h3><div class="strip">${cells.join('<span class="arrow">▸</span>')}</div></div>`;
}

function boardHtml(name: string, s: GameState, byGoal: [Goal, Line[]][]): string {
  const ps = s.players[s.turnPlayer];
  const row = (label: string, keys: string[]) => keys.length ? `<div class="zone"><span>${label}</span>${keys.map((k) => img(k, "sm")).join("")}</div>` : "";
  const rc = Object.entries(ps.circles).filter(([c]) => c !== "vc").map(([c, u]) => u ? `${CIRCLE_LABEL[c as keyof typeof CIRCLE_LABEL]} ` : "");
  const cb = ps.damage.filter((d) => d.faceUp).length;
  return `<section><h2>${esc(name)}</h2><div class="start">${row("VC", ps.circles.vc ? [ps.circles.vc.key] : [])}${rc.join("") ? row("RC", Object.values(ps.circles).filter((u) => u && u !== ps.circles.vc).map((u) => u!.key)) : ""}`
    + `${row("HAND", ps.hand.map((c) => c.key))}${row("DROP", ps.drop.map((c) => c.key))}${row("SOUL", ps.soul.map((c) => c.key))}`
    + `<div class="res">CB ${cb} / damage ${ps.damage.length} · G face up ${ps.gZone.filter((g) => g.faceUp).length} · deck ${ps.deck.length}</div></div>`
    + byGoal.map(([g, lines]) => `<h3 class="goal">${GOAL_TEXT[g]}</h3>` + (lines.length ? lines.map((l, i) => lineHtml(s, l, i)).join("") : "<p>No line found.</p>")).join("")
    + "</section>";
}

const CSS = `
:root { --bg:#111; --fg:#eee; --mute:#999; --panel:#1b1b1b; --line:#333; --dot:#f5c518; --atk:#e5484d; --opp:#5b9bd5; }
body { background:var(--bg); color:var(--fg); font:14px/1.4 system-ui, sans-serif; margin:0; padding:16px; }
h1 { margin:0 0 8px; } h2 { margin:32px 0 8px; border-bottom:1px solid var(--line); padding-bottom:4px; } h3 { margin:16px 0 6px; font-size:15px; } h3.goal { color:var(--dot); margin-top:20px; }
small, .res, .legend { color:var(--mute); font-weight:normal; }
.card { width:64px; border-radius:4px; display:block; } .card.sm { width:40px; display:inline-block; margin-right:2px; }
.start { background:var(--panel); padding:8px; border-radius:6px; } .zone { margin:2px 0; } .zone span { display:inline-block; width:44px; color:var(--mute); vertical-align:top; }
.strip { display:flex; flex-wrap:wrap; align-items:center; gap:6px; } .arrow { color:var(--mute); font-size:18px; }
.step { display:flex; flex-wrap:wrap; gap:4px; align-items:flex-start; background:var(--panel); padding:6px; border-radius:6px; }
.step.atk { border:1px solid var(--atk); }
.mv { text-align:center; font-size:11px; } .mv.opp .card { outline:2px solid var(--opp); } .path { margin-top:2px; white-space:nowrap; }
.dot { display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--dot); }
.hit { color:var(--atk); font-weight:bold; align-self:center; white-space:nowrap; padding:0 4px; }
.ph { font-size:11px; font-weight:bold; color:var(--mute); border:1px solid var(--line); border-radius:3px; padding:2px 6px; margin-right:4px; }
.cost { align-self:center; font-size:11px; border:1px solid var(--line); border-radius:3px; padding:1px 4px; }
`;

// ---------- Run ----------

const boards = generated(deck);
const rp = opt("replay");
if (rp) boards.push(fromReplay(rp, Number(opt("turn") ?? 0)));
const sections: string[] = [];
for (const b of boards) {
  const byGoal: [Goal, Line[]][] = [];
  for (const goal of goals) {
    const t0 = Date.now();
    const lines = findLines(db, b.s, { ...cfg, goal });
    const best = lines[0]?.result;
    console.log(`${b.name} · ${goal}: ${best ? `${best.attacks.length} attacks, ${best.shots} shots, hand ${best.hand}, CB ${best.cb}` : "nothing"} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    byGoal.push([goal, lines]);
  }
  sections.push(boardHtml(b.name, b.s, byGoal));
}
const legend = `<p class="legend">RC1 RC2 = front row (left, right) · RC3 RC4 RC5 = back row (left, center, right) · <i class="dot"></i> = used its ability · ⚔ = attack Power (★ = critical) · `
  + `blue outline = opponent's card · the opponent never guards and can't be hit, so every attack is counted · attacks count as forcing a guard at ${num(cfg.ref)} Power or more</p>`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Combos: ${esc(deck.name)}</title><style>${CSS}</style></head>`
  + `<body><h1>Combos: ${esc(deck.name)}</h1>${legend}${sections.join("")}</body></html>`);
console.log(`Wrote ${relative(ROOT, out)}`);
