// Helpers for moving cards between zones, shared by game.ts and abilities.ts
import { msg, type Msg } from "../i18n/msg";
import { PLAYERS, other, type CardDB } from "./rules";
import type { CardInstance, Circle, GameEvent, GameState, PlayerId, PlayerState } from "./types";

export const playerMsg = (p: PlayerId): Msg => msg(`player.${p}`);

// Ability label in questions: shows only the kind, e.g. "[AUTO]", not the card name (the source card already has a colored border)
export const abilityTag = (label: string) => label.match(/\[[^\]]+\]$/)?.[0] ?? label;

export type Out = GameEvent[];

// Reset state when a card changes zone (by the rules, a card that changes zone is a new card)
export function reset(inst: CardInstance, faceUp = true): CardInstance {
  inst.rested = false;
  inst.hollowed = false;
  inst.mods = [];
  inst.grants = [];
  inst.retireAtTurnEnd = false;
  inst.soulAtBattleEnd = false;
  inst.faceUp = faceUp;
  return inst;
}

export function takeFrom(list: CardInstance[], uid: string, what: string): CardInstance {
  const i = list.findIndex((c) => c.uid === uid);
  if (i < 0) throw new Error(`card not found in ${what}`);
  return list.splice(i, 1)[0];
}

export const name = (db: CardDB, inst: CardInstance) => db[inst.key].name;

export function ev(out: Out, code: string, player: PlayerId, text: Msg, cardUid?: string) {
  out.push({ code, player, text, cardUid });
}

export function win(s: GameState, p: PlayerId, out: Out, why: Msg) {
  s.winner = p;
  s.awaiting = undefined;
  ev(out, "win", p, msg("log.win", { why, winner: msg(`winner.${p}`) }));
}

export function drawCard(s: GameState, p: PlayerId, out: Out): boolean {
  const top = s.players[p].deck.shift();
  if (!top) {
    win(s, other(p), out, msg("win.deckOutDraw", { player: playerMsg(p) }));
    return false;
  }
  s.players[p].hand.push(reset(top));
  ev(out, "draw", p, msg("log.draw", { player: playerMsg(p) }));
  return true;
}

export const fieldUnits = (ps: PlayerState) => Object.values(ps.circles).filter((i): i is CardInstance => !!i);

export const PILE_ZONES = ["hand", "guardian", "drop", "soul", "damage", "gZone", "bind", "removed", "deck"] as const;
export type PileZone = (typeof PILE_ZONES)[number];

export const circleOf = (s: GameState, p: PlayerId, uid: string): Circle | undefined =>
  (Object.entries(s.players[p].circles).find(([, i]) => i?.uid === uid)?.[0] as Circle | undefined);

// Find a card by uid in every zone
export function locate(s: GameState, uid: string): { player: PlayerId; inst: CardInstance; zone: PileZone | "circle" | "heart"; circle?: Circle } | undefined {
  for (const p of PLAYERS) {
    const ps = s.players[p];
    const c = circleOf(s, p, uid);
    if (c) return { player: p, inst: ps.circles[c]!, zone: "circle", circle: c };
    if (ps.heart?.uid === uid) return { player: p, inst: ps.heart, zone: "heart" };
    for (const z of PILE_ZONES) {
      const inst = ps[z].find((i) => i.uid === uid);
      if (inst) return { player: p, inst, zone: z };
    }
  }
  return undefined;
}

// Take a card out of its zone (not the board) to place it elsewhere
export function pull(s: GameState, uid: string): { inst: CardInstance; zone: string; player: PlayerId } {
  const at = locate(s, uid);
  if (!at) throw new Error("card not found");
  const ps = s.players[at.player];
  if (at.zone === "circle") delete ps.circles[at.circle!];
  else if (at.zone === "heart") ps.heart = undefined;
  else takeFrom(ps[at.zone], uid, at.zone);
  return at;
}
