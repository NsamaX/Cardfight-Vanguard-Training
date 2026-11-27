import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../../data/cards";
import { presetDecks } from "../../data/decks";
import { apply, refreshAwaiting } from "../../engine/game";
import { labBoard } from "./board";
import { DEFAULT_FIND, findLines } from "./find";
import { replayTimeline } from "../../replay/play";
import { comboName, describeLine, shortNames, stepText } from "./notation";

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const board = () => labBoard(db, deck, {
  name: "test", vc: "G-CHB03/S11TH",
  hand: ["G-BT06/083TH", "G-BT06/040TH", "G-CHB03/S12TH", "G-CP06/019TH"],
  drop: ["G-CP06/019TH", "PR/0256TH", "G-BT06/083TH", "G-TD08/007TH"],
  soul: ["G-BT06/040TH", "G-CHB03/S12TH", "PR/0632TH"], cb: 4, damage: 5, gFaceUp: 2,
});

describe("combo lab", () => {
  it("builds a board at the stride step with the chosen cards and resources", () => {
    const s = board();
    const me = s.players.me;
    expect(s.awaiting).toMatchObject({ player: "me", kind: "next-phase" });
    expect(s.step).toBe("stride");
    expect(me.damage.filter((d) => d.faceUp)).toHaveLength(4);
    expect(me.gZone.filter((g) => g.faceUp)).toHaveLength(2);
    expect(me.deck.some((c) => db[c.key].trigger)).toBe(false);
    expect(me.drop.map((c) => c.key)).toContain("PR/0256TH");
  });

  it("checks reveal triggers without their effect, even a trigger put back into the deck during the turn", () => {
    let s = board();
    s.players.me.deck.unshift({ uid: "mick", key: "PR/0564TH", rested: false, faceUp: false, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
    Object.assign(s, { phase: "battle", step: "attack" });
    refreshAwaiting(s);
    s = apply(db, s, "me", { type: "attack", attacker: "vc", target: "vc" }).state;
    const r = apply(db, s, "bot", { type: "end-guard" });
    expect(r.events.some((e) => e.code === "drive-check" && e.cardUid === "mick")).toBe(true);
    expect(r.events.some((e) => e.code === "trigger")).toBe(false);
    expect(r.state.awaiting?.kind).not.toBe("trigger-target");
  });

  it("finds a whole-turn line that strides, calls back from the drop, and attacks more than the board alone allows", () => {
    const s = board();
    const [best] = findLines(db, s, { ...DEFAULT_FIND, goal: "attacks", beam: 3, ms: 20_000, top: 1 });
    expect(best.result.attacks.length).toBeGreaterThanOrEqual(4);
    const steps = describeLine(db, s, best);
    expect(steps.filter((x) => x.attack)).toHaveLength(best.result.attacks.length);
    expect(steps.some((x) => x.items.some((it) => it.kind === "move" && it.from === "DROP" && it.to.startsWith("RC")))).toBe(true);

    // Text guide: short names, one sentence per step, attacks spelled out
    const name = shortNames(db, Object.keys(deck.main));
    expect(name("G-CHB03/S11TH")).toBe("Night Fog Nightrose");
    expect(name("G-BT06/083TH")).toBe("Nightstorm");
    expect(comboName(steps, name)).not.toBe("");
    expect(steps.filter((x) => x.attack).map((x) => stepText(x, name)).every((t) => t.startsWith("Attack: "))).toBe(true);

    // The line plays back as a replay from the lab board
    const t = replayTimeline(db, { version: 1, id: "t", createdAt: "", title: "t", seed: s.seed, firstPlayer: s.firstPlayer, decks: { me: deck, bot: deck },
      start: s, actions: best.actions.map(({ p, a }) => ({ player: p, action: a })), turn: s.turn });
    expect(t.brokenAt).toBeUndefined();
    expect(t.states).toHaveLength(best.actions.length + 1);
  }, 60_000);
});
