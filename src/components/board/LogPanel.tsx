import { useEffect, useRef, type ReactNode } from "react";
import type { MsgKey } from "../../i18n/msg";
import { useT } from "../../i18n/react";
import { groupByTurn, type LogEntry } from "../../lib/board";

// Lines the game does by itself or that are just steps aren't shown in the history (keep only what the player did and its results)
const HIDDEN = new Set<MsgKey>([
  "log.turnStart", "log.standUp", "log.battlePhase", "log.battleEnd", "log.gReturn",
  "log.abilityStart", "log.skip", "log.blocked", "log.shuffle",
]);

// History runs old to new (bottom to top, next to the phase bar); the turn name sits below that turn's entries; new entries scroll to the top
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
