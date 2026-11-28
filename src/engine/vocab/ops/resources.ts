// Counter Blast / Charge, Soul Blast / Charge, the G zone, and binding: the resources abilities pay with or refill
import { msg } from "../../../i18n/msg";
import { intoUnitSoul, moveCard } from "../../zones";
import type { PlayerState } from "../../types";
import { askCards, matching, record, say, sourceAt } from "../ctx";
import type { Ctx, OpSpec } from "../types";

export const num = (t?: string) => parseInt((t ?? "1").replace(/[^\d]/g, ""), 10) || 0;
const me = (ctx: Ctx): PlayerState => ctx.s.players[ctx.owner];
// This ability's card as a rear-guard (RC soul codes only work there)
const rearGuard = (ctx: Ctx) => { const at = sourceAt(ctx); return at?.zone === "circle" && at.circle !== "vc" ? at.inst : undefined; };

function flipDamage(ps: PlayerState, n: number, toFaceUp: boolean) {
  let done = 0;
  for (const d of ps.damage) if (done < n && d.faceUp !== toFaceUp) { d.faceUp = toFaceUp; done++; }
}

export const RESOURCE_OPS: Record<string, OpSpec> = {
  CB: {
    forms: ["CB(#)"], text: "Counter Blast: turn face-up damage face down",
    canPay: (ctx) => me(ctx).damage.filter((d) => d.faceUp).length >= num(ctx.c.pos[0]),
    run: (ctx) => { flipDamage(me(ctx), num(ctx.c.pos[0]), false); say(ctx, "log.cb", { n: num(ctx.c.pos[0]) }); return true; },
  },
  CC: {
    forms: ["CC(#)"], text: "Counter Charge: turn face-down damage face up (the player picks which when there are more)",
    run: (ctx) => {
      const down = me(ctx).damage.filter((d) => !d.faceUp), n = Math.min(num(ctx.c.pos[0]), down.length);
      if (down.length > n && !ctx.r.answer?.uids) return askCards(ctx, msg("choice.cc", { n }), down, n, n);
      const picked = down.length > n ? down.filter((d) => ctx.r.answer!.uids!.includes(d.uid)) : down;
      for (const d of picked) d.faceUp = true;
      say(ctx, "log.cc", { n: picked.length });
      return true;
    },
  },
  "damage-facedown": {
    forms: ["damage-facedown(#)"], text: "Turn face-up damage face down (not as a cost)",
    run: (ctx) => { flipDamage(me(ctx), num(ctx.c.pos[0]), false); say(ctx, "log.damageFacedown"); return true; },
  },
  SB: {
    causes: (c) => [{ move: { from: "soul", to: "drop" }, who: "chosen", filter: c.named.filter }],
    forms: ["SB(#)", 'SB(#, filter=name("$"))'], text: "Soul Blast: put cards from the soul into the drop zone (filter= which ones)",
    canPay: (ctx) => matching(ctx, me(ctx).soul).length >= num(ctx.c.pos[0]),
    run: (ctx) => {
      const ps = me(ctx), n = num(ctx.c.pos[0]);
      const opts = matching(ctx, ps.soul);
      if (opts.length > n && !ctx.r.answer?.uids) return askCards(ctx, msg("choice.soulBlast", { n }), opts, n, n);
      const picked = opts.length > n ? ctx.r.answer!.uids!.map((u) => ps.soul.find((i) => i.uid === u)!) : opts;
      say(ctx, "log.sb", { n: picked.length });
      for (const inst of picked) moveCard(ctx.db, ctx.s, inst.uid, "drop");
      return true;
    },
  },
  SC: {
    causes: () => [{ move: { from: "deck", to: "soul" }, who: "chosen" }],
    forms: ["SC(#)"], text: "Soul Charge: put cards from the top of the deck into the soul",
    run: (ctx) => {
      const charged = me(ctx).deck.slice(0, num(ctx.c.pos[0])).map((i) => moveCard(ctx.db, ctx.s, i.uid, "soul"));
      record(ctx, "charged", charged);
      say(ctx, "log.sc", { n: num(ctx.c.pos[0]) });
      return true;
    },
  },
  // A rear-guard's own soul (cards under it)
  "RC-SB": {
    forms: ["RC-SB(#)"], text: "RC Soul Blast: put cards from the soul of this rear-guard into the drop zone",
    canPay: (ctx) => (rearGuard(ctx)?.soul?.length ?? 0) >= num(ctx.c.pos[0]),
    run: (ctx) => {
      const unit = rearGuard(ctx), n = num(ctx.c.pos[0]);
      const opts = unit?.soul ?? [];
      if (opts.length > n && !ctx.r.answer?.uids) return askCards(ctx, msg("choice.rcSoulBlast", { n }), opts, n, n);
      const picked = opts.length > n ? ctx.r.answer!.uids! : opts.slice(0, n).map((i) => i.uid);
      say(ctx, "log.rcSb", { n: picked.length });
      for (const u of picked) moveCard(ctx.db, ctx.s, u, "drop");
      return true;
    },
  },
  "RC-SC": {
    forms: ["RC-SC(#)"], text: "RC Soul Charge: put cards from the top of the deck into the soul of this rear-guard",
    run: (ctx) => {
      const unit = rearGuard(ctx);
      if (!unit) return true;
      const charged = me(ctx).deck.slice(0, num(ctx.c.pos[0])).map((i) => intoUnitSoul(ctx.db, ctx.s, i.uid, unit.uid));
      record(ctx, "charged", charged);
      say(ctx, "log.rcSc", { n: charged.length }, unit.uid);
      return true;
    },
  },
  "flip-G-up": {
    forms: ["flip-G-up(#, filter=same-name)", "flip-G-up(#, filter=G-GUARDIAN)"], text: "Turn a face-down card in our G zone face up",
    canPay: (ctx) => matching(ctx, me(ctx).gZone.filter((g) => !g.faceUp)).length > 0,
    run: (ctx) => {
      const ps = me(ctx);
      const opts = matching(ctx, ps.gZone.filter((g) => !g.faceUp));
      if (!opts.length) return true;
      if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.flipG"), opts, 1, 1);
      // Moved to the end so the face-up cards stay in the order they were used (shown that way next to the G zone)
      const g = ps.gZone.splice(ps.gZone.findIndex((x) => x.uid === ctx.r.answer!.uids![0]), 1)[0];
      g.faceUp = true;
      ps.gZone.push(g);
      say(ctx, "log.flipG", { card: ctx.db[g.key].name }, g.uid);
      return true;
    },
  },
  bind: {
    forms: ["bind(self)", "bind(self + 1 heal-trigger from drop)"], text: "Bind cards face up (this card, and another Heal trigger from the drop zone)",
    canPay: (ctx) => ctx.c.pos[0] === "self" || me(ctx).drop.some((d) => d.uid !== ctx.r.uid && ctx.db[d.key].trigger === "heal"),
    run: (ctx) => {
      const ps = me(ctx);
      if (!ctx.r.local.selfDone) {
        const at = sourceAt(ctx);
        if (at && at.zone !== "bind") { moveCard(ctx.db, ctx.s, ctx.r.uid, "bind"); say(ctx, "log.bind", { card: ctx.db[at.inst.key].name }, ctx.r.uid); }
        ctx.r.local.selfDone = 1;
      }
      if (ctx.c.pos[0] === "self") return true;
      const opts = ps.drop.filter((d) => ctx.db[d.key].trigger === "heal");
      if (!opts.length) return true;
      if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.bindHeal"), opts, 1, 1);
      const inst = moveCard(ctx.db, ctx.s, ctx.r.answer.uids[0], "bind");
      say(ctx, "log.bind", { card: ctx.db[inst.key].name }, inst.uid);
      return true;
    },
  },
};

