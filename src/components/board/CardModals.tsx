import type { BoardModel } from "../../hooks/useBoard";
import { useT } from "../../i18n/react";
import { findCard } from "../../lib/board";
import { Modal, ModalCard } from "../Modal";

// หน้าต่างเลือกการ์ดเมื่อความสามารถถาม
export function ChoiceModal({ board }: { board: BoardModel }) {
  const { s, choice, choicePicks, toggleChoicePick, act, fieldChoice, choiceMin, setChoiceMin } = board;
  const t = useT();
  if (choice?.kind !== "cards" || fieldChoice || choiceMin) return null;
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

// หน้าต่างดูการ์ดในโซน (G โซนคลิกเพื่อสไตรด์/คอล G การ์เดี้ยนได้)
export function PileModal({ board }: { board: BoardModel }) {
  const { s, pile, setPile, clickPileCard } = board;
  const t = useT();
  if (!pile) return null;
  const list = s.players[pile.player][pile.zone];
  const close = () => setPile(null);
  return (
    <Modal title={t("modal.pile", { zone: { key: `pile.${pile.zone}` }, n: list.length })} onClose={close}>
      {pile.zone === "deck" ? <span className="mute">{t("modal.deckHidden")}</span> : list.map((c) => (
        <ModalCard key={c.uid} inst={c} light={board.lightOf(c.uid)} onClick={() => clickPileCard(pile.player, pile.zone, c)} />
      ))}
    </Modal>
  );
}
