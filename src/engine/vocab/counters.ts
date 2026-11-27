// Counters: numbers an ability can read, used in conditions (souled≥2), amounts (n=count-in-drop(…)), and "for each" (per souled)
import { generationBreak, other } from "../rules";
import type { CardInstance } from "../types";
import { cardMatches } from "./filters";
import type { CounterSpec, Scope } from "./types";

const env = (sc: Scope, i?: CardInstance) => ({ db: sc.db, source: sc.source && sc.db[sc.source.key], sourceKey: sc.source?.key, uid: i?.uid });
const countIn = (sc: Scope, list: CardInstance[], flt: string) => list.filter((i) => cardMatches(sc.db[i.key], flt, env(sc, i))).length;
const vcGradeOf = (sc: Scope, p: "own" | "opp") => {
  const vc = sc.s.players[p === "own" ? sc.owner : other(sc.owner)].circles.vc;
  return vc ? sc.db[vc.key].grade : 0;
};

// What this ability did so far (Resolving.done), optionally only the cards matching a filter
const did = (tag: string, text: string, flt = ""): CounterSpec => ({
  forms: [tag, `${tag}({filter})`], text,
  count: (sc, arg) => (sc.r?.done[tag] ?? []).filter((d) => cardMatches(sc.db[d.key], arg || flt, { db: sc.db, sourceKey: sc.source?.key })).length,
});

export const COUNTERS: Record<string, CounterSpec> = {
  GB: { forms: ["GB"], text: "Generation Break: face-up G units on VC and in the G zone", count: (sc) => generationBreak(sc.db, sc.s.players[sc.owner]) },
  "vc-grade": { forms: ["vc-grade"], text: "Our vanguard's grade", count: (sc) => vcGradeOf(sc, "own") },
  "opp-vc-grade": { forms: ["opp-vc-grade"], text: "The opponent's vanguard's grade", count: (sc) => vcGradeOf(sc, "opp") },
  "G-faceup": { forms: ["G-faceup", "G-faceup({filter})"], text: "Face-up cards in our G zone", count: (sc, f) => countIn(sc, sc.s.players[sc.owner].gZone.filter((g) => g.faceUp), f) },
  drop: { forms: ["drop"], text: "Cards in our drop zone", count: (sc) => sc.s.players[sc.owner].drop.length },
  "drop-count": { forms: ["drop-count"], text: "Cards in our drop zone", count: (sc) => sc.s.players[sc.owner].drop.length },
  soul: { forms: ["soul"], text: "Cards in our soul", count: (sc) => sc.s.players[sc.owner].soul.length },
  hand: { forms: ["hand"], text: "Cards in our hand", count: (sc) => sc.s.players[sc.owner].hand.length },
  damage: { forms: ["damage"], text: "Cards in our damage zone", count: (sc) => sc.s.players[sc.owner].damage.length },
  "count-in-drop": { forms: ["count-in-drop({filter})"], text: "Cards in our drop zone matching the filter", count: (sc, f) => countIn(sc, sc.s.players[sc.owner].drop, f) },
  "count-in-soul": { forms: ["count-in-soul({filter})"], text: "Cards in our soul matching the filter", count: (sc, f) => countIn(sc, sc.s.players[sc.owner].soul, f) },
  souled: did("souled", "Cards this ability put into the soul"),
  called: did("called", "Cards this ability called"),
  returned: did("returned", "Cards this ability returned to the deck"),
  charged: did("charged", "Cards this ability soul charged"),
  "soul-charged": { ...did("charged", "Cards this ability soul charged"), forms: ["soul-charged({filter})"] },
  stood: did("stood", "Units this ability stood"),
  milled: did("milled", "Cards this ability put into the drop zone from the deck"),
  "hollow-milled": { ...did("milled", "Cards with Hollow this ability put into the drop zone from the deck", "has-hollow"), forms: ["hollow-milled"] },
};

// Parse "name" / "name(arg)" into a known counter
export function counterRef(expr: string): [string, string] | undefined {
  const m = expr.match(/^([\w-]+)(?:\((.*)\))?$/);
  return m && COUNTERS[m[1]] ? [m[1], m[2] ?? ""] : undefined;
}

// A number expression: 3, a counter, counter+1, or "2 drop" (one for every 2 cards counted)
export function amount(sc: Scope, expr: string): number {
  const e = expr.trim();
  if (/^\d+$/.test(e)) return +e;
  let m = e.match(/^(.+)\+(\d+)$/);
  if (m) return amount(sc, m[1]) + +m[2];
  m = e.match(/^(\d+) (.+)$/);
  if (m) return Math.floor(amount(sc, m[2]) / +m[1]);
  const ref = counterRef(e);
  return ref ? COUNTERS[ref[0]].count(sc, ref[1]) : 0;
}

export function knownAmount(expr: string): boolean {
  const e = expr.trim();
  if (/^\d+$/.test(e)) return true;
  let m = e.match(/^(.+)\+(\d+)$/);
  if (m) return knownAmount(m[1]);
  m = e.match(/^(\d+) (.+)$/);
  if (m) return knownAmount(m[2]);
  return !!counterRef(e);
}

// How many cards a choice allows: "n≤3" up to 3, "n=2" exactly 2, "n=2..3" two to three, n≤<amount> / n=<amount> also work
export function range(sc: Scope, spec: string | undefined, fallback: string): { min: number; max: number } {
  const t = (spec ?? fallback).trim();
  let m = t.match(/^n=(\d+)\.\.(\d+)$/);
  if (m) return { min: +m[1], max: +m[2] };
  m = t.match(/^n(≤|=)(.+)$/);
  if (m) { const v = amount(sc, m[2]); return { min: m[1] === "=" ? v : 0, max: v }; }
  if (/^\d+$/.test(t)) return { min: +t, max: +t };
  return { min: 0, max: 0 };
}

export function knownRange(spec: string): boolean {
  const t = spec.trim();
  if (/^n=\d+\.\.\d+$/.test(t) || /^\d+$/.test(t)) return true;
  const m = t.match(/^n(≤|=)(.+)$/);
  return !!m && knownAmount(m[2]);
}
