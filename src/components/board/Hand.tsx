import { useLayoutEffect, useRef } from "react";
import type { CardInstance, PlayerId } from "../../engine/types";
import type { Light } from "../../lib/board";
import { CardView } from "../CardView";
import { DEAL_GAP_MS, MOVE_EASE, MOVE_MS, type Spot } from "../../hooks/useCardFlight";

const PER_ROW = 10;

// The hand hugs the screen edge, at most 10 cards per row (cards overlap if space runs out); cards 11+ go to a back row showing 60% (--peek), popping up fully on hover
export function Hand({ p, hidden, cards, seen, selUid, lightOf, picks, guards, onClick, onHover }: {
  p: PlayerId;
  hidden?: boolean;                                // the bot's hand: show card backs
  cards: CardInstance[];
  seen: Map<string, Spot>;                         // previous positions on the board: cards entering the hand fly from where they were (from the deck if unknown)
  selUid?: string;
  lightOf: (uid: string) => Light;
  picks: string[];
  guards: string[];
  onClick: (inst: CardInstance) => void;
  onHover: (uid: string | undefined) => void;     // on hover the detail panel temporarily shows that card
}) {
  const slots = useRef(new Map<string, HTMLElement>());
  const lastRects = useRef(new Map<string, DOMRect>());

  // FLIP: compare positions before/after render; existing cards slide from their old place, new cards fly from where they were on the board
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
  // The row nearest the screen edge is on top; the next rows hide behind it, showing 60%
  const row = (list: CardInstance[], i: number) => (
    <div key={i} className="hand-row" style={{ zIndex: rows.length - i }}>
      {list.map((h) => (
        <span key={h.uid} ref={slotRef(h.uid)} className="hand-slot" onMouseEnter={hidden ? undefined : () => onHover(h.uid)} onMouseLeave={hidden ? undefined : () => onHover(undefined)}>
          <CardView inst={h} plain hidden={hidden} selected={h.uid === selUid} light={hidden ? undefined : lightOf(h.uid)} picked={!hidden && picks.includes(h.uid)} guarding={!hidden && guards.includes(h.uid)} onClick={() => onClick(h)} />
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
