import { cards } from "../data/cards";
import { isOptional } from "../engine/abilities";
import { validateCard } from "../engine/vocab";
import { splitTop } from "../engine/code";
import { editorTemplates } from "../engine/vocab/editor";
import { grantedAbility } from "../engine/vocab/ops/meta";
import type { Ability, AbilityKind, Card } from "../engine/types";

// Editable form of an ability for the card editor, and the code templates its dropdowns offer.
// A template is an ability code with its numbers replaced by # and its quoted texts by "$", e.g. CB(#) or vc-name("$").

// "AUTO+" = optional AUTO (stored as optional: true)
export const KINDS = ["AUTO", "AUTO+", "ACT", "CONT", "STRIDE", "ULTIMATE STRIDE", "G GUARDIAN"] as const;
export type KindPick = (typeof KINDS)[number];

export type ListField = "cond" | "cost" | "effect";
export interface Draft { kind: KindPick; zone?: string; timing: string; cond: string[]; cost: string[]; effect: string[]; follows?: boolean }

// Values in a code: quoted texts, and numbers after ( , + - ≤ ≥ = or a space, e.g. CB(1), power(+5000, …), grade-3; 1/turn doesn't count
const VALUE = /"[^"]*"|(?<=[(,+\-≤≥= ])\d+/g;
export interface CodeValue { text: boolean; v: string }
export const templateOf = (code: string) => code.replace(VALUE, (m) => (m.startsWith('"') ? '"$"' : "#"));
export const valuesOf = (code: string): CodeValue[] => (code.match(VALUE) ?? []).map((m) => (m.startsWith('"') ? { text: true, v: m.slice(1, -1) } : { text: false, v: m }));
export function fill(template: string, values: string[]) {
  let i = 0;
  return template.replace(/"\$"|#/g, (m) => (m === "#" ? values[i++] || "1" : `"${values[i++] ?? ""}"`));
}

// The templates a field offers: every form in the engine's vocabulary, plus the codes library cards already use
const PICK: Record<ListField | "timing", (a: Ability) => string[] | undefined> = {
  timing: (a) => (a.timing ? [a.timing] : undefined), cond: (a) => a.cond, cost: (a) => a.cost, effect: (a) => a.effect,
};
// (a code some card uses that the engine can't run isn't offered)
const runs = (field: ListField | "timing", tpl: string) => {
  const code = fill(tpl, []);
  const ab: Ability = field === "timing" ? { kind: "AUTO", timing: code, effect: [] } : { kind: "AUTO", effect: [], [field]: [code] };
  return validateCard({ ...emptyCard(), abilities: [ab] }).length === 0;
};
// A filter and a granted ability are edited with their own controls, so templates hold a slot for them (see splitParts)
export const codeTemplates = (field: ListField | "timing") => {
  const used = cards.flatMap((c) => c.abilities.flatMap((a) => PICK[field](a) ?? [])).map(templateOf).filter((tpl) => runs(field, tpl));
  return [...new Set([...editorTemplates(field), ...used].map((t) => splitParts(t).code))].sort();
};

// Templates for one filter term (filter=a & b & …)
export const filterTemplates = () => editorTemplates("filter").map(templateOf);

// ---------- Arguments with their own editor: filter=… and a granted ability ----------

export const SLOT = { filter: "filter=…", ability: "ability…" } as const;
export const DEFAULT_FILTER = "normal-unit";
export const DEFAULT_ABILITY = "AUTO-RC[turn-end → draw(1)]";
export interface Parts { filter?: string; ability?: string }

const isAbilityArg = (a: string) => /^(AUTO|ACT)(-[\w/]+)?\[/.test(a);

// Replace the filter and granted ability arguments with slots: the step picker works on the rest, the slots get their own editors
export function splitParts(code: string): { code: string; parts: Parts } {
  const path = codePath(code);
  if (path.length < 2) return { code, parts: {} };
  const parts: Parts = {};
  const args = path.slice(1).map((a) => {
    if (a.startsWith("filter=")) { parts.filter = a.slice("filter=".length); return SLOT.filter; }
    if (isAbilityArg(a)) { parts.ability = a; return SLOT.ability; }
    return a;
  });
  return { code: `${path[0]}(${args.join(", ")})`, parts };
}

export function joinParts(code: string, parts: Parts): string {
  return code.replace(SLOT.filter, `filter=${parts.filter || DEFAULT_FILTER}`).replace(SLOT.ability, parts.ability || DEFAULT_ABILITY);
}

export const filterTerms = (flt: string) => splitTop(flt, "&");
export const joinFilter = (terms: string[]) => terms.filter(Boolean).join(" & ");

// A granted ability as editable parts, and back: AUTO-VC[timing → effect & effect] / ACT-RC[cost & cost → effect]
export interface GrantDraft { kind: "AUTO" | "ACT"; zone?: string; timing: string; cost: string[]; effect: string[] }
export function toGrantDraft(code: string): GrantDraft {
  const ab = grantedAbility(code);
  if (!ab) return { kind: "AUTO", timing: "", cost: [], effect: [""] };
  return { kind: ab.kind === "ACT" ? "ACT" : "AUTO", zone: ab.zone, timing: ab.timing ?? "", cost: ab.cost ?? [], effect: ab.effect };
}
export function fromGrantDraft(g: GrantDraft): string {
  const left = g.kind === "AUTO" ? g.timing : g.cost.filter(Boolean).join(" & ");
  return `${g.kind}${g.zone ? `-${g.zone}` : ""}[${left} → ${g.effect.filter(Boolean).join(" & ")}]`;
}

export const toDraft = (a: Ability): Draft => ({
  kind: a.kind === "AUTO" && isOptional(a) ? "AUTO+" : a.kind,
  zone: a.zone,
  timing: a.timing ?? "",
  cond: a.cond ?? [],
  cost: a.cost ?? [],
  effect: a.effect,
  follows: a.follows,
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
  if (d.follows) ability.follows = true;
  return ability;
}

export const emptyDraft = (): Draft => ({ kind: "AUTO", timing: "", cond: [], cost: [], effect: [""] });

export function emptyCard(): Card {
  const key = `USER-${Date.now().toString(36).toUpperCase()}`;
  return { key, ids: [key], name: "", format: ["G"], type: "normal", grade: 0, power: 5000, shield: 10000, critical: 1, race: "", clan: "", abilities: [], text: "" };
}

// Code picker by steps: a template is a path [name, arg1, arg2, ...] (top-level commas split the args), and the
// picker offers one step at a time, e.g. enter → RC → self → from=drop, instead of every template in one list
export function codePath(template: string): string[] {
  const open = template.indexOf("(");
  if (open < 0 || !template.endsWith(")")) return [template];
  const args: string[] = [];
  let depth = 0, quoted = false, start = open + 1;
  for (let i = start; i < template.length - 1; i++) {
    const ch = template[i];
    if (ch === "\"") quoted = !quoted;
    else if (!quoted && (ch === "(" || ch === "[")) depth++;
    else if (!quoted && (ch === ")" || ch === "]")) depth--;
    else if (!quoted && depth === 0 && ch === ",") { args.push(template.slice(start, i).trim()); start = i + 1; }
  }
  args.push(template.slice(start, template.length - 1).trim());
  return [template.slice(0, open), ...args.filter(Boolean)];
}

const startsWith = (path: string[], prefix: string[]) => prefix.every((p, i) => path[i] === p);

// The choices for the next step after prefix; ends = some template stops right at prefix
export function nextSteps(templates: string[], prefix: string[]): { options: string[]; ends: boolean } {
  const paths = templates.map(codePath).filter((p) => startsWith(p, prefix));
  return {
    options: [...new Set(paths.filter((p) => p.length > prefix.length).map((p) => p[prefix.length]))],
    ends: paths.some((p) => p.length === prefix.length),
  };
}

// The template a choice leads to: the one that stops at prefix, else the first that continues from it
export function templateFor(templates: string[], prefix: string[]): string | undefined {
  const matching = templates.filter((t) => startsWith(codePath(t), prefix));
  return matching.find((t) => codePath(t).length === prefix.length) ?? matching[0];
}
