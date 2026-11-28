// Moving cards between hand, deck, drop zone, and soul
import { msg } from "../../../i18n/msg";
import { shuffle as shuffleCards } from "../../rng";
import { ev } from "../../state";
import { drawCard, moveCard } from "../../zones";
import type { CardInstance, PlayerState } from "../../types";
import { range } from "../counters";
import { ask, askCards, checkChosen, matching, record, say, sourceAt } from "../ctx";
import type { Ctx, OpSpec } from "../types";
import { num } from "./resources";

const me = (ctx: Ctx): PlayerState => ctx.s.players[ctx.owner];
const cardName = (ctx: Ctx, i: CardInstance) => ctx.db[i.key].name;

function shuffleDeck(ctx: Ctx, log = true) {
  const ps = me(ctx);
  [ps.deck, ctx.s.rngState] = shuffleCards(ps.deck, ctx.s.rngState);
  if (log) say(ctx, "log.shuffle");
}

function intoSoul(ctx: Ctx, uids: string[]) {
  const insts = uids.map((u) => {
    const inst = moveCard(ctx.db, ctx.s, u, "soul");
    ev(ctx.out, "to-soul", ctx.owner, msg("log.soulIn", { card: cardName(ctx, inst) }), inst.uid);
    return inst;
  });
  record(ctx, "souled", insts);
}

// Zones a code names as a source, e.g. "drop+soul"
const zonesOf = (ctx: Ctx, spec: string) => spec.split("+").flatMap((z) => (z === "drop" || z === "soul" || z === "hand" ? me(ctx)[z] : []));

export const CARD_OPS: Record<string, OpSpec> = {
  draw: {
    forms: ["draw(#)"], text: "Draw cards",
    run: (ctx) => { for (let i = 0; i < num(ctx.c.pos[0]); i++) if (!drawCard(ctx.db, ctx.s, ctx.owner, ctx.out)) return true; return true; },
  },
  // mill(3) / mill(≤3): "up to" lets the player choose how many
  mill: {
    causes: () => [{ move: { from: "deck", to: "drop" }, who: "chosen" }],
    forms: ["mill(#)", "mill(≤#)"], text: "Put cards from the top of the deck into the drop zone (≤n: the player chooses up to n)",
    canPay: (ctx) => me(ctx).deck.length >= (ctx.c.pos[0].includes("≤") ? 0 : num(ctx.c.pos[0])),
    run: (ctx) => {
      const most = Math.min(num(ctx.c.pos[0]), me(ctx).deck.length);
      if (ctx.c.pos[0].includes("≤") && !ctx.r.answer?.option) {
        return ask(ctx, { kind: "option", prompt: msg("choice.millUpTo", { n: most }), options: Array.from({ length: most + 1 }, (_, i) => String(most - i)) });
      }
      const n = ctx.c.pos[0].includes("≤") ? Number(ctx.r.answer!.option) : num(ctx.c.pos[0]);
      const milled = me(ctx).deck.slice(0, n).map((i) => moveCard(ctx.db, ctx.s, i.uid, "drop"));
      record(ctx, "milled", milled);
      say(ctx, "log.mill", { n });
      return true;
    },
  },
  discard: {
    causes: (c, ab) => [{ move: { from: "hand", to: "drop", as: ab.kind === "G GUARDIAN" ? "g-guardian-cost" : undefined }, who: "chosen", filter: c.named.filter }],
    forms: ["discard(#)", "discard(#, filter=heal)", "discard(n, grade-sum≥3)"], text: "Discard cards from hand (filter= which ones)",
    canPay: (ctx) => matching(ctx, me(ctx).hand).length > 0,
    run: (ctx) => {
      const ps = me(ctx), opts = matching(ctx, ps.hand);
      const n = Math.min(num(ctx.c.pos[0]), opts.length);
      if (!n) return true;
      if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.discard", { n }), opts, n, n);
      for (const u of ctx.r.answer.uids) { const inst = moveCard(ctx.db, ctx.s, u, "drop"); say(ctx, "log.discard", { card: cardName(ctx, inst) }, u); }
      return true;
    },
  },
  reveal: {
    forms: ["reveal(#, filter={filter})"], text: "Reveal cards from hand (they stay in hand)",
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
    causes: (c) => [{ move: { from: "deck", to: c.pos[0].endsWith("hand") ? "hand" : "drop" }, who: "chosen", filter: c.named.filter }],
    forms: ["search(deck→hand, n≤#, filter={filter})", "search(deck→drop, n≤#, filter={filter})", "search(deck→hand, n≤#, filter={filter}, look=top-5)", "search(deck→hand, n≤#, filter={filter}, shuffle=later)"],
    text: "Search the deck (or its top 5) for cards, put them into hand or the drop zone, then shuffle (shuffle=later: a later shuffle(deck) step does it, when the card does something in between)",
    run: (ctx) => {
      const ps = me(ctx), dst = ctx.c.pos[0].split("→")[1];
      const max = num(ctx.c.pos.find((x) => x.startsWith("n")) ?? "n≤1");
      const pool = matching(ctx, ctx.c.named.look === "top-5" ? ps.deck.slice(0, 5) : ps.deck);
      if (pool.length && !ctx.r.answer?.uids) return askCards(ctx, msg(dst === "hand" ? "choice.searchHand" : "choice.searchDrop", { n: max }), pool, 0, max);
      const found = (ctx.r.answer?.uids ?? []).map((u) => moveCard(ctx.db, ctx.s, u, dst === "hand" ? "hand" : "drop"));
      for (const inst of found) {
        say(ctx, dst === "hand" ? "log.searchHand" : "log.searchDrop", { card: cardName(ctx, inst) }, inst.uid);
      }
      if (dst === "drop") record(ctx, "milled", found);
      if (ctx.c.named.shuffle !== "later") shuffleDeck(ctx);
      return true;
    },
  },
  // look(n, hand=1, soul=1 | soul=n≤1, rest=drop): look at the top n, pick some for hand, then for soul; the rest go to the drop zone (unset = stay on top)
  // reveal: both players see the cards (the card says "reveal"), not only their owner
  look: {
    causes: (c) => (["hand", "soul"] as const).filter((d) => c.named[d]).map((to) => ({ move: { from: "deck", to }, who: "chosen" as const })),
    forms: ["look(#, hand=1, soul=1, rest=drop)", "look(#, soul=n≤1, rest=drop)", "look(#, hand=1, soul=1)", "look(#, reveal, soul=n≤1, rest=drop)"],
    text: "Look at (or reveal) the top cards of the deck: some to hand, some to the soul, the rest to the drop zone",
    run: (ctx) => {
      const ps = me(ctx), r = ctx.r;
      if (r.local.looked === undefined) {
        const top = ps.deck.slice(0, num(ctx.c.pos[0]));
        if (!top.length) return true;
        r.local.looked = top.map((i) => i.uid).join(",");
        if (ctx.c.pos.includes("reveal")) for (const inst of top) say(ctx, "log.revealTop", { card: cardName(ctx, inst) }, inst.uid);
        else say(ctx, "log.lookTop", { n: top.length });
      }
      const left = () => String(r.local.looked).split(",").map((u) => ps.deck.find((d) => d.uid === u)).filter((i): i is CardInstance => !!i);
      const steps = (["hand", "soul"] as const).filter((d) => ctx.c.named[d] !== undefined);
      for (let i = Number(r.local.lookStep ?? 0); i < steps.length; i = Number(r.local.lookStep)) {
        const dest = steps[i], want = ctx.c.named[dest], opts = left();
        const max = Math.min(num(want), opts.length);
        if (max && !r.answer?.uids) return askCards(ctx, msg(dest === "hand" ? "choice.lookHand" : "choice.lookSoul", { n: max }), opts, want.startsWith("n≤") ? 0 : max, max);
        const picked = r.answer?.uids ?? [];
        r.answer = undefined;
        r.local.lookStep = i + 1;
        if (dest === "hand") for (const u of picked) { const inst = moveCard(ctx.db, ctx.s, u, "hand"); say(ctx, "log.searchHand", { card: cardName(ctx, inst) }, u); }
        else intoSoul(ctx, picked);
      }
      if (ctx.c.named.rest === "drop") for (const inst of left()) { moveCard(ctx.db, ctx.s, inst.uid, "drop"); say(ctx, "log.searchDrop", { card: cardName(ctx, inst) }, inst.uid); }
      return true;
    },
  },
  // to-soul(drop, n≤3 | n=1 | all, filter={filter}) / to-soul(self)
  "to-soul": {
    causes: (c) => [c.pos[0] === "self" ? { move: { from: "RC", to: "soul" }, who: "self" } : { move: { from: "drop", to: "soul" }, who: "chosen", filter: c.named.filter }],
    forms: ["to-soul(drop, n≤#, filter={filter})", "to-soul(drop, n=#, filter={filter})", "to-soul(drop, all, filter={filter})", "to-soul(self)"],
    text: "Put cards from the drop zone (or this unit) into the soul (filter different-grades = all chosen differ in grade)",
    canDo: (ctx) => ctx.c.pos[0] === "self" || matching(ctx, zonesOf(ctx, ctx.c.pos[0])).length > 0,
    run: (ctx) => {
      if (ctx.c.pos[0] === "self") {
        const at = sourceAt(ctx);
        if (at?.zone === "circle") intoSoul(ctx, [ctx.r.uid]);
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
      intoSoul(ctx, uids);
      return true;
    },
  },
  "soul-in": {
    causes: () => [{ move: { from: "RC", to: "soul" }, who: "self" }],
    forms: ["soul-in(self)"], text: "Put this unit into the soul (usually a cost)",
    canPay: (ctx) => sourceAt(ctx)?.zone === "circle",
    run: (ctx) => {
      const at = sourceAt(ctx);
      if (at?.zone !== "circle") return true;
      say(ctx, "log.soulIn", { card: cardName(ctx, at.inst) }, ctx.r.uid);
      moveCard(ctx.db, ctx.s, ctx.r.uid, "soul");
      return true;
    },
  },
  // to-deck(drop, all) / to-deck(drop+soul, n=2..3, filter={filter}): return cards to the deck (shuffle with a separate shuffle(deck))
  "to-deck": {
    causes: (c) => [{ move: { from: "drop", to: "deck" }, who: "chosen", filter: c.named.filter }],
    forms: ["to-deck(drop, all)", "to-deck(drop+soul, n=#..#, filter={filter})"], text: "Return cards to the deck (filter same-grade = all chosen share a grade)",
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
      const moved = uids.map((u) => moveCard(ctx.db, ctx.s, u, "deck"));
      for (const inst of moved) say(ctx, "log.returnToDeck", { card: cardName(ctx, inst) }, inst.uid);
      record(ctx, "returned", moved);
      return true;
    },
  },
  "to-deck-top": {
    causes: () => [{ move: { from: "RC", to: "deck" }, who: "self" }],
    forms: ["to-deck-top(self)"], text: "Put this unit on the top of the deck",
    run: (ctx) => {
      const at = sourceAt(ctx);
      if (at?.zone === "circle") { moveCard(ctx.db, ctx.s, ctx.r.uid, "deck", { top: true }); say(ctx, "log.toDeckTop", { card: cardName(ctx, at.inst) }, ctx.r.uid); }
      return true;
    },
  },
  "return-to-deck": {
    forms: ["return-to-deck(self)"], text: "Shuffle this card from the drop zone into the deck",
    run: (ctx) => {
      // Only while it is still in the drop zone: a card called back to a circle meanwhile is a new card the ability no longer follows
      const at = sourceAt(ctx);
      if (at?.zone === "drop") { moveCard(ctx.db, ctx.s, ctx.r.uid, "deck"); shuffleDeck(ctx, false); say(ctx, "log.returnToDeck", { card: cardName(ctx, at.inst) }, ctx.r.uid); }
      return true;
    },
  },
  "to-hand": {
    causes: (c) => [{ move: { from: "drop", to: "hand" }, who: "chosen", filter: c.named.filter }],
    forms: ["to-hand(drop, n≤#, filter={filter})"], text: "Return cards from the drop zone to hand",
    run: (ctx) => {
      const ps = me(ctx), opts = matching(ctx, ps.drop);
      if (!opts.length) return true;
      const { min, max } = range(ctx, ctx.c.pos[1], "n≤1");
      const top = Math.min(max, opts.length);
      if (!ctx.r.answer?.uids) return askCards(ctx, msg("choice.toHand", { n: max }), opts, Math.min(min, top), top);
      for (const u of ctx.r.answer.uids) { const inst = moveCard(ctx.db, ctx.s, u, "hand"); say(ctx, "log.toHand", { card: cardName(ctx, inst) }, u); }
      return true;
    },
  },
  shuffle: { forms: ["shuffle(deck)"], text: "Shuffle the deck", run: (ctx) => { shuffleDeck(ctx); return true; } },
};
