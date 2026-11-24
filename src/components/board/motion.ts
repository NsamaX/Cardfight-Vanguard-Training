import { useLayoutEffect, useRef, type RefObject } from "react";

export const MOVE_MS = 400;
export const MOVE_EASE = "cubic-bezier(.2,.7,.2,1)";

// จุดกึ่งกลางของการ์ดบนจอ turned = วางแนวนอน (เรสต์/ดาเมจ)
export interface Spot { x: number; y: number; turned: boolean }

const spotOf = (r: DOMRect): Spot => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, turned: r.width > r.height });
const flights = new WeakMap<HTMLElement, HTMLElement>();

// การ์ดที่ย้ายที่บนกระดาน: ซ่อนตัวจริงไว้ แล้วให้เงาของมันบินจากตำแหน่งเดิมมาที่ใหม่
// เงาอยู่ใน body จึงไม่ถูกขอบของโซนต้นทาง/ปลายทางตัดและลอยเหนือการ์ดอื่น
function fly(el: HTMLElement, from: Spot, to: Spot) {
  const w = el.offsetWidth, h = el.offsetHeight;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-uid");
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
  ], { duration: MOVE_MS, easing: MOVE_EASE, fill: "forwards" });
  const done = () => {
    ghost.remove();
    if (flights.get(el) !== ghost) return;
    flights.delete(el);
    el.style.visibility = "";
  };
  anim.finished.then(done, done);
}

// จำตำแหน่งการ์ดทุกใบ (ตาม uid) ทุกครั้งที่ state เปลี่ยน ใบที่ตำแหน่งเปลี่ยนจะบินไปที่ใหม่
// การ์ดในมือให้ Hand เลื่อนเอง (ใช้ตำแหน่งที่จำไว้นี้เป็นจุดเริ่มของการ์ดที่เข้ามือ) การ์ดในหน้าต่างไม่นับ
export function useCardFlight(root: RefObject<HTMLElement | null>, dep: unknown) {
  const seen = useRef(new Map<string, Spot>()).current;
  useLayoutEffect(() => {
    const main = root.current;
    if (!main) return;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const prev = new Map(seen);
    seen.clear();
    for (const el of main.querySelectorAll<HTMLElement>("[data-uid]")) {
      const uid = el.dataset.uid!;
      if (seen.has(uid) || el.closest(".veil")) continue;
      const now = spotOf(el.getBoundingClientRect());
      seen.set(uid, now);
      const from = prev.get(uid);
      if (still || !from || !el.classList.contains("card") || el.closest(".hand") || typeof el.animate !== "function") continue;
      if (Math.abs(from.x - now.x) < 1 && Math.abs(from.y - now.y) < 1) continue;
      fly(el, from, now);
    }
  }, [dep]);
  return seen;
}
