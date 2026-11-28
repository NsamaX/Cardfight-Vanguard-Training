// Selectors: which units an effect acts on, e.g. self, own-VC, other-own (choose), front-row ≤3, called, opp-RC.
// "a & b" joins selectors that need no choice; a trailing " ≤n" sets how many may be chosen.
import { msg, type Msg } from "../../i18n/msg";
import { RC, other } from "../rules";
import { fieldUnits, locate } from "../state";
import type { CardInstance, Circle } from "../types";
import { range } from "./counters";
import { askCards, matching, sourceAt } from "./ctx";
import type { Ctx, Doc } from "./types";

interface SelectorSpec extends Doc {
  pool(ctx: Ctx): CardInstance[];
  choose?: string;            // the player picks; the default range (e.g. n≤1). Unset = every unit in the pool
}

const own = (ctx: Ctx) => ctx.s.players[ctx.owner];
const at = (ctx: Ctx, uid: string) => locate(ctx.s, uid);
const onField = (ctx: Ctx, uids: string[]) => uids.map((u) => at(ctx, u)).filter((l) => l?.zone === "circle").map((l) => l!.inst);
const rcUnits = (ctx: Ctx, p = ctx.owner) => RC.map((c) => ctx.s.players[p].circles[c]).filter((i): i is CardInstance => !!i);
const doneOnField = (tag: string) => (ctx: Ctx) => onField(ctx, (ctx.r.done[tag] ?? []).map((d) => d.uid));
const attackedOwn = (ctx: Ctx) => {
  const b = ctx.s.battle;
  return b && ctx.s.turnPlayer !== ctx.owner ? own(ctx).circles[b.target] : undefined;
};

export const SELECTORS: Record<string, SelectorSpec> = {
  self: {
    forms: ["self"], text: "This card (on a circle or the guardian circle)",
    pool: (ctx) => { const l = sourceAt(ctx); return l && (l.zone === "circle" || l.zone === "guardian") ? [l.inst] : []; },
  },
  "own-VC": { forms: ["own-VC"], text: "Our vanguard", pool: (ctx) => [own(ctx).circles.vc].filter((i): i is CardInstance => !!i) },
  own: { forms: ["own"], text: "All our units", pool: (ctx) => fieldUnits(own(ctx)) },
  "own-RC": { forms: ["own-RC"], text: "All our rear-guards", pool: (ctx) => rcUnits(ctx) },
  "other-own": { forms: ["other-own, n≤#"], text: "Our units other than this card (choose)", choose: "n≤1", pool: (ctx) => fieldUnits(own(ctx)).filter((u) => u.uid !== ctx.r.uid) },
  "own-unit": { forms: ["own-unit"], text: "One of our units (choose)", choose: "n=1", pool: (ctx) => fieldUnits(own(ctx)) },
  "own-units": { forms: ["own-units, n=count-in-drop({filter})"], text: "Our units (choose)", choose: "n≤1", pool: (ctx) => fieldUnits(own(ctx)) },
  "other-own-RC": { forms: ["other-own-RC"], text: "Our rear-guards other than this card (choose)", choose: "n≤1", pool: (ctx) => rcUnits(ctx).filter((u) => u.uid !== ctx.r.uid) },
  "front-row": { forms: ["front-row ≤#"], text: "Units in our front row (choose)", choose: "n≤3", pool: (ctx) => (["vc", "front_left", "front_right"] as Circle[]).map((c) => own(ctx).circles[c]).filter((i): i is CardInstance => !!i) },
  "opp-RC": { forms: ["opp-RC, n≤#"], text: "The opponent's rear-guards (choose)", choose: "n≤1", pool: (ctx) => rcUnits(ctx, other(ctx.owner)) },
  "own-attacked": { forms: ["own-attacked"], text: "Our unit being attacked", pool: (ctx) => [attackedOwn(ctx)].filter((i): i is CardInstance => !!i) },
  "own-VC-attacked": { forms: ["own-VC-attacked"], text: "Our vanguard, if it's being attacked", pool: (ctx) => { const u = attackedOwn(ctx); return u && u === own(ctx).circles.vc ? [u] : []; } },
  boosted: {
    forms: ["boosted"], text: "The unit this card boosted (at the end of that battle)",
    pool: (ctx) => { const e = ctx.r.event; return e?.kind === "battle-end" ? onField(ctx, [e.attackerUid]) : []; },
  },
  called: { forms: ["called"], text: "The units this ability called", pool: doneOnField("called") },
  stood: { forms: ["stood"], text: "The units this ability stood", pool: doneOnField("stood") },
};

// "front-row ≤3" → ["front-row", "n≤3"]
function split(term: string): [string, string | undefined] {
  const m = term.trim().match(/^(\S+)\s+(≤\d+)$/);
  return m ? [m[1], "n" + m[2]] : [term.trim(), undefined];
}

export const selectorTerms = (who: string) => who.split("&").map((t) => split(t)[0]);
export const unknownSelectors = (who: string) => selectorTerms(who).filter((t) => !SELECTORS[t]);
export const isChoice = (who: string) => selectorTerms(who).some((t) => SELECTORS[t]?.choose);

export interface Pick {
  who: string;                 // selector, e.g. "other-own" or "own-VC & self"
  n?: string;                  // how many may be chosen (overrides the selector's default)
  filter?: string;
  prompt?: (n: number) => Msg;
  bonus?: { stat: "power" | "shield" | "critical"; value: number };
  by?: "opp";                  // the opponent chooses
  upTo?: boolean;              // the player may choose fewer (down to none)
}

// The units the effect acts on; false = asked the player (run the step again with the answer)
export function pickUnits(ctx: Ctx, p: Pick): string[] | false {
  const terms = p.who.split("&").map(split);
  const chosen = terms.find(([t]) => SELECTORS[t]?.choose);
  if (!chosen) {
    const all = terms.flatMap(([t]) => SELECTORS[t]?.pool(ctx) ?? []);
    return [...new Set(matching(ctx, all, p.filter ?? "").map((i) => i.uid))];
  }
  if (ctx.r.answer?.uids) return ctx.r.answer.uids;
  const spec = SELECTORS[chosen[0]];
  const opts = matching(ctx, spec.pool(ctx), p.filter ?? "");
  const { min, max } = range(ctx, p.n ?? chosen[1], spec.choose!);
  const top = Math.min(max, opts.length);
  if (!top) return [];
  const prompt = p.prompt?.(top) ?? msg("choice.grant", { n: top });
  askCards(ctx, prompt, opts, p.upTo ? 0 : Math.min(min, top), top, { bonus: p.bonus, by: p.by ? other(ctx.owner) : undefined });
  return false;
}
