// Bots play a full game against each other: used in tests, and to measure which level beats which
import { apply, createGame } from "../engine/game";
import type { CardDB } from "../engine/rules";
import type { Deck, PlayerId } from "../engine/types";
import type { Bot } from "./types";

export async function playGame(db: CardDB, decks: Record<PlayerId, Deck>, bots: Record<PlayerId, Bot>, seed: number, firstPlayer: PlayerId = "me", maxSteps = 4000) {
  let s = createGame(db, { seed, decks, firstPlayer });
  let steps = 0;
  for (; steps < maxSteps && !s.winner && s.awaiting; steps++) {
    const p = s.awaiting.player;
    const a = await bots[p].decide(s, s.awaiting);
    const r = apply(db, s, p, a);
    for (const b of Object.values(bots)) b.observe?.(r.events);
    s = r.state;
  }
  return { winner: s.winner, turns: s.turn, steps, state: s };
}
