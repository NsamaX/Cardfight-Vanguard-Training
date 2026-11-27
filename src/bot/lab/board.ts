// Test boards for the combo lab: a turn of player p, at the stride step, with chosen cards in hand/drop/soul and chosen resources
import { apply, createGame, refreshAwaiting } from "../../engine/game";
import { shuffle } from "../../engine/rng";
import { isG, other, type CardDB } from "../../engine/rules";
import type { CardInstance, Circle, Deck, GameState, PlayerId } from "../../engine/types";

export interface Scenario {
  name: string;
  vc: string;                 // grade 3 vanguard
  hand: string[];
  drop: string[];
  soul: string[];
  rc?: Partial<Record<Circle, string>>;
  cb: number;                 // face-up damage
  damage: number;             // damage total (cb of them face up)
  gFaceUp: number;            // face-up cards in the G zone before this turn's stride
}

// The opponent's vanguard gets this much Power so no attack hits: attacks never end the game, and every attack is counted
export const UNHITTABLE = 1_000_000;

function inst(s: GameState, key: string, faceUp = true): CardInstance {
  return { uid: `c${s.nextUid++}`, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] };
}

function takeKeys(pool: Map<string, number>, keys: string[], what: string) {
  for (const k of keys) {
    const n = pool.get(k) ?? 0;
    if (n <= 0) throw new Error(`${what}: no copy of ${k} left in the deck`);
    pool.set(k, n - 1);
  }
}

// The opponent can't be hit and doesn't guard; the turn player plays from the stride step
export function makeUnhittable(s: GameState, p: PlayerId) {
  const vc = s.players[other(p)].circles.vc;
  if (vc) vc.mods.push({ stat: "power", value: UNHITTABLE, source: "lab", until: "turn-end" });
}

export function labBoard(db: CardDB, deck: Deck, sc: Scenario, seed = 1): GameState {
  let s = createGame(db, { seed, firstPlayer: "me", decks: { me: deck, bot: deck } });
  s = apply(db, s, "me", { type: "mulligan", returnUids: [] }).state;
  s = apply(db, s, "bot", { type: "mulligan", returnUids: [] }).state;
  const me = s.players.me, opp = s.players.bot;

  const pool = new Map(Object.entries(deck.main));
  const placed = [sc.vc, ...sc.hand, ...sc.drop, ...sc.soul, ...Object.values(sc.rc ?? {}).filter((k): k is string => !!k)];
  takeKeys(pool, placed, sc.name);
  // Damage comes from the triggers; the rest of the deck has none, so drive checks and searches (which shuffle) add no random Power
  let rest = [...pool].flatMap(([k, n]) => Array<string>(Math.max(0, n)).fill(k));
  [rest, s.rngState] = shuffle(rest, s.rngState);
  rest.sort((a, b) => Number(!!db[a].trigger) - Number(!!db[b].trigger));
  const damage = rest.splice(rest.length - sc.damage, sc.damage);
  rest = rest.filter((k) => !db[k].trigger);

  me.circles = { vc: inst(s, sc.vc) };
  for (const [c, k] of Object.entries(sc.rc ?? {}) as [Circle, string][]) me.circles[c] = inst(s, k);
  me.hand = sc.hand.map((k) => inst(s, k));
  me.drop = sc.drop.map((k) => inst(s, k));
  me.soul = sc.soul.map((k) => inst(s, k));
  me.damage = damage.map((k, i) => inst(s, k, i < sc.cb));
  me.deck = rest.map((k) => inst(s, k, false));
  // Face up the most-copied G unit first, keeping one face-down copy of it to stride with
  const g = Object.entries(deck.g_zone).sort((a, b) => b[1] - a[1]);
  me.gZone = g.flatMap(([k, n]) => Array.from({ length: n }, () => inst(s, k, false)));
  let up = sc.gFaceUp;
  for (const [k, n] of g) {
    const copies = me.gZone.filter((x) => x.key === k);
    for (const x of copies.slice(0, Math.min(up, db[k].type === "g-unit" ? n - 1 : n))) { x.faceUp = true; up--; }
  }
  me.bind = []; me.removed = []; me.guardian = [];

  // Opponent: a grade 3 vanguard and rear-guards to shoot at
  const units = Object.keys(deck.main).filter((k) => !isG(db[k]) && !db[k].trigger);
  const g3 = units.find((k) => db[k].grade === 3) ?? sc.vc;
  const g2 = units.find((k) => db[k].grade === 2) ?? g3;
  const g1 = units.find((k) => db[k].grade === 1) ?? g2;
  opp.circles = { vc: inst(s, g3), front_left: inst(s, g2), front_right: inst(s, g2), back_center: inst(s, g1) };
  opp.damage = [];
  opp.guardian = [];

  Object.assign(s, {
    turn: 7, turnPlayer: "me", phase: "ride", step: "stride", rodeThisTurn: true, strodeThisTurn: false,
    battle: undefined, queue: [], events: [], resolving: undefined, resume: undefined, passQueue: undefined, ordering: undefined,
  });
  makeUnhittable(s, "me");
  refreshAwaiting(s);
  return s;
}
