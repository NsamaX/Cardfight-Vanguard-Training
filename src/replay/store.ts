// replay ที่บันทึกอัตโนมัติ เก็บในเบราว์เซอร์ (ใหม่สุดก่อน ไม่เกิน MAX เกม) อ่าน/เขียนไม่ได้ก็เล่นต่อได้แต่ไม่ถูกจำ
import type { Replay } from "./types";

const KEY = "vanguard.replays";
const MAX = 30;

export function loadReplays(): Replay[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Replay[];
  } catch {
    return [];
  }
}

function write(list: Replay[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // เต็มหรือเขียนไม่ได้: ลองตัดเกมเก่าครึ่งหนึ่งแล้วเขียนใหม่ครั้งเดียว
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.ceil(list.length / 2)))); } catch { /* ใช้ต่อโดยไม่จำ */ }
  }
}

export function saveReplay(r: Replay) {
  write([r, ...loadReplays().filter((x) => x.id !== r.id)].slice(0, MAX));
}

export function deleteReplay(id: string) {
  write(loadReplays().filter((x) => x.id !== id));
}
