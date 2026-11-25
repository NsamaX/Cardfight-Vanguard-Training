import type { BotLevel } from "../bot";
import type { Action, Deck, GameState, PlayerId } from "../engine/types";
import type { LogEntry } from "../lib/board";

export interface RecordedAction { player: PlayerId; action: Action }

// replay ไม่เก็บภาพสนาม เก็บแค่ seed + เด็ค + การกระทำทั้งหมดตามลำดับ
// เล่นซ้ำ = เริ่มเกมด้วย seed เดิม (หรือสนาม start ถ้ามี) แล้วป้อน actions ทีละอันเข้า engine
export interface Replay {
  version: 1;
  id: string;
  createdAt: string;
  title: string;          // เช่น "แกรนบลู ไนท์โรส vs แกรนบลู ไนท์โรส"
  seed: number;
  firstPlayer: PlayerId;
  decks: Record<PlayerId, Deck>;
  start?: GameState;      // เกมที่เล่นต่อจาก replay แบบ states: เริ่มจากสนามนี้แทนการเริ่มเกมใหม่
  bot?: BotLevel | "off";   // "off" = replay เก่าจากโหมดคุมเองทั้งสองฝั่ง (เลิกใช้แล้ว)
  actions: RecordedAction[];
  winner?: PlayerId;
  turn: number;
}

// ไฟล์แบบเก็บสนามทุกก้าว (เกมที่เล่นก่อนมีระบบบันทึก action)
export interface StatesFile {
  kind: "states";
  decks: Record<PlayerId, Deck>;
  states: GameState[];
  log: LogEntry[];
}

export type ReplaySource = Replay | StatesFile;
