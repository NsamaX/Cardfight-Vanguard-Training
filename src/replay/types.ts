import type { BotLevel } from "../bot";
import type { Action, Card, Deck, GameState, PlayerId } from "../engine/types";
import type { LogEntry } from "../lib/board";

export interface RecordedAction { player: PlayerId; action: Action }

// A replay doesn't store board images, only seed + decks + every action in order
// Replaying = start a game with the same seed (or the start board if present), then feed the actions into the engine one by one
// Bot games don't store card data, so they run against the current card library; editing a card can make an old replay
// diverge (play.ts stops at brokenAt). Online games store the match's cards (the opponent's aren't in our library).
export interface Replay {
  version: 1;
  id: string;
  createdAt: string;
  title: string;          // e.g. "Granblue Nightrose vs Granblue Nightrose"
  seed: number;
  firstPlayer: PlayerId;
  decks: Record<PlayerId, Deck>;
  start?: GameState;      // a game continued from a states replay: start from this board instead of a new game
  bot?: BotLevel | "off";   // "off" = an old replay from the control-both-sides mode (no longer used)
  actions: RecordedAction[];
  winner?: PlayerId;
  turn: number;
  cards?: Card[];         // online: the cards both decks use, as they were in the match (installed while viewing)
  seat?: PlayerId;        // online: the side that saved it (default "me"), for Won/Lost
}

// A file that stores the board at every step (games played before action recording existed)
export interface StatesFile {
  kind: "states";
  decks: Record<PlayerId, Deck>;
  states: GameState[];
  log: LogEntry[];
}

export type ReplaySource = Replay | StatesFile;
