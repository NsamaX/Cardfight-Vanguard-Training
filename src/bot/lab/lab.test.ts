import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../../data/cards";
import { presetDecks } from "../../data/decks";
import { labBoard } from "./board";
import { DEFAULT_FIND, findLines } from "./find";
import { describeLine } from "./notation";

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

  it("finds a whole-turn line that strides, calls back from the drop, and attacks more than the board alone allows", () => {
    const s = board();
    const [best] = findLines(db, s, { ...DEFAULT_FIND, goal: "attacks", beam: 3, ms: 20_000, top: 1 });
    expect(best.result.attacks.length).toBeGreaterThanOrEqual(4);
    const steps = describeLine(db, s, best);
    expect(steps.filter((x) => x.attack)).toHaveLength(best.result.attacks.length);
    expect(steps.some((x) => x.items.some((it) => it.kind === "move" && it.from === "DROP" && it.to.startsWith("RC")))).toBe(true);
  }, 60_000);
});
