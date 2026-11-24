import { cardByKey as db } from "../../data/cards";
import { criticalOf, powerOf } from "../../engine/rules";
import type { Circle, PlayerId, PlayerState } from "../../engine/types";
import { useT } from "../../i18n/react";
import { LAYOUT, type Light, type Zone } from "../../lib/board";
import { CardView } from "../CardView";

interface Props {
  p: PlayerId;
  ps: PlayerState;
  selUid?: string;
  pickedCircle?: Circle;                  // ช่องที่เลือกรับ Power+5000 ของทริกเกอร์ไว้แล้ว
  lightOf: (uid: string) => Light;        // ขอบเหลือง/ส้มของการ์ดที่มีความสามารถรอ/กำลังทำงาน
  soulLight: Light;
  atkCircles: Circle[];                   // ตัวโจมตี/บูสท์ ที่เลือกอยู่หรือกำลังโจมตี (ขอบแดง)
  aimedCircles: Circle[];                 // ยูนิทที่ถูกโจมตีอยู่ (ขอบแดง)
  bonus: Partial<Record<Circle, number>>; // Power จากบูสท์ที่เลือกไว้ (แสดงล่วงหน้า)
  isTarget: (c: Circle) => boolean;
  onCircle: (c: Circle) => void;
  onPile: (z: Zone) => void;
  onCard: (uid: string) => void;          // คลิกการ์ดในโซลที่โผล่ออกมา (เลือกความสามารถของการ์ดนั้น)
}

export function FieldSide({ p, ps, selUid, pickedCircle, lightOf, soulLight, atkCircles, aimedCircles, bonus, isTarget, onCircle, onPile, onCard }: Props) {
  // การ์ดในโซลที่มีความสามารถรอ (เช่น ผู้เริ่มต้นหลังถูกไรด์ทับ) โผล่ออกมาจากใต้ VC ให้เห็นและคลิกได้
  const soulCard = ps.soul.find((c) => lightOf(c.uid));
  const t = useT();
  return (
    <section className={`side ${p}`}>
      <div className="col" />
      <div className="grid">
        {LAYOUT[p].map((c) => {
          const unit = ps.circles[c];
          return (
            <div key={c} className={`slot ${c === "vc" ? "vc" : ""} ${isTarget(c) ? "target" : ""} ${(unit && lightOf(unit.uid)) ?? ""} ${atkCircles.includes(c) ? "atk" : ""} ${aimedCircles.includes(c) ? "aimed" : ""}`} onClick={() => onCircle(c)}>
              <span className="lbl">{c === "vc" ? "VC" : "RC"}</span>
              {c === "vc" && ps.heart && (lightOf(ps.heart.uid)
                // ฮาร์ทที่มีความสามารถรอ (เช่น ไนท์โรส "เมื่อ G ยูนิทสไตรด์") โผล่ออกมาให้คลิกแยกจาก G ยูนิทได้
                ? <span className="heart soul-peek lit" onClick={(e) => { e.stopPropagation(); onCard(ps.heart!.uid); }}><CardView inst={ps.heart} noRotate light={lightOf(ps.heart.uid)} /></span>
                : <span className="heart"><CardView inst={ps.heart} noRotate /></span>)}
              {c === "vc" && soulCard && (
                <span className="soul-peek" onClick={(e) => { e.stopPropagation(); onCard(soulCard.uid); }}>
                  <CardView inst={soulCard} noRotate light={lightOf(soulCard.uid)} />
                </span>
              )}
              {c === "vc" && <button className={`badge soul-count ${soulLight ?? ""}`} onClick={(e) => { e.stopPropagation(); onPile("soul"); }}>SB {ps.soul.length}</button>}
              {unit && (() => {
                const power = powerOf(db, ps, c) + (bonus[c] ?? 0);
                const base = powerOf(db, ps, c) - unit.mods.reduce((n, m) => n + (m.stat === "power" ? m.value : 0), 0);
                return <CardView inst={unit} power={power} noName powerUp={power > base} critUp={criticalOf(db, unit) - (db[unit.key].critical ?? 0)}
                  selected={unit.uid === selUid} picked={pickedCircle === c} />;
              })()}
              {unit?.hollowed && <span className="tag">{t("card.hollow")}</span>}
            </div>
          );
        })}
      </div>
      <div className="col" />
    </section>
  );
}
