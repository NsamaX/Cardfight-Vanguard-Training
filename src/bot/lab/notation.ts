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
  for (const { p: who, a } of line.actions) {
    const before = positions(s);
    const r = apply(db, s, who, a);
    const after = positions(r.state);
    const used = new Set(r.events.filter((e) => e.code === "ability" && e.cardUid).map((e) => e.cardUid!));
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
  // The final Power of each attack (after AUTO abilities on attack) comes from the line's result
  const atks = steps.filter((x) => x.attack);
  atks.forEach((x, i) => { const r = line.result.attacks[i]; if (r) { x.attack!.power = r.power; x.attack!.crit = r.crit; } });
  return steps;
}
