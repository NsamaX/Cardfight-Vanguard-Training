import type { PlayerState } from "../../engine/types";
import { useT } from "../../i18n/react";
import type { Light } from "../../lib/board";
import { CardView } from "../CardView";

const PER_ROW = 4;

// G zone: the zone slot + face-up G units in rows of 4 toward the board center (up to 4 rows), in the order they were used:
// left to right from the slot, top to bottom (mirrored on the bot side); each card covers the one before it, so the newest is fully visible
// Like the hand, each row sits in front of the one before it, which shows a strip on the side of the G zone slot
export function GZoneRow({ ps, toward, light, onOpen, onInspect }: {
  ps: PlayerState;
  light: Light;
  toward: "left" | "right";
  onOpen: () => void;
  onInspect: (uid: string) => void;
}) {
  const played = ps.gZone.filter((c) => c.faceUp);
  const rows = Array.from({ length: Math.ceil(played.length / PER_ROW) }, (_, r) => played.slice(r * PER_ROW, (r + 1) * PER_ROW));
  return (
    <div className={`zone-row gZone to-${toward}`}>
      <div className={`zone-slot ${light ?? ""}`} onClick={onOpen}>{ps.gZone.filter((c) => !c.faceUp).map((c) => <span key={c.uid} className="back g" data-uid={c.uid} />)}</div>
      {rows.length > 0 && (
        <div className="g-rows">
          {rows.map((row, r) => (
            <div key={r} className="fan" style={{ zIndex: r + 1 }}>
              {row.map((c, i) => (
                <span key={c.uid} style={{ zIndex: i + 1 }}><CardView inst={c} noRotate plain noGrade onClick={() => onInspect(c.uid)} /></span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PILE_BADGE = { bind: "badge.bind", deck: "badge.deck", drop: "badge.drop" } as const;

// Bind / deck / drop: count label above the slot (like GB/SB) + the top card (the deck shows a card back); click to view the whole zone
// Every card is stacked in the slot (the last one on top), so cards entering/leaving any pile fly from and to it
export function PileSlot({ ps, zone, light, onOpen }: { ps: PlayerState; zone: keyof typeof PILE_BADGE; light: Light; onOpen: () => void }) {
  const list = ps[zone];
  const t = useT();
  return (
    <div className={`pile-group ${zone}`} onClick={onOpen}>
      <span className="badge">{t(PILE_BADGE[zone])} {list.length}</span>
      <div className={`zone-slot ${light ?? ""}`}>{zone === "deck"
        ? list.slice().reverse().map((c) => <span key={c.uid} className="back" data-uid={c.uid} />)
        : list.map((c) => <CardView key={c.uid} inst={c} noRotate plain />)}</div>
    </div>
  );
}
