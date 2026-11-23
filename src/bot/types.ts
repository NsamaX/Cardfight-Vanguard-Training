import type { Action, Decision, GameState } from "../engine/types";

// บอทเห็นแค่ข้อมูลที่ผู้เล่นฝั่งนั้นเห็นได้ (engine ต้องส่ง state ที่ซ่อนมือ/กองการ์ดของอีกฝ่ายแล้ว)
// เพิ่มบอทระดับใหม่ = เขียน class ใหม่ที่ implement interface นี้
export interface Bot {
  name: string;
  decide(state: GameState, decision: Decision): Action;
}
