// กติกาฝั่งหน้าจอของหน้าสนาม (ฟังก์ชันล้วน ไม่มี React): ช่องไหนคลิกได้ ตัวเลขการต่อสู้ และการหาการ์ดที่กำลังดู
import { BEHIND, FRONT, RC, SAME_COLUMN, bothVanguardsGrade3, circleMsg, other, powerOf, shieldOf, type CardDB } from "../engine/rules";
import { locate, playerMsg } from "../engine/state";
import type { CardInstance, Choice, Circle, GameEvent, GameState, PlayerId } from "../engine/types";
import { msg, type Msg, type MsgKey } from "../i18n/msg";

export type Zone = "deck" | "drop" | "soul" | "damage" | "gZone" | "bind";
export type Sel =
  | { kind: "hand"; player: PlayerId; uid: string }
  | { kind: "circle"; player: PlayerId; circle: Circle }
  | { kind: "attack"; player: PlayerId; col: Circle; front: boolean; back: boolean };   // แบทเทิล: ตัวโจมตี (แถวหน้า) และตัวบูสท์ (แถวหลัง) ในแนวเดียวกัน

// ช่องแถวหน้าของแนวที่ช่องนี้อยู่ (vc ↔ back_center, หน้า ↔ หลังซ้าย/ขวา)
export const columnOf = (c: Circle): Circle => (FRONT.includes(c) ? c : FRONT.find((f) => BEHIND[f] === c)!);
export type Mode =
  | { kind: "mulligan"; picks: string[] }
  | { kind: "stride"; gUid?: string; picks: string[] }            // G ยูนิทที่จะสไตรด์ + การ์ดบนมือที่จะทิ้ง (เกรดรวม 3 ขึ้นไป)
  | { kind: "gguard"; gUid: string; discardUid?: string }
  | { kind: "guard"; picks: string[] }                      // การ์ดบนมือที่เลือกจะการ์ด (หลายใบได้)
  | { kind: "trigger"; powerTo?: Circle };
export type LogEntry = GameEvent & { turn: number };
export type Light = "source" | "active" | undefined;   // ขอบเหลือง = มีความสามารถรอ, ขอบส้ม = เลือกอยู่/กำลังทำงาน

// แถวในแถบเฟส เรียงตามลำดับเกม: START (เตรียมเกม/เปลี่ยนการ์ดบนมือ) แล้ววน STAND → END โดยแยก RIDE กับ STRIDE เป็นคนละแถว
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

// key = "phase:step" ของสถานะตอนนั้น
const stepKey = (s: GameState) => `${s.phase}:${s.step ?? ""}`;
const NEXT_LABEL: Record<string, MsgKey> = {
  "ride:ride": "next.toStride", "ride:stride": "next.toMain", "main:": "next.toBattle", "battle:attack": "next.endTurn",
  "battle:guard": "next.noMoreGuard",
};
export function nextLabel(db: CardDB, s: GameState): MsgKey | undefined {
  if (s.awaiting?.kind === "guard") return NEXT_LABEL["battle:guard"];
  if (s.awaiting?.kind !== "next-phase") return undefined;
  if (stepKey(s) === "ride:ride" && !bothVanguardsGrade3(db, s)) return NEXT_LABEL["ride:stride"];   // ไม่มีสไตรด์สเต็ป
  if (stepKey(s) === "main:" && s.turn === 1) return NEXT_LABEL["battle:attack"];                     // เทิร์นแรกไม่มีแบทเทิล
  return NEXT_LABEL[stepKey(s)];
}

// มองจากฝั่งเรา: สนามบอทกลับหัว แถวหลังอยู่บน และซ้าย-ขวาสลับกัน
export const LAYOUT: Record<PlayerId, Circle[]> = {
  bot: ["back_right", "back_center", "back_left", "front_right", "vc", "front_left"],
  me: ["front_left", "vc", "front_right", "back_left", "back_center", "back_right"],
};

const INTERCEPT: Circle[] = ["front_left", "front_right"];
export const canIntercept = (c: Circle) => INTERCEPT.includes(c);

// การ์ดจาก uid พร้อมป้ายตำแหน่ง (รวมการ์ดที่กำลังเปิดเช็คด้วย)
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

// ช่องที่ไฮไลต์ว่าคลิกได้ในสถานะตอนนี้
export function isTarget({ s, db, actor, choice, sel, mode }: TargetContext, p: PlayerId, c: Circle): boolean {
  const unit = s.players[p].circles[c];
  if (choice) return choice.kind === "circle" && p === choice.side && choice.options.includes(c);
  if (mode?.kind === "trigger") return p === actor && !!unit;
  if (s.step === "guard" && s.battle) return p === actor && canIntercept(c) && !!unit && db[unit.key].grade === 2 && c !== s.battle.target;
  if (sel?.kind === "hand" && p === actor) {
    if (s.phase === "ride" && s.step === "ride") return c === "vc";
    if (s.phase === "main") return RC.includes(c);
  }
  if (sel?.kind === "circle" && s.phase === "main" && p === actor) return SAME_COLUMN[sel.circle] === c;
  if (sel?.kind === "attack" && p !== actor) return sel.front && FRONT.includes(c) && !!unit;
  return false;
}

// บูสท์ได้: เกรด 0-1 ที่สแตนด์อยู่
export const canBoost = (db: CardDB, inst: CardInstance) => !inst.rested && db[inst.key].grade <= 1;

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

// โซนกองที่มีการ์ดต้นทางความสามารถอยู่ (การ์ดบนสนาม มือ GC ไฮไลต์ที่ตัวการ์ดเอง ส่วนกองไฮไลต์ทั้งช่อง)
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
    if (turns.at(-1)?.turn !== e.turn) turns.push({ turn: e.turn, items: [] });
    turns.at(-1)!.items.push(e);
  }
  return turns;
}
