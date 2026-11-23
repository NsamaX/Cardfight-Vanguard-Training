"use client";
import { useEffect, useState } from "react";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { loadUserDecks } from "../lib/deckStore";
import { createGame } from "../engine/game";
import type { Deck, GameState, PlayerId } from "../engine/types";
import { I18nProvider } from "../i18n/react";
import { Board } from "./board/Board";
import { resolveSettings, type GameSettings } from "./board/SettingsDialog";

interface Running {
  state: GameState;
  started: boolean;
  settings: GameSettings;
  decks: Record<PlayerId, Deck>;
  n: number;              // นับเกม ใช้เป็น key ให้หน้าสนามเริ่มใหม่ทุกครั้ง แม้ seed เดิม
}

// ก่อนกด Start แสดงสนามที่ยังไม่แจกการ์ด: เอาการ์ดบนมือกลับไปไว้บนกองการ์ด
function beforeDeal(state: GameState): GameState {
  const s = structuredClone(state);
  for (const ps of Object.values(s.players)) ps.deck.unshift(...ps.hand.splice(0));
  return s;
}

// เปิดมาที่หน้าสนามเลย เริ่มด้วยเด็คสำเร็จรูปใบแรกทั้งสองฝั่ง seed สุ่ม คุณเล่นก่อน บอทระดับ Normal กด Start เพื่อเริ่มเกม
export function GameApp() {
  const [game, setGame] = useState<Running | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);

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
  return (
    <I18nProvider>
      <Board
        key={game.n}
        initial={game.started ? game.state : beforeDeal(game.state)}
        started={game.started}
        onStart={() => setGame({ ...game, started: true, n: game.n + 1 })}
        settings={settings}
        decks={decks}
        deckOpen={deckOpen}
        onDeckOpen={setDeckOpen}
        onNewGame={() => start(settings, decks)}
        onApplySettings={(s) => start(s, decks)}
        onSwapDecks={() => start(settings, { me: decks.bot, bot: decks.me }, current)}
        onPickDeck={(p, d) => start(settings, { ...decks, [p]: d })}
        onDeckChanged={(d) => {
          if (decks.me.id !== d.id && decks.bot.id !== d.id) return;
          start(settings, { me: decks.me.id === d.id ? d : decks.me, bot: decks.bot.id === d.id ? d : decks.bot });
        }}
      />
    </I18nProvider>
  );
}
