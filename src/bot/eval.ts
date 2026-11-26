// Board score from player p's point of view (unit = 1 card), used to judge each simulation run
import { BEHIND, FRONT, canBoost, generationBreak, isSentinel, other, powerOf, type CardDB } from "../engine/rules";
import type { GameState, PlayerId } from "../engine/types";
import { keepValue, unitValue } from "./knowledge";
import { isHidden } from "./view";

export const WIN = 60;
// Cost of sitting at damage n: each damage moves closer to 6 (almost linear), and damage 5 is very dangerous since one more hit loses
export const DAMAGE_COST = [0, 0.6, 1.2, 1.85, 2.75, 4.3];
export const CB_VALUE = 0.15;
// Vanguard grade: lower than the opponent's = can't call higher grades, can't stride, low Power
const GRADE_VALUE = 1.4;

function side(db: CardDB, s: GameState, p: PlayerId): number {
  const ps = s.players[p], opp = s.players[other(p)];
  let v = -DAMAGE_COST[Math.min(5, ps.damage.length)];
  const vc = ps.circles.vc ? db[ps.circles.vc.key] : undefined;
  v += (vc?.type === "g-unit" && ps.heart ? db[ps.heart.key].grade : vc?.grade ?? 0) * GRADE_VALUE;
  // The first 2 CB are worth a lot (needed for combos/off-turn G guardians); beyond that the value drops
  const cb = ps.damage.filter((d) => d.faceUp).length;
  v += Math.min(cb, 2) * 0.35 + Math.max(0, cb - 2) * CB_VALUE;
  for (const h of ps.hand) v += keepValue(db, s, p, h);
  // Being able to guard with sentinels/G guardians helps at high damage
  if (ps.damage.length >= 4 && ps.hand.some((h) => !isHidden(h) && isSentinel(db[h.key]))) v += 0.4;
  const oppVc = powerOf(db, opp, "vc") || 1;
  for (const c of FRONT) {
    const u = ps.circles[c];
    if (!u) continue;
    if (c !== "vc") v += unitValue(db, u);
    const b = BEHIND[c];
    const bu = b ? ps.circles[b] : undefined;
    const boost = bu && canBoost(db[bu.key]) && !bu.hollowed ? (db[bu.key].power ?? 0) : 0;
    if (bu) v += unitValue(db, bu) * (boost ? 1 : 0.4);
    const col = (c === "vc" ? powerOf(db, ps, c) : db[u.key].power ?? 0) + boost;
    if (col >= oppVc) v += 0.25 + Math.min(2, Math.floor((col - oppVc) / 5000)) * 0.15;
  }
  v += generationBreak(db, ps) * 0.25 + ps.gZone.filter((g) => !g.faceUp).length * 0.08;
  v += Math.min(ps.soul.length, 5) * 0.06 + Math.min(ps.drop.length, 15) * 0.02;
  if (ps.deck.length < 10) v -= (10 - ps.deck.length) * 0.35;
  return v;
}

export function evaluate(db: CardDB, s: GameState, p: PlayerId): number {
  if (s.winner) return s.winner === p ? WIN : -WIN;
  return side(db, s, p) - side(db, s, other(p));
}
