import { useEffect, useState } from "react";
import type { Deck, PlayerId } from "../engine/types";
import { useT } from "../i18n/react";
import type { Timeline } from "../replay/play";
import { Board } from "./board/Board";
import type { GameSettings } from "./board/SettingsDialog";

const PLAY_MS = 700;
const noop = () => {};

// ดูเกมย้อนหลังทีละก้าว เห็นมือทั้งสองฝั่ง และเล่นต่อจากก้าวที่ดูอยู่ได้
export function ReplayViewer({ tl, decks, settings, onContinue, onClose }: {
  tl: Timeline;
  decks: Record<PlayerId, Deck>;
  settings: GameSettings;
  onContinue: (step: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const last = tl.states.length - 1;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const s = tl.states[step];

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((i) => Math.min(last, i + 1)), PLAY_MS);
    return () => clearInterval(id);
  }, [playing, last]);
  useEffect(() => { if (step >= last) setPlaying(false); }, [step, last]);

  // ก้าวแรกของเทิร์นที่ก้าว i อยู่
  const turnStart = (i: number) => { let j = i; while (j > 0 && tl.states[j - 1].turn === tl.states[i].turn) j--; return j; };
  const prevTurn = () => setStep(step > turnStart(step) ? turnStart(step) : turnStart(Math.max(0, step - 1)));
  const nextTurn = () => { let j = step; while (j < last && tl.states[j].turn === s.turn) j++; setStep(j); };
  const go = (i: number) => { setPlaying(false); setStep(Math.max(0, Math.min(last, i))); };

  const foot = <>
    <div className="replay-status">
      <span className="pos" title={tl.brokenAt !== undefined ? t("replay.broken") : undefined}>
        {t("replay.pos", { i: step, n: last, turn: s.turn })}{tl.brokenAt !== undefined ? " ⚠" : ""}
      </span>
      <button className="btn" onClick={onClose} title={t("replay.close")} aria-label={t("replay.close")}>×</button>
    </div>
    <div className="replay-bar">
      <button className="btn" onClick={() => go(0)} title={t("replay.first")} aria-label={t("replay.first")}>⏮</button>
      <button className="btn" onClick={() => { setPlaying(false); prevTurn(); }} title={t("replay.prevTurn")} aria-label={t("replay.prevTurn")}>«</button>
      <button className="btn" onClick={() => go(step - 1)} title={t("replay.prev")} aria-label={t("replay.prev")}>‹</button>
      <button className="btn" onClick={() => setPlaying(!playing)} disabled={step >= last} title={t(playing ? "replay.pause" : "replay.play")} aria-label={t(playing ? "replay.pause" : "replay.play")}>{playing ? "❚❚" : "▶"}</button>
      <button className="btn" onClick={() => go(step + 1)} title={t("replay.next")} aria-label={t("replay.next")}>›</button>
      <button className="btn" onClick={() => { setPlaying(false); nextTurn(); }} title={t("replay.nextTurn")} aria-label={t("replay.nextTurn")}>»</button>
      <button className="btn" onClick={() => go(last)} title={t("replay.last")} aria-label={t("replay.last")}>⏭</button>
    </div>
  </>;
  const center = <button className="btn primary" disabled={!!s.winner} onClick={() => onContinue(step)}>{t("replay.continue")}</button>;

  return (
    <Board
      initial={s} started settings={{ ...settings, bot: "off" }} decks={decks} deckOpen={false} onDeckOpen={noop}
      onStart={noop} onNewGame={noop} onApplySettings={noop} onSwapDecks={noop} onPickDeck={noop} onDeckChanged={noop}
      view={{ log: tl.log.slice(0, tl.logAt[step]), center, foot }}
    />
  );
}
