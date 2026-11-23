import type { PlayerId, PlayerState } from "../../engine/types";
import { useT } from "../../i18n/react";
import type { Light } from "../../lib/board";
import { CardView } from "../CardView";

// ดาเมจโซน 6 ช่อง การ์ดวางแนวนอนซ้อนกัน ใบถัดไปทับใบก่อนหน้า (ฝั่งบอทเรียงจากล่างขึ้นบนเพราะมองกลับหัว)
export function DamageZone({ p, ps, light, onOpen }: { p: PlayerId; ps: PlayerState; light: Light; onOpen: () => void }) {
  const t = useT();
  return (
    <div className="dmg-group">
      <span className="badge">{t("badge.damage")} {ps.damage.length}</span>
      <div className={`damage ${p} ${light ?? ""}`} onClick={onOpen} title={t("zone.damage")}>
        {Array.from({ length: 6 }, (_, i) => {
          const d = ps.damage[i];
          return <span key={i} className="dmg-slot">{d && <span className="dmg-card"><CardView inst={d} noRotate plain /></span>}</span>;
        })}
      </div>
    </div>
  );
}
