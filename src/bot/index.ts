// 3 bot levels share the same decision rules (count remaining triggers from revealed cards, compute guards for the whole turn); they differ in:
// Normal    = decision rules only, doesn't remember cards the opponent revealed
// Hard      = remembers cards the opponent revealed (drive checks, searches to hand) and plays every option forward in its head to the end of the turn
//             (unknown hand cards randomized from cards not yet seen), then picks the best
// Nightmare = like Hard but knows the opponent's real hand, so it also knows what's left in the deck (not the deck order)
import type { CardDB } from "../engine/rules";
import type { Action, Decision, Deck, GameEvent, GameState, PlayerId } from "../engine/types";
import { candidates, fallbacks, legal } from "./actions";
import { policy } from "./policy";
import { search, searchCandidates, type SearchConfig } from "./search";
import type { Bot } from "./types";
import { attachPools, viewFor, withHidden, type Reads } from "./view";

// Beta = Nightmare's settings; while in beta it's the only level players can pick
export type BotLevel = "beta" | "normal" | "hard" | "nightmare";
export const BOT_LEVELS: BotLevel[] = ["beta", "normal", "hard", "nightmare"];
export const SELECTABLE_BOT_LEVELS: BotLevel[] = ["beta"];

const CONFIG: Record<BotLevel, (SearchConfig & { memory: boolean; seesHand?: boolean }) | undefined> = {
  beta: { ms: 1500, maxIter: 4000, horizon: 0, margin: 0.15, memory: true, seesHand: true },
  normal: undefined,
  hard: { ms: 1500, maxIter: 4000, horizon: 0, margin: 0.15, memory: true },
  nightmare: { ms: 1500, maxIter: 4000, horizon: 0, margin: 0.15, memory: true, seesHand: true },
};

export class VanguardBot implements Bot {
  readonly name: string;
  private readonly db: CardDB;
  private readonly xdb: CardDB;
  private readonly seen = new Set<string>();
  private readonly seed: { v: number };

  private readonly cfg: (SearchConfig & { memory: boolean; seesHand?: boolean }) | undefined;

  // tune: search settings (used when measuring bots against each other, to think faster)
  constructor(db: CardDB, readonly level: BotLevel, private readonly decks: Record<PlayerId, Deck>, seed = Math.floor(Math.random() * 2 ** 31), tune?: Partial<SearchConfig>) {
    this.name = level;
    this.db = db;
    this.xdb = withHidden(db);
    this.seed = { v: seed | 1 };
    const base = CONFIG[level];
    this.cfg = base && { ...base, ...tune };
  }

  // Track battles: did the opponent guard before taking damage?
  private guarded = false;
  private readonly reads: Reads = { oppPassive: 0, oppRevealedG3: false };

  observe(events: GameEvent[]) {
    if (!this.cfg?.memory) return;
    for (const e of events) {
      if (e.cardUid && (e.code === "drive-check" || e.text.key === "log.searchHand")) this.seen.add(e.cardUid);
      const opp = e.player !== this.side;
      if (e.code === "attack") this.guarded = false;
      if (opp && (e.code === "guard" || e.code === "intercept" || e.code === "g-guardian")) this.guarded = true;
      // Opponent at damage 4+ but let it through = probably little Shield in hand / heavy guard = gradually forget
      if (opp && e.code === "damage" && !this.guarded && Number(e.text.params?.n ?? 0) >= 5) this.reads.oppPassive++;
      if (opp && e.code === "guard" && this.reads.oppPassive > 0) this.reads.oppPassive -= 0.5;
      if (opp && e.code === "reveal") this.reads.oppRevealedG3 = true;
      if (e.code === "turn-start") this.reads.oppRevealedG3 = false;
    }
  }

  private side: PlayerId = "bot";

  async decide(state: GameState, decision: Decision): Promise<Action> {
    const p = decision.player;
    this.side = p;
    const cfg = this.cfg;
    const known = cfg?.seesHand ? new Set([...this.seen, ...state.players[p === "me" ? "bot" : "me"].hand.map((c) => c.uid)]) : this.seen;
    const view = viewFor(state, p, known);
    attachPools(this.xdb, view, this.decks, this.reads);
    let action: Action = policy(this.xdb, view, p);
    if (cfg) {
      const cands = searchCandidates(this.xdb, view, p);
      if (cands.length > 1) action = (await search(this.xdb, view, this.decks, p, cands, cfg, this.seed)).action;
    }
    // Check against the real game before sending (hidden information can make the planned action illegal)
    if (legal(this.db, state, p, action)) return action;
    for (const a of [...fallbacks(state), ...candidates(this.db, state, p)]) if (legal(this.db, state, p, a)) return a;
    throw new Error("bot found no legal action");
  }
}
