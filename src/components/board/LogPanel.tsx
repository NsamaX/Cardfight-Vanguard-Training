import { useEffect, useRef, type ReactNode } from "react";
import type { MsgKey } from "../../i18n/msg";
import { useT } from "../../i18n/react";
import { groupByTurn, type LogEntry } from "../../lib/board";

// บรรทัดที่เกมทำเองหรือเป็นแค่ขั้นตอน ไม่แสดงในประวัติ (ให้เหลือแต่สิ่งที่ผู้เล่นทำและผลของมัน)
const HIDDEN = new Set<MsgKey>([
  "log.turnStart", "log.standUp", "log.battlePhase", "log.battleEnd", "log.gReturn",
  "log.abilityStart", "log.skip", "log.blocked", "log.shuffle",
]);

// ประวัติเรียงจากเก่าไปใหม่ (ล่างขึ้นบน ชิดแถบเฟส) ชื่อเทิร์นอยู่ใต้รายการของเทิร์นนั้น มีรายการใหม่แล้วเลื่อนขึ้นบนสุด
export function LogPanel({ log, onInspect, children }: { log: LogEntry[]; onInspect: (uid: string) => void; children: ReactNode }) {
  const logRef = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = 0; }, [log]);

  return (
    <aside className="left">
      <div className="log" ref={logRef}>
        <div className="log-body">
          {groupByTurn(log.filter((e) => !HIDDEN.has(e.text.key))).reverse().map((turn) => (
            <div key={turn.turn}>
              {turn.items.map((e, j) => (
                <div key={j} className="e" onClick={() => e.cardUid && onInspect(e.cardUid)} style={{ cursor: e.cardUid ? "pointer" : undefined }}>
                  <span className={`dot ${e.player}`} /><span>{t(e.text)}</span>
                </div>
              )).reverse()}
              <div className="tn">{turn.turn === 0 ? t("log.setupTurn") : t("log.turnLabel", { n: turn.turn })}</div>
            </div>
          ))}
        </div>
      </div>
      {children}
    </aside>
  );
}
