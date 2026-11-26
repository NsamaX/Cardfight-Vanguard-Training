// Estimate the opponent's side from visible information: hand (known cards + guesses from cards not yet seen), G guardians, resources, next-turn attack strength
// On a board that's been randomly filled (used in simulation) the whole hand is visible, so estimates are the real values of that sampled world
import {
  BEHIND, FRONT, bothVanguardsGrade3, canBoost, criticalOf, generationBreak, isG, isSentinel, other, powerOf, printedShield, type CardDB,
} from "../engine/rules";
import type { Card, GameState, PlayerId } from "../engine/types";
import { intelOf, isHidden } from "./view";

const hasNoHit = (c: Card) => isSentinel(c) && c.abilities.some((a) => a.effect.some((e) => e.startsWith("no-hit")));

// Average per card of unknown hand cards (from q's cards not yet seen)
function unknownCardStats(db: CardDB, s: GameState, q: PlayerId) {
  const pool = intelOf(s)?.pools[q].main;
  let n = 0, shield = 0, sentinel = 0, heal = 0, g3 = 0;
  for (const [k, x] of pool ?? []) {
    const c = db[k];
    if (!c || x <= 0 || isG(c)) continue;
    n += x;
    shield += x * (hasNoHit(c) ? 0 : printedShield(c));
    if (hasNoHit(c)) sentinel += x;
    if (c.trigger === "heal") heal += x;
    if (c.grade === 3) g3 += x;
  }
  return n ? { shield: shield / n, sentinel: sentinel / n, heal: heal / n, g3: g3 / n } : { shield: 6000, sentinel: 0.08, heal: 0.08, g3: 0.15 };
}

export interface Defense {
  shield: number;       // expected Shield in hand (not counting sentinels)
  sentinels: number;    // expected number of sentinels (each stops one attack, needs another card to discard)
  gGuard: number;       // expected Shield from G guardians (times the chance of having a Heal)
  cards: number;
}

// Defense the opponent q probably has this turn
export function estimateDefense(db: CardDB, s: GameState, q: PlayerId): Defense {
  const ps = s.players[q];
  const st = unknownCardStats(db, s, q);
  const reads = intelOf(s)?.reads;
  let shield = 0, sentinels = 0, heals = 0, hidden = 0;
  for (const h of ps.hand) {
    if (isHidden(h)) { hidden++; continue; }
    const c = db[h.key];
    if (isG(c)) continue;
    if (hasNoHit(c)) sentinels++; else shield += printedShield(c);
    if (c.trigger === "heal") heals++;
  }
  // An opponent who often takes damage at high damage probably has less Shield than average
  const passive = Math.max(0.6, 1 - 0.12 * (reads?.oppPassive ?? 0));
  shield += hidden * st.shield * passive;
  sentinels += hidden * st.sentinel;
  const pHeal = heals > 0 ? 1 : 1 - (1 - st.heal) ** hidden;
  return { shield, sentinels, gGuard: gGuardianLeft(db, s, q) ? 15000 * pHeal : 0, cards: ps.hand.length };
}

// Can the opponent still call a G guardian (both vanguards grade 3, at most 3 face up, a face-down card left)
export function gGuardianLeft(db: CardDB, s: GameState, q: PlayerId): boolean {
  if (!bothVanguardsGrade3(db, s)) return false;
  const ps = s.players[q];
  if (ps.gZone.filter((g) => g.faceUp && !isHidden(g) && db[g.key].type === "g-guardian").length > 3) return false;
  const known = ps.gZone.some((g) => !g.faceUp && !isHidden(g) && db[g.key].type === "g-guardian");
  const pool = intelOf(s)?.pools[q].g;
  const unseen = [...(pool ?? [])].some(([k, n]) => n > 0 && db[k]?.type === "g-guardian");
  return known || (unseen && ps.gZone.some((g) => !g.faceUp));
}

// Resources the opponent can use (decides which of the opponent's combos can work)
export function resources(db: CardDB, s: GameState, q: PlayerId) {
  const ps = s.players[q];
  return { cb: ps.damage.filter((d) => d.faceUp).length, soul: ps.soul.length, gb: generationBreak(db, ps) };
}

// Threat of q's units on the board: Power, attack/battle-end/boost abilities that can work with the available resources
export function unitThreat(db: CardDB, s: GameState, q: PlayerId, uid: string): number {
  const ps = s.players[q];
  const c = (Object.keys(ps.circles) as (keyof typeof ps.circles)[]).find((k) => ps.circles[k]?.uid === uid);
  const inst = c ? ps.circles[c] : undefined;
  if (!inst || !c) return 0;
  const card = db[inst.key];
  if (inst.hollowed || inst.retireAtTurnEnd) return 0.1;
  const res = resources(db, s, q);
  let v = 0.3 + (card.power ?? 0) / 20000;
  for (const ab of card.abilities) {
    if (ab.kind !== "AUTO" && ab.kind !== "ACT") continue;
    if (!/(RC|^$)/.test(ab.zone ?? "")) continue;
    const gb = (ab.cond ?? []).map((x) => x.match(/GB\((\d+)\)/)).find(Boolean);
    if (gb && res.gb < +gb[1]) continue;
    const cb = (ab.cost ?? []).map((x) => x.match(/^CB\((\d+)\)/)).find(Boolean);
    if (cb && res.cb < +cb[1]) continue;
    if (/attack\(self|battle-end\(self|boost/.test(ab.timing ?? "")) v += 0.5;
  }
  const front = FRONT.includes(c);
  if (!front && canBoost(card)) {
    const f = FRONT.find((x) => BEHIND[x] === c);
    if (f && ps.circles[f]) v += 0.3;   // booster of a column with an attacker
  }
  return v;
}

// Opponent q's next-turn attack on p's vanguard: total Shield p needs to guard the attacks that would be lethal (not counting triggers)
// The opponent's vanguard counts as a stride (15000 + heart) if it can stride
// The same board gives the same answer (called repeatedly when comparing every call), so cache it
const needCache = new WeakMap<GameState, Partial<Record<PlayerId, number>>>();
export function nextTurnNeed(db: CardDB, s: GameState, p: PlayerId): number {
  const c = needCache.get(s) ?? {};
  if (c[p] === undefined) { c[p] = computeNextTurnNeed(db, s, p); needCache.set(s, c); }
  return c[p]!;
}

function computeNextTurnNeed(db: CardDB, s: GameState, p: PlayerId): number {
  const q = other(p);
  const ops = s.players[q], me = s.players[p];
  const dmg = me.damage.length;
  const def = powerOf(db, me, "vc");
  const vc = ops.circles.vc;
  if (!vc) return 0;
  const vcCard = db[vc.key];
  const heartPower = vcCard.type === "g-unit" && ops.heart ? db[ops.heart.key].power ?? 0 : vcCard.power ?? 0;
  const canStride = vcCard.grade >= 3 && ops.gZone.some((g) => !g.faceUp);
  let need = 0;
  for (const col of FRONT) {
    const u = col === "vc" ? vc : ops.circles[col];
    if (!u) continue;
    const b = ops.circles[BEHIND[col]!];
    const boost = b && canBoost(db[b.key]) ? db[b.key].power ?? 0 : 0;
    const base = col === "vc" ? (canStride ? 15000 + heartPower : heartPower) : db[u.key].power ?? 0;
    const crit = col === "vc" ? criticalOf(db, vc) : 1;
    if (dmg + crit + (col === "vc" ? 1 : 0) < 6) continue;   // the vanguard allows for 1 Critical from a drive check
    const n = base + boost - def + 1;
    if (n > 0) need += Math.ceil(n / 5000) * 5000;
  }
  return need;
}
