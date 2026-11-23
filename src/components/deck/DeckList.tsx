import { cardByKey as db } from "../../data/cards";
import { countCards, validateDeck } from "../../data/decks";
import type { Deck } from "../../engine/types";
import { useT } from "../../i18n/react";
import { coverCard } from "../../lib/deckEdit";

// รายการเด็คทั้งหมด: คลิกเพื่อดูการ์ดในเด็ค / Edit / New Deck
export function DeckList({ decks, currentId, onOpen, onEdit, onUse, onNew }: {
  decks: Deck[];
  currentId: string;
  onOpen: (d: Deck) => void;
  onEdit: (d: Deck) => void;
  onUse: (d: Deck) => void;
  onNew: () => void;
}) {
  const t = useT();
  return (
    <div className="deck-list">
      {decks.map((d) => {
        const errors = validateDeck(d);
        const cover = coverCard(d);
        return (
          <div key={d.id} className={`deck-tile ${d.id === currentId ? "on" : ""} ${errors.length ? "bad" : ""}`}
            title={errors.map((e) => t(e)).join("\n")} onClick={() => onOpen(d)}>
            {cover && db[cover].image && <img src={db[cover].image} alt="" />}
            <span className="deck-name">{d.name}</span>
            <span className="deck-count">{countCards(d.main)}/50 · G {countCards(d.g_zone)}/16{errors.length ? t("deck.invalid") : ""}</span>
            <div className="deck-btns">
              <button className="btn" disabled={d.id === currentId || errors.length > 0} onClick={(e) => { e.stopPropagation(); onUse(d); }}>{t("deck.use")}</button>
              <button className="btn" onClick={(e) => { e.stopPropagation(); onEdit(d); }}>{t("deck.edit")}</button>
            </div>
          </div>
        );
      })}
      <button className="deck-tile new" onClick={onNew}>{t("deck.new")}</button>
    </div>
  );
}
