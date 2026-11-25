import { describe, expect, it } from "vitest";
import { presetDecks } from "../data/decks";
import { moveG } from "./deckEdit";

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;

describe("moveG", () => {
  const keys = Object.keys(deck.g_zone);

  it("ลากไปข้างหน้า: การ์ดไปอยู่ตำแหน่งของใบที่วางทับ ใบอื่นเลื่อนถอยไป", () => {
    const d = moveG(deck, keys.at(-1)!, keys[0]);
    expect(Object.keys(d.g_zone)).toEqual([keys.at(-1), ...keys.slice(0, -1)]);
    expect(d.g_zone).toEqual(deck.g_zone);
  });

  it("ลากไปข้างหลัง: การ์ดไปอยู่ตำแหน่งของใบที่วางทับ", () => {
    const d = moveG(deck, keys[0], keys[1]);
    expect(Object.keys(d.g_zone)).toEqual([keys[1], keys[0], ...keys.slice(2)]);
  });

  it("วางทับตัวเองไม่เปลี่ยนอะไร", () => {
    expect(moveG(deck, keys[0], keys[0])).toBe(deck);
  });
});
