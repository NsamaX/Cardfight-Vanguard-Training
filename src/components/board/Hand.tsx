import { useLayoutEffect, useRef } from "react";
import type { CardInstance, PlayerId } from "../../engine/types";
import type { Light } from "../../lib/board";
import { CardView } from "../CardView";
import { MOVE_EASE, MOVE_MS, type Spot } from "./motion";

const PER_ROW = 10;
const DEAL_GAP_MS = 90;   // แจกหลายใบพร้อมกัน (เริ่มเกม/เปลี่ยนการ์ด) ทยอยทีละใบ

// มือชิดขอบจอ แถวละไม่เกิน 10 ใบ (ถ้าที่ไม่พอการ์ดจะซ้อนกัน) ใบที่ 11 ขึ้นไปอยู่แถวหลัง โผล่ 30% ชี้เมาส์แล้วเด้งให้เห็นเต็มใบ
export function Hand({ p, hidden, cards, seen, selUid, lightOf, picks, onClick, onHover }: {
  p: PlayerId;
  hidden?: boolean;                                // มือของบอท: แสดงหลังการ์ด
  cards: CardInstance[];
  seen: Map<string, Spot>;                         // ตำแหน่งบนกระดานก่อนหน้า: การ์ดที่เข้ามือบินมาจากที่เดิม (ไม่เห็นที่เดิมก็บินจากกองการ์ด)
  selUid?: string;
  lightOf: (uid: string) => Light;
  picks: string[];
  onClick: (inst: CardInstance) => void;
  onHover: (uid: string | undefined) => void;     // ชี้เมาส์แล้วแผงรายละเอียดแสดงการ์ดใบนั้นชั่วคราว
}) {
  const slots = useRef(new Map<string, HTMLElement>());
  const lastRects = useRef(new Map<string, DOMRect>());

  // FLIP: เทียบตำแหน่งก่อน/หลัง render การ์ดเดิมเลื่อนจากที่เก่า การ์ดใหม่บินจากที่เดิมบนกระดาน
  useLayoutEffect(() => {
    const deck = document.querySelector(`.stack.${p} .deck .zone-slot`)?.getBoundingClientRect();
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rects = new Map<string, DOMRect>();
    let dealt = 0;
    for (const [uid, el] of slots.current) {
      const now = el.getBoundingClientRect();
      rects.set(uid, now);
      const spot = seen.get(uid);
      const from = lastRects.current.get(uid) ?? (spot ? { left: spot.x - now.width / 2, top: spot.y - now.height / 2 } : deck);
      if (still || !from || typeof el.animate !== "function") continue;
      const dx = from.left - now.left, dy = from.top - now.top;
      if (!dx && !dy) continue;
      const isNew = !lastRects.current.has(uid);
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: MOVE_MS, delay: isNew ? dealt++ * DEAL_GAP_MS : 0, easing: MOVE_EASE, fill: "backwards" });
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
        <span key={h.uid} ref={slotRef(h.uid)} className="hand-slot" onMouseEnter={hidden ? undefined : () => onHover(h.uid)} onMouseLeave={hidden ? undefined : () => onHover(undefined)}>
          <CardView inst={h} plain hidden={hidden} selected={h.uid === selUid} light={hidden ? undefined : lightOf(h.uid)} picked={!hidden && picks.includes(h.uid)} onClick={() => onClick(h)} />
        </span>
      ))}
    </div>
  );
  return (
    <div className={`hand ${p}`}>
      {rows.length > 0 && row(rows[0], 0)}
      {rows.length > 1 && <div className="hand-more">{rows.slice(1).map((r, i) => row(r, i + 1))}</div>}
    </div>
  );
}
