// ข้อความที่ engine และ lib ส่งออกไปเป็น key + ค่าตัวแปร หน้าจอแปลตามภาษาที่เลือกตอนแสดงผล
// ค่าตัวแปรที่เป็นตัวเลขจัดรูปแบบด้วย fmt ส่วน Msg ซ้อนจะถูกแปลก่อนแทนค่า
import type { th } from "./th";

export type MsgKey = keyof typeof th;
export type Param = string | number | Msg;
export type Params = Record<string, Param>;

export interface Msg {
  key: MsgKey;
  params?: Params;
}

// แม่แบบเป็นข้อความที่มี {ชื่อ} หรือฟังก์ชัน (ใช้เมื่อต้องเปลี่ยนรูปคำตามจำนวน เช่นภาษาอังกฤษ)
export type Template = string | ((p: Record<string, string>) => string);
export type Dict = Record<MsgKey, Template>;

export const msg = (key: MsgKey, params?: Params): Msg => (params ? { key, params } : { key });
