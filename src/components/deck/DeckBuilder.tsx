import { useContext, useState, type ChangeEvent } from "react";
import { cardByKey as db, cards, fitsClan } from "../../data/cards";
import { countCards, validateDeck } from "../../data/decks";
import { DEFAULT_SLEEVES, type Sleeve } from "../../data/sleeves";
import type { Card, Deck, PlayerId } from "../../engine/types";
import type { MsgKey } from "../../i18n/msg";
import { useT } from "../../i18n/react";
import { shrinkImage } from "../../lib/image";
import { publicUrl } from "../../lib/library";
import { G_ZONE_SIZE, MAIN_SIZE, addCard, byGradeThenName, canAdd, copiesIn, coverCard, deckClan, displayInstance, removeCard, setStarter } from "../../lib/deckEdit";
import { isSentinel } from "../../engine/rules";
import { emptyCard } from "../../lib/abilityDraft";
import { CardHover, CardView } from "../CardView";
import { CardEditor } from "./CardEditor";

const FILTERS = ["All", "0", "1", "2", "3", "G"] as const;
type Filter = (typeof FILTERS)[number];
// Slots above the deck list: Deck shows the starting vanguard; Main / G are the sleeves
const SLOTS = ["starter", "sleeve", "g_sleeve"] as const;
type Slot = (typeof SLOTS)[number];
type SleeveSlot = Exclude<Slot, "starter">;
const SLEEVE_W = 440, SLEEVE_H = 640;

function ExpandIcon({ collapse }: { collapse: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={collapse ? "M10 2v4h4M6 14v-4H2M10 6l4-4M6 10l-4 4" : "M10 2h4v4M6 14H2v-4M14 2l-4 4M2 14l4-4"}
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Create/edit a deck. Left: the card library (click to add) or the sleeve list. Right: the Deck/Main/G slots and the deck list
// (click to remove, ★ sets the starting vanguard). The first grade 0 added is the starting vanguard, the first card added is the cover.
// Sleeves: click a Main/G slot to empty it, then click a sleeve in the list to fill the empty slot (Main first).
// A slot still empty on Done saves as unset = this side's default sleeve.
export function DeckBuilder({ p, initial, onDone, onCancel, onDelete, onSaveCard, sleeves, onAddSleeve, onDeleteSleeve, expanded, canExpand, onToggleExpand }: {
  p: PlayerId;
  initial: Deck; onDone: (d: Deck) => void; onCancel: () => void; onSaveCard: (c: Card) => Promise<MsgKey | null>;
  onDelete?: () => void;   // unset = no Delete button (a new deck not saved yet, or the last deck)
  sleeves: Sleeve[]; onAddSleeve: (name: string, image: string) => Promise<void>; onDeleteSleeve: (path: string) => Promise<void>;
  expanded: boolean; canExpand: boolean; onToggleExpand: () => void;
}) {
  const [deck, setDeck] = useState<Deck>(() => ({ ...initial, cover: initial.cover ?? coverCard(initial) ?? "" }));   // older decks: pin the automatic cover so adding a card doesn't replace it
  const [tab, setTab] = useState<"cards" | "sleeves">("cards");
  const [uploading, setUploading] = useState(false);
  const [emptied, setEmptied] = useState<SleeveSlot[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [clan, setClan] = useState("");
  const [cardEdit, setCardEdit] = useState<Card | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hover = useContext(CardHover);
  const t = useT();

  async function saveCard(c: Card): Promise<MsgKey | null> {
    const err = await onSaveCard(c);
    if (!err) setCardEdit(null);
    return err;
  }

  // A deck without its own sleeve uses this side's default, so the slot and the sleeve list show that one
  const sleeveOf = (slot: SleeveSlot) => (emptied.includes(slot) ? undefined : deck[slot] ?? DEFAULT_SLEEVES[p][slot]);
  function clickSlot(slot: Slot) {
    if (slot === "starter") { setTab("cards"); return; }
    setTab("sleeves");
    if (emptied.includes(slot)) return;
    setDeck({ ...deck, [slot]: undefined });
    setEmptied([...emptied, slot]);
  }
  function pickSleeve(path: string) {
    const slot = (["sleeve", "g_sleeve"] as const).find((s) => emptied.includes(s));
    if (!slot) return;
    setDeck({ ...deck, [slot]: path });
    setEmptied(emptied.filter((s) => s !== slot));
  }

  async function removeSleeve(sl: Sleeve) {
    if (!confirm(t("sleeve.confirmDelete", { name: sl.name }))) return;
    await onDeleteSleeve(sl.path);
    setDeck((d) => ({ ...d, sleeve: d.sleeve === sl.path ? undefined : d.sleeve, g_sleeve: d.g_sleeve === sl.path ? undefined : d.g_sleeve }));
  }

  async function newSleeve(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const name = prompt(t("sleeve.name"), file.name.replace(/\.\w+$/, ""))?.trim();
    if (!name) return;
    setUploading(true);
    try {
      await onAddSleeve(name, await shrinkImage(file, SLEEVE_W, SLEEVE_H));
    } finally {
      setUploading(false);
    }
  }

  // Once the deck has a clan, the library shows only cards that fit it; the clan filter narrows further
  const own = deckClan(deck);
  const allowed = cards.filter((c) => !own || fitsClan(c, own));
  const clans = [...new Set(allowed.map((c) => c.clan).filter(Boolean))].sort();
  const pool = allowed
    .filter((c) => !clans.includes(clan) || c.clan === clan)
    .filter((c) => filter === "All" || (filter === "G" ? c.type.startsWith("g-") : !c.type.startsWith("g-") && c.grade === Number(filter)))
    .filter((c) => !query || c.name.includes(query))
    .sort((a, b) => byGradeThenName(a.key, b.key));
  const errors = validateDeck(deck);
  const triggers = Object.entries(deck.main).reduce((n, [k, v]) => n + (db[k].type === "trigger" ? v : 0), 0);

  // The main deck is sorted by grade, the G zone keeps the order dragged on the board
  const rows = (zone: Record<string, number>) => (zone === deck.main ? Object.keys(zone).sort(byGradeThenName) : Object.keys(zone)).map((k) => (
    <div key={k} className={`deck-row ${isSentinel(db[k]) ? "sentinel" : db[k].type === "trigger" ? "trigger" : ""}`} style={db[k].image ? { backgroundImage: `url(${db[k].image})` } : undefined} onMouseEnter={() => hover?.(k)} onMouseLeave={() => hover?.(undefined)} onClick={() => { hover?.(k); setDeck(removeCard(deck, k)); }}>
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
          {tab === "cards" && <>
            {FILTERS.map((f) => <button key={f} className={`btn chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>{f === "All" ? t("deck.all") : f}</button>)}
            <select className="clan-filter" value={clans.includes(clan) ? clan : ""} onChange={(e) => setClan(e.target.value)} aria-label={t("cardEd.clan")}>
              <option value="">{t("deck.allClans")}</option>
              {clans.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="search" placeholder={t("deck.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </>}
          <div className="tabs">
            {(["cards", "sleeves"] as const).map((x) => (
              <button key={x} className={`btn chip ${tab === x ? "on" : ""}`} onClick={() => setTab(x)}>{t(x === "cards" ? "deck.tabCards" : "deck.tabSleeves")}</button>
            ))}
          </div>
        </div>
        {tab === "sleeves" && (
          <div className="collection">
            <label className={`new-card ${uploading ? "busy" : ""}`}>
              {t("deck.create")}
              <input type="file" accept="image/*" hidden disabled={uploading} onChange={newSleeve} />
            </label>
            {sleeves.map((sl) => (
              <div key={sl.path} className={`collect sleeve-tile ${sleeveOf("sleeve") === sl.path || sleeveOf("g_sleeve") === sl.path ? "full" : ""} ${emptied.length ? "pickable" : ""}`} onClick={() => pickSleeve(sl.path)}>
                <div className="card">
                  <img src={publicUrl(sl.path)} alt="" draggable={false} />
                  <span className="strip"><span className="nm">{sl.name}</span></span>
                </div>
                {sl.own && <button className="btn edit-card" title={t("sleeve.delete")} aria-label={t("sleeve.delete")} onClick={(e) => { e.stopPropagation(); removeSleeve(sl); }}>×</button>}
              </div>
            ))}
          </div>
        )}
        {tab === "cards" && <div className="collection">
          <button className="new-card" onClick={() => setCardEdit(emptyCard())}>{t("deck.create")}</button>
          {pool.map((c) => {
            const n = copiesIn(deck, c.key);
            return (
              <div key={c.key} className={`collect ${canAdd(deck, c.key) ? "" : "full"}`}>
                <CardView inst={displayInstance(c.key)} mark onClick={() => { hover?.(c.key); setDeck(addCard(deck, c.key)); }} />
                <span className="copies">{n > 0 ? `x${n}` : ""}</span>
                <button className="btn edit-card" title={t("cardEd.edit")} onClick={() => setCardEdit(c)}>✎</button>
              </div>
            );
          })}
        </div>}
      </div>
      <div className="deck-side">
        <div className="deck-head">
          <input className="deck-title" value={deck.name} onChange={(e) => setDeck({ ...deck, name: e.target.value })} />
          <button className={`btn icon-btn expand-btn ${expanded ? "on" : ""}`} aria-pressed={expanded} disabled={!canExpand && !expanded} onClick={onToggleExpand}
            title={t(expanded ? "deck.collapse" : "deck.expand")} aria-label={t(expanded ? "deck.collapse" : "deck.expand")}><ExpandIcon collapse={expanded} /></button>
        </div>
        <div className="deck-rows">
          <div className="deck-slots">
            {SLOTS.map((slot) => {
              const sleeve = slot === "starter" ? undefined : sleeveOf(slot);
              const img = slot === "starter" ? (deck.main[deck.starter] ? db[deck.starter].image : undefined) : sleeve && publicUrl(sleeve);
              const label = t(slot === "starter" ? "deck.slotDeck" : slot === "sleeve" ? "deck.sleeveMain" : "sleeve.g");
              return (
                <div key={slot} className={`deck-slot ${slot} ${img ? "" : "empty"}`} title={label}
                  onClick={() => clickSlot(slot)}>
                  {img ? <img src={img} alt="" draggable={false} /> : <span>{label}</span>}
                </div>
              );
            })}
          </div>
          {rows(deck.main)}
          {Object.keys(deck.g_zone).length > 0 && <div className="deck-sep">{t("deck.gZone")}</div>}
          {rows(deck.g_zone)}
        </div>
        <div className="deck-foot">
          <span className="mono">{t("deck.builderCount", { main: countCards(deck.main), mainMax: MAIN_SIZE, trig: triggers, g: countCards(deck.g_zone), gMax: G_ZONE_SIZE })}</span>
          {errors[0] && <span className="err">{t(errors[0])}</span>}
          <div className="deck-actions">
            <button className="btn" onClick={onCancel}>{t("deck.cancel")}</button>
            {onDelete && <button className="btn" onClick={() => setConfirmDelete(true)}>{t("deck.delete")}</button>}
            <button className="btn primary" disabled={countCards(deck.main) !== MAIN_SIZE} onClick={() => onDone(deck)}>{t("deck.done")}</button>
          </div>
        </div>
      </div>
      {confirmDelete && onDelete && <DeleteDeckDialog name={initial.name} onDelete={onDelete} onClose={() => setConfirmDelete(false)} />}
      {cardEdit && <CardEditor initial={cardEdit} onSave={saveCard} onCancel={() => setCardEdit(null)} />}
    </div>
  );
}

// Deleting a deck asks again: type the deck's saved name to enable Delete; close with X or by clicking outside
function DeleteDeckDialog({ name, onDelete, onClose }: { name: string; onDelete: () => void; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const t = useT();
  return (
    <div className="veil top-veil" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (typed === name) onDelete(); }}>
        <div className="dialog-head"><span>{t("deck.confirmDelete", { name })}</span><button type="button" className="btn" onClick={onClose}>×</button></div>
        <label>{t("deck.typeName", { name })}
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} />
        </label>
        <button className="btn primary" type="submit" disabled={typed !== name}>{t("deck.delete")}</button>
      </form>
    </div>
  );
}
