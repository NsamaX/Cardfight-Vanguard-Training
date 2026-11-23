import type { CSSProperties } from "react";
import type { PlayerState } from "../../engine/types";
import { useT } from "../../i18n/react";
import type { Light } from "../../lib/board";
import { CardView } from "../CardView";

const MAX_STEP = 28;      // ส่วนที่โผล่ของการ์ดใบที่ถูกทับ (px)
const MAX_SPREAD = 84;    // ความกว้างรวมของส่วนที่โผล่ทั้งหมด การ์ดยิ่งเยอะยิ่งชิดกัน

// G โซน: ช่องโซน + G ที่หงายแล้วเรียงเข้าหากลางสนาม
// ใบใหม่สุดอยู่ติดช่องและเห็นเต็มใบ ใบเก่ากว่าถูกทับและโผล่ออกไปทีละแถบ
export function GZoneRow({ ps, toward, light, onOpen, onInspect }: {
  ps: PlayerState;
  light: Light;
  toward: "left" | "right";
  onOpen: () => void;
  onInspect: (uid: string) => void;
}) {
  const played = ps.gZone.filter((c) => c.faceUp);
  const stock = ps.gZone.length - played.length;
  const step = played.length > 1 ? Math.min(MAX_STEP, MAX_SPREAD / (played.length - 1)) : 0;
  return (
    <div className={`zone-row gZone to-${toward}`}>
      <div className={`zone-slot ${light ?? ""}`} onClick={onOpen}>{stock > 0 && <span className="back g" />}</div>
      {played.length > 0 && (
        <div className="fan" style={{ "--step": `${step}px` } as CSSProperties}>
          {[...played].reverse().map((c, i) => (
            <span key={c.uid} style={{ zIndex: played.length - i }}><CardView inst={c} noRotate plain onClick={() => onInspect(c.uid)} /></span>
          ))}
        </div>
      )}
    </div>
  );
}

const PILE_BADGE = { bind: "badge.bind", deck: "badge.deck", drop: "badge.drop" } as const;

// ไบนด์ / กองการ์ด / ดรอป: ป้ายจำนวนเหนือช่อง (แบบ GB/SB) + ใบบนสุด (กองการ์ดแสดงหลังการ์ด) คลิกเพื่อดูทั้งโซน
export function PileSlot({ ps, zone, light, onOpen }: { ps: PlayerState; zone: keyof typeof PILE_BADGE; light: Light; onOpen: () => void }) {
  const list = ps[zone];
  const top = list.at(-1);
  const t = useT();
  return (
    <div className={`pile-group ${zone}`} onClick={onOpen}>
      <span className="badge">{t(PILE_BADGE[zone])} {list.length}</span>
      <div className={`zone-slot ${light ?? ""}`}>{top && (zone === "deck" ? <span className="back" /> : <CardView inst={top} noRotate plain />)}</div>
    </div>
  );
}
