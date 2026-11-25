import { useLayoutEffect, useRef, type RefObject } from "react";

export const MOVE_MS = 400;
export const MOVE_EASE = "cubic-bezier(.2,.7,.2,1)";
export const FLIP_MS = 200;
export const DEAL_GAP_MS = 90;   // หลายใบเข้ามือ/กลับเข้ากองพร้อมกัน (เริ่มเกม/เปลี่ยนการ์ด) ทยอยทีละใบ

// จุดกึ่งกลางของการ์ดบนจอ turned = วางแนวนอน (เรสต์/ดาเมจ)
export interface Spot { x: number; y: number; turned: boolean }

const spotOf = (r: DOMRect): Spot => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, turned: r.width > r.height });
const flights = new WeakMap<HTMLElement, HTMLElement>();

// การ์ดที่ย้ายที่บนกระดาน: ซ่อนตัวจริงไว้ แล้วให้เงาของมันบินจากตำแหน่งเดิมมาที่ใหม่
// เงาอยู่ใน body จึงไม่ถูกขอบของโซนต้นทาง/ปลายทางตัดและลอยเหนือการ์ดอื่น
// look: หน้าตาของเงา (ไม่ระบุ = หน้าตาของการ์ดที่ที่ใหม่) delay: รอก่อนออกบิน ระหว่างรอเงาค้างอยู่ที่เดิม
function fly(el: HTMLElement, from: Spot, to: Spot, look: HTMLElement = el, delay = 0) {
  const w = el.offsetWidth, h = el.offsetHeight;
  const ghost = look.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-uid");
  ghost.classList.remove("sel", "picked", "source", "active");
  ghost.classList.add("ghost");
  const css = getComputedStyle(el);
  for (const v of ["--sleeve", "--g-sleeve"]) ghost.style.setProperty(v, css.getPropertyValue(v));
  Object.assign(ghost.style, { left: `${to.x - w / 2}px`, top: `${to.y - h / 2}px`, width: `${w}px`, height: `${h}px` });
  document.body.appendChild(ghost);
  flights.get(el)?.remove();
  flights.set(el, ghost);
  el.style.visibility = "hidden";
  const turn = (t: boolean) => (t ? " rotate(90deg)" : "");
  const anim = ghost.animate([
    { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)${turn(from.turned)}` },
    { transform: `translate(0px, 0px)${turn(to.turned)}` },
  ], { duration: MOVE_MS, delay, easing: MOVE_EASE, fill: "both" });
  const done = () => {
    ghost.remove();
    if (flights.get(el) !== ghost) return;
    flights.delete(el);
    el.style.visibility = "";
  };
  anim.finished.then(done, done);
}

// พลิกการ์ดที่อยู่กับที่จากคว่ำเป็นหงาย: ครึ่งแรกหลังการ์ดหดจนเหลือแนวตั้ง ครึ่งหลังหน้าการ์ดกางออก
// ระหว่างครึ่งแรกวางหลังการ์ดทับหน้าการ์ดไว้ชั่วคราว
function flip(el: HTMLElement) {
  const back = document.createElement("span");
  back.className = "back";
  el.appendChild(back);
  el.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: FLIP_MS / 2, easing: "ease-in" }).finished.then(() => {
    back.remove();
    el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: FLIP_MS / 2, easing: "ease-out" });
  }, () => back.remove());
}

// จำตำแหน่งการ์ดทุกใบ (ตาม uid) ทุกครั้งที่ state เปลี่ยน ใบที่ตำแหน่งเปลี่ยนจะบินไปที่ใหม่
// การ์ดในมือให้ Hand เลื่อนเอง (ใช้ตำแหน่งที่จำไว้นี้เป็นจุดเริ่มของการ์ดที่เข้ามือ) การ์ดในหน้าต่างไม่นับ
// การ์ดจากมือกลับเข้ากอง: เงาเป็นหน้าตาตอนอยู่ในมือ และทยอยบินทีละใบจากซ้ายไปขวาแบบตอนจั่ว
// ยูนิทที่หงายขึ้นโดยไม่ย้ายที่ (แวนการ์ดตอนเริ่มเกม) พลิกให้เห็น
export function useCardFlight(root: RefObject<HTMLElement | null>, dep: unknown) {
  const seen = useRef(new Map<string, Spot>()).current;
  const inHand = useRef(new Map<string, HTMLElement>()).current;   // สำเนาการ์ดในมือรอบก่อน (ตัวจริงหายไปแล้วเมื่อออกจากมือ)
  const faceDown = useRef(new Set<string>()).current;
  useLayoutEffect(() => {
    const main = root.current;
    if (!main) return;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const prev = new Map(seen), prevHand = new Map(inHand), prevDown = new Set(faceDown);
    seen.clear();
    inHand.clear();
    faceDown.clear();
    const toDeck: { el: HTMLElement; from: Spot; now: Spot; look: HTMLElement }[] = [];
    for (const el of main.querySelectorAll<HTMLElement>("[data-uid]")) {
      const uid = el.dataset.uid!;
      if (seen.has(uid) || el.closest(".veil")) continue;
      const now = spotOf(el.getBoundingClientRect());
      seen.set(uid, now);
      if (el.closest(".hand")) {
        inHand.set(uid, el.cloneNode(true) as HTMLElement);
        // การ์ดที่เพิ่งเข้ามือยังเลื่อนอยู่ (ตำแหน่งที่วัดได้ยังเป็นที่เดิม): วัดใหม่เมื่อเลื่อนเสร็จ
        const moving = el.closest(".hand-slot")?.getAnimations?.() ?? [];
        if (moving.length) Promise.all(moving.map((a) => a.finished)).then(() => { if (seen.get(uid) === now && el.isConnected) seen.set(uid, spotOf(el.getBoundingClientRect())); }, () => {});
      }
      const down = !!el.querySelector(":scope > .back");
      if (down) faceDown.add(uid);
      const from = prev.get(uid);
      if (!still && prevDown.has(uid) && !down && el.closest(".slot") && from && Math.abs(from.x - now.x) < 1 && Math.abs(from.y - now.y) < 1 && typeof el.animate === "function") flip(el);
      if (still || !from || !(el.classList.contains("card") || el.closest(".deck")) || el.closest(".hand") || typeof el.animate !== "function") continue;
      if (Math.abs(from.x - now.x) < 1 && Math.abs(from.y - now.y) < 1) continue;
      const look = prevHand.get(uid);
      if (look && el.closest(".deck")) toDeck.push({ el, from, now, look });
      else fly(el, from, now, look);
    }
    toDeck.sort((a, b) => a.from.x - b.from.x).forEach((f, i) => fly(f.el, f.from, f.now, f.look, i * DEAL_GAP_MS));
  }, [dep]);
  return seen;
}
