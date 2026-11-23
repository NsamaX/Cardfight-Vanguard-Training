// แก้ไขเด็คในหน้าสร้างเด็ค (ฟังก์ชันล้วน คืนเด็คใหม่ทุกครั้ง)
import { cardByKey } from "../data/cards";
import { countCards } from "../data/decks";
import { isG } from "../engine/rules";
import type { CardInstance, Deck } from "../engine/types";

export const MAX_COPIES = 4;
export const MAIN_SIZE = 50;
export const G_ZONE_SIZE = 16;

export const zoneOf = (key: string): "main" | "g_zone" => (isG(cardByKey[key]) ? "g_zone" : "main");
export const copiesIn = (deck: Deck, key: string) => deck[zoneOf(key)][key] ?? 0;

export function newDeck(name: string): Deck {
  return { id: `user-${Date.now()}`, name, format: "G", starter: "", main: {}, g_zone: {} };
}

// แวนการ์ดเริ่มต้น: ใช้ใบเดิมถ้ายังอยู่ในเด็ค ไม่งั้นเลือกเกรด 0 ที่ไม่ใช่ทริกเกอร์ใบแรก
function withStarter(deck: Deck): Deck {
  if (deck.main[deck.starter] && cardByKey[deck.starter].grade === 0) return deck;
  const grade0 = Object.keys(deck.main).filter((k) => cardByKey[k].grade === 0);
  const starter = grade0.find((k) => cardByKey[k].type !== "trigger") ?? grade0[0] ?? "";
  return { ...deck, starter };
}

export function addCard(deck: Deck, key: string): Deck {
  const zone = zoneOf(key);
  const limit = zone === "main" ? MAIN_SIZE : G_ZONE_SIZE;
  if (copiesIn(deck, key) >= MAX_COPIES || countCards(deck[zone]) >= limit) return deck;
  return withStarter({ ...deck, [zone]: { ...deck[zone], [key]: copiesIn(deck, key) + 1 } });
}

export function removeCard(deck: Deck, key: string): Deck {
  const zone = zoneOf(key);
  const { [key]: n = 0, ...rest } = deck[zone];
  return withStarter({ ...deck, [zone]: n > 1 ? { ...rest, [key]: n - 1 } : rest });
}

export const setStarter = (deck: Deck, key: string): Deck => ({ ...deck, starter: key });

// การ์ดที่ไม่ได้อยู่ในเกม ใช้แสดงผลด้วย CardView
export const displayInstance = (key: string): CardInstance =>
  ({ uid: key, key, rested: false, faceUp: true, hollowed: false, mods: [], usedThisTurn: [] });

// รูปประจำเด็ค: การ์ดที่เลือกไว้ (ถ้ายังอยู่ในเด็ค) ไม่งั้น G ยูนิทใบแรก ไม่มีก็ใช้การ์ดเกรดสูงสุดในเมนเด็ค
export function coverCard(deck: Deck): string | undefined {
  if (deck.cover && (deck.main[deck.cover] || deck.g_zone[deck.cover])) return deck.cover;
  return Object.keys(deck.g_zone)[0] ?? Object.keys(deck.main).sort((a, b) => cardByKey[b].grade - cardByKey[a].grade)[0];
}
