import { describe, expect, it } from "vitest";
import { presetDecks } from "../data/decks";
import { moveG } from "./deckEdit";

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
