import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame } from "./game";
import { powerOf, shieldOf } from "./rules";
import type { Action, CardInstance, Circle, GameState, PlayerId } from "./types";

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const K = {
  mist: "G-CHB03/S11TH",   // grade 3, 11000
  star: "G-CHB03/002TH",   // grade 3, 11000
  gun: "G-BT06/087TH",     // grade 2, 9000
  bone: "G-BT06/040TH",    // grade 1, 7000
  crit: "PR/0632TH",       // Critical trigger, 4000
  heal: "PR/0740TH",       // Heal trigger
  gunit: "PR/0686TH",      // G unit 15000+
  lily: "G-CP08/S11TH",    // G guardian Shield 15000
};

// These tests cover the basic rules, so they answer "don't use" to every ability that asks (ability tests are in abilities.test.ts)
export function declineAll(s: GameState): GameState {
  for (let i = 0; i < 50 && s.awaiting; i++) {
    const w = s.awaiting, c = w.choice;
    if (w.kind === "order-queue") s = apply(db, s, w.player, { type: "order-queue", index: 0 }).state;
    else if (c?.kind === "yesno") s = apply(db, s, w.player, { type: "choose", option: "no" }).state;
    else if (c?.kind === "option") s = apply(db, s, w.player, { type: "choose", option: c.options[0] }).state;
    else if (c?.kind === "cards") s = apply(db, s, w.player, { type: "select-target", uids: c.options.slice(0, c.min) }).state;
    else if (c?.kind === "circle") s = apply(db, s, w.player, { type: "select-target", uids: [] }).state;
    else break;
  }
  return s;
}
const act = (s: GameState, p: PlayerId, a: Action) => declineAll(apply(db, s, p, a).state);

function start(seed = 1, first: PlayerId = "me"): GameState {
  let s = createGame(db, { seed, decks: { me: deck, bot: deck }, firstPlayer: first });
  s = act(s, first, { type: "mulligan", returnUids: [] });
  return act(s, first === "me" ? "bot" : "me", { type: "mulligan", returnUids: [] });
}

function card(s: GameState, key: string): CardInstance {
  return { uid: "t" + s.nextUid++, key, rested: false, faceUp: true, hollowed: false, mods: [], usedThisTurn: [] };
}
const place = (s: GameState, p: PlayerId, c: Circle, key: string) => (s.players[p].circles[c] = card(s, key));
const toHand = (s: GameState, p: PlayerId, key: string) => { const i = card(s, key); s.players[p].hand.push(i); return i; };
const onTop = (s: GameState, p: PlayerId, ...keys: string[]) => s.players[p].deck.unshift(...keys.map((k) => card(s, k)));

function advanceTo(s: GameState, phase: GameState["phase"], step?: string): GameState {
  while (s.phase !== phase || (step && s.step !== step)) s = act(s, s.turnPlayer, { type: "next-phase" });
  return s;
}

// The bot's turn 2, battle phase: the bot has mist on VC + gun front-left + bone back-center, we have mist on VC
function botBattle(): GameState {
  let s = start();
  s = advanceTo(s, "main");
  s = act(s, "me", { type: "next-phase" });            // end turn 1 (no battle phase on the first turn)
  place(s, "bot", "vc", K.mist);
  place(s, "bot", "front_left", K.gun);
  place(s, "bot", "back_center", K.bone);
  place(s, "me", "vc", K.mist);
  return advanceTo(s, "battle", "attack");
}

describe("game setup", () => {
  it("deals 5 cards, then the first player draws on the first turn", () => {
    const s = start();
    expect(s.turn).toBe(1);
    expect(s.players.me.hand).toHaveLength(6);
    expect(s.players.me.deck).toHaveLength(43);
    expect(s.players.bot.hand).toHaveLength(5);
    expect(s.players.me.circles.vc!.faceUp).toBe(true);
    expect(s.players.me.gZone.every((g) => !g.faceUp)).toBe(true);
    expect(s.phase).toBe("ride");
  });

  it("after a mulligan the hand size is unchanged", () => {
    let s = createGame(db, { seed: 7, decks: { me: deck, bot: deck }, firstPlayer: "me" });
    const back = s.players.me.hand.slice(0, 2).map((c) => c.uid);
    s = act(s, "me", { type: "mulligan", returnUids: back });
    expect(s.players.me.hand).toHaveLength(5);
    expect(s.players.me.hand.some((c) => back.includes(c.uid))).toBe(false);
    expect(s.players.me.deck).toHaveLength(44);
  });

  it("same seed + same actions = same game (replay)", () => {
    expect(JSON.stringify(start(42))).toBe(JSON.stringify(start(42)));
    expect(JSON.stringify(start(42))).not.toBe(JSON.stringify(start(43)));
  });

  it("can't act out of turn", () => {
    const s = start();
    expect(() => act(s, "bot", { type: "next-phase" })).toThrow();
  });
});

describe("ride and main phase", () => {
  it("rides once per turn, and the grade must be the same or +1", () => {
    let s = start();
    const g3 = toHand(s, "me", K.mist);
    expect(() => act(s, "me", { type: "ride", uid: g3.uid })).toThrow();
    const g1 = toHand(s, "me", K.bone);
    s = act(s, "me", { type: "ride", uid: g1.uid });
    expect(s.players.me.circles.vc!.key).toBe(K.bone);
    expect(s.players.me.soul).toHaveLength(1);
    const g1b = toHand(s, "me", K.bone);
    expect(() => act(s, "me", { type: "ride", uid: g1b.uid })).toThrow();
  });

  it("calls grade no higher than the vanguard, calling over sends the old unit to the drop, and can move front-back", () => {
    let s = advanceTo(start(), "main");
    const g2 = toHand(s, "me", K.gun);
    expect(() => act(s, "me", { type: "call", uid: g2.uid, to: "front_left" })).toThrow();
    place(s, "me", "vc", K.mist);
    s = act(s, "me", { type: "call", uid: g2.uid, to: "front_left" });
    const again = toHand(s, "me", K.bone);
    s = act(s, "me", { type: "call", uid: again.uid, to: "front_left" });
    expect(s.players.me.drop.map((c) => c.key)).toContain(K.gun);
    s = act(s, "me", { type: "move", from: "front_left", to: "back_left" });
    expect(s.players.me.circles.back_left!.key).toBe(K.bone);
    expect(() => act(s, "me", { type: "move", from: "back_left", to: "back_center" })).toThrow();
  });
});

describe("battle", () => {
  it("first turn: next from the main phase ends the turn without entering the battle phase", () => {
    let s = advanceTo(start(), "main");
    expect(() => act(s, "me", { type: "attack", attacker: "vc", target: "vc" })).toThrow();
    s = act(s, "me", { type: "next-phase" });
    expect(s.turn).toBe(2);
    expect(s.turnPlayer).toBe("bot");
    expect(s.phase).toBe("ride");
  });

  it("after riding, goes to the next step automatically: neither vanguard at grade 3 yet, skips the stride step into the main phase", () => {
    let s = start();
    const bone = toHand(s, "me", K.bone);
    s = act(s, "me", { type: "ride", uid: bone.uid });
    expect(s.players.me.circles.vc!.key).toBe(K.bone);
    expect(s.phase).toBe("main");
  });

  it("after riding, goes to the stride step automatically when both vanguards are grade 3", () => {
    let s = start();
    place(s, "me", "vc", K.star);
    place(s, "bot", "vc", K.mist);
    const mist = toHand(s, "me", K.mist);
    s = act(s, "me", { type: "ride", uid: mist.uid });
    expect(s.phase).toBe("ride");
    expect(s.step).toBe("stride");
  });

  it("boost adds Power and rests the booster; hitting the vanguard deals damage equal to Critical", () => {
    let s = botBattle();
    onTop(s, "bot", K.gun, K.gun);     // 2 drive checks with no trigger
    onTop(s, "me", K.gun);
    const deckBefore = s.players.bot.deck.length;
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc", booster: "back_center" });
    expect(powerOf(db, s.players.bot, "vc")).toBe(18000);
    expect(s.players.bot.circles.back_center!.rested).toBe(true);
    expect(s.awaiting!.player).toBe("me");
    s = act(s, "me", { type: "end-guard" });
    expect(s.players.me.damage).toHaveLength(1);
    expect(s.players.bot.deck).toHaveLength(deckBefore - 2);   // grade 3 = twin drive
    expect(s.step).toBe("attack");
    expect(powerOf(db, s.players.bot, "vc")).toBe(11000);   // the boost ends at the end of the battle
  });

  it("enough guard means no hit, and cards on GC go to the drop after the battle", () => {
    let s = botBattle();
    s = act(s, "bot", { type: "attack", attacker: "front_left", target: "vc" });
    const g = toHand(s, "me", K.bone);
    s = act(s, "me", { type: "guard", uids: [g.uid] });
    s = act(s, "me", { type: "end-guard" });       // 9000 vs 11000+5000
    expect(s.players.me.damage).toHaveLength(0);
    expect(s.players.me.guardian).toHaveLength(0);
    expect(s.players.me.drop.some((c) => c.uid === g.uid)).toBe(true);
  });

  it("hitting a rear-guard retires it, and there's no drive check when a rear-guard attacks", () => {
    let s = botBattle();
    place(s, "me", "front_right", K.bone);
    const deckBefore = s.players.bot.deck.length;
    s = act(s, "bot", { type: "attack", attacker: "front_left", target: "front_right" });
    s = act(s, "me", { type: "end-guard" });
    expect(s.players.me.circles.front_right).toBeUndefined();
    expect(s.players.bot.deck).toHaveLength(deckBefore);
  });

  it("only grade 2 in the front row can intercept", () => {
    let s = botBattle();
    place(s, "me", "front_left", K.gun);
    place(s, "me", "back_left", K.bone);
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc" });
    expect(() => act(s, "me", { type: "guard", uids: [], intercept: ["back_left"] })).toThrow();
    s = act(s, "me", { type: "guard", uids: [], intercept: ["front_left"] });
    expect(s.players.me.circles.front_left).toBeUndefined();
    expect(s.players.me.guardian).toHaveLength(1);
  });

  it("a critical trigger from the drive check adds damage", () => {
    let s = botBattle();
    onTop(s, "bot", K.crit, K.gun);
    onTop(s, "me", K.gun, K.gun);
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc" });
    s = act(s, "me", { type: "end-guard" });
    expect(s.awaiting).toMatchObject({ player: "bot", kind: "trigger-target" });
    s = act(s, "bot", { type: "trigger-target", powerTo: "vc", extraTo: "vc" });
    expect(s.players.me.damage).toHaveLength(2);
  });

  it("heal works when our damage is greater than or equal to the opponent's (before the check card goes to damage)", () => {
    let s = botBattle();
    s.players.me.damage = [card(s, K.gun), card(s, K.gun)];
    s.players.bot.damage = [card(s, K.gun), card(s, K.gun)];
    onTop(s, "bot", K.gun, K.gun);
    onTop(s, "me", K.heal);
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc" });
    s = act(s, "me", { type: "end-guard" });
    s = act(s, "me", { type: "trigger-target", powerTo: "vc" });
    expect(s.players.me.damage).toHaveLength(2);   // 2 - 1 (heal) + 1 (check card)
  });

  it("reaching 6 damage loses", () => {
    let s = botBattle();
    s.players.me.damage = Array.from({ length: 5 }, () => card(s, K.gun));
    onTop(s, "bot", K.gun, K.gun);
    onTop(s, "me", K.gun);
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc" });
    s = act(s, "me", { type: "end-guard" });
    expect(s.winner).toBe("bot");
    expect(() => act(s, "bot", { type: "next-phase" })).toThrow();
  });
});

describe("stride and G guardian", () => {
  function strideReady(): GameState {
    let s = start();
    s = advanceTo(s, "main");
    s = act(s, "me", { type: "next-phase" });   // the bot's turn (no battle phase on the first turn)
    place(s, "bot", "vc", K.mist);
    place(s, "me", "vc", K.star);
    return advanceTo(s, "ride", "stride");
  }

  it("stride: discard total grade 3, Power = 15000 + heart, at end of turn the G returns to the G zone face up", () => {
    let s = strideReady();
    const g = s.players.bot.gZone.find((c) => c.key === K.gunit)!;
    const low = toHand(s, "bot", K.bone);
    expect(() => act(s, "bot", { type: "stride", gUid: g.uid, discardUids: [low.uid] })).toThrow();
    const g3 = toHand(s, "bot", K.star);
    s = act(s, "bot", { type: "stride", gUid: g.uid, discardUids: [g3.uid] });
    expect(s.players.bot.heart!.key).toBe(K.mist);
    expect(powerOf(db, s.players.bot, "vc")).toBe(26000);
    s = advanceTo(s, "battle", "attack");
    s = act(s, "bot", { type: "next-phase" });
    expect(s.players.bot.circles.vc!.key).toBe(K.mist);
    expect(s.players.bot.gZone.find((c) => c.uid === g.uid)!.faceUp).toBe(true);
    expect(s.turnPlayer).toBe("me");
  });

  it("stride: Tommy the Ghostie Brothers (grade 1) counts as grade 3 when paying the cost, one discard is enough", () => {
    let s = strideReady();
    const g = s.players.bot.gZone.find((c) => c.key === K.gunit)!;
    const tommy = toHand(s, "bot", "G-CHB03/S12TH");
    s = act(s, "bot", { type: "stride", gUid: g.uid, discardUids: [tommy.uid] });
    expect(s.players.bot.circles.vc!.key).toBe(K.gunit);
    expect(s.players.bot.drop.map((c) => c.uid)).toContain(tommy.uid);
  });

  it("Nightrose, Night Fog: when striding, pays CB1 and calls from the drop zone even though it's now the heart", () => {
    let s = strideReady();
    const g = s.players.bot.gZone.find((c) => c.key === K.gunit)!;
    const g3 = toHand(s, "bot", K.star);
    s.players.bot.damage.push({ ...g3, uid: "dmg1", key: K.bone, faceUp: true });
    s.players.bot.drop.push({ ...g3, uid: "gun1", key: K.gun });
    const raw = (x: Action) => { s = apply(db, s, "bot", x).state; };   // not act, since act answers ability questions automatically
    raw({ type: "stride", gUid: g.uid, discardUids: [g3.uid] });
    expect(s.awaiting?.kind).toBe("order-queue");
    raw({ type: "order-queue", index: s.queue.findIndex((e) => e.label.includes("Night Fog")) });
    raw({ type: "select-target", uids: ["gun1"] });
    raw({ type: "select-target", uids: [], to: "front_left" });
    expect(s.players.bot.circles.front_left?.uid).toBe("gun1");
    expect(s.players.bot.damage.find((d) => d.uid === "dmg1")!.faceUp).toBe(false);
  });

  it("can't stride if the opponent's vanguard isn't grade 3 yet", () => {
    const s = strideReady();
    place(s, "me", "vc", K.gun);
    const g = s.players.bot.gZone.find((c) => c.key === K.gunit)!;
    const g3 = toHand(s, "bot", K.star);
    expect(() => act(s, "bot", { type: "stride", gUid: g.uid, discardUids: [g3.uid] })).toThrow();
  });

  it("G guardian Shield 15000 must discard a Heal and returns to the G zone face up", () => {
    let s = botBattle();
    onTop(s, "bot", K.gun, K.gun);
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc" });
    const lily = s.players.me.gZone.find((c) => c.key === K.lily)!;
    const notHeal = toHand(s, "me", K.crit);
    expect(() => act(s, "me", { type: "call-g-guardian", gUid: lily.uid, discardUid: notHeal.uid })).toThrow();
    const heal = toHand(s, "me", K.heal);
    s = act(s, "me", { type: "call-g-guardian", gUid: lily.uid, discardUid: heal.uid });
    s = act(s, "me", { type: "end-guard" });
    expect(s.players.me.damage).toHaveLength(0);
    expect(s.players.me.gZone.find((c) => c.uid === lily.uid)!.faceUp).toBe(true);
  });
});

describe("losing by deck-out", () => {
  it("must draw but the deck is empty", () => {
    let s = advanceTo(start(), "main");
    s.players.bot.deck = [];
    s = act(s, "me", { type: "next-phase" });
    expect(s.winner).toBe("me");
  });

  it("drawing the last card leaves the deck at 0 and loses immediately, without waiting for the next draw", () => {
    let s = advanceTo(start(), "main");
    s.players.bot.deck = s.players.bot.deck.slice(0, 1);
    s = act(s, "me", { type: "next-phase" });      // the bot draws the last card at the start of its turn
    expect(s.players.bot.deck).toHaveLength(0);
    expect(s.winner).toBe("me");
  });
});

describe("G assist", () => {
  // Our turn 1: grade 0 vanguard, no grade 1 in hand
  function noGrade1(top: string[]): GameState {
    let s = createGame(db, { seed: 1, decks: { me: deck, bot: deck }, firstPlayer: "me" });
    s = apply(db, s, "me", { type: "mulligan", returnUids: [] }).state;
    const me = s.players.me;
    me.deck.push(...me.hand.filter((h) => db[h.key].grade === 1));
    me.hand = me.hand.filter((h) => db[h.key].grade !== 1);
    me.deck = me.deck.filter((d) => db[d.key].grade !== 1 || !top.length);
    onTop(s, "me", ...top);
    return apply(db, s, "bot", { type: "mulligan", returnUids: [] }).state;
  }

  it("no next grade in hand: look at the top 5, add a grade 1 to hand, then remove 2 hand cards from the game", () => {
    let s = noGrade1([K.gun, K.bone, K.heal, K.crit, K.mist]);
    expect(s.phase).toBe("draw");
    const i = s.queue.findIndex((e) => e.key === "g-assist");
    expect(i).toBe(0);
    s = apply(db, s, "me", { type: "order-queue", index: i }).state;
    expect(s.awaiting?.choice?.kind).toBe("cards");
    const pool = s.awaiting!.choice as { options: string[] };
    expect(pool.options.map((u) => s.players.me.deck.find((d) => d.uid === u)!.key)).toEqual([K.bone]);
    s = apply(db, s, "me", { type: "select-target", uids: pool.options }).state;
    const hand = s.players.me.hand.length;
    const remove = s.players.me.hand.slice(0, 2).map((h) => h.uid);
    s = apply(db, s, "me", { type: "select-target", uids: remove }).state;
    expect(s.players.me.hand).toHaveLength(hand - 2);
    expect(s.players.me.hand.some((h) => h.key === K.bone)).toBe(true);
    expect(s.players.me.removed.map((c) => c.uid)).toEqual(remove);
    expect(s.phase).toBe("ride");
  });

  it("the wanted grade isn't found: shuffle the deck, no cards removed from the game", () => {
    let s = noGrade1([]);
    const hand = s.players.me.hand.length;
    const r = apply(db, s, "me", { type: "order-queue", index: 0 });
    s = r.state;
    expect(r.events.map((e) => e.text.key)).toContain("log.gAssistNone");
    expect(s.players.me.hand).toHaveLength(hand);
    expect(s.players.me.removed).toHaveLength(0);
    expect(s.phase).toBe("ride");
  });

  it("next grade in hand, or the vanguard is already grade 3: no G assist", () => {
    let s = advanceTo(start(), "main");
    toHand(s, "bot", K.bone);
    s = apply(db, s, "me", { type: "next-phase" }).state;
    expect(s.queue.some((e) => e.key === "g-assist")).toBe(false);
  });
});

describe("Shield", () => {
  it("a sentinel has Shield 0 as printed on the card, not 5000 by grade", () => {
    expect(shieldOf(db, card(start(), "G-BT06/S11TH"))).toBe(0);
    expect(shieldOf(db, card(start(), K.bone))).toBe(5000);
  });
});

describe("opening a pending ability with a question first (ask)", () => {
  it("Hollow: ask = asks whether to become hollowed instead of hollowing immediately", () => {
    let s = advanceTo(start(), "main");
    place(s, "me", "vc", K.mist);
    const rook = toHand(s, "me", "G-TD08/007TH");
    s = apply(db, s, "me", { type: "call", uid: rook.uid, to: "front_left" }).state;
    const i = s.queue.findIndex((e) => e.uid === rook.uid);
    s = apply(db, s, "me", { type: "order-queue", index: i, ask: true }).state;
    expect(s.awaiting?.choice?.kind).toBe("yesno");
    expect(s.players.me.circles.front_left!.hollowed).toBe(false);
    s = apply(db, s, "me", { type: "choose", option: "yes" }).state;
    expect(s.players.me.circles.front_left!.hollowed).toBe(true);
  });
});
