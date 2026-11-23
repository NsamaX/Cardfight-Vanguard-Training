// บอท 3 ระดับ: ทุกระดับใช้กฎตัดสินใจชุดเดียวกัน (ไม่เล่นพลาดแบบชัด ๆ) ต่างกันที่ความลึกของการคิด
// Normal    = กฎตัดสินใจอย่างเดียว เล่นตามแบบแผน คำนวณการ์ดจากโอกาสเปิดทริกเกอร์
// Hard      = ลองเล่นต่อในหัวทุกตัวเลือกจนจบเทิร์น แล้วเลือกตัวที่ผลดีที่สุด
// Nightmare = มองถึงจบเทิร์นถัดไป (คิดถึงการป้องกันตอนใช้ทรัพยากร) คิดนานกว่า และจำการ์ดที่คู่แข่งเปิดให้เห็น
import type { CardDB } from "../engine/rules";
import type { Action, Decision, Deck, GameEvent, GameState, PlayerId } from "../engine/types";
import { candidates, fallbacks, legal } from "./actions";
import { policy } from "./policy";
import { search, searchCandidates, type SearchConfig } from "./search";
import type { Bot } from "./types";
import { viewFor, withHidden } from "./view";

export type BotLevel = "normal" | "hard" | "nightmare";
export const BOT_LEVELS: BotLevel[] = ["normal", "hard", "nightmare"];

const CONFIG: Record<BotLevel, (SearchConfig & { memory: boolean }) | undefined> = {
  normal: undefined,
  hard: { ms: 400, maxIter: 600, horizon: 0, margin: 0.2, memory: false },
  nightmare: { ms: 1500, maxIter: 2500, horizon: 1, margin: 0.12, memory: true },
};

export class VanguardBot implements Bot {
  readonly name: string;
  private readonly db: CardDB;
  private readonly xdb: CardDB;
  private readonly seen = new Set<string>();
  private readonly seed: { v: number };

  private readonly cfg: (SearchConfig & { memory: boolean }) | undefined;

  // tune: ปรับค่าการค้น (ใช้ตอนวัดผลบอทเล่นกันเอง ให้คิดเร็วขึ้น)
  constructor(db: CardDB, readonly level: BotLevel, private readonly decks: Record<PlayerId, Deck>, seed = Math.floor(Math.random() * 2 ** 31), tune?: Partial<SearchConfig>) {
    this.name = level;
    this.db = db;
    this.xdb = withHidden(db);
    this.seed = { v: seed | 1 };
    const base = CONFIG[level];
    this.cfg = base && { ...base, ...tune };
  }

  observe(events: GameEvent[]) {
    if (!this.cfg?.memory) return;
    for (const e of events) if (e.cardUid && (e.code === "drive-check" || e.text.key === "log.searchHand")) this.seen.add(e.cardUid);
  }

  async decide(state: GameState, decision: Decision): Promise<Action> {
    const p = decision.player;
    const view = viewFor(state, p, this.seen);
    const cfg = this.cfg;
    let action: Action = policy(this.xdb, view, p);
    if (cfg) {
      const cands = searchCandidates(this.xdb, view, p);
      if (cands.length > 1) action = (await search(this.xdb, view, this.decks, p, cands, cfg, this.seed)).action;
    }
    // ตรวจกับเกมจริงก่อนส่ง (ข้อมูลที่ซ่อนอาจทำให้ action ที่คิดไว้ผิดกฎ)
    if (legal(this.db, state, p, action)) return action;
    for (const a of [...fallbacks(state), ...candidates(this.db, state, p)]) if (legal(this.db, state, p, a)) return a;
    throw new Error("บอทหาการกระทำที่ถูกกฎไม่ได้");
  }
}
