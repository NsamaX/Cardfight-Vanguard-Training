import type { Card } from "../engine/types";
import { toCard, type CardFile } from "./cardFile";
import content from "./content.json";

export { cardKey } from "./cardFile";

// Nation of each clan (content/nations.yaml); a clan field that is itself a nation name (Megiddo: Magallanica) is that nation
const NATIONS = content.nations as Record<string, string[]>;
const nationOfClan: Record<string, string> = Object.fromEntries(Object.entries(NATIONS).flatMap(([n, clans]) => clans.map((c) => [c, n])));
export function withNation(c: Card): Card {
  if (c.abilities.some((a) => a.effect.includes("all-clan(self)"))) return { ...c, nation: "all" };
  const nation = nationOfClan[c.clan] ?? (NATIONS[c.clan] ? c.clan : undefined);
  return nation ? { ...c, nation } : c;
}

// Starts with the bundled content/cards/*/*/*.yaml set (used by tests and when Supabase is not configured).
// The app replaces it with the library loaded from Supabase (src/lib/library.ts) via setCards.
export const cards: Card[] = (content.cards as unknown as CardFile[]).map((f) => withNation(toCard(f)));

export const cardByKey: Record<string, Card> = Object.fromEntries(cards.map((c) => [c.key, c]));

export function putCard(card: Card) {
  const c = withNation(card);
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
