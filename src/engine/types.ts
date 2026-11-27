// The game's core data structures; every part (UI, bot, tutorial, replay) talks through these types
import type { Msg } from "../i18n/msg";

// ---------- Cards (read from content/cards/*/*/*.yaml) ----------

export type AbilityKind = "AUTO" | "ACT" | "CONT" | "STRIDE" | "ULTIMATE STRIDE" | "G GUARDIAN";
export type CardType = "normal" | "trigger" | "g-unit" | "g-guardian";

export interface Ability {
  kind: AbilityKind;
  zone?: string;       // "VC" | "RC" | "GC" | "VC/RC" | "hand" | "G zone"
  timing?: string;     // timing code, see vocabulary.md
  cond?: string[];
  cost?: string[];
  effect: string[];
  optional?: boolean;  // AUTO that can be declined even without a cost (cards created in the app)
  follows?: boolean;   // builds on the ability before it (e.g. needs what that one did); display only: indented under it
}

export interface Card {
  key: string;         // card code = the first part of ids[0], e.g. "G-CHB03/S11TH"
  ids: string[];
  name: string;
  format: string[];
  type: CardType;
  trigger?: "critical" | "heal" | "stand" | "draw";
  grade: number;
  power?: number;      // G units store the printed value (15000) and powerPlus = true
  powerPlus?: boolean;
  shield?: number;     // not on the card (grade 3, G units) = 0
  critical?: number;
  skill?: "boost" | "intercept" | "twin-drive" | "triple-drive";   // skill icon on the card
  triggerPower?: number;   // Power on the trigger icon (the trigger_power field in the card file)
  race: string;
  clan: string;
  abilities: Ability[];
  image?: string;      // image URL (Supabase Storage), if any
  text: string;        // ability text (the text field of the card file)
}

// ---------- Decks ----------

export interface Deck {
  id: string;
  name: string;
  format: string;
  starter: string;
  main: Record<string, number>;     // card code → count
  g_zone: Record<string, number>;
  sleeve?: string;                  // path in the card-images bucket; unset = that side's default sleeve (data/sleeves.ts)
  g_sleeve?: string;
  cover?: string;                   // card code used as the deck cover (the first card added); "" = none; unset = chosen automatically (older decks)
}

// ---------- Game state ----------

export type PlayerId = "me" | "bot";
export type Circle = "vc" | "front_left" | "front_right" | "back_left" | "back_center" | "back_right";
export type Phase = "setup" | "stand" | "draw" | "ride" | "main" | "battle" | "end";

export interface CardInstance {
  uid: string;          // unique for the whole game
  key: string;          // card code
  rested: boolean;
  faceUp: boolean;
  hollowed: boolean;
  mods: { stat: "power" | "critical" | "shield" | "drive"; value: number; source: string; until: "battle-end" | "turn-end" }[];
  usedThisTurn: string[];   // 1/Turn abilities already used (ability key)
  grants?: Ability[];       // abilities granted by other cards (end at end of turn or on zone change)
  leaving?: boolean;    // a delayed effect will remove it from the field at the end of the turn (e.g. retire the called units)
}

export interface PlayerState {
  circles: Partial<Record<Circle, CardInstance>>;
  heart?: CardInstance;
  guardian: CardInstance[];
  hand: CardInstance[];
  deck: CardInstance[];
  drop: CardInstance[];
  soul: CardInstance[];
  damage: CardInstance[];
  gZone: CardInstance[];
  bind: CardInstance[];
  removed: CardInstance[];   // removed from the game (e.g. the G assist cost)
}

// Game events AUTO abilities listen for (matching the timing codes in vocabulary.md)
export type TriggerEvent =
  | { kind: "enter"; player: PlayerId; uid: string; zone: "VC" | "RC" | "GC"; from: string }
  | { kind: "stride"; player: PlayerId; uid: string; key: string }
  | { kind: "ridden-upon"; player: PlayerId; uid: string }
  | { kind: "attack"; player: PlayerId; uid: string; circle: Circle; target: Circle }
  | { kind: "attack-hit"; player: PlayerId; uid: string; target: Circle }
  | { kind: "to-soul"; player: PlayerId; n: number }   // n cards were put into this player's soul at once; "when a card is put" triggers n times
  | { kind: "turn-end"; player: PlayerId }   // the end phase, after the G unit returns (player = the turn player)
  | { kind: "battle-end"; player: PlayerId; attackerUid: string; attackerCircle: Circle; boosterUid?: string; target: Circle }
  | { kind: "to-drop" | "retired"; player: PlayerId; uid: string; from: "RC" | "soul"; by?: "hollow"; grants: Ability[] }
  | { kind: "discarded"; player: PlayerId; uid: string; as: "g-guardian-cost" }
  | { kind: "phase-start"; player: PlayerId; phase: "battle" };

// Abilities waiting in the check timing queue
export interface QueueEntry {
  owner: PlayerId;
  uid: string;
  key: string;          // index of the ability on the card, or "g<n>" for granted abilities
  ability: Ability;
  event?: TriggerEvent;
  label: string;
  optional: boolean;    // can be declined (has a cost, or a "may" effect)
  carry?: { done: Record<string, Done[]>; at: "battle-end" | "turn-end" };   // the rest of an ability delayed by at= (see Delayed): what its earlier steps did
}

// A card an ability step acted on, remembered under a tag (souled, called, returned, charged, stood, milled) so later steps can refer to it
export interface Done { uid: string; key: string }

// The rest of an ability that waits for a later moment ("at the end of that battle / turn, ..."), queued as a forced ability then
export interface Delayed { at: "battle-end" | "turn-end"; entry: QueueEntry }

export type Choice =
  | { kind: "yesno"; prompt: Msg }
  | { kind: "option"; prompt: Msg; options: string[] }
  | { kind: "cards"; prompt: Msg; options: string[]; min: number; max: number; bonus?: { stat: "power" | "shield" | "critical"; value: number }; by?: PlayerId }   // by: the opponent answers instead of the ability's owner
  | { kind: "circle"; prompt: Msg; side: PlayerId; options: Circle[] };

export interface Resolving extends QueueEntry {
  ops: string[];
  i: number;
  asked: boolean;
  choice?: Choice;
  answer?: { uids?: string[]; to?: Circle; option?: string };
  local: Record<string, string | number | undefined>;
  done: Record<string, Done[]>;   // what the steps so far did, by tag (see Done)
  usedCircles: Circle[];
  confirmed?: boolean;  // the player already chose to use it (don't ask again)
  thatCards?: string[]; // a 1/turn ability triggered by several cards at once: any of them can be "that card", since only one trigger can resolve this turn
}

export interface GameState {
  seed: number;
  rngState: number;
  turn: number;
  turnPlayer: PlayerId;
  firstPlayer: PlayerId;
  phase: Phase;
  step?: string;
  players: Record<PlayerId, PlayerState>;
  nextUid: number;
  mulliganDone: PlayerId[];
  rodeThisTurn: boolean;
  strodeThisTurn: boolean;
  battle?: Battle;
  events: TriggerEvent[];           // events not yet checked for which AUTO abilities trigger
  queue: QueueEntry[];              // check timing queue
  delayed?: Delayed[];              // ability parts waiting for the end of the battle / turn
  resolving?: Resolving;            // the ability currently resolving
  resume?: string;                  // game step to continue once the queue is empty
  awaiting?: Decision;              // if set = the game is waiting for this player to decide
  passQueue?: PlayerId;             // the player pressed next with pending abilities: decline the optional ones and resolve the forced ones in order automatically
  ordering?: PlayerId;              // the player was asked to pick the order of their pending abilities: the last forced one waits for a click too, so the effect of the one just used is seen first
  winner?: PlayerId;
  noTriggers?: boolean;             // checks reveal cards without their trigger effects (combo lab boards, so results don't depend on luck)
}

export interface Battle {
  attacker: Circle;
  booster?: Circle;
  target: Circle;
  drivesLeft: number;
  damageLeft: number;
  hit?: boolean;
  checkCard?: CardInstance;         // the card revealed for a check (not yet in hand/damage)
  pendingTrigger?: { owner: PlayerId; kind: "critical" | "heal" | "stand" | "draw"; during: "drive" | "damage"; power: number };
  noHit?: boolean;
  triggers?: { card: CardInstance; during: "drive" | "damage"; done: boolean }[];   // triggers revealed in this battle (shown on the battle bar)
}

// ---------- Decisions / actions ----------
// The engine says what it's waiting for (Decision); the player/bot/tutorial answers with an Action

export interface Decision {
  player: PlayerId;
  kind: Action["type"];
  prompt?: Msg;
  options?: Action[];               // when the options are limited, the bot and UI use this list
  choice?: Choice;                  // choices of the resolving ability
}

export type Action =
  | { type: "mulligan"; returnUids: string[] }
  | { type: "next-phase" }
  | { type: "ride"; uid: string }
  | { type: "stride"; gUid: string; discardUids: string[] }
  | { type: "call"; uid: string; to: Circle }
  | { type: "move"; from: Circle; to: Circle }
  | { type: "attack"; attacker: Circle; target: Circle; booster?: Circle }
  | { type: "guard"; uids: string[]; intercept?: Circle[] }
  | { type: "end-guard" }
  | { type: "call-g-guardian"; gUid: string; discardUid: string }
  | { type: "activate"; cardUid: string; abilityIndex: number }
  | { type: "order-queue"; index: number; ask?: boolean }   // ask = ask the cost/"may" choice first (not counted as confirmed)
  | { type: "decline-queue"; index: number }
  | { type: "pass-queue" }
  | { type: "select-target"; uids: string[]; to?: Circle }
  | { type: "choose"; option: string }
  | { type: "trigger-target"; powerTo: Circle; extraTo?: Circle; healUid?: string }

// ---------- Action results ----------

export interface GameEvent {
  code: string;         // event code, matching the timing codes in vocabulary.md, e.g. "to-drop(own, from=RC)"
  player: PlayerId;
  cardUid?: string;
  causeIndex?: number;  // index of the causing event, used to build a nested history
  text: Msg;            // text for the play history (translated when shown)
}
