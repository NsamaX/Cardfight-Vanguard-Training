import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame, refreshAwaiting } from "../engine/game";
import { shieldOf } from "../engine/rules";
import type { CardInstance, GameState } from "../engine/types";
import { playGame } from "./arena";
import { VanguardBot } from "./index";
import { determinize, HIDDEN, viewFor, withHidden } from "./view";

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const decks = { me: deck, bot: deck };

describe("ข้อมูลที่บอทเห็น", () => {
  it("ซ่อนมือคู่แข่งและกองการ์ด แล้วสุ่มเติมได้ครบตามรายการเด็ค", () => {
    const s = createGame(db, { seed: 7, decks, firstPlayer: "me" });
    const v = viewFor(s, "bot");
    expect(v.players.me.hand.every((c) => c.key === HIDDEN)).toBe(true);
    expect(v.players.bot.hand.every((c) => c.key !== HIDDEN)).toBe(true);
    expect(v.players.bot.deck.every((c) => c.key === HIDDEN)).toBe(true);
    expect(v.rngState).toBe(0);
    const d = determinize(withHidden(db), v, decks, 123);
    const count = (st: GameState) => {
      const m = new Map<string, number>();
      for (const ps of Object.values(st.players)) for (const c of [...ps.hand, ...ps.deck, ps.circles.vc!]) m.set(c.key, (m.get(c.key) ?? 0) + 1);
      return m;
    };
    expect(count(d)).toEqual(count(s));
    expect(d.players.bot.hand.map((c) => c.key)).toEqual(s.players.bot.hand.map((c) => c.key));
  });
});

describe("ตัดสินใจการ์ด", () => {
  const inst = (s: GameState, key: string, faceUp = true): CardInstance =>
    ({ uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
  const MIST = "G-CHB03/S11TH", ROOK = "G-TD08/007TH", BONE = "G-BT06/040TH", MICK = "PR/0564TH", LAZY = "G-CP06/019TH", SPOUT = "G-BT06/S11TH";

  // บอทถูกแวนการ์ด 21,000 โจมตี (แวนการ์ดบอท 11,000) บนมือมี Shield รวม 25,000
  function attacked(damage: number, target: "vc" | "front_left" = "vc", hand = [MICK, MICK, LAZY]) {
    const s = createGame(db, { seed: 3, decks, firstPlayer: "me" });
    s.players.me.circles = { vc: inst(s, MIST), back_center: inst(s, BONE) };
    s.players.me.circles.vc!.mods.push({ stat: "power", value: 10000, source: "บูสท์", until: "battle-end" });
    s.players.bot.circles = { vc: inst(s, MIST), front_left: inst(s, ROOK) };
    s.players.bot.hand = hand.map((k) => inst(s, k));
    s.players.bot.damage = Array.from({ length: damage }, () => inst(s, BONE));
    Object.assign(s, { turn: 5, turnPlayer: "me", phase: "battle", step: "guard", mulliganDone: ["me", "bot"],
      battle: { attacker: "vc", booster: "back_center", target, drivesLeft: 0, damageLeft: 0 } });
    refreshAwaiting(s);
    return s;
  }
  const bot = new VanguardBot(db, "normal", decks, 1);

  it("ดาเมจ 5 โดนแวนการ์ดโจมตี: การ์ดให้ผ่านทริกเกอร์ได้ ไม่ปล่อยให้แพ้", async () => {
    const s = attacked(5);
    const a = await bot.decide(s, s.awaiting!);
    expect(a.type).toBe("guard");
    const r = apply(db, s, "bot", a).state;
    const shield = r.players.bot.guardian.reduce((n, g) => n + shieldOf(db, g), 0);
    expect(11000 + shield).toBeGreaterThan(21000 + 5000);   // กันได้แม้เปิดทริกเกอร์ 1 ใบ
  });

  it("ดาเมจ 5 มีพิทักษ์: ใช้พิทักษ์ (เสีย 2 ใบ) แทนการ์ด 3 ใบ", async () => {
    const s = attacked(5, "vc", [MICK, MICK, LAZY, SPOUT, BONE]);
    s.players.me.circles.vc!.mods.push({ stat: "power", value: 10000, source: "ผล", until: "battle-end" });
    const a = await bot.decide(s, s.awaiting!);
    expect(a).toMatchObject({ type: "guard", uids: [s.players.bot.hand[3].uid] });
  });

  it("ดาเมจ 1 โดนเรียร์การ์ดโจมตีเรียร์การ์ด: ไม่เสียการ์ดกัน", async () => {
    const s = attacked(1, "front_left");
    expect((await bot.decide(s, s.awaiting!)).type).toBe("end-guard");
  });
});

describe("บอทเล่นกันเอง", () => {
  it("Normal เล่นจนจบเกมได้ทุก seed โดยไม่มี action ผิดกฎ", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const bots = { me: new VanguardBot(db, "normal", decks, seed), bot: new VanguardBot(db, "normal", decks, seed + 99) };
      const r = await playGame(db, decks, bots, seed, seed % 2 ? "me" : "bot");
      expect(r.winner, `seed ${seed}`).toBeDefined();
    }
  }, 60000);
});
