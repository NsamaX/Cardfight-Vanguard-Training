// @vitest-environment jsdom
// จำลองการคลิกบนหน้าสนามจริง: เล่น 2 เทิร์นตั้งแต่เปลี่ยนการ์ดบนมือจนถึงการโจมตีและการ์ด
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardByKey as db } from "../../data/cards";
import { countCards, presetDecks } from "../../data/decks";
import { createGame } from "../../engine/game";
import type { CardInstance, GameState } from "../../engine/types";
import { Board } from "./Board";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const deck = presetDecks.find((d) => d.id === "nightrose-sample")!;
const BONE = "G-BT06/040TH", GUN = "G-BT06/087TH", TOMMY = "G-CHB03/S12TH";
let root: Root, host: HTMLDivElement;

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const inst = (s: GameState, key: string): CardInstance =>
  ({ uid: "t" + s.nextUid++, key, rested: false, faceUp: true, hollowed: false, mods: [], usedThisTurn: [] });

function render(s: GameState) { act(() => root.render(<Board initial={s} started onStart={() => {}} settings={{ seed: s.seed, firstPlayer: s.firstPlayer }} decks={{ me: deck, bot: deck }} deckOpen={false} onDeckOpen={() => {}}
  onNewGame={() => {}} onApplySettings={() => {}} onSwapDecks={() => {}} onPickDeck={() => {}} onDeckChanged={() => {}} />)); }
let autoDecline = true;
function rawClick(el: Element | undefined | null) {
  if (!el) throw new Error("ไม่พบสิ่งที่จะคลิก");
  act(() => (el as HTMLElement).click());
}
// เทสต์กฎพื้นฐาน: ถ้ามีความสามารถถามขึ้นมา ตอบ "ไม่" / ไม่เลือก ให้อัตโนมัติ
function declineAll() {
  for (let i = 0; i < 30; i++) {
    const cmd = host.querySelector(".command");
    const modalOk = [...host.querySelectorAll(".modal button")].find((b) => b.textContent === "ยืนยัน") as HTMLButtonElement | undefined;
    const no = [...(cmd?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "ไม่" || b.textContent === "ไม่เลือก");
    if (modalOk) {
      if (modalOk.disabled) rawClick(host.querySelector(".modal .card"));
      rawClick(modalOk);
    } else if (no) rawClick(no);
    else if (cmd?.textContent?.includes("ทำก่อน")) rawClick(cmd.querySelector(".btn.primary"));
    else return;
  }
}
function click(el: Element | undefined | null) {
  rawClick(el);
  if (autoDecline) declineAll();
}
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
const modalCard = (name: string) => [...host.querySelectorAll(".modal .card")].find((c) => c.getAttribute("title") === name);
const slots = (side: 0 | 1) => host.querySelectorAll(".side")[side].querySelectorAll(".slot");   // 0 = บอท, 1 = คุณ
const handCard = (side: "me" | "bot", name: string) =>
  [...host.querySelectorAll(`.hand.${side} .card`)].find((c) => c.getAttribute("title") === name);
const pill = () => host.querySelector(".pill")!.textContent!;

// 3 เทสต์ที่ skip ใช้ปุ่มในแถบคำสั่ง (.command) และป้ายสถานะ (.pill) ซึ่งถูกลบออกแล้ว รอระบบ action แบบใหม่แล้วค่อยแก้ให้ใช้ได้
describe("หน้าสนาม", () => {
  it.skip("เล่นด้วยมือได้: เปลี่ยนการ์ด ไรด์ คอล จบเทิร์น โจมตี การ์ด", () => {
    const s = createGame(db, { seed: 3, firstPlayer: "me", decks: { me: deck, bot: deck } });
    s.players.me.hand.push(inst(s, BONE), inst(s, TOMMY));
    s.players.bot.hand.push(inst(s, BONE), inst(s, BONE));
    s.players.me.deck.unshift(inst(s, GUN));                        // จั่วเทิร์น 1
    s.players.bot.deck.unshift(inst(s, GUN), inst(s, GUN));         // จั่วเทิร์น 2 + ไดรฟ์เช็ค
    render(s);

    // เปลี่ยนการ์ดบนมือ: ไม่เปลี่ยนทั้งสองฝั่ง
    expect(pill()).toContain("รอคุณ");
    click(button("ยืนยัน"));
    expect(pill()).toContain("รอบอท");
    click(button("ยืนยัน"));
    expect(host.textContent).toContain("TURN 1");

    // เทิร์น 1 ของเรา: ไรด์เนโครโบนลง VC
    click(handCard("me", db[BONE].name));
    click(slots(1)[1]);
    expect(slots(1)[1].querySelector(".card")!.getAttribute("title")).toBe(db[BONE].name);

    // เมนเฟส: คอลทอมมี่ลง RC หน้าซ้าย / คอลพลปืนใหญ่ (เกรด 2) ไม่ได้ ต้องขึ้นข้อความเตือน
    click(button("ไปสไตรด์สเต็ป"));
    click(button("ไปเมนเฟส"));
    click(handCard("me", db[TOMMY].name));
    click(slots(1)[0]);
    expect(slots(1)[0].querySelector(".card")!.getAttribute("title")).toBe(db[TOMMY].name);
    click(handCard("me", db[GUN].name));
    click(slots(1)[2]);
    expect(host.querySelector(".toast")?.textContent).toContain("เกรดไม่เกินแวนการ์ด");

    // แบทเทิล: เทิร์นแรกโจมตีไม่ได้ จบเทิร์น
    click(button("ไปแบทเทิลเฟส"));
    click(slots(1)[1]);
    click(slots(0)[4]);
    expect(host.querySelector(".toast")?.textContent).toContain("เทิร์นแรก");
    click(button("จบเทิร์น"));
    expect(host.textContent).toContain("เทิร์นบอท");

    // เทิร์น 2 ของบอท: ไรด์ แล้วโจมตี VC ของเรา
    click(handCard("bot", db[BONE].name));
    click(slots(0)[4]);
    click(button("ไปสไตรด์สเต็ป"));
    click(button("ไปเมนเฟส"));
    click(button("ไปแบทเทิลเฟส"));
    click(slots(0)[4]);
    click(slots(1)[1]);
    expect(pill()).toContain("รอคุณ");
    expect(host.querySelector(".battle")!.textContent).toContain("7,000");

    // เราการ์ดด้วยพลปืนใหญ่ (Shield 5000): 7000 vs 7000+5000 ไม่ฮิท
    click(handCard("me", db[GUN].name));
    expect(host.querySelector(".battle")!.textContent).toContain("ไม่ฮิท");
    click(button("จบการการ์ด"));
    expect(host.querySelector(".pip.up")).toBeNull();               // ไม่ได้ดาเมจ
    expect(pill()).toContain("รอบอท");
    expect(host.querySelector(".log")!.textContent).toContain("ไม่ฮิท");
  });

  it.skip("สไตรด์ผ่าน G โซน แล้วเลือกเป้าหมายคริติคอลทริกเกอร์ได้", () => {
    const MIST = "G-CHB03/S11TH", STAR = "G-CHB03/002TH", GUNIT = "PR/0686TH", CRIT = "PR/0632TH";
    const s = createGame(db, { seed: 9, firstPlayer: "me", decks: { me: deck, bot: deck } });
    Object.assign(s, { phase: "ride", step: "stride", turn: 3, turnPlayer: "me", mulliganDone: ["me", "bot"] });
    s.players.me.circles.vc = inst(s, MIST);
    s.players.bot.circles.vc = inst(s, MIST);
    s.players.me.hand = [inst(s, STAR)];
    s.players.me.deck.unshift(inst(s, CRIT), inst(s, GUN), inst(s, GUN));
    s.players.bot.deck.unshift(inst(s, GUN), inst(s, GUN));
    s.awaiting = { player: "me", kind: "next-phase" };
    render(s);

    click(button("เปิด G โซน"));
    click([...host.querySelectorAll(".modal .card")].find((c) => c.getAttribute("title") === db[GUNIT].name));
    click(handCard("me", db[STAR].name));
    click(button("สไตรด์"));
    expect(slots(1)[1].querySelector(":scope > .card .pw")!.textContent).toBe("26,000");
    expect(slots(1)[1].querySelector(".heart .card")!.getAttribute("title")).toBe(db[MIST].name);

    click(button("ไปเมนเฟส"));
    click(button("ไปแบทเทิลเฟส"));
    click(slots(1)[1]);
    click(slots(0)[4]);
    click(button("จบการการ์ด"));
    expect(host.querySelector(".command")!.textContent).toContain("CRITICAL TRIGGER");
    click(slots(1)[1]);      // Power+5000
    click(slots(1)[1]);      // Critical+1
    expect(host.querySelectorAll(".side")[0].querySelectorAll(".pip.up")).toHaveLength(2);
  });

  it.skip("คลิกเล่นคอมโบยิงนอกเทิร์นครบสายผ่านหน้าจอ", () => {
    autoDecline = false;
    const K = { mist: "G-CHB03/S11TH", star: "G-CHB03/002TH", serp: "PR/0256TH", lazy: "G-CP06/019TH", dewey: "PR/0740TH", gunit: "PR/0686TH", lily: "G-CP08/S11TH" };
    const s = createGame(db, { seed: 11, firstPlayer: "me", decks: { me: deck, bot: deck } });
    const me = s.players.me, bot = s.players.bot;
    const down = (k: string) => ({ ...inst(s, k), faceUp: false });
    Object.assign(s, { mulliganDone: ["me", "bot"], turn: 4, turnPlayer: "bot", phase: "battle", step: "guard",
      battle: { attacker: "vc", booster: "back_center", target: "vc", drivesLeft: 0, damageLeft: 0 } });
    me.circles = { vc: inst(s, K.mist), front_left: inst(s, GUN), front_right: inst(s, K.serp), back_left: inst(s, BONE), back_right: inst(s, K.lazy) };
    me.hand = [inst(s, K.dewey), inst(s, K.star)];
    me.damage = [inst(s, K.star), inst(s, K.serp), inst(s, BONE), down(K.star)];
    me.drop = [inst(s, TOMMY), inst(s, K.dewey)];
    me.gZone = [inst(s, K.gunit), inst(s, K.gunit), down(K.lily), down(K.gunit)];
    bot.circles = { vc: { ...inst(s, K.gunit), rested: true }, front_left: inst(s, K.lazy), back_center: inst(s, BONE) };
    bot.heart = inst(s, K.star);
    bot.circles.vc!.mods.push({ stat: "power", value: 7000, source: "บูสท์", until: "battle-end" });
    bot.deck.unshift(down(GUN), down(GUN), down(GUN));
    s.awaiting = { player: "me", kind: "guard", prompt: { key: "prompt.guard" } };
    render(s);

    click(button("คอล G การ์เดี้ยน"));
    click(modalCard(db[K.lily].name));
    click(handCard("me", db[K.dewey].name));
    click([...host.querySelectorAll(".command button")].find((b) => b.textContent?.includes("เดวย์")));
    click(button("ใช่"));
    click(host.querySelector(".modal .card"));                    // ไบนด์ Heal อีกใบ
    click(button("ยืนยัน"));
    click(button("CC(1)"));
    click(button("ใช่"));                                         // เนโครลิลลี่
    click(modalCard(db[GUN].name));
    click(button("ยืนยัน"));
    click(modalCard(db[TOMMY].name));
    click(button("ยืนยัน"));
    click(slots(1)[4]);                                           // หลังกลาง
    expect(host.querySelector(".command")!.textContent).toContain("หมอกยามค่ำคืน");
    click(button("ใช่"));                                         // ไนท์โรส mill 3
    click(modalCard(db[GUN].name));
    click(button("ยืนยัน"));
    click(slots(1)[0]);                                           // หน้าซ้าย
    click([...host.querySelectorAll(".command button")].find((b) => b.textContent?.includes("พลปืนใหญ่") && b.textContent.includes("#1")));
    click(button("ใช่"));                                         // ฮอลโล่ว์
    click(button("ใช่"));                                         // CB1 ยิง
    click(modalCard(db[K.lazy].name));
    click(button("ยืนยัน"));
    click(button("จบการการ์ด"));

    expect(slots(0)[5].querySelector(".card")).toBeNull();        // เรียร์การ์ดหน้าซ้ายของบอทถูกยิง
    expect(slots(1)[0].textContent).toContain("ฮอลโล่ว์");
    expect(slots(1)[4].querySelector(".card")!.getAttribute("title")).toBe(db[TOMMY].name);
    expect(host.querySelector(".side .damage")).toBeTruthy();
    expect(host.querySelectorAll(".side")[1].querySelectorAll(".pip.up")).toHaveLength(2);
    expect(host.querySelector(".log")!.textContent).toContain("ไม่ฮิท");
    autoDecline = true;
  });

  it("เปิด G โซนแล้วการ์ดคว่ำแสดงเป็นรูปการ์ดได้ และแผงขวาแสดงข้อความความสามารถ", () => {
    const s = createGame(db, { seed: 5, firstPlayer: "me", decks: { me: deck, bot: deck } });
    render(s);
    click(host.querySelector(".tray.me .gZone .zone-slot"));
    expect(host.querySelectorAll(".modal .card")).toHaveLength(countCards(deck.g_zone));
    click(host.querySelector(".modal .card"));
    expect(host.querySelector(".insp-pane.me")!.textContent).toMatch(/STRIDE|G GUARDIAN/);
  });

  it("กด Ready ทั้งสองฝั่ง (คุณคุมบอทด้วย) จากนั้นเลือกการ์ดเกรด 1 แล้วคลิก VC เพื่อไรด์ได้ และเข้าเมนเฟสเอง", () => {
    const s = createGame(db, { seed: 7, firstPlayer: "me", decks: { me: deck, bot: deck } });
    s.players.me.circles.vc = { ...inst(s, "PR/0740TH"), faceUp: false };   // แวนการ์ดเกรด 0 ที่ไม่มีความสามารถตอนถูกไรด์ทับ
    s.players.me.hand.push(inst(s, BONE));
    render(s);
    click(button("Ready"));
    expect(host.querySelector(".ph.on")!.textContent).toBe("START");   // ยังรอบอทเลือกเปลี่ยนการ์ด
    click(button("Ready"));
    expect(host.querySelector(".ph.on")!.textContent).toBe("RIDE");
    expect(button("ไปเมนเฟส")).toBeTruthy();                         // แวนการ์ดไม่ถึงเกรด 3 กดถัดไปจะข้ามสไตรด์
    click(handCard("me", db[BONE].name));
    expect(handCard("me", db[BONE].name)!.classList.contains("sel")).toBe(true);
    click(slots(1)[1]);
    expect(slots(1)[1].querySelector(":scope > .card")!.getAttribute("title")).toBe(db[BONE].name);
    expect(host.querySelector(".ph.on")!.textContent).toBe("MAIN");
    expect(button("จบเทิร์น")).toBeTruthy();                         // เทิร์นแรกไม่มีแบทเทิลเฟส
  });
});
