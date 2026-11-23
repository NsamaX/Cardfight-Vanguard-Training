import type { GameEvent, GameState, PlayerId } from "../engine/types";

// หนึ่งรหัสผล (ชื่อหน้าวงเล็บใน effect เช่น "call", "mill", "draw") ต่อหนึ่ง handler
// รายชื่อรหัสทั้งหมดอยู่ใน vocabulary.md รหัสที่ยังไม่มี handler ให้ UI เปิดโหมดทำเอง (Action "manual")
export interface EffectContext {
  state: GameState;
  owner: PlayerId;
  sourceUid: string;
  args: Record<string, string>;   // พารามิเตอร์ที่แปลงจากรหัส เช่น { n: "≤1", filter: "has-hollow" }
}

export type EffectHandler = (ctx: EffectContext) => { state: GameState; events: GameEvent[] };

export const handlers: Record<string, EffectHandler> = {};
