import { createContext, useContext } from "react";
import { cardByKey as db } from "../data/cards";
import type { CardInstance } from "../engine/types";
import { useT } from "../i18n/react";
import type { Light } from "../lib/board";
import { fmt } from "../lib/format";

interface Props {
  inst: CardInstance;
  power?: number;
  small?: boolean;
  selected?: boolean;
  picked?: boolean;
  hidden?: boolean;
  noRotate?: boolean;
  mark?: boolean;          // trigger/G label in the top-right corner (shown in the deck builder; the board shows grade only)
  plain?: boolean;         // hide the name and power strip (cards in hand)
  light?: Light;
  dim?: boolean;           // used (light gray)
  noName?: boolean;        // card on the board: show Power only
  powerUp?: boolean;       // Power above base (boost/effect/trigger) shown in red
  critUp?: number;         // added Critical, shown as +x in yellow
  onClick?: () => void;
}

// Hovering a face-up card temporarily shows it in the detail panel (only on boards that pass a handler)
export const CardHover = createContext<((uid: string | undefined) => void) | undefined>(undefined);

export function CardView({ inst, power, small, selected, picked, hidden, noRotate, mark, plain, light, dim, noName, powerUp, critUp, onClick }: Props) {
  const card = db[inst.key];
  const hover = useContext(CardHover);
  const t = useT();
  const cls = ["card", small && "small", selected && "sel", picked && "pick", light, dim && "dim", inst.rested && !noRotate && "rested"].filter(Boolean).join(" ");
  if (hidden || !inst.faceUp) {
    return <button className={cls} data-uid={inst.uid} onClick={onClick} title={t("card.faceDown")}><span className={`back ${card.type.startsWith("g-") ? "g" : ""}`} /></button>;
  }
  const shown = power ?? card.power ?? card.shield;
  return (
    <button className={cls} data-uid={inst.uid} onClick={onClick} title={card.name} onMouseEnter={hover && (() => hover(inst.uid))} onMouseLeave={hover && (() => hover(undefined))}>
      {card.image && <img src={card.image} alt="" draggable={false} />}
      <span className="grade">{card.grade}</span>
      {mark && (card.trigger || card.type.startsWith("g-")) && <span className="mark">{card.trigger ? t(`mark.${card.trigger}`) : "G"}</span>}
      {!plain && (
        <span className="strip">
          {!noName && <span className="nm">{card.name}</span>}
          {shown != null && (
            <span className="pw">
              <span className={powerUp ? "up" : undefined}>{card.type === "g-guardian" ? "S " : ""}{fmt(shown)}</span>
              {!!critUp && <span className="cri">+{critUp}</span>}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
