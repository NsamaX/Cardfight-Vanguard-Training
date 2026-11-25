import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { presetDecks } from "../../data/decks";
import type { Deck, PlayerId } from "../../engine/types";
import { useT } from "../../i18n/react";
import { duplicateDeck, newDeck } from "../../lib/deckEdit";
import { DeckBuilder } from "./DeckBuilder";
import { DeckList } from "./DeckList";
import { DeckView } from "./DeckView";

// แทนที่ครึ่งสนามของแต่ละฝั่งเมื่อเปิด Decks: รายการเด็ค หน้าดูเด็ค หรือหน้าสร้าง/แก้เด็ค
// เด็คตัวอย่างที่ถูกแก้จะเก็บใน userDecks ด้วย id เดิมและแสดงแทนตัวต้นฉบับ
export function DeckPanel({ p, current, userDecks, onSaveDeck, onDeleteDeck, onPick, otherEditing, onEditingChange }: {
  p: PlayerId;
  current: Deck;
  userDecks: Deck[];                 // เด็คที่ผู้เล่นสร้าง/แก้ ใช้ร่วมกันทั้งสองฝั่ง
  onSaveDeck: (d: Deck) => void;
  onDeleteDeck: (id: string) => void;
  onPick: (d: Deck) => void;
  otherEditing: boolean;             // อีกฝั่งเปิดหน้าแก้เด็คอยู่ ขยายเต็มสนามไม่ได้
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

  // ตอนขยายแผงกินทั้งสนาม แล้วเลื่อนขอบด้านที่ติดกลางสนาม (margin) จากตำแหน่งครึ่งสนามเดิม ขนาดหน้าต่างจึงเปลี่ยนจริงทีละเฟรม
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
    <section ref={ref} className={`deck-panel ${p} ${editing && expanded ? "expanded" : ""}`}>
      {editing
        ? <DeckBuilder initial={editing} onDone={save} onCancel={() => setEditing(null)}
            expanded={expanded} canExpand={!otherEditing} onToggleExpand={toggleExpand} />
        : viewing
          ? <DeckView deck={viewing} current={viewing.id === current.id} onBack={() => setViewing(null)}
              onEdit={() => setEditing(viewing)} onUse={() => onPick(viewing)}
              removeLabel={edited ? t(preset(viewing.id) ? "deck.reset" : "deck.delete") : undefined} onRemove={() => remove(viewing)} />
          : <DeckList decks={decks} currentId={current.id}
              onOpen={setViewing} onEdit={setEditing} onUse={onPick}
              onDuplicate={(d) => onSaveDeck(duplicateDeck(d, t("deck.copyName", { name: d.name })))} onNew={() => setEditing(newDeck(t("deck.newName")))} />}
    </section>
  );
}
