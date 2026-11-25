import { useState, type DragEvent, type ReactNode } from "react";
import type { CardInstance } from "../engine/types";
import { useT } from "../i18n/react";
import type { Light } from "../lib/board";
import { CardView } from "./CardView";

// onMinimize: ย่อหน้าต่างไว้ดูสนาม (ยังต้องกลับมาเลือกให้เสร็จ)
export function Modal({ title, onClose, onMinimize, footer, children }: { title: ReactNode; onClose?: () => void; onMinimize?: () => void; footer?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <div className="veil" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh"><span>{title}</span>{onMinimize && <button className="btn" title={t("btn.minimize")} onClick={onMinimize}>–</button>}{onClose && <button className="btn" onClick={onClose}>×</button>}</div>
        <div className="mb">{children}</div>
        {footer && <div className="mh" style={{ borderTop: "1px solid var(--line)", borderBottom: "none" }}>{footer}</div>}
      </div>
    </div>
  );
}

const DRAG_TYPE = "application/x-vanguard-card";

// การ์ดในหน้าต่างแสดงแบบหงายและตั้งตรงเสมอ เป็นรูปการ์ดอย่างเดียว (หน้าต่างจึงวางได้ 10 x 5 ใบพอดี)
// onDrop: ลากการ์ดใบอื่นมาวางบนใบนี้ได้ (ส่ง uid ของใบที่ลากมา)
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
