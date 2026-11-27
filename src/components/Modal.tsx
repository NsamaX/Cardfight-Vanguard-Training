import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { CardInstance } from "../engine/types";
import { useT } from "../i18n/react";
import type { Light } from "../lib/board";
import { CardView } from "./CardView";

// onMinimize: minimize the dialog to look at the board (you still have to come back and finish choosing); clicking outside does this too when there's no onClose
// "Outside" is anywhere on the page, not just the veil: the veil covers only the board, not the log and the right panel
export function Modal({ title, onClose, onMinimize, footer, children }: { title: ReactNode; onClose?: () => void; onMinimize?: () => void; footer?: ReactNode; children: ReactNode }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onClose ?? onMinimize);
  dismiss.current = onClose ?? onMinimize;
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) dismiss.current?.(); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, []);
  return (
    <div className="veil">
      <div className="modal" ref={box}>
        <div className="mh"><span>{title}</span>{onMinimize && <button className="btn" title={t("btn.minimize")} onClick={onMinimize}>–</button>}{onClose && <button className="btn" onClick={onClose}>×</button>}</div>
        <div className="mb">{children}</div>
        {footer && <div className="mh" style={{ borderTop: "1px solid var(--line)", borderBottom: "none" }}>{footer}</div>}
      </div>
    </div>
  );
}

const DRAG_TYPE = "application/x-vanguard-card";

// Cards in the dialog are always face up and upright, image only (so the dialog fits exactly 10 x 5 cards)
// onDrop: another card can be dragged onto this one (passes the dragged card's uid)
export function ModalCard({ inst, picked, light, onClick, onDrop }: { inst: CardInstance; picked?: boolean; light?: Light; onClick: () => void; onDrop?: (uid: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const drag = onDrop && {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData(DRAG_TYPE, inst.uid); e.dataTransfer.effectAllowed = "move"; setDragging(true); },
    onDragEnd: () => setDragging(false),
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault(); },
    onDrop: (e: DragEvent) => { e.preventDefault(); onDrop(e.dataTransfer.getData(DRAG_TYPE)); },
  };
  return (
    <div className={`mcard${drag ? " sortable" : ""}${dragging ? " dragging" : ""}`} {...drag}>
      <CardView inst={{ ...inst, faceUp: true, rested: false }} plain picked={picked} light={light} onClick={onClick} />
    </div>
  );
}
