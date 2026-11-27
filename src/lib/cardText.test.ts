import { describe, expect, it } from "vitest";
import { cards } from "../data/cards";
import { fromPlainText, toPlainText } from "./cardText";

describe("card text: markdown <-> plain", () => {
  it("every library card's text survives the round trip unchanged", () => {
    for (const c of cards) expect(fromPlainText(toPlainText(c.text)).trim(), c.key).toBe(c.text.trim());
  });

  it("plain text has no markdown marks", () => {
    for (const c of cards) expect(toPlainText(c.text), c.key).not.toMatch(/###|\*\*|^\s*- /m);
  });

  it("free text without ability headings is kept as it is", () => {
    expect(toPlainText("Just some text")).toBe("Just some text");
    expect(fromPlainText("Just some text")).toBe("Just some text");
  });

  it("a label after an Effect starts the next ability", () => {
    const md = fromPlainText("AUTO\nTiming: A\nEffect: B\nTiming: C\nEffect: D");
    expect(md).toBe("### AUTO\n\n- **Timing:** A\n  - **Effect:** B\n- **Timing:** C\n  - **Effect:** D");
  });
});
