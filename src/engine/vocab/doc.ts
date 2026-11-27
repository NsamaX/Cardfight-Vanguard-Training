// The code reference in documents/vocabulary.md, generated from the registry so the document can't drift from the engine.
// Regenerate with: npm run vocab-doc (a test fails when the document is out of date)
import { parseCode, splitTop } from "../code";
import type { Ability, Card } from "../types";
import { PREDICATES, condTerms } from "./conditions";
import { COUNTERS } from "./counters";
import { FILTERS, SET_RULES } from "./filters";
import { OPS } from "./index";
import { SELECTORS } from "./selectors";
import { TIMINGS } from "./timings";
import type { Doc } from "./types";

export const DOC_START = "<!-- generated from src/engine/vocab: npm run vocab-doc -->";
export const DOC_END = "<!-- end of generated part -->";

const cell = (s: string) => s.replace(/\|/g, "\\|");
// Editor slots read as words here: {target} → target, {filter} → filter, {until} → until=…, "$" → "…"
const readable = (f: string) => f.replace(/filter={filter}/g, "filter=…").replace(/\{(target|filter)\}/g, "$1").replace("{until}", "until=…").replace(/"\$"/g, '"…"');
const codes = (forms: string[]) => forms.map((f) => `\`${readable(f)}\``).join("<br>");

// Every code string in an ability, including the inside of choose(...) and granted abilities
function allCodes(ab: Ability): string[] {
  const out: string[] = [...(ab.cost ?? []), ...ab.effect];
  for (const code of [...out]) {
    const c = parseCode(code);
    if (c.name === "choose") out.push(...c.pos);
    const g = c.name === "grant" && c.pos[0].match(/^(AUTO|ACT)[^[]*\[(.*) → (.*)\]$/);
    if (g) out.push(...splitTop(g[3], "&"), ...(g[1] === "ACT" ? splitTop(g[2], "&") : []));
  }
  return out;
}

// The ability's timing and the timings of AUTO abilities it grants
function timingsOf(ab: Ability): string[] {
  const granted = allCodes(ab).map((x) => x.match(/^grant\(AUTO[^[]*\[(.*) → /)?.[1]).filter((x): x is string => !!x);
  return [ab.timing ?? "", ...granted].filter(Boolean);
}

const shortName = (c: Card) => c.name.split(", ").at(-1)!;

function usedBy(cards: Card[], uses: (ab: Ability) => boolean): string {
  const names = [...new Set(cards.filter((c) => c.abilities.some(uses)).map(shortName))];
  return names.length ? names.join(", ") : "-";
}

function table(rows: [string, Doc, string | undefined][], cardsCol: boolean): string {
  const head = cardsCol ? "| Code | Meaning | Cards |\n|---|---|---|" : "| Code | Meaning |\n|---|---|";
  return [head, ...rows.map(([, d, used]) => `| ${codes(d.forms)} | ${cell(d.text)} |${cardsCol ? ` ${used} |` : ""}`)].join("\n");
}

const opUsed = (cards: Card[], name: string) => usedBy(cards, (ab) => allCodes(ab).some((x) => parseCode(x).name === name));
const termsOf = (ab: Ability) => [...(ab.cond ?? []), ...allCodes(ab).map((x) => parseCode(x).named.if ?? "")].flatMap(condTerms);

export function vocabularyMarkdown(cards: Card[]): string {
  const ops = Object.entries(OPS).filter(([n]) => n !== "g-assist");
  const costs = ops.filter(([, o]) => o.canPay);
  const effects = ops.filter(([, o]) => !o.canPay);
  return [
    DOC_START,
    "",
    "## 1. Timing (events that trigger AUTO abilities)",
    "",
    table(Object.entries(TIMINGS).map(([n, d]) => [n, d, usedBy(cards, (ab) => timingsOf(ab).some((x) => parseCode(x).name === n))]), true),
    "",
    "## 2. Conditions",
    "",
    "Used in `cond` and in `if=`. A term is a named condition below, or a counter (section 3) compared with a number: `souled≥2`, `drop-count≤5`, `opp-vc-grade=2`. Terms joined with `&` must all hold. An unknown condition never holds.",
    "",
    table(Object.entries(PREDICATES).map(([n, d]) => [n, d, usedBy(cards, (ab) => termsOf(ab).some((t) => t === n || t.startsWith(`${n}(`)))]), true),
    "",
    "## 3. Counters",
    "",
    "Numbers a code can read: in a comparison (`G-faceup≥1`), as an amount (`n≤G-faceup+1`, `n=count-in-drop(…)`), or for \"for each\" (`+3000 per souled`, `+1000 per 2 drop` = one for every 2, `per=returned`). The tags souled, called, returned, charged, stood, and milled count what this ability's earlier steps did.",
    "",
    table(Object.entries(COUNTERS).map(([n, d]) => [n, d, undefined]), false),
    "",
    "## 4. Costs",
    "",
    "Codes that can be paid as a cost (the engine checks whether they can be paid before offering the ability).",
    "",
    table(costs.map(([n, d]) => [n, d, opUsed(cards, n)]), true),
    "",
    "## 5. Effects",
    "",
    table(effects.map(([n, d]) => [n, d, opUsed(cards, n)]), true),
    "",
    "In a CONT ability, `power`, `shield`, `critical`, `drive`, and `grade` apply for as long as the condition holds (targets that need no choice only).",
    "",
    "## 6. Targets",
    "",
    "Which units an effect acts on (the second argument of `power`, `grant`, `retire`, ...). `a & b` joins targets that need no choice; ` ≤n` after a target or an `n≤…` argument sets how many may be chosen.",
    "",
    table(Object.entries(SELECTORS).map(([n, d]) => [n, d, undefined]), false),
    "",
    "## 7. Filters",
    "",
    "`filter=a & b`: every term must match. A bare capitalized word is a clan name (`filter=Granblue`). Set rules apply to all chosen cards together.",
    "",
    table([
      ...Object.entries(FILTERS).map(([n, d]): [string, Doc, undefined] => [n, d, undefined]),
      ...Object.entries(SET_RULES).map(([n, r]): [string, Doc, undefined] => [n, { forms: [n], text: `${r.text} (set rule)` }, undefined]),
    ], false),
    "",
    "## 8. Parameters",
    "",
    "| Code | Meaning | Example |",
    "|---|---|---|",
    "| `if=condition` | The step happens only if the condition (section 2) holds when it resolves | `draw(1, if=souled≥1)` |",
    "| `until=` | How long a change lasts: `battle-end` or `turn-end` (the default) | `power(+2000, self, until=battle-end)` |",
    "| `at=` | This step and the ones after it wait for `battle-end` or `turn-end`, keeping what earlier steps did | `stand(own, filter=name(\"Regalia\"), at=battle-end)`, `drive(-3, stood)` |",
    "| `n≤k`, `n=k`, `n=a..b` | How many: up to k, exactly k, a to b (k may be a counter) | `to-soul(drop, n≤3)`, `call(drop→RC, n≤G-faceup+1)` |",
    "",
    DOC_END,
  ].join("\n");
}

// Replace the generated part of the document (or append it if it has none)
export function withGenerated(doc: string, generated: string): string {
  const a = doc.indexOf(DOC_START), b = doc.indexOf(DOC_END);
  if (a < 0 || b < 0) return `${doc.trimEnd()}\n\n${generated}\n`;
  return doc.slice(0, a) + generated + doc.slice(b + DOC_END.length);
}
