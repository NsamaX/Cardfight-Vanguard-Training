// Deck editing in the deck builder (pure functions, always return a new deck)
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
  return { id: crypto.randomUUID(), name, format: "G", starter: "", main: {}, g_zone: {} };
}

export const duplicateDeck = (deck: Deck, name: string): Deck =>
  ({ ...deck, id: crypto.randomUUID(), name, main: { ...deck.main }, g_zone: { ...deck.g_zone } });

// Starting vanguard: keep the current one if it's still in the deck, otherwise the first non-trigger grade 0
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

// Sort deck cards by grade (0 → 3), then by name
export const byGradeThenName = (a: string, b: string) => cardByKey[a].grade - cardByKey[b].grade || cardByKey[a].name.localeCompare(cardByKey[b].name, "en");

// Move G card from to the position of to (the g_zone order is the display order both in game and on the deck screen)
export function moveG(deck: Deck, from: string, to: string): Deck {
  const keys = Object.keys(deck.g_zone);
  const at = keys.indexOf(to);
  if (from === to || at < 0 || !keys.includes(from)) return deck;
  const next = keys.filter((k) => k !== from);
  next.splice(at, 0, from);
  return { ...deck, g_zone: Object.fromEntries(next.map((k) => [k, deck.g_zone[k]])) };
}

export const setStarter = (deck: Deck, key: string): Deck => ({ ...deck, starter: key });

// A card not in a game, for display with CardView
export const displayInstance = (key: string): CardInstance =>
  ({ uid: key, key, rested: false, faceUp: true, hollowed: false, mods: [], usedThisTurn: [] });

// Deck image: the chosen card (if still in the deck), otherwise the first G unit, otherwise the highest-grade main deck card
export function coverCard(deck: Deck): string | undefined {
  if (deck.cover && (deck.main[deck.cover] || deck.g_zone[deck.cover])) return deck.cover;
  return Object.keys(deck.g_zone)[0] ?? Object.keys(deck.main).sort((a, b) => cardByKey[b].grade - cardByKey[a].grade)[0];
}
