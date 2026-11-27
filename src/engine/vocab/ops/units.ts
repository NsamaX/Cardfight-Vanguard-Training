// Units on the board: call, retire, stand, swap, hollow, can't be hit
import { msg } from "../../../i18n/msg";
import { emit } from "../../abilities";
import { RC, SAME_COLUMN, isG, other } from "../../rules";
import { circleOf, ev, locate, pull, reset } from "../../state";
import type { CardInstance, Circle, PlayerState } from "../../types";
import { placeOnRC, retireUnit } from "../../zones";
import { amount, range } from "../counters";
import { ask, askCards, checkChosen, matching, record, say, sourceAt } from "../ctx";
import { isChoice, pickUnits } from "../selectors";
import { parseCode } from "../../code";
import type { Ctx, OpSpec } from "../types";
import { num } from "./resources";

const me = (ctx: Ctx): PlayerState => ctx.s.players[ctx.owner];
const rcUnits = (ctx: Ctx, p = ctx.owner) => RC.map((c) => ctx.s.players[p].circles[c]).filter((i): i is CardInstance => !!i);
const why = (ctx: Ctx) => (ctx.r.carry?.at === "turn-end" ? msg("reason.turnEnd") : msg("reason.effect", { label: ctx.r.label }));

function circleOptions(ctx: Ctx, to?: string): Circle[] {
  const ps = me(ctx), self = circleOf(ctx.s, ctx.owner, ctx.r.uid);
  if (to === "empty") return RC.filter((c) => !ps.circles[c]);
  if (to === "different") return RC.filter((c) => !ctx.r.usedCircles.includes(c));
  if (to === "not-self") return RC.filter((c) => c !== self);
  if (to === "same-column") {
    if (self === "vc") return ["back_center"];
    const pair = self && SAME_COLUMN[self];
    return pair ? [pair] : [];
  }
  return RC;
}

// call(drop→RC, n≤1, filter={filter}, to=…) / call(hand+drop→RC, …) / call(drop→GC, n≤2, filter=different-grades) / call(self→RC) (starter from the soul)
function runCall(ctx: Ctx): boolean {
  const [src, dst] = ctx.c.pos[0].split("→");
  const ps = me(ctx), r = ctx.r;
  if (src === "G") return true;   // a G guardian calling itself: done by the rules (game.ts)

  if (src === "self") {
    const at = sourceAt(ctx);
    if (at?.zone !== "soul") return true;
    if (!r.answer) return ask(ctx, { kind: "circle", prompt: msg("choice.callSelf", { card: ctx.db[at.inst.key].name }), side: ctx.owner, options: RC });
    if (r.answer.to) { pull(ctx.s, r.uid); placeOnRC(ctx.db, ctx.s, ctx.owner, at.inst, r.answer.to, "soul", ctx.out); }
    return true;
  }

  const { min, max } = range(ctx, ctx.c.pos.find((x) => x.startsWith("n≤")) ?? (ctx.c.named.n ? `n=${ctx.c.named.n}` : "1"), "1");
  const called = (r.done.called ?? []).map((d) => d.uid);
  const pool = () => matching(ctx, [...(src.includes("hand") ? ps.hand : []), ...(src.includes("drop") ? ps.drop : [])])
    .filter((i) => !isG(ctx.db[i.key]) && !called.includes(i.uid));

  if (dst === "GC") {
    if (!r.answer?.uids) {
      const opts = pool();
      if (!opts.length) return true;
      return askCards(ctx, msg("choice.callToGC", { n: max }), opts, 0, max);
    }
    checkChosen(ctx, r.answer.uids);
    for (const u of r.answer.uids) {
      const { inst } = pull(ctx.s, u);
      ps.guardian.push(reset(inst));
      ev(ctx.out, "call", ctx.owner, msg("log.callGC", { card: ctx.db[inst.key].name }), u);
      emit(ctx.db, ctx.s, { kind: "enter", player: ctx.owner, uid: u, zone: "GC", from: "drop" });
    }
    return true;
  }

  // One card at a time: pick a card, then its circle
  for (;;) {
    const count = Number(r.local.count ?? 0);
    if (count >= max) return true;
    if (!r.local.card) {
      if (r.answer?.uids) {
        const picked = r.answer.uids[0];
        r.answer = undefined;
        if (!picked) return true;
        r.local.card = picked;
      } else {
        const opts = pool().filter((i) => !(r.done.called ?? []).some((d) => d.uid === i.uid));
        if (!opts.length) return true;
        return askCards(ctx, msg("choice.callPick", { i: count + 1, max }), opts, count < min ? 1 : 0, 1);
      }
    }
    const circles = circleOptions(ctx, ctx.c.named.to);
    if (!circles.length) { r.local.card = undefined; return true; }
    if (!r.answer?.to) {
      if (r.answer) { r.local.card = undefined; return true; }   // no circle chosen = stop calling
      const inst = locate(ctx.s, String(r.local.card))!.inst;
      return ask(ctx, { kind: "circle", prompt: msg("choice.callCircle", { card: ctx.db[inst.key].name }), side: ctx.owner, options: circles });
    }
    const to = r.answer.to;
    r.answer = undefined;
    const { inst, zone } = pull(ctx.s, String(r.local.card));
    placeOnRC(ctx.db, ctx.s, ctx.owner, inst, to, zone, ctx.out);
    record(ctx, "called", [inst]);
    r.usedCircles.push(to);
    r.local.card = undefined;
    r.local.count = count + 1;
  }
}

export const UNIT_OPS: Record<string, OpSpec> = {
  call: {
    forms: ["call(drop→RC, n≤#, filter={filter})", "call(hand+drop→RC, n≤#, filter={filter}, to=empty)", "call(drop→RC, n=#, filter=that-card)", "call(drop→GC, n≤#, filter=different-grades)", "call(self→RC)", "call(G→GC, self)"],
    text: "Call cards to rear-guard circles (to= empty / different / not-self / same-column) or to the guardian circle",
    run: runCall,
  },
  // retire(opp-RC, n≤1) / retire(own, target=boosted) / retire(own, target=called): the target= selector wins over the first argument
  retire: {
    forms: ["retire({target})", "retire(opp-RC, n≤#)", "retire(own, target=boosted)", "retire(own, target=called, at=turn-end)"], text: "Retire units",
    run: (ctx) => {
      const who = ctx.c.named.target ?? ctx.c.pos[0];
      const opp = who.startsWith("opp");
      const uids = pickUnits(ctx, { who, n: ctx.c.pos[1], upTo: true, prompt: () => msg("choice.retireOpp") });
      if (uids === false) return false;
      for (const u of uids) {
        const l = locate(ctx.s, u);
        if (l?.zone === "circle" && l.circle !== "vc") retireUnit(ctx.db, ctx.s, l.player, l.circle!, ctx.out, opp ? msg("reason.effect", { label: ctx.r.label }) : why(ctx));
      }
      return true;
    },
  },
  "retire-own": {
    forms: ["retire-own(#)"], text: "Retire our own rear-guards (usually a cost)",
    canPay: (ctx) => rcUnits(ctx).filter((u) => u.uid !== ctx.r.uid).length >= num(ctx.c.pos[0]),
    run: (ctx) => {
      const opts = rcUnits(ctx).filter((u) => u.uid !== ctx.r.uid);
      if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.retireOwn"), opts, 1, 1);
      retireUnit(ctx.db, ctx.s, ctx.owner, circleOf(ctx.s, ctx.owner, ctx.r.answer.uids[0])!, ctx.out, msg("reason.cost"));
      return true;
    },
  },
  // opp-retires(opp-RC, n=soul-charged(filter)): the opponent chooses that many of their rear-guards and retires them
  "opp-retires": {
    forms: ["opp-retires(opp-RC, n=#)", "opp-retires(opp-RC, n=soul-charged(filter))"], text: "The opponent chooses and retires that many of their own rear-guards",
    run: (ctx) => {
      const n = amount(ctx, (ctx.c.named.n ?? "1"));
      const uids = pickUnits(ctx, { who: "opp-RC", n: `n=${n}`, by: "opp", prompt: (k) => msg("choice.oppRetires", { n: k }) });
      if (uids === false) return false;
      const opp = other(ctx.owner);
      for (const u of uids) retireUnit(ctx.db, ctx.s, opp, circleOf(ctx.s, opp, u)!, ctx.out, msg("reason.effect", { label: ctx.r.label }));
      return true;
    },
  },
  // stand(own, filter={filter}): stand our matching units; they're remembered as "stood" for later steps (e.g. drive(-3, stood))
  stand: {
    forms: ["stand(own, filter={filter})", "stand(own, filter={filter}, at=battle-end)"], text: "Stand units",
    run: (ctx) => {
      const uids = pickUnits(ctx, { who: ctx.c.pos[0], filter: ctx.c.named.filter });
      if (uids === false) return false;
      const units = uids.map((u) => locate(ctx.s, u)!.inst);
      for (const u of units) {
        if (u.rested) { u.rested = false; say(ctx, "log.stand", { card: ctx.db[u.key].name }, u.uid); }
      }
      record(ctx, "stood", units);
      return true;
    },
  },
  swap: {
    forms: ["swap(self, other-own-RC)"], text: "Switch this rear-guard with another of our rear-guards (may skip)",
    run: (ctx) => {
      const ps = me(ctx), sc = circleOf(ctx.s, ctx.owner, ctx.r.uid);
      if (!sc || sc === "vc") return true;
      const opts = rcUnits(ctx).filter((u) => u.uid !== ctx.r.uid);
      if (!opts.length) return true;
      if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.swap"), opts, 0, 1);
      const u = ctx.r.answer.uids[0];
      if (u) { const oc = circleOf(ctx.s, ctx.owner, u)!; const a = ps.circles[sc]!, b = ps.circles[oc]!; ps.circles[sc] = b; ps.circles[oc] = a; say(ctx, "log.swap"); }
      return true;
    },
  },
  hollow: {
    forms: ["hollow(self)", "hollow(called)"], text: "Hollow: the unit is retired at the end of the turn (the player may choose not to hollow itself)",
    run: (ctx) => {
      if (ctx.c.pos[0] === "called") {
        for (const d of ctx.r.done.called ?? []) { const i = locate(ctx.s, d.uid); if (i?.zone === "circle") i.inst.hollowed = true; }
        return true;
      }
      const at = sourceAt(ctx);
      if (at?.zone !== "circle") return true;
      if (!ctx.r.confirmed && !ctx.r.answer?.option) return ask(ctx, { kind: "yesno", prompt: msg("choice.hollow", { card: ctx.db[at.inst.key].name }) });
      if (ctx.r.confirmed || ctx.r.answer?.option === "yes") { at.inst.hollowed = true; say(ctx, "log.hollow", { card: ctx.db[at.inst.key].name }, ctx.r.uid); }
      return true;
    },
  },
  // no-hit(own-attacked, filter={filter}): "choose one of your units with …": only the attacked unit matters, so it must match
  "no-hit": {
    forms: ["no-hit(own-attacked, until=battle-end)", "no-hit(own-attacked, filter={filter}, until=battle-end)", "no-hit(own-VC-attacked, until=battle-end)"],
    text: "Our attacked unit can't be hit this battle",
    run: (ctx) => {
      const uids = pickUnits(ctx, { who: ctx.c.pos[0], filter: ctx.c.named.filter });
      if (uids === false) return false;
      if (ctx.s.battle && uids.length) { ctx.s.battle.noHit = true; say(ctx, "log.noHitEffect"); }
      return true;
    },
  },
};


// Units a delayed step will remove from the field (e.g. retire the called units at the end of the turn), so the bot values them low meanwhile
export function willLeave(ctx: Omit<Ctx, "c">, code: string): string[] {
  const c = parseCode(code);
  if (c.name !== "retire") return [];
  const who = c.named.target ?? c.pos[0];
  if (isChoice(who)) return [];
  const uids = pickUnits({ ...ctx, c }, { who });
  return uids === false ? [] : uids;
}
