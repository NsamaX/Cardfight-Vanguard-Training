// Codes about abilities themselves (granting one, choosing between effects), keywords, and the G assist rule
import { msg } from "../../../i18n/msg";
import { splitTop } from "../../code";
import { shuffle } from "../../rng";
import { isG } from "../../rules";
import { locate, playerMsg } from "../../state";
import { moveCard, strideOnto } from "../../zones";
import type { Ability } from "../../types";
import { ask, askCards, say } from "../ctx";
import { runCode } from "../index";
import { pickUnits } from "../selectors";
import type { OpSpec } from "../types";
import { num } from "./resources";

// AUTO-VC[timing → effect] / ACT-VC[cost & cost → effect & effect]: the ability inside a grant
export function grantedAbility(code: string): Ability | undefined {
  const m = code.match(/^(AUTO|ACT)(?:-([\w/]+))?\[(.*) → (.*)\]$/);
  if (!m) return undefined;
  return m[1] === "AUTO"
    ? { kind: "AUTO", zone: m[2], timing: m[3], effect: splitTop(m[4], "&") }
    : { kind: "ACT", zone: m[2], cost: splitTop(m[3], "&"), effect: splitTop(m[4], "&") };
}

export const META_OPS: Record<string, OpSpec> = {
  grant: {
    forms: ["grant(AUTO-RC[turn-end → draw(1)], {target}, until=turn-end)", "grant(ACT-VC[CB(1) → power(+5000, self)], {target}, until=turn-end)"],
    text: "Give units an ability until the end of the turn: AUTO-zone[timing → effect & …] or ACT-zone[cost & … → effect & …]",
    run: (ctx) => {
      const ab = grantedAbility(ctx.c.pos[0]);
      if (!ab) return true;
      const uids = pickUnits(ctx, { who: ctx.c.pos[1] ?? "self", filter: ctx.c.named.filter, upTo: true });
      if (uids === false) return false;
      for (const u of uids) { const i = locate(ctx.s, u); if (i?.zone === "circle") (i.inst.grants ??= []).push(ab); }
      say(ctx, "log.grant", { n: uids.length });
      return true;
    },
  },
  // Remember the chosen effect; it may ask further (e.g. CC must choose a damage card), then come back to this step again
  choose: {
    forms: ["choose(CC(1), SC(1))"], text: "The player chooses one of the effects",
    run: (ctx) => {
      if (ctx.r.local.pick === undefined) {
        if (!ctx.r.answer?.option) return ask(ctx, { kind: "option", prompt: msg("choice.effect"), options: ctx.c.pos });
        ctx.r.local.pick = ctx.r.answer.option;
        ctx.r.answer = undefined;
      }
      return runCode(ctx, String(ctx.r.local.pick));
    },
  },
  // Reveal the hand, look at the top 5 of the deck, add 1 unit of the wanted grade to hand, then shuffle; if you guard, remove 2 hand cards from the game
  "g-assist": {
    forms: ["g-assist(#)"], text: "The G assist step (added by the rules)",
    run: (ctx) => {
      const ps = ctx.s.players[ctx.owner], r = ctx.r;
      if (!r.local.stage) {
        const grade = num(ctx.c.pos[0]);
        const pool = ps.deck.slice(0, 5).filter((i) => !isG(ctx.db[i.key]) && ctx.db[i.key].grade === grade);
        if (!r.answer?.uids) {
          say(ctx, "log.revealHand", { player: playerMsg(ctx.owner), cards: ps.hand.map((h) => ctx.db[h.key].name).join(", ") });
          if (pool.length) return askCards(ctx, msg("choice.gAssistPick", { grade }), pool, 0, 1);
          say(ctx, "log.gAssistNone", { grade });
        }
        const picked = r.answer?.uids ?? [];
        for (const u of picked) { const inst = moveCard(ctx.db, ctx.s, u, "hand"); say(ctx, "log.searchHand", { card: ctx.db[inst.key].name }, u); }
        [ps.deck, ctx.s.rngState] = shuffle(ps.deck, ctx.s.rngState);
        say(ctx, "log.shuffle");
        if (!picked.length) return true;
        r.local.stage = 1;
        r.answer = undefined;
      }
      const n = Math.min(2, ps.hand.length);
      if (!n) return true;
      if (!r.answer?.uids) return askCards(ctx, msg("choice.gAssistRemove", { n }), ps.hand, n, n);
      for (const u of r.answer.uids) { const inst = moveCard(ctx.db, ctx.s, u, "removed"); say(ctx, "log.removed", { card: ctx.db[inst.key].name }, u); }
      return true;
    },
  },
  // STRIDE abilities: the rules do the stride in the stride step (game.ts); as an effect step it does nothing
  stride: { causes: () => [{ stride: true, who: "self" }, { move: { from: "G", to: "VC" }, who: "self" }], forms: ["stride(self)"], text: "STRIDE this card (the rules do it in the stride step)", run: () => true },
  // Sebreeze's ACT from the G zone: stride this card onto VC (not in the stride step, and without a stride cost)
  "stride-from-G": {
    forms: ["stride-from-G(self)"], text: "STRIDE this card from the G zone onto VC (an ACT used from the G zone)",
    causes: () => [{ stride: true, who: "self" }, { move: { from: "G", to: "VC" }, who: "self" }],
    run: (ctx) => {
      const at = locate(ctx.s, ctx.r.uid);
      if (at?.zone === "gZone" && ctx.s.players[ctx.owner].circles.vc) strideOnto(ctx.db, ctx.s, ctx.owner, ctx.r.uid, ctx.out);
      return true;
    },
  },
  // Restates rule 6.6.3.5 (an ultimate-strided G unit returning removes the whole G zone), which the rules apply themselves
  "remove-G-zone": { forms: ["remove-G-zone(own, at=return-to-G)"], text: "The whole G zone is removed from the game when this G unit returns (ultimate stride rule)", passive: true, run: () => true },
  // CONT: attacking costs something (read by the rules when a unit attacks, see cont.ts)
  "attack-tax": { forms: ["attack-tax(CB(#), RC)"], text: "Rear-guards can't attack a vanguard unless the cost is paid (CONT; Honoly)", run: () => true, cont: () => {} },
  keyword: { forms: ["keyword(Sentinel)", "keyword(Revelation)"], text: "A keyword (Sentinel: deck limit and guard rules; others are placeholders)", passive: true, run: () => true },
  "all-clan": { forms: ["all-clan(self)"], text: "Counts as every clan for deck building", passive: true, run: () => true },
};
