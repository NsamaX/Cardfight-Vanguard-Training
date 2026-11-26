import type { BoardModel } from "../../hooks/useBoard";
import { useT } from "../../i18n/react";
import type { Deck, PlayerId } from "../../engine/types";
import { findCard } from "../../lib/board";
import { byGradeThenName } from "../../lib/deckEdit";
import { Modal, ModalCard } from "../Modal";

// Card choice dialog when an ability asks
export function ChoiceModal({ board }: { board: BoardModel }) {
  const { s, choice, choicePicks, toggleChoicePick, act, fieldChoice, choiceMin, setChoiceMin } = board;
  const t = useT();
  if (choice?.kind !== "cards" || fieldChoice || choiceMin || board.botTurn || board.readOnly) return null;
  const ok = choicePicks.length >= choice.min && choicePicks.length <= choice.max;
  return (
    <Modal
      onMinimize={() => setChoiceMin(true)}
      title={t("modal.pickTitle", { prompt: s.awaiting!.prompt!, range: choice.min === choice.max ? String(choice.min) : `${choice.min}-${choice.max}` })}
      footer={<>
        <span className="mute">{t("modal.picked", { n: choicePicks.length })}</span>
        <button className="btn primary" disabled={!ok} onClick={() => act({ type: "select-target", uids: choicePicks })}>{t("btn.confirm")}</button>
      </>}
    >
      {choice.options.map((u) => {
        const f = findCard(s, u);
        return f && <ModalCard key={u} inst={f.inst} picked={choicePicks.includes(u)} onClick={() => toggleChoicePick(u)} />;
      })}
    </Modal>
  );
}

// Dialog for viewing cards in a zone (click a G zone card to stride/call a G guardian), ordered from the top card
// The deck can be viewed while watching a replay, and both decks before Start (sorted by grade like the deck screen, not revealing the draw order)
// The G zone follows the deck order; drag a card onto another to reorder (onMoveG saves it to the deck)
export function PileModal({ board, started, decks, onMoveG }: { board: BoardModel; started: boolean; decks: Record<PlayerId, Deck>; onMoveG?: (p: PlayerId, from: string, to: string) => void }) {
  const { s, pile, setPile, clickPileCard } = board;
  const t = useT();
  if (!pile) return null;
  const preview = pile.zone === "deck" && !started;
  const gOrder = Object.keys(decks[pile.player].g_zone);
  const rank = (key: string) => { const i = gOrder.indexOf(key); return i < 0 ? gOrder.length : i; };
  const list = preview ? [...s.players[pile.player].deck].sort((a, b) => byGradeThenName(a.key, b.key))
    : pile.zone === "gZone" ? [...s.players[pile.player].gZone].sort((a, b) => rank(a.key) - rank(b.key))
    : s.players[pile.player][pile.zone];
  const p = pile.player;
  const drop = pile.zone === "gZone" && onMoveG && !board.readOnly
    ? (to: string) => (uid: string) => { const from = list.find((c) => c.uid === uid)?.key; if (from) onMoveG(p, from, to); }
    : undefined;
  const close = () => setPile(null);
  return (
    <Modal title={t("modal.pile", { zone: { key: `pile.${pile.zone}` }, n: list.length })} onClose={close}>
      {pile.zone === "deck" && !board.readOnly && !preview ? <span className="mute">{t("modal.deckHidden")}</span> : list.map((c) => (
        <ModalCard key={c.uid} inst={c} light={board.lightOf(c.uid)} onClick={() => clickPileCard(pile.player, pile.zone, c)} onDrop={drop?.(c.key)} />
      ))}
    </Modal>
  );
}
