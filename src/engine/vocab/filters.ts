// Card filters (filter=a & b & ...): which cards an ability may pick, count, or look for
import { quoted, splitTop } from "../code";
import { RuleError, hasHollow } from "../rules";
import type { Card } from "../types";
import type { FilterEnv, FilterSpec } from "./types";

const hasKeyword = (card: Card, word: string) => card.abilities.some((a) => a.effect.includes(`keyword(${word})`));

export const FILTERS: Record<string, FilterSpec> = {
  "grade-": { forms: ["grade-#"], text: "Grade exactly n", test: (c, n) => c.grade === +n },
  "grade≤": { forms: ["grade≤#"], text: "Grade n or less", test: (c, n) => c.grade <= +n },
  "grade≥": { forms: ["grade≥#"], text: "Grade n or more", test: (c, n) => c.grade >= +n },
  name: { forms: ['name("$")'], text: "Has this word in its card name", test: (c, arg) => c.name.includes(quoted(arg)) },
  "same-name": { forms: ["same-name"], text: "The same card as the ability's source", test: (c, _a, env) => !env.sourceKey || c.key === env.sourceKey },
  "not-same-name": { forms: ["not-same-name"], text: "A different card name than the source", test: (c, _a, env) => !env.source || c.name !== env.source.name },
  "normal-unit": { forms: ["normal-unit"], text: "A normal unit (not a trigger or G card)", test: (c) => c.type === "normal" },
  heal: { forms: ["heal"], text: "A Heal trigger", test: (c) => c.trigger === "heal" },
  "heal-trigger": { forms: ["heal-trigger"], text: "A Heal trigger", test: (c) => c.trigger === "heal" },
  "G-GUARDIAN": { forms: ["G-GUARDIAN"], text: "A G guardian", test: (c) => c.type === "g-guardian" },
  "has-hollow": { forms: ["has-hollow"], text: "Has the Hollow ability", test: (c) => hasHollow(c) },
  "has-revelation": { forms: ["has-revelation"], text: "Has the Revelation keyword", test: (c) => hasKeyword(c, "Revelation") },
  "that-card": { forms: ["that-card"], text: "The card the triggering event was about", test: (_c, _a, env) => !env.thatUids || !env.uid || env.thatUids.includes(env.uid) },
  clan: { forms: ['clan("$")', "Granblue"], text: "Of this clan (a bare capitalized word is a clan name too)", test: (c, arg) => c.clan === (quoted(arg) || arg) },
};

// Constraints on the whole chosen set rather than each card: checked when the player answers
export const SET_RULES: Record<string, { text: string; ok(cards: Card[]): boolean; error: "err.differentGrades" | "err.sameGrade" | "err.strideCost" }> = {
  "different-grades": { text: "All chosen cards have different grades", ok: (cs) => new Set(cs.map((c) => c.grade)).size === cs.length, error: "err.differentGrades" },
  "same-grade": { text: "All chosen cards share one grade", ok: (cs) => new Set(cs.map((c) => c.grade)).size <= 1, error: "err.sameGrade" },
  "grade-sum≥3": { text: "The chosen cards' grades add up to 3 or more", ok: (cs) => cs.reduce((n, c) => n + c.grade, 0) >= 3, error: "err.strideCost" },
};

// Split one filter term into its registry name and argument, e.g. grade-3 → ["grade-", "3"], name("X") → ["name", '"X"']
export function filterTerm(t: string): [string, string] | undefined {
  const m = t.match(/^(grade-|grade≤|grade≥)(\d+)$/);
  if (m) return [m[1], m[2]];
  const call = t.match(/^([\w-]+)\((.*)\)$/);
  if (call && FILTERS[call[1]]) return [call[1], call[2]];
  if (FILTERS[t] || SET_RULES[t]) return [t, ""];
  if (/^[A-Z][\w ]*$/.test(t)) return ["clan", t];   // a bare capitalized word is a clan name, e.g. Granblue
  return undefined;
}

export const filterTerms = (flt: string) => splitTop(flt, "&").filter(Boolean);

// Does the card pass every per-card term of the filter? Set rules pass here (checked on the chosen set)
export function cardMatches(card: Card, flt: string, env: FilterEnv): boolean {
  for (const t of filterTerms(flt)) {
    const term = filterTerm(t);
    if (!term) return false;   // unknown term: never matches (the validator reports it)
    if (SET_RULES[term[0]]) continue;
    if (!FILTERS[term[0]].test(card, term[1], env)) return false;
  }
  return true;
}

export function checkSet(cards: Card[], flt: string) {
  for (const t of filterTerms(flt)) {
    const rule = SET_RULES[t];
    if (rule && !rule.ok(cards)) throw new RuleError(rule.error);
  }
}

// Unknown terms in a filter (for the validator)
export const unknownFilterTerms = (flt: string) => filterTerms(flt).filter((t) => !filterTerm(t));
