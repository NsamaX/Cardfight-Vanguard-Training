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

// Clans to pick from in the card editor: every clan in content/nations.yaml and in the library
export function clanNames(): string[] {
  const all = new Set([...Object.values(NATIONS).flat(), ...cards.map((c) => c.clan)]);
  all.delete("");
  return [...all].sort();
}

// A card fits a clan's deck: same clan, Cray Elemental (all clans), or a card whose clan field is that clan's nation
export const fitsClan = (c: Card, clan: string) => c.clan === clan || c.nation === "all" || (!!NATIONS[c.clan] && nationOfClan[clan] === c.clan);

export function setCards(list: Card[]) {
  cards.length = 0;
  for (const k of Object.keys(cardByKey)) delete cardByKey[k];
  list.forEach(putCard);
}
