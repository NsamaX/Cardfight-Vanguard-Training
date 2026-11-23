// เด็คที่ผู้เล่นสร้างเก็บในเบราว์เซอร์ (อ่าน/เขียนไม่ได้ เช่น โหมดส่วนตัว ก็ใช้งานต่อได้แต่ไม่ถูกจำ)
import type { Deck } from "../engine/types";

const KEY = "vanguard.userDecks";

export function loadUserDecks(): Deck[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Deck[];
  } catch {
    return [];
  }
}

export function saveUserDecks(decks: Deck[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
  } catch {
    // เก็บไม่ได้ก็ใช้ต่อในรอบนี้
  }
}
