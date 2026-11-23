import { isSentinel } from "../engine/rules";
import type { Deck } from "../engine/types";
import { msg, type Msg } from "../i18n/msg";
import { cardByKey } from "./cards";
import content from "./content.json";

// เด็คสำเร็จรูปจาก content/decks/*.yaml (เด็คที่ผู้เล่นสร้างในโปรแกรมจะเก็บใน localStorage และ export เป็น .yaml ได้)
export const presetDecks = content.decks as Deck[];

export const countCards = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

// กฎจัดเด็คภาค G ตาม documents/rules-g.md คืนรายการข้อผิดพลาด (ว่าง = ใช้ได้)
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

  if (total(deck.main) !== 50) errors.push(msg("deck.err.mainSize", { n: total(deck.main) }));
  const triggers = sumWhere(deck.main, (k) => card(k).type === "trigger");
  if (triggers !== 16) errors.push(msg("deck.err.triggers", { n: triggers }));
  const heals = sumWhere(deck.main, (k) => card(k).trigger === "heal");
  if (heals > 4) errors.push(msg("deck.err.heals", { n: heals }));
  const sentinels = sumWhere(deck.main, (k) => isSentinel(card(k)));
  if (sentinels > 4) errors.push(msg("deck.err.sentinels", { n: sentinels }));
  for (const [k, n] of Object.entries(deck.main)) {
    if (n > 4) errors.push(msg("deck.err.copies", { card: card(k).name }));
    if (card(k).type.startsWith("g-")) errors.push(msg("deck.err.gInMain", { card: card(k).name }));
  }
  if (!deck.main[deck.starter] || card(deck.starter).grade !== 0) errors.push(msg("deck.err.starter"));

  if (total(deck.g_zone) > 16) errors.push(msg("deck.err.gZoneSize", { n: total(deck.g_zone) }));
  for (const [k, n] of Object.entries(deck.g_zone)) {
    if (n > 4) errors.push(msg("deck.err.copies", { card: card(k).name }));
    if (!card(k).type.startsWith("g-")) errors.push(msg("deck.err.notGInGZone", { card: card(k).name }));
  }
  return errors;
}
