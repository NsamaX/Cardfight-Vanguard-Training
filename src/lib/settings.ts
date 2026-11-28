import type { BotLevel } from "../bot";
import type { PlayerId } from "../engine/types";

// Settings for the next game: "random" = re-roll every game
export interface GameSettings {
  seed: number | "random";
  firstPlayer: PlayerId | "random";
  bot?: BotLevel;             // unset = Beta
}

export const DEFAULT_BOT: BotLevel = "beta";
export const DEFAULT_SETTINGS: GameSettings = { seed: "random", firstPlayer: "me", bot: DEFAULT_BOT };

export const randomSeed = () => Math.floor(Math.random() * 1e9);

export function resolveSettings(s: GameSettings): { seed: number; firstPlayer: PlayerId } {
  return {
    seed: s.seed === "random" ? randomSeed() : s.seed,
    firstPlayer: s.firstPlayer === "random" ? (Math.random() < 0.5 ? "me" : "bot") : s.firstPlayer,
  };
}

// How the board is shown (this browser only): side panels folded away, and the two fields top/bottom or left/right
export interface ViewSettings {
  boardOnly: boolean;
  layout: "vertical" | "horizontal";
}

const VIEW_STORE = "board-view";
export const DEFAULT_VIEW: ViewSettings = { boardOnly: false, layout: "vertical" };

export function readView(): ViewSettings {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_STORE) ?? "null");
    return { boardOnly: v?.boardOnly === true, layout: v?.layout === "horizontal" ? "horizontal" : "vertical" };
  } catch { return DEFAULT_VIEW; }
}
export function saveView(v: ViewSettings) {
  try { localStorage.setItem(VIEW_STORE, JSON.stringify(v)); } catch { /* private window: not remembered */ }
}
