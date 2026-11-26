// Shared knowledge of card values the bot uses (unit = roughly "1 card")
import { generationBreak, isG, isSentinel, printedShield, vcGrade, type CardDB } from "../engine/rules";
import type { Ability, Card, CardInstance, GameState, PlayerId } from "../engine/types";
import { isHidden } from "./view";

const json = (ab: Ability) => [ab.timing ?? "", ...(ab.cond ?? []), ...(ab.cost ?? []), ...ab.effect].join(" ");

// The card benefits from becoming hollowed (has an effect that needs hollow, or works when retired by hollow)
export const hollowPayoff = (card: Card) => card.abilities.some((ab) => /self-hollowed|by=hollow/.test(json(ab)));

// Has an effect when called from the drop zone
export const dropCallPayoff = (card: Card) => card.abilities.some((ab) => ab.kind === "AUTO" && /^enter\(RC, self, from=drop\)/.test(ab.timing ?? ""));

// Has an effect when called from hand (not counting hollowing itself)
export const handCallPayoff = (card: Card) => card.abilities.some((ab) =>
  ab.kind === "AUTO" && /^enter\(RC, self(, from=hand)?\)$/.test(ab.timing ?? "") && !ab.effect.every((e) => /^(hollow|retire)\(self/.test(e)));

const vcAbilityCount = (card: Card) => card.abilities.filter((ab) =>
  (ab.zone ?? "").includes("VC") || /^(ridden-upon|enter\(VC)/.test(ab.timing ?? "")).length;

export const rcAbilityCount = (card: Card) => card.abilities.filter((ab) =>
  ab.kind !== "CONT" && ((ab.zone ?? "").includes("RC") || /enter\(RC/.test(ab.timing ?? ""))).length;

export const shieldIn = (db: CardDB, inst: CardInstance) => (isHidden(inst) ? 6000 : printedShield(db[inst.key]));

// Value of a hand card: Shield usable for guarding + key cards to keep for ride/stride/G guardian calls
export function keepValue(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance): number {
  if (isHidden(inst)) return 0.9;
  const ps = s.players[p];
  const card = db[inst.key];
  if (isG(card)) return 2;
  let v = 0.55 + printedShield(card) / 10000 * 0.55;
  if (isSentinel(card)) v += 0.9;
  if (card.trigger === "heal" && ps.gZone.some((g) => !g.faceUp && db[g.key].type === "g-guardian")) v += 0.35;
  const g = vcGrade(db, ps);
  const sameGrade = ps.hand.filter((h) => !isHidden(h) && db[h.key].grade === card.grade && !isG(db[h.key]));
  if (card.grade === g + 1 && card.grade <= 3) v += sameGrade[0]?.uid === inst.uid ? 1.6 : 0.1;   // the card needed to ride next turn
  if (card.grade === 3 && g >= 3 && sameGrade[0]?.uid === inst.uid) v += 0.35;                   // discarded as next turn's stride cost
  if (handCallPayoff(card)) v += 0.15;
  return v;
}

// Value of a unit on the board (used when choosing which unit to lose)
export function unitValue(db: CardDB, inst: CardInstance): number {
  const card = db[inst.key];
  if (inst.hollowed || inst.retireAtTurnEnd) return 0.1;
  return 0.35 + (card.power ?? 0) / 25000 + (dropCallPayoff(card) ? 0.1 : 0) + (hollowPayoff(card) ? 0.1 : 0);
}

// Ride score: high for vanguard abilities, low for rear-guard abilities, never ride a sentinel
export function rideScore(card: Card): number {
  return vcAbilityCount(card) * 1.0 - rcAbilityCount(card) * 0.4 - (isSentinel(card) ? 5 : 0) - (card.trigger ? 3 : 0);
}

// G unit score: abilities actually usable after striding
export function strideScore(db: CardDB, s: GameState, p: PlayerId, g: CardInstance): number {
  const ps = s.players[p];
  const card = db[g.key];
  const gb = generationBreak(db, ps) + 1;
  const cb = ps.damage.filter((d) => d.faceUp).length;
  const copies = ps.gZone.filter((x) => !x.faceUp && x.key === g.key).length;
  let v = 0.1 * copies;
  for (const ab of card.abilities) {
    if (ab.kind === "STRIDE" || ab.kind === "CONT") continue;
    const need = (ab.cond ?? []).map((c) => c.match(/GB\((\d+)\)/)).find(Boolean);
    if (need && gb < +need[1]) continue;
    const cost = ab.cost ?? [];
    const cbNeed = cost.map((c) => c.match(/^CB\((\d+)\)/)).find(Boolean);
    if (cbNeed && cb < +cbNeed[1]) continue;
    if (cost.some((c) => c.includes("same-name")) && copies < 2) continue;
    if (ab.kind === "ACT" && (ab.zone ?? "").includes("G")) continue;   // ACT from the G zone
    // Look at the drop zone: calling from the drop pays off when there's a unit to call; if not yet, a card that sends cards to the drop is better
    const callable = ps.drop.filter((d) => !isHidden(d) && db[d.key].type === "normal" && !db[d.key].trigger).length;
    if (ab.effect.some((x) => x.startsWith("call(drop→RC"))) v += 1.5 * Math.min(1, callable / 2);
    else if (ab.effect.some((x) => x.startsWith("search(deck→drop"))) v += callable < 2 ? 2 : 0.8;
    else v += /call\(/.test(json(ab)) ? 1.5 : 1;
  }
  return v;
}
