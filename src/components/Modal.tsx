import type { ReactNode } from "react";
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

// การ์ดในหน้าต่างแสดงแบบหงายและตั้งตรงเสมอ เป็นรูปการ์ดอย่างเดียว (หน้าต่างจึงวางได้ 10 x 5 ใบพอดี)
export function ModalCard({ inst, picked, light, onClick }: { inst: CardInstance; picked?: boolean; light?: Light; onClick: () => void }) {
  return (
    <div className="mcard">
      <CardView inst={{ ...inst, faceUp: true, rested: false }} plain picked={picked} light={light} onClick={onClick} />
    </div>
  );
}
