import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cards } from "../data/cards";
import { cardToYaml } from "./cardYaml";

describe("cardToYaml", () => {
  it.each(cards.map((c) => [c.name, c] as const))("%s: เขียนข้อมูลเดิมกลับแล้วไฟล์ไม่เปลี่ยน", (_, c) => {
    const src = readFileSync(c.source, "utf8").replace(/\r\n/g, "\n");
    expect(cardToYaml(src, c)).toBe(src);
  });
});
