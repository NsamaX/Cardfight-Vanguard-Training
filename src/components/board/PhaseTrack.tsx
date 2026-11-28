import { useState } from "react";
import type { GameState } from "../../engine/types";
import { useT } from "../../i18n/react";
import { PHASES, phaseIndex } from "../../lib/board";

const STORE = "phases-folded";
const readFolded = () => { try { return localStorage.getItem(STORE) !== "0"; } catch { return true; } };

// Phases run bottom to top: START at the bottom, END at the top.
// Hovering the line above them shows a tab that folds them down to the current step (remembered in this browser)
export function PhaseTrack({ s }: { s: GameState }) {
  const current = phaseIndex(s);
  const t = useT();
  const [folded, setFolded] = useState(readFolded);
  function toggle() {
    setFolded(!folded);
    try { localStorage.setItem(STORE, folded ? "0" : "1"); } catch { /* private window: not remembered */ }
  }
  const label = t(folded ? "ui.phasesUnfold" : "ui.phasesFold");
  return (
    <div className={`phases ${folded ? "folded" : ""}`}>
      <button type="button" className="ph-fold" onClick={toggle} title={label} aria-label={label} aria-expanded={!folded}>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={folded ? "M1 5 5 1l4 4" : "M1 1l4 4 4-4"} />
        </svg>
      </button>
      {PHASES.map((ph, i) => (
        <div key={ph.label} className={`ph ${i === current ? "on" : i < current ? "past" : ""}`}>
          {i === current && <span className="ph-cursor" aria-hidden="true" />}
          <span className="name">{t(ph.label)}</span>
        </div>
      ))}
    </div>
  );
}
