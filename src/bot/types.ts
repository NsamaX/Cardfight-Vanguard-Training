import type { Action, Decision, GameEvent, GameState } from "../engine/types";

// The bot gets the full state but must decide only from what its side can see (always run viewFor() in view.ts before thinking)
// Adding a new bot level = write a new class implementing this interface
export interface Bot {
  name: string;
  observe?(events: GameEvent[]): void;   // every event in the game (used to remember cards that were revealed)
  decide(state: GameState, decision: Decision): Promise<Action>;
}
