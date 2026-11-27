"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { validateDeck } from "../data/decks";
import type { Deck } from "../engine/types";
import type { LibraryHandle } from "../hooks/useLibrary";
import { useMatch } from "../hooks/useMatch";
import { useT } from "../i18n/react";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { fetchMatch, finishMatch, leaveMatch, readyRematch, rebuild, setMatchDeck, setupBoard, startMatch, type OnlineMatch } from "../lib/online";
import type { RecordedAction } from "../replay/types";
import { Board } from "./board/Board";

const noop = () => {};

// One game of an online room. Before Start (setup) each player may pick another deck and presses Start; after the game
// both press Ready for the next one, which replaces this component (onNext)
export function OnlineRoom({ start, library, userId, onNext, onLeave }: {
  start: { match: OnlineMatch; actions: RecordedAction[] };
  library: LibraryHandle;
  userId: string;
  onNext: (m: OnlineMatch) => void;
  onLeave: () => void;
}) {
  const t = useT();
  const live = useMatch(start, userId, library.cards);
  const m = live.match;
  const [deckOpen, setDeckOpen] = useState(false);
  const [pressed, setPressed] = useState(false);   // Start/Ready sent, the row doesn't show it yet
  const begun = m.seed !== undefined;
  // Actions present when this board was created; the board plays any later ones itself
  const mountActions = useRef(start.actions).current;
  const initial = useMemo(() => (begun ? rebuild(m, mountActions) : setupBoard(m)), [begun, begun || JSON.stringify(m.decks)]);

  useEffect(() => {
    if (!m.next) return;
    let alive = true;
    fetchMatch(m.next, userId, m.opponent).then((n) => { if (alive) onNext(n); }, () => {});
    return () => { alive = false; };
  }, [m.next]);

  function press(f: () => Promise<unknown>) {
    setPressed(true);
    f().then(() => live.refresh(), () => live.setProblem("online.failed")).finally(() => setPressed(false));
  }

  function pickDeck(d: Deck) {
    const error = validateDeck(d)[0];
    if (error) { alert(t(error)); return; }
    setDeckOpen(false);
    press(() => setMatchDeck(m.id, d, library.cards));
  }

  return (
    <Board
      initial={initial}
      started={begun}
      onStart={() => press(() => startMatch(m.id))}
      settings={DEFAULT_SETTINGS}
      decks={m.decks}
      deckOpen={deckOpen}
      onDeckOpen={setDeckOpen}
      onNewGame={noop}
      onApplySettings={noop}
      onSwapDecks={noop}
      onPickDeck={(_p, d) => pickDeck(d)}
      onDeckChanged={noop}
      library={library}
      online={{
        seat: m.seat, actions: live.actions, send: live.send, opponent: m.opponent, abandoned: m.abandoned, problem: live.problem,
        ready: { ...m.ready, [m.seat]: m.ready[m.seat] || pressed },
        onReady: () => press(async () => { const next = await readyRematch(m.id); if (next) onNext(await fetchMatch(next, userId, m.opponent)); }),
        onLeave: () => { leaveMatch(m.id).catch(() => {}); onLeave(); },
        onFinished: () => { finishMatch(m.id).catch(() => {}); },
      }}
    />
  );
}
