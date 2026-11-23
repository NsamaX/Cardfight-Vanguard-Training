import { useState, type CSSProperties } from "react";
import { cardByKey as db } from "../../data/cards";
import { presetDecks } from "../../data/decks";
import { sleeveUrl } from "../../data/sleeves";
import { generationBreak } from "../../engine/rules";
import type { Deck, GameState, PlayerId } from "../../engine/types";
import { useBoard } from "../../hooks/useBoard";
import { useT } from "../../i18n/react";
import { nextLabel, type Zone } from "../../lib/board";
import { loadUserDecks, saveUserDecks } from "../../lib/deckStore";
import { DeckPanel } from "../deck/DeckPanel";
import { CardHover } from "../CardView";
import { Inspector } from "../Inspector";
import { BattleSide } from "./BattleBar";
import { CursorTip } from "./CursorTip";
import { ChoiceModal, PileModal } from "./CardModals";
import { DamageZone } from "./DamageZone";
import { FieldSide } from "./FieldSide";
import { Hand } from "./Hand";
import { LogPanel } from "./LogPanel";
import { PhaseTrack } from "./PhaseTrack";
import { SettingsDialog, type GameSettings } from "./SettingsDialog";
import { GZoneRow, PileSlot } from "./ZoneRow";

function ArrowIcon({ flip }: { flip?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M5.5 3 2.5 6l3 3M2.5 6h7a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Board({ initial, started, onStart, settings, decks, deckOpen, onDeckOpen, onNewGame, onApplySettings, onSwapDecks, onPickDeck, onDeckChanged }: {
  initial: GameState;
  started: boolean;            // false = รอกด Start (ยังไม่แจกการ์ด)
  onStart: () => void;
  settings: GameSettings;
  decks: Record<PlayerId, Deck>;
  deckOpen: boolean;           // หน้าเลือกเด็คทั้งสองฝั่ง (เก็บไว้นอกหน้าสนาม จึงยังเปิดอยู่หลังเลือกเด็คแล้วเริ่มเกมใหม่)
  onDeckOpen: (open: boolean) => void;
  onNewGame: () => void;
  onApplySettings: (s: GameSettings) => void;
  onSwapDecks: () => void;
  onPickDeck: (p: PlayerId, d: Deck) => void;
  onDeckChanged: (d: Deck) => void;  // เด็คถูกแก้/คืนค่า ฝั่งที่ใช้เด็คนี้อยู่ต้องได้ฉบับใหม่
}) {
  const board = useBoard(initial);
  const t = useT();
  const [showSettings, setShowSettings] = useState(false);
  const [userDecks, setUserDecks] = useState(loadUserDecks);
  function saveDeck(d: Deck) {
    const next = userDecks.some((x) => x.id === d.id) ? userDecks.map((x) => (x.id === d.id ? d : x)) : [...userDecks, d];
    setUserDecks(next);
    saveUserDecks(next);
    onDeckChanged(d);
  }
  function deleteDeck(id: string) {
    const next = userDecks.filter((x) => x.id !== id);
    setUserDecks(next);
    saveUserDecks(next);
    const original = presetDecks.find((x) => x.id === id);
    if (original) onDeckChanged(original);
  }
  // โหมดเปลี่ยนเด็ค: กล่องเทาคลุมแต่ละฝั่งให้คลิกเลือกฝั่ง ฝั่งที่เลือกกลายเป็นหน้าเลือก/สร้างเด็ค และปุ่มสลับเด็คกลางแถบการต่อสู้

  const { s, actor, mode, selUid, picks } = board;
  const next = nextLabel(db, s);
  const question = board.question();
  const sleeveVars = Object.fromEntries((["me", "bot"] as const).flatMap((p) => [
    [`--sleeve-${p}`, sleeveUrl(decks[p].sleeve)], [`--g-sleeve-${p}`, sleeveUrl(decks[p].g_sleeve)],
  ]).filter(([, u]) => u).map(([k, u]) => [k, `url(${u})`])) as CSSProperties;

  const side = (p: PlayerId) => (
    <FieldSide
      p={p} ps={s.players[p]} selUid={selUid}
      pickedCircle={mode?.kind === "trigger" && p === actor ? mode.powerTo : undefined}
      lightOf={board.lightOf} soulLight={board.pileLight(p, "soul")}
      atkCircles={board.attackPick?.player === p ? board.attackPick.circles : board.battleMarks?.[p].atk ?? []}
      aimedCircles={board.battleMarks?.[p].aimed ?? []}
      bonus={board.attackPick?.player === p ? board.attackPick.bonus : board.trigBonus?.player === p ? board.trigBonus.bonus : {}}
      isTarget={(c) => board.isTarget(p, c)}
      onCircle={(c) => board.clickCircle(p, c)}
      onPile={(zone) => board.setPile({ player: p, zone })}
      onCard={board.setInspect}
    />
  );
  const hand = (p: PlayerId) => (
    <Hand p={p} away={p !== s.turnPlayer && p !== actor} cards={s.players[p].hand} selUid={selUid} lightOf={board.lightOf} picks={picks} onClick={(h) => board.clickHand(p, h)} onHover={board.setHover} />
  );
  // ข้างสนาม: ฝั่งเรา G โซน+ดาเมจอยู่ซ้าย กองการ์ด+ดรอป+ไบนด์อยู่ขวา ฝั่งบอทหมุนกลับหัว
  const open = (p: PlayerId, zone: Zone) => () => board.setPile({ player: p, zone });
  const tray = (p: PlayerId) => (
    <div className={`tray ${p}`}>
      <span className="badge">GB {generationBreak(db, s.players[p])}</span>
      <GZoneRow ps={s.players[p]} light={board.pileLight(p, "gZone")} toward={p === "me" ? "right" : "left"} onOpen={open(p, "gZone")} onInspect={board.setInspect} />
      <DamageZone p={p} ps={s.players[p]} light={board.pileLight(p, "damage")} onOpen={open(p, "damage")} />
    </div>
  );
  const stack = (p: PlayerId) => (
    <div className={`stack ${p}`}>
      <PileSlot ps={s.players[p]} zone="deck" light={board.pileLight(p, "deck")} onOpen={open(p, "deck")} />
      <PileSlot ps={s.players[p]} zone="drop" light={board.pileLight(p, "drop")} onOpen={open(p, "drop")} />
      <PileSlot ps={s.players[p]} zone="bind" light={board.pileLight(p, "bind")} onOpen={open(p, "bind")} />
    </div>
  );

  return (
    <div className="app">
      <LogPanel log={board.log} onInspect={board.setInspect}><PhaseTrack s={s} /></LogPanel>
      <CardHover.Provider value={board.setHover}>
      <main style={sleeveVars}>
        {hand("bot")}
        {side("bot")}
        {tray("bot")}
        {stack("bot")}
        {deckOpen && (["bot", "me"] as const).map((p) => <DeckPanel key={p} p={p} current={decks[p]} userDecks={userDecks} onSaveDeck={saveDeck} onDeleteDeck={deleteDeck} onPick={(d) => onPickDeck(p, d)} />)}
        <div className="mid">
          {started && !deckOpen && (
            <div className="history">
              <button className="btn icon-btn" disabled={!board.undo} onClick={board.undo} title={t("btn.undo")} aria-label={t("btn.undo")}><ArrowIcon /></button>
              <button className="btn icon-btn" disabled={!board.redo} onClick={board.redo} title={t("btn.redo")} aria-label={t("btn.redo")}><ArrowIcon flip /></button>
            </div>
          )}
          {deckOpen ? <div /> : <BattleSide side="atk" s={s} lightOf={board.lightOf} onInspect={board.setInspect} onCheck={board.clickCheck} />}
          <div className="mid-center">
            {deckOpen && <button className="btn" onClick={onSwapDecks}>{t("btn.swap")}</button>}
            {!started && !deckOpen && <button className="btn primary" onClick={onStart}>{t("btn.start")}</button>}
            {started && !deckOpen && board.mulligan && (
              <button className="btn primary" onClick={board.mulligan.confirm}>{t(board.mulligan.picks ? "btn.change" : "btn.ready")}</button>
            )}
            {started && !deckOpen && !board.mulligan && question && <>
              {question.prompt && <span className="prompt" title={t(question.prompt)}>{t(question.prompt)}</span>}
              {question.buttons.map((q) => {
                const label = typeof q.label === "string" ? q.label : t(q.label);
                return <button key={label} className="btn primary" onClick={q.onClick}>{label}</button>;
              })}
            </>}
            {started && !deckOpen && !board.mulligan && !question && (
              <button className="btn primary" disabled={!board.canNext} onClick={board.next}>{t(next ?? "btn.next")}</button>
            )}
          </div>
          {deckOpen ? <div /> : <BattleSide side="def" s={s} preview={board.guardPreview} lightOf={board.lightOf} onInspect={board.setInspect} />}
        </div>
        {side("me")}
        {tray("me")}
        {stack("me")}
        {hand("me")}
        <PileModal board={board} />
        <ChoiceModal board={board} />
        {showSettings && <SettingsDialog settings={settings} current={{ seed: s.seed, firstPlayer: s.firstPlayer }} onApply={onApplySettings} onClose={() => setShowSettings(false)} />}
        {board.error && <div className="toast">{t(board.error)}</div>}
        {(board.trigTip ?? board.choiceTip) && <CursorTip text={t((board.trigTip ?? board.choiceTip)!.text)} kind={(board.trigTip ?? board.choiceTip)!.kind} />}
      </main>
      </CardHover.Provider>
      <aside className="right">
        {(["bot", "me"] as const).map((p) => {
          const c = board.inspectedOf(p);
          return <Inspector key={p} p={p} cardKey={c?.inst.key} power={c?.power} onClose={() => board.closeInspect(p)} />;
        })}
        <div className="panel-foot">
          <button className="btn" onClick={onNewGame}>{t("btn.reset")}</button>
          <button className="btn" onClick={() => onDeckOpen(!deckOpen)}>{t(deckOpen ? "btn.close" : "btn.decks")}</button>
          <button className="btn" onClick={() => setShowSettings(true)}>{t("btn.settings")}</button>
        </div>
      </aside>
    </div>
  );
}
