// Measures bot strength: two levels play many games (swapping sides and who goes first), then count the results
// Slow, so it only runs when asked:  ARENA=1 A=hard B=normal N=20 MS=300 npm test -- src/bot/arena
import { describe, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import type { PlayerId } from "../engine/types";
import { playGame } from "./arena";
import { VanguardBot, type BotLevel } from "./index";

const env = process.env;
const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const decks = { me: deck, bot: deck };

describe.runIf(env.ARENA)("bot vs bot", () => {
  it("counts wins and losses", async () => {
    const N = Number(env.N ?? 20);
    const A = (env.A ?? "hard") as BotLevel, B = (env.B ?? "normal") as BotLevel;
    const tune = { ...(env.MS && { ms: Number(env.MS) }), ...(env.H && { horizon: Number(env.H) }) };
    let a = 0, b = 0;
    const t0 = Date.now();
    for (let g = 1; g <= N; g++) {
      const aSide: PlayerId = g % 2 ? "me" : "bot", bSide: PlayerId = aSide === "me" ? "bot" : "me";
      const bots = { [aSide]: new VanguardBot(db, A, decks, g, tune), [bSide]: new VanguardBot(db, B, decks, g + 7, tune) } as Record<PlayerId, VanguardBot>;
      const r = await playGame(db, decks, bots, 1000 + g, Math.floor(g / 2) % 2 ? "me" : "bot");
      if (r.winner === aSide) a++; else if (r.winner === bSide) b++;
    }
    console.log(`${A} ${a} - ${b} ${B}  (${N} games, ${((Date.now() - t0) / N / 1000).toFixed(1)} s/game)`);
  }, 24 * 3600 * 1000);
});
