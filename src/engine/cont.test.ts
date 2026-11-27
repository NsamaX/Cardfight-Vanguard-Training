import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { guardianDiscardFilter, refreshContinuous, strideCostGrade, strideGradeNeeded } from "./cont";
import { apply, createGame, refreshAwaiting } from "./game";
import { powerOf } from "./rules";
import type { Card, CardInstance, GameState } from "./types";

const regalia = presetDecks.find((d) => d.id === "regalia-minerva")!;
const WHALE = "MB/065TH", INANNA = "G-BT14/019TH", ANGELICA = "G-BT14/020TH", HEMERA = "EB12/006TH", FLAP = "G-BT14/039TH";

let s: GameState;
const inst = (key: string, faceUp = true): CardInstance => ({ uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
const newGame = () => { s = createGame(db, { seed: 3, firstPlayer: "me", decks: { me: regalia, bot: regalia } }); };

describe("CONT abilities", () => {
  it("Zombie Whale: Power-3000 while the drop zone has 5 or fewer cards, and back when it has more", () => {
    const whale = WHALE;
    newGame();
    s.players.me.circles.front_left = inst(whale);
    const base = db[whale].power!;
    refreshContinuous(db, s);
    expect(powerOf(db, s.players.me, "front_left")).toBe(base - 3000);
    s.players.me.drop = s.players.me.deck.splice(0, 6);
    refreshContinuous(db, s);
    expect(powerOf(db, s.players.me, "front_left")).toBe(base);
  });

  it("Inanna (GB3): every rear-guard gets Power+2000 for each card with Revelation in the soul", () => {
    newGame();
    const me = s.players.me;
    me.circles = { vc: inst(INANNA), front_left: inst(HEMERA), back_left: inst(HEMERA) };
    me.heart = inst(ANGELICA);
    me.gZone = [inst(INANNA), inst(INANNA)];   // with Inanna on VC: GB3
    const revelation = "TEST/REVELATION-CONT";
    db[revelation] = { ...db[HEMERA], key: revelation, abilities: [{ kind: "AUTO", effect: ["keyword(Revelation)"] }] } as Card;
    me.soul = [inst(revelation), inst(revelation), inst(HEMERA)];
    refreshContinuous(db, s);
    expect(powerOf(db, me, "front_left")).toBe(9000 + 4000);
    expect(powerOf(db, me, "back_left")).toBe(9000 + 4000);
    me.gZone = [inst(INANNA)];   // GB2: the bonus goes away
    refreshContinuous(db, s);
    expect(powerOf(db, me, "front_left")).toBe(9000);
    delete db[revelation];
  });
});

describe("rules read from the card", () => {
  it("stride cost: the grade total comes from the G unit's STRIDE ability, and Flap Angel counts as grade 3 while paying it", () => {
    newGame();
    expect(strideGradeNeeded(db["G-BT14/009TH"])).toBe(3);
    expect(strideGradeNeeded({ ...db["G-BT14/009TH"], abilities: [{ kind: "STRIDE", cost: ["discard(n, grade-sum≥4)"], effect: ["stride(self)"] }] })).toBe(4);
    expect(strideCostGrade(db, s, "me", inst(FLAP))).toBe(3);
    expect(strideCostGrade(db, s, "me", inst(HEMERA))).toBe(2);
  });

  it("G guardian: the discarded card follows the card's G GUARDIAN cost", () => {
    const eir = db["G-BT14/036TH"];
    expect(guardianDiscardFilter(eir)).toBe("heal");
    const custom = { ...eir, key: "TEST/GG", abilities: [{ kind: "G GUARDIAN" as const, timing: "step(guard, opp)", cost: ["discard(1, filter=grade-2)"], effect: ["call(G→GC, self)"] }] };
    db[custom.key] = custom;
    newGame();
    const me = s.players.me, bot = s.players.bot;
    me.circles = { vc: inst(ANGELICA) };
    bot.circles = { vc: inst(ANGELICA) };
    const g = inst(custom.key, false), hemera = inst(HEMERA);
    bot.gZone = [g];
    bot.hand = [hemera];
    me.deck.unshift(inst(HEMERA), inst(HEMERA));
    Object.assign(s, { turn: 5, turnPlayer: "me", phase: "battle", step: "attack" });
    refreshAwaiting(s);
    s = apply(db, s, "me", { type: "attack", attacker: "vc", target: "vc" }).state;
    s = apply(db, s, "bot", { type: "call-g-guardian", gUid: g.uid, discardUid: hemera.uid }).state;
    expect(s.players.bot.guardian.map((c) => c.key)).toEqual([custom.key]);
    delete db[custom.key];
  });
});
