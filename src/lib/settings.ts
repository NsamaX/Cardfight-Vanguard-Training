import type { BotLevel } from "../bot";
import type { PlayerId } from "../engine/types";

// Settings for the next game: "random" = re-roll every game
export interface GameSettings {
  seed: number | "random";
  firstPlayer: PlayerId | "random";
  bot?: BotLevel;             // unset = Normal
}

export const DEFAULT_SETTINGS: GameSettings = { seed: "random", firstPlayer: "me", bot: "normal" };

export const randomSeed = () => Math.floor(Math.random() * 1e9);

export function resolveSettings(s: GameSettings): { seed: number; firstPlayer: PlayerId } {
  return {
    seed: s.seed === "random" ? randomSeed() : s.seed,
    firstPlayer: s.firstPlayer === "random" ? (Math.random() < 0.5 ? "me" : "bot") : s.firstPlayer,
  };
}
