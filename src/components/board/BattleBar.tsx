import { cardByKey as db } from "../../data/cards";
import type { GameState, PlayerId } from "../../engine/types";
import { useT } from "../../i18n/react";
import { battleSummary, type Light } from "../../lib/board";
import { fmt } from "../../lib/format";
import { CardView } from "../CardView";

const Sword = ({ label }: { label: string }) => (
  <svg className="ico" viewBox="0 0 24 24" aria-label={label}><path d="M14.5 3H21v6.5L10 20.5l-2.5.5.5-2.5zM5 16l3 3M3.5 20.5l2-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Shield = ({ label }: { label: string }) => (
  <svg className="ico" viewBox="0 0 24 24" aria-label={label}><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
);

// Battle bar split by role: attacker on the left, defender on the right
// Numbers (BattleNum) sit diagonally in the middle of the bar: attack top-left, guard bottom-right / cards (BattleSide) sit outside
// Attacker (turn player): Power + drive check cards / defender: Power+Shield + cards on GC + damage check
// preview: cards selected to guard but not yet confirmed (a sentinel, or a guaranteed no-hit, shows --)
export function BattleNum({ p, s, preview }: { p: PlayerId; s: GameState; preview?: { shield: number; sentinel: boolean } }) {
  const b = battleSummary(db, s);
  const t = useT();
  if (!b) return null;
  return p === s.turnPlayer
    ? <span className={`num atk ${p}`}><span className="big">{fmt(b.attack)}</span><Sword label={t("battle.attack")} /></span>
    : <span className={`num def ${p}`}><span className="big">{s.battle?.noHit || preview?.sentinel ? "--" : fmt(b.total + (preview?.shield ?? 0))}</span><Shield label={t("battle.defense")} /></span>;
}

export function BattleSide({ p, s, lightOf, onInspect, onCheck, onGuardian }: {
  p: PlayerId;
  s: GameState;
  lightOf: (uid: string) => Light;
  onInspect: (uid: string) => void;
  onCheck?: (uid: string) => void;       // click a revealed check card (choose the trigger effect)
  onGuardian?: (uid: string) => boolean;  // click a card on GC: return it to where it came from (false = can't, show details instead)
}) {
  const b = battleSummary(db, s);
  const atk = p === s.turnPlayer;
  const cls = `bside ${atk ? "left" : "right"} ${p}`;
  if (!b) return <div className={cls} />;
  const trigs = (during: "drive" | "damage") => (s.battle?.triggers ?? []).filter((t) => t.during === during).map((t) => (
    <span key={t.card.uid}><CardView inst={t.card} plain noRotate dim={t.done} light={t.done ? undefined : lightOf(t.card.uid)}
      onClick={() => (t.done ? onInspect : onCheck ?? onInspect)(t.card.uid)} /></span>
  ));
  const cards = atk ? trigs("drive") : [
    ...b.guardians.map((g) => <span key={g.uid}><CardView inst={g} plain noRotate light={lightOf(g.uid)} onClick={() => { if (!onGuardian?.(g.uid)) onInspect(g.uid); }} /></span>),
    ...trigs("damage"),
  ];
  return <div className={cls}>{cards}</div>;
}
