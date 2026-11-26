import type { GameState } from "../../engine/types";
import { useT } from "../../i18n/react";
import { PHASES, phaseIndex } from "../../lib/board";

// Phases run bottom to top: START at the bottom, END at the top
export function PhaseTrack({ s }: { s: GameState }) {
  const current = phaseIndex(s);
  const t = useT();
  return (
    <div className="phases">
      {PHASES.map((ph, i) => (
        <div key={ph.label} className={`ph ${i === current ? "on" : i < current ? "past" : ""}`}>
          {i === current && <span className="ph-cursor" aria-hidden="true" />}
          <span className="name">{t(ph.label)}</span>
        </div>
      ))}
    </div>
  );
}
