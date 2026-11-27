// @vitest-environment jsdom
// Simulates clicks on the real board: plays 2 turns from the mulligan through attacking and guarding
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardByKey as db } from "../../data/cards";
import { countCards, presetDecks } from "../../data/decks";
import { createGame, refreshAwaiting } from "../../engine/game";
import type { CardInstance, GameState } from "../../engine/types";
import { replayTimeline } from "../../replay/play";
import { loadReplays } from "../../replay/store";
import { ReplayViewer } from "../ReplayViewer";
import { Board } from "./Board";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const BONE = "G-BT06/040TH", GUN = "G-BT06/087TH", TOMMY = "G-CHB03/S12TH";
let root: Root, host: HTMLDivElement;

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const inst = (s: GameState, key: string): CardInstance =>
  ({ uid: "t" + s.nextUid++, key, rested: false, faceUp: true, hollowed: false, mods: [], usedThisTurn: [] });

function render(s: GameState, started = true) { act(() => root.render(<Board initial={s} started={started} onStart={() => {}} settings={{ seed: s.seed, firstPlayer: s.firstPlayer }} decks={{ me: deck, bot: deck }} deckOpen={false} onDeckOpen={() => {}}
  onNewGame={() => {}} onApplySettings={() => {}} onSwapDecks={() => {}} onPickDeck={() => {}} onDeckChanged={() => {}} />)); }
let autoDecline = true;
function rawClick(el: Element | undefined | null) {
  if (!el) throw new Error("nothing to click");
  act(() => (el as HTMLElement).click());
}
// Basic rules tests: if an ability asks a question, answer "No" / choose nothing automatically
function declineAll() {
  for (let i = 0; i < 30; i++) {
    const cmd = host.querySelector(".command");
    const modalOk = [...host.querySelectorAll(".modal button")].find((b) => b.textContent === "Confirm") as HTMLButtonElement | undefined;
    const no = [...(cmd?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "No" || b.textContent === "Skip");
    if (modalOk) {
      if (modalOk.disabled) rawClick(host.querySelector(".modal .card"));
      rawClick(modalOk);
    } else if (no) rawClick(no);
    else if (cmd?.textContent?.includes("resolves first")) rawClick(cmd.querySelector(".btn.primary"));
    else return;
  }
}
function click(el: Element | undefined | null) {
  rawClick(el);
  if (autoDecline) declineAll();
}
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
const modalCard = (name: string) => [...host.querySelectorAll(".modal .card")].find((c) => c.getAttribute("title") === name);
const slots = (side: 0 | 1) => host.querySelectorAll(".side")[side].querySelectorAll(".slot");   // 0 = bot, 1 = you
const handCard = (side: "me" | "bot", name: string) =>
  [...host.querySelectorAll(`.hand.${side} .card`)].find((c) => c.getAttribute("title") === name);
// Let the bot play until your turn (fake timers must be enabled before render)
async function botPlays() { await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); }
const pill = () => host.querySelector(".pill")!.textContent!;

// The 3 skipped tests use buttons in the command bar (.command) and status pills (.pill), which were removed; fix them once the new action system lands
describe("board", () => {
  it.skip("plays by hand: mulligan, ride, call, end turn, attack, guard", () => {
    const s = createGame(db, { seed: 3, firstPlayer: "me", decks: { me: deck, bot: deck } });
    s.players.me.hand.push(inst(s, BONE), inst(s, TOMMY));
    s.players.bot.hand.push(inst(s, BONE), inst(s, BONE));
    s.players.me.deck.unshift(inst(s, GUN));                        // turn 1 draw
    s.players.bot.deck.unshift(inst(s, GUN), inst(s, GUN));         // turn 2 draw + drive check
    render(s);

    // Mulligan: neither side redraws
    expect(pill()).toContain("Waiting for you");
    click(button("Confirm"));
    expect(pill()).toContain("Waiting for bot");
    click(button("Confirm"));
    expect(host.textContent).toContain("TURN 1");

    // Our turn 1: ride Negrobone to VC
    click(handCard("me", db[BONE].name));
    click(slots(1)[1]);
    expect(slots(1)[1].querySelector(".card")!.getAttribute("title")).toBe(db[BONE].name);

    // Main phase: call Tommy to front-left RC / calling the Cannoneer (grade 2) isn't allowed and shows a warning
    click(button("To stride step"));
    click(button("To main phase"));
    click(handCard("me", db[TOMMY].name));
    click(slots(1)[0]);
    expect(slots(1)[0].querySelector(".card")!.getAttribute("title")).toBe(db[TOMMY].name);
    click(handCard("me", db[GUN].name));
    click(slots(1)[2]);
    expect(host.querySelector(".toast")?.textContent).toContain("grade no higher than your vanguard");

    // Battle: can't attack on the first turn, end turn
    click(button("To battle phase"));
    click(slots(1)[1]);
    click(slots(0)[4]);
    expect(host.querySelector(".toast")?.textContent).toContain("first turn");
    click(button("End →"));
    expect(host.textContent).toContain("Bot's turn");

    // The bot's turn 2: ride, then attack our VC
    click(handCard("bot", db[BONE].name));
    click(slots(0)[4]);
    click(button("To stride step"));
    click(button("To main phase"));
    click(button("To battle phase"));
    click(slots(0)[4]);
    click(slots(1)[1]);
    expect(pill()).toContain("Waiting for you");
    expect(host.querySelector(".battle")!.textContent).toContain("7,000");

    // We guard with the Cannoneer (Shield 5000): 7000 vs 7000+5000, no hit
    click(handCard("me", db[GUN].name));
    expect(host.querySelector(".battle")!.textContent).toContain("No hit");
    click(button("End guard"));
    expect(host.querySelector(".pip.up")).toBeNull();               // no damage taken
    expect(pill()).toContain("Waiting for bot");
    expect(host.querySelector(".log")!.textContent).toContain("No hit");
  });

  it.skip("strides through the G zone, then can choose the critical trigger target", () => {
    const MIST = "G-CHB03/S11TH", STAR = "G-CHB03/002TH", GUNIT = "PR/0686TH", CRIT = "PR/0632TH";
    const s = createGame(db, { seed: 9, firstPlayer: "me", decks: { me: deck, bot: deck } });
    Object.assign(s, { phase: "ride", step: "stride", turn: 3, turnPlayer: "me", mulliganDone: ["me", "bot"] });
    s.players.me.circles.vc = inst(s, MIST);
    s.players.bot.circles.vc = inst(s, MIST);
    s.players.me.hand = [inst(s, STAR)];
    s.players.me.deck.unshift(inst(s, CRIT), inst(s, GUN), inst(s, GUN));
    s.players.bot.deck.unshift(inst(s, GUN), inst(s, GUN));
    s.awaiting = { player: "me", kind: "next-phase" };
    render(s);

    click(button("Open G zone"));
    click([...host.querySelectorAll(".modal .card")].find((c) => c.getAttribute("title") === db[GUNIT].name));
    click(handCard("me", db[STAR].name));
    click(button("Stride"));
    expect(slots(1)[1].querySelector(":scope > .card .pw")!.textContent).toBe("26,000");
    expect(slots(1)[1].querySelector(".heart .card")!.getAttribute("title")).toBe(db[MIST].name);

    click(button("To main phase"));
    click(button("To battle phase"));
    click(slots(1)[1]);
    click(slots(0)[4]);
    click(button("End guard"));
    expect(host.querySelector(".command")!.textContent).toContain("CRITICAL TRIGGER");
    click(slots(1)[1]);      // Power+5000
    click(slots(1)[1]);      // Critical+1
    expect(host.querySelectorAll(".side")[0].querySelectorAll(".pip.up")).toHaveLength(2);
  });

  it.skip("clicks through the whole off-turn shot combo on screen", () => {
    autoDecline = false;
    const K = { mist: "G-CHB03/S11TH", star: "G-CHB03/002TH", serp: "PR/0256TH", lazy: "G-CP06/019TH", dewey: "PR/0740TH", gunit: "PR/0686TH", lily: "G-CP08/S11TH" };
    const s = createGame(db, { seed: 11, firstPlayer: "me", decks: { me: deck, bot: deck } });
    const me = s.players.me, bot = s.players.bot;
    const down = (k: string) => ({ ...inst(s, k), faceUp: false });
    Object.assign(s, { mulliganDone: ["me", "bot"], turn: 4, turnPlayer: "bot", phase: "battle", step: "guard",
      battle: { attacker: "vc", booster: "back_center", target: "vc", drivesLeft: 0, damageLeft: 0 } });
    me.circles = { vc: inst(s, K.mist), front_left: inst(s, GUN), front_right: inst(s, K.serp), back_left: inst(s, BONE), back_right: inst(s, K.lazy) };
    me.hand = [inst(s, K.dewey), inst(s, K.star)];
    me.damage = [inst(s, K.star), inst(s, K.serp), inst(s, BONE), down(K.star)];
    me.drop = [inst(s, TOMMY), inst(s, K.dewey)];
    me.gZone = [inst(s, K.gunit), inst(s, K.gunit), down(K.lily), down(K.gunit)];
    bot.circles = { vc: { ...inst(s, K.gunit), rested: true }, front_left: inst(s, K.lazy), back_center: inst(s, BONE) };
    bot.heart = inst(s, K.star);
    bot.circles.vc!.mods.push({ stat: "power", value: 7000, source: "boost", until: "battle-end" });
    bot.deck.unshift(down(GUN), down(GUN), down(GUN));
    s.awaiting = { player: "me", kind: "guard", prompt: { key: "prompt.guard" } };
    render(s);

    click(button("Call G guardian"));
    click(modalCard(db[K.lily].name));
    click(handCard("me", db[K.dewey].name));
    click([...host.querySelectorAll(".command button")].find((b) => b.textContent?.includes("Dewey")));
    click(button("Yes"));
    click(host.querySelector(".modal .card"));                    // bind another Heal
    click(button("Confirm"));
    click(button("CC(1)"));
    click(button("Yes"));                                         // Negrolily
    click(modalCard(db[GUN].name));
    click(button("Confirm"));
    click(modalCard(db[TOMMY].name));
    click(button("Confirm"));
    click(slots(1)[4]);                                           // back center
    expect(host.querySelector(".command")!.textContent).toContain("Night Fog");
    click(button("Yes"));                                         // Nightrose mill 3
    click(modalCard(db[GUN].name));
    click(button("Confirm"));
    click(slots(1)[0]);                                           // front left
    click([...host.querySelectorAll(".command button")].find((b) => b.textContent?.includes("Skeleton Cannoneer") && b.textContent.includes("#1")));
    click(button("Yes"));                                         // hollow
    click(button("Yes"));                                         // CB1 shoot
    click(modalCard(db[K.lazy].name));
    click(button("Confirm"));
    click(button("End guard"));

    expect(slots(0)[5].querySelector(".card")).toBeNull();        // the bot's front-left rear-guard was shot
    expect(slots(1)[0].textContent).toContain("Hollow");
    expect(slots(1)[1].querySelector(".card")!.getAttribute("title")).toBe(db[TOMMY].name);
    expect(host.querySelector(".side .damage")).toBeTruthy();
    expect(host.querySelectorAll(".side")[1].querySelectorAll(".pip.up")).toHaveLength(2);
    expect(host.querySelector(".log")!.textContent).toContain("No hit");
    autoDecline = true;
  });

  it("after guarding, clicking a card on GC returns it to where it came from (hand, or the RC it intercepted from)", () => {
    const s = createGame(db, { seed: 11, firstPlayer: "me", decks: { me: deck, bot: deck } });
    const me = s.players.me, bot = s.players.bot;
    Object.assign(s, { mulliganDone: ["me", "bot"], turn: 4, turnPlayer: "bot", phase: "battle", step: "guard",
      battle: { attacker: "vc", target: "vc", drivesLeft: 0, damageLeft: 0 } });
    me.circles = { vc: inst(s, TOMMY), front_left: inst(s, GUN) };
    me.hand = [inst(s, BONE)];
    bot.circles = { vc: inst(s, TOMMY) };
    s.awaiting = { player: "me", kind: "guard", prompt: { key: "prompt.guard" } };
    render(s);

    rawClick(handCard("me", db[BONE].name));
    rawClick(button("Yes"));
    rawClick(slots(1)[0]);                                         // intercept from front left
    const gc = () => [...host.querySelectorAll(".bside.me .card")];
    expect(gc()).toHaveLength(2);
    expect(handCard("me", db[BONE].name)).toBeUndefined();

    rawClick(gc().find((c) => c.getAttribute("title") === db[BONE].name));
    expect(handCard("me", db[BONE].name)).toBeTruthy();
    expect(gc()).toHaveLength(1);
    rawClick(gc()[0]);
    expect(gc()).toHaveLength(0);
    expect(slots(1)[0].querySelector(".card")!.getAttribute("title")).toBe(db[GUN].name);
  });

  it("after a call with an optional ability pending (hollow), another card can still be called in the main phase, treating it as declined", () => {
    const s = createGame(db, { seed: 13, firstPlayer: "me", decks: { me: deck, bot: deck } });
    const g3 = Object.keys(deck.main).find((k) => db[k].grade === 3 && db[k].type === "normal")!;
    Object.assign(s, { mulliganDone: ["me", "bot"], turn: 3, turnPlayer: "me", phase: "main", step: "main" });
    s.players.me.circles = { vc: inst(s, g3) };
    s.players.me.hand = [inst(s, GUN), inst(s, BONE)];
    refreshAwaiting(s);
    render(s);

    rawClick(handCard("me", db[GUN].name));
    rawClick(slots(1)[0]);
    expect(slots(1)[0].classList.contains("source")).toBe(true);   // hollow waiting to be chosen (yellow border)
    rawClick(handCard("me", db[BONE].name));
    rawClick(slots(1)[2]);
    expect(slots(1)[0].querySelector(".card")!.getAttribute("title")).toBe(db[GUN].name);
    expect(slots(1)[2].querySelector(".card")!.getAttribute("title")).toBe(db[BONE].name);
    expect(host.querySelector(".ph.on")!.textContent).toBe("MAIN");
    expect(slots(1)[0].classList.contains("source")).toBe(false);   // hollow was skipped
  });

  it("opening the G zone shows face-down cards as card images, and the right panel shows the ability text", () => {
    const s = createGame(db, { seed: 5, firstPlayer: "me", decks: { me: deck, bot: deck } });
    render(s);
    click(host.querySelector(".tray.me .gZone .zone-slot"));
    expect(host.querySelectorAll(".modal .card")).toHaveLength(countCards(deck.g_zone));
    click(host.querySelector(".modal .card"));
    expect(host.querySelector(".insp-pane.me")!.textContent).toMatch(/STRIDE|G GUARDIAN/);
  });

  it("press Confirm, the bot mulligans by itself, then pick a grade 1 card and click VC to ride, entering the main phase automatically", async () => {
    vi.useFakeTimers();
    try {
      const s = createGame(db, { seed: 7, firstPlayer: "me", decks: { me: deck, bot: deck } });
      s.players.me.circles.vc = { ...inst(s, "PR/0740TH"), faceUp: false };   // a grade 0 vanguard with no ability when ridden upon
      s.players.me.hand.push(inst(s, BONE));
      render(s);
      click(button("Confirm"));
      expect(host.querySelector(".ph.on")!.textContent).toBe("START");   // still waiting for the bot's mulligan
      await botPlays();
      expect(host.querySelector(".ph.on")!.textContent).toBe("RIDE");
      expect(host.querySelector(".mid-center .prompt")!.textContent).toBe("Ride");
      expect(host.querySelector(".mid-actions")!.textContent).toBe("Skip");
      click(handCard("me", db[BONE].name));
      expect(handCard("me", db[BONE].name)!.classList.contains("sel")).toBe(true);
      click(slots(1)[1]);
      expect(slots(1)[1].querySelector(":scope > .card")!.getAttribute("title")).toBe(db[BONE].name);
      expect(host.querySelector(".ph.on")!.textContent).toBe("MAIN");
      expect(button("End →")).toBeTruthy();                         // no battle phase on the first turn
    } finally {
      vi.useRealTimers();
    }
  });

  it("before Start, VC is empty and both decks can be opened to view the whole deck", () => {
    const s = createGame(db, { seed: 2, firstPlayer: "me", decks: { me: deck, bot: deck } });
    render(s, false);
    expect(slots(1)[1].querySelector(".card")).toBeNull();
    expect(host.querySelectorAll(".hand.me .card")).toHaveLength(0);
    rawClick(host.querySelector(".stack.me .deck .zone-slot"));
    expect(host.querySelectorAll(".modal .card")).toHaveLength(countCards(deck.main));
    rawClick(host.querySelector(".modal button"));
    rawClick(host.querySelector(".stack.bot .deck .zone-slot"));
    expect(host.querySelectorAll(".modal .card")).toHaveLength(countCards(deck.main));
  });

  it("a card dialog closes when pressing anywhere outside it, including the side panels the veil doesn't cover", () => {
    render(createGame(db, { seed: 2, firstPlayer: "me", decks: { me: deck, bot: deck } }), false);
    const down = (el: Element | null) => act(() => { el!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    rawClick(host.querySelector(".stack.me .deck .zone-slot"));
    down(host.querySelector(".modal .card"));
    expect(host.querySelector(".modal")).not.toBeNull();
    down(host.querySelector(".veil"));
    expect(host.querySelector(".modal")).toBeNull();
    rawClick(host.querySelector(".stack.me .deck .zone-slot"));
    down(host.querySelector("aside.right"));
    expect(host.querySelector(".modal")).toBeNull();
  });

  it("mulligan: the chosen cards go back into the deck first, then new ones are drawn", async () => {
    vi.useFakeTimers();
    try {
      const s = createGame(db, { seed: 3, firstPlayer: "me", decks: { me: deck, bot: deck } });
      render(s);
      const deckCount = () => host.querySelectorAll(".stack.me .deck .back").length;
      const before = deckCount();
      rawClick(host.querySelectorAll(".hand.me .card")[0]);
      rawClick(host.querySelectorAll(".hand.me .card")[1]);
      rawClick(button("Change"));
      expect(host.querySelectorAll(".hand.me .card")).toHaveLength(3);
      expect(deckCount()).toBe(before + 2);
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(host.querySelectorAll(".hand.me .card")).toHaveLength(3);   // the second card hasn't reached the deck yet
      await act(async () => { await vi.advanceTimersByTimeAsync(90); });
      expect(host.querySelectorAll(".hand.me .card")).toHaveLength(5);
      expect(deckCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("press Start: the starting vanguard goes to VC first, then 5 cards are drawn", async () => {
    vi.useFakeTimers();
    try {
      const s = createGame(db, { seed: 2, firstPlayer: "me", decks: { me: deck, bot: deck } });
      render(s, false);
      render(s, true);
      expect(slots(1)[1].querySelector(".card")!.getAttribute("title")).toBe("Face-down card");   // the starting vanguard is placed face down
      expect(host.querySelectorAll(".hand.me .card")).toHaveLength(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(host.querySelectorAll(".hand.me .card")).toHaveLength(5);
      expect(button("Confirm")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("playing the bot: the bot's hand is face down, no buttons on the bot's turn, and the bot mulligans by itself before your turn", async () => {
    vi.useFakeTimers();
    try {
      const s = createGame(db, { seed: 9, firstPlayer: "bot", decks: { me: deck, bot: deck } });
      act(() => root.render(<Board initial={s} started onStart={() => {}} settings={{ seed: 9, firstPlayer: "bot", bot: "normal" }} decks={{ me: deck, bot: deck }} deckOpen={false} onDeckOpen={() => {}}
        onNewGame={() => {}} onApplySettings={() => {}} onSwapDecks={() => {}} onPickDeck={() => {}} onDeckChanged={() => {}} />));
      const botHand = [...host.querySelectorAll(".hand.bot .card")];
      expect(botHand).toHaveLength(5);
      expect(botHand.every((c) => c.getAttribute("title") === "Face-down card")).toBe(true);
      expect(button("Confirm")).toBeUndefined();
      expect(host.textContent).toContain("Bot is thinking");
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(host.querySelector(".log")!.textContent).toContain("Bot redrew");
      expect(button("Confirm")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("replay keeps the decks as dealt, even after the G zone is reordered mid-game", async () => {
    localStorage.clear();
    const s = createGame(db, { seed: 4, firstPlayer: "me", decks: { me: deck, bot: deck } });
    vi.useFakeTimers();
    render(s);
    click(button("Confirm"));
    await botPlays();
    vi.useRealTimers();
    const [first, ...rest] = Object.entries(deck.g_zone);
    const reordered = { ...deck, g_zone: Object.fromEntries([...rest, first]) };
    act(() => root.render(<Board initial={s} started onStart={() => {}} settings={{ seed: s.seed, firstPlayer: s.firstPlayer }} decks={{ me: reordered, bot: deck }} deckOpen={false} onDeckOpen={() => {}}
      onNewGame={() => {}} onApplySettings={() => {}} onSwapDecks={() => {}} onPickDeck={() => {}} onDeckChanged={() => {}} />));
    click(button("Replays"));
    click(button("Save this game"));
    expect(Object.keys(loadReplays()[0].decks.me.g_zone)).toEqual(Object.keys(deck.g_zone));
  });

  it("replay: not saved automatically; save in Replays, then step through it (both hands visible)", async () => {
    localStorage.clear();
    const s = createGame(db, { seed: 4, firstPlayer: "me", decks: { me: deck, bot: deck } });
    vi.useFakeTimers();
    render(s);
    click(button("Confirm"));
    await botPlays();
    vi.useRealTimers();
    expect(loadReplays()).toHaveLength(0);
    click(button("Replays"));
    click(button("Save this game"));
    const saved = loadReplays();
    expect(saved).toHaveLength(1);
    expect(saved[0].actions.map((a) => a.action.type)).toEqual(["mulligan", "mulligan"]);

    const tl = replayTimeline(db, saved[0]);
    act(() => root.render(<ReplayViewer tl={tl} decks={saved[0].decks} settings={{ seed: 4, firstPlayer: "me" }} onContinue={() => {}} onClose={() => {}} />));
    expect(host.textContent).toContain("Step 0/2");
    expect(host.querySelector(".replay-bar .speed")!.textContent).toBe("1x");
    rawClick(host.querySelector('[aria-label="Faster"]'));
    expect(host.querySelector(".replay-bar .speed")!.textContent).toBe("2x");
    rawClick(host.querySelector('[aria-label="Last step"]'));
    expect(host.textContent).toContain("Step 2/2");
    expect(host.querySelector(".ph.on")!.textContent).toBe("RIDE");
    expect([...host.querySelectorAll(".hand.bot .card")].some((c) => c.getAttribute("title") !== "Face-down card")).toBe(true);
    expect(button("Confirm")).toBeUndefined();
    expect(host.querySelector(".mid-actions")!.textContent).toBe("Resume");   // the resume-from-this-step button is in the right slot of the middle bar
    expect(host.querySelector(".mid-history button")).toBeNull();
    rawClick(host.querySelector(".stack.bot .deck .zone-slot"));                       // the deck can be opened while watching a replay
    expect(host.querySelectorAll(".modal .card")).toHaveLength(tl.states.at(-1)!.players.bot.deck.length);
    expect(host.querySelector(".replay-foot .pos")!.textContent).toContain("Step 2/2");
  });
});
