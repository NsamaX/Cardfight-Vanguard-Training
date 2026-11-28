import { useEffect, useRef, useState } from "react";
import type { Deck, PlayerId } from "../engine/types";
import { useT } from "../i18n/react";
import type { Timeline } from "../replay/play";
import { Board } from "./board/Board";
import type { GameSettings } from "../lib/settings";
import type { LibraryHandle } from "../hooks/useLibrary";
import type { ReplaySource } from "../replay/types";

const PLAY_MS = 700;
const SPEEDS = [0.5, 1, 2, 4];
const noop = () => {};

// Step through a past game, see both hands, and continue playing from the step being viewed; another replay can be opened from the menu.
// follow: a game still being played (the sandbox): starts at the last step, and new steps are shown as they arrive while viewing the last one
export function ReplayViewer({ tl, decks, settings, library, onContinue, onOpen, onClose, follow }: {
  tl: Timeline;
  decks: Record<PlayerId, Deck>;
  settings: GameSettings;
  library?: LibraryHandle;
  onContinue?: (step: number) => void;
  onOpen?: (src: ReplaySource) => void;
  onClose: () => void;
  follow?: boolean;
}) {
  const t = useT();
  const last = tl.states.length - 1;
  const [step, setStep] = useState(follow ? last : 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const s = tl.states[step];
  const lastSeen = useRef(last);

  useEffect(() => {
    if (follow && step === lastSeen.current) setStep(last);
    lastSeen.current = last;
  }, [last]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((i) => Math.min(last, i + 1)), PLAY_MS / SPEEDS[speed]);
    return () => clearInterval(id);
  }, [playing, last, speed]);
  useEffect(() => { if (step >= last) setPlaying(false); }, [step, last]);

  const go = (i: number) => { setPlaying(false); setStep(Math.max(0, Math.min(last, i))); };

  const foot = <>
    <div className="replay-status">
      <span className="pos" title={tl.brokenAt !== undefined ? t("replay.broken") : undefined}>
        {t("replay.pos", { i: step, n: last, turn: s.turn })}{tl.brokenAt !== undefined ? " ⚠" : ""}
      </span>
    </div>
    <div className="replay-bar">
      <button className="btn" onClick={() => go(0)} title={t("replay.first")} aria-label={t("replay.first")}>⏮</button>
      <button className="btn" onClick={() => go(step - 1)} title={t("replay.prev")} aria-label={t("replay.prev")}>‹</button>
      <button className="btn" onClick={() => setPlaying(!playing)} disabled={step >= last} title={t(playing ? "replay.pause" : "replay.play")} aria-label={t(playing ? "replay.pause" : "replay.play")}>{playing ? "❚❚" : "▶"}</button>
      <button className="btn" onClick={() => go(step + 1)} title={t("replay.next")} aria-label={t("replay.next")}>›</button>
      <button className="btn" onClick={() => go(last)} title={t("replay.last")} aria-label={t("replay.last")}>⏭</button>
      <button className="btn" onClick={() => setSpeed(speed - 1)} disabled={speed === 0} title={t("replay.slower")} aria-label={t("replay.slower")}>−</button>
      <span className="speed">{SPEEDS[speed]}x</span>
      <button className="btn" onClick={() => setSpeed(speed + 1)} disabled={speed === SPEEDS.length - 1} title={t("replay.faster")} aria-label={t("replay.faster")}>+</button>
    </div>
  </>;
  const action = onContinue && <button className="btn primary" disabled={!!s.winner} onClick={() => onContinue(step)}>{t("replay.continue")}</button>;

  return (
    <Board
      initial={s} started settings={settings} library={library} onOpenReplay={onOpen} decks={decks} deckOpen={false} onDeckOpen={noop}
      onStart={noop} onNewGame={noop} onApplySettings={noop} onSwapDecks={noop} onPickDeck={noop} onDeckChanged={noop}
      view={{ log: tl.log.slice(0, tl.logAt[step]), action, foot, onClose }}
    />
  );
}
