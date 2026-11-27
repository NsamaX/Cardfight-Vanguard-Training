import { describe, expect, it } from "vitest";
import { presetDecks } from "../data/decks";
import { cardByKey as db } from "../data/cards";
import { isSentinel } from "../engine/rules";
import { addCard, moveG, newDeck, removeCard } from "./deckEdit";

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;

describe("moveG", () => {
  const keys = Object.keys(deck.g_zone);

  it("dragging forward: the card takes the position of the card it's dropped on, the others shift back", () => {
    const d = moveG(deck, keys.at(-1)!, keys[0]);
    expect(Object.keys(d.g_zone)).toEqual([keys.at(-1), ...keys.slice(0, -1)]);
    expect(d.g_zone).toEqual(deck.g_zone);
  });

  it("dragging backward: the card takes the position of the card it's dropped on", () => {
    const d = moveG(deck, keys[0], keys[1]);
    expect(Object.keys(d.g_zone)).toEqual([keys[1], keys[0], ...keys.slice(2)]);
  });

  it("dropping onto itself changes nothing", () => {
    expect(moveG(deck, keys[0], keys[0])).toBe(deck);
  });
});

describe("addCard / removeCard: starting vanguard and cover", () => {
  const g0 = Object.keys(deck.main).filter((k) => db[k].grade === 0);
  const g3 = Object.keys(deck.main).find((k) => db[k].grade === 3)!;

  it("the first grade 0 added is the starting vanguard, the first card added is the cover", () => {
    let d = addCard(newDeck("t"), g3);
    expect(d).toMatchObject({ starter: "", cover: g3 });
    d = addCard(addCard(d, g0[0]), g0[1]);
    expect(d).toMatchObject({ starter: g0[0], cover: g3 });
  });

  it("removing the last copy leaves the spot empty until the next card is added", () => {
    let d = addCard(addCard(addCard(newDeck("t"), g0[0]), g0[1]), g3);
    d = removeCard(d, g0[0]);
    expect(d).toMatchObject({ starter: "", cover: "" });
    d = addCard(d, g3);
    expect(d).toMatchObject({ starter: "", cover: g3 });
    d = addCard(d, g0[1]);
    expect(d.starter).toBe(g0[1]);
  });
});

describe("addCard: sentinels", () => {
  it("stops at 4 sentinels in total, even across different cards", () => {
    const sentinels = Object.keys(db).filter((k) => isSentinel(db[k]));
    expect(sentinels.length).toBeGreaterThanOrEqual(2);
    let d = newDeck("t");
    for (let i = 0; i < 4; i++) d = addCard(d, sentinels[0]);
    expect(addCard(d, sentinels[1])).toBe(d);
  });
});

describe("addCard: trigger and Heal caps", () => {
  const all = Object.keys(db).filter((k) => !db[k].type.startsWith("g-"));
  const heals = all.filter((k) => db[k].trigger === "heal");
  const others = all.filter((k) => db[k].type === "trigger" && db[k].trigger !== "heal");

  it("stops at 4 Heals in total", () => {
    let d = newDeck("t");
    for (const k of heals) for (let i = 0; i < 4; i++) d = addCard(d, k);
    expect(Object.values(d.main).reduce((a, b) => a + b, 0)).toBe(Math.min(4, heals.length * 4));
  });

  it("stops at 16 triggers in total", () => {
    let d = newDeck("t");
    for (const k of [...others, ...heals]) for (let i = 0; i < 4; i++) d = addCard(d, k);
    expect(Object.values(d.main).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(16);
  });
});
