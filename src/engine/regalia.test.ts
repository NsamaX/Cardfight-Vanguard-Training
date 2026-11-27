import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { countCards, presetDecks, startingDecks, validateDeck } from "../data/decks";
import { apply, createGame, refreshAwaiting } from "./game";
import { driveOf, powerOf } from "./rules";
import type { Action, CardInstance, GameState, PlayerId } from "./types";

const regalia = presetDecks.find((d) => d.id === "regalia-minerva")!;
const K = {
  angelica: "G-BT14/020TH", hemera: "EB12/006TH", norn: "EB12/012TH", bragi: "G-BT14/066TH", genil: "G-BT14/067TH",
  daylight: "G-BT14/071TH", clear: "EB12/029TH", achlis: "EB12/035TH", dreaming: "G-BT04/082TH", minerva: "G-BT14/009TH",
};

let s: GameState;
const act = (p: PlayerId, a: Action) => { s = apply(db, s, p, a).state; };
const pick = (p: PlayerId, ...uids: string[]) => act(p, { type: "select-target", uids });

function inst(key: string, faceUp = true): CardInstance {
  return { uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] };
}

// Our main phase on turn 3 with the given vanguard; both decks are the Regalia deck
function mainPhase(vc: string) {
  s = createGame(db, { seed: 5, firstPlayer: "me", decks: { me: regalia, bot: regalia } });
  act("me", { type: "mulligan", returnUids: [] });
  act("bot", { type: "mulligan", returnUids: [] });
  if (s.queue.some((e) => e.key === "g-assist")) act("me", { type: "decline-queue", index: 0 });
  s.players.me.circles = { vc: inst(vc) };
  Object.assign(s, { turn: 3, turnPlayer: "me", phase: "main", step: undefined });
  refreshAwaiting(s);
}

const keys = (list: CardInstance[]) => list.map((c) => c.key);

describe("Regalia deck", () => {
  it("is a legal deck: 50 main cards, 16 G zone cards", () => {
    expect(validateDeck(regalia)).toEqual([]);
    expect(countCards(regalia.main)).toBe(50);
    expect(countCards(regalia.g_zone)).toBe(16);
  });

  it("is the bot's starting deck; we get the other deck, also from a signed-in copy matched by name, and both fall back to the first deck", () => {
    const nightrose = presetDecks.find((d) => d.id === "nightrose-sample")!;
    expect(startingDecks(presetDecks)).toEqual({ me: nightrose, bot: regalia });
    const copy = { ...regalia, id: "uuid-1" };
    expect(startingDecks([copy, nightrose])).toEqual({ me: nightrose, bot: copy });
    expect(startingDecks([nightrose])).toEqual({ me: nightrose, bot: nightrose });
  });
});

describe("to-soul", () => {
  it("Hemera: offers only Regalia cards from the drop zone, and the chosen ones go into the soul", () => {
    mainPhase(K.angelica);
    const me = s.players.me;
    me.drop = [inst(K.norn), inst(K.achlis), inst(K.dreaming)];
    const hemera = inst(K.hemera);
    me.hand.push(hemera);
    act("me", { type: "call", uid: hemera.uid, to: "front_left" });
    const choice = s.awaiting?.choice;
    expect(choice?.kind).toBe("cards");
    if (choice?.kind !== "cards") return;
    expect(choice.options).toEqual(me.drop.filter((c) => c.key !== K.dreaming).map((c) => c.uid));
    pick("me", ...choice.options);
    expect(keys(s.players.me.soul)).toEqual(expect.arrayContaining([K.norn, K.achlis]));
    expect(keys(s.players.me.drop)).toEqual([K.dreaming]);
  });

  it("Bragi (GB1): the vanguard and Bragi get Power+3000 for each card put into the soul", () => {
    mainPhase(K.angelica);
    const me = s.players.me;
    me.gZone = [inst(K.minerva, true), inst(K.minerva, false)];
    me.drop = [inst(K.norn), inst(K.achlis)];
    const bragi = inst(K.bragi);
    me.hand.push(bragi);
    act("me", { type: "call", uid: bragi.uid, to: "front_left" });
    pick("me", ...s.players.me.drop.map((c) => c.uid));
    const after = s.players.me;
    expect(powerOf(db, after, "vc")).toBe(11000 + 6000);
    expect(powerOf(db, after, "front_left")).toBe(9000 + 6000);
  });
});

describe("look", () => {
  it("Daylight Angel: reveals three, one Regalia goes into the soul and draws a card, the rest go to the drop zone", () => {
    mainPhase(K.angelica);
    const me = s.players.me;
    me.circles.back_center = inst(K.daylight);
    me.damage = [inst(K.norn)];
    const [a, b, c] = [inst(K.norn), inst(K.dreaming), inst(K.clear)];
    me.deck.unshift(a, b, c);
    const hand = me.hand.length;
    refreshAwaiting(s);
    act("me", { type: "activate", cardUid: me.circles.back_center!.uid, abilityIndex: 1 });
    const choice = s.awaiting?.choice;
    expect(choice?.kind === "cards" && choice.options).toEqual([a.uid, b.uid, c.uid]);
    pick("me", a.uid);
    const after = s.players.me;
    expect(keys(after.soul)).toEqual(expect.arrayContaining([K.daylight, K.norn]));
    expect(keys(after.drop)).toEqual(expect.arrayContaining([K.dreaming, K.clear]));
    expect(after.hand).toHaveLength(hand + 1);
  });

  it("Daylight Angel: putting nothing into the soul draws nothing", () => {
    mainPhase(K.angelica);
    const me = s.players.me;
    me.circles.back_center = inst(K.daylight);
    me.damage = [inst(K.norn)];
    me.deck.unshift(inst(K.dreaming), inst(K.dreaming), inst(K.dreaming));
    const hand = me.hand.length;
    refreshAwaiting(s);
    act("me", { type: "activate", cardUid: me.circles.back_center!.uid, abilityIndex: 1 });
    pick("me");
    expect(s.players.me.hand).toHaveLength(hand);
    expect(s.players.me.drop.filter((c) => c.key === K.dreaming)).toHaveLength(3);
  });
});

describe("put into the drop zone from the soul", () => {
  // Minerva on VC with these cards in the soul, and two face-down Minervas in the G zone (one is flipped by the ACT's cost)
  function minervaWithSoul(...soul: string[]) {
    mainPhase(K.minerva);
    const me = s.players.me;
    me.soul = soul.map((k) => inst(k));
    me.gZone = [inst(K.minerva, false), inst(K.minerva, false)];
    refreshAwaiting(s);
  }
  const useMinervaAct = () => act("me", { type: "activate", cardUid: s.players.me.circles.vc!.uid, abilityIndex: 1 });
  // Resolve whatever waits in the queue, picking the first option each time
  function resolveAll() {
    for (let i = 0; i < 20 && s.awaiting?.player === "me"; i++) {
      const a = s.awaiting;
      if (a.kind === "order-queue") act("me", { type: "order-queue", index: 0 });
      else if (a.choice?.kind === "yesno") act("me", { type: "choose", option: "yes" });
      else if (a.choice?.kind === "cards") pick("me", ...a.choice.options.slice(0, Math.max(1, a.choice.min)));
      else break;
    }
  }

  it("Soul Blast with a filter: when the soul has more matching cards than needed, the player picks, and other cards aren't offered", () => {
    minervaWithSoul(K.norn, K.achlis, K.angelica, K.hemera, K.dreaming);
    useMinervaAct();
    const choice = s.awaiting?.choice;
    expect(choice?.kind).toBe("cards");
    if (choice?.kind !== "cards") return;
    expect(choice.min).toBe(3);
    expect(choice.options).toHaveLength(4);   // the four Regalia cards, not Dreaming Dragon
    pick("me", ...choice.options.slice(1));    // keep Norn in the soul
    expect(keys(s.players.me.soul)).toEqual(expect.arrayContaining([K.norn, K.dreaming]));
  });

  it("Norn and Achlis: each Soul Blasted one gives the Regalia vanguard Power+5000", () => {
    minervaWithSoul(K.norn, K.achlis, K.angelica);
    useMinervaAct();
    resolveAll();
    const vc = s.players.me.circles.vc!;
    expect(vc.mods.filter((m) => m.stat === "power").map((m) => m.value).sort()).toEqual([10000, 5000, 5000].sort());
  });

  it("Jotun (GB1, your turn): Soul Blasted, binds itself and returns another Jotun from the drop zone to hand", () => {
    const jotun = "G-BT14/021TH";
    minervaWithSoul(jotun, K.norn, K.achlis);
    s.players.me.drop = [inst(jotun)];
    const hand = s.players.me.hand.length;
    useMinervaAct();
    resolveAll();
    const me = s.players.me;
    expect(me.bind.map((c) => c.key)).toEqual([jotun]);
    expect(me.hand).toHaveLength(hand + 1);
    expect(me.hand.at(-1)!.key).toBe(jotun);
  });
});

describe("Minerva", () => {
  const regaliaSoul = [K.norn, K.norn, K.hemera, K.hemera, K.bragi, K.bragi, K.angelica];
  function setup() {
    mainPhase(K.minerva);
    const me = s.players.me, bot = s.players.bot;
    me.soul = regaliaSoul.map((k) => inst(k));
    me.gZone = [inst(K.minerva, true), inst(K.minerva, true), inst(K.minerva, true), inst(K.minerva, false)];   // GB3, one face down for the ACT
    me.circles.front_left = inst(K.hemera);
    me.circles.front_left.rested = true;   // already attacked this turn
    me.deck.unshift(inst(K.hemera), inst(K.hemera), inst(K.hemera));   // drive checks: no triggers
    bot.circles = { vc: inst(K.angelica) };
    bot.hand = [];
    bot.deck.unshift(inst(K.hemera));   // damage check: no trigger
  }
  function resolveMine() {
    for (let i = 0; i < 30 && s.awaiting?.player === "me" && s.awaiting.kind !== "next-phase" && s.awaiting.kind !== "attack"; i++) {
      const a = s.awaiting;
      if (a.kind === "order-queue") act("me", { type: "order-queue", index: 0 });
      else if (a.choice?.kind === "yesno") act("me", { type: "choose", option: "yes" });
      else if (a.choice?.kind === "cards") pick("me", ...a.choice.options.slice(0, Math.max(1, a.choice.min)));
      else break;
    }
  }

  it("ACT: Power+10000 and drive +1 (triple drive becomes 4)", () => {
    setup();
    act("me", { type: "activate", cardUid: s.players.me.circles.vc!.uid, abilityIndex: 1 });
    resolveMine();
    const vc = s.players.me.circles.vc!;
    expect(vc.mods.some((m) => m.stat === "power" && m.value === 10000)).toBe(true);
    expect(driveOf(db, vc)).toBe(4);
  });

  it("AUTO (GB3) on attack: at the end of that battle all Regalia units stand, and they get drive -3", () => {
    setup();
    Object.assign(s, { phase: "battle", step: "attack" });
    refreshAwaiting(s);
    act("me", { type: "attack", attacker: "vc", target: "vc" });
    resolveMine();
    expect(s.players.me.soul).toHaveLength(regaliaSoul.length - 6);   // SB6
    for (let i = 0; i < 30 && !(s.awaiting?.player === "me" && s.awaiting.kind === "attack"); i++) {
      if (s.awaiting?.player === "bot") act("bot", { type: s.awaiting.kind === "guard" ? "end-guard" : "next-phase" });
      else resolveMine();
    }
    const me = s.players.me;
    expect(me.circles.vc!.rested).toBe(false);
    expect(me.circles.front_left!.rested).toBe(false);
    expect(driveOf(db, me.circles.vc!)).toBe(0);
  });
});

// Answer every question of ours (first options), stopping when the game waits for a phase/attack decision or for the opponent
function answerAll() {
  for (let i = 0; i < 30 && s.awaiting?.player === "me"; i++) {
    const a = s.awaiting;
    if (a.kind === "order-queue") act("me", { type: "order-queue", index: 0 });
    else if (a.choice?.kind === "yesno") act("me", { type: "choose", option: "yes" });
    else if (a.choice?.kind === "cards") pick("me", ...a.choice.options.slice(0, Math.max(1, a.choice.max)));
    else break;
  }
}

describe("Kukurihime", () => {
  const kukuri = "G-BT14/040TH";
  function useAct(faceUpG: boolean) {
    mainPhase(K.angelica);
    const me = s.players.me;
    me.circles.front_left = inst(K.hemera);
    me.circles.back_left = inst(kukuri);
    me.gZone = [inst(K.minerva, faceUpG)];
    refreshAwaiting(s);
    const hand = me.hand.length;
    act("me", { type: "activate", cardUid: me.circles.back_left!.uid, abilityIndex: 0 });
    answerAll();
    return s.players.me.hand.length - hand;
  }

  it("draws a card when the G zone has a face-up card", () => {
    expect(useAct(true)).toBe(1);
  });

  it("doesn't draw without a face-up card in the G zone", () => {
    expect(useAct(false)).toBe(0);
  });

  it("with a grade 2 vanguard it can still be used: goes into the soul, but gives no Power", () => {
    mainPhase(K.hemera);
    const me = s.players.me;
    me.circles.front_left = inst(K.bragi);
    me.circles.back_left = inst(kukuri);
    refreshAwaiting(s);
    act("me", { type: "activate", cardUid: me.circles.back_left!.uid, abilityIndex: 0 });
    answerAll();
    const after = s.players.me;
    expect(after.soul.at(-1)!.key).toBe(kukuri);
    expect(after.circles.back_left).toBeUndefined();
    expect(after.circles.front_left!.mods).toHaveLength(0);
  });
});

describe("Jotun (sentinel)", () => {
  const jotun = "G-BT14/021TH";
  // The bot attacks our vanguard; we guard with Jotun and pay its cost
  function guardWith(vc: string) {
    mainPhase(K.angelica);
    s.players.bot.circles = { vc: inst(K.angelica) };
    s.players.me.circles = { vc: inst(vc) };
    const j = inst(jotun), spare = inst(K.hemera);
    s.players.me.hand = [j, spare];
    Object.assign(s, { turnPlayer: "bot", phase: "battle", step: "attack" });
    refreshAwaiting(s);
    act("bot", { type: "attack", attacker: "vc", target: "vc" });
    act("me", { type: "guard", uids: [j.uid] });
    answerAll();
    return s.battle?.noHit ?? false;
  }

  it("a Regalia unit attacked can't be hit", () => {
    expect(guardWith(K.angelica)).toBe(true);
  });

  it("a unit without \"Regalia\" in its name isn't protected", () => {
    expect(guardWith(K.dreaming)).toBe(false);
  });
});

describe("Inanna", () => {
  const inanna = "G-BT14/019TH";
  it("ACT: the opponent chooses and retires a rear-guard for each card with Revelation soul charged", () => {
    mainPhase(inanna);
    const me = s.players.me, bot = s.players.bot;
    me.damage = [inst(K.hemera)];
    me.gZone = [inst(inanna, false)];
    // A card with Revelation (none in the real deck): Hemera with the keyword added
    const revelation = "TEST/REVELATION";
    db[revelation] = { ...db[K.hemera], key: revelation, abilities: [{ kind: "AUTO", effect: ["keyword(Revelation)"] }] };
    me.deck.unshift(inst(revelation), inst(K.hemera), inst(revelation));
    bot.circles = { vc: inst(K.angelica), front_left: inst(K.hemera), front_right: inst(K.bragi), back_left: inst(K.clear) };
    refreshAwaiting(s);
    act("me", { type: "activate", cardUid: me.circles.vc!.uid, abilityIndex: 2 });
    answerAll();
    expect(s.awaiting?.player).toBe("bot");
    const c = s.awaiting?.choice;
    expect(c?.kind === "cards" && [c.min, c.max, c.options.length]).toEqual([2, 2, 3]);
    act("bot", { type: "select-target", uids: [bot.circles.front_left!.uid, bot.circles.back_left!.uid] });
    expect(Object.keys(s.players.bot.circles).sort()).toEqual(["front_right", "vc"]);
    expect(s.players.me.soul).toHaveLength(3);
    delete db[revelation];
  });
});

describe("Verthandi", () => {
  const verthandi = "G-BT08/014TH", inanna = "G-BT14/019TH";

  function strideOver(g: string) {
    mainPhase(verthandi);
    const me = s.players.me;
    me.circles.front_left = inst(K.hemera);
    me.circles.back_left = inst("G-BT14/040TH");   // Kukurihime: puts itself into the soul by its ACT
    me.gZone = [inst(g, false)];
    s.players.bot.circles = { vc: inst(K.angelica) };   // both vanguards grade 3, so striding is allowed
    const discard = inst(K.angelica);
    me.hand.push(discard);
    Object.assign(s, { phase: "ride", step: "stride" });
    refreshAwaiting(s);
    act("me", { type: "stride", gUid: me.gZone[0].uid, discardUids: [discard.uid] });
    answerAll();
  }

  it("striding a Regalia G unit: the vanguard gets the ability, and putting a card into the soul gives the Regalia front row Power+1000", () => {
    strideOver(K.minerva);
    const me = s.players.me;
    expect(me.circles.vc!.grants?.length).toBe(1);
    act("me", { type: "next-phase" });   // to the main phase
    answerAll();
    act("me", { type: "activate", cardUid: s.players.me.circles.back_left!.uid, abilityIndex: 0 });
    answerAll();
    const after = s.players.me;
    const plus1000 = (c: CardInstance) => c.mods.some((m) => m.stat === "power" && m.value === 1000);
    expect(plus1000(after.circles.vc!)).toBe(true);
    expect(plus1000(after.circles.front_left!)).toBe(true);
  });

  it("the granted ability triggers once per card: Hemera putting three cards into the soul gives Power+3000", () => {
    strideOver(K.minerva);
    act("me", { type: "next-phase" });
    answerAll();
    s.players.me.drop = [inst(K.norn), inst(K.achlis), inst(K.clear)];
    const hemera = inst(K.hemera);
    s.players.me.hand.push(hemera);
    act("me", { type: "call", uid: hemera.uid, to: "front_right" });
    answerAll();
    const me = s.players.me;
    expect(me.soul.filter((c) => [K.norn, K.achlis, K.clear].includes(c.key))).toHaveLength(3);
    const from = (c: CardInstance) => c.mods.filter((m) => m.stat === "power" && m.value === 1000).length;
    expect(from(me.circles.vc!)).toBe(3);
    expect(from(me.circles.front_left!)).toBe(3);
  });

  it("striding a G unit without \"Regalia\" in its name doesn't trigger it", () => {
    strideOver(inanna);
    expect(s.players.me.circles.vc!.grants ?? []).toHaveLength(0);
  });

  it("ACT: the chosen front-row units get \"when this unit's attack hits a vanguard, look at two: one to hand, one to soul\"", () => {
    mainPhase(verthandi);
    const me = s.players.me, bot = s.players.bot;
    me.soul = [inst(K.norn), inst(K.hemera), inst(K.bragi)];
    me.circles.front_left = inst(K.hemera);
    bot.circles = { vc: inst("PR/0740TH") };   // a 4000 Power vanguard, so the attack hits
    bot.hand = [];
    act("me", { type: "activate", cardUid: me.circles.vc!.uid, abilityIndex: 0 });
    answerAll();
    expect(s.players.me.circles.front_left!.grants?.length).toBe(1);
    const [a, b] = [inst(K.norn), inst(K.bragi)];
    s.players.me.deck.unshift(a, b);
    s.players.bot.deck.unshift(inst(K.hemera));   // damage check: no trigger
    Object.assign(s, { phase: "battle", step: "attack" });
    refreshAwaiting(s);
    const hand = s.players.me.hand.length;
    act("me", { type: "attack", attacker: "front_left", target: "vc" });
    for (let i = 0; i < 20 && !(s.awaiting?.player === "me" && s.awaiting.kind === "attack"); i++) {
      if (s.awaiting?.player === "bot") act("bot", { type: s.awaiting.kind === "guard" ? "end-guard" : "next-phase" });
      else answerAll();
    }
    const after = s.players.me;
    expect(after.hand).toHaveLength(hand + 1);
    expect(after.hand.some((c) => c.uid === a.uid || c.uid === b.uid)).toBe(true);
    expect(after.soul.some((c) => c.uid === a.uid || c.uid === b.uid)).toBe(true);
  });
});

describe("Urth", () => {
  const urth = "G-BT08/005TH";
  function strideUrth(heart: string) {
    mainPhase(heart);
    const me = s.players.me;
    me.damage = [inst(K.norn), inst(K.norn)];   // CB1 for Angelica (the heart also triggers on a Regalia stride) and CB1 for Urth
    me.gZone = [inst(urth, false), inst(urth, false), inst(K.minerva, true)];
    me.drop = [inst(K.norn), inst(K.hemera), inst(K.dreaming)];
    me.soul = [K.bragi, K.bragi, K.bragi, K.bragi, K.bragi].map((k) => inst(k));
    s.players.bot.circles = { vc: inst(K.angelica) };
    const discard = inst(K.angelica);
    me.hand.push(discard);
    Object.assign(s, { phase: "ride", step: "stride" });
    refreshAwaiting(s);
    act("me", { type: "stride", gUid: me.gZone[0].uid, discardUids: [discard.uid] });
    answerAll();
  }

  it("with a Regalia heart: all Regalia in the drop zone go into the soul, and with two face-up Regalia in the G zone it gets the ACT", () => {
    strideUrth(K.angelica);
    const me = s.players.me;
    expect(me.drop.filter((c) => db[c.key].name.includes("Regalia"))).toHaveLength(0);
    expect(keys(me.drop)).toContain(K.dreaming);
    expect(me.circles.vc!.grants?.map((g) => g.kind)).toEqual(["ACT"]);
    const soulBefore = me.soul.length;
    act("me", { type: "next-phase" });   // to the main phase
    const vc = s.players.me.circles.vc!;
    act("me", { type: "activate", cardUid: vc.uid, abilityIndex: db[urth].abilities.length });
    answerAll();
    const after = s.players.me.circles.vc!;
    expect(after.mods.some((m) => m.stat === "power" && m.value === 10000)).toBe(true);
    expect(after.mods.some((m) => m.stat === "critical" && m.value === 1)).toBe(true);
    expect(s.players.me.soul.length).toBe(soulBefore - 6);   // SB6
  });

  it("without a Regalia heart, nothing happens", () => {
    strideUrth("G-CHB03/S11TH");   // Nightrose (Night Fog)
    expect(keys(s.players.me.drop)).toEqual(expect.arrayContaining([K.norn, K.hemera]));
    expect(s.players.me.circles.vc!.grants ?? []).toHaveLength(0);
  });
});

describe("Laurier", () => {
  it("GB1: flips a G guardian, returns three grade 2 normal units to the deck, and gets Shield+15000", () => {
    mainPhase(K.angelica);
    const me = s.players.me, bot = s.players.bot;
    const laurier = "G-FC04/030TH", eir = "G-BT14/022TH";
    me.gZone = [inst(laurier, false), inst("G-FC03/030TH", false), inst(K.minerva, true)];
    me.drop = [inst(K.hemera), inst(K.hemera), inst(K.hemera)];
    me.hand = [inst(eir)];
    bot.circles = { vc: inst(K.angelica) };
    Object.assign(s, { turnPlayer: "bot", phase: "battle", step: "attack" });
    refreshAwaiting(s);
    act("bot", { type: "attack", attacker: "vc", target: "vc" });
    for (let i = 0; i < 5 && s.awaiting?.player === "bot"; i++) act("bot", { type: "pass-queue" });
    act("me", { type: "call-g-guardian", gUid: me.gZone[0].uid, discardUid: me.hand[0].uid });
    answerAll();
    const g = s.players.me.guardian.find((c) => c.key === laurier)!;
    expect(g.mods.filter((m) => m.stat === "shield").reduce((n, m) => n + m.value, 0)).toBe(15000);
    expect(s.players.me.drop.filter((c) => c.key === K.hemera)).toHaveLength(0);
  });
});

describe("Dreaming Dragon", () => {
  it("GB1, end of your turn: goes on top of the deck, returns the drop zone to the deck, and draws with ten or more returned", () => {
    mainPhase(K.angelica);
    const me = s.players.me;
    const dd = inst(K.dreaming);
    me.circles.back_left = dd;
    me.gZone = [inst(K.minerva, true)];
    me.drop = Array.from({ length: 10 }, () => inst(K.hemera));
    const deck = me.deck.length, hand = me.hand.length;
    Object.assign(s, { phase: "battle", step: "attack" });
    refreshAwaiting(s);
    act("me", { type: "next-phase" });   // end phase
    answerAll();
    const after = s.players.me;
    expect(after.drop).toHaveLength(0);
    expect(after.circles.back_left).toBeUndefined();
    expect(after.deck.length).toBe(deck + 10 + 1 - 1);   // 10 from the drop + Dreaming Dragon, then one drawn
    expect(after.hand).toHaveLength(hand + 1);
  });
});
