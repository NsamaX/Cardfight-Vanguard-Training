import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { VanguardBot } from "../../bot";
import { cardByKey as db } from "../../data/cards";
import { presetDecks } from "../../data/decks";
import { sleeveUrl } from "../../data/sleeves";
import { generationBreak } from "../../engine/rules";
import type { Deck, GameState, PlayerId } from "../../engine/types";
import { useBoard } from "../../hooks/useBoard";
import { useT } from "../../i18n/react";
import { nextLabel, type LogEntry, type Zone } from "../../lib/board";
import type { RecordedAction, Replay, ReplaySource } from "../../replay/types";
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
import { useCardFlight } from "./motion";
import { PhaseTrack } from "./PhaseTrack";
import { ReplayModal } from "./ReplayModal";
import { SettingsDialog, type GameSettings } from "./SettingsDialog";
import { GZoneRow, PileSlot } from "./ZoneRow";

function ArrowIcon({ flip }: { flip?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M5.5 3 2.5 6l3 3M2.5 6h7a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function Board({ initial, started, onStart, settings, decks, deckOpen, onDeckOpen, onNewGame, onApplySettings, onSwapDecks, onPickDeck, onDeckChanged, base, view, onOpenReplay }: {
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
  base?: { start?: GameState; actions: RecordedAction[] };   // เกมที่เล่นต่อจาก replay: ก้าวก่อนหน้าที่ต้องรวมไว้ใน replay ของเกมนี้
  view?: { log: LogEntry[]; center: ReactNode; foot: ReactNode };   // หน้าดูย้อนหลัง: แสดงสนามอย่างเดียว center = กลางแถบกลาง, foot = ล่างแผงขวา
  onOpenReplay?: (src: ReplaySource) => void;
}) {
  // บอทเริ่มคิดเมื่อกด Start แล้ว (หน้าสนามถูกสร้างใหม่ทุกเกม บอทจึงเริ่มจำใหม่ทุกเกม)
  const bot = useMemo(() => (started && !view && settings.bot && settings.bot !== "off" ? new VanguardBot(db, settings.bot, decks) : undefined), [started, view, settings.bot, decks]);
  const board = useBoard(initial, bot, view && { log: view.log });
  const t = useT();
  const [showSettings, setShowSettings] = useState(false);
  const [showReplays, setShowReplays] = useState(false);
  const [record] = useState(() => ({ id: newId(), createdAt: new Date().toISOString() }));

  // replay ของเกมนี้ ณ ตอนนี้ (บันทึกเมื่อกดปุ่มใน Replays เท่านั้น; action ที่ย้อนทิ้งไม่อยู่ใน replay)
  const replay = (): Replay => ({
    version: 1, ...record, title: `${decks.me.name} vs ${decks.bot.name}`,
    seed: initial.seed, firstPlayer: initial.firstPlayer, decks, start: base?.start, bot: settings.bot,
    actions: [...(base?.actions ?? []), ...board.actions], winner: board.s.winner, turn: board.s.turn,
  });
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
  const mainRef = useRef<HTMLElement>(null);
  const seen = useCardFlight(mainRef, s);
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
    <Hand p={p} hidden={p === "bot" && board.hideBotHand} cards={s.players[p].hand} seen={seen} selUid={selUid} lightOf={board.lightOf} picks={picks} onClick={(h) => board.clickHand(p, h)} onHover={board.setHover} />
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
      <main ref={mainRef} style={sleeveVars} className={started ? `turn-${s.turnPlayer}` : undefined}>
        {hand("bot")}
        {side("bot")}
        {tray("bot")}
        {stack("bot")}
        {deckOpen && (["bot", "me"] as const).map((p) => <DeckPanel key={p} p={p} current={decks[p]} userDecks={userDecks} onSaveDeck={saveDeck} onDeleteDeck={deleteDeck} onPick={(d) => onPickDeck(p, d)} />)}
        <div className="mid">
          {/* ซ้าย: ปุ่มย้อนกลับ + Power ฝ่ายโจมตี / ขวา: Shield ฝ่ายตั้งรับ + ปุ่มตอบคำถาม (ข้อความกลางหดหรือขึ้นบรรทัดใหม่แทนการทับ) */}
          <div className="mid-side">
            {started && !deckOpen && !view ? (
              <div className="history">
                <button className="btn icon-btn" disabled={!board.undo} onClick={board.undo} title={t("btn.undo")} aria-label={t("btn.undo")}><ArrowIcon /></button>
                <button className="btn icon-btn" disabled={!board.redo} onClick={board.redo} title={t("btn.redo")} aria-label={t("btn.redo")}><ArrowIcon flip /></button>
              </div>
            ) : <div />}
            {deckOpen ? <div /> : <BattleSide side="atk" s={s} lightOf={board.lightOf} onInspect={board.setInspect} onCheck={board.clickCheck} />}
          </div>
          <div className="mid-center">
            {view?.center}
            {deckOpen && <button className="btn" onClick={onSwapDecks}>{t("btn.swap")}</button>}
            {!started && !deckOpen && <button className="btn primary" onClick={onStart}>{t("btn.start")}</button>}
            {started && !deckOpen && board.mulligan && (
              <button className="btn primary" onClick={board.mulligan.confirm}>{t(board.mulligan.picks ? "btn.change" : "btn.ready")}</button>
            )}
            {started && !deckOpen && board.botTurn && <span className="prompt">{t("ui.botThinking")}</span>}
            {started && !deckOpen && !board.mulligan && question?.prompt && <PromptText text={t(question.prompt)} />}
            {started && !deckOpen && !board.mulligan && !question && !board.botTurn && !view && (
              <button className="btn primary" disabled={!board.canNext} onClick={board.next}>{t(next ?? "btn.next")}</button>
            )}
          </div>
          <div className="mid-side">
            {deckOpen ? <div /> : <BattleSide side="def" s={s} preview={board.guardPreview} lightOf={board.lightOf} onInspect={board.setInspect} />}
            {started && !deckOpen && !board.mulligan && question && question.buttons.length > 0 ? (
              <div className="actions">
                {question.buttons.map((q) => {
                  const label = typeof q.label === "string" ? q.label : t(q.label);
                  return <button key={label} className="btn primary" onClick={q.onClick}>{label}</button>;
                })}
              </div>
            ) : <div />}
          </div>
        </div>
        {side("me")}
        {tray("me")}
        {stack("me")}
        {hand("me")}
        <PileModal board={board} />
        <ChoiceModal board={board} />
        {showReplays && <ReplayModal current={started && board.actions.length ? replay : undefined} onOpen={(src) => { setShowReplays(false); onOpenReplay?.(src); }} onClose={() => setShowReplays(false)} />}
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
        {view && <div className="panel-foot replay-foot">{view.foot}</div>}
        {!view && (
          <div className="panel-foot">
            <button className="btn" onClick={onNewGame}>{t("btn.reset")}</button>
            <button className="btn" onClick={() => onDeckOpen(!deckOpen)}>{t(deckOpen ? "btn.close" : "btn.decks")}</button>
            <button className="btn" onClick={() => setShowReplays(true)}>{t("btn.replays")}</button>
            <button className="btn" onClick={() => setShowSettings(true)}>{t("btn.settings")}</button>
          </div>
        )}
      </aside>
    </div>
  );
}

// ข้อความคำถามกลางแถบ: ยาวเกินบรรทัดเดียว ขึ้นบรรทัดที่สองและตัวเล็กลง
// วัดใหม่ทุกครั้งที่ข้อความเปลี่ยนหรือพื้นที่ตรงกลางเปลี่ยน (เช่น เริ่มการต่อสู้แล้วมีตัวเลขสองข้าง)
function PromptText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.classList.remove("long");
      el.classList.toggle("long", el.scrollWidth > el.clientWidth);
    };
    fit();
    if (typeof ResizeObserver === "undefined" || !el.parentElement) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [text]);
  return <span ref={ref} className="prompt" title={text}>{text}</span>;
}
