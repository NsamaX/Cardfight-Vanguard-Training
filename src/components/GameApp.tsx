"use client";
import { useState } from "react";
import { cardByKey as db, setCards } from "../data/cards";
import { startingDecks } from "../data/decks";
import { createGame } from "../engine/game";
import type { Deck, GameState, PlayerId } from "../engine/types";
import { useAuth } from "../hooks/useAuth";
import { useLibrary } from "../hooks/useLibrary";
import { installMatchCards } from "../hooks/useMatch";
import type { MsgKey } from "../i18n/msg";
import { FixedText, useT } from "../i18n/react";
import { leaveMatch, rebuild, type OnlineStart } from "../lib/online";
import { DEFAULT_SETTINGS, resolveSettings, type GameSettings } from "../lib/settings";
import { timelineOf, type Timeline } from "../replay/play";
import type { RecordedAction, ReplaySource } from "../replay/types";
import { Board } from "./board/Board";
import { OnlineRoom } from "./OnlineRoom";
import { ReplayViewer } from "./ReplayViewer";

interface Running {
  state: GameState;
  started: boolean;
  settings: GameSettings;
  decks: Record<PlayerId, Deck>;
  n: number;              // game counter, used as the board key so it restarts every time, even with the same seed
  base?: { start?: GameState; actions: RecordedAction[] };   // continuing from a replay
}

const replaceDeck = (decks: Record<PlayerId, Deck>, d: Deck) =>
  ({ me: decks.me.id === d.id ? d : decks.me, bot: decks.bot.id === d.id ? d : decks.bot });

const newGame = (settings: GameSettings, decks: Record<PlayerId, Deck>, n: number, fixed?: { seed: number; firstPlayer: PlayerId }): Running =>
  ({ state: createGame(db, { ...(fixed ?? resolveSettings(settings)), decks }), started: false, settings, decks, n });

// Opens straight onto the board with the bot's deck (BOT_DECK) on its side and the first other deck on ours; press Start to begin.
// Each library load (first visit, sign-in, sign-out) starts a fresh game with the new library.
export function GameApp() {
  const auth = useAuth();
  const [game, setGame] = useState<Running | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [viewing, setViewing] = useState<{ src: ReplaySource; tl: Timeline; n: number } | null>(null);   // n: a new replay opened while viewing one starts over at step 0
  const [online, setOnline] = useState<OnlineStart | null>(null);
  const t = useT();
  const { library, failed, retry } = useLibrary(auth.ready, auth.user?.id, (lib) => {
    setViewing(null);
    setOnline(null);
    setDeckOpen(false);
    setGame((g) => newGame(g?.settings ?? DEFAULT_SETTINGS, startingDecks(lib.decks), (g?.n ?? 0) + 1));
  });

  if (failed) return <LoadFailed onRetry={retry} />;
  if (!game || !library) return null;
  const { settings, decks } = game;

  const start = (s: GameSettings, d: Record<PlayerId, Deck>, fixed?: { seed: number; firstPlayer: PlayerId }) => setGame(newGame(s, d, game.n + 1, fixed));
  const inUse = (d: Deck) => decks.me.id === d.id || decks.bot.id === d.id;

  // Continue from the step being viewed: the new game's replay includes the earlier steps (states files start from that board instead)
  function continueFrom(step: number) {
    if (!viewing || !game) return;
    const { src, tl } = viewing;
    const state = tl.states[step];
    const base = "kind" in src ? { start: state, actions: [] } : { start: src.start, actions: src.actions.slice(0, step) };
    setViewing(null);
    setDeckOpen(false);
    setGame({ ...game, state, started: true, decks: src.decks, n: game.n + 1, base });
  }

  // The match's card snapshot goes into the card registry until we leave
  function enterOnline(o: OnlineStart) {
    installMatchCards(library!.cards, o.match);
    try {
      if (o.match.seed !== undefined) rebuild(o.match, o.actions);
    } catch {
      setCards(library!.cards);
      leaveMatch(o.match.id).catch(() => {});
      alert(t("online.desync"));
      return;
    }
    setOnline(o);
    setDeckOpen(false);
  }

  function leaveOnline() {
    setCards(library!.cards);
    setOnline(null);
    start(settings, decks);
  }

  if (online) {
    const you = t("player.me"), them = online.match.opponent;
    const names: Partial<Record<MsgKey, string>> = online.match.seat === "me" ? { "player.bot": them } : { "player.me": them, "player.bot": you };
    return (
      <FixedText value={names}>
        <OnlineRoom key={online.match.id} start={online} library={library} userId={library.userId!} onNext={(match) => setOnline({ match, actions: [] })} onLeave={leaveOnline} />
      </FixedText>
    );
  }
  if (viewing) {
    return <ReplayViewer key={viewing.n} tl={viewing.tl} decks={viewing.src.decks} settings={settings} library={library} onContinue={continueFrom}
      onOpen={(src) => setViewing({ src, tl: timelineOf(db, src), n: viewing.n + 1 })} onClose={() => setViewing(null)} />;
  }
  return (
    <Board
      key={game.n}
      openSettings={game.n === 1}
      library={library}
      base={game.base}
      onOpenReplay={(src) => setViewing({ src, tl: timelineOf(db, src), n: 0 })}
      initial={game.state}
      started={game.started}
      onStart={() => setGame({ ...game, started: true })}
      settings={settings}
      decks={decks}
      deckOpen={deckOpen}
      onDeckOpen={setDeckOpen}
      onNewGame={() => start(settings, decks)}
      onApplySettings={(s) => (game.started ? setGame({ ...game, settings: s }) : start(s, decks))}
      onSwapDecks={() => start(settings, { me: decks.bot, bot: decks.me }, { seed: game.state.seed, firstPlayer: game.state.firstPlayer })}
      onPickDeck={(p, d) => start(settings, { ...decks, [p]: d })}
      onDeckUpdated={(d) => { if (inUse(d)) setGame((g) => g && { ...g, decks: replaceDeck(g.decks, d) }); }}
      onDeckChanged={(d) => { if (inUse(d)) start(settings, replaceDeck(decks, d)); }}
      onOnline={auth.available ? enterOnline : undefined}
    />
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="veil">
      <div className="dialog">
        <span>{t("library.loadFailed")}</span>
        <button className="btn primary" onClick={onRetry}>{t("library.retry")}</button>
      </div>
    </div>
  );
}
