import type { Card } from "../engine/types";
import { toCard, type CardFile } from "./cardFile";
import content from "./content.json";

export { cardKey } from "./cardFile";

// Starts with the bundled content/cards/*/*/*.yaml set (used by tests and when Supabase is not configured).
// The app replaces it with the library loaded from Supabase (src/lib/library.ts) via setCards.
export const cards: Card[] = (content.cards as unknown as CardFile[]).map(toCard);

export const cardByKey: Record<string, Card> = Object.fromEntries(cards.map((c) => [c.key, c]));

export function putCard(c: Card) {
  const i = cards.findIndex((x) => x.key === c.key);
  if (i >= 0) cards[i] = c;
  else cards.push(c);
  cardByKey[c.key] = c;
}

export function setCards(list: Card[]) {
  cards.length = 0;
  for (const k of Object.keys(cardByKey)) delete cardByKey[k];
  list.forEach(putCard);
}
