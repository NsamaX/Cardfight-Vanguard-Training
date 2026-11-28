// @vitest-environment jsdom
// useMatch against a fake server: Realtime pushes and polls racing, failed sends
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action } from "../engine/types";
import type { OnlineMatch } from "../lib/online";
import type { RecordedAction } from "../replay/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = { seq: number; rec: RecordedAction };
const server = vi.hoisted(() => ({
  rows: [] as { seq: number; rec: RecordedAction }[],
  fetches: [] as { from: number; resolve: () => void }[],   // polls waiting for the test to let them answer
  push: undefined as undefined | ((seq: number, rec: RecordedAction) => void),
  inserts: [] as number[],
  failNext: 0,                 // inserts to refuse before one goes through
  storeAnyway: false,          // a refused insert still stores the row (only the answer was lost)
  told: 0,                     // out-of-sync messages sent to the other client
}));

vi.mock("../lib/online", () => ({
  fetchMatch: () => new Promise(() => {}),
  fetchActionRows: (_id: string, _host: string, from: number) => new Promise<Row[]>((ok) => {
    server.fetches.push({ from, resolve: () => ok(server.rows.filter((r) => r.seq >= from)) });
  }),
  sendAction: async (_id: string, seq: number, action: Action) => {
    server.inserts.push(seq);
    if (server.failNext > 0) {
      server.failNext--;
      if (server.storeAnyway) server.rows.push({ seq, rec: { player: "me", action: JSON.parse(JSON.stringify(action)) } });
      throw new Error("network");
    }
    if (server.rows.some((r) => r.seq === seq)) throw new Error("duplicate key");
    server.rows.push({ seq, rec: { player: "me", action } });
  },
  watchMatch: (_id: string, _host: string, on: { action: (seq: number, rec: RecordedAction) => void }) => {
    server.push = on.action;
    return { stop: () => {}, outOfSync: () => { server.told++; } };
  },
}));

const { useMatch } = await import("./useMatch");

const match = { id: "m", host: "h", seat: "me", opponent: "Guest", decks: {}, cards: [], status: "playing", ready: { me: false, bot: false }, abandoned: false } as unknown as OnlineMatch;
const step = (n: number): RecordedAction => ({ player: "bot", action: { type: "next-phase", n } as unknown as Action });
const mine = (n: number): RecordedAction => ({ player: "me", action: { type: "next-phase", n } as unknown as Action });

let root: Root, host: HTMLDivElement, live: ReturnType<typeof useMatch>;
function Probe() { live = useMatch({ match, actions: [] }, "h", []); return null; }

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(server, { rows: [], fetches: [], inserts: [], failNext: 0, storeAnyway: false, told: 0 });
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root.render(<Probe />));
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });

const answerPolls = async () => { const f = server.fetches.splice(0); await act(async () => { f.forEach((x) => x.resolve()); }); };
const poll = async () => { await act(async () => { vi.advanceTimersByTime(3000); }); await answerPolls(); };

describe("useMatch", () => {
  it("an action that arrives through Realtime while a poll for it is on its way is kept once", async () => {
    server.rows.push({ seq: 0, rec: step(0) });
    await act(async () => { vi.advanceTimersByTime(3000); });   // the poll asks for seq 0 on
    await act(async () => { server.push!(0, step(0)); });       // Realtime delivers seq 0 first
    server.rows.push({ seq: 1, rec: step(1) });
    await answerPolls();                                         // the poll answers 0 and 1
    expect(live.actions).toEqual([step(0), step(1)]);
  });

  it("a failed insert is retried, and a later action waits for it", async () => {
    server.failNext = 1;
    act(() => live.send([mine(0)]));
    act(() => live.send([mine(1)]));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(server.inserts).toEqual([0]);                         // seq 1 is not sent while seq 0 is not stored
    await answerPolls();                                         // the check after the failure: nothing at seq 0
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(server.inserts).toEqual([0, 0, 1]);
    expect(server.rows.map((r) => r.seq)).toEqual([0, 1]);
    expect(live.problem).toBeUndefined();
  });

  it("an insert that was stored though its answer was lost counts as sent", async () => {
    server.failNext = 1;
    server.storeAnyway = true;
    act(() => live.send([mine(0)]));
    act(() => live.send([mine(1)]));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await answerPolls();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(server.inserts).toEqual([0, 1]);
    expect(live.problem).toBeUndefined();
  });

  it("when an insert keeps failing, nothing after it is sent and both players are told", async () => {
    server.failNext = 99;
    act(() => live.send([mine(0)]));
    act(() => live.send([mine(1)]));
    for (let i = 0; i < 4; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await answerPolls();
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    expect(server.inserts).toEqual([0, 0, 0, 0]);
    expect(live.problem).toBe("online.sendFailed");
    expect(server.told).toBe(1);
  });

  it("a seq that stays missing while a later one is stored stops the match on this side and tells the other", async () => {
    server.rows.push({ seq: 0, rec: step(0) }, { seq: 2, rec: step(2) });
    for (let i = 0; i < 2; i++) await poll();
    expect(live.actions).toEqual([step(0)]);
    expect(live.problem).toBeUndefined();
    await poll();
    expect(live.problem).toBe("online.desync");
    expect(server.told).toBe(1);
  });
});
