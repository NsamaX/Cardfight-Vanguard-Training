import { describe, expect, it } from "vitest";
import { cardByKey as db } from "../data/cards";
import { presetDecks } from "../data/decks";
import { apply, createGame } from "./game";
import { powerOf } from "./rules";
import type { Action, CardInstance, Circle, GameState, PlayerId } from "./types";

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const K = {
  mist: "G-CHB03/S11TH",   // เกรด 3, 11000
  star: "G-CHB03/002TH",   // เกรด 3, 11000
  gun: "G-BT06/087TH",     // เกรด 2, 9000
  bone: "G-BT06/040TH",    // เกรด 1, 7000
  crit: "PR/0632TH",       // Critical trigger, 4000
  heal: "PR/0740TH",       // Heal trigger
  gunit: "PR/0686TH",      // G ยูนิท 15000+
  lily: "G-CP08/S11TH",    // G การ์เดี้ยน Shield 15000
};

// เทสต์ชุดนี้ทดสอบกฎพื้นฐาน จึงตอบ "ไม่ใช้" ทุกความสามารถที่ถามขึ้นมา (เทสต์ความสามารถอยู่ใน abilities.test.ts)
export function declineAll(s: GameState): GameState {
  for (let i = 0; i < 50 && s.awaiting; i++) {
    const w = s.awaiting, c = w.choice;
    if (w.kind === "order-queue") s = apply(db, s, w.player, { type: "order-queue", index: 0 }).state;
    else if (c?.kind === "yesno") s = apply(db, s, w.player, { type: "choose", option: "no" }).state;
    else if (c?.kind === "option") s = apply(db, s, w.player, { type: "choose", option: c.options[0] }).state;
    else if (c?.kind === "cards") s = apply(db, s, w.player, { type: "select-target", uids: c.options.slice(0, c.min) }).state;
    else if (c?.kind === "circle") s = apply(db, s, w.player, { type: "select-target", uids: [] }).state;
    else break;
  }
  return s;
}
const act = (s: GameState, p: PlayerId, a: Action) => declineAll(apply(db, s, p, a).state);

function start(seed = 1, first: PlayerId = "me"): GameState {
  let s = createGame(db, { seed, decks: { me: deck, bot: deck }, firstPlayer: first });
  s = act(s, first, { type: "mulligan", returnUids: [] });
  return act(s, first === "me" ? "bot" : "me", { type: "mulligan", returnUids: [] });
}

function card(s: GameState, key: string): CardInstance {
  return { uid: "t" + s.nextUid++, key, rested: false, faceUp: true, hollowed: false, mods: [], usedThisTurn: [] };
}
const place = (s: GameState, p: PlayerId, c: Circle, key: string) => (s.players[p].circles[c] = card(s, key));
const toHand = (s: GameState, p: PlayerId, key: string) => { const i = card(s, key); s.players[p].hand.push(i); return i; };
const onTop = (s: GameState, p: PlayerId, ...keys: string[]) => s.players[p].deck.unshift(...keys.map((k) => card(s, k)));

function advanceTo(s: GameState, phase: GameState["phase"], step?: string): GameState {
  while (s.phase !== phase || (step && s.step !== step)) s = act(s, s.turnPlayer, { type: "next-phase" });
  return s;
}

// เทิร์น 2 ของบอท แบทเทิลเฟส: บอทมี mist บน VC + gun หน้าซ้าย + bone หลังกลาง, เรามี mist บน VC
function botBattle(): GameState {
  let s = start();
  s = advanceTo(s, "main");
  s = act(s, "me", { type: "next-phase" });            // จบเทิร์น 1 (เทิร์นแรกไม่มีแบทเทิลเฟส)
  place(s, "bot", "vc", K.mist);
  place(s, "bot", "front_left", K.gun);
  place(s, "bot", "back_center", K.bone);
  place(s, "me", "vc", K.mist);
  return advanceTo(s, "battle", "attack");
}

describe("เตรียมเกม", () => {
  it("แจกมือ 5 ใบ แล้วผู้เล่นที่เล่นก่อนจั่วในเทิร์นแรก", () => {
    const s = start();
    expect(s.turn).toBe(1);
    expect(s.players.me.hand).toHaveLength(6);
    expect(s.players.me.deck).toHaveLength(43);
    expect(s.players.bot.hand).toHaveLength(5);
    expect(s.players.me.circles.vc!.faceUp).toBe(true);
    expect(s.players.me.gZone.every((g) => !g.faceUp)).toBe(true);
    expect(s.phase).toBe("ride");
  });

  it("เปลี่ยนการ์ดบนมือแล้วจำนวนบนมือเท่าเดิม", () => {
    let s = createGame(db, { seed: 7, decks: { me: deck, bot: deck }, firstPlayer: "me" });
    const back = s.players.me.hand.slice(0, 2).map((c) => c.uid);
    s = act(s, "me", { type: "mulligan", returnUids: back });
    expect(s.players.me.hand).toHaveLength(5);
    expect(s.players.me.hand.some((c) => back.includes(c.uid))).toBe(false);
    expect(s.players.me.deck).toHaveLength(44);
  });

  it("seed เดียวกัน + การกระทำเดียวกัน = เกมเดียวกัน (replay)", () => {
    expect(JSON.stringify(start(42))).toBe(JSON.stringify(start(42)));
    expect(JSON.stringify(start(42))).not.toBe(JSON.stringify(start(43)));
  });

  it("ทำผิดตาไม่ได้", () => {
    const s = start();
    expect(() => act(s, "bot", { type: "next-phase" })).toThrow();
  });
});

describe("ไรด์และเมนเฟส", () => {
  it("ไรด์ได้เทิร์นละครั้ง และเกรดต้องเท่าเดิมหรือ +1", () => {
    let s = start();
    const g3 = toHand(s, "me", K.mist);
    expect(() => act(s, "me", { type: "ride", uid: g3.uid })).toThrow();
    const g1 = toHand(s, "me", K.bone);
    s = act(s, "me", { type: "ride", uid: g1.uid });
    expect(s.players.me.circles.vc!.key).toBe(K.bone);
    expect(s.players.me.soul).toHaveLength(1);
    const g1b = toHand(s, "me", K.bone);
    expect(() => act(s, "me", { type: "ride", uid: g1b.uid })).toThrow();
  });

  it("คอลเกรดไม่เกินแวนการ์ด คอลทับแล้วยูนิทเดิมลงดรอป และย้ายหน้า-หลังได้", () => {
    let s = advanceTo(start(), "main");
    const g2 = toHand(s, "me", K.gun);
    expect(() => act(s, "me", { type: "call", uid: g2.uid, to: "front_left" })).toThrow();
    place(s, "me", "vc", K.mist);
    s = act(s, "me", { type: "call", uid: g2.uid, to: "front_left" });
    const again = toHand(s, "me", K.bone);
    s = act(s, "me", { type: "call", uid: again.uid, to: "front_left" });
    expect(s.players.me.drop.map((c) => c.key)).toContain(K.gun);
    s = act(s, "me", { type: "move", from: "front_left", to: "back_left" });
    expect(s.players.me.circles.back_left!.key).toBe(K.bone);
    expect(() => act(s, "me", { type: "move", from: "back_left", to: "back_center" })).toThrow();
  });
});

describe("การต่อสู้", () => {
  it("เทิร์นแรก: กดถัดไปจากเมนเฟสแล้วจบเทิร์นเลย ไม่เข้าแบทเทิลเฟส", () => {
    let s = advanceTo(start(), "main");
    expect(() => act(s, "me", { type: "attack", attacker: "vc", target: "vc" })).toThrow();
    s = act(s, "me", { type: "next-phase" });
    expect(s.turn).toBe(2);
    expect(s.turnPlayer).toBe("bot");
    expect(s.phase).toBe("ride");
  });

  it("ไรด์แล้วไปสเต็ปถัดไปเอง: แวนการ์ดยังไม่ถึงเกรด 3 ทั้งสองฝ่าย ข้ามสไตรด์สเต็ปเข้าเมนเฟส", () => {
    let s = start();
    const bone = toHand(s, "me", K.bone);
    s = act(s, "me", { type: "ride", uid: bone.uid });
    expect(s.players.me.circles.vc!.key).toBe(K.bone);
    expect(s.phase).toBe("main");
  });

  it("ไรด์แล้วไปสไตรด์สเต็ปเอง เมื่อแวนการ์ดทั้งสองฝ่ายเป็นเกรด 3", () => {
    let s = start();
    place(s, "me", "vc", K.star);
    place(s, "bot", "vc", K.mist);
    const mist = toHand(s, "me", K.mist);
    s = act(s, "me", { type: "ride", uid: mist.uid });
    expect(s.phase).toBe("ride");
    expect(s.step).toBe("stride");
  });

  it("บูสท์รวม Power และเรสต์ตัวบูสท์ ฮิทแวนการ์ดแล้วได้ดาเมจเท่า Critical", () => {
    let s = botBattle();
    onTop(s, "bot", K.gun, K.gun);     // ไดรฟ์เช็ค 2 ใบไม่มีทริกเกอร์
    onTop(s, "me", K.gun);
    const deckBefore = s.players.bot.deck.length;
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc", booster: "back_center" });
    expect(powerOf(db, s.players.bot, "vc")).toBe(18000);
    expect(s.players.bot.circles.back_center!.rested).toBe(true);
    expect(s.awaiting!.player).toBe("me");
    s = act(s, "me", { type: "end-guard" });
    expect(s.players.me.damage).toHaveLength(1);
    expect(s.players.bot.deck).toHaveLength(deckBefore - 2);   // เกรด 3 = twin drive
    expect(s.step).toBe("attack");
    expect(powerOf(db, s.players.bot, "vc")).toBe(11000);   // ผลบูสท์หมดเมื่อจบการต่อสู้
  });

  it("การ์ดพอแล้วไม่ฮิท และการ์ดบน GC ลงดรอปหลังจบการต่อสู้", () => {
    let s = botBattle();
    s = act(s, "bot", { type: "attack", attacker: "front_left", target: "vc" });
    const g = toHand(s, "me", K.bone);
    s = act(s, "me", { type: "guard", uids: [g.uid] });
    s = act(s, "me", { type: "end-guard" });       // 9000 vs 11000+5000
    expect(s.players.me.damage).toHaveLength(0);
    expect(s.players.me.guardian).toHaveLength(0);
    expect(s.players.me.drop.some((c) => c.uid === g.uid)).toBe(true);
  });

  it("ฮิทเรียร์การ์ดแล้วรีไทร์ ไม่มีไดรฟ์เช็คเมื่อเรียร์การ์ดโจมตี", () => {
    let s = botBattle();
    place(s, "me", "front_right", K.bone);
    const deckBefore = s.players.bot.deck.length;
    s = act(s, "bot", { type: "attack", attacker: "front_left", target: "front_right" });
    s = act(s, "me", { type: "end-guard" });
    expect(s.players.me.circles.front_right).toBeUndefined();
    expect(s.players.bot.deck).toHaveLength(deckBefore);
  });

  it("อินเตอร์เซปต์ได้เฉพาะเกรด 2 แถวหน้า", () => {
    let s = botBattle();
    place(s, "me", "front_left", K.gun);
    place(s, "me", "back_left", K.bone);
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc" });
    expect(() => act(s, "me", { type: "guard", uids: [], intercept: ["back_left"] })).toThrow();
    s = act(s, "me", { type: "guard", uids: [], intercept: ["front_left"] });
    expect(s.players.me.circles.front_left).toBeUndefined();
    expect(s.players.me.guardian).toHaveLength(1);
  });

  it("คริติคอลทริกเกอร์จากไดรฟ์เช็ค เพิ่มดาเมจ", () => {
    let s = botBattle();
    onTop(s, "bot", K.crit, K.gun);
    onTop(s, "me", K.gun, K.gun);
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc" });
    s = act(s, "me", { type: "end-guard" });
    expect(s.awaiting).toMatchObject({ player: "bot", kind: "trigger-target" });
    s = act(s, "bot", { type: "trigger-target", powerTo: "vc", extraTo: "vc" });
    expect(s.players.me.damage).toHaveLength(2);
  });

  it("ฮีลได้เมื่อดาเมจเรามากกว่าหรือเท่ากับคู่แข่ง (ก่อนวางการ์ดเช็คลงดาเมจ)", () => {
    let s = botBattle();
    s.players.me.damage = [card(s, K.gun), card(s, K.gun)];
    s.players.bot.damage = [card(s, K.gun), card(s, K.gun)];
    onTop(s, "bot", K.gun, K.gun);
    onTop(s, "me", K.heal);
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc" });
    s = act(s, "me", { type: "end-guard" });
    s = act(s, "me", { type: "trigger-target", powerTo: "vc" });
    expect(s.players.me.damage).toHaveLength(2);   // 2 - 1 (ฮีล) + 1 (การ์ดเช็ค)
  });

  it("ดาเมจครบ 6 แพ้", () => {
    let s = botBattle();
    s.players.me.damage = Array.from({ length: 5 }, () => card(s, K.gun));
    onTop(s, "bot", K.gun, K.gun);
    onTop(s, "me", K.gun);
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc" });
    s = act(s, "me", { type: "end-guard" });
    expect(s.winner).toBe("bot");
    expect(() => act(s, "bot", { type: "next-phase" })).toThrow();
  });
});

describe("สไตรด์และ G การ์เดี้ยน", () => {
  function strideReady(): GameState {
    let s = start();
    s = advanceTo(s, "main");
    s = act(s, "me", { type: "next-phase" });   // เทิร์นบอท (เทิร์นแรกไม่มีแบทเทิลเฟส)
    place(s, "bot", "vc", K.mist);
    place(s, "me", "vc", K.star);
    return advanceTo(s, "ride", "stride");
  }

  it("สไตรด์: ทิ้งเกรดรวม 3, Power = 15000 + ฮาร์ท, จบเทิร์น G กลับ G โซนหงายหน้า", () => {
    let s = strideReady();
    const g = s.players.bot.gZone.find((c) => c.key === K.gunit)!;
    const low = toHand(s, "bot", K.bone);
    expect(() => act(s, "bot", { type: "stride", gUid: g.uid, discardUids: [low.uid] })).toThrow();
    const g3 = toHand(s, "bot", K.star);
    s = act(s, "bot", { type: "stride", gUid: g.uid, discardUids: [g3.uid] });
    expect(s.players.bot.heart!.key).toBe(K.mist);
    expect(powerOf(db, s.players.bot, "vc")).toBe(26000);
    s = advanceTo(s, "battle", "attack");
    s = act(s, "bot", { type: "next-phase" });
    expect(s.players.bot.circles.vc!.key).toBe(K.mist);
    expect(s.players.bot.gZone.find((c) => c.uid === g.uid)!.faceUp).toBe(true);
    expect(s.turnPlayer).toBe("me");
  });

  it("สไตรด์ไม่ได้ถ้าแวนการ์ดคู่แข่งยังไม่ถึงเกรด 3", () => {
    const s = strideReady();
    place(s, "me", "vc", K.gun);
    const g = s.players.bot.gZone.find((c) => c.key === K.gunit)!;
    const g3 = toHand(s, "bot", K.star);
    expect(() => act(s, "bot", { type: "stride", gUid: g.uid, discardUids: [g3.uid] })).toThrow();
  });

  it("G การ์เดี้ยน Shield 15000 ต้องทิ้ง Heal และกลับ G โซนหงายหน้า", () => {
    let s = botBattle();
    onTop(s, "bot", K.gun, K.gun);
    s = act(s, "bot", { type: "attack", attacker: "vc", target: "vc" });
    const lily = s.players.me.gZone.find((c) => c.key === K.lily)!;
    const notHeal = toHand(s, "me", K.crit);
    expect(() => act(s, "me", { type: "call-g-guardian", gUid: lily.uid, discardUid: notHeal.uid })).toThrow();
    const heal = toHand(s, "me", K.heal);
    s = act(s, "me", { type: "call-g-guardian", gUid: lily.uid, discardUid: heal.uid });
    s = act(s, "me", { type: "end-guard" });
    expect(s.players.me.damage).toHaveLength(0);
    expect(s.players.me.gZone.find((c) => c.uid === lily.uid)!.faceUp).toBe(true);
  });
});

describe("แพ้เพราะกองการ์ดหมด", () => {
  it("ต้องจั่วแต่กองการ์ดหมด", () => {
    let s = advanceTo(start(), "main");
    s.players.bot.deck = [];
    s = act(s, "me", { type: "next-phase" });
    expect(s.winner).toBe("me");
  });
});
