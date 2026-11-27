// Deck editing in the deck builder (pure functions, always return a new deck)
import { cardByKey } from "../data/cards";
import { countCards } from "../data/decks";
import { isG, isSentinel } from "../engine/rules";
import type { Card, CardInstance, Deck } from "../engine/types";

export const MAX_COPIES = 4;
export const MAIN_SIZE = 50;
export const G_ZONE_SIZE = 16;
export const MAX_TRIGGERS = 16;
export const MAX_HEALS = 4;
export const MAX_SENTINELS = 4;

export const zoneOf = (key: string): "main" | "g_zone" => (isG(cardByKey[key]) ? "g_zone" : "main");
export const copiesIn = (deck: Deck, key: string) => deck[zoneOf(key)][key] ?? 0;
const countIn = (deck: Deck, is: (c: Card) => boolean) => Object.entries(deck.main).reduce((n, [k, v]) => n + (is(cardByKey[k]) ? v : 0), 0);
const isTrigger = (c: Card) => c.type === "trigger";
const isHeal = (c: Card) => c.trigger === "heal";

// Room for one more copy: copies per card, deck size, and the trigger / Heal / Sentinel caps
export function canAdd(deck: Deck, key: string): boolean {
  const zone = zoneOf(key);
  const card = cardByKey[key];
  if (copiesIn(deck, key) >= MAX_COPIES || countCards(deck[zone]) >= (zone === "main" ? MAIN_SIZE : G_ZONE_SIZE)) return false;
  if (isTrigger(card) && countIn(deck, isTrigger) >= MAX_TRIGGERS) return false;
  if (isHeal(card) && countIn(deck, isHeal) >= MAX_HEALS) return false;
  return !(isSentinel(card) && countIn(deck, isSentinel) >= MAX_SENTINELS);
}

export function newDeck(name: string): Deck {
  return { id: crypto.randomUUID(), name, format: "G", starter: "", main: {}, g_zone: {} };
}

export const duplicateDeck = (deck: Deck, name: string): Deck =>
  ({ ...deck, id: crypto.randomUUID(), name, main: { ...deck.main }, g_zone: { ...deck.g_zone } });

const inDeck = (deck: Deck, key?: string) => !!key && !!(deck.main[key] || deck.g_zone[key]);

// Adding a card: the first grade 0 added becomes the starting vanguard and the first card added becomes the cover,
// each only while that spot is empty
export function addCard(deck: Deck, key: string): Deck {
  if (!canAdd(deck, key)) return deck;
  const zone = zoneOf(key);
  const next = { ...deck, [zone]: { ...deck[zone], [key]: copiesIn(deck, key) + 1 } };
  if (!inDeck(deck, deck.starter) && zone === "main" && cardByKey[key].grade === 0) next.starter = key;
  if (!inDeck(deck, deck.cover)) next.cover = key;
  return next;
}

// Removing the last copy of the starting vanguard or the cover leaves that spot empty until the next card fills it
export function removeCard(deck: Deck, key: string): Deck {
  const zone = zoneOf(key);
  const { [key]: n = 0, ...rest } = deck[zone];
  const next = { ...deck, [zone]: n > 1 ? { ...rest, [key]: n - 1 } : rest };
  if (!inDeck(next, next.starter)) next.starter = "";
  if (!inDeck(next, next.cover)) next.cover = "";
  return next;
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

// Deck image: the cover card (if still in the deck); "" = emptied in the deck builder, no image;
// unset (decks made before covers were tracked) = the first G unit, otherwise the highest-grade main deck card
export function coverCard(deck: Deck): string | undefined {
  if (inDeck(deck, deck.cover)) return deck.cover;
  if (deck.cover === "") return undefined;
  return Object.keys(deck.g_zone)[0] ?? Object.keys(deck.main).sort((a, b) => cardByKey[b].grade - cardByKey[a].grade)[0];
}
