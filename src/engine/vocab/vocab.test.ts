import { describe, expect, it } from "vitest";
import { cards } from "../../data/cards";
import { createGame } from "../game";
import { presetDecks } from "../../data/decks";
import { cardByKey as db } from "../../data/cards";
import { checkTerm } from "./conditions";
import { amount, range } from "./counters";
import { cardMatches } from "./filters";
import { validateCard } from "./index";
import { vocabularyMarkdown, withGenerated } from "./doc";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card texts the engine doesn't run yet. A new entry here means a card needs a new code in the vocabulary.
const KNOWN_GAPS = [
  "Air Element, Sebreeze #2 ACT: unknown condition opp-no-ride-last-turn",
  "Air Element, Sebreeze #2 ACT: unknown code stride-from-G in stride-from-G(self)",
  "Light Elemental, Honoly #2 CONT: unknown condition attack-count≥5",
  "Light Elemental, Honoly #2 CONT: unknown code attack-tax in attack-tax(CB(1), RC)",
  "Zeroth Dragon of Distant Sea, Megiddo #1 ULTIMATE STRIDE: ULTIMATE STRIDE is not supported",
  "Zeroth Dragon of Distant Sea, Megiddo #1 ULTIMATE STRIDE: unknown filter same-name-as-VC in discard(1, filter=same-name-as-VC)",
  "Zeroth Dragon of Distant Sea, Megiddo #1 ULTIMATE STRIDE: unknown code remove-G-zone in remove-G-zone(own, at=return-to-G)",
];

describe("vocabulary", () => {
  it("every card's ability codes are known, except the listed gaps", () => {
    expect(cards.flatMap(validateCard).sort()).toEqual([...KNOWN_GAPS].sort());
  });

  it("reports unknown codes, filters, conditions, targets, and amounts", () => {
    const card = { ...cards[0], name: "Test", abilities: [
      { kind: "AUTO" as const, timing: "when-moon-rises(self)", cond: ["full-moon"], effect: ["fly(1)", "power(+1000, everyone)", "draw(1, if=lucky≥1)", "to-soul(drop, n≤mystery, filter=shiny)"] },
    ] };
    expect(validateCard(card)).toEqual([
      "Test #1 AUTO: unknown timing when-moon-rises(self)",
      "Test #1 AUTO: unknown condition full-moon",
      "Test #1 AUTO: unknown code fly in fly(1)",
      "Test #1 AUTO: unknown target everyone in power(+1000, everyone)",
      "Test #1 AUTO: unknown condition lucky≥1 in draw(1, if=lucky≥1)",
      "Test #1 AUTO: unknown filter shiny in to-soul(drop, n≤mystery, filter=shiny)",
      "Test #1 AUTO: unknown amount n≤mystery in to-soul(drop, n≤mystery, filter=shiny)",
    ]);
  });

  it("counters, amounts, and conditions read the board", () => {
    const s = createGame(db, { seed: 1, firstPlayer: "me", decks: { me: presetDecks[0], bot: presetDecks[0] } });
    const sc = { db, s, owner: "me" as const };
    s.players.me.drop = s.players.me.deck.splice(0, 5);
    expect(amount(sc, "drop")).toBe(5);
    expect(amount(sc, "2 drop")).toBe(2);
    expect(amount(sc, "drop+1")).toBe(6);
    expect(range(sc, "n≤drop", "n≤1")).toEqual({ min: 0, max: 5 });
    expect(range(sc, "n=2..3", "n≤1")).toEqual({ min: 2, max: 3 });
    expect(checkTerm(sc, "drop-count≤5", "resolve")).toBe(true);
    expect(checkTerm(sc, "drop≥6", "resolve")).toBe(false);
    expect(checkTerm(sc, "no-such-thing", "resolve")).toBe(false);   // unknown conditions never hold
  });

  it("filters combine with &, and a capitalized word is a clan", () => {
    const angelica = db["G-BT14/020TH"];
    const env = { db };
    expect(cardMatches(angelica, 'grade-3 & name("Regalia")', env)).toBe(true);
    expect(cardMatches(angelica, "normal-unit & Genesis", env)).toBe(true);
    expect(cardMatches(angelica, "Granblue", env)).toBe(false);
    expect(cardMatches(angelica, "unknown-thing", env)).toBe(false);
  });
});

describe("documents/vocabulary.md", () => {
  it("its code reference matches the registry (run npm run vocab-doc after changing a code)", () => {
    const file = join(process.cwd(), "documents/vocabulary.md");
    const doc = readFileSync(file, "utf8");
    expect(withGenerated(doc, vocabularyMarkdown(cards))).toBe(doc);
  });
});
