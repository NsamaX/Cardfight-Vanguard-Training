import { describe, expect, it } from "vitest";
import { cards } from "../data/cards";
import { parseBlocks } from "./skillBlocks";

describe("skill blocks", () => {
  it.each(cards.map((c) => [c.name, c] as const))("%s: ข้อความแบ่งเป็นกล่องครบ และจับคู่ abilities ได้ทุกอัน", (_, c) => {
    const blocks = parseBlocks(c.text, c.abilities);
    expect(blocks.length).toBe(c.abilities.length);
    expect(new Set(blocks.map((b) => b.ability)).size).toBe(c.abilities.length);
    expect(blocks.every((b) => b.ability)).toBe(true);
  });
});
