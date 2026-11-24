import type { PlayerState } from "../../engine/types";
import { useT } from "../../i18n/react";
import type { Light } from "../../lib/board";
import { CardView } from "../CardView";

const PER_ROW = 4;

// G โซน: ช่องโซน + G ที่หงายแล้วเรียงแถวละ 4 ใบเข้าหากลางสนาม (สูงสุด 4 แถว)
// ใบใหม่สุดอยู่ติดช่องในแถวหน้าและเห็นเต็มใบ ใบเก่ากว่าถูกทับและโผล่ออกไปทีละแถบ
// แถวเก่ากว่าอยู่ข้างหลังและโผล่ออกไปทางขอบจอแบบดาเมจโซน
export function GZoneRow({ ps, toward, light, onOpen, onInspect }: {
  ps: PlayerState;
  light: Light;
  toward: "left" | "right";
  onOpen: () => void;
  onInspect: (uid: string) => void;
}) {
  const played = ps.gZone.filter((c) => c.faceUp);
  const stock = ps.gZone.length - played.length;
  const newest = [...played].reverse();
  const rows = Array.from({ length: Math.ceil(newest.length / PER_ROW) }, (_, r) => newest.slice(r * PER_ROW, (r + 1) * PER_ROW));
  return (
    <div className={`zone-row gZone to-${toward}`}>
      <div className={`zone-slot ${light ?? ""}`} onClick={onOpen}>{stock > 0 && <span className="back g" />}</div>
      {rows.length > 0 && (
        <div className="g-rows">
          {rows.map((row, r) => (
            <div key={r} className="fan" style={{ zIndex: rows.length - r }}>
              {row.map((c, i) => (
                <span key={c.uid} style={{ zIndex: row.length - i }}><CardView inst={c} noRotate plain onClick={() => onInspect(c.uid)} /></span>
              ))}
            </div>
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
      <div className={`zone-slot ${light ?? ""}`}>{top && (zone === "deck" ? <span className="back" data-uid={list[0].uid} /> : <CardView inst={top} noRotate plain />)}</div>
    </div>
  );
}
