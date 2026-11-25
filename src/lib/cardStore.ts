// การ์ดที่ผู้เล่นสร้างเก็บในเบราว์เซอร์ รวมรูปเป็น data URL (อ่าน/เขียนไม่ได้ก็ใช้ต่อในรอบนี้ แต่ไม่ถูกจำ)
import type { Card } from "../engine/types";

const KEY = "vanguard.userCards";
export const USER_SOURCE = "user";

export function loadUserCards(): Card[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Card[];
  } catch {
    return [];
  }
}

// คืน false เมื่อเก็บไม่ได้ (เช่น พื้นที่เต็มเพราะรูป)
export function saveUserCard(card: Card): boolean {
  const all = loadUserCards().filter((c) => c.key !== card.key);
  try {
    localStorage.setItem(KEY, JSON.stringify([...all, card]));
    return true;
  } catch {
    return false;
  }
}
