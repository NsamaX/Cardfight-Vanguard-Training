import { cardByKey as db } from "../../data/cards";
import { countCards, validateDeck } from "../../data/decks";
import type { Deck } from "../../engine/types";
import { useT } from "../../i18n/react";
import { G_ZONE_SIZE, MAIN_SIZE, displayInstance } from "../../lib/deckEdit";
import { CardView } from "../CardView";

const byGradeThenName = (a: string, b: string) => db[a].grade - db[b].grade || db[a].name.localeCompare(db[b].name, "en");

// ดูการ์ดในเด็ค: Back กลับรายการ / Delete หรือ Reset (เด็คตัวอย่างที่ถูกแก้) / Edit เข้าหน้าแก้เด็ค / Use ใช้เด็คนี้กับฝั่งนี้ (เด็คที่ผิดกฎใช้ไม่ได้)
export function DeckView({ deck, current, onBack, onEdit, onUse, removeLabel, onRemove }: {
  deck: Deck;
  current: boolean;
  onBack: () => void;
  onEdit: () => void;
  onUse: () => void;
  removeLabel?: string;
  onRemove: () => void;
}) {
  const errors = validateDeck(deck);
  const t = useT();
  const cards = (zone: Record<string, number>) => Object.keys(zone).sort(byGradeThenName).map((k) => (
    <div key={k} className="collect">
      <CardView inst={displayInstance(k)} mark />
      <span className="copies">x{zone[k]}{deck.starter === k ? " ★" : ""}</span>
    </div>
  ));

  return (
    <div className="deck-view">
      <div className="collection-bar">
        <span className="deck-view-name">{deck.name}</span>
        <span className="mono">{countCards(deck.main)}/{MAIN_SIZE} · G {countCards(deck.g_zone)}/{G_ZONE_SIZE}</span>
        {errors[0] && <span className="err">{t(errors[0])}</span>}
        <div className="deck-actions">
          <button className="btn" onClick={onBack}>{t("deck.back")}</button>
          {removeLabel && <button className="btn" onClick={onRemove}>{removeLabel}</button>}
          <button className="btn" onClick={onEdit}>{t("deck.edit")}</button>
          <button className="btn primary" disabled={current || errors.length > 0} onClick={onUse}>{t(current ? "deck.inUse" : "deck.use")}</button>
        </div>
      </div>
      <div className="collection">
        {cards(deck.main)}
        {Object.keys(deck.g_zone).length > 0 && <div className="deck-sep deck-view-sep">{t("deck.gZone")}</div>}
        {cards(deck.g_zone)}
      </div>
    </div>
  );
}
