import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Sleeve } from "../../data/sleeves";
import type { Card, Deck, PlayerId } from "../../engine/types";
import type { MsgKey } from "../../i18n/msg";
import { useT } from "../../i18n/react";
import { duplicateDeck, newDeck } from "../../lib/deckEdit";
import { DeckBuilder } from "./DeckBuilder";
import { DeckList } from "./DeckList";
import { DeckView } from "./DeckView";

// Replaces each side's half of the board when Decks is open: deck list, deck view, or the deck create/edit screen
// Guests (editable = false) can only view and use decks
export function DeckPanel({ p, current, decks, editable, sleeves, onAddSleeve, onDeleteSleeve, onSaveDeck, onSaveCard, onDeleteDeck, onPick, otherEditing, onEditingChange }: {
  p: PlayerId;
  current: Deck;
  decks: Deck[];                     // shared by both sides
  editable: boolean;
  sleeves: Sleeve[];
  onAddSleeve: (name: string, image: string) => Promise<void>;
  onDeleteSleeve: (path: string) => Promise<void>;
  onSaveDeck: (d: Deck) => void;
  onSaveCard: (c: Card) => Promise<MsgKey | null>;
  onDeleteDeck: (id: string) => void;
  onPick: (d: Deck) => void;
  otherEditing: boolean;             // the other side is editing a deck, can't expand to the full board
  onEditingChange: (on: boolean) => void;
}) {
  const [editing, setEditing] = useState<Deck | null>(null);
  const [viewing, setViewing] = useState<Deck | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const anim = useRef<Animation | null>(null);
  const t = useT();

  const isEditing = !!editing;
  useEffect(() => {
    onEditingChange(isEditing);
    if (!isEditing) setExpanded(false);
    return () => onEditingChange(false);
  }, [isEditing]);

  // When expanding, the panel covers the whole board, then slides the edge next to the board center (margin) from the old half-board position, so the window size really changes frame by frame
  const edge = p === "me" ? "marginTop" : "marginBottom";
  function halfEdge(el: HTMLElement) {
    const full = el.getBoundingClientRect();
    el.classList.remove("expanded");
    const half = el.getBoundingClientRect();
    el.classList.add("expanded");
    return { [edge]: `${p === "me" ? half.top - full.top : full.bottom - half.bottom}px` };
  }

  const slide = { duration: 250, easing: "cubic-bezier(.2, 0, 0, 1)" };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!expanded || !el || anim.current) return;
    anim.current = el.animate([halfEdge(el), { [edge]: "0px" }], slide);
    anim.current.onfinish = () => { anim.current = null; };
  }, [expanded]);

  function toggleExpand() {
    const el = ref.current;
    if (!el || anim.current) return;
    if (!expanded) return setExpanded(true);
    anim.current = el.animate([{ [edge]: "0px" }, halfEdge(el)], { ...slide, fill: "forwards" });
    anim.current.onfinish = () => {
      flushSync(() => setExpanded(false));
      anim.current?.cancel();
      anim.current = null;
    };
  }
  function save(d: Deck) {
    onSaveDeck(d);
    setEditing(null);
    if (viewing) setViewing(d);
  }

  function remove(d: Deck) {
    if (!confirm(t("deck.confirmDelete", { name: d.name }))) return;
    onDeleteDeck(d.id);
    setViewing(null);
  }

  return (
    <section ref={ref} className={`deck-panel ${p} ${editing && expanded ? "expanded" : ""}`}>
      {editing
        ? <DeckBuilder p={p} initial={editing} onDone={save} onCancel={() => setEditing(null)}
            onDelete={decks.length > 1 && decks.some((d) => d.id === editing.id) ? () => { onDeleteDeck(editing.id); setEditing(null); setViewing(null); } : undefined} onSaveCard={onSaveCard} sleeves={sleeves} onAddSleeve={onAddSleeve} onDeleteSleeve={onDeleteSleeve}
            expanded={expanded} canExpand={!otherEditing} onToggleExpand={toggleExpand} />
        : viewing
          ? <DeckView deck={viewing} current={viewing.id === current.id} onBack={() => setViewing(null)}
              onEdit={editable ? () => setEditing(viewing) : undefined} onUse={() => onPick(viewing)}
              removeLabel={editable && decks.length > 1 ? t("deck.delete") : undefined} onRemove={() => remove(viewing)} />
          : <DeckList decks={decks} currentId={current.id} onOpen={setViewing} onUse={onPick}
              onEdit={editable ? setEditing : undefined}
              onDuplicate={editable ? (d) => onSaveDeck(duplicateDeck(d, t("deck.copyName", { name: d.name }))) : undefined}
              onNew={editable ? () => setEditing(newDeck(t("deck.newName"))) : undefined} />}
    </section>
  );
}
