import { describe, expect, it } from "vitest";
import { cardByKey as db, cards } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame, refreshAwaiting, usableActs } from "./game";
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
    act("me", { type: "activate", cardUid: g.uid, abilityIndex: 1 });
    act("me", { type: "select-target", uids: [s.players.me.hand[0].uid] });
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
