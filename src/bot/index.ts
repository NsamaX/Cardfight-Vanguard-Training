// บอท 3 ระดับ ใช้กฎตัดสินใจชุดเดียวกัน (นับทริกเกอร์ที่เหลือจากการ์ดที่เปิดแล้ว คำนวณการ์ดทั้งเทิร์น) ต่างกันที่:
// Normal    = กฎตัดสินใจอย่างเดียว ไม่จำการ์ดที่คู่แข่งเปิดให้เห็น
// Hard      = จำการ์ดที่คู่แข่งเปิดให้เห็น (ไดรฟ์เช็ค ค้นขึ้นมือ) แล้วลองเล่นต่อในหัวทุกตัวเลือกจนจบเทิร์น
//             (สุ่มมือที่ไม่รู้จากการ์ดที่ยังไม่ปรากฏ) เลือกตัวที่ผลดีที่สุด
// Nightmare = เหมือน Hard แต่รู้มือคู่แข่งจริง จึงรู้ด้วยว่าในกองเหลือการ์ดอะไร (ไม่รู้ลำดับกอง)
import type { CardDB } from "../engine/rules";
import type { Action, Decision, Deck, GameEvent, GameState, PlayerId } from "../engine/types";
import { candidates, fallbacks, legal } from "./actions";
import { policy } from "./policy";
import { search, searchCandidates, type SearchConfig } from "./search";
import type { Bot } from "./types";
import { attachPools, viewFor, withHidden, type Reads } from "./view";

export type BotLevel = "normal" | "hard" | "nightmare";
export const BOT_LEVELS: BotLevel[] = ["normal", "hard", "nightmare"];

const CONFIG: Record<BotLevel, (SearchConfig & { memory: boolean; seesHand?: boolean }) | undefined> = {
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

  // tune: ปรับค่าการค้น (ใช้ตอนวัดผลบอทเล่นกันเอง ให้คิดเร็วขึ้น)
  constructor(db: CardDB, readonly level: BotLevel, private readonly decks: Record<PlayerId, Deck>, seed = Math.floor(Math.random() * 2 ** 31), tune?: Partial<SearchConfig>) {
    this.name = level;
    this.db = db;
    this.xdb = withHidden(db);
    this.seed = { v: seed | 1 };
    const base = CONFIG[level];
    this.cfg = base && { ...base, ...tune };
  }

  // ติดตามการต่อสู้: คู่แข่งการ์ดไหมก่อนโดนดาเมจ
  private guarded = false;
  private readonly reads: Reads = { oppPassive: 0, oppRevealedG3: false };

  observe(events: GameEvent[]) {
    if (!this.cfg?.memory) return;
    for (const e of events) {
      if (e.cardUid && (e.code === "drive-check" || e.text.key === "log.searchHand")) this.seen.add(e.cardUid);
      const opp = e.player !== this.side;
      if (e.code === "attack") this.guarded = false;
      if (opp && (e.code === "guard" || e.code === "intercept" || e.code === "g-guardian")) this.guarded = true;
      // คู่แข่งดาเมจ 4 ขึ้นไปแต่ปล่อยให้โดน = Shield บนมือน่าจะน้อย / การ์ดหนัก = ค่อย ๆ ลืม
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
    // ตรวจกับเกมจริงก่อนส่ง (ข้อมูลที่ซ่อนอาจทำให้ action ที่คิดไว้ผิดกฎ)
    if (legal(this.db, state, p, action)) return action;
    for (const a of [...fallbacks(state), ...candidates(this.db, state, p)]) if (legal(this.db, state, p, a)) return a;
    throw new Error("บอทหาการกระทำที่ถูกกฎไม่ได้");
  }
}
