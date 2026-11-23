import { msg, type Msg, type MsgKey, type Params } from "../i18n/msg";
import type { Card, CardInstance, Circle, GameState, PlayerId, PlayerState } from "./types";

export type CardDB = Record<string, Card>;

// message เป็น key ไว้ดีบัก หน้าจอแปลจาก msg
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
export const isSentinel = (c: Card) => c.abilities.some((a) => a.effect.includes("keyword(พิทักษ์)"));

const modSum = (inst: CardInstance, stat: "power" | "critical" | "shield") =>
  inst.mods.filter((m) => m.stat === stat).reduce((n, m) => n + m.value, 0);

// Power ของยูนิทบนสนาม: G ยูนิทบน VC ได้ Power ของฮาร์ทเพิ่ม
export function powerOf(db: CardDB, ps: PlayerState, circle: Circle): number {
  const inst = ps.circles[circle];
  if (!inst) return 0;
  const card = db[inst.key];
  let base = card.power ?? 0;
  if (circle === "vc" && card.type === "g-unit" && ps.heart) base += db[ps.heart.key].power ?? 0;
  return base + modSum(inst, "power");
}

export const criticalOf = (inst: CardInstance) => 1 + modSum(inst, "critical");

// Shield ตามเกรดที่พิมพ์ในภาค G: เกรด 0 = 10000, 1-2 = 5000, 3 = 0 / G การ์เดี้ยนใช้ค่าบนการ์ด
export const printedShield = (card: Card) => (card.type === "g-guardian" ? card.shield ?? 0 : [10000, 5000, 5000, 0][card.grade] ?? 0);

export const shieldOf = (db: CardDB, inst: CardInstance) => printedShield(db[inst.key]) + modSum(inst, "shield");

export function driveOf(db: CardDB, inst: CardInstance): number {
  const card = db[inst.key];
  if (card.type === "g-unit") return 3;
  return card.grade >= 3 ? 2 : 1;
}

export const vcGrade = (db: CardDB, ps: PlayerState) => (ps.circles.vc ? db[ps.circles.vc.key].grade : 0);
// เงื่อนไขของสไตรด์และ G การ์เดี้ยน
export const bothVanguardsGrade3 = (db: CardDB, s: GameState) => PLAYERS.every((p) => vcGrade(db, s.players[p]) >= 3);

// GB = G ยูนิทที่หงายหน้าบน VC และใน G โซนรวมกัน
export function generationBreak(db: CardDB, ps: PlayerState): number {
  const onVc = ps.circles.vc && db[ps.circles.vc.key].type === "g-unit" ? 1 : 0;
  return onVc + ps.gZone.filter((i) => i.faceUp).length;
}
