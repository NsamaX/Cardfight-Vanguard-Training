import { createContext, useContext } from "react";
import { cardByKey as db } from "../data/cards";
import type { CardInstance } from "../engine/types";
import { useT } from "../i18n/react";
import type { Light } from "../lib/board";
import { fmt } from "../lib/format";

interface Props {
  inst: CardInstance;
  power?: number;
  small?: boolean;
  selected?: boolean;
  picked?: boolean;
  hidden?: boolean;
  noRotate?: boolean;
  mark?: boolean;          // ป้ายทริกเกอร์/G มุมขวาบน (แสดงในหน้าสร้างเด็ค หน้าเล่นแสดงแค่เกรด)
  plain?: boolean;         // ไม่แสดงแถบชื่อและพลัง (การ์ดในมือ)
  light?: Light;
  dim?: boolean;           // ใช้แล้ว (สีเทาอ่อน)
  noName?: boolean;        // การ์ดบนสนาม: แสดงแค่ Power
  powerUp?: boolean;       // Power สูงกว่าค่าพื้นฐาน (บูสท์/ผล/ทริกเกอร์) แสดงสีแดง
  critUp?: number;         // Critical ที่เพิ่มขึ้น แสดง +x สีเหลือง
  onClick?: () => void;
}

// ชี้เมาส์ที่การ์ดหงายหน้าแล้วแผงรายละเอียดแสดงการ์ดใบนั้นชั่วคราว (เฉพาะหน้าสนามที่ส่งตัวรับมา)
export const CardHover = createContext<((uid: string | undefined) => void) | undefined>(undefined);

export function CardView({ inst, power, small, selected, picked, hidden, noRotate, mark, plain, light, dim, noName, powerUp, critUp, onClick }: Props) {
  const card = db[inst.key];
  const hover = useContext(CardHover);
  const t = useT();
  const cls = ["card", small && "small", selected && "sel", picked && "pick", light, dim && "dim", inst.rested && !noRotate && "rested"].filter(Boolean).join(" ");
  if (hidden || !inst.faceUp) {
    return <button className={cls} data-uid={inst.uid} onClick={onClick} title={t("card.faceDown")}><span className={`back ${card.type.startsWith("g-") ? "g" : ""}`} /></button>;
  }
  const shown = power ?? card.power ?? card.shield;
  return (
    <button className={cls} data-uid={inst.uid} onClick={onClick} title={card.name} onMouseEnter={hover && (() => hover(inst.uid))} onMouseLeave={hover && (() => hover(undefined))}>
      {card.image && <img src={card.image} alt="" draggable={false} />}
      <span className="grade">{card.grade}</span>
      {mark && (card.trigger || card.type.startsWith("g-")) && <span className="mark">{card.trigger ? t(`mark.${card.trigger}`) : "G"}</span>}
      {!plain && (
        <span className="strip">
          {!noName && <span className="nm">{card.name}</span>}
          {shown != null && (
            <span className="pw">
              <span className={powerUp ? "up" : undefined}>{card.type === "g-guardian" ? "S " : ""}{fmt(shown)}</span>
              {!!critUp && <span className="cri">+{critUp}</span>}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
