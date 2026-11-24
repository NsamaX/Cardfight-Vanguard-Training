import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame, refreshAwaiting } from "../engine/game";
import { shieldOf } from "../engine/rules";
import type { CardInstance, GameState } from "../engine/types";
import { playGame } from "./arena";
import { VanguardBot } from "./index";
import { estimateDefense, nextTurnNeed } from "./intel";
import { damageCost, lethalGap, policy, triggerDist } from "./policy";
import { attachPools, deckOdds, determinize, HIDDEN, viewFor, withHidden } from "./view";
import { affordable, analyze, deckCombos, shieldForced } from "./combos";

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

describe("ไม่เล่นเสียเปล่า (จากเกมจริง seed 621023972)", () => {
  const inst = (s: GameState, key: string, faceUp = true): CardInstance =>
    ({ uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
  const MIST = "G-CHB03/S11TH", STORM = "G-BT06/083TH", GUNIT = "PR/0686TH", BONE = "G-BT06/040TH", MICK = "PR/0564TH", TOMMY = "G-CHB03/S12TH", STAR = "G-CHB03/002TH", DEWEY = "PR/0740TH";
  const bot = new VanguardBot(db, "normal", decks, 1);

  it("ไนท์สตอร์มจบการต่อสู้: ดรอปโซนไม่มีการ์ดให้คอล ไม่จ่าย CB", async () => {
    let s = createGame(db, { seed: 3, decks, firstPlayer: "bot" });
    s.players.bot.circles = { vc: inst(s, MIST), front_left: inst(s, STORM) };
    s.players.bot.circles.front_left!.hollowed = true;
    s.players.bot.gZone = [inst(s, GUNIT)];
    s.players.bot.damage = [inst(s, BONE)];
    s.players.bot.drop = [];
    s.players.me.circles = { vc: inst(s, MIST) };
    s.players.me.deck.unshift(inst(s, BONE, false));
    Object.assign(s, { turn: 4, turnPlayer: "bot", phase: "battle", step: "attack", mulliganDone: ["me", "bot"] });
    refreshAwaiting(s);
    s = apply(db, s, "bot", { type: "attack", attacker: "front_left", target: "vc" }).state;
    s = apply(db, s, "me", { type: "end-guard" }).state;
    expect(s.awaiting?.kind).toBe("order-queue");
    expect((await bot.decide(s, s.awaiting!)).type).toBe("decline-queue");
    s.players.bot.drop = [inst(s, BONE)];                                   // มีเนโครโบนให้คอล: ใช้
    expect((await bot.decide(s, s.awaiting!)).type).toBe("order-queue");
  });

  it("ดาเมจ 4: ไม่ใช้การ์ดกันเรียร์การ์ด ถ้าจะเหลือไม่พอกันแวนการ์ดที่ยังไม่ตีและโดนแล้วแพ้", async () => {
    const s = createGame(db, { seed: 3, decks, firstPlayer: "me" });
    s.players.me.circles = { vc: inst(s, GUNIT), front_left: inst(s, STAR), back_left: inst(s, BONE) };
    s.players.me.heart = inst(s, MIST);
    s.players.me.circles.vc!.mods.push({ stat: "critical", value: 1, source: "ผล", until: "turn-end" }, { stat: "power", value: 10000, source: "ผล", until: "turn-end" });
    s.players.me.circles.front_left!.rested = true;
    s.players.me.circles.back_left!.rested = true;
    s.players.bot.circles = { vc: inst(s, "MB/065TH") };
    s.players.bot.hand = [MICK, MICK, TOMMY].map((k) => inst(s, k));
    s.players.bot.damage = Array.from({ length: 4 }, () => inst(s, BONE));
    Object.assign(s, { turn: 7, turnPlayer: "me", phase: "battle", step: "guard", mulliganDone: ["me", "bot"],
      battle: { attacker: "front_left", booster: "back_left", target: "vc", drivesLeft: 0, damageLeft: 0 } });
    s.players.me.circles.front_left!.mods.push({ stat: "power", value: 7000, source: "บูสท์", until: "battle-end" });
    refreshAwaiting(s);
    expect((await bot.decide(s, s.awaiting!)).type).toBe("end-guard");    // รับไปดาเมจ 5 เก็บ 25,000 ไว้กันแวนการ์ด 36,000 Critical 2
  });

  it("เนโครนอร่าคอลลง GC เฉพาะการ์ดที่มี Shield", async () => {
    let s = createGame(db, { seed: 3, decks, firstPlayer: "me" });
    s.players.me.circles = { vc: inst(s, GUNIT) };
    s.players.me.heart = inst(s, MIST);
    s.players.bot.circles = { vc: inst(s, MIST) };
    s.players.bot.hand = [inst(s, DEWEY)];
    s.players.bot.gZone = [inst(s, GUNIT), inst(s, "G-FC04/043TH", false), inst(s, "G-FC04/043TH", false)];   // GB1
    s.players.bot.soul = [inst(s, BONE)];
    s.players.bot.drop = [inst(s, STORM), inst(s, "G-CP06/019TH"), inst(s, "PR/0632TH")];
    s.players.bot.damage = Array.from({ length: 4 }, () => inst(s, BONE));
    Object.assign(s, { turn: 7, turnPlayer: "me", phase: "battle", step: "guard", mulliganDone: ["me", "bot"],
      battle: { attacker: "vc", target: "vc", drivesLeft: 0, damageLeft: 0 } });
    refreshAwaiting(s);
    // แวนการ์ด 26,000 vs 11,000 ดาเมจ 4: มีแค่ Heal ใบเดียว ใช้เนโครนอร่า 15,000 + คอลแบนชี 10,000 กับเนโครเลซี่ 5,000 (ไม่เอาไนท์สตอร์ม Shield 0)
    for (let i = 0; i < 20 && s.awaiting?.player === "bot" && !(s.awaiting.kind === "guard" && s.players.bot.guardian.length); i++) {
      s = apply(db, s, "bot", await bot.decide(s, s.awaiting!)).state;
    }
    const gc = s.players.bot.guardian.map((g) => g.key);
    expect(gc).toContain("G-FC04/043TH");
    expect(gc).toContain("PR/0632TH");
    expect(gc).not.toContain(STORM);
  });
});

describe("สูตรของบอท", () => {
  const inst = (s: GameState, key: string, faceUp = true): CardInstance =>
    ({ uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });

  it("โอกาสทริกเกอร์นับแบบจั่วไม่คืนกอง (hypergeometric)", () => {
    expect(triggerDist(10, 5, 1)).toEqual([0.5, 0.5]);
    const d = triggerDist(10, 5, 2);
    expect(d[2]).toBeCloseTo((5 / 10) * (4 / 9));
    expect(d.reduce((n, x) => n + x, 0)).toBeCloseTo(1);
  });

  it("นับทริกเกอร์ที่เหลือในกองคู่แข่งจากการ์ดที่เปิดแล้ว (มองไม่เห็นกอง)", () => {
    const s = createGame(db, { seed: 3, decks, firstPlayer: "me" });
    const me = s.players.me;
    const trig = me.deck.filter((c) => db[c.key].trigger).slice(0, 8);
    me.deck = me.deck.filter((c) => !trig.includes(c));
    me.damage.push(...trig.slice(0, 5));
    me.drop.push(...trig.slice(5));
    const v = viewFor(s, "bot");
    attachPools(withHidden(db), v, decks);
    const odds = deckOdds(withHidden(db), v, "me");
    const unseen = me.deck.length + me.hand.length;
    const left = [...me.deck, ...me.hand].filter((c) => db[c.key].trigger).length;
    expect(odds.count((c) => !!c.trigger)).toBeCloseTo(left * me.deck.length / unseen);
    expect(left).toBe(16 - 8);
  });

  it("วงจรกรูนาช: ไนท์โรสเลือกคอลกรูนาชกลับ ได้ CC2 สองรอบ (CC4) ในเทิร์นเดียว", async () => {
    let s = createGame(db, { seed: 3, decks, firstPlayer: "bot" });
    const b = s.players.bot;
    b.circles = { vc: inst(s, "G-CHB03/S11TH"), back_center: inst(s, "G-TD08/014TH"), front_left: inst(s, "G-BT06/083TH") };
    b.circles.back_center!.hollowed = true;
    b.circles.front_left!.hollowed = true;
    b.gZone = [inst(s, "PR/0686TH"), inst(s, "PR/0686TH")];                     // GB2
    b.damage = Array.from({ length: 4 }, () => inst(s, "G-BT06/040TH", false));   // CB หมด
    s.players.me.circles = { vc: inst(s, "G-CHB03/S11TH") };
    Object.assign(s, { turn: 6, turnPlayer: "bot", phase: "battle", step: "attack", mulliganDone: ["me", "bot"] });
    refreshAwaiting(s);
    const bot = new VanguardBot(db, "normal", decks, 1);
    s = apply(db, s, "bot", { type: "next-phase" }).state;                        // จบเทิร์น
    for (let i = 0; i < 30 && s.turnPlayer === "bot" && s.awaiting?.player === "bot"; i++) s = apply(db, s, "bot", await bot.decide(s, s.awaiting!)).state;
    expect(s.turnPlayer).toBe("me");
    expect(s.players.bot.damage.filter((d) => d.faceUp)).toHaveLength(4);
  });
});

describe("สูตร pro: อ่านคู่แข่งและวางแผนทั้งเทิร์น", () => {
  const inst = (s: GameState, key: string, faceUp = true): CardInstance =>
    ({ uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] });
  const MIST = "G-CHB03/S11TH", GUNIT = "PR/0686TH", BONE = "G-BT06/040TH", MICK = "PR/0564TH";
  const xdb = withHidden(db);

  // ตาบอทในแบทเทิลเฟส: บอทมีแวนการ์ด G (26,000) + แถวหน้าตามที่ให้ คู่แข่ง (me) ดาเมจ dmg มือตามที่ให้
  function battle(dmg: number, hand: string[], front: Record<string, string> = {}) {
    const s = createGame(db, { seed: 3, decks, firstPlayer: "me" });
    s.players.bot.circles = { vc: inst(s, GUNIT), ...Object.fromEntries(Object.entries(front).map(([c, k]) => [c, inst(s, k)])) };
    s.players.bot.heart = inst(s, MIST);
    s.players.me.circles = { vc: inst(s, MIST) };
    s.players.me.hand = hand.map((k) => inst(s, k));
    s.players.me.damage = Array.from({ length: dmg }, () => inst(s, BONE));
    Object.assign(s, { turn: 6, turnPlayer: "bot", phase: "battle", step: "attack", mulliganDone: ["me", "bot"] });
    refreshAwaiting(s);
    return s;
  }
  const known = (s: GameState) => { const v = viewFor(s, "bot", new Set(s.players.me.hand.map((c) => c.uid))); attachPools(xdb, v, decks); return v; };

  it("ประเมินการป้องกันของคู่แข่ง: มือที่รู้ใช้ค่าจริง มือที่ไม่รู้ใช้ค่าเฉลี่ยจากการ์ดที่ยังไม่ปรากฏ", () => {
    const s = battle(3, [MICK, MICK, BONE]);
    expect(estimateDefense(xdb, known(s), "me").shield).toBe(25000);
    const v = viewFor(s, "bot");
    attachPools(xdb, v, decks);
    const e = estimateDefense(xdb, v, "me");
    expect(e.shield).toBeGreaterThan(5000);
    expect(e.shield).toBeLessThan(30000);
  });

  it("lethal: ดาเมจ 5 มือว่าง = ฆ่าได้ / มือมี Shield พอกันทุกลูก = ฆ่าไม่ได้", () => {
    const swings = [{ attacker: "vc" as const, power: 26000, crit: 1 }, { attacker: "front_left" as const, power: 21000, crit: 1 }];
    expect(lethalGap(xdb, known(battle(5, [])), "bot", swings)).toBeGreaterThan(0);
    expect(lethalGap(xdb, known(battle(5, [MICK, MICK, MICK, MICK])), "bot", swings)).toBeLessThanOrEqual(0);
  });

  it("เลือกเป้า: ตีแวนการ์ดไม่เข้า ตีเรียร์การ์ดที่ตีได้แทน", () => {
    const s = battle(2, [], { front_left: BONE });
    s.players.bot.circles.vc!.rested = true;
    s.players.me.circles.front_right = inst(s, BONE);   // 7,000 ตีเข้า (แวนการ์ด 11,000 ตีไม่เข้า)
    expect(policy(xdb, known(s), "bot")).toMatchObject({ type: "attack", attacker: "front_left", target: "front_right" });
  });

  it("Heal ช่วยให้รอดได้: ราคาโดนที่ดาเมจ 5 ต่ำกว่าแพ้แน่นอนเมื่อมีโอกาสเปิด Heal", () => {
    expect(damageCost(5, 1, 0)).toBe(25);
    expect(damageCost(5, 1, 0.25)).toBeLessThan(20);
  });

  it("แรงตีเทิร์นหน้าของคู่แข่ง: ดาเมจ 5 ต้องเก็บ Shield กันแวนการ์ดที่จะสไตรด์", () => {
    const s = battle(0, []);
    s.players.bot.damage = Array.from({ length: 5 }, () => inst(s, BONE));
    s.players.bot.circles = { vc: inst(s, MIST) };
    s.players.bot.heart = undefined;
    s.players.me.gZone = [inst(s, GUNIT, false)];
    expect(nextTurnNeed(xdb, s, "bot")).toBeGreaterThanOrEqual(15000);
  });

  it("คู่แข่งแสดงเกรด 3 จากมือ: มือที่สุ่มให้คู่แข่งมีเกรด 3 เสมอ", () => {
    const s = battle(2, [MICK, MICK, MICK]);
    const v = viewFor(s, "bot");
    attachPools(xdb, v, decks, { oppPassive: 0, oppRevealedG3: true });
    for (let seed = 1; seed <= 20; seed++) {
      expect(determinize(xdb, v, decks, seed).players.me.hand.some((c) => db[c.key].grade === 3)).toBe(true);
    }
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

describe("คอมโบของเด็ค", () => {
  it("หาคอมโบจากโค้ดความสามารถ จัดประเภท และเก็บชิ้นส่วนบนมือ", () => {
    const r = analyze(db, deck);
    const nightroseG = r.combos.find((c) => c.steps[0].key === "PR/0686TH" && c.steps[1]?.key === "PR/0256TH");
    expect(nightroseG?.kind).toBe("finisher");
    expect(nightroseG?.steps[1].at).toBe("drop");
    expect(r.combos.find((c) => c.steps[0].key === "G-CP08/S11TH")?.kind).toBe("defense");
    expect(r.combos.every((c) => c.score === c.value / c.difficulty)).toBe(true);
    expect(r.handPiece.get("G-CHB03/S12TH")).toBeGreaterThan(0);
  });

  it("เก็บทรัพยากร การโจมตี การป้องกัน การขัดขวางของคอมโบ", () => {
    const r = analyze(db, deck);
    const cannon = r.combos.find((c) => c.steps[0].key === "PR/0686TH" && c.steps[1]?.key === "G-BT06/087TH" && c.steps.length === 2)!.profile;
    expect(cannon).toMatchObject({ cb: 2, cbNeed: 2, gb: 1, flipG: 1, draw: 1, disrupt: { ownTurn: 1, oppTurn: 0 } });
    expect(cannon.attacks.some((a) => a.crit === 2)).toBe(true);
    const grunash = r.combos.find((c) => c.steps.every((s) => s.key === "G-TD08/014TH") && c.profile.cc > 0)!.profile;
    expect(grunash).toMatchObject({ cc: 2, gb: 1, cb: 0 });
    const nora = r.combos.find((c) => c.steps[0].key === "G-FC04/043TH" && c.steps.length === 2)!.profile;
    expect(nora.shield).toBeGreaterThan(15000);
    expect(nora).toMatchObject({ sb: 1, flipG: 1, gb: 1 });
    // การโจมตีที่ไม่ถึงแวนการ์ดคู่แข่งไม่บังคับให้ใช้การ์ด
    expect(shieldForced({ ...cannon, attacks: [{ power: 9000, crit: 1 }, { power: 16000, crit: 1 }] }, 11000)).toBe(10000);
    expect(affordable(cannon, { cb: 1, sb: 0, gb: 1, gFaceDown: 2, deck: 20 })).toBe(false);
    expect(affordable(cannon, { cb: 2, sb: 0, gb: 1, gFaceDown: 2, deck: 20 })).toBe(true);
    expect(affordable(cannon, { cb: 2, sb: 0, gb: 1, gFaceDown: 2, deck: 1 })).toBe(false);
  });

  it("เด็คเดิมใช้คอมโบที่บันทึกไว้ เด็คที่ถูกแก้คิดใหม่", () => {
    const a = deckCombos(db, deck);
    expect(deckCombos(db, { ...deck })).toBe(a);
    const edited = { ...deck, main: { ...deck.main, "PR/0256TH": 1 } };
    expect(deckCombos(db, edited)).not.toBe(a);
  });

  it("เปลี่ยนมือ: ไรด์ไม่ถึงเกรด 3 = เลือกใหม่ เก็บแค่เส้นไรด์ (ไม่เก็บชิ้นส่วนคอมโบอื่น)", () => {
    const xdb = withHidden(db);
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = createGame(db, { seed, decks, firstPlayer: "bot" });
      const hand = s.players.bot.hand;
      const grades = new Set(hand.filter((h) => [1, 2, 3].includes(db[h.key].grade)).map((h) => db[h.key].grade));
      if (grades.size === 3) continue;
      checked++;
      const v = viewFor(s, "bot");
      attachPools(xdb, v, decks);
      const a = policy(xdb, v, "bot") as Extract<ReturnType<typeof policy>, { type: "mulligan" }>;
      expect(hand.length - a.returnUids.length).toBe(grades.size);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("เปลี่ยนมือ: เก็บเส้นทางไรด์ไว้เสมอ", () => {
    const xdb = withHidden(db);
    for (let seed = 1; seed <= 20; seed++) {
      const s = createGame(db, { seed, decks, firstPlayer: "bot" });
      const v = viewFor(s, "bot");
      attachPools(xdb, v, decks);
      const a = policy(xdb, v, "bot") as Extract<ReturnType<typeof policy>, { type: "mulligan" }>;
      const kept = s.players.bot.hand.filter((h) => !a.returnUids.includes(h.uid));
      for (const g of [1, 2, 3]) {
        if (s.players.bot.hand.some((h) => db[h.key].grade === g)) expect(kept.some((h) => db[h.key].grade === g)).toBe(true);
      }
    }
  });
});
