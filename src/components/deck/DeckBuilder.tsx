import { useState } from "react";
import { cardByKey as db, cards } from "../../data/cards";
import { countCards, validateDeck } from "../../data/decks";
import { sleeveUrl, sleeves } from "../../data/sleeves";
import type { Deck } from "../../engine/types";
import { useT } from "../../i18n/react";
import { G_ZONE_SIZE, MAIN_SIZE, MAX_COPIES, addCard, copiesIn, coverCard, displayInstance, removeCard, setStarter } from "../../lib/deckEdit";
import { CardView } from "../CardView";

const FILTERS = ["All", "0", "1", "2", "3", "G"] as const;
type Filter = (typeof FILTERS)[number];

const byGradeThenName = (a: string, b: string) => db[a].grade - db[b].grade || db[a].name.localeCompare(db[b].name, "en");

// สร้าง/แก้เด็ค: ซ้ายคือคลังการ์ด (คลิกเพื่อใส่) ขวาคือรายการในเด็ค (คลิกเพื่อเอาออก, ★ ตั้งแวนการ์ดเริ่มต้น)
export function DeckBuilder({ initial, onDone, onCancel }: { initial: Deck; onDone: (d: Deck) => void; onCancel: () => void }) {
  const [deck, setDeck] = useState(initial);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const t = useT();

  const pool = cards
    .filter((c) => filter === "All" || (filter === "G" ? c.type.startsWith("g-") : !c.type.startsWith("g-") && c.grade === Number(filter)))
    .filter((c) => !query || c.name.includes(query))
    .sort((a, b) => byGradeThenName(a.key, b.key));
  const errors = validateDeck(deck);
  const cover = coverCard(deck);
  const triggers = Object.entries(deck.main).reduce((n, [k, v]) => n + (db[k].type === "trigger" ? v : 0), 0);

  const rows = (zone: Record<string, number>) => Object.keys(zone).sort(byGradeThenName).map((k) => (
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
          {pool.map((c) => {
            const n = copiesIn(deck, c.key);
            return (
              <div key={c.key} className={`collect ${n >= MAX_COPIES ? "full" : ""}`}>
                <CardView inst={displayInstance(c.key)} mark onClick={() => setDeck(addCard(deck, c.key))} />
                <span className="copies">{n > 0 ? `x${n}` : ""}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="deck-side">
        <div className="deck-head">
          <input className="deck-title" value={deck.name} onChange={(e) => setDeck({ ...deck, name: e.target.value })} />
          <label className="deck-cover" title={t("deck.cover")} style={cover && db[cover].image ? { backgroundImage: `url(${db[cover].image})` } : undefined}>
            <select value={deck.cover && cover === deck.cover ? cover : ""} onChange={(e) => setDeck({ ...deck, cover: e.target.value || undefined })}>
              <option value="">{t("deck.coverAuto")}</option>
              {[...Object.keys(deck.main).sort(byGradeThenName), ...Object.keys(deck.g_zone).sort(byGradeThenName)].map((k) => <option key={k} value={k}>{db[k].name}</option>)}
            </select>
          </label>
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
    </div>
  );
}
