// Heuristic decision rules for every point where the engine waits: the Normal bot, and the rollout policy for simulation at higher levels
// Every function returns an Action intended to be legal; if it isn't, the caller uses fallbacks() instead
import { gGuardianBlocked, usableActs } from "../engine/game";
import { actAt } from "../engine/abilities";
import { parseCode } from "../engine/code";
import {
  BEHIND, FRONT, RC, SAME_COLUMN, bothVanguardsGrade3, canBoost, canIntercept, strideCostGrade, criticalOf, driveOf, generationBreak, isG, isSentinel, other, powerOf, printedShield, shieldOf, triggerPower, vcGrade,
  type CardDB,
} from "../engine/rules";
import { circleOf, locate } from "../engine/state";
import type { Action, CardInstance, Circle, GameState, PlayerId, PlayerState, QueueEntry } from "../engine/types";
import { distinctByKey, ownQueue, tryApply } from "./actions";
import { CB_VALUE, DAMAGE_COST, evaluate } from "./eval";
import { dropCallPayoff, handCallPayoff, hollowPayoff, keepValue, rideScore, shieldIn, strideScore, unitValue } from "./knowledge";
import { estimateDefense, nextTurnNeed, unitThreat } from "./intel";
import { deckOdds, intelOf, isHidden } from "./view";

export function policy(db: CardDB, s: GameState, p: PlayerId): Action {
  const d = s.awaiting!;
  switch (d.kind) {
    case "mulligan": return mulligan(db, s, p);
    case "next-phase": return freeAction(db, s, p);
    case "guard": return guard(db, s, p);
    case "order-queue": return orderQueue(db, s, p);
    case "choose": return choose(db, s, p);
    case "select-target": return selectTarget(db, s, p);
    case "trigger-target": return triggerTarget(db, s, p);
  }
  return { type: "next-phase" };
}

// ---------- Mulligan: keep a grade 1-2-3 ride line, one each + pieces of combos that are easy and worthwhile ----------

// Keep combo pieces whose score (value / difficulty) is at least this fraction of the deck's best piece
const KEEP_PIECE = 0.75;

function mulligan(db: CardDB, s: GameState, p: PlayerId): Action {
  const hand = s.players[p].hand;
  const piece = intelOf(s)?.combos[p].handPiece;
  const pieceScore = (key: string) => piece?.get(key) ?? 0;
  const bar = Math.max(0, ...(piece?.values() ?? [])) * KEEP_PIECE;
  const keep = new Set<string>();
  for (const g of [1, 2, 3]) {
    const pick = hand.filter((c) => db[c.key].grade === g && !isG(db[c.key]))
      .sort((a, b) => rideScore(db[b.key]) + pieceScore(b.key) - rideScore(db[a.key]) - pieceScore(a.key))[0];
    if (pick) keep.add(pick.uid);
  }
  const lineDone = keep.size === 3;
  // Pick starting cards from combos → can it ride to grade 3? → no: redraw without keeping combo pieces outside the ride line (return more to find the missing grade)
  const choose = (keepPieces: boolean) => hand.filter((c) => {
    if (keep.has(c.uid)) return false;
    const card = db[c.key];
    if (piece) {
      if (keepPieces && bar > 0 && pieceScore(c.key) >= bar) return false;
      return !(card.trigger && lineDone);
    }
    if (card.grade === 3) return true;
    if (card.trigger) return !lineDone;
    return false;
  });
  const canRideToG3 = (back: CardInstance[]) =>
    [1, 2, 3].every((g) => hand.some((c) => !back.includes(c) && !isG(db[c.key]) && db[c.key].grade === g));
  let back = choose(true);
  if (!canRideToG3(back)) back = choose(false);
  return { type: "mulligan", returnUids: back.map((c) => c.uid) };
}

// ---------- Own turn ----------

function freeAction(db: CardDB, s: GameState, p: PlayerId): Action {
  if (s.phase === "ride" && s.step === "ride") return rideAction(db, s, p);
  if (s.phase === "ride" && s.step === "stride") return strideAction(db, s, p);
  if (s.phase === "main") return mainAction(db, s, p);
  if (s.phase === "battle" && s.step === "attack") return attackAction(db, s, p);
  return { type: "next-phase" };
}

export function rideAction(db: CardDB, s: GameState, p: PlayerId): Action {
  const ps = s.players[p];
  if (s.rodeThisTurn) return { type: "next-phase" };
  const g = vcGrade(db, ps);
  const opts = ps.hand.filter((c) => !isG(db[c.key]) && db[c.key].grade === g + 1 && g < 3);
  if (!opts.length) return { type: "next-phase" };
  const best = opts.sort((a, b) => rideScore(db[b.key]) - rideScore(db[a.key]))[0];
  return { type: "ride", uid: best.uid };
}

// Cards discarded for the stride cost: total grade 3 or more, losing the least value
export function strideDiscard(db: CardDB, s: GameState, p: PlayerId): string[] | undefined {
  const hand = s.players[p].hand.filter((c) => !isG(db[c.key]));
  let best: { uids: string[]; cost: number } | undefined;
  const walk = (i: number, picked: CardInstance[], grade: number, cost: number) => {
    if (grade >= 3) {
      if (!best || cost < best.cost) best = { uids: picked.map((c) => c.uid), cost };
      return;
    }
    if (picked.length >= 3 || i >= hand.length) return;
    for (let j = i; j < hand.length; j++) {
      const c = hand[j];
      const g = strideCostGrade(db[c.key]);
      if (g === 0) continue;
      walk(j + 1, [...picked, c], grade + g, cost + keepValue(db, s, p, c) + 0.05);
    }
  };
  walk(0, [], 0, 0);
  return best?.uids;
}

export function strideOptions(db: CardDB, s: GameState, p: PlayerId): CardInstance[] {
  const ps = s.players[p];
  return distinctByKey(ps.gZone.filter((g) => !g.faceUp && db[g.key].type === "g-unit" && !db[g.key].abilities.some((a) => a.kind === "ULTIMATE STRIDE")));
}

function strideAction(db: CardDB, s: GameState, p: PlayerId): Action {
  if (s.strodeThisTurn || !bothVanguardsGrade3(db, s)) return { type: "next-phase" };
  const discardUids = strideDiscard(db, s, p);
  const gs = strideOptions(db, s, p);
  if (!discardUids || !gs.length) return { type: "next-phase" };
  const best = gs.sort((a, b) => strideScore(db, s, p, b) - strideScore(db, s, p, a))[0];
  return { type: "stride", gUid: best.uid, discardUids };
}

// ---------- Main phase ----------

// Number of Shields (5000 each) this column forces the opponent to use if they want to avoid the hit
const forced = (power: number, oppVc: number) => (power >= oppVc ? Math.min(3, Math.floor((power - oppVc) / 5000) + 1) : 0);

// Power of the opponent's vanguard on our next turn (rode one more grade, G unit returned to the G zone at end of turn)
const TYPICAL_VC = [5000, 7000, 9000, 11000];
function futureOppVc(db: CardDB, s: GameState, p: PlayerId) {
  const opp = s.players[other(p)];
  const vc = opp.circles.vc ? db[opp.circles.vc.key] : undefined;
  const g = vc?.type === "g-unit" && opp.heart ? db[opp.heart.key].grade : vc?.grade ?? 0;
  return TYPICAL_VC[Math.min(3, g + 1)];
}

// Board pressure (unit = 5000 Shield the opponent must use) when cards are placed as given
// Units stay on the board for several turns, so compare against both the opponent's vanguard now and on the next turn
function pressure(db: CardDB, s: GameState, p: PlayerId, place: Partial<Record<Circle, CardInstance | null>> = {}): number {
  return pressureVs(db, s, p, powerOf(db, s.players[other(p)], "vc") || 1, place)
    + pressureVs(db, s, p, futureOppVc(db, s, p), place) * (PERSIST - 1);
}

function pressureVs(db: CardDB, s: GameState, p: PlayerId, oppVc: number, place: Partial<Record<Circle, CardInstance | null>>): number {
  const ps = s.players[p];
  const at = (c: Circle) => (c in place ? place[c] ?? undefined : ps.circles[c]);
  let n = 0;
  for (const c of FRONT) {
    const u = at(c);
    if (!u) continue;
    const back = BEHIND[c]!;
    const bu = at(back);
    const boost = bu && canBoost(db[bu.key]) ? db[bu.key].power ?? 0 : 0;
    const base = c === "vc" || u === ps.circles[c] ? powerOf(db, ps, c) : db[u.key].power ?? 0;
    n += forced(base + boost, oppVc);
  }
  return n;
}

const PERSIST = 2.2;      // a unit on the board gets used for several turns
const PER_SHIELD = 0.65;  // a 5000 Shield forced out of the opponent (or damage taken instead) is worth about half a card or more

export function callScore(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance, to: Circle): number {
  const ps = s.players[p];
  const card = db[inst.key];
  const now = pressure(db, s, p);
  const old = ps.circles[to];
  let gain = (pressure(db, s, p, { [to]: inst }) - now) * PER_SHIELD;
  if (FRONT.includes(to) && !ps.circles[BEHIND[to]!]) {
    // A front column without a booster: count it together with the best booster in hand
    const booster = ps.hand.filter((h) => h.uid !== inst.uid && !isG(db[h.key]) && canBoost(db[h.key]) && !isSentinel(db[h.key]))
      .sort((a, b) => (db[b.key].power ?? 0) - (db[a.key].power ?? 0))[0];
    if (booster) gain = Math.max(gain, (pressure(db, s, p, { [to]: inst, [BEHIND[to]!]: booster }) - now) * PER_SHIELD - keepValue(db, s, p, booster));
  }
  if (!canBoost(card) && !FRONT.includes(to)) gain -= 1;
  if (canBoost(card) && FRONT.includes(to)) gain -= 0.6;
  // The pressure lost from the replaced unit is already in gain; only the unit's other value remains (interceptor etc.)
  const loss = old && !old.hollowed && !old.retireAtTurnEnd ? 0.35 : 0;
  // After calling this card the hand must still guard next turn's lethal attacks (opponent strides + existing columns); if not, this card is worth more
  const handShield = ps.hand.reduce((n, h) => n + (isSentinel(db[h.key]) ? 15000 : shieldIn(db, h)), 0);
  const short = handShield - (isSentinel(card) ? 15000 : shieldIn(db, inst)) < nextTurnNeed(db, s, p);
  const danger = short ? 1.6 : ps.damage.length >= 4 ? 1.25 : 1;
  return gain - loss + (handCallPayoff(card) ? 0.45 : 0) - keepValue(db, s, p, inst) * danger;
}

export function rankedCalls(db: CardDB, s: GameState, p: PlayerId): { action: Action; score: number }[] {
  const ps = s.players[p];
  const g = vcGrade(db, ps);
  const out: { action: Action; score: number }[] = [];
  for (const inst of distinctByKey(ps.hand)) {
    const card = db[inst.key];
    if (isG(card) || card.grade > g || isSentinel(card)) continue;
    for (const to of RC) out.push({ action: { type: "call", uid: inst.uid, to }, score: callScore(db, s, p, inst, to) });
  }
  return out.sort((a, b) => b.score - a.score);
}

function wantAct(db: CardDB, s: GameState, p: PlayerId, uid: string, index: number): boolean {
  const ps = s.players[p];
  const at = locate(s, uid);
  if (!at || at.zone !== "circle") return false;
  const { ab } = actAt(db, at.inst, index);
  if (!ab) return false;
  const cost = ab.cost ?? [];
  if (cost.includes("soul-in(self)")) {
    // Units that don't help attack (front row, or back row with nobody to boost) go to the soul in exchange for a draw
    const c = at.circle!;
    if (FRONT.includes(c)) return true;
    const front = FRONT.find((f) => BEHIND[f] === c);
    return !front || !ps.circles[front];
  }
  if (ab.effect.some((e) => e.startsWith("call(drop→RC"))) return ps.drop.some((d) => !isG(db[d.key]) && db[d.key].type === "normal");
  return true;
}

function mainAction(db: CardDB, s: GameState, p: PlayerId): Action {
  const ps = s.players[p];
  for (const a of usableActs(db, s)) if (wantAct(db, s, p, a.uid, a.index)) return { type: "activate", cardUid: a.uid, abilityIndex: a.index };
  for (const front of ["front_left", "front_right"] as Circle[]) {
    const back = SAME_COLUMN[front]!;
    const f = ps.circles[front], b = ps.circles[back];
    if (b && !canBoost(db[b.key]) && (!f || canBoost(db[f.key]))) return { type: "move", from: back, to: front };
  }
  const best = rankedCalls(db, s, p)[0];
  if (best && best.score > 0) return best.action;
  return { type: "next-phase" };
}

// ---------- Battle phase ----------

export function attackPower(db: CardDB, ps: PlayerState, a: Circle, booster?: Circle) {
  return powerOf(db, ps, a) + (booster ? powerOf(db, ps, booster) : 0);
}

export function attackOptions(db: CardDB, s: GameState, p: PlayerId): Extract<Action, { type: "attack" }>[] {
  if (s.turn === 1 && p === s.firstPlayer) return [];
  const ps = s.players[p], opp = s.players[other(p)];
  const out: Extract<Action, { type: "attack" }>[] = [];
  for (const a of FRONT) {
    const u = ps.circles[a];
    if (!u || u.rested) continue;
    const b = BEHIND[a]!;
    const bu = ps.circles[b];
    const booster = bu && !bu.rested && canBoost(db[bu.key]) ? b : undefined;
    for (const t of FRONT) if (opp.circles[t]) out.push({ type: "attack", attacker: a, target: t, booster });
  }
  return out;
}

interface Swing { attacker: Circle; booster?: Circle; power: number; crit: number }

const ceil5k = (n: number) => (n > 0 ? Math.ceil(n / 5000) * 5000 : 0);

// Can the opponent guard every remaining attack this turn (into the vanguard) so they don't reach damage 6?
// The opponent lets attacks through while total damage stays under 6 and guards the rest, using expected Shield + G guardians; sentinels stop one attack each
// Returns the missing Shield (> 0 = probably lethal)
export function lethalGap(db: CardDB, s: GameState, p: PlayerId, list: Swing[]): number {
  const q = other(p);
  const opp = s.players[q];
  const room = 5 - opp.damage.length;
  const def = powerOf(db, opp, "vc");
  const est = estimateDefense(db, s, q);
  const sentinels = Math.round(est.sentinels);
  const cap = est.shield + est.gGuard;
  let best = Infinity;
  for (let mask = 0; mask < 1 << list.length; mask++) {
    let taken = 0;
    const blocked: number[] = [];
    list.forEach((w, i) => { if (mask & (1 << i)) taken += w.crit; else blocked.push(ceil5k(w.power - def + 1)); });
    if (taken > room) continue;
    blocked.sort((a, b) => b - a);
    const cost = blocked.slice(sentinels).reduce((n, x) => n + x, 0);
    best = Math.min(best, cost);
  }
  return best - cap;
}

function swingsOf(db: CardDB, s: GameState, p: PlayerId): Swing[] {
  const ps = s.players[p];
  const seen = new Set<Circle>();
  return attackOptions(db, s, p).filter((o) => (seen.has(o.attacker) ? false : (seen.add(o.attacker), true)))
    .map((o) => ({ attacker: o.attacker, booster: o.booster, power: attackPower(db, ps, o.attacker, o.booster), crit: criticalOf(db, ps.circles[o.attacker]!) }));
}

// Chance of revealing at least 1 trigger of this kind from checking n cards
// Highest Power this kind of trigger can give (from the card files), used to estimate unrevealed triggers
const strongestTrigger = (db: CardDB, kind: string) =>
  Object.values(db).reduce((m, c) => (c.trigger === kind ? Math.max(m, triggerPower(c)) : m), 0);

function chanceOf(db: CardDB, s: GameState, p: PlayerId, kind: string, n: number) {
  const d = deckOdds(db, s, p);
  return 1 - (triggerDist(d.size, d.count((c) => c.trigger === kind), n)[0] ?? 1);
}

function attackAction(db: CardDB, s: GameState, p: PlayerId): Action {
  const ps = s.players[p], q = other(p), opp = s.players[q];
  const list = swingsOf(db, s, p);
  if (!list.length) return { type: "next-phase" };
  const oppVc = powerOf(db, opp, "vc");
  const lethal = lethalGap(db, s, p, list) > 0;
  // Order: normally the vanguard first (triggers go to units that haven't attacked), but if our deck has enough Stands, rear-guards attack first so Stand lets them attack again
  const vcSwing = list.find((w) => w.attacker === "vc");
  const drives = vcSwing ? driveOf(db, ps.circles.vc!) : 0;
  const rcFirst = !lethal && !!vcSwing && list.length > 1 && chanceOf(db, s, p, "stand", drives) >= 0.35;
  list.sort((a, b) => {
    if (a.attacker === "vc" || b.attacker === "vc") return (a.attacker === "vc" ? -1 : 1) * (rcFirst ? -1 : 1);
    return b.power - a.power;
  });
  const w = list[0];
  // Target: the vanguard (damage/forcing guards) or a dangerous rear-guard (reads the opponent's skills and resources)
  let target: Circle = "vc";
  if (!lethal) {
    const d = opp.damage.length;
    const vcValue = w.power >= oppVc ? Math.min(Math.ceil((w.power - oppVc + 1) / 5000) * 0.45, damageCost(d, w.crit)) : 0;
    let best = vcValue + (w.attacker === "vc" ? 0.2 : 0);
    for (const c of ["front_left", "front_right"] as Circle[]) {
      const u = opp.circles[c];
      if (!u || powerOf(db, opp, c) > w.power) continue;
      const v = unitThreat(db, s, q, u.uid) * 0.85;
      if (v > best) { best = v; target = c; }
    }
  }
  return { type: "attack", attacker: w.attacker, target, booster: w.booster };
}

// ---------- Guarding ----------

interface GuardItem { uid?: string; intercept?: Circle; shield: number; cost: number }

// Chance of a trigger per checked card, and the share of criticals among triggers
// Count triggers left in p's deck (hidden deck: deck list minus revealed cards)
function triggerOdds(db: CardDB, s: GameState, p: PlayerId) {
  const d = deckOdds(db, s, p);
  const trig = d.count((c) => !!c.trigger);
  return { N: d.size, T: trig, crit: trig ? d.count((c) => c.trigger === "critical") / trig : 0 };
}

// Chance of revealing k triggers from checking n cards (drawn without replacement: hypergeometric) dist[k]
export function triggerDist(N: number, T: number, n: number): number[] {
  let dist = [1];
  for (let i = 0; i < Math.min(n, N); i++) {
    const next = Array<number>(dist.length + 1).fill(0);
    dist.forEach((pk, k) => {
      const q = Math.max(0, Math.min(1, (T - k) / (N - i)));
      next[k + 1] += pk * q;
      next[k] += pk * (1 - q);
    });
    dist = next;
  }
  return dist;
}

const binom = (n: number, k: number, q: number) => {
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c * q ** k * (1 - q) ** (n - k);
};

// Cost of taking n more damage (including the CB gained)
// heal = chance of revealing a Heal per damage check (if Heal can work); damage reaching 6 can still survive with enough Heals
export function damageCost(d: number, n: number, heal = 0): number {
  if (d + n < 6) return DAMAGE_COST[d + n] - DAMAGE_COST[d] - CB_VALUE * n;
  const need = d + n - 5;
  let survive = 0;
  for (let k = need; k <= n; k++) survive += binom(n, k, heal);
  return 25 * (1 - survive) + survive * (DAMAGE_COST[5] - DAMAGE_COST[d]);
}

// Expected cost if this attack hits with at least kNeed triggers (kNeed = triggers needed for it to hit)
function expectedHitCost(db: CardDB, s: GameState, p: PlayerId, kNeed: number): number {
  const b = s.battle!;
  const atkSide = s.turnPlayer;
  const atk = s.players[atkSide].circles[b.attacker];
  if (!atk) return 0;
  const drives = b.attacker === "vc" ? driveOf(db, atk) : 0;
  if (kNeed > drives) return 0;
  const { N, T, crit } = triggerOdds(db, s, atkSide);
  const dist = triggerDist(N, T, drives);
  const pk = (k: number) => dist[k] ?? 0;
  const d = s.players[p].damage.length;
  let total = 0;
  if (b.target !== "vc") {
    const u = s.players[p].circles[b.target];
    const loss = u ? unitValue(db, u) : 0;
    for (let k = Math.max(0, kNeed); k <= drives; k++) total += pk(k) * loss;
    return total;
  }
  const c = criticalOf(db, atk);
  const own = deckOdds(db, s, p);
  const heal = d >= s.players[atkSide].damage.length && own.size ? own.count((x) => x.trigger === "heal") / own.size : 0;
  for (let k = Math.max(0, kNeed); k <= drives; k++) {
    let h = 0;
    for (let j = 0; j <= k; j++) h += binom(k, j, crit) * damageCost(d, c + j, heal);
    total += pk(k) * h;
  }
  return total;
}

function guardItems(db: CardDB, s: GameState, p: PlayerId): GuardItem[] {
  const ps = s.players[p];
  const items: GuardItem[] = [];
  for (const h of ps.hand) {
    const card = db[h.key];
    if (isG(card) || isSentinel(card)) continue;
    const shield = shieldIn(db, h);
    if (shield > 0) items.push({ uid: h.uid, shield, cost: keepValue(db, s, p, h) });
  }
  for (const c of ["front_left", "front_right"] as Circle[]) {
    const u = ps.circles[c];
    if (u && c !== s.battle!.target && canIntercept(db[u.key])) items.push({ intercept: c, shield: shieldOf(db, u), cost: unitValue(db, u) * 1.1 });
  }
  return items.sort((a, b) => b.shield - a.shield);
}

// The fewest cards that give at least need Shield
function cheapest(items: GuardItem[], need: number): { picks: GuardItem[]; cost: number } | undefined {
  if (need <= 0) return { picks: [], cost: 0 };
  let best: { picks: GuardItem[]; cost: number } | undefined;
  const suffix = items.map((_, i) => items.slice(i).reduce((n, x) => n + x.shield, 0));
  const walk = (i: number, picked: GuardItem[], shield: number, cost: number) => {
    if (best && cost >= best.cost) return;
    if (shield >= need) { best = { picks: picked, cost }; return; }
    if (i >= items.length || shield + suffix[i] < need) return;
    walk(i + 1, [...picked, items[i]], shield + items[i].shield, cost + items[i].cost);
    walk(i + 1, picked, shield, cost);
  };
  walk(0, [], 0, 0);
  return best;
}

// Shield a G guardian can actually give (including on-GC abilities whose cost can be paid)
function gGuardianShield(db: CardDB, s: GameState, p: PlayerId, g: CardInstance): number {
  const ps = s.players[p];
  const card = db[g.key];
  let v = card.shield ?? 0;
  for (const ab of card.abilities) {
    if (ab.kind !== "AUTO") continue;
    const gb = (ab.cond ?? []).map((c) => c.match(/GB\((\d+)\)/)).find(Boolean);
    if (gb && generationBreak(db, ps) < +gb[1]) continue;   // a G guardian adds GB when it returns to the G zone after the battle, not when called
    const cost = ab.cost ?? [];
    if (cost.some((c) => c.startsWith("CB")) && !ps.damage.some((d) => d.faceUp)) continue;
    if (cost.some((c) => c.startsWith("retire-own")) && !RC.some((c) => ps.circles[c])) continue;
    if (cost.some((c) => c.startsWith("SB")) && !ps.soul.length) continue;
    if (cost.some((c) => c.startsWith("flip-G-up")) && ps.gZone.filter((x) => !x.faceUp && db[x.key].type === "g-guardian").length < 2) continue;
    if (cost.some((c) => c.startsWith("mill")) && ps.deck.length < 10) continue;
    for (const e of ab.effect) {
      const m = e.match(/^shield\(\+(\d+), self/);
      if (m) v += +m[1];
      if (/^call\(drop→GC, n=2/.test(e)) v += dropPairShield(db, ps);
    }
  }
  return v;
}

// Shield from calling 2 drop zone cards of different grades to GC (one per grade, pick the highest Shield)
function dropPairShield(db: CardDB, ps: PlayerState): number {
  const best = new Map<number, number>();
  for (const d of ps.drop) {
    const c = db[d.key];
    if (!isG(c) && printedShield(c) > (best.get(c.grade) ?? 0)) best.set(c.grade, printedShield(c));
  }
  return [...best.values()].sort((a, b) => b - a).slice(0, 2).reduce((n, x) => n + x, 0);
}

// Attacks still left this turn (front-row units not yet rested) and the Shield needed to guard each if it hits the vanguard (not counting triggers)
function laterAttacks(db: CardDB, s: GameState, p: PlayerId): { need: number; crit: number }[] {
  const atk = s.players[s.turnPlayer];
  const def = powerOf(db, s.players[p], "vc");
  const out: { need: number; crit: number }[] = [];
  for (const c of FRONT) {
    const u = atk.circles[c];
    if (!u || u.rested || c === s.battle!.attacker) continue;
    const back = BEHIND[c]!;
    const bu = atk.circles[back];
    const boost = bu && !bu.rested && canBoost(db[bu.key]) ? powerOf(db, atk, back) : 0;
    const need = powerOf(db, atk, c) + boost - def + 1;
    if (need > 0) out.push({ need: Math.ceil(need / 5000) * 5000, crit: criticalOf(db, u) });
  }
  // If the opponent's attacking vanguard reveals a Stand, a rear-guard that already attacked can attack again
  const b = s.battle!;
  const vc = atk.circles.vc;
  if (b.attacker === "vc" && vc && chanceOf(db, s, s.turnPlayer, "stand", driveOf(db, vc)) >= 0.3) {
    const again = (["front_left", "front_right"] as Circle[]).map((c) => atk.circles[c]).filter((u) => u?.rested)
      .map((u) => powerOf(db, atk, circleOf(s, s.turnPlayer, u!.uid)!) + strongestTrigger(db, "stand") - def + 1).sort((x, y) => y - x)[0];
    if (again && again > 0) out.push({ need: Math.ceil(again / 5000) * 5000, crit: 1 });
  }
  return out;
}

// After guarding with this set, not enough left to guard the remaining lethal attacks: high cost (keep cards for the lethal hit)
const SHORT_PENALTY = 12;

export interface GuardPlan { actions: Action[]; cost: number; label: string }

// Possible guard plans with their total cost (cards lost + expected damage taken)
export function guardPlans(db: CardDB, s: GameState, p: PlayerId): GuardPlan[] {
  const b = s.battle!;
  const ps = s.players[p];
  const atkPs = s.players[s.turnPlayer];
  const plans: GuardPlan[] = [];
  if (b.noHit) return [{ actions: [{ type: "end-guard" }], cost: 0, label: "no-hit" }];
  const A = powerOf(db, atkPs, b.attacker);
  const D = powerOf(db, ps, b.target) + ps.guardian.reduce((n, g) => n + shieldOf(db, g), 0);
  const atk = atkPs.circles[b.attacker];
  const drives = atk && b.attacker === "vc" ? driveOf(db, atk) : 0;
  // kNeed of Shield S: how many triggers must be revealed for the attack to hit
  const kNeedOf = (S: number) => (D + S > A ? Math.ceil((D + S - A) / 5000) : 0);
  const items = guardItems(db, s, p);
  const d = ps.damage.length;
  const later = laterAttacks(db, s, p);
  const sentinels = ps.hand.filter((h) => !isHidden(h) && isSentinel(db[h.key]));
  // After using this set (used) and sitting at damage dAfter, can we still guard the remaining lethal attacks?
  const short = (used: Set<string>, usedG: boolean, dAfter: number) => {
    const lethal = later.filter((x) => dAfter + x.crit >= 6).map((x) => x.need).sort((a, b) => b - a);
    if (!lethal.length) return 0;
    const left = items.filter((x) => !used.has(x.uid ?? x.intercept!));
    const spare = ps.hand.filter((h) => !used.has(h.uid)).length;
    if (sentinels.some((h) => !used.has(h.uid)) && spare >= 2) lethal.shift();
    const healLeft = ps.hand.some((h) => !used.has(h.uid) && db[h.key].trigger === "heal");
    const cap = left.reduce((n, x) => n + x.shield, 0) + (!usedG && healLeft && !gGuardianBlocked(db, s, p) ? 15000 : 0);
    return lethal.reduce((n, x) => n + x, 0) > cap ? SHORT_PENALTY : 0;
  };
  const idsOf = (picks: GuardItem[], extra: string[] = []) => new Set([...picks.map((x) => x.uid ?? x.intercept!), ...extra]);
  const takeHits = b.target === "vc" && kNeedOf(0) === 0 && atk ? criticalOf(db, atk) : 0;
  plans.push({ actions: [{ type: "end-guard" }], cost: expectedHitCost(db, s, p, kNeedOf(0)) + short(new Set(), false, d + takeHits), label: "take" });
  const toAction = (picks: GuardItem[]): Action => ({
    type: "guard", uids: picks.filter((x) => x.uid).map((x) => x.uid!), intercept: picks.filter((x) => x.intercept).map((x) => x.intercept!),
  });
  for (let L = Math.max(1, kNeedOf(0) + 1); L <= drives + 1; L++) {
    const need = A + 5000 * (L - 1) - D + 1;
    const c = cheapest(items, need);
    if (c && c.picks.length) plans.push({ actions: [toAction(c.picks)], cost: c.cost + expectedHitCost(db, s, p, L) + short(idsOf(c.picks), false, d), label: `pass-${L - 1}` });
  }
  // Sentinel: guaranteed no hit, needs another card to discard
  const others = ps.hand.filter((h) => !isG(db[h.key]));
  for (const sen of distinctByKey(ps.hand.filter((h) => !isHidden(h) && isSentinel(db[h.key])))) {
    const card = db[sen.key];
    const ab = card.abilities.find((x) => x.effect.some((e) => e.startsWith("no-hit")));
    if (!ab) continue;
    const vcOnly = ab.effect.some((e) => e.includes("own-VC-attacked"));
    if (vcOnly && b.target !== "vc") continue;
    const fl = (ab.cost ?? []).map((c) => parseCode(c).named.filter).find(Boolean);
    const target = ps.circles[b.target];
    if (fl && target && db[target.key].clan !== fl) continue;
    const discards = others.filter((h) => h.uid !== sen.uid && (!fl || db[h.key].clan === fl)).sort((x, y) => keepValue(db, s, p, x) - keepValue(db, s, p, y));
    if (!discards.length) continue;
    const cost = keepValue(db, s, p, sen) + keepValue(db, s, p, discards[0]) + short(new Set([sen.uid, discards[0].uid]), false, d);
    plans.push({ actions: [{ type: "guard", uids: [sen.uid] }], cost, label: "sentinel" });
  }
  // G guardian
  if (!gGuardianBlocked(db, s, p)) {
    const heal = ps.hand.filter((h) => db[h.key].trigger === "heal").sort((x, y) => keepValue(db, s, p, x) - keepValue(db, s, p, y))[0];
    for (const g of distinctByKey(ps.gZone.filter((x) => !x.faceUp && db[x.key].type === "g-guardian"))) {
      const sh = gGuardianShield(db, s, p, g);
      const base = keepValue(db, s, p, heal) - 0.45;   // lose a Heal but gain GB and the on-discard ability
      const rest = items.filter((x) => x.uid !== heal.uid);
      for (let L = Math.max(1, kNeedOf(0) + 1); L <= drives + 1; L++) {
        const need = A + 5000 * (L - 1) - D + 1 - sh;
        const c = cheapest(rest, need);
        if (c) plans.push({ actions: [{ type: "call-g-guardian", gUid: g.uid, discardUid: heal.uid }], cost: base + c.cost + expectedHitCost(db, s, p, L) + short(idsOf(c.picks, [heal.uid]), true, d), label: `g-${L - 1}` });
      }
    }
  }
  return plans.sort((x, y) => x.cost - y.cost);
}

function guard(db: CardDB, s: GameState, p: PlayerId): Action {
  return guardPlans(db, s, p)[0].actions[0];
}

// ---------- Abilities ----------

function wantHollow(db: CardDB, s: GameState, entry: QueueEntry): boolean {
  const at = locate(s, entry.uid);
  if (!at || at.zone !== "circle") return false;
  if (entry.event?.kind === "enter" && entry.event.from === "drop") return true;
  return generationBreak(db, s.players[entry.owner]) >= 1 && hollowPayoff(db[at.inst.key]);
}

export function wantUse(db: CardDB, s: GameState, entry: QueueEntry): boolean {
  if (!entry.optional) return true;
  const ps = s.players[entry.owner];
  const ab = entry.ability;
  if (ab.effect[0] === "hollow(self)") return wantHollow(db, s, entry);
  for (const code of ab.cost ?? []) {
    const c = parseCode(code);
    const n = parseInt(c.pos[0] ?? "1", 10) || 1;
    if (c.name === "mill" && ps.deck.length <= n + 8) return false;
    if (c.name === "discard" && !ab.effect.some((e) => e.startsWith("no-hit"))) {
      const spare = ps.hand.filter((h) => h.uid !== entry.uid && keepValue(db, s, entry.owner, h) < 0.95);
      if (!spare.length) return false;
    }
  }
  return true;
}

// Preferred order: CC/SC first (to pay later costs), hollow first (so effects that need hollow can work), CB payers later
function priority(db: CardDB, s: GameState, entry: QueueEntry): number {
  const eff = entry.ability.effect.join(" ");
  const cost = (entry.ability.cost ?? []).join(" ");
  let v = 0;
  if (/\bCC\(|\bSC\(/.test(eff)) v += 3;
  if (entry.ability.effect[0] === "hollow(self)") v += 2;
  if (!entry.optional) v += 1;
  if (/CB\(/.test(cost)) v -= 1;
  if (/that-card/.test(eff)) v += recallValue(db, s, entry);
  return v;
}

// Abilities that call back a card that just went to the drop (Nightrose, Night Fog 1/Turn): pick the most worthwhile card
// Grunatch gets CC2 again when hollowed and retired again, so it's very worthwhile when CB is low
function recallValue(db: CardDB, s: GameState, entry: QueueEntry): number {
  const e = entry.event;
  const inst = e && "uid" in e ? locate(s, e.uid)?.inst : undefined;
  return inst ? recallCardValue(db, s, entry.owner, inst) : 0;
}

// Same value when choosing which of several "that card"s to call back (a 1/turn ability triggered by several cards at once)
function recallCardValue(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance): number {
  const card = db[inst.key];
  const ps = s.players[p];
  const refund = card.abilities.some((ab) => /by=hollow/.test(ab.timing ?? "") && ab.effect.some((x) => x.startsWith("CC(")));
  const cbLeft = ps.damage.filter((d) => d.faceUp).length;
  return (refund && generationBreak(db, ps) >= 1 ? (cbLeft < 2 ? 3 : 1.5) : 0) + unitValue(db, { ...inst, hollowed: false });
}

// The main effect must happen for the cost to be worth it; checked from events while this ability resolves (any one is enough)
type Ev = { code: string; player: PlayerId; text: { key: string } };
const MAIN_EFFECT: [RegExp, (e: Ev, p: PlayerId) => boolean][] = [
  [/^call\((?!self|G→)/, (e, p) => e.code === "call" && e.player === p],
  [/^search\(deck→hand/, (e, p) => e.text.key === "log.searchHand" && e.player === p],
  [/^draw\(/, (e, p) => e.code === "draw" && e.player === p],
  [/^retire\(opp-RC/, (e, p) => e.code === "retired" && e.player !== p],
];
// Effects the board score can't see (help guard or attack in this battle, including calls to GC) aren't judged by score
const COMBAT_EFFECT = /^(shield|power|critical|no-hit)\(|→GC/;
let simulating = false;

// Keep stepping with the policy until the resolving ability and p's queue are empty
function settleOwn(db: CardDB, r: ReturnType<typeof tryApply>, p: PlayerId, events: Ev[]) {
  for (let i = 0; r && i < 40 && r.state.awaiting?.player === p && (r.state.resolving || r.state.queue.some((e) => e.owner === p)); i++) {
    r = tryApply(db, r.state, p, policy(db, r.state, p));
    events.push(...(r?.events ?? []));
  }
  return r;
}

// CB to keep for the opponent's turn: G guardians whose ability costs CB (a Heal is also needed to call them)
function cbReserve(db: CardDB, s: GameState, p: PlayerId): number {
  const ps = s.players[p];
  if (!ps.hand.some((h) => !isHidden(h) && db[h.key].trigger === "heal")) return 0;
  return ps.gZone.some((g) => !g.faceUp && !isHidden(g) && db[g.key].type === "g-guardian"
    && db[g.key].abilities.some((a) => (a.cost ?? []).some((c) => c.startsWith("CB(")))) ? 1 : 0;
}

function dipsBelowReserve(db: CardDB, s: GameState, p: PlayerId, cost: string[]): boolean {
  const pay = cost.map((c) => c.match(/^CB\((\d+)\)/)).reduce((n, m) => n + (m ? +m[1] : 0), 0);
  if (!pay) return false;
  return s.players[p].damage.filter((d) => d.faceUp).length - pay < cbReserve(db, s, p);
}

// Try a costed ability in the head (follow the policy to the end) before actually paying
// Don't use it if: the main effect doesn't happen (e.g. no card to call), or paying CB/SB leaves the board worse than not using it
// Fast check without simulating: call/search effects with no source card to choose at all
function nothingToTake(db: CardDB, s: GameState, p: PlayerId, entry: QueueEntry): boolean {
  const ps = s.players[p];
  return entry.ability.effect.every((e) => {
    const m = e.match(/^(call|search)\(([a-z+]+)→/);
    if (!m) return false;
    const src = m[2];
    const pool = [...(src.includes("drop") ? ps.drop : []), ...(src.includes("hand") ? ps.hand : []), ...(src.includes("deck") ? ps.deck : [])];
    return !pool.some((i) => i.uid !== entry.uid && !isG(db[i.key]));
  });
}

// During game simulation (search) only the fast check is used, so many rollouts fit
export const fastMode = { on: false };

function worthPaying(db: CardDB, s: GameState, p: PlayerId, index: number): boolean {
  const entry = ownQueue(s, p)[index];
  const cost = entry.ability.cost ?? [];
  if (simulating || !cost.length) return true;
  const checks = MAIN_EFFECT.filter(([re]) => entry.ability.effect.some((e) => re.test(e)));
  const scarce = cost.some((c) => /^(CB|SB)\(/.test(c)) && !entry.ability.effect.some((e) => COMBAT_EFFECT.test(e));
  if (!checks.length && !scarce) return true;
  if (nothingToTake(db, s, p, entry)) return false;
  if (fastMode.on) return true;
  simulating = true;
  try {
    const events: Ev[] = [];
    const used = settleOwn(db, tryApply(db, s, p, { type: "order-queue", index }), p, events);
    if (!used) return false;
    if (checks.length && !checks.some(([, hit]) => events.some((e) => hit(e, p)))) return false;
    if (!scarce) return true;
    const skipped = settleOwn(db, tryApply(db, s, p, { type: "decline-queue", index }), p, []);
    if (!skipped) return true;
    const gain = evaluate(db, used.state, p) - evaluate(db, skipped.state, p);
    return gain > (s.turnPlayer === p && dipsBelowReserve(db, s, p, cost) ? 0.4 : 0);
  } finally {
    simulating = false;
  }
}

function orderQueue(db: CardDB, s: GameState, p: PlayerId): Action {
  const q = ownQueue(s, p);
  const order = q.map((e, i) => ({ e, i, v: priority(db, s, e) })).sort((a, b) => b.v - a.v);
  for (const { e, i } of order) if (wantUse(db, s, e) && (!e.optional || worthPaying(db, s, p, i))) return { type: "order-queue", index: i };
  const skip = q.findIndex((e) => e.optional);
  return skip >= 0 ? { type: "decline-queue", index: skip } : { type: "order-queue", index: 0 };
}

function choose(db: CardDB, s: GameState, p: PlayerId): Action {
  const c = s.awaiting!.choice!;
  const r = s.resolving;
  if (c.kind === "yesno") {
    if (c.prompt.key === "choice.hollow" && r) return { type: "choose", option: wantHollow(db, s, r) ? "yes" : "no" };
    return { type: "choose", option: r && wantUse(db, s, { ...r, optional: true }) ? "yes" : "no" };
  }
  if (c.kind === "option") {
    const ps = s.players[p];
    const cc = c.options.find((o) => o.startsWith("CC"));
    const sc = c.options.find((o) => o.startsWith("SC"));
    if (cc && ps.damage.some((d) => !d.faceUp) && (ps.soul.length >= 2 || !sc)) return { type: "choose", option: cc };
    if (sc) return { type: "choose", option: sc };
    return { type: "choose", option: c.options[0] };
  }
  return { type: "choose", option: "yes" };
}

function currentOp(s: GameState) {
  const r = s.resolving;
  return r ? parseCode(r.ops[r.i] ?? "") : undefined;
}

// Value of a unit when called to the board
function fieldValue(db: CardDB, inst: CardInstance, fromDrop: boolean) {
  const card = db[inst.key];
  return (card.power ?? 0) / 10000 + (fromDrop && dropCallPayoff(card) ? 1.5 : 0) + (hollowPayoff(card) ? 0.3 : 0) - (card.trigger ? 0.6 : 0);
}

// Value of a card sent to the drop zone (search to drop): cards that work well when called from the drop; don't pull triggers out of the deck
function dropValue(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance) {
  const card = db[inst.key];
  // Nightrose (G unit) gains Power per card named "Nightrose" in the drop zone
  const named = s.players[p].gZone.some((g) => !isHidden(g) && db[g.key].abilities.some((a) => a.effect.some((e) => e.includes("count-in-drop(name(") && e.includes(card.name.split(", ").at(-1) ?? "\u0000"))));
  return (dropCallPayoff(card) ? 2 : 0) + (card.abilities.some((a) => a.effect.includes("hollow(self)")) ? 1 : 0) + (card.type === "normal" && !card.trigger ? 0.5 : -1) + (named ? 0.8 : 0);
}

// Value of a card searched to hand: grades not yet in hand first
function searchValue(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance) {
  const card = db[inst.key];
  const hand = s.players[p].hand;
  const have = hand.filter((h) => db[h.key].grade === card.grade).length;
  return keepValue(db, s, p, inst) + (have ? 0 : 1) + rideScore(card) * 0.2;
}

function threat(db: CardDB, s: GameState, q: PlayerId, inst: CardInstance) {
  const c = circleOf(s, q, inst.uid);
  // Units that haven't attacked yet on the opponent's turn (when we shoot off-turn) are more dangerous
  return unitThreat(db, s, q, inst.uid) + (s.turnPlayer === q && c && !inst.rested ? 0.5 : 0);
}

function selectTarget(db: CardDB, s: GameState, p: PlayerId): Action {
  const c = s.awaiting!.choice!;
  if (c.kind === "circle") return { type: "select-target", uids: [], to: pickCircle(db, s, p, c.options) };
  if (c.kind !== "cards") return { type: "select-target", uids: [] };
  const op = currentOp(s);
  const insts = c.options.map((u) => locate(s, u)?.inst).filter((i): i is CardInstance => !!i);
  const top = (score: (i: CardInstance) => number, n: number) =>
    [...insts].sort((a, b) => score(b) - score(a)).slice(0, n).map((i) => i.uid);
  const ps = s.players[p];
  const name = op?.name ?? "";
  const dst = op?.pos[0]?.split("→")[1];
  let uids: string[];
  switch (name) {
    case "discard": uids = top((i) => -keepValue(db, s, p, i), c.min); break;
    case "retire-own": uids = top((i) => -unitValue(db, i) + (hollowPayoff(db[i.key]) || dropCallPayoff(db[i.key]) ? 0.2 : 0), c.min); break;
    case "search":
      uids = dst === "hand" ? top((i) => searchValue(db, s, p, i), c.max)
        : insts.filter((i) => dropValue(db, s, p, i) > 0).sort((a, b) => dropValue(db, s, p, b) - dropValue(db, s, p, a))
          .slice(0, Math.max(0, Math.min(c.max, ps.deck.length - 10))).map((i) => i.uid);   // deck is low, don't send more to the drop
      break;
    case "call":
      if (dst === "GC") {
        const byGrade = new Map<number, CardInstance>();
        for (const i of [...insts].sort((a, b) => shieldOf(db, b) - shieldOf(db, a))) if (shieldOf(db, i) > 0 && !byGrade.has(db[i.key].grade)) byGrade.set(db[i.key].grade, i);
        uids = [...byGrade.values()].sort((a, b) => shieldOf(db, b) - shieldOf(db, a)).slice(0, c.max).map((i) => i.uid);
      } else {
        const fromDrop = (op?.pos[0] ?? "").includes("drop");
        const recall = (s.resolving?.ops[s.resolving.i] ?? "").includes("that-card");
        const best = top((i) => recall ? recallCardValue(db, s, p, i) : fieldValue(db, i, fromDrop && ps.drop.some((d) => d.uid === i.uid)), 1);
        const anyRoom = RC.some((rc) => !ps.circles[rc] || ps.circles[rc]!.hollowed);
        uids = c.min > 0 || anyRoom ? best : [];
      }
      break;
    case "retire": {
      const opp = other(p);
      uids = top((i) => threat(db, s, opp, i), c.max);
      break;
    }
    case "power": case "critical": case "shield": uids = top((i) => statTargetValue(db, s, p, i), c.max); break;
    case "swap": uids = []; break;
    case "g-assist":
      uids = c.prompt.key === "choice.gAssistPick" ? top((i) => searchValue(db, s, p, i), c.max) : top((i) => -keepValue(db, s, p, i), c.min);
      break;
    default: uids = top(() => 0, Math.max(c.min, Math.min(1, c.max)));
  }
  if (uids.length < c.min) uids = [...uids, ...c.options.filter((u) => !uids.includes(u))].slice(0, c.min);
  return { type: "select-target", uids: uids.slice(0, c.max) };
}

// Units that benefit from extra Power: those that will still attack or still boost
function statTargetValue(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance) {
  const c = circleOf(s, p, inst.uid);
  if (!c) return 0;
  if (s.turnPlayer !== p) return c === s.battle?.target ? 3 : c === "vc" ? 1 : 0;
  if (inst.rested) return 0;
  if (c === "vc") return 2.5;
  if (FRONT.includes(c)) return 2;
  const front = FRONT.find((f) => BEHIND[f] === c);
  return front && s.players[p].circles[front] && canBoost(db[inst.key]) ? 1.5 : 0.2;
}

export function pickCircle(db: CardDB, s: GameState, p: PlayerId, options: Circle[]): Circle | undefined {
  const ps = s.players[p];
  const r = s.resolving;
  const uid = r ? (r.local.card ? String(r.local.card) : r.uid) : undefined;
  const inst = uid ? locate(s, uid)?.inst : undefined;
  if (!inst) return options[0];
  const card = db[inst.key];
  const score = (c: Circle) => {
    const occ = ps.circles[c];
    let v = 0;
    const isFront = FRONT.includes(c);
    if (canBoost(card)) {
      const front = FRONT.find((f) => BEHIND[f] === c);
      v += isFront ? 0.5 : front && ps.circles[front] ? (front === "vc" ? 3 : 2.5) : 1.5;
    } else v += isFront ? 3 : 0.2;
    if (occ) v -= occ.hollowed || occ.retireAtTurnEnd ? 0.4 : 1 + unitValue(db, occ) * 2;
    return v;
  };
  const best = [...options].sort((a, b) => score(b) - score(a))[0];
  return best && score(best) > -0.5 ? best : undefined;
}

// ---------- Triggers ----------

function triggerTarget(db: CardDB, s: GameState, p: PlayerId): Action {
  const b = s.battle!;
  const t = b.pendingTrigger!;
  const ps = s.players[p];
  const heal = () => {
    if (t.kind !== "heal") return undefined;
    const down = ps.damage.find((d) => !d.faceUp);
    return (down ?? ps.damage.at(-1))?.uid;
  };
  if (t.during === "damage" || s.turnPlayer !== p) return { type: "trigger-target", powerTo: "vc", extraTo: t.kind === "critical" ? "vc" : undefined, healUid: heal() };
  const opp = s.players[other(p)];
  const ap = powerOf(db, ps, b.attacker);
  const dp = powerOf(db, opp, b.target) + opp.guardian.reduce((n, g) => n + shieldOf(db, g), 0);
  const blocked = b.noHit || !opp.circles[b.target];
  // Front-row units that haven't attacked, where trigger Power adds pressure
  const oppVc = powerOf(db, opp, "vc");
  const waiting = (["front_left", "front_right"] as Circle[]).filter((c) => ps.circles[c] && !ps.circles[c]!.rested)
    .sort((x, y) => {
      const gain = (c: Circle) => forced(attackPower(db, ps, c, BEHIND[c]) + t.power, oppVc) - forced(attackPower(db, ps, c, BEHIND[c]), oppVc);
      return gain(y) - gain(x) || attackPower(db, ps, y, BEHIND[y]) - attackPower(db, ps, x, BEHIND[x]);
    });
  const willHitWith = (extra: number) => !blocked && ap + extra >= dp;
  if (t.kind === "stand") {
    const rested = (["front_left", "front_right"] as Circle[]).filter((c) => ps.circles[c]?.rested).sort((x, y) => powerOf(db, ps, y) - powerOf(db, ps, x))[0];
    if (rested && b.attacker !== rested) return { type: "trigger-target", powerTo: willHitWith(0) || !willHitWith(t.power) ? rested : b.attacker, extraTo: rested };
  }
  const powerTo: Circle = willHitWith(t.power) && !willHitWith(0) ? b.attacker : waiting[0] ?? b.attacker;
  if (t.kind === "critical") {
    const hits = willHitWith(powerTo === b.attacker ? t.power : 0);
    const extraTo: Circle = hits && b.target === "vc" ? b.attacker : waiting[0] ?? b.attacker;
    return { type: "trigger-target", powerTo, extraTo };
  }
  return { type: "trigger-target", powerTo, healUid: heal() };
}
