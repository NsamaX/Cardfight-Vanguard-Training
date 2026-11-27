import { useContext } from "react";
import { countCards, validateDeck } from "../../data/decks";
import type { Deck } from "../../engine/types";
import { useT } from "../../i18n/react";
import { G_ZONE_SIZE, MAIN_SIZE, byGradeThenName, displayInstance } from "../../lib/deckEdit";
import { CardHover, CardView } from "../CardView";

// View the deck's cards: Back to the list / Delete / Edit opens the deck editor / Use this deck on this side (illegal decks can't be used)
export function DeckView({ deck, current, onBack, onEdit, onUse, removeLabel, onRemove }: {
  deck: Deck;
  current: boolean;
  onBack: () => void;
  onEdit?: () => void;
  onUse: () => void;
  removeLabel?: string;
  onRemove: () => void;
}) {
  const errors = validateDeck(deck);
  const t = useT();
  const show = useContext(CardHover);
  // The main deck is sorted by grade, the G zone keeps its dragged order
  const cards = (zone: Record<string, number>) => (zone === deck.main ? Object.keys(zone).sort(byGradeThenName) : Object.keys(zone)).map((k) => (
    <div key={k} className="collect">
      <CardView inst={displayInstance(k)} mark onClick={() => show?.(k)} />
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
          {onEdit && <button className="btn" onClick={onEdit}>{t("deck.edit")}</button>}
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
