import { afterEach, describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame, refreshAwaiting } from "./game";
import type { Ability, CardInstance, GameState } from "./types";

const regalia = presetDecks.find((d) => d.id === "regalia-minerva")!;
const ANGELICA = "G-BT14/020TH", HEMERA = "EB12/006TH";
let s: GameState;
const inst = (key: string): CardInstance => ({ uid: "t" + s.nextUid++, key, rested: false, faceUp: true, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
const added: string[] = [];
function card(key: string, abilities: Ability[]) {
  db[key] = { ...db[HEMERA], key, name: key, abilities };
  added.push(key);
}
afterEach(() => { for (const k of added.splice(0)) delete db[k]; });

function mainPhase() {
  s = createGame(db, { seed: 2, firstPlayer: "me", decks: { me: regalia, bot: regalia } });
  s.players.me.circles = { vc: inst(ANGELICA) };
  s.players.bot.circles = { vc: inst(ANGELICA) };
  Object.assign(s, { turn: 3, turnPlayer: "me", phase: "main", step: undefined, queue: [] });
  refreshAwaiting(s);
}

describe("move timing", () => {
  it("move(own, from=deck, to=drop): a card that waits for milled cards triggers once per card", () => {
    card("TEST/MILLER", [{ kind: "ACT", zone: "RC", effect: ["mill(2)"] }]);
    card("TEST/WATCHER", [{ kind: "AUTO", zone: "RC", timing: "move(own, from=deck, to=drop)", effect: ["power(+1000, self)"] }]);
    mainPhase();
    s.players.me.circles.front_left = inst("TEST/MILLER");
    s.players.me.circles.front_right = inst("TEST/WATCHER");
    refreshAwaiting(s);
    s = apply(db, s, "me", { type: "activate", cardUid: s.players.me.circles.front_left!.uid, abilityIndex: 0 }).state;
    expect(s.players.me.circles.front_right!.mods.filter((m) => m.value === 1000)).toHaveLength(2);
  });

  it("move(opp, from=RC, to=drop, by=retire) and retired(own) see the same retire", () => {
    card("TEST/SHOOTER", [{ kind: "ACT", zone: "RC", effect: ["retire(opp-RC, n≤1)"] }]);
    card("TEST/AVENGER", [{ kind: "AUTO", zone: "RC", timing: "retired(own)", effect: ["draw(1)"] }]);
    card("TEST/SPOTTER", [{ kind: "AUTO", zone: "RC", timing: "move(opp, from=RC, to=drop, by=retire)", effect: ["draw(1)"] }]);
    mainPhase();
    s.players.me.circles.front_left = inst("TEST/SHOOTER");
    s.players.me.circles.front_right = inst("TEST/SPOTTER");
    s.players.bot.circles.front_left = inst("TEST/AVENGER");
    s.players.bot.circles.back_left = inst(HEMERA);
    refreshAwaiting(s);
    const [mine, theirs] = [s.players.me.hand.length, s.players.bot.hand.length];
    s = apply(db, s, "me", { type: "activate", cardUid: s.players.me.circles.front_left!.uid, abilityIndex: 0 }).state;
    s = apply(db, s, "me", { type: "select-target", uids: [s.players.bot.circles.back_left!.uid] }).state;
    expect(s.players.me.hand.length).toBe(mine + 1);
    expect(s.players.bot.hand.length).toBe(theirs + 1);
  });
});

describe("draws and checks", () => {
  function battle() {
    mainPhase();
    s.players.bot.hand = [];
    Object.assign(s, { phase: "battle", step: "attack" });
    refreshAwaiting(s);
  }
  // Answer every pending question on both sides with the first option, and guard with nothing
  function finish() {
    for (let i = 0; i < 40 && s.awaiting && s.battle; i++) {
      const a = s.awaiting, p = a.player;
      if (a.kind === "order-queue") s = apply(db, s, p, { type: "order-queue", index: 0 }).state;
      else if (a.kind === "guard") s = apply(db, s, p, { type: "end-guard" }).state;
      else if (a.kind === "trigger-target") s = apply(db, s, p, { type: "trigger-target", powerTo: "vc" }).state;
      else break;
    }
  }

  it("move(own, from=deck, to=hand, by=draw) triggers once per card drawn", () => {
    card("TEST/DRAWER", [{ kind: "ACT", zone: "RC", effect: ["draw(2)"] }]);
    card("TEST/WATCHER", [{ kind: "AUTO", zone: "RC", timing: "move(own, from=deck, to=hand, by=draw)", effect: ["power(+1000, self)"] }]);
    mainPhase();
    s.players.me.circles.front_left = inst("TEST/DRAWER");
    s.players.me.circles.front_right = inst("TEST/WATCHER");
    refreshAwaiting(s);
    s = apply(db, s, "me", { type: "activate", cardUid: s.players.me.circles.front_left!.uid, abilityIndex: 0 }).state;
    expect(s.players.me.circles.front_right!.mods.filter((m) => m.value === 1000)).toHaveLength(2);
  });

  it("a drive check sets off an ability that resolves before the next check", () => {
    card("TEST/DRIVE-WATCHER", [{ kind: "AUTO", zone: "RC", timing: "move(own, to=hand, by=drive-check)", effect: ["power(+1000, self)"] }]);
    battle();
    s.players.me.circles.front_left = inst("TEST/DRIVE-WATCHER");
    s.players.me.deck.unshift(inst(HEMERA), inst(HEMERA));   // twin drive, no triggers
    s.players.bot.deck.unshift(inst(HEMERA));
    refreshAwaiting(s);
    s = apply(db, s, "me", { type: "attack", attacker: "vc", target: "vc" }).state;
    const r = apply(db, s, "bot", { type: "end-guard" });
    s = r.state;
    // check → its ability → check → its ability (each check's ability resolves before the next check)
    expect(r.events.map((e) => e.code).filter((c) => c === "drive-check" || c === "power")).toEqual(["drive-check", "power", "drive-check", "power"]);
    finish();
    expect(s.players.me.circles.front_left!.mods.filter((m) => m.value === 1000)).toHaveLength(2);
  });

  it("move(own, to=damage, by=damage-check): the defender's ability sees its damage check", () => {
    card("TEST/DAMAGE-WATCHER", [{ kind: "AUTO", zone: "RC", timing: "move(own, to=damage, by=damage-check)", effect: ["draw(1)"] }]);
    battle();
    s.players.bot.circles.front_left = inst("TEST/DAMAGE-WATCHER");
    s.players.me.deck.unshift(inst(HEMERA), inst(HEMERA));
    s.players.bot.deck.unshift(inst(HEMERA));
    refreshAwaiting(s);
    const hand = s.players.bot.hand.length;
    s = apply(db, s, "me", { type: "attack", attacker: "vc", target: "vc" }).state;
    s = apply(db, s, "bot", { type: "end-guard" }).state;
    finish();
    expect(s.players.bot.damage).toHaveLength(1);
    expect(s.players.bot.hand.length).toBe(hand + 1);
  });
});
