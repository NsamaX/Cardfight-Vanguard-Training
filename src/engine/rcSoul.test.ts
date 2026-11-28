// A rear-guard's own soul: RC-SC puts cards under the unit, RC-SB pays from them, they move with the unit and leave with it
import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame, refreshAwaiting } from "./game";
import { retireUnit } from "./zones";
import type { Ability, Action, CardInstance, GameState, PlayerId } from "./types";

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const GUN = "G-BT06/087TH", MIST = "G-CHB03/S11TH";
let s: GameState;
const act = (p: PlayerId, a: Action) => { s = apply(db, s, p, a).state; };
const inst = (key: string): CardInstance => ({ uid: "t" + s.nextUid++, key, rested: false, faceUp: true, hollowed: false, mods: [], usedThisTurn: [], grants: [] });

// Our main phase with a rear-guard on front left that has two granted ACTs: [0] RC-SC(2), [1] RC-SB(1) to draw a card
function setup() {
  s = createGame(db, { seed: 3, firstPlayer: "me", decks: { me: deck, bot: deck } });
  act("me", { type: "mulligan", returnUids: [] });
  act("bot", { type: "mulligan", returnUids: [] });
  const charge: Ability = { kind: "ACT", zone: "RC", effect: ["RC-SC(2)"] };
  const blast: Ability = { kind: "ACT", zone: "RC", cost: ["RC-SB(1)"], effect: ["draw(1)"] };
  const gun = inst(GUN);
  gun.grants = [charge, blast];
  s.players.me.circles = { vc: inst(MIST), front_left: gun };
  Object.assign(s, { turn: 3, turnPlayer: "me", phase: "main", step: undefined, queue: [], resume: undefined });
  refreshAwaiting(s);
  return gun.uid;
}
const granted = (i: number) => db[GUN].abilities.length + i;
const unit = () => s.players.me.circles.front_left;

describe("rear-guard soul", () => {
  it("RC-SC puts the top cards of the deck under the unit; it moves with the unit; RC-SB pays from it", () => {
    const uid = setup();
    const top = s.players.me.deck.slice(0, 2).map((c) => c.uid);
    act("me", { type: "activate", cardUid: uid, abilityIndex: granted(0) });
    expect(unit()!.soul!.map((c) => c.uid)).toEqual(top);
    expect(s.players.me.soul.some((c) => top.includes(c.uid))).toBe(false);   // not the vanguard's soul

    act("me", { type: "move", from: "front_left", to: "back_left" });
    expect(s.players.me.circles.back_left!.soul).toHaveLength(2);

    const hand = s.players.me.hand.length;
    act("me", { type: "activate", cardUid: uid, abilityIndex: granted(1) });
    act("me", { type: "select-target", uids: [top[1]] });               // two under it: choose which one
    expect(s.players.me.circles.back_left!.soul!.map((c) => c.uid)).toEqual([top[0]]);
    expect(s.players.me.drop.map((c) => c.uid)).toContain(top[1]);
    expect(s.players.me.hand).toHaveLength(hand + 1);
  });

  it("the cards under a rear-guard go to the drop zone when it leaves the field", () => {
    const uid = setup();
    act("me", { type: "activate", cardUid: uid, abilityIndex: granted(0) });
    const under = unit()!.soul!.map((c) => c.uid);
    retireUnit(db, s, "me", "front_left", [], { key: "reason.cost" });
    expect(s.players.me.drop.map((c) => c.uid)).toEqual(expect.arrayContaining([...under, uid]));
  });

  it("RC-SB can't be paid without enough cards under the unit", () => {
    const uid = setup();
    expect(() => act("me", { type: "activate", cardUid: uid, abilityIndex: granted(1) })).toThrow();
  });
});
