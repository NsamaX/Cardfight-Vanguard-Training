// The ability vocabulary in one place: every code a card file may use, how it runs, and a validator that reports codes the engine doesn't know.
// To support a new card text: add the code to the matching registry (ops/*, timings, conditions, counters, selectors, filters),
// document it in its forms/text, and the editor and the validator pick it up.
import { parseCode, type Code } from "../code";
import type { Ability, Card } from "../types";
import { condsHold, unknownCondTerms } from "./conditions";
import { knownAmount, knownRange } from "./counters";
import { unknownFilterTerms } from "./filters";
import { CARD_OPS } from "./ops/cards";
import { META_OPS, grantedAbility } from "./ops/meta";
import { RESOURCE_OPS } from "./ops/resources";
import { STAT_OPS } from "./ops/stats";
import { UNIT_OPS } from "./ops/units";
import { unknownSelectors } from "./selectors";
import { TIMINGS } from "./timings";
import type { Ctx, OpSpec } from "./types";

export const OPS: Record<string, OpSpec> = { ...RESOURCE_OPS, ...CARD_OPS, ...UNIT_OPS, ...STAT_OPS, ...META_OPS };

// Codes that only restate a rule the engine already applies (Hollow: retired at the end of the turn)
const RULE_RESTATEMENTS = [/^retire\(self, at=turn-end, if=self-hollowed\)$/];
const DELAY_POINTS = ["battle-end", "turn-end"] as const;

export const isRestatement = (code: string) => RULE_RESTATEMENTS.some((re) => re.test(code));
export const isPassive = (code: string) => isRestatement(code) || !!OPS[parseCode(code).name]?.passive;

// at=battle-end / at=turn-end: this step and the ones after it wait for that moment
export function delayOf(code: string): (typeof DELAY_POINTS)[number] | undefined {
  const at = parseCode(code).named.at;
  return DELAY_POINTS.find((p) => p === at);
}

export const withoutDelay = (code: string) => code.replace(/, at=(battle-end|turn-end)(?=[,)])/, "");

// Run one step: skip it when its if= doesn't hold; true = done, false = waiting for an answer
export function runCode(ctx: Omit<Ctx, "c"> | Ctx, code: string): boolean {
  const c = parseCode(code);
  const step: Ctx = { ...ctx, c };
  if (c.named.if && !condsHold(step, [c.named.if], "resolve")) return true;
  const spec = OPS[c.name];
  if (!spec) throw new Error(`unknown ability code: ${code}`);
  return spec.run(step);
}

export function canPayCode(ctx: Omit<Ctx, "c">, code: string): boolean {
  const c = parseCode(code);
  return OPS[c.name]?.canPay?.({ ...ctx, c }) ?? true;
}

// ---------- Validation ----------

// Which argument of an op is a selector (the units it acts on)
const SELECTOR_ARG: Record<string, (c: Code) => string | undefined> = {
  power: (c) => c.pos[1], shield: (c) => c.pos[1], critical: (c) => c.pos[1], drive: (c) => c.pos[1],
  grant: (c) => c.pos[1], stand: (c) => c.pos[0], "no-hit": (c) => c.pos[0],
  retire: (c) => c.named.target ?? c.pos[0],
};

function checkCode(code: string, where: string, out: string[]) {
  if (isRestatement(code)) return;
  const c = parseCode(code);
  if (!OPS[c.name]) { out.push(`${where}: unknown code ${c.name} in ${code}`); return; }
  const bad = (what: string) => out.push(`${where}: unknown ${what} in ${code}`);
  if (c.named.filter) for (const t of unknownFilterTerms(c.named.filter)) bad(`filter ${t}`);
  if (c.named.if) for (const t of unknownCondTerms(c.named.if)) bad(`condition ${t}`);
  if (c.named.per && !knownAmount(c.named.per)) bad(`amount ${c.named.per}`);
  const sel = SELECTOR_ARG[c.name]?.(c);
  if (sel) for (const t of unknownSelectors(sel)) bad(`target ${t}`);
  const n = c.pos.find((x) => /^n[≤=]/.test(x)) ?? (c.named.n !== undefined ? `n=${c.named.n}` : undefined);
  if (n && !knownRange(n)) bad(`amount ${n}`);
  const per = c.pos[0]?.match(/ per (.+)$/);
  if (per && !knownAmount(per[1])) bad(`amount ${per[1]}`);
  if (c.name === "choose") for (const o of c.pos) checkCode(o, where, out);
  if (c.name === "grant") {
    const ab = grantedAbility(c.pos[0]);
    if (!ab) bad("granted ability");
    else checkAbility(ab, `${where} (granted)`, out);
  }
}

// A CONT effect works when its op has a continuous form (cont) or no in-game effect
const contOk = (code: string) => { const spec = OPS[parseCode(code).name]; return !spec || !!spec.cont || !!spec.passive; };

function checkAbility(ab: Ability, where: string, out: string[]) {
  if (ab.kind === "CONT") for (const e of ab.effect.filter((x) => !contOk(x))) out.push(`${where}: ${parseCode(e).name} can't be used in a CONT ability`);
  if (ab.timing) {
    const t = parseCode(ab.timing);
    if (!TIMINGS[t.name]) out.push(`${where}: unknown timing ${ab.timing}`);
    else if (t.named.filter) for (const term of unknownFilterTerms(t.named.filter)) out.push(`${where}: unknown filter ${term} in ${ab.timing}`);
  }
  for (const c of ab.cond ?? []) for (const t of unknownCondTerms(c)) out.push(`${where}: unknown condition ${t}`);
  for (const code of [...(ab.cost ?? []), ...ab.effect]) checkCode(code, where, out);
}

// Problems with a card's ability codes (empty = the engine runs every ability as written)
export function validateCard(card: Card): string[] {
  const out: string[] = [];
  card.abilities.forEach((ab, i) => checkAbility(ab, `${card.name} #${i + 1} ${ab.kind}`, out));
  return out;
}

