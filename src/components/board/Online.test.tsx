// @vitest-environment jsdom
// Two boards playing one online match, with the server replaced by a shared action list
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardByKey as db } from "../../data/cards";
import { presetDecks } from "../../data/decks";
import { apply, createGame, refreshAwaiting } from "../../engine/game";
import type { Card, Deck, GameState, PlayerId } from "../../engine/types";
import { FixedText } from "../../i18n/react";
import { OnlineError, matchCards, problemOf } from "../../lib/online";
import type { RecordedAction } from "../../replay/types";
import { Board } from "./Board";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
let root: Root, host: HTMLDivElement;

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const noop = () => {};

function Pair({ s }: { s: GameState }) {
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const send = (done: RecordedAction[]) => setActions((a) => a.concat(done));
  const board = (seat: PlayerId, opponent: string) => (
    <div className={`client-${seat}`}>
      <FixedText value={seat === "me" ? { "player.bot": opponent } : { "player.me": opponent, "player.bot": "You" }}>
        <Board initial={s} started onStart={noop} settings={{ seed: s.seed, firstPlayer: s.firstPlayer }} decks={{ me: deck, bot: deck }} deckOpen={false} onDeckOpen={noop}
          onNewGame={noop} onApplySettings={noop} onSwapDecks={noop} onPickDeck={noop} onDeckChanged={noop}
          online={{ seat, actions, send, opponent, ready: { me: false, bot: false }, abandoned: false, onReady: noop, onLeave: noop, onFinished: noop }} />
      </FixedText>
    </div>
  );
  return <>{board("me", "Guest")}{board("bot", "Host")}</>;
}

const client = (seat: PlayerId) => host.querySelector(`.client-${seat}`)!;
const button = (seat: PlayerId, text: string) => [...client(seat).querySelectorAll("button")].find((b) => b.textContent?.includes(text));
const titles = (seat: PlayerId, pos: "me" | "bot") => [...client(seat).querySelectorAll(`.hand.${pos} .card`)].map((c) => c.getAttribute("title"));

describe("online match", () => {
  it("each player sees their own side at the bottom, the other's hand face down, and moves made on one board reach the other", () => {
    const s = createGame(db, { seed: 5, firstPlayer: "me", decks: { me: deck, bot: deck } });
    act(() => root.render(<Pair s={s} />));
    const hostHand = s.players.me.hand.map((c) => db[c.key].name), guestHand = s.players.bot.hand.map((c) => db[c.key].name);

    expect(titles("me", "me")).toEqual(hostHand);
    expect(titles("me", "bot").every((t) => t === "Face-down card")).toBe(true);
    expect(titles("bot", "me")).toEqual(guestHand);
    expect(titles("bot", "bot").every((t) => t === "Face-down card")).toBe(true);

    // The host mulligans first; the guest only waits
    expect(button("bot", "Confirm")).toBeUndefined();
    expect(client("bot").textContent).toContain("Host's move");
    act(() => button("me", "Confirm")!.click());
    expect(button("me", "Confirm")).toBeUndefined();
    expect(client("me").textContent).toContain("Guest's move");
    act(() => button("bot", "Confirm")!.click());

    for (const seat of ["me", "bot"] as const) expect(client(seat).querySelector(".ph.on")!.textContent).toBe("RIDE");
    expect(button("me", "Skip")).toBeTruthy();       // the host's turn: only the host has the step button
    expect(button("bot", "Skip")).toBeUndefined();
    expect(client("bot").querySelector(".log")!.textContent).toContain("Host");
    expect(client("bot").querySelector(".log")!.textContent).not.toContain("Bot");
    expect(client("me").querySelector(".mid-history button")).toBeTruthy();
    expect([...client("me").querySelectorAll(".mid-history button")].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);   // no undo online
  });
});

describe("hidden information online", () => {
  it("the opponent's face-down G zone can't be opened; your own can", () => {
    const s = createGame(db, { seed: 5, firstPlayer: "me", decks: { me: deck, bot: deck } });
    act(() => root.render(<Pair s={s} />));
    const open = (pos: "me" | "bot") => act(() => [...client("me").querySelectorAll<HTMLElement>(".zone-row.gZone .zone-slot")].find((z) => z.closest(`.${pos}`))!.click());
    const shown = () => host.querySelectorAll(".modal .card").length;
    open("bot");
    expect(host.textContent).toContain("The opponent's G zone is face down");
    expect(shown()).toBe(0);
    act(() => host.querySelector<HTMLButtonElement>(".modal .mh button")!.click());
    open("me");
    expect(shown()).toBe(s.players.me.gZone.length);
  });

  it("only the trigger's owner can pick it up; the other player's click just inspects it", () => {
    let s = createGame(db, { seed: 5, firstPlayer: "me", decks: { me: deck, bot: deck } });
    s = apply(db, s, "me", { type: "mulligan", returnUids: [] }).state;
    s = apply(db, s, "bot", { type: "mulligan", returnUids: [] }).state;
    const crit = s.players.me.deck.findIndex((c) => db[c.key].trigger === "critical");
    s.players.me.deck.unshift(...s.players.me.deck.splice(crit, 1));
    s.players.me.circles = { vc: s.players.me.circles.vc };
    Object.assign(s, { turn: 3, turnPlayer: "me", phase: "battle", step: "attack", queue: [] });
    refreshAwaiting(s);
    s = apply(db, s, "me", { type: "attack", attacker: "vc", target: "vc" }).state;
    s = apply(db, s, "bot", { type: "end-guard" }).state;
    expect(s.awaiting?.kind).toBe("trigger-target");
    act(() => root.render(<Pair s={s} />));
    const trigger = (seat: PlayerId) => client(seat).querySelector<HTMLElement>(".bside.left .card")!;
    act(() => trigger("bot").click());
    expect(trigger("bot").className).not.toMatch(/active|source/);
    expect(trigger("me").className).toContain("source");
    act(() => trigger("me").click());
    expect(trigger("me").className).toContain("active");
  });
});

describe("online room between games", () => {
  const online = (over: object) => ({ seat: "bot" as PlayerId, actions: [], send: noop, opponent: "Host", ready: { me: false, bot: false }, abandoned: false, onReady: noop, onLeave: noop, onFinished: noop, ...over });
  const renderBoard = (s: GameState, started: boolean, on: object, onStart = noop) => act(() => root.render(
    <Board initial={s} started={started} onStart={onStart} settings={{ seed: s.seed, firstPlayer: s.firstPlayer }} decks={{ me: deck, bot: deck }} deckOpen={false} onDeckOpen={noop}
      onNewGame={noop} onApplySettings={noop} onSwapDecks={noop} onPickDeck={noop} onDeckChanged={noop} online={online(on)} />));
  const footer = () => [...host.querySelectorAll(".game-menu .menu-item")].map((b) => b.getAttribute("aria-label"));
  const find = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined;

  it("before Start: Start in the middle, Decks next to Leave, and Start stays pressed until the other player presses it too", () => {
    const s = createGame(db, { seed: 1, firstPlayer: "me", decks: { me: deck, bot: deck } });
    let pressed = 0;
    renderBoard(s, false, {}, () => pressed++);
    expect(footer()).toEqual(["Decks", "Leave", "Board only"]);
    act(() => find("Start")!.click());
    expect(pressed).toBe(1);
    renderBoard(s, false, { ready: { me: false, bot: true } });
    expect(find("Start")!.disabled).toBe(true);
    expect(host.textContent).toContain("Waiting for Host");
    renderBoard(s, false, { ready: { me: true, bot: false } });
    expect(host.textContent).toContain("Host is ready");
  });

  it("after the game: Ready on the right of the middle bar, gone once the other player has left", () => {
    const s = createGame(db, { seed: 1, firstPlayer: "me", decks: { me: deck, bot: deck } });
    s.winner = "me";
    s.awaiting = undefined;
    let ready = 0;
    renderBoard(s, true, { onReady: () => ready++ });
    expect(footer()).toEqual(["Leave", "Board only"]);
    act(() => host.querySelector<HTMLButtonElement>(".mid-actions button")!.click());
    expect(ready).toBe(1);
    expect(host.querySelector(".mid-actions")!.textContent).toBe("Ready");
    renderBoard(s, true, { abandoned: true });
    expect(host.querySelector(".mid-actions button")).toBeNull();
    expect(host.textContent).toContain("Host left the match");
  });
});

describe("matchCards", () => {
  const card = (key: string, power: number): Card => ({ ...db[deck.starter], key, power });
  const guestDeck: Deck = { ...deck, starter: "A", main: { A: 1, B: 49 }, g_zone: {}, cover: "B" };

  it("keeps a guest card the host also uses with the same data, and renames one whose data differs", () => {
    const { cards, guestDeck: d } = matchCards([card("A", 5000), card("B", 6000)], [card("A", 5000), card("B", 9000)], guestDeck);
    expect(cards.map((c) => [c.key, c.power])).toEqual([["A", 5000], ["B", 6000], ["B~2", 9000]]);
    expect(d.main).toEqual({ A: 1, "B~2": 49 });
    expect(d.cover).toBe("B~2");
    expect(d.starter).toBe("A");
  });
});

describe("problemOf", () => {
  it("names a missing migration, and shows the server's own message for other errors", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(problemOf({ code: "42703", message: "column matches.host_ready does not exist" })).toEqual({ key: "online.notMigrated" });
    expect(problemOf({ code: "PGRST202", message: "Could not find the function public.join_match" })).toEqual({ key: "online.notMigrated" });
    expect(problemOf({ message: "Failed to fetch" })).toEqual({ key: "online.failedBecause", params: { reason: "Failed to fetch" } });
    expect(problemOf(new OnlineError("online.notFound"))).toEqual({ key: "online.notFound" });
    quiet.mockRestore();
  });
});
