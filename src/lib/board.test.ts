import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame, refreshAwaiting } from "../engine/game";
import type { CardInstance, GameState } from "../engine/types";
import { abilitiesStarted } from "./board";

const regalia = presetDecks.find((d) => d.id === "regalia-minerva")!;
const ANGELICA = "G-BT14/020TH", NORN = "EB12/012TH", GENIL = "G-BT14/067TH";

describe("abilitiesStarted", () => {
  it("the other side's ability: its card, its tag, and the card text of that ability", () => {
    let s: GameState = createGame(db, { seed: 5, firstPlayer: "me", decks: { me: regalia, bot: regalia } });
    s = apply(db, s, "me", { type: "mulligan", returnUids: [] }).state;
    s = apply(db, s, "bot", { type: "mulligan", returnUids: [] }).state;
    const inst = (key: string): CardInstance => ({ uid: "t" + s.nextUid++, key, rested: false, faceUp: true, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
    const angelica = inst(ANGELICA);
    Object.assign(s, { turn: 3, turnPlayer: "me", phase: "ride", step: "ride", queue: [] });
    s.players.me.circles = { vc: inst(GENIL) };
    s.players.me.hand.push(angelica);
    s.players.me.drop = [inst(NORN)];
    refreshAwaiting(s);
    s = apply(db, s, "me", { type: "ride", uid: angelica.uid }).state;
    const r = apply(db, s, "me", { type: "order-queue", index: 0 });
    const shown = abilitiesStarted(db, r.events, r.state, "me");
    expect(shown).toHaveLength(1);
    expect(shown[0].inst.uid).toBe(angelica.uid);
    expect(shown[0].tag).toBe("[AUTO 1]");
    expect(shown[0].text).toContain("When this unit is placed on (VC)");
    expect(abilitiesStarted(db, r.events, r.state, "bot")).toHaveLength(0);
  });
});
