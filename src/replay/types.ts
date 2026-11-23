import type { Action, Deck, PlayerId } from "../engine/types";

// replay ไม่เก็บภาพสนาม เก็บแค่ seed + เด็ค + การกระทำทั้งหมดตามลำดับ
// เล่นซ้ำ = เริ่มเกมด้วย seed เดิม แล้วป้อน actions ทีละอันเข้า engine
export interface Replay {
  version: 1;
  createdAt: string;
  title: string;          // เช่น "ชนะบอท เทิร์น 9"
  seed: number;
  firstPlayer: PlayerId;
  decks: Record<PlayerId, Deck>;
  actions: { player: PlayerId; action: Action }[];
}
