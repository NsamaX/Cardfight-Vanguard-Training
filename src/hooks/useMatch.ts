"use client";
// One online game as this client sees it: the match row (status, Ready/Start, decks) and its actions in seq order.
// Our own actions go in at once and are sent; the opponent's arrive through Realtime, with a poll as a fallback in case a push is missed.
import { useEffect, useRef, useState } from "react";
import { setCards } from "../data/cards";
import type { Card } from "../engine/types";
import type { MsgKey } from "../i18n/msg";
import { fetchActionRows, fetchMatch, sendAction, watchMatch, type OnlineMatch } from "../lib/online";
import type { RecordedAction } from "../replay/types";

const POLL_MS = 3000;
const GAP_POLLS = 3;      // polls a missing seq may stay missing before the match counts as broken
const SEND_TRIES = 4;
const RETRY_MS = 1000;   // wait before the next try, times the try number

// The card registry during a match: the match's cards, plus our library for the deck screen (the match's version wins on a shared key)
export function installMatchCards(library: Card[], m: OnlineMatch) {
  const inMatch = new Set(m.cards.map((c) => c.key));
  setCards([...m.cards, ...library.filter((c) => !inMatch.has(c.key))]);
}

// Compares two actions as JSON whatever the key order (the database's jsonb doesn't keep it)
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

export function useMatch(start: { match: OnlineMatch; actions: RecordedAction[] }, userId: string, library: Card[]) {
  const [match, setMatch] = useState(start.match);
  const [actions, setActions] = useState<RecordedAction[]>(start.actions);
  const [problem, setProblem] = useState<MsgKey>();
  const id = start.match.id, host = start.match.host, seat = start.match.seat;
  const list = useRef(start.actions);
  const early = useRef(new Map<number, RecordedAction>());   // arrived ahead of a missing seq
  const gapPolls = useRef(0);                                // polls in a row that found a missing seq still missing
  const outbox = useRef(Promise.resolve());                  // sends one at a time, so seqs reach the server in order
  const broken = useRef(false);                              // a send failed for good: later actions would leave a gap, so none go out
  const tellOther = useRef(() => {});
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
    if (next !== list.current) {
      list.current = next;
      setActions(next);
      gapPolls.current = 0;
      setProblem((p) => (p === "online.otherOutOfSync" ? undefined : p));   // the other player reloaded and plays on
    }
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

  // Each stored action goes in under its own seq, so one that also came through Realtime meanwhile is not added twice.
  // A later seq stored while an earlier one stays missing for a few polls means a client skipped one: the match can't go on
  function catchUp() {
    fetchActionRows(id, host, list.current.length).then((rs) => {
      rs.forEach((r) => add(r.seq, r.rec));
      for (const seq of early.current.keys()) if (seq < list.current.length) early.current.delete(seq);
      if (!early.current.size) { gapPolls.current = 0; return; }
      if (++gapPolls.current === GAP_POLLS) {
        console.error("[online] a seq is missing", { have: list.current.length, ahead: [...early.current.keys()] });
        setProblem("online.desync");
        tellOther.current();
      }
    }, () => {});
    refresh();
  }

  useEffect(() => {
    const w = watchMatch(id, host, { action: add, changed: refresh, connected: catchUp, outOfSync: () => setProblem((p) => p ?? "online.otherOutOfSync") });
    tellOther.current = w.outOfSync;
    const t = setInterval(catchUp, POLL_MS);
    return () => { w.stop(); clearInterval(t); };
  }, [id]);

  // Stores one action, retrying a failed insert. The insert may have reached the server with only the answer lost:
  // our own identical action already at that seq counts as stored; someone else's there means the boards differ
  async function store(seq: number, action: RecordedAction["action"]) {
    for (let attempt = 1; ; attempt++) {
      try { await sendAction(id, seq, action); return; } catch (e) {
        const at = (await fetchActionRows(id, host, seq).catch(() => [])).find((r) => r.seq === seq);
        if (at && at.rec.player === seat && sameJson(at.rec.action, action)) return;
        if (at || attempt === SEND_TRIES) throw e;
        await new Promise((ok) => setTimeout(ok, RETRY_MS * attempt));
      }
    }
  }

  // Our own actions: the engine already accepted them locally; seq = their place in the list
  function send(done: RecordedAction[]) {
    const from = list.current.length;
    list.current = list.current.concat(done);
    setActions(list.current);
    outbox.current = outbox.current.then(async () => {
      if (broken.current) return;
      try {
        for (let i = 0; i < done.length; i++) await store(from + i, done[i].action);
      } catch (e) {
        broken.current = true;
        console.error("[online] send failed", { from, done, e });
        setProblem("online.sendFailed");
        tellOther.current();
      }
    });
  }

  // The board refused an action of the other player's: this board can't go on, and the other one should know why it waits
  function outOfSync() { tellOther.current(); }

  return { match, actions, send, refresh, problem, setProblem, outOfSync };
}
