// Turns a replay into a sequence of boards for the replay viewer to step through
import { apply, createGame } from "../engine/game";
import { RuleError, type CardDB } from "../engine/rules";
import type { GameState } from "../engine/types";
import type { LogEntry } from "../lib/board";
import type { Replay, ReplaySource, StatesFile } from "./types";

export interface Timeline {
  states: GameState[];
  log: LogEntry[];
  logAt: number[];           // number of history lines at each step
  brokenAt?: number;         // this action can't be applied under the current rules (rules changed after saving); replays up to the step before
}

export function replayTimeline(db: CardDB, r: Replay): Timeline {
  let s = r.start ? structuredClone(r.start) : createGame(db, { seed: r.seed, decks: r.decks, firstPlayer: r.firstPlayer });
  const t: Timeline = { states: [s], log: [], logAt: [0] };
  for (let i = 0; i < r.actions.length; i++) {
    try {
      const res = apply(db, s, r.actions[i].player, r.actions[i].action);
      s = res.state;
      t.log.push(...res.events.map((e) => ({ ...e, turn: s.turn })));
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      t.brokenAt = i;
      break;
    }
    t.states.push(s);
    t.logAt.push(t.log.length);
  }
  return t;
}

// A states file doesn't know which history line happened at which step, so it shows the history up to that board's turn
export function statesTimeline(f: StatesFile): Timeline {
  return { states: f.states, log: f.log, logAt: f.states.map((s) => f.log.filter((e) => e.turn <= s.turn).length) };
}

export const timelineOf = (db: CardDB, src: ReplaySource) => ("kind" in src ? statesTimeline(src) : replayTimeline(db, src));

export function parseReplayFile(text: string): ReplaySource | undefined {
  try {
    const v = JSON.parse(text);
    if (v?.kind === "states" && Array.isArray(v.states) && v.states.length && v.decks) return v as StatesFile;
    if (v?.version === 1 && Array.isArray(v.actions) && v.decks && typeof v.seed === "number") return v as Replay;
  } catch {
    // not JSON
  }
  return undefined;
}

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
