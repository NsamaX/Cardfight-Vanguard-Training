import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame, refreshAwaiting } from "./game";
import { powerOf, shieldOf } from "./rules";
import type { Action, CardInstance, GameState, PlayerId } from "./types";

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const K = {
  mist: "G-CHB03/S11TH", star: "G-CHB03/002TH", gun: "G-BT06/087TH", serp: "PR/0256TH", bone: "G-BT06/040TH",
  lazy: "G-CP06/019TH", tommy: "G-CHB03/S12TH", dewey: "PR/0740TH", crit: "PR/0632TH", rampage: "G-BT08/S32TH",
  gunit: "PR/0686TH", lily: "G-CP08/S11TH", spout: "G-BT06/S11TH",
};

let s: GameState;
const act = (p: PlayerId, a: Action) => { s = apply(db, s, p, a).state; };
const pick = (p: PlayerId, ...uids: string[]) => act(p, { type: "select-target", uids });
const to = (p: PlayerId, circle: NonNullable<Extract<Action, { type: "select-target" }>["to"]>) => act(p, { type: "select-target", uids: [], to: circle });

function inst(key: string, faceUp = true): CardInstance {
  return { uid: "t" + s.nextUid++, key, rested: false, faceUp, hollowed: false, mods: [], usedThisTurn: [], grants: [] };
}

function newGame() {
  s = createGame(db, { seed: 11, firstPlayer: "me", decks: { me: deck, bot: deck } });
  act("me", { type: "mulligan", returnUids: [] });
  act("bot", { type: "mulligan", returnUids: [] });
  // เทสต์ในไฟล์นี้จัดสนามเอง ไม่ใช้ G อาซิสต์ของเทิร์นแรก
  if (s.queue.some((e) => e.key === "g-assist")) act("me", { type: "decline-queue", index: 0 });
}

// ความสามารถที่รออยู่ในคิว (ชื่อมีคำนี้): use = กดใช้ (ไม่ถามคอสต์ซ้ำ) / skip = ไม่ใช้
function queued(p: PlayerId, word: string, key?: string) {
  expect(s.awaiting?.kind).toBe("order-queue");
  const i = s.queue.filter((e) => e.owner === p).findIndex((e) => e.label.includes(word) && (key === undefined || e.key === key));
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}
const use = (p: PlayerId, word: string, key?: string) => act(p, { type: "order-queue", index: queued(p, word, key) });
const skip = (p: PlayerId, word: string, key?: string) => act(p, { type: "decline-queue", index: queued(p, word, key) });

describe("คอมโบยิงนอกเทิร์น (content/combos/off-turn-shot.yaml)", () => {
  function setup() {
    newGame();
    const me = s.players.me, bot = s.players.bot;
    me.circles = { vc: inst(K.mist), front_left: inst(K.gun), front_right: inst(K.serp), back_left: inst(K.bone), back_right: inst(K.lazy) };
    me.hand = [inst(K.dewey), inst(K.star), inst(K.spout)];
    me.damage = [inst(K.star), inst(K.serp), inst(K.bone), inst(K.star, false)];
    me.soul = [inst(K.bone), inst(K.bone), inst(K.bone)];
    me.drop = [inst(K.tommy), inst(K.dewey), inst(K.crit)];
    me.gZone = [inst(K.gunit), inst(K.gunit), inst(K.lily, false), inst(K.lily, false), inst(K.gunit, false)];
    bot.circles = { vc: inst(K.gunit), front_left: inst(K.lazy), front_right: inst(K.gun), back_center: inst(K.bone) };
    bot.heart = inst(K.star);
    bot.circles.vc!.rested = true;
    bot.circles.vc!.mods.push({ stat: "power", value: 7000, source: "บูสท์", until: "battle-end" });
    bot.deck.unshift(inst(K.gun, false), inst(K.gun, false), inst(K.gun, false));
    Object.assign(s, { turn: 4, turnPlayer: "bot", phase: "battle", step: "guard",
      battle: { attacker: "vc", booster: "back_center", target: "vc", drivesLeft: 0, damageLeft: 0 } });
    refreshAwaiting(s);
  }

  it("เล่นครบสายได้: กันได้ ยิงเรียร์การ์ดบอท จั่ว และได้ CC คืน", () => {
    setup();
    expect(powerOf(db, s.players.bot, "vc")).toBe(33000);
    const gun = s.players.me.circles.front_left!.uid;
    const tommy = s.players.me.drop[0].uid;
    const otherDewey = s.players.me.drop[1].uid;
    const botLazy = s.players.bot.circles.front_left!.uid;
    const lily = s.players.me.gZone[2].uid;

    act("me", { type: "call-g-guardian", gUid: lily, discardUid: s.players.me.hand[0].uid });
    expect(s.awaiting?.kind).toBe("order-queue");                 // เดวย์ + เนโครลิลลี่ ทำงานพร้อมกัน
    use("me", "Dewey");                                           // จ่ายคอสต์ไบนด์
    pick("me", otherDewey);                                       // ไบนด์ Heal อีกใบจากดรอป
    act("me", { type: "choose", option: "CC(1)" });
    expect(s.players.me.damage.filter((d) => d.faceUp)).toHaveLength(4);

    use("me", "Negrolily");                                     // CB1 + รีไทร์เรียร์การ์ดตัวเอง
    pick("me", gun);
    pick("me", tommy);                                            // คอลผีน้อยจากดรอป
    to("me", "back_center");
    expect(shieldOf(db, s.players.me.guardian[0])).toBe(25000);

    use("me", "Night Fog");                                   // ไนท์โรสทำงานเพราะเรียร์การ์ดตกดรอป: mill 3
    pick("me", gun);
    to("me", "front_left");

    use("me", "Skeleton Cannoneer", "0");                                  // ฮอลโล่ว์ก่อน เพื่อให้ได้จั่ว
    const hand = s.players.me.hand.length;
    use("me", "Skeleton Cannoneer");                                       // CB1 ยิงเรียร์การ์ดบอท
    pick("me", botLazy);
    expect(s.players.bot.circles.front_left).toBeUndefined();
    expect(s.players.me.hand).toHaveLength(hand + 1);

    expect(s.awaiting).toMatchObject({ player: "me", kind: "guard" });
    act("me", { type: "end-guard" });
    expect(s.players.me.damage).toHaveLength(4);                  // 33,000 vs 36,000 ไม่ฮิท
    expect(s.players.me.damage.filter((d) => d.faceUp)).toHaveLength(2);
    expect(s.players.me.circles.front_left).toMatchObject({ key: K.gun, hollowed: true });
    expect(s.players.me.circles.back_center?.key).toBe(K.tommy);
    expect(s.players.me.bind.map((c) => c.key)).toEqual([K.dewey, K.dewey]);
    expect(s.players.me.gZone.find((g) => g.uid === lily)?.faceUp).toBe(true);
    expect(s.battle).toBeUndefined();
  });

  it("เลือก CC(1) ตอนดาเมจคว่ำหลายใบ: ถามว่าหงายใบไหน แล้วทำต่อ ไม่ถามผลซ้ำ", () => {
    setup();
    for (const d of s.players.me.damage) d.faceUp = false;
    act("me", { type: "call-g-guardian", gUid: s.players.me.gZone[2].uid, discardUid: s.players.me.hand[0].uid });
    use("me", "Dewey");
    pick("me", s.players.me.drop.find((d) => d.key === K.dewey)!.uid);
    act("me", { type: "choose", option: "CC(1)" });
    expect(s.awaiting?.choice?.kind).toBe("cards");
    const chosen = s.players.me.damage[2].uid;
    pick("me", chosen);
    expect(s.players.me.damage.filter((d) => d.faceUp).map((d) => d.uid)).toEqual([chosen]);
    expect(s.awaiting?.kind).toBe("order-queue");
  });

  it("ไม่จ่ายคอสต์ได้ และถ้าไม่มีความสามารถรออยู่ก็กลับมาการ์ดต่อ", () => {
    setup();
    act("me", { type: "call-g-guardian", gUid: s.players.me.gZone[2].uid, discardUid: s.players.me.hand[0].uid });
    skip("me", "Negrolily");
    skip("me", "Dewey");
    expect(s.awaiting).toMatchObject({ player: "me", kind: "guard" });
    expect(shieldOf(db, s.players.me.guardian[0])).toBe(15000);
  });

  it("ตอบผิดถูกปฏิเสธ และทำอย่างอื่นระหว่างรอคำตอบไม่ได้", () => {
    setup();
    act("me", { type: "call-g-guardian", gUid: s.players.me.gZone[2].uid, discardUid: s.players.me.hand[0].uid });
    expect(() => act("me", { type: "end-guard" })).toThrow("err.resolveFirst");
    expect(() => skip("me", "Nightrose")).toThrow();
    use("me", "Negrolily");
    expect(() => pick("me", s.players.bot.circles.front_left!.uid)).toThrow();
  });
});

describe("ฮอลโล่ว์ในเอนด์เฟส", () => {
  function setup() {
    newGame();
    const me = s.players.me;
    me.circles = { vc: inst(K.gunit), front_left: inst(K.gun) };
    me.heart = inst(K.mist);
    me.circles.front_left!.hollowed = true;
    me.gZone = [inst(K.gunit), inst(K.lily, false)];
    s.players.bot.circles.vc = inst(K.mist);
    Object.assign(s, { turn: 3, turnPlayer: "me", phase: "battle", step: "attack" });
    refreshAwaiting(s);
  }

  it("G ยูนิทกลับ G โซนก่อน แล้วไนท์โรสคอลยูนิทที่ถูกรีไทร์กลับมาได้", () => {
    setup();
    const gun = s.players.me.circles.front_left!.uid;
    act("me", { type: "next-phase" });
    expect(s.players.me.circles.vc?.key).toBe(K.mist);            // ฮาร์ทกลับเป็นแวนการ์ดแล้ว
    use("me", "Night Fog");
    pick("me", gun);
    to("me", "front_left");
    skip("me", "Skeleton Cannoneer", "0");                                 // ไม่ติดฮอลโล่ว์
    // ความสามารถยิง (CB1) ถูกข้ามเองเพราะไม่มีดาเมจหงายให้จ่าย
    expect(s.turnPlayer).toBe("bot");
    expect(s.players.me.circles.front_left).toMatchObject({ uid: gun, hollowed: false });
  });

  it("ติดฮอลโล่ว์ซ้ำ ถูกรีไทร์อีกรอบ และไนท์โรสใช้ซ้ำไม่ได้ (1/Turn)", () => {
    setup();
    act("me", { type: "next-phase" });
    use("me", "Night Fog");
    pick("me", s.players.me.drop.find((c) => c.key === K.gun)!.uid);
    to("me", "front_left");
    use("me", "Skeleton Cannoneer", "0");                                  // ติดฮอลโล่ว์อีก
    expect(s.turnPlayer).toBe("bot");
    expect(s.players.me.circles.front_left).toBeUndefined();
    expect(s.players.me.drop.some((c) => c.key === K.gun)).toBe(true);
  });
});

describe("กดถัดไปตอนมีความสามารถรอ", () => {
  it("ไม่ใช้แบบเลือกได้ทั้งหมด แล้วเกมเดินต่อ", () => {
    newGame();
    const me = s.players.me;
    me.circles = { vc: inst(K.gunit), front_left: inst(K.gun) };
    me.heart = inst(K.mist);
    me.circles.front_left!.hollowed = true;
    me.gZone = [inst(K.gunit), inst(K.lily, false)];
    s.players.bot.circles.vc = inst(K.mist);
    Object.assign(s, { turn: 3, turnPlayer: "me", phase: "battle", step: "attack" });
    refreshAwaiting(s);
    act("me", { type: "next-phase" });
    expect(s.queue.map((e) => e.optional)).toEqual([true]);       // ไนท์โรส (mill 3) รออยู่
    act("me", { type: "pass-queue" });
    expect(s.queue).toHaveLength(0);
    expect(s.passQueue).toBeUndefined();
    expect(s.turnPlayer).toBe("bot");
    expect(s.players.me.circles.front_left).toBeUndefined();
  });
});

describe("ความสามารถอื่น", () => {
  it("ไนท์สตอร์ม: จบการต่อสู้ที่โจมตีแวนการ์ด คอลจากดรอปลง RC ไหนก็ได้ที่ไม่ใช่ช่องของตัวเอง (คอลทับได้)", () => {
    newGame();
    const me = s.players.me;
    me.circles = { vc: inst(K.mist), front_left: inst("G-BT06/083TH"), front_right: inst("G-TD08/007TH") };
    me.circles.front_left!.hollowed = true;
    me.gZone = [inst(K.gunit)];
    me.damage = [inst(K.bone)];
    me.drop = [inst(K.gun)];
    s.players.bot.circles = { vc: inst(K.mist) };
    s.players.bot.deck.unshift(inst(K.bone, false));
    Object.assign(s, { turn: 3, turnPlayer: "me", phase: "battle", step: "attack" });
    refreshAwaiting(s);
    act("me", { type: "attack", attacker: "front_left", target: "vc" });
    act("bot", { type: "end-guard" });
    use("me", "Nightstorm");
    pick("me", me.drop[0].uid);
    expect(s.awaiting?.choice).toMatchObject({ kind: "circle", options: ["front_right", "back_left", "back_center", "back_right"] });
    to("me", "front_right");
    expect(s.players.me.circles.front_right?.key).toBe(K.gun);
  });

  it("แรมเพจ·เชด: เมื่อแวนการ์ดไนท์โรสโจมตี เข้าโซล จั่ว และแวนการ์ด Power+5000", () => {
    newGame();
    const me = s.players.me;
    me.circles = { vc: inst(K.mist), back_left: inst(K.rampage) };
    s.players.bot.circles.vc = inst(K.mist);
    Object.assign(s, { turn: 3, turnPlayer: "me", phase: "battle", step: "attack" });
    refreshAwaiting(s);
    const hand = me.hand.length;
    act("me", { type: "attack", attacker: "vc", target: "vc" });
    use("me", "Rampage Shade");
    expect(s.players.me.circles.back_left).toBeUndefined();
    expect(s.players.me.soul.some((c) => c.key === K.rampage)).toBe(true);
    expect(s.players.me.hand).toHaveLength(hand + 1);
    expect(powerOf(db, s.players.me, "vc")).toBe(16000);
  });

  it("แบนชีน้ำวน: ใช้ ACT ในเมนเฟส เข้าโซลแล้วจั่ว", () => {
    newGame();
    const me = s.players.me;
    me.circles = { vc: inst(K.mist), back_left: inst("PR/0632TH") };
    Object.assign(s, { turn: 3, turnPlayer: "me", phase: "main", step: undefined });
    refreshAwaiting(s);
    const hand = me.hand.length;
    act("me", { type: "activate", cardUid: me.circles.back_left!.uid, abilityIndex: 0 });
    expect(s.players.me.soul.some((c) => c.key === "PR/0632TH")).toBe(true);
    expect(s.players.me.hand).toHaveLength(hand + 1);
  });

  it("คิง·เซอเพนท์: เข้า RC จากดรอปโซนแล้ว SC1 + CC1 อัตโนมัติ (ไม่มีคอสต์ ไม่ต้องถาม)", () => {
    newGame();
    const me = s.players.me;
    me.circles = { vc: inst(K.mist), front_left: inst(K.serp) };
    me.damage = [inst(K.star, false)];
    me.gZone = [inst(K.gunit), inst(K.gunit)];
    s.players.bot.circles.vc = inst(K.mist);
    me.circles.front_left!.hollowed = true;
    Object.assign(s, { turn: 3, turnPlayer: "me", phase: "battle", step: "attack" });
    refreshAwaiting(s);
    const soul = me.soul.length;
    act("me", { type: "next-phase" });   // เอนด์เฟส: เซอเพนท์ (ฮอลโล่ว์) ถูกรีไทร์ ไนท์โรสคอลกลับ
    use("me", "Night Fog");
    pick("me", s.players.me.drop.find((c) => c.key === K.serp)!.uid);
    to("me", "front_left");
    expect(s.players.me.soul).toHaveLength(soul + 1);
    expect(s.players.me.damage[0].faceUp).toBe(true);
  });
});

describe("ลำดับความสามารถที่ทำงานพร้อมกัน", () => {
  it("เนโครเลซี่คอลผีน้อยมิคฯ จากดรอป: ติดฮอลโล่ว์ก่อน แล้วเอฟเฟคบวกพลังทำงาน", () => {
    newGame();
    const me = s.players.me;
    me.circles = { vc: inst(K.mist), front_left: inst(K.gun) };
    me.hand = [inst(K.lazy)];
    me.damage = [inst(K.star)];
    me.soul = [inst(K.bone)];
    me.drop = [inst("PR/0564TH")];
    me.gZone = [inst(K.gunit)];
    Object.assign(s, { turn: 3, turnPlayer: "me", phase: "main", step: undefined });
    refreshAwaiting(s);
    act("me", { type: "call", uid: me.hand[0].uid, to: "back_left" });
    skip("me", "Negrolazy", "0");                                // ไม่ติดฮอลโล่ว์ให้เลซี่
    use("me", "Negrolazy");                                      // CB1 + SB1 คอลมิคจากดรอป
    pick("me", s.players.me.drop.find((c) => c.key === "PR/0564TH")!.uid);
    to("me", "back_right");
    use("me", "Mick", "0");                                        // ติดฮอลโล่ว์ก่อน
    expect(s.awaiting?.choice?.kind).toBe("cards");               // เอฟเฟคบวกพลังของมิคทำงานต่อ
    pick("me", s.players.me.circles.front_left!.uid);
    expect(powerOf(db, s.players.me, "front_left")).toBe(db[K.gun].power! + 10000);
  });

  it("เนโครโบนบูสท์เรียร์การ์ด (GB1, แวนการ์ดไนท์โรส): จบการต่อสู้แล้วรีไทร์ตัวที่ถูกบูสท์และคอลจากดรอป", () => {
    newGame();
    const me = s.players.me;
    me.circles = { vc: inst(K.mist), front_left: inst(K.gun), back_left: inst(K.bone) };
    me.damage = [inst(K.star)];
    me.drop = [inst(K.lazy)];
    me.gZone = [inst(K.gunit)];
    s.players.bot.circles = { vc: inst(K.mist) };
    Object.assign(s, { turn: 3, turnPlayer: "me", phase: "battle", step: "attack" });
    refreshAwaiting(s);
    const gun = me.circles.front_left!.uid;
    act("me", { type: "attack", attacker: "front_left", target: "vc", booster: "back_left" });
    act("bot", { type: "end-guard" });
    while (s.awaiting?.kind === "trigger-target") act(s.awaiting.player, { type: "trigger-target", powerTo: "vc", extraTo: "vc" });
    use("me", "Negrobone");
    pick("me", s.players.me.drop.find((c) => c.key === K.lazy)!.uid);
    to("me", "front_left");
    expect(s.players.me.drop.some((c) => c.uid === gun)).toBe(true);
    expect(s.players.me.circles.front_left?.key).toBe(K.lazy);
  });
});
