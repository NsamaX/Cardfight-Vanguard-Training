"use client";
// One online game as this client sees it: the match row (status, Ready/Start, decks) and its actions in seq order.
// Our own actions go in at once and are sent; the opponent's arrive through Realtime, with a poll as a fallback in case a push is missed.
import { useEffect, useRef, useState } from "react";
import { setCards } from "../data/cards";
import type { Card } from "../engine/types";
import type { MsgKey } from "../i18n/msg";
import { fetchActions, fetchMatch, sendAction, watchMatch, type OnlineMatch } from "../lib/online";
import type { RecordedAction } from "../replay/types";

const POLL_MS = 3000;

// The card registry during a match: the match's cards, plus our library for the deck screen (the match's version wins on a shared key)
export function installMatchCards(library: Card[], m: OnlineMatch) {
  const inMatch = new Set(m.cards.map((c) => c.key));
  setCards([...m.cards, ...library.filter((c) => !inMatch.has(c.key))]);
}

export function useMatch(start: { match: OnlineMatch; actions: RecordedAction[] }, userId: string, library: Card[]) {
  const [match, setMatch] = useState(start.match);
  const [actions, setActions] = useState<RecordedAction[]>(start.actions);
  const [problem, setProblem] = useState<MsgKey>();
  const id = start.match.id, host = start.match.host;
  const list = useRef(start.actions);
  const early = useRef(new Map<number, RecordedAction>());   // arrived ahead of a missing seq
  const outbox = useRef(Promise.resolve());                  // sends one at a time, so seqs reach the server in order
  const last = useRef({ row: JSON.stringify(start.match), cards: JSON.stringify(start.match.cards) });

  function add(seq: number, rec: RecordedAction) {
    if (seq < list.current.length) return;   // already have it (e.g. our own action echoed back)
    early.current.set(seq, rec);
    let next = list.current;
    while (early.current.has(next.length)) {
      const r = early.current.get(next.length)!;
      early.current.delete(next.length);
      next = next.concat(r);
    }
    if (next !== list.current) { list.current = next; setActions(next); }
  }

  // Re-read the match row; only a real change re-renders (and a deck change reloads the card registry first)
  function refresh(): Promise<void> {
    return fetchMatch(id, userId, start.match.opponent).then((m) => {
      const row = JSON.stringify(m), cards = JSON.stringify(m.cards);
      if (row === last.current.row) return;
      if (cards !== last.current.cards) installMatchCards(library, m);
      last.current = { row, cards };
      setMatch(m);
    }, () => {});
  }

  function catchUp() {
    fetchActions(id, host, list.current.length).then((rs) => {
      const from = list.current.length;
      rs.forEach((r, i) => add(from + i, r));
    }, () => {});
    refresh();
  }

  useEffect(() => {
    const stop = watchMatch(id, host, { action: add, changed: refresh, connected: catchUp });
    const t = setInterval(catchUp, POLL_MS);
    return () => { stop(); clearInterval(t); };
  }, [id]);

  // Our own actions: the engine already accepted them locally; seq = their place in the list
  function send(done: RecordedAction[]) {
    const from = list.current.length;
    list.current = list.current.concat(done);
    setActions(list.current);
    outbox.current = outbox.current.then(async () => {
      for (let i = 0; i < done.length; i++) await sendAction(id, from + i, done[i].action);
    }).catch(() => setProblem("online.sendFailed"));
  }

  return { match, actions, send, refresh, problem, setProblem };
}
