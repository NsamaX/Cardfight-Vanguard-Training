import { useEffect, useRef, useState } from "react";
import { validateDeck } from "../data/decks";
import type { Deck } from "../engine/types";
import { useAuth } from "../hooks/useAuth";
import type { LibraryHandle } from "../hooks/useLibrary";
import type { Msg } from "../i18n/msg";
import { useT } from "../i18n/react";
import { CODE_LENGTH, closeRoom, createRoom, findActiveMatch, joinRoom, pollRoom, problemOf, type OnlineStart, type WaitingRoom } from "../lib/online";

const POLL_MS = 1500;

// Online lobby: create a room and wait with its code, join a friend's room by code, or go back to a match still running
export function OnlineDialog({ library, deck, onReady, onClose }: {
  library: LibraryHandle;
  deck: Deck;                 // preselected: the deck on our side of the board
  onReady: (o: OnlineStart) => void;
  onClose: () => void;
}) {
  const t = useT();
  const auth = useAuth();
  const userId = library.userId;
  const [deckId, setDeckId] = useState(library.decks.some((d) => d.id === deck.id) ? deck.id : library.decks[0]?.id);
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<WaitingRoom>();
  const [active, setActive] = useState<OnlineStart>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Msg>();
  const running = useRef(false);   // busy only takes effect on the next render: a second submit in the same moment would join twice
  const picked = library.decks.find((d) => d.id === deckId);
  const deckError = picked && validateDeck(picked)[0];

  useEffect(() => {
    if (!userId) return;
    let live = true;
    findActiveMatch(userId).then((m) => { if (live) setActive(m); }, (e) => { if (live) setProblem(problemOf(e)); });   // also shows a database not migrated yet
    return () => { live = false; };
  }, [userId]);

  // Waiting host: check until the guest joins
  useEffect(() => {
    if (!room || !userId) return;
    let live = true;
    const timer = setInterval(() => {
      pollRoom(room, userId).then((m) => { if (live && m) { live = false; onReady({ match: m, actions: [] }); } }, (e) => { if (live) { setRoom(undefined); setProblem(problemOf(e)); } });
    }, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [room, userId]);

  async function run(f: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setProblem(undefined);
    try { await f(); } catch (e) { setProblem(problemOf(e)); }
    running.current = false;
    setBusy(false);
  }

  function close() {
    if (room) closeRoom(room.id).catch(() => {});
    onClose();
  }

  const codeOk = new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
  return (
    <div className="veil" onClick={close}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head"><span>{t("online.title")}</span><button type="button" className="btn" onClick={close}>×</button></div>
        {!userId ? (
          <>
            <span className="mute">{t("online.signIn")}</span>
            {auth.available && <button className="btn primary" onClick={() => auth.signIn()}>{t("account.signIn")}</button>}
          </>
        ) : room ? (
          <>
            <span className="room-code">{room.code}</span>
            <span className="mute">{t("online.waitingJoin")}</span>
            <button className="btn" onClick={() => { closeRoom(room.id).catch(() => {}); setRoom(undefined); }}>{t("btn.cancel")}</button>
          </>
        ) : (
          <>
            {active && <button className="btn primary" disabled={busy} onClick={() => onReady(active)}>{t("online.resume", { name: active.match.opponent })}</button>}
            <label>{t("online.deck")}
              <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                {library.decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            {deckError && <span className="bad">{t(deckError)}</span>}
            {/* One button: Create room with no code typed, Join room once a code is being typed (enabled at 6 digits) */}
            <form className="dialog-form" onSubmit={(e) => {
              e.preventDefault();
              if (!picked || deckError || busy) return;
              if (!code) run(async () => setRoom(await createRoom(userId, picked, library.cards)));
              else if (codeOk) run(async () => onReady({ match: await joinRoom(userId, code, picked, library.cards), actions: [] }));
            }}>
              <label>{t("online.codeLabel")}
                <input inputMode="numeric" autoComplete="off" maxLength={CODE_LENGTH} placeholder={t("online.codeHint")} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))} />
              </label>
              <button className="btn primary" type="submit" disabled={busy || !picked || !!deckError || (!!code && !codeOk)}>{t(code ? "online.joinRoom" : "online.create")}</button>
            </form>
          </>
        )}
        {problem && <span className="bad">{t(problem)}</span>}
      </div>
    </div>
  );
}
