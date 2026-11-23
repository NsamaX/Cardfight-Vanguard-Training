import { cardByKey as db } from "../../data/cards";
import type { GameState } from "../../engine/types";
import { useT } from "../../i18n/react";
import { battleSummary, type Light } from "../../lib/board";
import { fmt } from "../../lib/format";
import { CardView } from "../CardView";

const Sword = ({ label }: { label: string }) => (
  <svg className="ico" viewBox="0 0 24 24" aria-label={label}><path d="M14.5 3H21v6.5L10 20.5l-2.5.5.5-2.5zM5 16l3 3M3.5 20.5l2-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Shield = ({ label }: { label: string }) => (
  <svg className="ico" viewBox="0 0 24 24" aria-label={label}><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
);

// แถบการต่อสู้สองข้างของปุ่มกลาง: ซ้าย = Power ฝ่ายโจมตี (+การ์ดที่เปิดเช็ค) ขวา = Power+Shield ฝ่ายป้องกัน (+การ์ดบน GC)
// preview: การ์ดที่เลือกจะการ์ดแต่ยังไม่ยืนยัน (พิทักษ์ หรือไม่ฮิทแน่นอนแล้ว แสดง --)
export function BattleSide({ side, s, preview, lightOf, onInspect, onCheck }: {
  side: "atk" | "def";
  s: GameState;
  preview?: { shield: number; sentinel: boolean };
  lightOf: (uid: string) => Light;
  onInspect: (uid: string) => void;
  onCheck?: (uid: string) => void;       // คลิกการ์ดที่เปิดเช็ค (เลือกผลทริกเกอร์)
}) {
  const b = battleSummary(db, s);
  const t = useT();
  if (!b) return <div className={`bside ${side}`} />;
  // ทริกเกอร์ของการต่อสู้นี้: ไดรฟ์เช็ค (ฝ่ายโจมตี) อยู่ซ้าย ดาเมจเช็ค (ฝ่ายป้องกัน) อยู่ขวา เรียงตามลำดับที่เปิด
  const trigs = (during: "drive" | "damage") => (s.battle?.triggers ?? []).filter((t) => t.during === during).map((t) => (
    <CardView key={t.card.uid} inst={t.card} plain noRotate dim={t.done} light={t.done ? undefined : lightOf(t.card.uid)}
      onClick={() => (t.done ? onInspect : onCheck ?? onInspect)(t.card.uid)} />
  ));
  if (side === "atk") return (
    <div className="bside atk">
      {trigs("drive")}
      <span className="big">{fmt(b.attack)}</span><Sword label={t("battle.attack")} />
    </div>
  );
  return (
    <div className="bside def">
      <span className="big">{s.battle?.noHit || preview?.sentinel ? "--" : fmt(b.total + (preview?.shield ?? 0))}</span><Shield label={t("battle.defense")} />
      {b.guardians.map((g) => <CardView key={g.uid} inst={g} plain noRotate light={lightOf(g.uid)} onClick={() => onInspect(g.uid)} />)}
      {trigs("damage")}
    </div>
  );
}
