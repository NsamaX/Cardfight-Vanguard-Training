// G-era phase and battle mechanics + the hook into the ability system (abilities.ts)
// apply() takes state + an action and returns a new state + events; never modifies the old state, and randomizes only via the seed
import { actAt, blocked, condOk, declineEntry, emit, releaseDelayed, settle, startResolving, type ResumeHandlers } from "./abilities";
import { moveCard, moved, placeOnRC, retireUnit, strideOnto } from "./zones";
import { attackTaxes, guardianDiscardFilter, isUltimate, payRuleCost, refreshContinuous, strideCostOk } from "./cont";
import { cardMatches } from "./vocab/filters";
import { cloneState } from "./clone";
import { shuffle } from "./rng";
import { msg, type Msg } from "../i18n/msg";
import {
  BEHIND, FRONT, PLAYERS, RC, SAME_COLUMN, RuleError, bothVanguardsGrade3, canBoost, canIntercept, circleMsg, criticalOf, driveOf, isG, other, powerOf, shieldOf,
  triggerPower,
  vcGrade,
  type CardDB,
} from "./rules";
import { abilityTag, drawCard, ev, fieldUnits, locate, name, playerMsg, reset, takeFrom, win, type Out } from "./state";
import type { Action, CardInstance, Choice, GameEvent, GameState, PlayerId, PlayerState, Resolving } from "./types";

export interface NewGame {
  seed: number;
  decks: Record<PlayerId, import("./types").Deck>;
  firstPlayer: PlayerId;
}

export interface Result {
  state: GameState;
  events: GameEvent[];
}

function newInstance(s: GameState, key: string, faceUp = true): CardInstance {
  return { uid: "c" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] };
}

function emptyPlayer(): PlayerState {
  return { circles: {}, guardian: [], hand: [], deck: [], drop: [], soul: [], damage: [], gZone: [], bind: [], removed: [] };
}

// ---------- Create a game ----------

export function createGame(_db: CardDB, opts: NewGame): GameState {   // db kept for the same signature as the other engine entry points
  const s: GameState = {
    seed: opts.seed, rngState: opts.seed, turn: 0, turnPlayer: opts.firstPlayer, firstPlayer: opts.firstPlayer,
    phase: "setup", players: { me: emptyPlayer(), bot: emptyPlayer() }, nextUid: 1, mulliganDone: [],
    rodeThisTurn: false, strodeThisTurn: false, events: [], queue: [],
  };
  for (const p of PLAYERS) {
    const deck = opts.decks[p];
    const ps = s.players[p];
    const keys = Object.entries(deck.main).flatMap(([k, n]) => Array<string>(n).fill(k));
    keys.splice(keys.indexOf(deck.starter), 1);
    ps.circles.vc = newInstance(s, deck.starter, false);
    let shuffled: string[];
    [shuffled, s.rngState] = shuffle(keys, s.rngState);
    ps.deck = shuffled.map((k) => newInstance(s, k, false));
    ps.gZone = Object.entries(deck.g_zone).flatMap(([k, n]) => Array.from({ length: n }, () => newInstance(s, k, false)));
    ps.hand = ps.deck.splice(0, 5).map((c) => reset(c));
  }
  refreshAwaiting(s);
  return s;
}

// ---------- Entry point ----------

export const ANSWERS: Action["type"][] = ["choose", "select-target", "order-queue", "decline-queue", "pass-queue"];

export function apply(db: CardDB, state: GameState, player: PlayerId, action: Action): Result {
  if (state.winner) throw new RuleError("err.gameOver");
  if (state.awaiting && state.awaiting.player !== player) throw new RuleError("err.turnOf", { player: playerMsg(state.awaiting.player) });
  const busy = !!state.resolving || state.queue.length > 0;
  if (busy && !ANSWERS.includes(action.type)) throw new RuleError("err.resolveFirst");
  if (!busy && ANSWERS.includes(action.type)) throw new RuleError("err.noPendingAnswer");
  const s: GameState = cloneState(state);
  const out: Out = [];
  refreshContinuous(db, s);
  HANDLERS[action.type](db, s, player, action as never, out);
  settle(db, s, out, RESUME);
  refreshContinuous(db, s);
  refreshAwaiting(s);
  return { state: s, events: out };
}

type Handler<T extends Action["type"]> = (db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: T }>, out: Out) => void;

const HANDLERS: { [T in Action["type"]]: Handler<T> } = {
  mulligan, "next-phase": nextPhase, ride, stride, call, move, attack, guard, "end-guard": endGuard,
  "call-g-guardian": callGGuardian, "trigger-target": triggerTarget,
  activate, "order-queue": orderQueue, "decline-queue": declineQueue, "pass-queue": passQueue, "select-target": selectTarget, choose,
};

const RESUME: ResumeHandlers = { close: closeBattle, "close-finish": finishClose, "end-finish": finishEnd, "ride-finish": finishRide, "draw-finish": finishDraw };

function requirePhase(s: GameState, p: PlayerId, phase: GameState["phase"], step?: string) {
  if (s.turnPlayer !== p) throw new RuleError("err.notYourTurn");
  if (s.phase !== phase || (step && s.step !== step)) throw new RuleError("err.wrongPhase");
}

// ---------- Answer an ability's question ----------

const chooser = (r: Resolving) => (r.choice?.kind === "cards" && r.choice.by) || r.owner;

function currentChoice(s: GameState, p: PlayerId): Choice {
  const r = s.resolving;
  if (!r?.choice || chooser(r) !== p) throw new RuleError("err.noQuestion");
  return r.choice;
}

function choose(_db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "choose" }>) {
  const c = currentChoice(s, p);
  const ok = c.kind === "yesno" ? ["yes", "no"] : c.kind === "option" ? c.options : [];
  if (!ok.includes(a.option)) throw new RuleError("err.badOption");
  s.resolving!.answer = { option: a.option };
  s.resolving!.choice = undefined;
}

function selectTarget(_db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "select-target" }>) {
  const c = currentChoice(s, p);
  if (c.kind === "cards") {
    if (a.uids.some((u) => !c.options.includes(u)) || new Set(a.uids).size !== a.uids.length) throw new RuleError("err.cardNotOption");
    if (a.uids.length < c.min || a.uids.length > c.max) throw new RuleError("err.pickCount", { range: c.min === c.max ? String(c.min) : `${c.min}-${c.max}` });
    s.resolving!.answer = { uids: a.uids };
  } else if (c.kind === "circle") {
    if (a.to && !c.options.includes(a.to)) throw new RuleError("err.circleNotOption");
    s.resolving!.answer = { to: a.to, uids: [] };
  } else throw new RuleError("err.needOption");
  s.resolving!.choice = undefined;
}

// Use a pending ability (the player already chose to use it, so don't ask the cost again)
function orderQueue(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "order-queue" }>, out: Out) {
  startResolving(db, s, queuedEntry(s, p, a.index), out, !a.ask);
}

function queuedEntry(s: GameState, p: PlayerId, index: number) {
  if (s.resolving) throw new RuleError("err.resolving");
  const entry = s.queue.filter((e) => e.owner === p)[index];
  if (!entry) throw new RuleError("err.noQueueIndex");
  return entry;
}

function declineQueue(_db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "decline-queue" }>, out: Out) {
  const entry = queuedEntry(s, p, a.index);
  if (!entry.optional) throw new RuleError("err.mandatory");
  declineEntry(s, entry, out);
}

function passQueue(_db: CardDB, s: GameState, p: PlayerId) {
  if (s.resolving || !s.queue.some((e) => e.owner === p)) throw new RuleError("err.noQueued");
  s.passQueue = p;
}

function activate(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "activate" }>, out: Out) {
  requirePhase(s, p, "main");
  const at = locate(s, a.cardUid);
  const fromG = at?.zone === "gZone" && !at.inst.faceUp;
  if (!at || at.player !== p || (at.zone !== "circle" && !fromG)) throw new RuleError("err.actOwnField");
  const { key, ab } = actAt(db, at.inst, a.abilityIndex);
  if (ab?.kind !== "ACT") throw new RuleError("err.notAct");
  const zone = ab.zone ?? "";
  const zoneOk = fromG ? zone === "G zone" : !zone || zone.split("/").some((z) => (z === "VC" ? at.circle === "vc" : z === "RC" ? at.circle !== "vc" : false));
  if (!zoneOk) throw new RuleError("err.actZone", { zone });
  if (!condOk(db, s, p, at.inst, key, ab, "resolve")) throw new RuleError("err.condUnmet");
  const entry = { owner: p, uid: at.inst.uid, key, ability: ab, label: `${name(db, at.inst)} [ACT]`, optional: true };
  s.queue.push(entry);
  startResolving(db, s, entry, out, true);
  if (!s.resolving) throw new RuleError("err.cannotPay");
}

// ACT usable now: the turn player's main phase, no other pending ability, and the cost can be paid
export function usableActs(db: CardDB, s: GameState): { uid: string; index: number; label: string; cost: string[] }[] {
  const p = s.turnPlayer;
  if (s.phase !== "main" || s.awaiting?.kind !== "next-phase") return [];
  // Units' ACT, and ACT of face-down G zone cards that work from the G zone (e.g. Sebreeze)
  const fromG = s.players[p].gZone.filter((g) => !g.faceUp && db[g.key].abilities.some((ab) => ab.kind === "ACT" && ab.zone === "G zone"));
  return [...Object.values(s.players[p].circles), ...fromG].flatMap((inst) => !inst ? [] : [...db[inst.key].abilities, ...(inst.grants ?? [])].flatMap((ab, index) => {
    if (ab.kind !== "ACT") return [];
    if (fromG.includes(inst) !== (ab.zone === "G zone")) return [];
    const label = `${name(db, inst)} [ACT]`;
    if (blocked(db, s, { owner: p, uid: inst.uid, key: actAt(db, inst, index).key, ability: ab, label, optional: true })) return [];
    return [{ uid: inst.uid, index, label, cost: ab.cost ?? [] }];
  }));
}

// ---------- Game setup ----------

function mulligan(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "mulligan" }>, out: Out) {
  if (s.phase !== "setup" || s.mulliganDone.includes(p)) throw new RuleError("err.mulliganDone");
  const ps = s.players[p];
  const back = a.returnUids.map((uid) => takeFrom(ps.hand, uid, "hand"));
  ps.hand.push(...ps.deck.splice(0, back.length).map((c) => reset(c)));
  ps.deck.push(...back.map((c) => reset(c, false)));
  [ps.deck, s.rngState] = shuffle(ps.deck, s.rngState);
  s.mulliganDone.push(p);
  ev(out, "mulligan", p, msg("log.mulligan", { player: playerMsg(p), n: back.length }));
  if (s.mulliganDone.length === 2) {
    for (const q of PLAYERS) s.players[q].circles.vc!.faceUp = true;
    ev(out, "stand-up", s.firstPlayer, msg("log.standUp"));
    s.turn = 1;
    startTurn(db, s, out);
  }
}

// ---------- Phases ----------

function startTurn(db: CardDB, s: GameState, out: Out) {
  const p = s.turnPlayer;
  s.rodeThisTurn = false;
  s.strodeThisTurn = false;
  s.battlesThisTurn = 0;
  ev(out, "turn-start", p, msg("log.turnStart", { turn: s.turn, player: playerMsg(p) }));
  s.phase = "stand";
  for (const inst of fieldUnits(s.players[p])) inst.rested = false;
  s.phase = "draw";
  if (!drawCard(s, p, out)) return;
  queueGAssist(db, s, p);
  s.resume = "draw-finish";
}

// G assist step: the vanguard is below grade 3 and the hand has no unit one grade above the vanguard; optional
function queueGAssist(db: CardDB, s: GameState, p: PlayerId) {
  const ps = s.players[p];
  const vc = ps.circles.vc;
  const next = vcGrade(db, ps) + 1;
  if (!vc || next > 3 || ps.hand.some((c) => !isG(db[c.key]) && db[c.key].grade === next)) return;
  s.queue.push({ owner: p, uid: vc.uid, key: "g-assist", ability: { kind: "AUTO", effect: [`g-assist(${next})`] }, label: "G ASSIST", optional: true });
}

function finishDraw(_db: CardDB, s: GameState) {
  s.phase = "ride";
  s.step = "ride";
}

// The stride step happens when both vanguards are grade 3 or higher, otherwise go straight to the main phase
function enterStrideStep(db: CardDB, s: GameState) {
  if (bothVanguardsGrade3(db, s)) s.step = "stride";
  else { s.phase = "main"; s.step = undefined; }
}

// After riding (and once abilities triggered by the ride are done), go to the next step automatically
function finishRide(db: CardDB, s: GameState) {
  if (s.phase === "ride" && s.step === "ride") enterStrideStep(db, s);
}

function nextPhase(db: CardDB, s: GameState, p: PlayerId, _a: Action, out: Out) {
  if (s.turnPlayer !== p || s.battle) throw new RuleError("err.cannotSkipPhase");
  if (s.phase === "ride" && s.step === "ride") enterStrideStep(db, s);
  else if (s.phase === "ride") { s.phase = "main"; s.step = undefined; }
  else if (s.phase === "main" && s.turn === 1) endTurn(db, s, out);   // the first player can't attack on the first turn, so skip the battle phase
  else if (s.phase === "main") {
    s.phase = "battle";
    s.step = "attack";
    ev(out, "phase-start", p, msg("log.battlePhase"));
    emit(db, s, { kind: "phase-start", player: p, phase: "battle" });
  } else if (s.phase === "battle") endTurn(db, s, out);
  else throw new RuleError("err.cannotSkipPhase");
}

// End phase: 1) G units return to the G zone 2) retire hollowed units (end-of-turn AUTO) 3) effects expire, then the turn changes
function endTurn(db: CardDB, s: GameState, out: Out) {
  const p = s.turnPlayer;
  const ps = s.players[p];
  s.phase = "end";
  s.step = undefined;
  const vc = ps.circles.vc!;
  if (db[vc.key].type === "g-unit" && ps.heart) {
    const heart = ps.heart;
    heart.rested = vc.rested;
    ps.circles.vc = heart;
    ps.heart = undefined;
    ps.gZone.push(reset(vc, true));
    ev(out, "g-return", p, msg("log.gReturn", { card: name(db, vc) }), vc.uid);
    if (ps.ultimateStrode) {
      ps.ultimateStrode = false;
      for (const g of [...ps.gZone]) moveCard(db, s, g.uid, "removed");
      ev(out, "g-removed", p, msg("log.gZoneRemoved", { player: playerMsg(p) }));
    }
  }
  emit(db, s, { kind: "turn-end", player: p });
  releaseDelayed(s, "turn-end");
  retireEndOfTurn(db, s, out);
  s.resume = "end-finish";
}

function retireEndOfTurn(db: CardDB, s: GameState, out: Out): boolean {
  let any = false;
  for (const q of [s.turnPlayer, other(s.turnPlayer)]) {
    for (const c of RC) {
      const u = s.players[q].circles[c];
      if (u?.hollowed) { retireUnit(db, s, q, c, out, msg("reason.hollow"), "hollow"); any = true; }
    }
  }
  return any;
}

function finishEnd(db: CardDB, s: GameState, out: Out) {
  // A unit called back during the end phase and hollowed again is retired again
  if (retireEndOfTurn(db, s, out)) { s.resume = "end-finish"; return; }
  for (const q of PLAYERS) {
    for (const inst of fieldUnits(s.players[q])) {
      inst.mods = inst.mods.filter((m) => m.until !== "turn-end" && m.until !== "battle-end");
      inst.usedThisTurn = [];
      inst.grants = [];
    }
  }
  s.players[s.turnPlayer].rodeLastTurn = s.rodeThisTurn;
  s.turn++;
  s.turnPlayer = other(s.turnPlayer);
  startTurn(db, s, out);
}

// ---------- Ride phase ----------

function ride(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "ride" }>, out: Out) {
  requirePhase(s, p, "ride", "ride");
  if (s.rodeThisTurn) throw new RuleError("err.rideOnce");
  const ps = s.players[p];
  const inst = ps.hand.find((c) => c.uid === a.uid);
  if (!inst) throw new RuleError("err.notInHand");
  const g = db[inst.key].grade, cur = vcGrade(db, ps);
  if (isG(db[inst.key]) || (g !== cur && g !== cur + 1)) throw new RuleError("err.rideGrade");
  takeFrom(ps.hand, a.uid, "hand");
  const old = ps.circles.vc!;
  inst.rested = old.rested;
  ps.soul.push(reset(old));
  moved(db, s, { player: p, uid: old.uid, key: old.key, from: "VC", to: "soul" });
  ps.circles.vc = inst;
  s.rodeThisTurn = true;
  ev(out, "ride", p, msg("log.ride", { player: playerMsg(p), card: name(db, inst) }), inst.uid);
  emit(db, s, { kind: "ridden-upon", player: p, uid: old.uid });
  moved(db, s, { player: p, uid: inst.uid, key: inst.key, from: "hand", to: "VC" });
  s.resume = "ride-finish";
}

function stride(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "stride" }>, out: Out) {
  requirePhase(s, p, "ride", "stride");
  if (s.strodeThisTurn) throw new RuleError("err.strideOnce");
  const ps = s.players[p];
  if (!bothVanguardsGrade3(db, s)) throw new RuleError("err.strideGrade3");
  const g = ps.gZone.find((c) => c.uid === a.gUid);
  if (!g || g.faceUp || db[g.key].type !== "g-unit") throw new RuleError("err.strideNeedG");
  const discards = a.discardUids.map((uid) => {
    const c = ps.hand.find((h) => h.uid === uid);
    if (!c) throw new RuleError("err.discardFromHand");
    return c;
  });
  if (!strideCostOk(db, s, p, db[g.key], discards)) throw new RuleError(isUltimate(db[g.key]) ? "err.ultimateCost" : "err.strideCost");
  for (const c of discards) moveCard(db, s, c.uid, "drop");
  if (isUltimate(db[g.key])) ps.ultimateStrode = true;
  s.strodeThisTurn = true;
  strideOnto(db, s, p, g.uid, out);
}

// ---------- Main phase ----------

function call(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "call" }>, out: Out) {
  requirePhase(s, p, "main");
  if (!RC.includes(a.to)) throw new RuleError("err.callRcOnly");
  const ps = s.players[p];
  const inst = ps.hand.find((c) => c.uid === a.uid);
  if (!inst) throw new RuleError("err.notInHand");
  if (isG(db[inst.key]) || db[inst.key].grade > vcGrade(db, ps)) throw new RuleError("err.callGrade");
  takeFrom(ps.hand, a.uid, "hand");
  placeOnRC(db, s, p, inst, a.to, "hand", out);
}

function move(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "move" }>, out: Out) {
  requirePhase(s, p, "main");
  if (SAME_COLUMN[a.from] !== a.to) throw new RuleError("err.moveColumn");
  const ps = s.players[p];
  const unit = ps.circles[a.from];
  if (!unit) throw new RuleError("err.moveEmpty");
  const swap = ps.circles[a.to];
  ps.circles[a.to] = unit;
  if (swap) ps.circles[a.from] = swap; else delete ps.circles[a.from];
  ev(out, "move", p, msg("log.move", { player: playerMsg(p), card: name(db, unit), circle: circleMsg(a.to) }), unit.uid);
}

// ---------- Battle phase ----------

function attack(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "attack" }>, out: Out) {
  requirePhase(s, p, "battle", "attack");
  if (s.turn === 1 && p === s.firstPlayer) throw new RuleError("err.firstTurnAttack");
  const ps = s.players[p], opp = s.players[other(p)];
  const atk = ps.circles[a.attacker];
  if (!FRONT.includes(a.attacker) || !atk) throw new RuleError("err.attackFront");
  if (atk.rested) throw new RuleError("err.restedAttack");
  if (!FRONT.includes(a.target) || !opp.circles[a.target]) throw new RuleError("err.targetFront");
  let booster: CardInstance | undefined;
  if (a.booster) {
    booster = ps.circles[a.booster];
    if (BEHIND[a.attacker] !== a.booster || !booster) throw new RuleError("err.boostBehind");
    if (booster.rested || !canBoost(db[booster.key])) throw new RuleError("err.boostGrade");
  }
  s.battlesThisTurn = (s.battlesThisTurn ?? 0) + 1;
  for (const cost of attackTaxes(db, s, a.attacker, a.target)) {
    if (!payRuleCost(db, s, p, cost, name(db, atk), out)) throw new RuleError("err.attackTax", { cost });
  }
  atk.rested = true;
  if (booster) {
    booster.rested = true;
    atk.mods.push({ stat: "power", value: powerOf(db, ps, a.booster!), source: "boost", until: "battle-end" });
  }
  s.battle = { attacker: a.attacker, booster: a.booster, target: a.target, drivesLeft: 0, damageLeft: 0 };
  s.step = "guard";
  ev(out, "attack", p, msg("log.attack", { card: name(db, atk), target: name(db, opp.circles[a.target]!), power: powerOf(db, ps, a.attacker) }), atk.uid);
  emit(db, s, { kind: "attack", player: p, uid: atk.uid, circle: a.attacker, target: a.target });
}

function requireGuard(s: GameState, p: PlayerId) {
  if (!s.battle || s.step !== "guard" || p === s.turnPlayer) throw new RuleError("err.guardStep");
}

function guard(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "guard" }>, out: Out) {
  requireGuard(s, p);
  const ps = s.players[p];
  for (const uid of a.uids) {
    const inst = ps.hand.find((c) => c.uid === uid);
    if (!inst) throw new RuleError("err.notInHand");
    ev(out, "guard", p, msg("log.guard", { player: playerMsg(p), card: name(db, inst), shield: shieldOf(db, reset(inst)) }), inst.uid);
    moveCard(db, s, uid, "GC");
  }
  for (const c of a.intercept ?? []) {
    const inst = ps.circles[c];
    if (!inst || (c !== "front_left" && c !== "front_right") || c === s.battle!.target || !canIntercept(db[inst.key])) {
      throw new RuleError("err.intercept");
    }
    moveCard(db, s, inst.uid, "GC");
    ev(out, "intercept", p, msg("log.intercept", { card: name(db, inst), shield: shieldOf(db, inst) }), inst.uid);
  }
}

// Why the player can't call a G guardian right now (undefined = can)
export function gGuardianBlocked(db: CardDB, s: GameState, p: PlayerId): Msg | undefined {
  const ps = s.players[p];
  if (!bothVanguardsGrade3(db, s)) return msg("err.gGuardGrade3");
  if (ps.gZone.filter((c) => c.faceUp && db[c.key].type === "g-guardian").length > 3) return msg("err.gGuardLimit");
  // Some face-down G guardian's cost (the card's G GUARDIAN ability, by default a Heal trigger) can be paid from hand
  const payable = ps.gZone.some((g) => !g.faceUp && db[g.key].type === "g-guardian" && ps.hand.some((c) => cardMatches(db[c.key], guardianDiscardFilter(db[g.key]), { db })));
  if (!payable) return msg("err.gGuardNeedHeal");
}

function callGGuardian(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "call-g-guardian" }>, out: Out) {
  requireGuard(s, p);
  const ps = s.players[p];
  const why = gGuardianBlocked(db, s, p);
  if (why) throw new RuleError(why);
  const g = ps.gZone.find((c) => c.uid === a.gUid);
  if (!g || g.faceUp || db[g.key].type !== "g-guardian") throw new RuleError("err.gGuardNeedG");
  const discard = ps.hand.find((c) => c.uid === a.discardUid);
  if (!discard || !cardMatches(db[discard.key], guardianDiscardFilter(db[g.key]), { db })) throw new RuleError("err.gGuardDiscard");
  ev(out, "discard", p, msg("log.discard", { card: name(db, discard) }), discard.uid);
  ev(out, "g-guardian", p, msg("log.gGuardian", { player: playerMsg(p), card: name(db, g), shield: shieldOf(db, g) }), g.uid);
  moveCard(db, s, discard.uid, "drop", { as: "g-guardian-cost" });
  moveCard(db, s, g.uid, "GC");
}

function endGuard(db: CardDB, s: GameState, p: PlayerId, _a: Action, out: Out) {
  requireGuard(s, p);
  const b = s.battle!;
  const atk = s.players[s.turnPlayer].circles[b.attacker];
  if (b.attacker === "vc" && atk) {
    s.step = "drive";
    b.drivesLeft = driveOf(db, atk);
  } else s.step = "damage";
  continueBattle(db, s, out);
}

// Reveal the top card for a check; returns false if the deck is empty (loss)
function revealCheck(db: CardDB, s: GameState, p: PlayerId, during: "drive" | "damage", out: Out): boolean {
  const top = s.players[p].deck.shift();
  if (!top) {
    win(s, other(p), out, msg("win.deckOutCheck", { player: playerMsg(p) }));
    return false;
  }
  s.battle!.checkCard = reset(top);
  const card = db[top.key];
  const trigger = s.noTriggers ? undefined : card.trigger;
  const text = trigger
    ? msg(during === "drive" ? "log.driveCheckTrigger" : "log.damageCheckTrigger", { card: card.name, trigger: msg(`trigger.${trigger}`) })
    : msg(during === "drive" ? "log.driveCheck" : "log.damageCheck", { card: card.name });
  ev(out, during === "drive" ? "drive-check" : "damage-check", p, text, top.uid);
  if (trigger) {
    s.battle!.pendingTrigger = { owner: p, kind: trigger, during, power: triggerPower(card) };
    (s.battle!.triggers ??= []).push({ card: reset(top), during, done: false });
  }
  return true;
}

function finishCheck(s: GameState, p: PlayerId, during: "drive" | "damage", out: Out) {
  const ps = s.players[p];
  const inst = s.battle!.checkCard!;
  s.battle!.checkCard = undefined;
  if (during === "drive") ps.hand.push(inst);
  else {
    ps.damage.push(inst);
    ev(out, "damage", p, msg("log.damage", { player: playerMsg(p), n: ps.damage.length }), inst.uid);
    if (ps.damage.length >= 6) win(s, other(p), out, msg("win.damage6", { player: playerMsg(p) }));
  }
}

function continueBattle(db: CardDB, s: GameState, out: Out) {
  const b = s.battle!;
  const atkSide = s.turnPlayer, defSide = other(atkSide);
  if (b.pendingTrigger || s.winner) return;

  if (s.step === "drive") {
    while (b.drivesLeft > 0) {
      b.drivesLeft--;
      if (!revealCheck(db, s, atkSide, "drive", out)) return;
      if (b.pendingTrigger) return;
      finishCheck(s, atkSide, "drive", out);
    }
    s.step = "damage";
  }

  if (s.step === "damage") {
    refreshContinuous(db, s);
    const atk = s.players[atkSide], def = s.players[defSide];
    const target = def.circles[b.target];
    if (b.hit === undefined) {
      const ap = powerOf(db, atk, b.attacker);
      const dp = powerOf(db, def, b.target) + def.guardian.reduce((n, g) => n + shieldOf(db, g), 0);
      b.hit = !!target && !b.noHit && ap >= dp;
      ev(out, b.hit ? "hit" : "no-hit", atkSide, msg(b.hit ? "log.hit" : "log.noHit", { atk: ap, def: dp }), target?.uid);
      const attacker = atk.circles[b.attacker];
      if (b.hit && attacker) emit(db, s, { kind: "attack-hit", player: atkSide, uid: attacker.uid, target: b.target });
      if (b.hit && b.target === "vc") b.damageLeft = criticalOf(db, atk.circles[b.attacker] ?? target!);
      else if (b.hit) retireUnit(db, s, defSide, b.target, out, msg("reason.attacked"));
    }
    while (b.damageLeft > 0) {
      b.damageLeft--;
      if (!revealCheck(db, s, defSide, "damage", out)) return;
      if (b.pendingTrigger) return;
      finishCheck(s, defSide, "damage", out);
      if (s.winner) return;
    }
    s.resume = "close";
  }
}

// Close step: clear GC, then "at the end of the battle" AUTO abilities trigger, then "until end of battle" effects expire
function closeBattle(db: CardDB, s: GameState, _out: Out) {
  const b = s.battle!;
  s.step = "close";
  for (const p of PLAYERS) {
    const ps = s.players[p];
    for (const g of [...ps.guardian]) moveCard(db, s, g.uid, db[g.key].type === "g-guardian" ? "G" : "drop");
  }
  const tp = s.players[s.turnPlayer];
  releaseDelayed(s, "battle-end");
  const atk = tp.circles[b.attacker];
  if (atk) {
    emit(db, s, {
      kind: "battle-end", player: s.turnPlayer, attackerUid: atk.uid, attackerCircle: b.attacker,
      boosterUid: b.booster ? tp.circles[b.booster]?.uid : undefined, target: b.target,
    });
  }
  s.resume = "close-finish";
}

function finishClose(_db: CardDB, s: GameState, out: Out) {
  for (const p of PLAYERS) {
    for (const inst of fieldUnits(s.players[p])) inst.mods = inst.mods.filter((m) => m.until !== "battle-end");
  }
  s.battle = undefined;
  s.step = "attack";
  ev(out, "battle-end", s.turnPlayer, msg("log.battleEnd"));
}

function triggerTarget(db: CardDB, s: GameState, p: PlayerId, a: Extract<Action, { type: "trigger-target" }>, out: Out) {
  const b = s.battle;
  const t = b?.pendingTrigger;
  if (!b || !t || t.owner !== p) throw new RuleError("err.noTrigger");
  const ps = s.players[p], opp = s.players[other(p)];
  const powerUnit = ps.circles[a.powerTo];
  if (!powerUnit) throw new RuleError("err.triggerPower");
  if (t.kind === "critical" && !ps.circles[a.extraTo ?? "vc"]) throw new RuleError("err.triggerCritical");
  if (t.kind === "stand") {
    const u = a.extraTo && ps.circles[a.extraTo];
    if (u && a.extraTo === "vc") throw new RuleError("err.standRearOnly");
    if (u) u.rested = false;
  }
  powerUnit.mods.push({ stat: "power", value: t.power, source: "trigger", until: "turn-end" });
  ev(out, "trigger", p, msg("log.triggerPower", { card: name(db, powerUnit), v: String(t.power) }), powerUnit.uid);
  if (t.kind === "critical") {
    const u = ps.circles[a.extraTo ?? "vc"]!;
    u.mods.push({ stat: "critical", value: 1, source: "trigger", until: "turn-end" });
    ev(out, "trigger", p, msg("log.triggerCritical", { card: name(db, u) }), u.uid);
  }
  if (t.kind === "heal" && ps.damage.length > 0 && ps.damage.length >= opp.damage.length) {
    const healed = a.healUid ? takeFrom(ps.damage, a.healUid, "damage zone") : ps.damage.pop()!;
    ps.drop.push(reset(healed));
    ev(out, "heal", p, msg("log.heal", { card: name(db, healed) }), healed.uid);
  }
  if (t.kind === "draw") drawCard(s, p, out);
  b.pendingTrigger = undefined;
  const t2 = b.triggers?.filter((x) => !x.done).at(-1);
  if (t2) t2.done = true;
  finishCheck(s, p, t.during, out);
  if (!s.winner) continueBattle(db, s, out);
}

// ---------- Who must decide ----------

const CHOICE_ACTION = { yesno: "choose", option: "choose", cards: "select-target", circle: "select-target" } as const;

export function refreshAwaiting(s: GameState) {
  if (s.winner) { s.awaiting = undefined; return; }
  if (s.phase === "setup") {
    const p = [s.firstPlayer, other(s.firstPlayer)].find((q) => !s.mulliganDone.includes(q))!;
    s.awaiting = { player: p, kind: "mulligan", prompt: msg("prompt.mulligan") };
    return;
  }
  const r = s.resolving;
  if (r?.choice) {
    s.awaiting = { player: chooser(r), kind: CHOICE_ACTION[r.choice.kind], prompt: msg("prompt.ability", { label: abilityTag(r.label), prompt: r.choice.prompt }), choice: r.choice };
    return;
  }
  const qp = [s.turnPlayer, other(s.turnPlayer)].find((q) => s.queue.some((e) => e.owner === q));
  if (qp) {
    s.awaiting = { player: qp, kind: "order-queue", prompt: msg("prompt.order") };
    return;
  }
  const t = s.battle?.pendingTrigger;
  if (t) {
    s.awaiting = { player: t.owner, kind: "trigger-target", prompt: msg("prompt.trigger", { trigger: msg(`trigger.${t.kind}`) }) };
    return;
  }
  if (s.battle && s.step === "guard") {
    s.awaiting = { player: other(s.turnPlayer), kind: "guard", prompt: msg("prompt.guard") };
    return;
  }
  const prompts: Record<string, Msg> = {
    "ride:ride": msg("prompt.ride"), "ride:stride": msg("prompt.stride"),
    "main:": msg("prompt.main"), "battle:attack": msg("prompt.battle"),
  };
  s.awaiting = { player: s.turnPlayer, kind: "next-phase", prompt: prompts[`${s.phase}:${s.step ?? ""}`] };
}
