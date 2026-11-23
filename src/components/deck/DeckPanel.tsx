import { useState } from "react";
import { presetDecks } from "../../data/decks";
import type { Deck, PlayerId } from "../../engine/types";
import { useT } from "../../i18n/react";
import { newDeck } from "../../lib/deckEdit";
import { DeckBuilder } from "./DeckBuilder";
import { DeckList } from "./DeckList";
import { DeckView } from "./DeckView";

// แทนที่ครึ่งสนามของแต่ละฝั่งเมื่อเปิด Decks: รายการเด็ค หน้าดูเด็ค หรือหน้าสร้าง/แก้เด็ค
// เด็คตัวอย่างที่ถูกแก้จะเก็บใน userDecks ด้วย id เดิมและแสดงแทนตัวต้นฉบับ
export function DeckPanel({ p, current, userDecks, onSaveDeck, onDeleteDeck, onPick }: {
  p: PlayerId;
  current: Deck;
  userDecks: Deck[];                 // เด็คที่ผู้เล่นสร้าง/แก้ ใช้ร่วมกันทั้งสองฝั่ง
  onSaveDeck: (d: Deck) => void;
  onDeleteDeck: (id: string) => void;
  onPick: (d: Deck) => void;
}) {
  const [editing, setEditing] = useState<Deck | null>(null);
  const [viewing, setViewing] = useState<Deck | null>(null);
  const t = useT();
  const preset = (id: string) => presetDecks.find((x) => x.id === id);
  const decks = [
    ...presetDecks.map((d) => userDecks.find((x) => x.id === d.id) ?? d),
    ...userDecks.filter((d) => !preset(d.id)),
  ];

  function save(d: Deck) {
    onSaveDeck(d);
    setEditing(null);
    if (viewing) setViewing(d);
  }

  function remove(d: Deck) {
    const original = preset(d.id);
    if (!confirm(original ? t("deck.confirmReset", { name: original.name }) : t("deck.confirmDelete", { name: d.name }))) return;
    onDeleteDeck(d.id);
    setViewing(original ?? null);
  }

  const edited = viewing && userDecks.some((x) => x.id === viewing.id);

  return (
    <section className={`deck-panel ${p}`}>
      {editing
        ? <DeckBuilder initial={editing} onDone={save} onCancel={() => setEditing(null)} />
        : viewing
          ? <DeckView deck={viewing} current={viewing.id === current.id} onBack={() => setViewing(null)}
              onEdit={() => setEditing(viewing)} onUse={() => onPick(viewing)}
              removeLabel={edited ? t(preset(viewing.id) ? "deck.reset" : "deck.delete") : undefined} onRemove={() => remove(viewing)} />
          : <DeckList decks={decks} currentId={current.id}
              onOpen={setViewing} onEdit={setEditing} onUse={onPick} onNew={() => setEditing(newDeck(t("deck.newName")))} />}
    </section>
  );
}
