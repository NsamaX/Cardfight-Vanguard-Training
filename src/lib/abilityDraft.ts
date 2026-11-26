import { cards } from "../data/cards";
import { isOptional } from "../engine/abilities";
import type { Ability, AbilityKind, Card } from "../engine/types";

// Editable form of an ability for the card editor, and the code templates its dropdowns offer.
// A template is an ability code with its numeric values replaced by #, e.g. CB(#) or power(+#, …).

// "AUTO+" = optional AUTO (stored as optional: true)
export const KINDS = ["AUTO", "AUTO+", "ACT", "CONT", "STRIDE", "ULTIMATE STRIDE", "G GUARDIAN"] as const;
export type KindPick = (typeof KINDS)[number];

export type ListField = "cond" | "cost" | "effect";
export interface Draft { kind: KindPick; zone?: string; timing: string; cond: string[]; cost: string[]; effect: string[] }

// Numbers that are values in a code (after ( , + - ≤ ≥ = or a space), e.g. CB(1), power(+5000, …), grade-3; 1/turn doesn't count
const NUM = /(?<=[(,+\-≤≥= ])\d+/g;
export const templateOf = (code: string) => code.replace(NUM, "#");
export const numbersOf = (code: string) => code.match(NUM) ?? [];
export function fill(template: string, nums: string[]) {
  let i = 0;
  return template.replace(/#/g, () => nums[i++] || "1");
}

export const codeTemplates = (pick: (a: Ability) => string[] | undefined) =>
  [...new Set(cards.flatMap((c) => c.abilities.flatMap((a) => pick(a) ?? [])).map(templateOf))].sort();

export const toDraft = (a: Ability): Draft => ({
  kind: a.kind === "AUTO" && isOptional(a) ? "AUTO+" : a.kind,
  zone: a.zone,
  timing: a.timing ?? "",
  cond: a.cond ?? [],
  cost: a.cost ?? [],
  effect: a.effect,
});

export function toAbility(d: Draft): Ability {
  const kind: AbilityKind = d.kind === "AUTO+" ? "AUTO" : d.kind;
  const ability: Ability = { kind, effect: d.effect.filter(Boolean) };
  if (d.zone) ability.zone = d.zone;
  if (d.timing) ability.timing = d.timing;
  if (d.cond.some(Boolean)) ability.cond = d.cond.filter(Boolean);
  if (d.cost.some(Boolean)) ability.cost = d.cost.filter(Boolean);
  // A cost or a "may" first effect already makes it optional, no need to write optional to the file
  if (d.kind === "AUTO+" && !isOptional(ability)) ability.optional = true;
  return ability;
}

export const emptyDraft = (): Draft => ({ kind: "AUTO", timing: "", cond: [], cost: [], effect: [""] });

export function emptyCard(): Card {
  const key = `USER-${Date.now().toString(36).toUpperCase()}`;
  return { key, ids: [key], name: "", format: ["G"], type: "normal", grade: 0, power: 5000, shield: 10000, critical: 1, race: "", clan: "", abilities: [], text: "" };
}
