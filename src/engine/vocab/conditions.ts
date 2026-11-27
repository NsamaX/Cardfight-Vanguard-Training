// Conditions: an ability's cond list and an effect's if=. A term is a named predicate, e.g. own-turn or vc-name("Regalia"),
// or a comparison of a counter with a number, e.g. souled≥2, G-faceup(name("Regalia"))≥2, opp-vc-grade=2
import { quoted, splitTop } from "../code";
import { generationBreak, hasHollow } from "../rules";
import { COUNTERS, counterRef } from "./counters";
import type { PredicateSpec, Scope } from "./types";

const vcNames = (sc: Scope) => {
  const ps = sc.s.players[sc.owner];
  const vc = ps.circles.vc && sc.db[ps.circles.vc.key];
  // A G unit on VC also has its heart's name
  return [vc?.name ?? "", ps.heart && vc?.type === "g-unit" ? sc.db[ps.heart.key].name : ""].join(" ");
};

export const PREDICATES: Record<string, PredicateSpec> = {
  GB: { forms: ["GB(#)"], text: "Generation Break n or more", test: (sc, n) => generationBreak(sc.db, sc.s.players[sc.owner]) >= +n },
  "1/turn": { forms: ["1/turn"], text: "Once per turn", test: (sc) => !sc.source || !sc.key || !sc.source.usedThisTurn.includes(sc.key) },
  "own-turn": { forms: ["own-turn"], text: "During our turn", test: (sc) => sc.s.turnPlayer === sc.owner },
  // As a cond it's checked when resolving (the unit may be hollowed by another ability that resolves first)
  "self-hollowed": { forms: ["self-hollowed"], text: "This card is hollowed", test: (sc, _a, phase) => phase === "trigger" || !!sc.source?.hollowed },
  "vc-name": { forms: ['vc-name("…")'], text: "Our vanguard (or its heart) has this word in its name", test: (sc, a) => vcNames(sc).includes(quoted(a)) },
  "heart-name": { forms: ['heart-name("…")'], text: "Our heart card has this word in its name", test: (sc, a) => { const h = sc.s.players[sc.owner].heart; return !!h && sc.db[h.key].name.includes(quoted(a)); } },
  "vc-clan": { forms: ["vc-clan(…)"], text: "Our vanguard is of this clan", test: (sc, a) => { const vc = sc.s.players[sc.owner].circles.vc; return !!vc && sc.db[vc.key].clan === a; } },
  "souled-name": { forms: ['souled-name("…")'], text: "This ability put a card with this word in its name into the soul", test: (sc, a) => (sc.r?.done.souled ?? []).some((d) => sc.db[d.key].name.includes(quoted(a))) },
  "name-in-drop": { forms: ['name-in-drop("…")'], text: "A card with this word in its name is in our drop zone", test: (sc, a) => sc.s.players[sc.owner].drop.some((i) => sc.db[i.key].name.includes(quoted(a))) },
  "called-has-hollow": { forms: ["called-has-hollow"], text: "A card this ability called has Hollow", test: (sc) => (sc.r?.done.called ?? []).some((d) => hasHollow(sc.db[d.key])) },
  while: { forms: ["while(stride-cost)"], text: "Only while doing this (CONT): stride-cost = paying the stride cost", test: (sc, a) => sc.mode === a },
};

const COMPARE = /^(.+?)(≥|≤|=)(\d+)$/;

function parseTerm(t: string): { pred: string; arg: string } | { counter: [string, string]; op: string; n: number } | undefined {
  const call = t.match(/^([\w/-]+)\((.*)\)$/);
  if (call && PREDICATES[call[1]]) return { pred: call[1], arg: call[2] };
  if (PREDICATES[t]) return { pred: t, arg: "" };
  const m = t.match(COMPARE);
  const counter = m && counterRef(m[1]);
  if (m && counter) return { counter, op: m[2], n: +m[3] };
  return undefined;
}

export function checkTerm(sc: Scope, t: string, phase: "trigger" | "resolve"): boolean {
  const p = parseTerm(t);
  if (!p) return false;   // unknown: never true, so an unsupported condition can't give an effect for free (the validator reports it)
  if ("pred" in p) return PREDICATES[p.pred].test(sc, p.arg, phase);
  const v = COUNTERS[p.counter[0]].count(sc, p.counter[1]);
  return p.op === "≥" ? v >= p.n : p.op === "≤" ? v <= p.n : v === p.n;
}

export const condTerms = (c: string) => splitTop(c, "&").filter(Boolean);

// Every term of every cond entry holds
export function condsHold(sc: Scope, conds: string[] | undefined, phase: "trigger" | "resolve"): boolean {
  return (conds ?? []).every((c) => condTerms(c).every((t) => checkTerm(sc, t, phase)));
}

export const unknownCondTerms = (c: string) => condTerms(c).filter((t) => !parseTerm(t));
