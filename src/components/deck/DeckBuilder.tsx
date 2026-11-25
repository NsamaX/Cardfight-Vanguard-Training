import { useState } from "react";
import { cardByKey as db, cards, putCard } from "../../data/cards";
import { countCards, validateDeck } from "../../data/decks";
import { sleeveUrl, sleeves } from "../../data/sleeves";
import type { Card, Deck } from "../../engine/types";
import type { MsgKey } from "../../i18n/msg";
import { useT } from "../../i18n/react";
import { USER_SOURCE, saveUserCard } from "../../lib/cardStore";
import { G_ZONE_SIZE, MAIN_SIZE, MAX_COPIES, addCard, byGradeThenName, copiesIn, coverCard, displayInstance, removeCard, setStarter } from "../../lib/deckEdit";
import { CardView } from "../CardView";
import { CardEditor, emptyCard } from "./CardEditor";

const FILTERS = ["All", "0", "1", "2", "3", "G"] as const;
type Filter = (typeof FILTERS)[number];

// สร้าง/แก้เด็ค: ซ้ายคือคลังการ์ด (คลิกเพื่อใส่) ขวาคือรายการในเด็ค (คลิกเพื่อเอาออก, ★ ตั้งแวนการ์ดเริ่มต้น)
function ExpandIcon({ collapse }: { collapse: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={collapse ? "M10 2v4h4M6 14v-4H2M10 6l4-4M6 10l-4 4" : "M10 2h4v4M6 14H2v-4M14 2l-4 4M2 14l4-4"}
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DeckBuilder({ initial, onDone, onCancel, expanded, canExpand, onToggleExpand }: {
  initial: Deck; onDone: (d: Deck) => void; onCancel: () => void; expanded: boolean; canExpand: boolean; onToggleExpand: () => void;
}) {
  const [deck, setDeck] = useState(initial);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [cardEdit, setCardEdit] = useState<Card | null>(null);
  const t = useT();

  // การ์ดที่สร้างเองเก็บในเบราว์เซอร์ การ์ดในคลังเขียนกลับลงไฟล์ .yaml
  async function saveCard(c: Card): Promise<MsgKey | null> {
    if (c.source === USER_SOURCE) {
      if (!saveUserCard(c)) return "cardEd.storageFull";
    } else {
      const res = await fetch("/api/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) }).catch(() => null);
      if (!res?.ok) return "cardEd.writeFailed";
    }
    putCard(c);
    setCardEdit(null);
    return null;
  }

  const pool = cards
    .filter((c) => filter === "All" || (filter === "G" ? c.type.startsWith("g-") : !c.type.startsWith("g-") && c.grade === Number(filter)))
    .filter((c) => !query || c.name.includes(query))
    .sort((a, b) => byGradeThenName(a.key, b.key));
  const errors = validateDeck(deck);
  const cover = coverCard(deck);
  const triggers = Object.entries(deck.main).reduce((n, [k, v]) => n + (db[k].type === "trigger" ? v : 0), 0);

  // เมนเด็คเรียงตามเกรด G โซนเรียงตามที่ลากจัดไว้ในหน้าสนาม
  const rows = (zone: Record<string, number>) => (zone === deck.main ? Object.keys(zone).sort(byGradeThenName) : Object.keys(zone)).map((k) => (
    <div key={k} className="deck-row" style={db[k].image ? { backgroundImage: `url(${db[k].image})` } : undefined} onClick={() => setDeck(removeCard(deck, k))}>
      <span className="g">{db[k].type.startsWith("g-") ? "G" : db[k].grade}</span>
      <span className="n">{db[k].name}</span>
      {db[k].grade === 0 && zone === deck.main && (
        <button className={`star ${deck.starter === k ? "on" : ""}`} title={t("deck.starter")}
          onClick={(e) => { e.stopPropagation(); setDeck(setStarter(deck, k)); }}>★</button>
      )}
      <span className="c">{zone[k]}</span>
    </div>
  ));

  return (
    <div className="deck-builder">
      <div className="collection-pane">
        <div className="collection-bar">
          {FILTERS.map((f) => <button key={f} className={`btn chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>{f === "All" ? t("deck.all") : f}</button>)}
          <input className="search" placeholder={t("deck.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="collection">
          <button className="new-card" onClick={() => setCardEdit(emptyCard())}>{t("cardEd.new")}</button>
          {pool.map((c) => {
            const n = copiesIn(deck, c.key);
            return (
              <div key={c.key} className={`collect ${n >= MAX_COPIES ? "full" : ""}`}>
                <CardView inst={displayInstance(c.key)} mark onClick={() => setDeck(addCard(deck, c.key))} />
                <span className="copies">{n > 0 ? `x${n}` : ""}</span>
                <button className="btn edit-card" title={t("cardEd.edit")} onClick={() => setCardEdit(c)}>✎</button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="deck-side">
        <div className="deck-head">
          <label className="deck-cover" title={t("deck.cover")} style={cover && db[cover].image ? { backgroundImage: `url(${db[cover].image})` } : undefined}>
            <select value={deck.cover && cover === deck.cover ? cover : ""} onChange={(e) => setDeck({ ...deck, cover: e.target.value || undefined })}>
              <option value="">{t("deck.coverAuto")}</option>
              {[...Object.keys(deck.main).sort(byGradeThenName), ...Object.keys(deck.g_zone)].map((k) => <option key={k} value={k}>{db[k].name}</option>)}
            </select>
          </label>
          <input className="deck-title" value={deck.name} onChange={(e) => setDeck({ ...deck, name: e.target.value })} />
          <button className={`btn icon-btn expand-btn ${expanded ? "on" : ""}`} aria-pressed={expanded} disabled={!canExpand && !expanded} onClick={onToggleExpand}
            title={t(expanded ? "deck.collapse" : "deck.expand")} aria-label={t(expanded ? "deck.collapse" : "deck.expand")}><ExpandIcon collapse={expanded} /></button>
        </div>
        <div className="deck-sleeves">
          {(["sleeve", "g_sleeve"] as const).map((field) => (
            <label key={field}>
              <span className="sleeve-thumb" style={sleeveUrl(deck[field]) ? { backgroundImage: `url(${sleeveUrl(deck[field])})` } : undefined} />
              <span className="mono">{t(field === "sleeve" ? "deck.sleeveMain" : "deck.sleeveG")}</span>
              <select value={deck[field] ?? ""} onChange={(e) => setDeck({ ...deck, [field]: e.target.value || undefined })}>
                <option value="">{t("deck.sleeveDefault")}</option>
                {sleeves.map((f) => <option key={f} value={f}>{f.replace(/\.\w+$/, "")}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="deck-rows">
          {rows(deck.main)}
          {Object.keys(deck.g_zone).length > 0 && <div className="deck-sep">{t("deck.gZone")}</div>}
          {rows(deck.g_zone)}
        </div>
        <div className="deck-foot">
          <span className="mono">{t("deck.builderCount", { main: countCards(deck.main), mainMax: MAIN_SIZE, trig: triggers, g: countCards(deck.g_zone), gMax: G_ZONE_SIZE })}</span>
          {errors[0] && <span className="err">{t(errors[0])}</span>}
          <div className="deck-actions">
            <button className="btn" onClick={onCancel}>{t("deck.cancel")}</button>
            <button className="btn primary" disabled={countCards(deck.main) !== MAIN_SIZE} onClick={() => onDone(deck)}>{t("deck.done")}</button>
          </div>
        </div>
      </div>
      {cardEdit && <CardEditor initial={cardEdit} onSave={saveCard} onCancel={() => setCardEdit(null)} />}
    </div>
  );
}
