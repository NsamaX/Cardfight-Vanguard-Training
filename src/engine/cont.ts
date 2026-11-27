// Continuous abilities (CONT) and the rules a card's own STRIDE / G GUARDIAN ability can change.
// CONT effects are not stored: after every change the engine drops the "cont" modifiers and computes them again,
// so they follow the board (a condition that stops holding takes the bonus away at once).
import { parseCode } from "./code";
import { PLAYERS, type CardDB } from "./rules";
import { abilityZoneOk } from "./abilities";
import { fieldUnits, type Out } from "./state";
import { cardMatches } from "./vocab/filters";
import type { Ability, Card, CardInstance, Circle, GameState, PlayerId, Resolving } from "./types";
import { OPS } from "./vocab";
import { condsHold } from "./vocab/conditions";

// A stand-in for the resolving ability, so CONT effects can use the same ops and selectors as AUTO/ACT steps
const asResolving = (db: CardDB, owner: PlayerId, inst: CardInstance, key: string, ab: Ability): Resolving => ({
  owner, uid: inst.uid, key, ability: ab, label: `${db[inst.key].name} [CONT]`, optional: false,
  ops: ab.effect, i: 0, asked: true, local: {}, done: {}, usedCircles: [],
});

export function refreshContinuous(db: CardDB, s: GameState) {
  for (const p of PLAYERS) for (const u of fieldUnits(s.players[p])) if (u.mods.some((m) => m.until === "cont")) u.mods = u.mods.filter((m) => m.until !== "cont");
  for (const p of PLAYERS) {
    for (const [circle, inst] of Object.entries(s.players[p].circles) as [Circle, CardInstance | undefined][]) {
      if (!inst) continue;
      db[inst.key].abilities.forEach((ab, i) => {
        if (ab.kind !== "CONT" || !abilityZoneOk(ab.zone, circle)) return;
        const key = String(i);
        if (!condsHold({ db, s, owner: p, source: inst, key }, ab.cond, "resolve")) return;
        const r = asResolving(db, p, inst, key, ab);
        for (const code of ab.effect) {
          const c = parseCode(code);
          OPS[c.name]?.cont?.({ db, s, owner: p, source: inst, key, r, out: [], c });
        }
      });
    }
  }
}

// A card's grade while it's used for something (e.g. the stride cost: Flap Angel "while paying the cost for STRIDE, grade +2")
export function gradeWhile(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance, mode: string): number {
  let g = db[inst.key].grade;
  db[inst.key].abilities.forEach((ab, i) => {
    if (ab.kind !== "CONT" || !condsHold({ db, s, owner: p, source: inst, key: String(i), mode }, ab.cond, "resolve")) return;
    for (const code of ab.effect) {
      const c = parseCode(code);
      if (c.name === "grade" && c.pos[1] === "self") g += parseInt(c.pos[0], 10) || 0;
    }
  });
  return g;
}

export const strideCostGrade = (db: CardDB, s: GameState, p: PlayerId, inst: CardInstance) => gradeWhile(db, s, p, inst, "stride-cost");

const costOf = (card: Card, kind: Ability["kind"]) => card.abilities.find((a) => a.kind === kind)?.cost ?? [];

// Can these hand cards pay the G unit's stride? Ultimate stride (rules 6.6.3): its own condition (3+ face-up in the G zone)
// and its discard (e.g. a card with the vanguard's name); a normal stride: grades adding up to its STRIDE cost
export function strideCostOk(db: CardDB, s: GameState, p: PlayerId, g: Card, discards: CardInstance[]): boolean {
  const ultimate = g.abilities.find((a) => a.kind === "ULTIMATE STRIDE");
  if (!ultimate) return discards.length > 0 && discards.reduce((n, c) => n + strideCostGrade(db, s, p, c), 0) >= strideGradeNeeded(g);
  if (!condsHold({ db, s, owner: p }, ultimate.cond, "resolve")) return false;
  const discard = (ultimate.cost ?? []).map(parseCode).find((c) => c.name === "discard");
  const n = parseInt(discard?.pos[0] ?? "1", 10) || 1;
  const vc = s.players[p].circles.vc;
  const env = { db, vcName: vc && db[vc.key].name };
  return discards.length === n && discards.every((d) => cardMatches(db[d.key], discard?.named.filter ?? "", env));
}

export const isUltimate = (g: Card) => g.abilities.some((a) => a.kind === "ULTIMATE STRIDE");

// Costs a CONT makes an attack pay (attack-tax(cost, RC): rear-guards attacking a vanguard), from either player's units
export function attackTaxes(db: CardDB, s: GameState, attacker: Circle, target: Circle): string[] {
  const out: string[] = [];
  for (const p of PLAYERS) {
    for (const [circle, inst] of Object.entries(s.players[p].circles) as [Circle, CardInstance | undefined][]) {
      if (!inst) continue;
      db[inst.key].abilities.forEach((ab, i) => {
        if (ab.kind !== "CONT" || !abilityZoneOk(ab.zone, circle) || !condsHold({ db, s, owner: p, source: inst, key: String(i) }, ab.cond, "resolve")) return;
        for (const code of ab.effect) {
          const c = parseCode(code);
          if (c.name === "attack-tax" && c.pos[1] === "RC" && attacker !== "vc" && target === "vc") out.push(c.pos[0]);
        }
      });
    }
  }
  return out;
}

// Pay a cost the rules ask for (not an ability's): uses the same ops; false = can't be paid
export function payRuleCost(db: CardDB, s: GameState, p: PlayerId, code: string, label: string, out: Out, check = false): boolean {
  const c = parseCode(code);
  const vc = s.players[p].circles.vc!;
  const r: Resolving = { owner: p, uid: vc.uid, key: "rule", ability: { kind: "AUTO", effect: [] }, label, optional: false, ops: [code], i: 0, asked: true, local: {}, done: {}, usedCircles: [] };
  const ctx = { db, s, owner: p, source: vc, key: "rule", r, out, c };
  const spec = OPS[c.name];
  if (!spec || (spec.canPay && !spec.canPay(ctx))) return false;
  if (!check) spec.run(ctx);
  return true;
}

// The grade total a G unit's STRIDE cost asks for: discard(n, grade-sum≥N); the rules' 3 when the card doesn't say
export function strideGradeNeeded(card: Card): number {
  for (const code of costOf(card, "STRIDE")) {
    const m = parseCode(code).pos.join(",").match(/grade-sum≥(\d+)/);
    if (m) return +m[1];
  }
  return 3;
}

// The hand card a G guardian's cost discards: discard(1, filter=…); the rules' Heal trigger when the card doesn't say
export function guardianDiscardFilter(card: Card): string {
  for (const code of costOf(card, "G GUARDIAN")) {
    const c = parseCode(code);
    if (c.name === "discard" && c.named.filter) return c.named.filter;
  }
  return "heal";
}
