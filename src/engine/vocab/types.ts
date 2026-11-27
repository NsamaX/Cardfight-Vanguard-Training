// Shared shapes for the ability vocabulary: every code a card file can use is declared once in a registry
// (filters, counters, conditions, selectors, timings, ops), and the resolver, the validator, and the card editor all read from there.
import type { Msg } from "../../i18n/msg";
import type { Code } from "../code";
import type { CardDB } from "../rules";
import type { Out } from "../state";
import type { Ability, CardInstance, GameState, PlayerId, Resolving, TriggerEvent } from "../types";

// Where a check happens: the ability's owner and source card, plus the resolving ability when there is one
// (counters and conditions about "this effect" need r; at trigger time there's none and they count 0)
export interface Scope {
  db: CardDB;
  s: GameState;
  owner: PlayerId;
  source?: CardInstance;
  key?: string;          // the ability's key on the source card (for 1/turn)
  r?: Resolving;
  mode?: string;         // what the game is doing while a CONT is checked, e.g. "stride-cost" (while(…) conditions)
}

// One ability step running: the parsed code plus helpers to log, ask, and find the source card
export interface Ctx extends Scope {
  r: Resolving;
  out: Out;
  c: Code;
}

// Documentation for the editor and the validator: the forms a code takes (# = a number), what it does, and the cards using it
export interface Doc {
  forms: string[];
  text: string;
}

export interface OpSpec extends Doc {
  // true = done, false = waiting for an answer (the step runs again with r.answer set)
  run(ctx: Ctx): boolean;
  // Only for codes used as costs: whether the cost can be paid now
  canPay?(ctx: Ctx): boolean;
  // For codes a CONT ability may use: apply the effect as a "cont" modifier (computed again after every change, see cont.ts)
  cont?(ctx: Ctx): void;
  // For chain search without a board (vocab/chains.ts): the moves and strides this code causes
  causes?(c: Code, ab: Ability): Caused[];
  // Name of a code that has no in-game effect (a deck building keyword, etc.): the resolver skips it
  passive?: boolean;
}

export interface TimingSpec extends Doc {
  matches(e: TriggerEvent, code: Code, uid: string, owner: PlayerId, db: CardDB): boolean;
}

export interface CounterSpec extends Doc {
  // arg: the text inside the parentheses, if any (e.g. a filter)
  count(scope: Scope, arg: string): number;
}

export interface PredicateSpec extends Doc {
  test(scope: Scope, arg: string, phase: "trigger" | "resolve"): boolean;
}

// Static card filters need only the card (and the ability's source card); combo search uses them without a board
export interface FilterSpec extends Doc {
  test(card: import("../types").Card, arg: string, env: FilterEnv): boolean;
}

export interface FilterEnv {
  db: CardDB;
  source?: import("../types").Card;
  sourceKey?: string;
  thatUids?: string[];   // cards the triggering event was about ("that card")
  uid?: string;          // the tested card's uid on the board, if any
}

// A move a code causes, for chain search: who moved (self = this card, chosen = a card matching filter, opp = an opponent's card)
export interface Caused {
  move?: { from: import("../types").Zone; to: import("../types").Zone; by?: "retire" | "hollow"; as?: "g-guardian-cost" };
  stride?: true;
  who: "self" | "chosen" | "opp";
  filter?: string;
}

export type Question = Msg;
export type { Ability };
