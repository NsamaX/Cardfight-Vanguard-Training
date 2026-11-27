import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame, refreshAwaiting } from "../engine/game";
import { shieldOf } from "../engine/rules";
import type { CardInstance, GameState } from "../engine/types";
import { playGame } from "./arena";
import { VanguardBot } from "./index";
import { estimateDefense, nextTurnNeed } from "./intel";
import { damageCost, lethalGap, policy, triggerDist } from "./policy";
import { attachPools, deckOdds, determinize, HIDDEN, viewFor, withHidden } from "./view";
import { affordable, analyze, deckCombos, shieldForced } from "./combos";

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const decks = { me: deck, bot: deck };

describe("what the bot sees", () => {
  it("hides the opponent's hand and deck, then fills them randomly to match the deck list", () => {
    const s = createGame(db, { seed: 7, decks, firstPlayer: "me" });
    const v = viewFor(s, "bot");
    expect(v.players.me.hand.every((c) => c.key === HIDDEN)).toBe(true);
    expect(v.players.bot.hand.every((c) => c.key !== HIDDEN)).toBe(true);
    expect(v.players.bot.deck.every((c) => c.key === HIDDEN)).toBe(true);
    expect(v.rngState).toBe(0);
    const d = determinize(withHidden(db), v, decks, 123);
    const count = (st: GameState) => {
      const m = new Map<string, number>();
      for (const ps of Object.values(st.players)) for (const c of [...ps.hand, ...ps.deck, ps.circles.vc!]) m.set(c.key, (m.get(c.key) ?? 0) + 1);
      return m;
    };
    expect(count(d)).toEqual(count(s));
    expect(d.players.bot.hand.map((c) => c.key)).toEqual(s.players.bot.hand.map((c) => c.key));
  });
});

describe("guard decisions", () => {
  const inst = (s: GameState, key: string, faceUp = true): CardInstance =>
    ({ uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
  const MIST = "G-CHB03/S11TH", ROOK = "G-TD08/007TH", BONE = "G-BT06/040TH", MICK = "PR/0564TH", LAZY = "G-CP06/019TH", SPOUT = "G-BT06/S11TH";

  // The bot is attacked by a 21,000 vanguard (bot vanguard 11,000), with 25,000 total Shield in hand
  function attacked(damage: number, target: "vc" | "front_left" = "vc", hand = [MICK, MICK, LAZY]) {
    const s = createGame(db, { seed: 3, decks, firstPlayer: "me" });
    s.players.me.circles = { vc: inst(s, MIST), back_center: inst(s, BONE) };
    s.players.me.circles.vc!.mods.push({ stat: "power", value: 10000, source: "boost", until: "battle-end" });
    s.players.bot.circles = { vc: inst(s, MIST), front_left: inst(s, ROOK) };
    s.players.bot.hand = hand.map((k) => inst(s, k));
    s.players.bot.damage = Array.from({ length: damage }, () => inst(s, BONE));
    Object.assign(s, { turn: 5, turnPlayer: "me", phase: "battle", step: "guard", mulliganDone: ["me", "bot"],
      battle: { attacker: "vc", booster: "back_center", target, drivesLeft: 0, damageLeft: 0 } });
    refreshAwaiting(s);
    return s;
  }
  const bot = new VanguardBot(db, "normal", decks, 1);

  it("damage 5, vanguard attacked: guards enough to survive a trigger, never lets itself lose", async () => {
    const s = attacked(5);
    const a = await bot.decide(s, s.awaiting!);
    expect(a.type).toBe("guard");
    const r = apply(db, s, "bot", a).state;
    const shield = r.players.bot.guardian.reduce((n, g) => n + shieldOf(db, g), 0);
    expect(11000 + shield).toBeGreaterThan(21000 + 5000);   // holds even if 1 trigger is revealed
  });

  it("damage 5 with a sentinel: uses the sentinel (2 cards) instead of guarding with 3 cards", async () => {
    const s = attacked(5, "vc", [MICK, MICK, LAZY, SPOUT, BONE]);
    s.players.me.circles.vc!.mods.push({ stat: "power", value: 10000, source: "effect", until: "battle-end" });
    const a = await bot.decide(s, s.awaiting!);
    expect(a).toMatchObject({ type: "guard", uids: [s.players.bot.hand[3].uid] });
  });

  it("damage 1, rear-guard attacks a rear-guard: spends no guard cards", async () => {
    const s = attacked(1, "front_left");
    expect((await bot.decide(s, s.awaiting!)).type).toBe("end-guard");
  });
});

describe("no wasted plays (from a real game, seed 621023972)", () => {
  const inst = (s: GameState, key: string, faceUp = true): CardInstance =>
    ({ uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
  const MIST = "G-CHB03/S11TH", STORM = "G-BT06/083TH", GUNIT = "PR/0686TH", BONE = "G-BT06/040TH", MICK = "PR/0564TH", TOMMY = "G-CHB03/S12TH", STAR = "G-CHB03/002TH", DEWEY = "PR/0740TH";
  const bot = new VanguardBot(db, "normal", decks, 1);

  it("Nightstorm at battle end: no card in the drop zone to call, doesn't pay CB", async () => {
    let s = createGame(db, { seed: 3, decks, firstPlayer: "bot" });
    s.players.bot.circles = { vc: inst(s, MIST), front_left: inst(s, STORM) };
    s.players.bot.circles.front_left!.hollowed = true;
    s.players.bot.gZone = [inst(s, GUNIT)];
    s.players.bot.damage = [inst(s, BONE)];
    s.players.bot.drop = [];
    s.players.me.circles = { vc: inst(s, MIST) };
    s.players.me.deck.unshift(inst(s, BONE, false));
    Object.assign(s, { turn: 4, turnPlayer: "bot", phase: "battle", step: "attack", mulliganDone: ["me", "bot"] });
    refreshAwaiting(s);
    s = apply(db, s, "bot", { type: "attack", attacker: "front_left", target: "vc" }).state;
    s = apply(db, s, "me", { type: "end-guard" }).state;
    expect(s.awaiting?.kind).toBe("order-queue");
    expect((await bot.decide(s, s.awaiting!)).type).toBe("decline-queue");
    s.players.bot.drop = [inst(s, BONE)];                                   // Negrobone available to call: use it
    expect((await bot.decide(s, s.awaiting!)).type).toBe("order-queue");
  });

  it("damage 4: doesn't guard a rear-guard if what's left can't guard the vanguard still to attack and that hit would lose", async () => {
    const s = createGame(db, { seed: 3, decks, firstPlayer: "me" });
    s.players.me.circles = { vc: inst(s, GUNIT), front_left: inst(s, STAR), back_left: inst(s, BONE) };
    s.players.me.heart = inst(s, MIST);
    s.players.me.circles.vc!.mods.push({ stat: "critical", value: 1, source: "effect", until: "turn-end" }, { stat: "power", value: 10000, source: "effect", until: "turn-end" });
    s.players.me.circles.front_left!.rested = true;
    s.players.me.circles.back_left!.rested = true;
    s.players.bot.circles = { vc: inst(s, "MB/065TH") };
    s.players.bot.hand = [MICK, MICK, TOMMY].map((k) => inst(s, k));
    s.players.bot.damage = Array.from({ length: 4 }, () => inst(s, BONE));
    Object.assign(s, { turn: 7, turnPlayer: "me", phase: "battle", step: "guard", mulliganDone: ["me", "bot"],
      battle: { attacker: "front_left", booster: "back_left", target: "vc", drivesLeft: 0, damageLeft: 0 } });
    s.players.me.circles.front_left!.mods.push({ stat: "power", value: 7000, source: "boost", until: "battle-end" });
    refreshAwaiting(s);
    expect((await bot.decide(s, s.awaiting!)).type).toBe("end-guard");    // take it to damage 5, keep 25,000 to guard the 36,000 Critical 2 vanguard
  });

  it("Necronora calls to GC only cards that have Shield", async () => {
    let s = createGame(db, { seed: 3, decks, firstPlayer: "me" });
    s.players.me.circles = { vc: inst(s, GUNIT) };
    s.players.me.heart = inst(s, MIST);
    s.players.bot.circles = { vc: inst(s, MIST) };
    s.players.bot.hand = [inst(s, DEWEY)];
    s.players.bot.gZone = [inst(s, GUNIT), inst(s, "G-FC04/043TH", false), inst(s, "G-FC04/043TH", false)];   // GB1
    s.players.bot.soul = [inst(s, BONE)];
    s.players.bot.drop = [inst(s, STORM), inst(s, "G-CP06/019TH"), inst(s, "PR/0632TH")];
    s.players.bot.damage = Array.from({ length: 4 }, () => inst(s, BONE));
    Object.assign(s, { turn: 7, turnPlayer: "me", phase: "battle", step: "guard", mulliganDone: ["me", "bot"],
      battle: { attacker: "vc", target: "vc", drivesLeft: 0, damageLeft: 0 } });
    refreshAwaiting(s);
    // Vanguard 26,000 vs 11,000, damage 4: only one Heal; use Necronora 15,000 + call Banshee 10,000 and Negrolazy 5,000 (not Nightstorm, Shield 0)
    for (let i = 0; i < 20 && s.awaiting?.player === "bot" && !(s.awaiting.kind === "guard" && s.players.bot.guardian.length); i++) {
      s = apply(db, s, "bot", await bot.decide(s, s.awaiting!)).state;
    }
    const gc = s.players.bot.guardian.map((g) => g.key);
    expect(gc).toContain("G-FC04/043TH");
    expect(gc).toContain("PR/0632TH");
    expect(gc).not.toContain(STORM);
  });
});

describe("bot formulas", () => {
  const inst = (s: GameState, key: string, faceUp = true): CardInstance =>
    ({ uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });

  it("trigger odds count draws without replacement (hypergeometric)", () => {
    expect(triggerDist(10, 5, 1)).toEqual([0.5, 0.5]);
    const d = triggerDist(10, 5, 2);
    expect(d[2]).toBeCloseTo((5 / 10) * (4 / 9));
    expect(d.reduce((n, x) => n + x, 0)).toBeCloseTo(1);
  });

  it("counts triggers left in the opponent's deck from cards already revealed (the deck itself is hidden)", () => {
    const s = createGame(db, { seed: 3, decks, firstPlayer: "me" });
    const me = s.players.me;
    const trig = me.deck.filter((c) => db[c.key].trigger).slice(0, 8);
    me.deck = me.deck.filter((c) => !trig.includes(c));
    me.damage.push(...trig.slice(0, 5));
    me.drop.push(...trig.slice(5));
    const v = viewFor(s, "bot");
    attachPools(withHidden(db), v, decks);
    const odds = deckOdds(withHidden(db), v, "me");
    const unseen = me.deck.length + me.hand.length;
    const left = [...me.deck, ...me.hand].filter((c) => db[c.key].trigger).length;
    expect(odds.count((c) => !!c.trigger)).toBeCloseTo(left * me.deck.length / unseen);
    expect(left).toBe(16 - 8);
  });

  it("Grunatch loop: Nightrose chooses to call Grunatch back, CC2 twice (CC4) in one turn", async () => {
    let s = createGame(db, { seed: 3, decks, firstPlayer: "bot" });
    const b = s.players.bot;
    b.circles = { vc: inst(s, "G-CHB03/S11TH"), back_center: inst(s, "G-TD08/014TH"), front_left: inst(s, "G-BT06/083TH") };
    b.circles.back_center!.hollowed = true;
    b.circles.front_left!.hollowed = true;
    b.gZone = [inst(s, "PR/0686TH"), inst(s, "PR/0686TH")];                     // GB2
    b.damage = Array.from({ length: 4 }, () => inst(s, "G-BT06/040TH", false));   // no CB left
    s.players.me.circles = { vc: inst(s, "G-CHB03/S11TH") };
    Object.assign(s, { turn: 6, turnPlayer: "bot", phase: "battle", step: "attack", mulliganDone: ["me", "bot"] });
    refreshAwaiting(s);
    const bot = new VanguardBot(db, "normal", decks, 1);
    s = apply(db, s, "bot", { type: "next-phase" }).state;                        // end the turn
    for (let i = 0; i < 30 && s.turnPlayer === "bot" && s.awaiting?.player === "bot"; i++) s = apply(db, s, "bot", await bot.decide(s, s.awaiting!)).state;
    expect(s.turnPlayer).toBe("me");
    expect(s.players.bot.damage.filter((d) => d.faceUp)).toHaveLength(4);
  });
});

describe("pro formulas: read the opponent and plan the whole turn", () => {
  const inst = (s: GameState, key: string, faceUp = true): CardInstance =>
    ({ uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
  const MIST = "G-CHB03/S11TH", GUNIT = "PR/0686TH", BONE = "G-BT06/040TH", MICK = "PR/0564TH";
  const xdb = withHidden(db);

  // Bot's turn in the battle phase: bot has a G vanguard (26,000) + the given front row; opponent (me) at damage dmg with the given hand
  function battle(dmg: number, hand: string[], front: Record<string, string> = {}) {
    const s = createGame(db, { seed: 3, decks, firstPlayer: "me" });
    s.players.bot.circles = { vc: inst(s, GUNIT), ...Object.fromEntries(Object.entries(front).map(([c, k]) => [c, inst(s, k)])) };
    s.players.bot.heart = inst(s, MIST);
    s.players.me.circles = { vc: inst(s, MIST) };
    s.players.me.hand = hand.map((k) => inst(s, k));
    s.players.me.damage = Array.from({ length: dmg }, () => inst(s, BONE));
    Object.assign(s, { turn: 6, turnPlayer: "bot", phase: "battle", step: "attack", mulliganDone: ["me", "bot"] });
    refreshAwaiting(s);
    return s;
  }
  const known = (s: GameState) => { const v = viewFor(s, "bot", new Set(s.players.me.hand.map((c) => c.uid))); attachPools(xdb, v, decks); return v; };

  it("estimates the opponent's defense: known hand cards use real values, unknown ones use the average of cards not yet seen", () => {
    const s = battle(3, [MICK, MICK, BONE]);
    expect(estimateDefense(xdb, known(s), "me").shield).toBe(25000);
    const v = viewFor(s, "bot");
    attachPools(xdb, v, decks);
    const e = estimateDefense(xdb, v, "me");
    expect(e.shield).toBeGreaterThan(5000);
    expect(e.shield).toBeLessThan(30000);
  });

  it("lethal: damage 5 with an empty hand = can kill / hand with enough Shield for every attack = can't kill", () => {
    const swings = [{ attacker: "vc" as const, power: 26000, crit: 1 }, { attacker: "front_left" as const, power: 21000, crit: 1 }];
    expect(lethalGap(xdb, known(battle(5, [])), "bot", swings)).toBeGreaterThan(0);
    expect(lethalGap(xdb, known(battle(5, [MICK, MICK, MICK, MICK])), "bot", swings)).toBeLessThanOrEqual(0);
  });

  it("target choice: if the vanguard can't be hit, attack a rear-guard that can", () => {
    const s = battle(2, [], { front_left: BONE });
    s.players.bot.circles.vc!.rested = true;
    s.players.me.circles.front_right = inst(s, BONE);   // 7,000 can be hit (vanguard 11,000 can't)
    expect(policy(xdb, known(s), "bot")).toMatchObject({ type: "attack", attacker: "front_left", target: "front_right" });
  });

  it("Heal helps survival: the cost of being hit at damage 5 is lower than a certain loss when Heal might be revealed", () => {
    expect(damageCost(5, 1, 0)).toBe(25);
    expect(damageCost(5, 1, 0.25)).toBeLessThan(20);
  });

  it("opponent's next-turn attack strength: at damage 5, keep Shield to guard the vanguard that will stride", () => {
    const s = battle(0, []);
    s.players.bot.damage = Array.from({ length: 5 }, () => inst(s, BONE));
    s.players.bot.circles = { vc: inst(s, MIST) };
    s.players.bot.heart = undefined;
    s.players.me.gZone = [inst(s, GUNIT, false)];
    expect(nextTurnNeed(xdb, s, "bot")).toBeGreaterThanOrEqual(15000);
  });

  it("opponent reveals a grade 3 from hand: the opponent's randomized hand always contains a grade 3", () => {
    const s = battle(2, [MICK, MICK, MICK]);
    const v = viewFor(s, "bot");
    attachPools(xdb, v, decks, { oppPassive: 0, oppRevealedG3: true });
    for (let seed = 1; seed <= 20; seed++) {
      expect(determinize(xdb, v, decks, seed).players.me.hand.some((c) => db[c.key].grade === 3)).toBe(true);
    }
  });
});

describe("bots playing each other", () => {
  it("Normal plays every seed to the end without an illegal action", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const bots = { me: new VanguardBot(db, "normal", decks, seed), bot: new VanguardBot(db, "normal", decks, seed + 99) };
      const r = await playGame(db, decks, bots, seed, seed % 2 ? "me" : "bot");
      expect(r.winner, `seed ${seed}`).toBeDefined();
    }
  }, 60000);
});

describe("deck combos", () => {
  it("finds combos from ability code, classifies them, and keeps the pieces in hand", () => {
    const r = analyze(db, deck);
    const nightroseG = r.combos.find((c) => c.steps[0].key === "PR/0686TH" && c.steps[1]?.key === "PR/0256TH");
    expect(nightroseG?.kind).toBe("finisher");
    expect(nightroseG?.steps[1].at).toBe("drop");
    expect(r.combos.find((c) => c.steps[0].key === "G-CP08/S11TH")?.kind).toBe("defense");
    expect(r.combos.every((c) => c.score === c.value / c.difficulty)).toBe(true);
    expect(r.handPiece.get("G-CHB03/S12TH")).toBeGreaterThan(0);
  });

  it("records each combo's resources, attacks, defense, and disruption", () => {
    const r = analyze(db, deck);
    const cannon = r.combos.find((c) => c.steps[0].key === "PR/0686TH" && c.steps[1]?.key === "G-BT06/087TH" && c.steps.length === 2)!.profile;
    expect(cannon).toMatchObject({ cb: 2, cbNeed: 2, gb: 1, flipG: 1, draw: 1, disrupt: { ownTurn: 1, oppTurn: 0 } });
    expect(cannon.attacks.some((a) => a.crit === 2)).toBe(true);
    const grunash = r.combos.find((c) => c.steps.every((s) => s.key === "G-TD08/014TH") && c.profile.cc > 0)!.profile;
    expect(grunash).toMatchObject({ cc: 2, gb: 1, cb: 0 });
    const nora = r.combos.find((c) => c.steps[0].key === "G-FC04/043TH" && c.steps.length === 2)!.profile;
    expect(nora.shield).toBeGreaterThan(15000);
    expect(nora).toMatchObject({ sb: 1, flipG: 1, gb: 1 });
    // An attack that can't reach the opponent's vanguard power doesn't force a guard
    expect(shieldForced({ ...cannon, attacks: [{ power: 9000, crit: 1 }, { power: 16000, crit: 1 }] }, 11000)).toBe(10000);
    expect(affordable(cannon, { cb: 1, sb: 0, gb: 1, gFaceDown: 2, deck: 20 })).toBe(false);
    expect(affordable(cannon, { cb: 2, sb: 0, gb: 1, gFaceDown: 2, deck: 20 })).toBe(true);
    expect(affordable(cannon, { cb: 2, sb: 0, gb: 1, gFaceDown: 2, deck: 1 })).toBe(false);
  });

  it("marks vanguard-only pieces as VC, tags phase, and lists how to get drop pieces there", () => {
    const r = analyze(db, deck);
    const nightFog = r.combos.find((c) => c.steps.some((s) => s.key === "G-CHB03/S11TH" && s.ability === 0))!;
    expect(nightFog.steps.find((s) => s.key === "G-CHB03/S11TH")!.at).toBe("VC");
    expect(r.combos.find((c) => c.steps[0].key === "PR/0686TH" && c.steps[1]?.key === "PR/0256TH")?.phase).toBe("late");
    expect(r.combos.find((c) => c.steps.every((s) => s.key === "G-TD08/014TH") && c.profile.cc > 0)?.kind).toBe("farm");
    const cannon = r.enablers.drop.get("G-BT06/087TH")!;
    expect(cannon).toEqual(expect.arrayContaining([{ how: "search", key: "BT02/026TH", ability: 0 }, { how: "hollow" }, { how: "guard" }]));
    expect(r.setupPiece.drop.get("G-BT06/087TH")).toBeGreaterThan(0);
  });

  it("chains a soul blast into abilities that work when sent from the soul to the drop", () => {
    const r = analyze(db, presetDecks.find((d) => d.id === "regalia-minerva")!);
    const norn = r.combos.find((c) => c.steps[0].key === "G-BT14/009TH" && c.steps[1]?.key === "EB12/012TH");
    expect(norn?.steps[1].at).toBe("soul");
    expect(r.enablers.soul.get("EB12/012TH")).toEqual(expect.arrayContaining([{ how: "to-soul", key: "EB12/006TH", ability: 0 }, { how: "ride" }]));
  });

  it("an unchanged deck reuses the saved combos, an edited deck recomputes", () => {
    const a = deckCombos(db, deck);
    expect(deckCombos(db, { ...deck })).toBe(a);
    const edited = { ...deck, main: { ...deck.main, "PR/0256TH": 1 } };
    expect(deckCombos(db, edited)).not.toBe(a);
  });

  it("mulligan: if the ride can't reach grade 3 = redraw, keeping only the ride line (no other combo pieces)", () => {
    const xdb = withHidden(db);
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = createGame(db, { seed, decks, firstPlayer: "bot" });
      const hand = s.players.bot.hand;
      const grades = new Set(hand.filter((h) => [1, 2, 3].includes(db[h.key].grade)).map((h) => db[h.key].grade));
      if (grades.size === 3) continue;
      checked++;
      const v = viewFor(s, "bot");
      attachPools(xdb, v, decks);
      const a = policy(xdb, v, "bot") as Extract<ReturnType<typeof policy>, { type: "mulligan" }>;
      expect(hand.length - a.returnUids.length).toBe(grades.size);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("mulligan: always keeps the ride line", () => {
    const xdb = withHidden(db);
    for (let seed = 1; seed <= 20; seed++) {
      const s = createGame(db, { seed, decks, firstPlayer: "bot" });
      const v = viewFor(s, "bot");
      attachPools(xdb, v, decks);
      const a = policy(xdb, v, "bot") as Extract<ReturnType<typeof policy>, { type: "mulligan" }>;
      const kept = s.players.bot.hand.filter((h) => !a.returnUids.includes(h.uid));
      for (const g of [1, 2, 3]) {
        if (s.players.bot.hand.some((h) => db[h.key].grade === g)) expect(kept.some((h) => db[h.key].grade === g)).toBe(true);
      }
    }
  });
});
