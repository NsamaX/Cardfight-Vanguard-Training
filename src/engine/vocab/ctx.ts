// Helpers every op uses: log a line, ask the player, filter cards for this ability, remember what a step did
import { msg, type Msg, type MsgKey } from "../../i18n/msg";
import { ev, locate } from "../state";
import type { CardInstance, Choice, PlayerId } from "../types";
import { cardMatches, checkSet } from "./filters";
import type { Ctx } from "./types";

export const say = (ctx: Ctx, key: MsgKey, params?: Record<string, string | number | Msg>, uid?: string) =>
  ev(ctx.out, ctx.c.name, ctx.owner, msg(key, params), uid);

export function ask(ctx: Ctx, choice: Choice): false {
  ctx.r.choice = choice;
  return false;
}

// bonus: what the chosen unit will get (the screen shows it in advance when choosing on the board); by: the opponent answers
export const askCards = (ctx: Ctx, prompt: Msg, options: CardInstance[], min: number, max: number,
  extra?: { bonus?: { stat: "power" | "shield" | "critical"; value: number }; by?: PlayerId }) =>
  ask(ctx, { kind: "cards", prompt, options: options.map((i) => i.uid), min, max, ...extra });

export const sourceAt = (ctx: Ctx) => locate(ctx.s, ctx.r.uid);

const eventUid = (e?: Ctx["r"]["event"]) => (e && "uid" in e ? e.uid : undefined);
export const thatCards = (ctx: Ctx) => ctx.r.thatCards ?? [eventUid(ctx.r.event)].filter((u): u is string => !!u);

// Cards in a list that pass this step's filter (filter= by default)
export function matching(ctx: Ctx, list: CardInstance[], flt = ctx.c.named.filter ?? ""): CardInstance[] {
  const source = sourceAt(ctx)?.inst ?? ctx.source;
  const env = { db: ctx.db, source: source && ctx.db[source.key], sourceKey: source?.key, thatUids: thatCards(ctx) };
  return list.filter((i) => cardMatches(ctx.db[i.key], flt, { ...env, uid: i.uid }));
}

// The chosen cards also have to satisfy set rules in the filter (different-grades, same-grade, ...)
export function checkChosen(ctx: Ctx, uids: string[], flt = ctx.c.named.filter ?? "") {
  checkSet(uids.map((u) => ctx.db[locate(ctx.s, u)!.inst.key]), flt);
}

// Remember the cards a step acted on under a tag, for later steps (souled≥2, per souled, called, stood, ...)
export function record(ctx: Ctx, tag: string, insts: CardInstance[]) {
  (ctx.r.done[tag] ??= []).push(...insts.map((i) => ({ uid: i.uid, key: i.key })));
}
