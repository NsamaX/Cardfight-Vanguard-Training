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
  pickedCircle?: Circle;                  // circle already chosen to receive the trigger's Power+5000
  lightOf: (uid: string) => Light;        // yellow/orange border for cards with a pending/resolving ability
  soulLight: Light;
  atkCircles: Circle[];                   // attacker/booster selected or attacking (red border)
  aimedCircles: Circle[];                 // unit being attacked (blue border)
  bonus: Partial<Record<Circle, number>>; // Power from the selected boost (shown in advance)
  isTarget: (c: Circle) => boolean;
  onCircle: (c: Circle) => void;
  onPile: (z: Zone) => void;
  onCard: (uid: string) => void;          // click a soul card that sticks out (choose that card's ability)
}

export function FieldSide({ p, ps, selUid, pickedCircle, lightOf, soulLight, atkCircles, aimedCircles, bonus, isTarget, onCircle, onPile, onCard }: Props) {
  // Soul cards with a pending ability (e.g. the starter after being ridden upon) stick out from under VC so they can be seen and clicked
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
                // A heart with a pending ability (e.g. Nightrose "when a G unit strides") sticks out to be clicked separately from the G unit
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
