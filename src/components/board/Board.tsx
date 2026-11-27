import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { VanguardBot } from "../../bot";
import { cardByKey as db } from "../../data/cards";
import { DEFAULT_SLEEVES } from "../../data/sleeves";
import { generationBreak } from "../../engine/rules";
import type { Deck, GameState, PlayerId } from "../../engine/types";
import { useBoard } from "../../hooks/useBoard";
import { MOVE_MS, useCardFlight } from "../../hooks/useCardFlight";
import { offlineLibrary, type LibraryHandle } from "../../hooks/useLibrary";
import { useT } from "../../i18n/react";
import { nextLabel, stepText, undealt, type LogEntry, type Zone } from "../../lib/board";
import { moveG } from "../../lib/deckEdit";
import { publicUrl } from "../../lib/library";
import { DEFAULT_BOT, type GameSettings } from "../../lib/settings";
import type { RecordedAction, Replay, ReplaySource } from "../../replay/types";
import { DeckPanel } from "../deck/DeckPanel";
import { CardHover, CardView } from "../CardView";
import { Inspector } from "../Inspector";
import { BattleNum, BattleSide } from "./BattleBar";
import { CursorTip } from "./CursorTip";
import { ChoiceModal, PileModal } from "./CardModals";
import { DamageZone } from "./DamageZone";
import { FieldSide } from "./FieldSide";
import { Hand } from "./Hand";
import { LogPanel } from "./LogPanel";
import { PhaseTrack } from "./PhaseTrack";
import { ReplayModal } from "./ReplayModal";
import { SettingsDialog } from "./SettingsDialog";
import { GZoneRow, PileSlot } from "./ZoneRow";

function ArrowIcon({ flip }: { flip?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M5.5 3 2.5 6l3 3M2.5 6h7a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function Board({ initial, started, onStart, settings, decks, deckOpen, onDeckOpen, onNewGame, onApplySettings, onSwapDecks, onPickDeck, onDeckChanged, onDeckUpdated, base, view, onOpenReplay, library = offlineLibrary, openSettings }: {
  initial: GameState;          // board after dealing
  started: boolean;            // false = waiting for Start (shows the board before dealing)
  onStart: () => void;
  settings: GameSettings;
  decks: Record<PlayerId, Deck>;
  deckOpen: boolean;           // deck pick screen for both sides (kept outside the board, so it stays open after picking a deck starts a new game)
  onDeckOpen: (open: boolean) => void;
  onNewGame: () => void;
  onApplySettings: (s: GameSettings) => void;
  onSwapDecks: () => void;
  onPickDeck: (p: PlayerId, d: Deck) => void;
  onDeckChanged: (d: Deck) => void;      // the deck's cards changed: the side using it restarts with the new version
  onDeckUpdated?: (d: Deck) => void;     // only the G zone order or sleeves changed: update the deck without restarting
  base?: { start?: GameState; actions: RecordedAction[] };   // a game continued from a replay: earlier steps to include in this game's replay
  view?: { log: LogEntry[]; action: ReactNode; foot: ReactNode };   // replay viewer: board only; action = right slot of the middle bar, foot = bottom of the right panel
  onOpenReplay?: (src: ReplaySource) => void;
  library?: LibraryHandle;
  openSettings?: boolean;   // start with the settings dialog open (first board after entering the site)
}) {
  // The bot starts thinking after Start (the board is recreated every game, so the bot's memory resets every game)
  const bot = useMemo(() => (started && !view ? new VanguardBot(db, settings.bot ?? DEFAULT_BOT, decks) : undefined), [started, view, settings.bot]);   // a G zone reorder doesn't need a new bot (a real deck change restarts the board anyway)
  const board = useBoard(started ? initial : undealt(initial, false), bot, view && { log: view.log });
  const t = useT();
  const [showSettings, setShowSettings] = useState(!!openSettings);
  const [showReplays, setShowReplays] = useState(false);
  const [deckCard, setDeckCard] = useState<string>();   // Decks open: the library/deck card under the mouse, shown in the whole right panel
  // The decks as the game was dealt: reordering the G zone mid-game edits the deck, but the replay must rebuild the same starting board (same card uids)
  const [record] = useState(() => ({ id: newId(), createdAt: new Date().toISOString(), decks }));

  // This game's replay as of now (saved only via the button in Replays; undone actions aren't in the replay)
  const replay = (): Replay => ({
    version: 1, ...record, title: `${decks.me.name} vs ${decks.bot.name}`,
    seed: initial.seed, firstPlayer: initial.firstPlayer, start: base?.start, bot: settings.bot,
    actions: [...(base?.actions ?? []), ...board.actions], winner: board.s.winner, turn: board.s.turn,
  });
  const [editing, setEditing] = useState<Record<PlayerId, boolean>>({ bot: false, me: false });
  const signedIn = !!library.userId;
  function saveDeck(d: Deck) {
    library.saveDeck(d);
    onDeckChanged(d);
  }
  // Guests may reorder the G zone too; it lasts for this session only
  function reorderG(p: PlayerId, from: string, to: string) {
    const d = moveG(decks[p], from, to);
    if (d === decks[p]) return;
    library.saveDeck(d);
    onDeckUpdated?.(d);
  }
  async function deleteSleeve(path: string) {
    for (const d of await library.deleteSleeve(path)) onDeckUpdated?.(d);
  }

  const { s, actor, mode, selUid, picks } = board;
  const mainRef = useRef<HTMLElement>(null);
  const seen = useCardFlight(mainRef, s);
  // Press Start: the starting vanguard leaves the deck for VC first, then 5 cards are drawn (no timer to cancel, since the board only waits for Start once)
  const dealPending = useRef(!started);
  useEffect(() => {
    if (!started || !dealPending.current) return;
    dealPending.current = false;
    board.setState(undealt(initial, true));
    setTimeout(() => board.setState(initial), MOVE_MS);
  }, [started]);
  const next = nextLabel(s);
  const question = board.question();
  const showNext = started && !deckOpen && !board.mulligan && !question && !board.botTurn && !view;
  const step = showNext ? stepText(s) : undefined;
  const sleeveVars = Object.fromEntries((["me", "bot"] as const).flatMap((p) => [
    [`--sleeve-${p}`, publicUrl(decks[p].sleeve ?? DEFAULT_SLEEVES[p].sleeve)], [`--g-sleeve-${p}`, publicUrl(decks[p].g_sleeve ?? DEFAULT_SLEEVES[p].g_sleeve)],
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
  // Board sides: on our side the G zone + damage are on the left, deck + drop + bind on the right; the bot side is upside down
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

  const defender: PlayerId = s.turnPlayer === "me" ? "bot" : "me";
  return (
    <div className="app">
      <LogPanel log={board.log} onInspect={board.setInspect}><PhaseTrack s={s} /></LogPanel>
      <CardHover.Provider value={board.setHover}>
      <main ref={mainRef} style={sleeveVars} className={started ? `turn-${s.turnPlayer}` : undefined}>
        {hand("bot")}
        {side("bot")}
        {tray("bot")}
        {stack("bot")}
        {started && !deckOpen && board.botTurn && <span className="thinking">{t("ui.botThinking")}</span>}
        {!!board.reveal?.cards.length && (
          <div className={`reveal ${board.reveal.player}`}>
            {board.reveal.cards.map((c) => <CardView key={c.uid} inst={c} plain noRotate />)}
          </div>
        )}
        {deckOpen && <CardHover.Provider value={setDeckCard}>{(["bot", "me"] as const).map((p) => <DeckPanel key={p} p={p} current={decks[p]} decks={library.decks} editable={signedIn} sleeves={library.sleeves} onAddSleeve={library.addSleeve} onDeleteSleeve={deleteSleeve} onSaveDeck={saveDeck} onSaveCard={library.saveCard} onDeleteDeck={library.deleteDeck} onPick={(d) => onPickDeck(p, d)}
          otherEditing={editing[p === "me" ? "bot" : "me"]} onEditingChange={(on) => setEditing((e) => ({ ...e, [p]: on }))} />)}</CardHover.Provider>}
        <div className="mid">
          {/* Far left: undo/redo | middle: attacker (power + drive check) | question or step text, plus Start/mulligan/swap | defender (power + guard cards) | far right: answer and phase buttons */}
          <div className="mid-history">
            {started && !deckOpen && !view && <>
              <button className="btn icon-btn" disabled={!board.undo} onClick={board.undo} title={t("btn.undo")} aria-label={t("btn.undo")}><ArrowIcon /></button>
              <button className="btn icon-btn" disabled={!board.redo} onClick={board.redo} title={t("btn.redo")} aria-label={t("btn.redo")}><ArrowIcon flip /></button>
            </>}
          </div>
          <div className="mid-main">
            {deckOpen ? <div /> : <BattleSide p={s.turnPlayer} s={s} lightOf={board.lightOf} onInspect={board.setInspect} onCheck={board.clickCheck} onGuardian={board.unguard} drive={board.reveal?.drive} />}
            <div className="mid-center">
              {!deckOpen && <BattleNum p={s.turnPlayer} s={s} preview={board.guardPreview} />}
              {started && !deckOpen && !board.mulligan && question?.prompt && <PromptText text={t(question.prompt)} />}
              {step && <PromptText text={t(step)} />}
              <div className="steps">
                {deckOpen && <button className="btn" onClick={onSwapDecks}>{t("btn.swap")}</button>}
                {!started && !deckOpen && <button className="btn primary" onClick={onStart}>{t("btn.start")}</button>}
                {started && !deckOpen && board.mulligan && (
                  <button className="btn primary" onClick={board.mulligan.confirm}>{t(board.mulligan.picks ? "btn.change" : "btn.ready")}</button>
                )}
              </div>
              {!deckOpen && <BattleNum p={defender} s={s} preview={board.guardPreview} />}
            </div>
            {deckOpen ? <div /> : <BattleSide p={defender} s={s} lightOf={board.lightOf} onInspect={board.setInspect} onCheck={board.clickCheck} onGuardian={board.unguard} />}
          </div>
          <div className="mid-actions">
            {view?.action}
            {started && !deckOpen && !board.mulligan && question && question.buttons.map((q) => {
              const label = typeof q.label === "string" ? q.label : t(q.label);
              return <button key={label} className="btn primary" onClick={q.onClick} title={label}>{label}</button>;
            })}
            {showNext && (next || board.canNext || !s.battle) && (   /* during a battle, a plain Next that can't be pressed isn't shown */
              <button className="btn primary" disabled={!board.canNext} onClick={board.next}>{t(next ?? "btn.next")}</button>
            )}
          </div>
        </div>
        {side("me")}
        {tray("me")}
        {stack("me")}
        {hand("me")}
        <PileModal board={board} started={started} decks={decks} onMoveG={onDeckUpdated && reorderG} />
        <ChoiceModal board={board} />
        {showReplays && <ReplayModal signedIn={signedIn} current={started && board.actions.length ? replay : undefined} onOpen={(src) => { setShowReplays(false); onOpenReplay?.(src); }} onClose={() => setShowReplays(false)} />}
        {showSettings && <SettingsDialog settings={settings} current={{ seed: s.seed, firstPlayer: s.firstPlayer }} onApply={(next) => { setShowSettings(false); onApplySettings(next); }} onClose={() => setShowSettings(false)} />}
        {board.error && <div className="toast">{t(board.error)}</div>}
        {(board.trigTip ?? board.choiceTip) && <CursorTip text={t((board.trigTip ?? board.choiceTip)!.text)} kind={(board.trigTip ?? board.choiceTip)!.kind} />}
      </main>
      </CardHover.Provider>
      <aside className="right">
        {deckOpen ? <Inspector p="me" cardKey={deckCard} onClose={() => setDeckCard(undefined)} /> : (["bot", "me"] as const).map((p) => {
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

// Question text in the middle of the bar: wraps into two balanced centered lines when it doesn't fit (CSS)
function PromptText({ text }: { text: string }) {
  return <span className="prompt" title={text}>{text}</span>;
}
