// Code templates for the card editor, built from the registry: every form each code declares, with its slots filled in
// ({target}, {filter}, {until}), so the editor offers any registered code, not only codes some card already uses.
// In a template, # is a number and "$" a text the player types.
import { PREDICATES } from "./conditions";
import { COUNTERS } from "./counters";
import { FILTERS, SET_RULES } from "./filters";
import { OPS } from "./index";
import { SELECTORS } from "./selectors";
import { TIMINGS } from "./timings";

const SLOTS: Record<string, () => string[]> = {
  "{target}": () => Object.values(SELECTORS).flatMap((s) => s.forms),
  "{filter}": () => [...Object.values(FILTERS).flatMap((f) => f.forms), ...Object.keys(SET_RULES)],
  "{until}": () => ["until=turn-end", "until=battle-end"],
};

// Fill the first slot with each of its options, then the rest (options may contain slots too)
export function expand(form: string): string[] {
  const slot = Object.keys(SLOTS).find((k) => form.includes(k));
  if (!slot) return [form];
  return SLOTS[slot]().flatMap((o) => expand(form.replace(slot, o)));
}

// Forms that describe a shape rather than a code (e.g. a granted ability's inside) aren't offered as templates
const usable = (f: string) => !/\[(timing|cost)|→ effect|…/.test(f);

const COMPARE = ["≥#", "≤#", "=#"];

export function editorTemplates(field: "timing" | "cond" | "cost" | "effect" | "filter"): string[] {
  let forms: string[];
  if (field === "filter") forms = SLOTS["{filter}"]();
  else if (field === "timing") forms = Object.values(TIMINGS).flatMap((t) => t.forms);
  else if (field === "cond") forms = [...Object.values(PREDICATES).flatMap((p) => p.forms), ...Object.values(COUNTERS).flatMap((c) => c.forms.flatMap((f) => COMPARE.map((op) => f + op)))];
  else if (field === "cost") forms = Object.values(OPS).filter((o) => o.canPay).flatMap((o) => o.forms);
  else forms = Object.entries(OPS).filter(([name, o]) => !o.passive && name !== "g-assist").flatMap(([, o]) => o.forms);
  return [...new Set(forms.filter(usable).flatMap(expand))];
}
