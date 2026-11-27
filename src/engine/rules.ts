import { msg, type Msg, type MsgKey, type Params } from "../i18n/msg";
import type { Card, CardInstance, Circle, GameState, PlayerId, PlayerState } from "./types";

export type CardDB = Record<string, Card>;

// message is a key for debugging; the screen translates from msg
export class RuleError extends Error {
  readonly msg: Msg;
  constructor(m: Msg | MsgKey, params?: Params) {
    const v = typeof m === "string" ? msg(m, params) : m;
    super(v.key);
    this.msg = v;
  }
}

export const FRONT: Circle[] = ["vc", "front_left", "front_right"];
export const RC: Circle[] = ["front_left", "front_right", "back_left", "back_center", "back_right"];
export const BEHIND: Partial<Record<Circle, Circle>> = { vc: "back_center", front_left: "back_left", front_right: "back_right" };
export const SAME_COLUMN: Partial<Record<Circle, Circle>> = {
  front_left: "back_left", back_left: "front_left", front_right: "back_right", back_right: "front_right",
};
export const circleMsg = (c: Circle): Msg => msg(`circle.${c}`);

export const PLAYERS: PlayerId[] = ["me", "bot"];
export const other = (p: PlayerId): PlayerId => (p === "me" ? "bot" : "me");
export const isG = (c: Card) => c.type === "g-unit" || c.type === "g-guardian";
export const hasHollow = (c: Card) => c.abilities.some((a) => a.effect.includes("hollow(self)"));
export const isSentinel = (c: Card) => c.abilities.some((a) => a.effect.includes("keyword(Sentinel)"));
export const canBoost = (c: Card) => c.skill === "boost";
export const canIntercept = (c: Card) => c.skill === "intercept";
export const triggerPower = (c: Card) => c.triggerPower ?? 0;

const modSum = (inst: CardInstance, stat: "power" | "critical" | "shield" | "drive") =>
  inst.mods.filter((m) => m.stat === stat).reduce((n, m) => n + m.value, 0);

// Power of a unit on the board: a G unit on VC also gets the heart's Power
export function powerOf(db: CardDB, ps: PlayerState, circle: Circle): number {
  const inst = ps.circles[circle];
  if (!inst) return 0;
  const card = db[inst.key];
  let base = card.power ?? 0;
  if (circle === "vc" && card.type === "g-unit" && ps.heart) base += db[ps.heart.key].power ?? 0;
  return base + modSum(inst, "power");
}

export const criticalOf = (db: CardDB, inst: CardInstance) => (db[inst.key].critical ?? 0) + modSum(inst, "critical");

// Values printed on the card per the .yaml file; cards with no printed Shield (grade 3, G units) = 0
export const printedShield = (card: Card) => card.shield ?? 0;

export const shieldOf = (db: CardDB, inst: CardInstance) => printedShield(db[inst.key]) + modSum(inst, "shield");

export function driveOf(db: CardDB, inst: CardInstance): number {
  const skill = db[inst.key].skill;
  return Math.max(0, (skill === "triple-drive" ? 3 : skill === "twin-drive" ? 2 : 1) + modSum(inst, "drive"));
}

export const vcGrade =(db: CardDB, ps: PlayerState) => (ps.circles.vc ? db[ps.circles.vc.key].grade : 0);
// Conditions for stride and G guardian
export const bothVanguardsGrade3 = (db: CardDB, s: GameState) => PLAYERS.every((p) => vcGrade(db, s.players[p]) >= 3);

// GB = face-up G units on VC and in the G zone combined
export function generationBreak(db: CardDB, ps: PlayerState): number {
  const onVc = ps.circles.vc && db[ps.circles.vc.key].type === "g-unit" ? 1 : 0;
  return onVc + ps.gZone.filter((i) => i.faceUp).length;
}
