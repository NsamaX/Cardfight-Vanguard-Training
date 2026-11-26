import type { PlayerState } from "../../engine/types";
import { useT } from "../../i18n/react";
import type { Light } from "../../lib/board";
import { CardView } from "../CardView";

const PER_ROW = 4;

// G zone: the zone slot + face-up G units in rows of 4 toward the board center (up to 4 rows)
// The newest is next to the slot in the front row and fully visible; older ones are covered, each showing a strip
// Older rows sit behind, showing toward the screen edge like the damage zone
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

// Bind / deck / drop: count label above the slot (like GB/SB) + the top card (the deck shows a card back); click to view the whole zone
// The deck stacks a card back for every card (top card in front), so cards entering/leaving the deck fly from and to it
export function PileSlot({ ps, zone, light, onOpen }: { ps: PlayerState; zone: keyof typeof PILE_BADGE; light: Light; onOpen: () => void }) {
  const list = ps[zone];
  const top = list.at(-1);
  const t = useT();
  return (
    <div className={`pile-group ${zone}`} onClick={onOpen}>
      <span className="badge">{t(PILE_BADGE[zone])} {list.length}</span>
      <div className={`zone-slot ${light ?? ""}`}>{top && (zone === "deck" ? list.slice().reverse().map((c) => <span key={c.uid} className="back" data-uid={c.uid} />) : <CardView inst={top} noRotate plain />)}</div>
    </div>
  );
}
