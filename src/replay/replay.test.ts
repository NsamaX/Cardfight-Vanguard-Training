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

// Play a whole game with bots, then record every action as a replay
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
  it("replaying from seed + actions gives a board matching the real game at every step", async () => {
    const { r, states } = await recorded(21);
    const tl = replayTimeline(db, r);
    expect(tl.brokenAt).toBeUndefined();
    expect(tl.states).toHaveLength(states.length);
    expect(tl.states.at(-1)).toEqual(states.at(-1));
    expect(tl.states[40]).toEqual(states[40]);
    expect(tl.logAt.at(-1)).toBe(tl.log.length);
  });

  it("continuing from mid-game: new replay = earlier actions + new actions, fully replayable", async () => {
    const { r, states } = await recorded(22);
    const step = 60;
    const s = states[step];
    const extra = { player: s.awaiting!.player, action: r.actions[step].action };
    const cont: Replay = { ...r, actions: [...r.actions.slice(0, step), extra] };
    expect(replayTimeline(db, cont).states.at(-1)).toEqual(states[step + 1]);
  });

  it("an action that can't be applied under the current rules: stops at the step before and says where", async () => {
    const { r } = await recorded(23);
    const broken: Replay = { ...r, actions: [...r.actions.slice(0, 5), { player: "me", action: { type: "ride", uid: "missing" } }, ...r.actions.slice(6)] };
    const tl = replayTimeline(db, broken);
    expect(tl.brokenAt).toBe(5);
    expect(tl.states).toHaveLength(6);
  });

  it("states file: shows the history up to each step's turn", () => {
    const s1 = createGame(db, { seed: 1, decks, firstPlayer: "me" });
    const s2 = { ...s1, turn: 2 };
    const log = [{ code: "a", player: "me" as const, turn: 1, text: { key: "log.battleEnd" as const } }, { code: "b", player: "me" as const, turn: 2, text: { key: "log.battleEnd" as const } }];
    const tl = statesTimeline({ kind: "states", decks, states: [{ ...s1, turn: 1 }, s2], log });
    expect(tl.logAt).toEqual([1, 2]);
  });

  it("reading files: accepts replays and states files, rejects other files", () => {
    const r: Replay = { version: 1, id: "x", createdAt: "", title: "", seed: 1, firstPlayer: "me", decks, actions: [], turn: 0 };
    expect(parseReplayFile(JSON.stringify(r))).toMatchObject({ seed: 1 });
    expect(parseReplayFile(JSON.stringify({ kind: "states", decks, states: [createGame(db, { seed: 1, decks, firstPlayer: "me" })], log: [] }))).toMatchObject({ kind: "states" });
    expect(parseReplayFile("{}")).toBeUndefined();
    expect(parseReplayFile("not json")).toBeUndefined();
  });
});
