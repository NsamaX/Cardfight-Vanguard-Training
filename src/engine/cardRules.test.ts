import { describe, expect, it } from "vitest";
import { cardByKey as db, cards } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame, refreshAwaiting, usableActs } from "./game";
import { blocked } from "./abilities";
import type { Action, CardInstance, GameState, PlayerId } from "./types";

const regalia = presetDecks.find((d) => d.id === "regalia-minerva")!;
const key = (part: string) => cards.find((c) => c.name.includes(part))!.key;
const HONOLY = key("Honoly"), SEBREEZE = key("Sebreeze"), MEGIDDO = key("Megiddo"), NIGHT_FOG = key("Night Fog");
const ANGELICA = "G-BT14/020TH", HEMERA = "EB12/006TH", MINERVA = "G-BT14/009TH";

let s: GameState;
const inst = (k: string, faceUp = true): CardInstance => ({ uid: "t" + s.nextUid++, key: k, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
const act = (p: PlayerId, a: Action) => { s = apply(db, s, p, a).state; };
function game(phase: GameState["phase"], step?: string) {
  s = createGame(db, { seed: 4, firstPlayer: "me", decks: { me: regalia, bot: regalia } });
  s.players.me.circles = { vc: inst(ANGELICA) };
  s.players.bot.circles = { vc: inst(ANGELICA) };
  Object.assign(s, { turn: 5, turnPlayer: "me", phase, step, queue: [] });
  refreshAwaiting(s);
}

describe("Honoly: rear-guards attacking a vanguard pay CB1 from the fifth battle", () => {
  function fifthBattle(faceUpDamage: number) {
    game("battle", "attack");
    s.players.bot.circles.front_left = inst(HONOLY);
    s.players.me.circles.front_left = inst(HEMERA);
    s.players.me.damage = Array.from({ length: 2 }, (_, i) => inst(HEMERA, i < faceUpDamage));
    s.battlesThisTurn = 4;
    refreshAwaiting(s);
  }

  it("pays CB1 when it can", () => {
    fifthBattle(1);
    act("me", { type: "attack", attacker: "front_left", target: "vc" });
    expect(s.players.me.damage.filter((d) => d.faceUp)).toHaveLength(0);
    expect(s.battle?.attacker).toBe("front_left");
  });

  it("can't attack when it can't pay; the vanguard and attacks on rear-guards aren't taxed", () => {
    fifthBattle(0);
    expect(() => act("me", { type: "attack", attacker: "front_left", target: "vc" })).toThrow("err.attackTax");
    act("me", { type: "attack", attacker: "front_left", target: "front_left" });
    expect(s.battle?.target).toBe("front_left");
  });

  it("before the fifth battle nothing is paid", () => {
    fifthBattle(1);
    s.battlesThisTurn = 2;
    act("me", { type: "attack", attacker: "front_left", target: "vc" });
    expect(s.players.me.damage.filter((d) => d.faceUp)).toHaveLength(1);
  });
});

describe("Sebreeze: ACT from the G zone strides it in the main phase", () => {
  function setup(oppRode: boolean) {
    game("main");
    const me = s.players.me;
    me.gZone = [inst(SEBREEZE, false)];
    me.damage = [inst(HEMERA), inst(HEMERA)];
    me.hand = [inst(HEMERA)];
    s.players.bot.circles = { vc: inst(HEMERA) };   // grade 2
    s.players.bot.rodeLastTurn = oppRode;
    refreshAwaiting(s);
  }

  it("with a grade 3 vanguard, no face-up G zone cards, and an opponent who didn't ride: CB2, discard, stride", () => {
    setup(false);
    const g = s.players.me.gZone[0];
    expect(usableActs(db, s).map((a) => a.uid)).toContain(g.uid);
    act("me", { type: "activate", cardUid: g.uid, abilityIndex: 1 });   // the only hand card is discarded by itself
    expect(s.players.me.circles.vc!.key).toBe(SEBREEZE);
    expect(s.players.me.heart!.key).toBe(ANGELICA);
    expect(s.players.me.damage.filter((d) => d.faceUp)).toHaveLength(0);
  });

  it("not when the opponent rode last turn", () => {
    setup(true);
    expect(usableActs(db, s)).toHaveLength(0);
  });
});

describe("Megiddo: ultimate stride", () => {
  function setup(faceUp: number) {
    game("ride", "stride");
    const me = s.players.me;
    me.circles = { vc: inst(NIGHT_FOG) };
    me.gZone = [inst(MEGIDDO, false), ...Array.from({ length: faceUp }, () => inst(MINERVA))];
    me.hand = [inst(NIGHT_FOG), inst(HEMERA)];
    me.damage = [];
    refreshAwaiting(s);
  }

  it("needs 3 face-up G zone cards and a discard with the vanguard's name", () => {
    setup(2);
    const [same, other] = s.players.me.hand;
    expect(() => act("me", { type: "stride", gUid: s.players.me.gZone[0].uid, discardUids: [same.uid] })).toThrow("err.ultimateCost");
    setup(3);
    expect(() => act("me", { type: "stride", gUid: s.players.me.gZone[0].uid, discardUids: [s.players.me.hand[1].uid] })).toThrow("err.ultimateCost");
    expect(other).toBeDefined();
  });

  it("strides, and when it returns at the end of the turn the whole G zone is removed from the game", () => {
    setup(3);
    act("me", { type: "stride", gUid: s.players.me.gZone[0].uid, discardUids: [s.players.me.hand[0].uid] });
    expect(s.players.me.circles.vc!.key).toBe(MEGIDDO);
    for (let i = 0; i < 6 && s.turnPlayer === "me"; i++) {
      if (s.awaiting?.player === "me" && s.awaiting.kind === "order-queue") act("me", { type: "decline-queue", index: 0 });
      else if (s.awaiting?.player === "me") act("me", { type: "next-phase" });
      else break;
    }
    expect(s.turnPlayer).toBe("bot");
    expect(s.players.me.gZone).toHaveLength(0);
    expect(s.players.me.removed.map((c) => c.key)).toEqual(expect.arrayContaining([MEGIDDO, MINERVA]));
    expect(s.players.me.circles.vc!.key).toBe(NIGHT_FOG);
  });
});

describe("ultimate stride: nation", () => {
  it("Megiddo (Magallanica) can't ultimate stride onto a Genesis vanguard", () => {
    game("ride", "stride");
    const me = s.players.me;
    me.circles = { vc: inst(ANGELICA) };
    me.gZone = [inst(MEGIDDO, false), inst(MINERVA), inst(MINERVA), inst(MINERVA)];
    me.hand = [inst(ANGELICA)];
    refreshAwaiting(s);
    expect(() => act("me", { type: "stride", gUid: me.gZone[0].uid, discardUids: [me.hand[0].uid] })).toThrow("err.ultimateCost");
  });

  it("cards know their nation: from content/nations.yaml, a nation clan field, or all (Cray Elemental)", () => {
    expect(db[NIGHT_FOG].nation).toBe("Magallanica");
    expect(db[MEGIDDO].nation).toBe("Magallanica");
    expect(db[SEBREEZE].nation).toBe("all");
    expect(db[ANGELICA].nation).toBeUndefined();
  });
});

describe("a boost lasts only while the booster stays on its circle", () => {
  it("Rampage Shade boosts the Nightrose vanguard, then puts itself into the soul: the vanguard keeps only the +5000", () => {
    game("battle", "attack");
    const rampage = inst("G-BT08/S32TH");
    s.players.me.circles = { vc: inst(NIGHT_FOG), back_center: rampage };
    refreshAwaiting(s);
    act("me", { type: "attack", attacker: "vc", target: "vc", booster: "back_center" });
    const power = () => s.players.me.circles.vc!.mods.filter((m) => m.stat === "power").reduce((n, m) => n + m.value, 0);
    expect(power()).toBe(4000);   // boosted
    act("me", { type: "order-queue", index: 0 });
    for (let i = 0; i < 5 && s.awaiting?.player === "me" && s.awaiting.choice?.kind === "yesno"; i++) act("me", { type: "choose", option: "yes" });
    expect(s.players.me.soul.map((c) => c.uid)).toContain(rampage.uid);
    expect(power()).toBe(5000);   // the boost is gone, Rampage Shade's +5000 stays
  });
});

describe("an optional ability whose every step would do nothing isn't offered", () => {
  it("Night Fog Nightrose [AUTO 1] about a card that has left the drop zone: skipped; with the card still there: offered", () => {
    game("main");
    const vc = inst(NIGHT_FOG), tommy = inst(HEMERA);
    s.players.me.circles = { vc };
    s.players.me.gZone = [inst(MINERVA, true), inst(MINERVA, true)];
    const entry = { owner: "me" as const, uid: vc.uid, key: "0", ability: db[NIGHT_FOG].abilities[0], label: "Night Fog [AUTO 1]", optional: true,
      event: { kind: "move" as const, player: "me" as const, uid: tommy.uid, key: tommy.key, from: "RC" as const, to: "drop" as const, grants: [] } };
    s.players.me.drop = [tommy];
    expect(blocked(db, s, entry)).toBeUndefined();
    s.players.me.drop = [];
    s.players.me.deck.unshift(tommy);   // e.g. returned to the deck by its own ability first
    expect(blocked(db, s, entry)?.key).toBe("reason.nothingToDo");
  });
});
