// โครงสร้างข้อมูลกลางของเกม ทุกส่วน (UI, บอท, tutorial, replay) คุยกันผ่าน type ชุดนี้
import type { Msg } from "../i18n/msg";

// ---------- การ์ด (อ่านจาก content/cards/*/*.yaml) ----------

export type AbilityKind = "AUTO" | "ACT" | "CONT" | "STRIDE" | "ULTIMATE STRIDE" | "G GUARDIAN";
export type CardType = "normal" | "trigger" | "g-unit" | "g-guardian";

export interface Ability {
  kind: AbilityKind;
  zone?: string;       // "VC" | "RC" | "GC" | "VC/RC" | "hand" | "G zone"
  timing?: string;     // รหัสจังหวะ ดู vocabulary.md
  cond?: string[];
  cost?: string[];
  effect: string[];
  optional?: boolean;  // AUTO ที่เลือกไม่ใช้ได้แม้ไม่มีคอสต์ (การ์ดที่สร้างในโปรแกรม)
}

export interface Card {
  key: string;         // รหัสการ์ด = ส่วนแรกของ ids[0] เช่น "G-CHB03/S11TH"
  ids: string[];
  name: string;
  format: string[];
  type: CardType;
  trigger?: "critical" | "heal" | "stand" | "draw";
  grade: number;
  power?: number;      // G ยูนิทเก็บค่าที่พิมพ์ (15000) และ powerPlus = true
  powerPlus?: boolean;
  shield?: number;     // ไม่มีบนการ์ด (เกรด 3, G ยูนิท) = 0
  critical?: number;
  skill?: "boost" | "intercept" | "twin-drive" | "triple-drive";   // ไอคอนสกิลบนการ์ด
  triggerPower?: number;   // Power บนไอคอนทริกเกอร์ (ช่อง trigger_power ในไฟล์การ์ด)
  race: string;
  clan: string;
  abilities: Ability[];
  image?: string;      // URL ของรูปใน public/images/ ถ้ามี
  text: string;        // ข้อความความสามารถ (ช่อง text ของไฟล์การ์ด)
  source: string;      // path ของไฟล์ .yaml
}

// ---------- เด็ค ----------

export interface Deck {
  id: string;
  name: string;
  format: string;
  starter: string;
  main: Record<string, number>;     // รหัสการ์ด → จำนวน
  g_zone: Record<string, number>;
  sleeve?: string;                  // ชื่อไฟล์ใน public/sleeves/ ไม่ระบุ = หลังการ์ดลายเริ่มต้น
  g_sleeve?: string;
  cover?: string;                   // รหัสการ์ดที่ใช้เป็นปกเด็ค ไม่ระบุ = เลือกให้อัตโนมัติ
}

// ---------- สถานะเกม ----------

export type PlayerId = "me" | "bot";
export type Circle = "vc" | "front_left" | "front_right" | "back_left" | "back_center" | "back_right";
export type Phase = "setup" | "stand" | "draw" | "ride" | "main" | "battle" | "end";

export interface CardInstance {
  uid: string;          // ไม่ซ้ำกันตลอดเกม
  key: string;          // รหัสการ์ด
  rested: boolean;
  faceUp: boolean;
  hollowed: boolean;
  mods: { stat: "power" | "critical" | "shield"; value: number; source: string; until: "battle-end" | "turn-end" }[];
  usedThisTurn: string[];   // ความสามารถ 1/Turn ที่ใช้แล้ว (key ของ ability)
  grants?: Ability[];       // ความสามารถที่ได้รับจากการ์ดอื่น (หมดเมื่อจบเทิร์นหรือย้ายโซน)
  retireAtTurnEnd?: boolean;
}

export interface PlayerState {
  circles: Partial<Record<Circle, CardInstance>>;
  heart?: CardInstance;
  guardian: CardInstance[];
  hand: CardInstance[];
  deck: CardInstance[];
  drop: CardInstance[];
  soul: CardInstance[];
  damage: CardInstance[];
  gZone: CardInstance[];
  bind: CardInstance[];
  removed: CardInstance[];   // นำออกจากเกม (เช่น คอสต์ G อาซิสต์)
}

// เหตุการณ์ในเกมที่ AUTO รอฟัง (ตรงกับรหัสจังหวะใน vocabulary.md)
export type TriggerEvent =
  | { kind: "enter"; player: PlayerId; uid: string; zone: "VC" | "RC" | "GC"; from: string }
  | { kind: "stride"; player: PlayerId; uid: string }
  | { kind: "ridden-upon"; player: PlayerId; uid: string }
  | { kind: "attack"; player: PlayerId; uid: string; circle: Circle; target: Circle }
  | { kind: "battle-end"; player: PlayerId; attackerUid: string; attackerCircle: Circle; boosterUid?: string; target: Circle }
  | { kind: "to-drop" | "retired"; player: PlayerId; uid: string; from: "RC"; by?: "hollow"; grants: Ability[] }
  | { kind: "discarded"; player: PlayerId; uid: string; as: "g-guardian-cost" }
  | { kind: "phase-start"; player: PlayerId; phase: "battle" };

// ความสามารถที่รอทำงานในคิว check timing
export interface QueueEntry {
  owner: PlayerId;
  uid: string;
  key: string;          // index ของ ability ในการ์ด หรือ "g<n>" สำหรับความสามารถที่ได้รับ
  ability: Ability;
  event?: TriggerEvent;
  label: string;
  optional: boolean;    // เลือกไม่ใช้ได้ (มีคอสต์ หรือผลแบบ "ได้")
}

export type Choice =
  | { kind: "yesno"; prompt: Msg }
  | { kind: "option"; prompt: Msg; options: string[] }
  | { kind: "cards"; prompt: Msg; options: string[]; min: number; max: number; bonus?: { stat: "power" | "shield" | "critical"; value: number } }
  | { kind: "circle"; prompt: Msg; side: PlayerId; options: Circle[] };

export interface Resolving extends QueueEntry {
  ops: string[];
  i: number;
  asked: boolean;
  choice?: Choice;
  answer?: { uids?: string[]; to?: Circle; option?: string };
  local: Record<string, string | number | undefined>;
  called: string[];
  usedCircles: Circle[];
  hollowMilled: number;
  confirmed?: boolean;  // ผู้เล่นกดใช้แล้ว (ไม่ถามซ้ำว่าจะใช้ไหม)
}

export interface GameState {
  seed: number;
  rngState: number;
  turn: number;
  turnPlayer: PlayerId;
  firstPlayer: PlayerId;
  phase: Phase;
  step?: string;
  players: Record<PlayerId, PlayerState>;
  nextUid: number;
  mulliganDone: PlayerId[];
  rodeThisTurn: boolean;
  strodeThisTurn: boolean;
  battle?: Battle;
  events: TriggerEvent[];           // เหตุการณ์ที่ยังไม่ได้ตรวจว่าเปิด AUTO ใบไหน
  queue: QueueEntry[];              // คิว check timing
  resolving?: Resolving;            // ความสามารถที่กำลังทำงาน
  resume?: string;                  // ขั้นตอนของเกมที่ต้องทำต่อเมื่อคิวว่าง
  awaiting?: Decision;              // ถ้ามี = เกมหยุดรอผู้เล่นคนนี้ตัดสินใจ
  passQueue?: PlayerId;             // ผู้เล่นกดถัดไปตอนมีความสามารถรอ: ไม่ใช้แบบเลือกได้ และทำแบบบังคับตามลำดับเอง
  winner?: PlayerId;
}

export interface Battle {
  attacker: Circle;
  booster?: Circle;
  target: Circle;
  drivesLeft: number;
  damageLeft: number;
  hit?: boolean;
  checkCard?: CardInstance;         // การ์ดที่เปิดเช็คอยู่ (ยังไม่ขึ้นมือ/ลงดาเมจ)
  pendingTrigger?: { owner: PlayerId; kind: "critical" | "heal" | "stand" | "draw"; during: "drive" | "damage"; power: number };
  noHit?: boolean;
  triggers?: { card: CardInstance; during: "drive" | "damage"; done: boolean }[];   // ทริกเกอร์ที่เปิดได้ในการต่อสู้นี้ (แสดงบนแถบการต่อสู้)
}

// ---------- การตัดสินใจ / การกระทำ ----------
// engine บอกว่ารออะไร (Decision) ผู้เล่น/บอท/tutorial ตอบกลับเป็น Action

export interface Decision {
  player: PlayerId;
  kind: Action["type"];
  prompt?: Msg;
  options?: Action[];               // ถ้าจำนวนตัวเลือกจำกัด ให้บอทและ UI ใช้รายการนี้
  choice?: Choice;                  // ตัวเลือกของความสามารถที่กำลังทำงาน
}

export type Action =
  | { type: "mulligan"; returnUids: string[] }
  | { type: "next-phase" }
  | { type: "ride"; uid: string }
  | { type: "stride"; gUid: string; discardUids: string[] }
  | { type: "call"; uid: string; to: Circle }
  | { type: "move"; from: Circle; to: Circle }
  | { type: "attack"; attacker: Circle; target: Circle; booster?: Circle }
  | { type: "guard"; uids: string[]; intercept?: Circle[] }
  | { type: "end-guard" }
  | { type: "call-g-guardian"; gUid: string; discardUid: string }
  | { type: "activate"; cardUid: string; abilityIndex: number }
  | { type: "order-queue"; index: number; ask?: boolean }   // ask = ถามคอสต์/ตัวเลือกแบบ "ได้" ก่อน (ไม่ถือว่ากดยืนยันแล้ว)
  | { type: "decline-queue"; index: number }
  | { type: "pass-queue" }
  | { type: "select-target"; uids: string[]; to?: Circle }
  | { type: "choose"; option: string }
  | { type: "trigger-target"; powerTo: Circle; extraTo?: Circle; healUid?: string }
  | { type: "manual"; note: string; patch: unknown };   // ทางสำรองเมื่อยังไม่มี handler

// ---------- ผลลัพธ์ของการกระทำ ----------

export interface GameEvent {
  code: string;         // รหัสเหตุการณ์ ตรงกับรหัสจังหวะใน vocabulary.md เช่น "to-drop(own, from=RC)"
  player: PlayerId;
  cardUid?: string;
  causeIndex?: number;  // index ของเหตุการณ์ต้นเหตุ ใช้สร้างประวัติแบบลำดับชั้น
  text: Msg;            // ข้อความสำหรับประวัติการเล่น (แปลตอนแสดงผล)
}
