import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame } from "../engine/game";
import type { GameState } from "../engine/types";
import { VanguardBot } from "../bot";
import { parseReplayFile, replayTimeline, statesTimeline } from "./play";
import type { RecordedAction, Replay } from "./types";

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const decks = { me: deck, bot: deck };

// เล่นทั้งเกมด้วยบอท แล้วเก็บ action ทุกก้าวเป็น replay
async function recorded(seed: number) {
  const bots = { me: new VanguardBot(db, "normal", decks, 1), bot: new VanguardBot(db, "normal", decks, 2) };
  let s = createGame(db, { seed, decks, firstPlayer: "me" });
  const actions: RecordedAction[] = [];
  const states: GameState[] = [s];
  while (!s.winner && s.awaiting) {
    const p = s.awaiting.player;
    const action = await bots[p].decide(s, s.awaiting);
    s = apply(db, s, p, action).state;
    actions.push({ player: p, action });
    states.push(s);
  }
  const r: Replay = { version: 1, id: "t", createdAt: "", title: "", seed, firstPlayer: "me", decks, actions, winner: s.winner, turn: s.turn };
  return { r, states };
}

describe("replay", () => {
  it("เล่นซ้ำจาก seed + action ได้สนามตรงกับเกมจริงทุกก้าว", async () => {
    const { r, states } = await recorded(21);
    const tl = replayTimeline(db, r);
    expect(tl.brokenAt).toBeUndefined();
    expect(tl.states).toHaveLength(states.length);
    expect(tl.states.at(-1)).toEqual(states.at(-1));
    expect(tl.states[40]).toEqual(states[40]);
    expect(tl.logAt.at(-1)).toBe(tl.log.length);
  });

  it("เล่นต่อจากก้าวกลางเกม: replay ใหม่ = action ก่อนหน้า + action ใหม่ เล่นซ้ำได้ครบ", async () => {
    const { r, states } = await recorded(22);
    const step = 60;
    const s = states[step];
    const extra = { player: s.awaiting!.player, action: r.actions[step].action };
    const cont: Replay = { ...r, actions: [...r.actions.slice(0, step), extra] };
    expect(replayTimeline(db, cont).states.at(-1)).toEqual(states[step + 1]);
  });

  it("action ที่ใช้กับกฎปัจจุบันไม่ได้: หยุดที่ก้าวก่อนหน้า และบอกว่าหยุดตรงไหน", async () => {
    const { r } = await recorded(23);
    const broken: Replay = { ...r, actions: [...r.actions.slice(0, 5), { player: "me", action: { type: "ride", uid: "ไม่มี" } }, ...r.actions.slice(6)] };
    const tl = replayTimeline(db, broken);
    expect(tl.brokenAt).toBe(5);
    expect(tl.states).toHaveLength(6);
  });

  it("ไฟล์แบบ states: แสดงประวัติถึงเทิร์นของแต่ละก้าว", () => {
    const s1 = createGame(db, { seed: 1, decks, firstPlayer: "me" });
    const s2 = { ...s1, turn: 2 };
    const log = [{ code: "a", player: "me" as const, turn: 1, text: { key: "log.battleEnd" as const } }, { code: "b", player: "me" as const, turn: 2, text: { key: "log.battleEnd" as const } }];
    const tl = statesTimeline({ kind: "states", decks, states: [{ ...s1, turn: 1 }, s2], log });
    expect(tl.logAt).toEqual([1, 2]);
  });

  it("อ่านไฟล์: รับ replay และไฟล์แบบ states ปฏิเสธไฟล์อื่น", () => {
    const r: Replay = { version: 1, id: "x", createdAt: "", title: "", seed: 1, firstPlayer: "me", decks, actions: [], turn: 0 };
    expect(parseReplayFile(JSON.stringify(r))).toMatchObject({ seed: 1 });
    expect(parseReplayFile(JSON.stringify({ kind: "states", decks, states: [createGame(db, { seed: 1, decks, firstPlayer: "me" })], log: [] }))).toMatchObject({ kind: "states" });
    expect(parseReplayFile("{}")).toBeUndefined();
    expect(parseReplayFile("not json")).toBeUndefined();
  });
});
