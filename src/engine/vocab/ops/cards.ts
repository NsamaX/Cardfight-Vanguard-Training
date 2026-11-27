// Moving cards between hand, deck, drop zone, and soul
import { msg } from "../../../i18n/msg";
import { emit } from "../../abilities";
import { shuffle as shuffleCards } from "../../rng";
import { drawCard, ev, pull, reset } from "../../state";
import type { CardInstance, PlayerState } from "../../types";
import { range } from "../counters";
import { askCards, checkChosen, matching, record, say, sourceAt } from "../ctx";
import type { Ctx, OpSpec } from "../types";
import { num } from "./resources";

const me = (ctx: Ctx): PlayerState => ctx.s.players[ctx.owner];
const cardName = (ctx: Ctx, i: CardInstance) => ctx.db[i.key].name;

function shuffleDeck(ctx: Ctx, log = true) {
  const ps = me(ctx);
  [ps.deck, ctx.s.rngState] = shuffleCards(ps.deck, ctx.s.rngState);
  if (log) say(ctx, "log.shuffle");
}

function intoSoul(ctx: Ctx, insts: CardInstance[]) {
  for (const inst of insts) { me(ctx).soul.push(reset(inst)); ev(ctx.out, "to-soul", ctx.owner, msg("log.soulIn", { card: cardName(ctx, inst) }), inst.uid); }
  record(ctx, "souled", insts);
  if (insts.length) emit(ctx.db, ctx.s, { kind: "to-soul", player: ctx.owner, n: insts.length });
}

// Zones a code names as a source, e.g. "drop+soul"
const zonesOf = (ctx: Ctx, spec: string) => spec.split("+").flatMap((z) => (z === "drop" || z === "soul" || z === "hand" ? me(ctx)[z] : []));

export const CARD_OPS: Record<string, OpSpec> = {
  draw: {
    forms: ["draw(#)"], text: "Draw cards",
    run: (ctx) => { for (let i = 0; i < num(ctx.c.pos[0]); i++) if (!drawCard(ctx.s, ctx.owner, ctx.out)) return true; return true; },
  },
  mill: {
    forms: ["mill(#)"], text: "Put cards from the top of the deck into the drop zone",
    canPay: (ctx) => me(ctx).deck.length >= num(ctx.c.pos[0]),
    run: (ctx) => {
      const ps = me(ctx), n = num(ctx.c.pos[0]);
      const milled = ps.deck.splice(0, n).map((i) => reset(i));
      ps.drop.push(...milled);
      record(ctx, "milled", milled);
      say(ctx, "log.mill", { n });
      return true;
    },
  },
  discard: {
    forms: ["discard(#)", "discard(#, filter=heal)", "discard(n, grade-sum≥3)"], text: "Discard cards from hand (filter= which ones)",
    canPay: (ctx) => matching(ctx, me(ctx).hand).length > 0,
    run: (ctx) => {
      const ps = me(ctx), opts = matching(ctx, ps.hand);
      const n = Math.min(num(ctx.c.pos[0]), opts.length);
      if (!n) return true;
      if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.discard", { n }), opts, n, n);
      for (const u of ctx.r.answer.uids) { const { inst } = pull(ctx.s, u); ps.drop.push(reset(inst)); say(ctx, "log.discard", { card: cardName(ctx, inst) }, u); }
      return true;
    },
  },
  reveal: {
    forms: ["reveal(#, filter=…)"], text: "Reveal cards from hand (they stay in hand)",
    canPay: (ctx) => matching(ctx, me(ctx).hand).length > 0,
    run: (ctx) => {
      const opts = matching(ctx, me(ctx).hand), n = Math.min(num(ctx.c.pos[0]), opts.length);
      if (!n) return true;
      if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.reveal", { n }), opts, n, n);
      for (const u of ctx.r.answer.uids) say(ctx, "log.reveal", { card: cardName(ctx, me(ctx).hand.find((h) => h.uid === u)!) }, u);
      return true;
    },
  },
  search: {
    forms: ["search(deck→hand, n≤#, filter=…)", "search(deck→drop, n≤#, filter=…)", "search(deck→hand, n≤#, filter=…, look=top-5)"],
    text: "Search the deck (or its top 5) for cards, put them into hand or the drop zone, then shuffle",
    run: (ctx) => {
      const ps = me(ctx), dst = ctx.c.pos[0].split("→")[1];
      const max = num(ctx.c.pos.find((x) => x.startsWith("n")) ?? "n≤1");
      const pool = matching(ctx, ctx.c.named.look === "top-5" ? ps.deck.slice(0, 5) : ps.deck);
      if (pool.length && !ctx.r.answer?.uids) return askCards(ctx, msg(dst === "hand" ? "choice.searchHand" : "choice.searchDrop", { n: max }), pool, 0, max);
      const found = (ctx.r.answer?.uids ?? []).map((u) => pull(ctx.s, u).inst);
      for (const inst of found) {
        (dst === "hand" ? ps.hand : ps.drop).push(reset(inst));
        say(ctx, dst === "hand" ? "log.searchHand" : "log.searchDrop", { card: cardName(ctx, inst) }, inst.uid);
      }
      if (dst === "drop") record(ctx, "milled", found);
      shuffleDeck(ctx);
      return true;
    },
  },
  // look(n, hand=1, soul=1 | soul=n≤1, rest=drop): look at the top n, pick some for hand, then for soul; the rest go to the drop zone (unset = stay on top)
  look: {
    forms: ["look(#, hand=1, soul=1, rest=drop)", "look(#, soul=n≤1, rest=drop)", "look(#, hand=1, soul=1)"],
    text: "Look at the top cards of the deck: some to hand, some to the soul, the rest to the drop zone",
    run: (ctx) => {
      const ps = me(ctx), r = ctx.r;
      if (r.local.looked === undefined) {
        const top = ps.deck.slice(0, num(ctx.c.pos[0]));
        if (!top.length) return true;
        r.local.looked = top.map((i) => i.uid).join(",");
        say(ctx, "log.lookTop", { n: top.length });
      }
      const left = () => String(r.local.looked).split(",").map((u) => ps.deck.find((d) => d.uid === u)).filter((i): i is CardInstance => !!i);
      const steps = (["hand", "soul"] as const).filter((d) => ctx.c.named[d] !== undefined);
      for (let i = Number(r.local.lookStep ?? 0); i < steps.length; i = Number(r.local.lookStep)) {
        const dest = steps[i], want = ctx.c.named[dest], opts = left();
        const max = Math.min(num(want), opts.length);
        if (max && !r.answer?.uids) return askCards(ctx, msg(dest === "hand" ? "choice.lookHand" : "choice.lookSoul", { n: max }), opts, want.startsWith("n≤") ? 0 : max, max);
        const picked = (r.answer?.uids ?? []).map((u) => pull(ctx.s, u).inst);
        r.answer = undefined;
        r.local.lookStep = i + 1;
        if (dest === "hand") for (const inst of picked) { ps.hand.push(reset(inst)); say(ctx, "log.searchHand", { card: cardName(ctx, inst) }, inst.uid); }
        else intoSoul(ctx, picked);
      }
      if (ctx.c.named.rest === "drop") for (const inst of left()) { pull(ctx.s, inst.uid); ps.drop.push(reset(inst)); say(ctx, "log.searchDrop", { card: cardName(ctx, inst) }, inst.uid); }
      return true;
    },
  },
  // to-soul(drop, n≤3 | n=1 | all, filter=…) / to-soul(self)
  "to-soul": {
    forms: ["to-soul(drop, n≤#, filter=…)", "to-soul(drop, n=#, filter=…)", "to-soul(drop, all, filter=…)", "to-soul(self)"],
    text: "Put cards from the drop zone (or this unit) into the soul (filter different-grades = all chosen differ in grade)",
    run: (ctx) => {
      if (ctx.c.pos[0] === "self") {
        const at = sourceAt(ctx);
        if (at?.zone === "circle") intoSoul(ctx, [pull(ctx.s, ctx.r.uid).inst]);
        return true;
      }
      const pool = matching(ctx, zonesOf(ctx, ctx.c.pos[0]));
      const amount = ctx.c.pos[1] ?? "all";
      let uids: string[];
      if (amount === "all") uids = pool.map((i) => i.uid);
      else {
        if (!pool.length) return true;
        const { min, max } = range(ctx, amount, "n≤1");
        const top = Math.min(max, pool.length);
        if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.toSoul", { n: top }), pool, Math.min(min, top), top);
        uids = ctx.r.answer.uids;
        checkChosen(ctx, uids);
      }
      intoSoul(ctx, uids.map((u) => pull(ctx.s, u).inst));
      return true;
    },
  },
  "soul-in": {
    forms: ["soul-in(self)"], text: "Put this unit into the soul (usually a cost)",
    canPay: (ctx) => sourceAt(ctx)?.zone === "circle",
    run: (ctx) => {
      const at = sourceAt(ctx);
      if (at?.zone !== "circle") return true;
      pull(ctx.s, ctx.r.uid);
      me(ctx).soul.push(reset(at.inst));
      say(ctx, "log.soulIn", { card: cardName(ctx, at.inst) }, ctx.r.uid);
      emit(ctx.db, ctx.s, { kind: "to-soul", player: ctx.owner, n: 1 });
      return true;
    },
  },
  // to-deck(drop, all) / to-deck(drop+soul, n=2..3, filter=…): return cards to the deck (shuffle with a separate shuffle(deck))
  "to-deck": {
    forms: ["to-deck(drop, all)", "to-deck(drop+soul, n=#..#, filter=…)"], text: "Return cards to the deck (filter same-grade = all chosen share a grade)",
    run: (ctx) => {
      const ps = me(ctx);
      const pool = matching(ctx, zonesOf(ctx, ctx.c.pos[0]));
      const amount = ctx.c.pos[1] ?? "all";
      let uids: string[];
      if (amount === "all") uids = pool.map((i) => i.uid);
      else {
        const { min, max } = range(ctx, amount, "n≤1");
        if (pool.length < Math.max(min, 1)) return true;
        if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.toDeck", { n: max }), pool, min, Math.min(max, pool.length));
        uids = ctx.r.answer.uids;
        checkChosen(ctx, uids);
      }
      const moved = uids.map((u) => pull(ctx.s, u).inst);
      for (const inst of moved) { ps.deck.push(reset(inst, false)); say(ctx, "log.returnToDeck", { card: cardName(ctx, inst) }, inst.uid); }
      record(ctx, "returned", moved);
      return true;
    },
  },
  "to-deck-top": {
    forms: ["to-deck-top(self)"], text: "Put this unit on the top of the deck",
    run: (ctx) => {
      const at = sourceAt(ctx);
      if (at?.zone === "circle") { pull(ctx.s, ctx.r.uid); me(ctx).deck.unshift(reset(at.inst, false)); say(ctx, "log.toDeckTop", { card: cardName(ctx, at.inst) }, ctx.r.uid); }
      return true;
    },
  },
  "return-to-deck": {
    forms: ["return-to-deck(self)"], text: "Shuffle this card into the deck",
    run: (ctx) => {
      const at = sourceAt(ctx);
      if (at) { pull(ctx.s, ctx.r.uid); me(ctx).deck.push(reset(at.inst, false)); shuffleDeck(ctx, false); say(ctx, "log.returnToDeck", { card: cardName(ctx, at.inst) }, ctx.r.uid); }
      return true;
    },
  },
  "to-hand": {
    forms: ["to-hand(drop, n≤#, filter=…)"], text: "Return cards from the drop zone to hand",
    run: (ctx) => {
      const ps = me(ctx), opts = matching(ctx, ps.drop);
      if (!opts.length) return true;
      const { min, max } = range(ctx, ctx.c.pos[1], "n≤1");
      const top = Math.min(max, opts.length);
      if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.toHand", { n: max }), opts, Math.min(min, top), top);
      for (const u of ctx.r.answer.uids) { const { inst } = pull(ctx.s, u); ps.hand.push(reset(inst)); say(ctx, "log.toHand", { card: cardName(ctx, inst) }, u); }
      return true;
    },
  },
  shuffle: { forms: ["shuffle(deck)"], text: "Shuffle the deck", run: (ctx) => { shuffleDeck(ctx); return true; } },
};
