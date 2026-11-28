// Board-screen rules (pure functions, no React): which circles are clickable, battle numbers, and finding the card being viewed
import { BEHIND, FRONT, RC, SAME_COLUMN, canBoost as cardBoosts, canIntercept as cardIntercepts, circleMsg, isG, other, powerOf, shieldOf, vcGrade, type CardDB } from "../engine/rules";
import { abilityTag, locate, playerMsg, pull } from "../engine/state";
import type { CardInstance, Choice, Circle, GameEvent, GameState, PlayerId } from "../engine/types";
import { msg, type Msg, type MsgKey } from "../i18n/msg";
import { abilitySummary } from "./skillBlocks";

// The board before dealing: hand cards go back on top of the deck; starterOnVc = false also puts the starting vanguard back on top of the deck
// Nobody needs to answer anything (so the bot doesn't start thinking before dealing is done)
export function undealt(state: GameState, starterOnVc: boolean): GameState {
  const s = structuredClone(state);
  s.awaiting = undefined;
  for (const ps of Object.values(s.players)) {
    ps.deck.unshift(...ps.hand.splice(0));
    if (!starterOnVc && ps.circles.vc) { ps.deck.unshift(ps.circles.vc); delete ps.circles.vc; }
  }
  return s;
}

// Intermediate mulligan step: the chosen cards go back into the deck first (no redraw yet); nobody needs to answer anything meanwhile
export function returningToDeck(state: GameState, p: PlayerId, uids: string[]): GameState {
  const s = structuredClone(state);
  s.awaiting = undefined;
  const ps = s.players[p];
  ps.deck.push(...ps.hand.filter((c) => uids.includes(c.uid)));
  ps.hand = ps.hand.filter((c) => !uids.includes(c.uid));
  return s;
}

// Cards an action showed the opponent (revealed from hand or the top of the deck, searched into hand, the whole hand, drive checks); next = the state after the action
// drive = drive check cards (shown on the attacker's side of the battle bar like triggers, the rest in the middle of the board)
export function revealedBy(events: GameEvent[], next: GameState): { player: PlayerId; uids: string[]; drive: string[] } | undefined {
  const uids: string[] = [], drive: string[] = [];
  let player: PlayerId | undefined;
  for (const e of events) {
    const found = e.text.key === "log.revealHand" ? next.players[e.player].hand.map((h) => h.uid)
      : (e.text.key === "log.reveal" || e.text.key === "log.revealTop" || e.text.key === "log.searchHand" || e.code === "drive-check") && e.cardUid ? [e.cardUid] : [];
    if (!found.length) continue;
    player ??= e.player;
    if (e.code === "drive-check") drive.push(...found);
    uids.push(...found.filter((u) => !uids.includes(u)));
  }
  return player && { player, uids, drive };
}

// Intermediate step: the revealed cards leave where they were (to be shown in the middle of the board or the battle bar); nobody needs to answer anything meanwhile
export function revealing(state: GameState, uids: string[]): { s: GameState; cards: CardInstance[] } {
  const s = structuredClone(state);
  s.awaiting = undefined;
  const cards = uids.filter((u) => locate(s, u)).map((u) => ({ ...pull(s, u).inst, faceUp: true, rested: false }));
  return { s, cards };
}

// The steps shown for an action that revealed cards: drive checks go one card at a time (revealed on the battle bar, then into the hand before the next one)
// Other revealed cards (search, reveal from hand) are shown together in the middle of the board on every step
export function revealSteps(state: GameState, shown: { player: PlayerId; uids: string[]; drive: string[] }): { s: GameState; cards: CardInstance[]; drive: CardInstance[] }[] {
  const rest = shown.uids.filter((u) => !shown.drive.includes(u));
  const drives = shown.drive.length ? shown.drive : [undefined];
  return drives.map((_, k) => {
    const mid = revealing(state, [...rest, ...shown.drive.slice(0, k + 1)]);
    const done = shown.drive.slice(0, k);
    mid.s.players[shown.player].hand.push(...mid.cards.filter((c) => done.includes(c.uid)));
    return { s: mid.s, cards: mid.cards.filter((c) => rest.includes(c.uid)), drive: mid.cards.filter((c) => c.uid === shown.drive[k]) };
  });
}

export type Zone = "deck" | "drop" | "soul" | "rcSoul" | "damage" | "gZone" | "bind";   // rcSoul: the soul of the rear-guard on pile.circle
export type Sel =
  | { kind: "hand"; player: PlayerId; uid: string }
  | { kind: "circle"; player: PlayerId; circle: Circle }
  | { kind: "attack"; player: PlayerId; col: Circle; front: boolean; back: boolean };   // battle: attacker (front row) and booster (back row) in the same column

// Front-row circle of this circle's column (vc ↔ back_center, front ↔ back left/right)
export const columnOf = (c: Circle): Circle => (FRONT.includes(c) ? c : FRONT.find((f) => BEHIND[f] === c)!);
export type Mode =
  | { kind: "mulligan"; picks: string[] }
  | { kind: "stride"; gUid?: string; picks: string[] }            // G unit to stride + hand cards to discard (total grade 3+)
  | { kind: "gguard"; gUid: string; discardUid?: string }
  | { kind: "guard"; picks: string[] }                      // hand cards chosen to guard (several allowed)
  | { kind: "trigger"; powerTo?: Circle };
export type LogEntry = GameEvent & { turn: number };
export type Light = "source" | "active" | undefined;   // yellow border = ability pending, orange border = selected/resolving

// Rows in the phase bar in game order: START (setup/mulligan), then STAND → END in a loop, with RIDE and STRIDE as separate rows
export const PHASES: { label: MsgKey; phase: GameState["phase"]; step?: string }[] = [
  { label: "phase.setup", phase: "setup" },
  { label: "phase.stand", phase: "stand" },
  { label: "phase.draw", phase: "draw" },
  { label: "phase.ride", phase: "ride", step: "ride" },
  { label: "phase.stride", phase: "ride", step: "stride" },
  { label: "phase.main", phase: "main" },
  { label: "phase.battle", phase: "battle" },
  { label: "phase.end", phase: "end" },
];
export const phaseIndex = (s: GameState) => PHASES.findIndex((p) => p.phase === s.phase && (!p.step || p.step === s.step));

// key = "phase:step" of the current state
const stepKey = (s: GameState) => `${s.phase}:${s.step ?? ""}`;
const NEXT_LABEL: Record<string, MsgKey> = {
  "draw:": "btn.none", "ride:ride": "btn.none", "ride:stride": "btn.none", "main:": "next.toBattle", "battle:attack": "next.endTurn",
  "battle:guard": "next.noMoreGuard",
};
export function nextLabel(s: GameState): MsgKey | undefined {
  if (s.awaiting?.kind === "guard" || (s.awaiting?.kind === "order-queue" && s.battle && s.step === "guard")) return NEXT_LABEL["battle:guard"];
  if (s.awaiting?.kind !== "next-phase" && s.awaiting?.kind !== "order-queue") return undefined;
  if (stepKey(s) === "ride:stride" && s.strodeThisTurn) return "next.toMain";                // already strode, not a skip
  if (stepKey(s) === "main:" && s.turn === 1) return NEXT_LABEL["battle:attack"];                     // no battle on the first turn
  return NEXT_LABEL[stepKey(s)];
}

// Step name shown in the middle of the bar while the turn player can still act in that step (the Skip button sits far right)
export function stepText(s: GameState): MsgKey | undefined {
  if (s.phase === "draw" && s.queue.some((e) => e.key === "g-assist")) return "step.gAssist";
  if (stepKey(s) === "ride:ride") return "step.ride";
  if (stepKey(s) === "ride:stride" && !s.strodeThisTurn) return "step.stride";
}

// Seen from our side: the bot's board is upside down, back row on top, and left-right swapped
export const LAYOUT: Record<PlayerId, Circle[]> = {
  bot: ["back_right", "back_center", "back_left", "front_right", "vc", "front_left"],
  me: ["front_left", "vc", "front_right", "back_left", "back_center", "back_right"],
};

const INTERCEPT: Circle[] = ["front_left", "front_right"];
export const canIntercept = (c: Circle) => INTERCEPT.includes(c);

// Card by uid with a location label (including the card being revealed for a check)
export function findCard(s: GameState, uid: string): { inst: CardInstance; player: PlayerId; where: Msg; circle?: Circle } | undefined {
  const at = locate(s, uid);
  if (at) {
    const where = at.zone === "circle" ? circleMsg(at.circle!) : msg(`zone.${at.zone}`);
    return { inst: at.inst, player: at.player, where, circle: at.circle };
  }
  const c = s.battle?.checkCard;
  if (c?.uid === uid) return { inst: c, player: s.turnPlayer, where: msg("zone.check") };
}

export interface TargetContext {
  s: GameState;
  db: CardDB;
  actor?: PlayerId;
  choice?: Choice;
  sel: Sel | null;
  mode: Mode | null;
}

// Circles highlighted as clickable in the current state
export function isTarget({ s, db, actor, choice, sel, mode }: TargetContext, p: PlayerId, c: Circle): boolean {
  const unit = s.players[p].circles[c];
  if (choice) return choice.kind === "circle" && p === choice.side && choice.options.includes(c);
  if (mode?.kind === "trigger") return p === actor && !!unit;
  if (s.step === "guard" && s.battle) return p === actor && p !== s.turnPlayer && canIntercept(c) && !!unit && cardIntercepts(db[unit.key]) && c !== s.battle.target;
  if (sel?.kind === "hand" && p === actor) {
    if (s.phase === "ride" && s.step === "ride") {
      // Ride: the same grade as the vanguard or one higher, once per turn
      const card = db[s.players[p].hand.find((h) => h.uid === sel.uid)?.key ?? ""];
      const g = vcGrade(db, s.players[p]);
      return c === "vc" && !s.rodeThisTurn && !!card && !isG(card) && (card.grade === g || card.grade === g + 1);
    }
    if (s.phase === "main") return RC.includes(c);
  }
  if (sel?.kind === "circle" && s.phase === "main" && p === actor) return SAME_COLUMN[sel.circle] === c;
  if (sel?.kind === "attack" && p !== actor) return sel.front && FRONT.includes(c) && !!unit;
  return false;
}

// Can boost: a standing grade 0-1
export const canBoost = (db: CardDB, inst: CardInstance) => !inst.rested && cardBoosts(db[inst.key]);

export function battleSummary(db: CardDB, s: GameState) {
  const b = s.battle;
  if (!b) return undefined;
  const atkP = s.turnPlayer, defP = other(atkP);
  const attack = powerOf(db, s.players[atkP], b.attacker);
  const defense = powerOf(db, s.players[defP], b.target);
  const guardians = s.players[defP].guardian;
  const shield = guardians.reduce((n, g) => n + shieldOf(db, g), 0);
  const total = defense + shield;
  const atk = s.players[atkP].circles[b.attacker], tgt = s.players[defP].circles[b.target];
  return {
    atkLabel: msg("battle.label", { player: playerMsg(atkP), card: atk ? db[atk.key].name : "" }),
    defLabel: msg("battle.label", { player: playerMsg(defP), card: tgt ? db[tgt.key].name : "" }),
    boosted: !!b.booster,
    attack, defense, shield, total, guardians,
    checkCard: b.checkCard,
    shieldNeeded: Math.max(0, Math.ceil((attack - total + 1) / 5000) * 5000),
    hit: attack >= total,
  };
}

// Pile zones containing an ability's source card (cards on the board, hand, GC highlight the card itself; piles highlight the whole slot)
export function sourcePiles(s: GameState, uids: string[]): Record<PlayerId, Set<string>> {
  const out: Record<PlayerId, Set<string>> = { me: new Set(), bot: new Set() };
  for (const u of uids) {
    const at = locate(s, u);
    if (at && at.zone !== "circle" && at.zone !== "hand" && at.zone !== "guardian") out[at.player].add(at.zone === "heart" ? "soul" : at.zone);
  }
  return out;
}

export function groupByTurn(log: LogEntry[]): { turn: number; items: LogEntry[] }[] {
  const turns: { turn: number; items: LogEntry[] }[] = [];
  for (const e of log) {
    const turn = e.code === "mulligan" ? 0 : e.turn;   // the second player's mulligan happens when the game starts (turn 1) but is part of setup
    if (turns.at(-1)?.turn !== turn) turns.push({ turn, items: [] });
    turns.at(-1)!.items.push(e);
  }
  return turns;
}

// An ability the other side started, shown in the middle of the board for a moment: the card, the ability's tag ([AUTO 2]), and what it does
export interface ShownAbility { inst: CardInstance; tag: string; text?: string }

export function abilitiesStarted(db: CardDB, events: GameEvent[], s: GameState, side: PlayerId): ShownAbility[] {
  return events.filter((e) => e.code === "ability" && e.player === side && e.cardUid).flatMap((e) => shownAbility(db, s, e.cardUid!, String(e.text.params?.label ?? "")) ?? []);
}

// The ability the other side is resolving right now (it stays on show while they make its choices)
export const abilityResolving = (db: CardDB, s: GameState, side: PlayerId): ShownAbility | undefined =>
  s.resolving?.owner === side ? shownAbility(db, s, s.resolving.uid, s.resolving.label) : undefined;

function shownAbility(db: CardDB, s: GameState, uid: string, label: string): ShownAbility | undefined {
  const f = findCard(s, uid);
  if (!f) return undefined;
  const tag = abilityTag(label);
  const card = db[f.inst.key];
  const m = tag.match(/^\[(\w+)(?: (\d+))?(, granted)?\]$/);
  const same = m && !m[3] ? card.abilities.filter((a) => a.kind === m[1]) : [];
  const ab = m?.[2] ? same[Number(m[2]) - 1] : same.length === 1 ? same[0] : undefined;
  return { inst: { ...f.inst, faceUp: true, rested: false }, tag, text: ab && abilitySummary(card.text, card.abilities, ab) };
}
