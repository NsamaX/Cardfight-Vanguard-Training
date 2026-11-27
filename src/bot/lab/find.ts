// Combo lab search: plays one whole turn of player p with the real engine and keeps the lines that reach the goal best
// Goal first: every line is played to the end of the turn and scored (attacks that force guards, criticals, shots, resources);
// a beam keeps the most promising partial lines, each judged by finishing it greedily with the bot's policy
import { RC, criticalOf, other, type CardDB } from "../../engine/rules";
import type { Action, CardInstance, Circle, GameEvent, GameState, PlayerId } from "../../engine/types";
import { candidates, fallbacks, tryApply } from "../actions";
import { policy } from "../policy";

export interface Attack { key: string; power: number; crit: number; booster?: string }
export interface LineResult {
  attacks: Attack[];
  shots: number;          // opponent rear-guards retired
  hand: number;           // hand size change
  cb: number;             // usable CB change
  soul: number;
  drop: number;
  score: number;
}
export interface Line { actions: { p: PlayerId; a: Action }[]; result: LineResult }

// What the line tries to do: pressure = make the opponent spend the most Shield (plus criticals and shots),
// attacks = the most attacks that reach the opponent's vanguard Power, farm = end the turn with the most cards and CB
export type Goal = "pressure" | "attacks" | "farm";
export const GOALS: Goal[] = ["pressure", "attacks", "farm"];

export interface FindConfig {
  goal: Goal;
  beam: number;           // partial lines kept per step
  ms: number;             // time limit
  ref: number;            // opponent vanguard Power an attack has to reach to force a guard
  top: number;            // distinct lines returned
}
export const DEFAULT_FIND: FindConfig = { goal: "pressure", beam: 10, ms: 60_000, ref: 11000, top: 5 };

const FRONT_RC: Circle[] = ["front_left", "front_right"];
const BACK_RC: Circle[] = ["back_left", "back_center", "back_right"];

// Shield units (5000 each) the opponent must spend to stop an attack
const forced = (power: number, ref: number) => (power >= ref ? Math.min(4, Math.floor((power - ref) / 5000) + 1) : 0);

export function scoreOf(r: Omit<LineResult, "score">, ref: number, goal: Goal = "pressure"): number {
  let pressure = 0;
  for (const a of r.attacks) pressure += forced(a.power, ref) + (a.power >= ref ? (a.crit - 1) * 1.5 : 0);
  const resources = r.hand * 0.8 + r.cb * 0.4 + r.soul * 0.1;
  switch (goal) {
    case "attacks": return r.attacks.filter((a) => a.power >= ref).length * 3 + r.attacks.length * 0.5 + (pressure + r.shots * 1.5 + resources) * 0.1;
    case "farm": return r.hand + r.cb + r.soul * 0.2 + (pressure + r.shots * 1.5) * 0.1;
    default: return pressure + r.shots * 1.5 + resources;
  }
}

// Stride costs: every set of 1-2 hand cards (distinct by card) the engine accepts
function strideCosts(db: CardDB, hand: CardInstance[]): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  const add = (cs: CardInstance[]) => {
    const id = cs.map((c) => c.key).sort().join("+");
    if (!seen.has(id)) { seen.add(id); out.push(cs.map((c) => c.uid)); }
  };
  hand.forEach((a, i) => { add([a]); hand.slice(i + 1).forEach((b) => add([a, b])); });
  return out;
}

// Options for the turn player: grade 2+ only to the front row, grade 0-1 only to the back row, attacks only at the vanguard
export function labCandidates(db: CardDB, s: GameState, p: PlayerId): Action[] {
  const d = s.awaiting!;
  if (d.kind === "next-phase" && s.phase === "ride" && s.step === "stride") {
    const gs = s.players[p].gZone.filter((g) => !g.faceUp && db[g.key].type === "g-unit");
    const keys = [...new Set(gs.map((g) => g.key))];
    const costs = strideCosts(db, s.players[p].hand);
    return [{ type: "next-phase" }, ...keys.flatMap((k) => costs.map((discardUids): Action => ({ type: "stride", gUid: gs.find((g) => g.key === k)!.uid, discardUids })))];
  }
  return candidates(db, s, p).filter((a) => {
    if (a.type === "call") return (db[s.players[p].hand.find((h) => h.uid === a.uid)!.key].grade >= 2 ? FRONT_RC : BACK_RC).includes(a.to);
    if (a.type === "attack") return a.target === "vc";
    if (a.type === "move") return false;
    return true;
  });
}

// Whoever isn't the turn player never guards and passes on every choice
function otherSide(s: GameState): Action[] {
  return fallbacks(s);
}

interface Track { attacks: Attack[]; shots: number; pending?: string }

function record(db: CardDB, s: GameState, p: PlayerId, events: GameEvent[], t: Track) {
  for (const e of events) {
    if (e.code === "attack" && e.player === p && e.cardUid) t.pending = e.cardUid;
    if ((e.code === "no-hit" || e.code === "hit") && e.player === p && t.pending) {
      const u = Object.values(s.players[p].circles).find((c) => c?.uid === t.pending);
      const booster = s.battle?.booster ? s.players[p].circles[s.battle.booster]?.key : undefined;
      t.attacks.push({ key: u?.key ?? "?", power: Number(e.text.params?.atk ?? 0), crit: u ? criticalOf(db, u) : 1, booster });
      t.pending = undefined;
    }
    if (e.code === "retired" && e.player === other(p)) t.shots++;
  }
}

const usableCb = (s: GameState, p: PlayerId) => s.players[p].damage.filter((d) => d.faceUp).length;

function result(db: CardDB, start: GameState, end: GameState, p: PlayerId, t: Track, ref: number, goal: Goal): LineResult {
  const a = start.players[p], b = end.players[p];
  const r = { attacks: t.attacks, shots: t.shots, hand: b.hand.length - a.hand.length, cb: usableCb(end, p) - usableCb(start, p), soul: b.soul.length - a.soul.length, drop: b.drop.length - a.drop.length };
  return { ...r, score: scoreOf(r, ref, goal) };
}

interface Node { s: GameState; actions: { p: PlayerId; a: Action }[]; t: Track }

const done = (s: GameState, p: PlayerId) => !!s.winner || !s.awaiting || s.turnPlayer !== p;

function step(db: CardDB, n: Node, who: PlayerId, a: Action, p: PlayerId): Node | undefined {
  const r = tryApply(db, n.s, who, a);
  if (!r) return undefined;
  const t: Track = { attacks: [...n.t.attacks], shots: n.t.shots, pending: n.t.pending };
  record(db, n.s.battle ? n.s : r.state, p, r.events, t);
  return { s: r.state, actions: [...n.actions, { p: who, a }], t };
}

// Play the other side's decisions and any decision with a single option
function settle(db: CardDB, n: Node, p: PlayerId): Node {
  for (let i = 0; i < 200 && !done(n.s, p); i++) {
    const who = n.s.awaiting!.player;
    const opts = who === p ? labCandidates(db, n.s, p) : otherSide(n.s);
    if (who === p && opts.length > 1) break;
    const next = opts.map((a) => step(db, n, who, a, p)).find(Boolean);
    if (!next) break;
    n = next;
  }
  return n;
}

// Finish greedily with the bot's policy (attacks redirected at the vanguard); eager = use every ability and pay every cost,
// since the policy saves resources for later turns and would never find a combo that spends them all
function finish(db: CardDB, n: Node, p: PlayerId, eager: boolean): Node {
  for (let i = 0; i < 400 && !done(n.s, p); i++) {
    const who = n.s.awaiting!.player;
    let tries: Action[];
    if (who === p) {
      const d = n.s.awaiting!;
      let a = policy(db, n.s, p);
      if (a.type === "attack") a = { ...a, target: "vc" };
      const yes: Action[] = !eager ? [] : d.kind === "order-queue" ? [{ type: "order-queue", index: 0 }] : d.choice?.kind === "yesno" ? [{ type: "choose", option: "yes" }] : [];
      tries = [...yes, a, ...fallbacks(n.s), ...labCandidates(db, n.s, p)];
    } else tries = otherSide(n.s);
    const next = tries.map((a) => step(db, n, who, a, p)).find(Boolean);
    if (!next) break;
    n = next;
  }
  return n;
}

// What decides the rest of the turn: board, hand, drop, soul, resources, pending abilities, the decision itself
function hashOf(s: GameState, p: PlayerId): string {
  const ps = s.players[p], opp = s.players[other(p)];
  const unit = (c?: CardInstance) => c && [c.key, c.rested, c.hollowed, c.mods.reduce((n, m) => n + m.value, 0), c.usedThisTurn.join(","), (c.grants ?? []).length].join(":");
  const keys = (l: CardInstance[]) => l.map((c) => c.key).sort().join(",");
  return JSON.stringify([
    s.phase, s.step, s.strodeThisTurn, (Object.keys(ps.circles) as Circle[]).sort().map((c) => [c, unit(ps.circles[c])]),
    keys(ps.hand), keys(ps.drop), keys(ps.soul), ps.damage.filter((d) => d.faceUp).length, ps.gZone.filter((g) => g.faceUp).length,
    RC.map((c) => opp.circles[c]?.key), s.queue.map((e) => e.uid + e.key), s.resolving && [s.resolving.uid, s.resolving.i, s.resolving.choice],
    s.battle && [s.battle.attacker, s.battle.booster, s.battle.drivesLeft, s.battle.damageLeft], s.step, s.awaiting?.kind,
  ]);
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function findLines(db: CardDB, start: GameState, cfg: FindConfig = DEFAULT_FIND): Line[] {
  const p = start.turnPlayer;
  const t0 = now();
  const lines: Line[] = [];
  const keep = (n: Node) => Math.max(...[false, true].map((eager) => {
    const end = finish(db, n, p, eager);
    const line = { actions: end.actions, result: result(db, start, end.s, p, end.t, cfg.ref, cfg.goal) };
    lines.push(line);
    return line.result.score;
  }));
  const seen = new Set<string>();
  let beam: Node[] = [settle(db, { s: start, actions: [], t: { attacks: [], shots: 0 } }, p)];
  while (beam.length && now() - t0 < cfg.ms) {
    const next: { n: Node; v: number }[] = [];
    for (const n of beam) {
      if (done(n.s, p)) { keep(n); continue; }
      for (const a of labCandidates(db, n.s, p)) {
        const c0 = step(db, n, p, a, p);
        if (!c0) continue;
        const c = settle(db, c0, p);
        const h = hashOf(c.s, p);
        if (seen.has(h)) continue;
        seen.add(h);
        next.push({ n: c, v: keep(c) });
        if (now() - t0 > cfg.ms) break;
      }
    }
    next.sort((x, y) => y.v - x.v);
    beam = next.slice(0, cfg.beam).map((x) => x.n);
  }
  return distinct(lines, cfg.top);
}

// Best lines, one per distinct set of attackers (otherwise the top is the same combo in different orders)
function distinct(lines: Line[], top: number): Line[] {
  const out: Line[] = [];
  const seen = new Set<string>();
  for (const l of [...lines].sort((a, b) => b.result.score - a.result.score)) {
    const id = l.result.attacks.map((a) => `${a.key}>${a.power >= 0 ? Math.round(a.power / 5000) : 0}`).sort().join("|") + `|${l.result.shots}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(l);
    if (out.length >= top) break;
  }
  return out;
}
