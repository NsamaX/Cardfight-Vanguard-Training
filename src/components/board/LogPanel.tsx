import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "../../i18n/react";
import { groupByTurn, type LogEntry } from "../../lib/board";

// ประวัติเรียงจากใหม่ไปเก่า (บนลงล่าง) มีรายการใหม่แล้วเลื่อนกลับขึ้นบนสุด
export function LogPanel({ log, onInspect, children }: { log: LogEntry[]; onInspect: (uid: string) => void; children: ReactNode }) {
  const logRef = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = 0; }, [log]);

  return (
    <aside className="left">
      <div className="log" ref={logRef}>
        {groupByTurn(log).reverse().map((turn) => (
          <div key={turn.turn}>
            <div className="tn">{turn.turn === 0 ? t("log.setupTurn") : t("log.turnLabel", { n: turn.turn })}</div>
            {[...turn.items].reverse().map((e, j) => (
              <div key={j} className="e" onClick={() => e.cardUid && onInspect(e.cardUid)} style={{ cursor: e.cardUid ? "pointer" : undefined }}>
                <span className={`dot ${e.player}`} /><span>{t(e.text)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {children}
    </aside>
  );
}
