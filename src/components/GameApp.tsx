"use client";
import { useEffect, useState } from "react";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { loadUserDecks } from "../lib/deckStore";
import { createGame } from "../engine/game";
import type { Deck, GameState, PlayerId } from "../engine/types";
import { I18nProvider } from "../i18n/react";
import { timelineOf, type Timeline } from "../replay/play";
import type { RecordedAction, ReplaySource } from "../replay/types";
import { Board } from "./board/Board";
import { ReplayViewer } from "./ReplayViewer";
import { resolveSettings, type GameSettings } from "./board/SettingsDialog";

interface Running {
  state: GameState;
  started: boolean;
  settings: GameSettings;
  decks: Record<PlayerId, Deck>;
  n: number;              // นับเกม ใช้เป็น key ให้หน้าสนามเริ่มใหม่ทุกครั้ง แม้ seed เดิม
  base?: { start?: GameState; actions: RecordedAction[] };   // เล่นต่อจาก replay
}

// เปิดมาที่หน้าสนามเลย เริ่มด้วยเด็คสำเร็จรูปใบแรกทั้งสองฝั่ง seed สุ่ม คุณเล่นก่อน บอทระดับ Normal กด Start เพื่อเริ่มเกม
export function GameApp() {
  const [game, setGame] = useState<Running | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [viewing, setViewing] = useState<{ src: ReplaySource; tl: Timeline } | null>(null);

  // เล่นต่อจากก้าวที่ดูอยู่: replay ของเกมใหม่รวมก้าวก่อนหน้าไว้ด้วย (ไฟล์แบบ states เริ่มจากสนามนั้นแทน)
  function continueFrom(step: number) {
    if (!viewing || !game) return;
    const { src, tl } = viewing;
    const state = tl.states[step];
    const base = "kind" in src ? { start: state, actions: [] } : { start: src.start, actions: src.actions.slice(0, step) };
    setViewing(null);
    setDeckOpen(false);
    setGame({ ...game, state, started: true, decks: src.decks, n: game.n + 1, base });
  }

  function start(settings: GameSettings, decks: Record<PlayerId, Deck>, fixed?: { seed: number; firstPlayer: PlayerId }) {
    const state = createGame(db, { ...(fixed ?? resolveSettings(settings)), decks });
    setGame((g) => ({ state, started: false, settings, decks, n: (g?.n ?? 0) + 1 }));
  }

  // สุ่มในเบราว์เซอร์หลังโหลดหน้า ค่าที่ render จาก server จะได้ไม่ขัดกับฝั่งเบราว์เซอร์
  // เด็คตัวอย่างที่ผู้เล่นแก้ไว้ใช้ฉบับที่แก้
  useEffect(() => {
    const first = loadUserDecks().find((d) => d.id === presetDecks[0].id) ?? presetDecks[0];
    start({ seed: "random", firstPlayer: "me", bot: "normal" }, { me: first, bot: first });
  }, []);

  if (!game) return null;
  const { settings, decks } = game;
  const current = { seed: game.state.seed, firstPlayer: game.state.firstPlayer };
  if (viewing) {
    return (
      <I18nProvider>
        <ReplayViewer tl={viewing.tl} decks={viewing.src.decks} settings={settings} onContinue={continueFrom} onClose={() => setViewing(null)} />
      </I18nProvider>
    );
  }
  return (
    <I18nProvider>
      <Board
        key={game.n}
        base={game.base}
        onOpenReplay={(src) => setViewing({ src, tl: timelineOf(db, src) })}
        initial={game.state}
        started={game.started}
        onStart={() => setGame({ ...game, started: true })}
        settings={settings}
        decks={decks}
        deckOpen={deckOpen}
        onDeckOpen={setDeckOpen}
        onNewGame={() => start(settings, decks)}
        onApplySettings={(s) => start(s, decks)}
        onSwapDecks={() => start(settings, { me: decks.bot, bot: decks.me }, current)}
        onPickDeck={(p, d) => start(settings, { ...decks, [p]: d })}
        onDeckReordered={(d) => setGame((g) => g && { ...g, decks: { me: g.decks.me.id === d.id ? d : g.decks.me, bot: g.decks.bot.id === d.id ? d : g.decks.bot } })}
        onDeckChanged={(d) => {
          if (decks.me.id !== d.id && decks.bot.id !== d.id) return;
          start(settings, { me: decks.me.id === d.id ? d : decks.me, bot: decks.bot.id === d.id ? d : decks.bot });
        }}
      />
    </I18nProvider>
  );
}
