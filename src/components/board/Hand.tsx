import { useLayoutEffect, useRef } from "react";
import type { CardInstance, PlayerId } from "../../engine/types";
import type { Light } from "../../lib/board";
import { CardView } from "../CardView";

const PER_ROW = 10;
const MOVE_MS = 400;      // การ์ดใหม่บินจากกองการ์ดถึงมือ และการ์ดเดิมเลื่อนหลบ ใช้เวลาเท่ากันจึงถึงตำแหน่งพร้อมกัน
const DEAL_GAP_MS = 90;   // แจกหลายใบพร้อมกัน (เริ่มเกม/เปลี่ยนการ์ด) ทยอยทีละใบ

// มือชิดขอบจอ แถวละไม่เกิน 10 ใบ (ถ้าที่ไม่พอการ์ดจะซ้อนกัน) ใบที่ 11 ขึ้นไปอยู่แถวหลัง โผล่ 30% ชี้เมาส์แล้วเด้งให้เห็นเต็มใบ
export function Hand({ p, away, cards, selUid, lightOf, picks, onClick, onHover }: {
  p: PlayerId;
  away: boolean;                                   // ไม่ใช่ตาของฝั่งนี้: มือเลื่อนออกนอกจอครึ่งใบ
  cards: CardInstance[];
  selUid?: string;
  lightOf: (uid: string) => Light;
  picks: string[];
  onClick: (inst: CardInstance) => void;
  onHover: (uid: string | undefined) => void;     // ชี้เมาส์แล้วแผงรายละเอียดแสดงการ์ดใบนั้นชั่วคราว
}) {
  const slots = useRef(new Map<string, HTMLElement>());
  const lastRects = useRef(new Map<string, DOMRect>());

  // FLIP: เทียบตำแหน่งก่อน/หลัง render การ์ดเดิมเลื่อนจากที่เก่า การ์ดใหม่บินจากกองการ์ดของฝั่งนี้
  useLayoutEffect(() => {
    const deck = document.querySelector(`.stack.${p} .deck .zone-slot`)?.getBoundingClientRect();
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rects = new Map<string, DOMRect>();
    let dealt = 0;
    for (const [uid, el] of slots.current) {
      const now = el.getBoundingClientRect();
      rects.set(uid, now);
      const from = lastRects.current.get(uid) ?? deck;
      if (still || !from || typeof el.animate !== "function") continue;
      const dx = from.left - now.left, dy = from.top - now.top;
      if (!dx && !dy) continue;
      const isNew = !lastRects.current.has(uid);
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: MOVE_MS, delay: isNew ? dealt++ * DEAL_GAP_MS : 0, easing: "cubic-bezier(.2,.7,.2,1)", fill: "backwards" });
    }
    lastRects.current = rects;
  }, [cards, p]);

  const slotRef = (uid: string) => (el: HTMLElement | null) => { if (el) slots.current.set(uid, el); else slots.current.delete(uid); };
  const rows: CardInstance[][] = [];
  for (let i = 0; i < cards.length; i += PER_ROW) rows.push(cards.slice(i, i + PER_ROW));
  // แถวที่ใกล้ขอบจออยู่บนสุด แถวถัดไปซ่อนอยู่ข้างหลังและโผล่ออกมา 30%
  const row = (list: CardInstance[], i: number) => (
    <div key={i} className="hand-row" style={{ zIndex: rows.length - i }}>
      {list.map((h) => (
        <span key={h.uid} ref={slotRef(h.uid)} className="hand-slot" onMouseEnter={() => onHover(h.uid)} onMouseLeave={() => onHover(undefined)}>
          <CardView inst={h} plain selected={h.uid === selUid} light={lightOf(h.uid)} picked={picks.includes(h.uid)} onClick={() => onClick(h)} />
        </span>
      ))}
    </div>
  );
  return (
    <div className={`hand ${p} ${away ? "away" : ""}`}>
      {rows.length > 0 && row(rows[0], 0)}
      {rows.length > 1 && <div className="hand-more">{rows.slice(1).map((r, i) => row(r, i + 1))}</div>}
    </div>
  );
}
