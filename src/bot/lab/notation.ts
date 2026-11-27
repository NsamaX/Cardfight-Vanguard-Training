// Turns a lab line into steps for the combo guide: per action of the turn player, which cards moved where (HAND → RC1),
// which used an ability (●), costs paid, and attacks; computed by replaying the line and comparing card positions
import { apply } from "../../engine/game";
import { criticalOf, powerOf, type CardDB } from "../../engine/rules";
import type { Circle, GameState, PlayerId } from "../../engine/types";
import type { Line } from "./find";

// Short circle names: front row RC1 RC2, back row RC3 RC4 RC5 (left to right)
export const CIRCLE_LABEL: Record<Circle, string> = {
  vc: "VC", front_left: "RC1", front_right: "RC2", back_left: "RC3", back_center: "RC4", back_right: "RC5",
};

// Actions of the turn player that start a new step in the guide
const TOP = new Set(["ride", "stride", "call", "move", "activate", "attack", "next-phase"]);
// Event codes that don't make an ability worth showing
const TRIVIAL = new Set(["hollow", "retire", "skip", "shuffle", "ability"]);

export interface Move { key: string; from: string; to: string; opp: boolean; skill: boolean }
// In the order things happened: a card using its ability (●), a card moving, a cost paid or CB regained
export type Item = ({ kind: "move" } & Move) | { kind: "skill"; key: string; at: string } | { kind: "cost"; text: string };
export interface Step {
  phase: string;
  action: string;                 // the action type that started this step
  items: Item[];
  attack?: { key: string; from: string; booster?: { key: string; from: string }; power: number; crit: number };
}

function positions(s: GameState): Map<string, { key: string; at: string; p: PlayerId; faceUp: boolean }> {
  const m = new Map<string, { key: string; at: string; p: PlayerId; faceUp: boolean }>();
  for (const p of ["me", "bot"] as PlayerId[]) {
    const ps = s.players[p];
    for (const [c, u] of Object.entries(ps.circles)) if (u) m.set(u.uid, { key: u.key, at: CIRCLE_LABEL[c as Circle], p, faceUp: true });
    if (ps.heart) m.set(ps.heart.uid, { key: ps.heart.key, at: "HEART", p, faceUp: true });
    const piles: [string, typeof ps.hand][] = [["HAND", ps.hand], ["DECK", ps.deck], ["DROP", ps.drop], ["SOUL", ps.soul],
      ["DAMAGE", ps.damage], ["G", ps.gZone], ["GC", ps.guardian], ["BIND", ps.bind], ["REMOVED", ps.removed]];
    for (const [at, list] of piles) for (const u of list) m.set(u.uid, { key: u.key, at, p, faceUp: u.faceUp });
  }
  return m;
}

const shown = (x: Step) => x.items.length > 0 || !!x.attack;

export function describeLine(db: CardDB, start: GameState, line: Line): Step[] {
  const p = start.turnPlayer;
  const steps: Step[] = [];
  let s = start;
  let step: Step | undefined;
  // An ability counts as used (●) only if it did more than hollow or retire its own card; its effects can come in later
  // actions (after choosing to pay), so the marker is decided once the next ability starts
  let open: { item: Item; did: boolean } | undefined;
  const marks: { item: Item; did: boolean }[] = [];
  for (const { p: who, a } of line.actions) {
    const before = positions(s);
    const r = apply(db, s, who, a);
    const after = positions(r.state);
    const used = new Set(r.events.filter((e) => e.code === "ability" && e.cardUid).map((e) => e.cardUid!));
    const segments: { uid?: string; did: boolean }[] = [{ did: false }];
    for (const e of r.events) {
      if (e.code === "ability" && e.cardUid) segments.push({ uid: e.cardUid, did: false });
      else if (!TRIVIAL.has(e.code)) segments.at(-1)!.did = true;
    }
    if (open && segments[0].did) open.did = true;
    // Answers (ordering abilities, paying costs, choosing targets, the opponent passing) belong to the action that caused them
    if (!step || (who === p && TOP.has(a.type))) {
      if (step && shown(step)) steps.push(step);
      step = { phase: a.type === "next-phase" ? r.state.phase : s.phase, action: a.type, items: [] };
    }
    const moves: Item[] = [];
    let cb = 0, cc = 0, sb = 0;
    for (const [uid, b] of before) {
      const x = after.get(uid);
      if (!x) continue;
      if (b.at === "DAMAGE" && x.at === "DAMAGE" && b.p === p) {
        if (b.faceUp && !x.faceUp) cb++;
        if (!b.faceUp && x.faceUp) cc++;
        continue;
      }
      if (b.at === x.at) continue;
      // The opponent's side only matters when their units leave the field (shot)
      if (b.p !== p && !/^(VC|RC)/.test(b.at)) continue;
      if (b.at === "SOUL" && x.at === "DROP" && b.p === p) sb++;
      moves.push({ kind: "move", key: x.key, from: b.at, to: x.at, opp: b.p !== p, skill: used.has(uid) });
    }
    for (const uid of used) {
      const at = after.get(uid) ?? before.get(uid);
      const where = before.get(uid)?.at ?? at?.at;
      const last = step.items.at(-1);
      const repeat = last?.kind === "skill" && last.key === at?.key && last.at === where;
      if (at && where && !repeat && !moves.some((m) => m.kind === "move" && m.skill && m.key === at.key)) step.items.push({ kind: "skill", key: at.key, at: where });
    }
    for (const seg of segments.slice(1)) {
      const it = [...step.items, ...moves].reverse().find((x) => x.kind !== "cost" && x.key === before.get(seg.uid!)?.key);
      if (!it) continue;
      open = { item: it, did: seg.did };
      marks.push(open);
    }
    if (cb) step.items.push({ kind: "cost", text: `CB${cb}` });
    if (sb) step.items.push({ kind: "cost", text: `SB${sb}` });
    step.items.push(...moves);
    if (cc) step.items.push({ kind: "cost", text: `CC${cc}` });
    if (a.type === "attack" && who === p) {
      const ps = r.state.players[p];
      const u = ps.circles[a.attacker];
      const bu = a.booster ? s.players[p].circles[a.booster] : undefined;
      if (u) step.attack = {
        key: u.key, from: CIRCLE_LABEL[a.attacker], booster: bu && { key: bu.key, from: CIRCLE_LABEL[a.booster!] },
        power: powerOf(db, ps, a.attacker) + (bu ? powerOf(db, ps, a.booster!) : 0), crit: criticalOf(db, u),
      };
    }
    s = r.state;
  }
  if (step && shown(step)) steps.push(step);
  for (const m of marks) if (!m.did && !marks.some((x) => x.item === m.item && x.did)) {
    if (m.item.kind === "move") m.item.skill = false;
    else for (const st of steps) st.items = st.items.filter((x) => x !== m.item);
  }
  // The final Power of each attack (after AUTO abilities on attack) comes from the line's result
  const atks = steps.filter((x) => x.attack);
  atks.forEach((x, i) => { const r = line.result.attacks[i]; if (r) { x.attack!.power = r.power; x.attack!.crit = r.crit; } });
  return steps;
}

// ---------- Text ----------

// Short card names: the part after the comma ("Nightstorm"); when several cards share it, also the words after "of"
// ("Night Fog Nightrose", "Starlight Nightrose")
export function shortNames(db: CardDB, keys: string[]): (key: string) => string {
  const short = (k: string) => db[k].name.split(", ").at(-1)!;
  const counts = new Map<string, number>();
  for (const k of new Set(keys)) counts.set(short(k), (counts.get(short(k)) ?? 0) + 1);
  return (k: string) => {
    const n = db[k].name;
    if ((counts.get(short(k)) ?? 0) < 2) return short(k);
    const m = n.match(/ of (?:the )?(.+), (.+)$/);
    return m ? `${m[1]} ${m[2]}` : n;
  };
}

const num = (n: number) => n.toLocaleString("en");

// One step as a sentence: who used an ability (with its cost) and what it did
export function stepText(step: Step, name: (k: string) => string): string {
  const out: string[] = [];
  let cur: { who?: string; cost: string[]; did: string[] } = { cost: [], did: [] };
  const flush = () => {
    if (!cur.who && !cur.did.length && !cur.cost.length) return;
    const head = cur.who ? `${cur.who}${cur.cost.length ? ` (${cur.cost.join(", ")})` : ""}` : cur.cost.join(", ");
    out.push(cur.did.length ? `${head ? `${head}: ` : ""}${cur.did.join(", ")}` : head);
    cur = { cost: [], did: [] };
  };
  const start = (who: string) => { flush(); cur.who = who; };
  for (const it of step.items) {
    if (it.kind === "skill") { start(name(it.key)); continue; }
    if (it.kind === "cost") { (it.text.startsWith("CC") ? cur.did : cur.cost).push(it.text); continue; }
    const c = name(it.key);
    if (it.skill) start(c);
    if (it.opp) { if (it.to === "DROP") cur.did.push(`retires opponent's ${c}`); continue; }
    const to = it.to, from = it.from;
    if (from === "G" && to === "VC") cur.did.push(`stride ${c}`);
    else if (to === "HEART" || (from === "HEART" && to === "VC") || (from === "VC" && to === "G")) continue;
    else if (from === "HAND" && to.startsWith("RC")) cur.did.push(`call ${c} to ${to}`);
    else if (from === "HAND" && to === "DROP") cur.did.push(`discard ${c}`);
    else if (from === "DROP" && to.startsWith("RC")) cur.did.push(`calls ${c} from drop to ${to}`);
    else if (from === "SOUL" && to.startsWith("RC")) cur.did.push(`calls ${c} from soul to ${to}`);
    else if (from.startsWith("RC") && to.startsWith("RC")) cur.did.push(`moves ${c} ${from} → ${to}`);
    else if (from.startsWith("RC") && to === "DROP") cur.did.push(`${c} ${from} → drop`);
    else if (from.startsWith("RC") && to === "SOUL") cur.did.push(`${c} ${from} → soul`);
    else if (from === "DECK" && to === "HAND") cur.did.push(`draws ${c}`);
    else if (from === "DECK" && to === "SOUL") cur.did.push(`soul charge ${c}`);
    else if (from === "DECK" && to === "DROP") cur.did.push(`mills ${c}`);
    else if (from === "DROP" && to === "SOUL") cur.did.push(`${c} drop → soul`);
    else if (from === "DROP" && to === "HAND") cur.did.push(`returns ${c} to hand`);
    else if (from === "SOUL" && to === "DROP") continue;   // soul blast, shown as SB
    else cur.did.push(`${c} ${from} → ${to}`);
  }
  flush();
  const a = step.attack;
  const body = out.join("; ");
  if (a) return `Attack: ${name(a.key)} (${a.from}${a.booster ? ` + ${name(a.booster.key)} ${a.booster.from}` : ""}) ${num(a.power)}${a.crit > 1 ? ` ★${a.crit}` : ""}${body ? ` → ${body}` : ""}`;
  if (step.phase === "end" && step.action === "next-phase") return `End of turn${body ? `: ${body}` : ""}`;
  if (step.action === "next-phase") return body ? `${step.phase[0].toUpperCase()}${step.phase.slice(1)} phase starts: ${body}` : "";
  return body;
}

// Combo name: the cards whose abilities drove the line, in the order they first did something
export function comboName(steps: Step[], name: (k: string) => string): string {
  const order: string[] = [];
  for (const st of steps) for (const it of st.items) {
    const k = it.kind === "skill" ? it.key : it.kind === "move" && it.skill && !it.opp ? it.key : it.kind === "move" && it.from === "G" && it.to === "VC" ? it.key : undefined;
    if (k && !order.includes(name(k))) order.push(name(k));
  }
  return order.slice(0, 6).join(" → ") + (order.length > 6 ? " → …" : "");
}
