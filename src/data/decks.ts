import { isSentinel } from "../engine/rules";
import type { Deck, PlayerId } from "../engine/types";
import { msg, type Msg } from "../i18n/msg";
import { cardByKey } from "./cards";
import content from "./content.json";

// Sample decks from content/decks/*.yaml (default set; the app loads players' decks from Supabase)
export const presetDecks = content.decks as unknown as Deck[];

// The bot's starting deck: the default set's file id, or the name a signed-in player's copy keeps (their copy gets a new id)
export const BOT_DECK = { id: "regalia-minerva", name: "Genesis Regalia" };

// Decks on the board when the library loads: the bot gets BOT_DECK, we get the first other deck (either falls back to the first deck)
export function startingDecks(decks: Deck[]): Record<PlayerId, Deck> {
  const bot = decks.find((d) => d.id === BOT_DECK.id || d.name === BOT_DECK.name) ?? decks[0];
  return { me: decks.find((d) => d !== bot) ?? bot, bot };
}

export const countCards = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

// G-era deck building rules per documents/rules-g.md; returns a list of errors (empty = legal)
export function validateDeck(deck: Deck): Msg[] {
  const errors: Msg[] = [];
  const total = countCards;
  const sumWhere = (r: Record<string, number>, ok: (key: string) => boolean) =>
    Object.entries(r).reduce((n, [k, v]) => n + (ok(k) ? v : 0), 0);
  const card = (k: string) => cardByKey[k];

  for (const k of [...Object.keys(deck.main), ...Object.keys(deck.g_zone)]) {
    if (!card(k)) errors.push(msg("deck.err.unknownCard", { key: k }));
  }
  if (errors.length) return errors;

  if (total(deck.main) !== 50) errors.push(msg("deck.err.mainSize"));
  const triggers = sumWhere(deck.main, (k) => card(k).type === "trigger");
  if (triggers > 16) errors.push(msg("deck.err.triggers"));
  const heals = sumWhere(deck.main, (k) => card(k).trigger === "heal");
  if (heals > 4) errors.push(msg("deck.err.heals"));
  const sentinels = sumWhere(deck.main, (k) => isSentinel(card(k)));
  if (sentinels > 4) errors.push(msg("deck.err.sentinels"));
  // Cards with the same name count together even with different codes (reprints in different sets)
  const overCopies = (r: Record<string, number>) => {
    const byName = new Map<string, number>();
    for (const [k, n] of Object.entries(r)) byName.set(card(k).name, (byName.get(card(k).name) ?? 0) + n);
    for (const [name, n] of byName) if (n > 4) errors.push(msg("deck.err.copies", { card: name }));
  };
  overCopies(deck.main);
  for (const k of Object.keys(deck.main)) {
    if (card(k).type.startsWith("g-")) errors.push(msg("deck.err.gInMain", { card: card(k).name }));
  }
  if (!deck.main[deck.starter] || card(deck.starter).grade !== 0) errors.push(msg("deck.err.starter"));

  if (total(deck.g_zone) > 16) errors.push(msg("deck.err.gZoneSize"));
  overCopies(deck.g_zone);
  for (const k of Object.keys(deck.g_zone)) {
    if (!card(k).type.startsWith("g-")) errors.push(msg("deck.err.notGInGZone", { card: card(k).name }));
  }
  return errors;
}
