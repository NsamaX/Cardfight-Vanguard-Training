import type { Action, Decision, GameEvent, GameState } from "../engine/types";

// บอทได้ state เต็ม แต่ต้องตัดสินใจจากข้อมูลที่ฝั่งนั้นเห็นได้เท่านั้น (ใช้ viewFor() ใน view.ts ก่อนคิดเสมอ)
// เพิ่มบอทระดับใหม่ = เขียน class ใหม่ที่ implement interface นี้
export interface Bot {
  name: string;
  observe?(events: GameEvent[]): void;   // เหตุการณ์ทุกอันที่เกิดในเกม (ใช้จำการ์ดที่เคยเปิดให้เห็น)
  decide(state: GameState, decision: Decision): Promise<Action>;
}
