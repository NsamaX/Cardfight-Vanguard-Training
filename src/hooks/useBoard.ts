// Board screen state and click handling; turns clicks into engine Actions
import { useEffect, useRef, useState } from "react";
import type { Bot } from "../bot/types";
import { cardByKey as db } from "../data/cards";
import { ANSWERS, apply, gGuardianBlocked, usableActs } from "../engine/game";
import { abilityTag, locate, playerMsg } from "../engine/state";
import { msg, type Msg } from "../i18n/msg";
import { abilitySummary } from "../lib/skillBlocks";
import { fmt } from "../lib/format";
import { BEHIND, FRONT, RuleError, SAME_COLUMN, isSentinel, other, powerOf, shieldOf } from "../engine/rules";
import { guardianDiscardFilter, strideCostGrade, strideCostOk } from "../engine/cont";
import { cardMatches } from "../engine/vocab/filters";
import type { Action, CardInstance, Circle, GameState, PlayerId, QueueEntry } from "../engine/types";
import type { RecordedAction } from "../replay/types";
import { DEAL_GAP_MS, MOVE_MS } from "./useCardFlight";
import { abilitiesStarted, abilityResolving, canBoost, canIntercept, columnOf, findCard, isTarget, returningToDeck, revealSteps, revealedBy, sourcePiles, type Light, type LogEntry, type Mode, type Sel, type ShownAbility, type Zone } from "../lib/board";

const BOT_DELAY_MS = 450;   // pause between bot actions so you can follow along
const REVEAL_MS = 800;      // how long revealed cards stay on show before going on
const ABILITY_MS = 1600;    // how long an ability the other side started stays on show (at least: one still resolving stays until it's done)
const TICK_MS = 100;
const SHUFFLE_MS = 900;     // the deck's shuffle animation

// A button in the middle bar; title = what it does, shown on hover
export interface QuestionButton { label: Msg | string; title?: string; onClick: () => void }

// The board at one step, with the history and all actions up to that step (used for undo and saving replays)
interface Snapshot { s: GameState; log: LogEntry[]; actions: RecordedAction[] }

// An online match as seen by this client: seat = our side; actions = every action of the match so far in order (initial already includes
// the ones present when the board was created); send = hand our own new actions to the match;
// outOfSync = this board refused one of the other player's actions (tell them)
export interface OnlineSeat { seat: PlayerId; actions: RecordedAction[]; send: (done: RecordedAction[]) => void; outOfSync?: () => void }

// Every online action played, in the console: set localStorage "debug-online" to "1" and reload
const traceOnline = (() => { try { return globalThis.localStorage?.getItem("debug-online") === "1"; } catch { return false; } })();

// bot: the bot playing the "bot" side (none = control both sides yourself)
// view: replay viewer (shows the board with the given history; clicks don't affect the game)
// online: the other side is a player on another client; there is no undo, since actions already sent can't be taken back
export function useBoard(initial: GameState, bot?: Bot, view?: { log: LogEntry[] }, online?: OnlineSeat) {
  const readOnly = !!view;
  const [s, setS] = useState(initial);
  const [log, setLog] = useState<LogEntry[]>(view?.log ?? []);
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [inspect, setInspectUids] = useState<Partial<Record<PlayerId, string>>>({});   // last inspected card, per owner
  const [hover, setHover] = useState<string>();         // hand card under the mouse (shown in the inspector temporarily)
  const [pile, setPile] = useState<{ player: PlayerId; zone: Zone; circle?: Circle } | null>(null);
  const [choicePicks, setChoicePicks] = useState<string[]>([]);
  const [error, setError] = useState<Msg>();
  const [focus, setFocus] = useState<string>();         // card clicked to use its ACT
  const [queuePick, setQueuePick] = useState<string>();  // a card with several pending abilities was clicked: ask which one
  const [opened, setOpened] = useState(false);          // a pending ability was just opened by clicking: Cancel on its first question goes back
  const [trigArmed, setTrigArmed] = useState(false);    // the trigger card was clicked; the cursor shows what it will give
  const [staged, setStaged] = useState(false);          // showing cards returning to the deck before the redraw, or revealed cards: undo/redo disabled
  const [reveal, setReveal] = useState<{ player: PlayerId; cards: CardInstance[]; drive: CardInstance[] }>();   // cards shown in the middle of the board / drive check cards on the battle bar
  const [choiceMin, setChoiceMin] = useState(false);    // card choice dialog minimized to look at the board

  const [desync, setDesync] = useState(false);
  const [shownAbility, setShownAbility] = useState<ShownAbility>();   // the other side's ability on show in the middle (one at a time)
  const abilityQueue = useRef<ShownAbility[]>([]);
  const revealing = useRef(false);   // revealed cards are covering the middle of the board
  const [shuffling, setShuffling] = useState<Partial<Record<PlayerId, boolean>>>({});   // decks being shuffled (animation)
  const applied = useRef(online?.actions.length ?? 0);   // online: how many of the match's actions this board has played

  const actor = s.awaiting?.player;
  const remote: PlayerId | undefined = bot ? "bot" : online && other(online.seat);   // the side someone else plays
  const botTurn = !!remote && actor === remote && !s.winner;
  const choice = s.awaiting?.choice;
  const ordering = s.awaiting?.kind === "order-queue";
  const trig = choice || ordering ? undefined : s.battle?.pendingTrigger;
  const healing = mode?.kind === "trigger" && !!mode.powerTo && trig?.kind === "heal";   // the heal trigger's Power is placed: pick the damage card
  const guarding = s.step === "guard" && !!s.battle && actor !== s.turnPlayer;   // only the defender guards (the attacker may answer its own abilities during this step)
  // A card choice where every option is a unit on the board: choose on the board instead of in a dialog
  const fieldChoice = choice?.kind === "cards" && choice.options.every((u) => locate(s, u)?.zone === "circle") ? choice : undefined;
  const striding = s.phase === "ride" && s.step === "stride" && s.awaiting?.kind === "next-phase" && !s.strodeThisTurn;
  // Abilities waiting for the player: yellow-bordered cards (sources), clicking turns them orange (active) and asks whether to use it
  // While an ability resolves and waits for an answer, the source card has an orange border
  const queued = ordering ? s.queue.filter((e) => e.owner === actor) : [];   // indexes match the order-queue action
  const offered = queued.filter((e) => !e.blocked);   // the ones that can be used now (the others wait their turn)
  // Every pending ability is optional: the player may do something else (call, move, use ACT), treated as declining
  const skippable = queued.length > 0 && queued.every((e) => e.optional);
  const acts = usableActs(db, s);                                                       // ACT usable in the main phase
  const focusedAct = acts.find((a) => a.uid === focus);
  const active = focusedAct ? [focus!] : choice && s.resolving ? [s.resolving.uid] : [];
  const sources = [...offered, ...acts].map((e) => e.uid).filter((u) => !active.includes(u));
  const waitingPiles = sourcePiles(s, sources), activePiles = sourcePiles(s, active);
  // Piles a card choice picks from (deck, drop...): yellow for both players, so the opponent sees where a card is being chosen even without the dialog
  const choicePiles = sourcePiles(s, choice?.kind === "cards" ? choice.options : []);

  // Replay viewer: stepping shows that step's board (no new board is created, so cards move continuously)
  useEffect(() => {
    if (!view) return;
    setS(initial);
    setLog(view.log);
  }, [initial]);
  useEffect(() => { if (!error) return; const t = setTimeout(() => setError(undefined), 2600); return () => clearTimeout(t); }, [error]);
  // The mulligan selection mode exists only while waiting for the mulligan (one side at a time)
  useEffect(() => {
    const mulliganing = s.awaiting?.kind === "mulligan";
    if (mulliganing && !mode) setMode({ kind: "mulligan", picks: [] });
    if (!mulliganing && mode?.kind === "mulligan") setMode(null);
    if (trig && mode?.kind !== "trigger") setMode({ kind: "trigger" });
  }, [s, mode, trig]);

  // Click a card anywhere: show details; if it has a pending ability, open that ability's first question (Cancel = close, the ability keeps waiting)
  // ACT in the main phase still asks before use, since clicking a board card may be just to look at it
  function setInspect(uid: string) {
    const f = findCard(s, uid);
    if (f) setInspectUids((i) => ({ ...i, [f.player]: uid }));
    const i = queued.findIndex((e) => e.uid === uid && !e.blocked);
    if (i >= 0 && !botTurn && !readOnly) {
      if (offered.filter((e) => e.uid === uid).length > 1) { setQueuePick(uid); return; }
      openQueued(i);
      return;
    }
    setFocus(acts.some((e) => e.uid === uid) ? uid : undefined);
  }

  function openQueued(i: number) {
    act({ type: "order-queue", index: i, ask: true });
    setOpened(!online);
  }

  function inspectedOf(p: PlayerId) {
    const hovered = hover ? findCard(s, hover) : undefined;
    const uid = inspect[p];
    const f = hovered?.player === p ? hovered : uid ? findCard(s, uid) : undefined;
    if (!f) return undefined;
    return { ...f, power: f.circle ? powerOf(db, s.players[f.player], f.circle) : undefined };
  }

  // then: a follow-up action computed from the new state (continues only if legal)
  // The bot's turn: only accept actions from the bot (fromBot); player clicks have no effect
  function act(action: Action, then?: (st: GameState) => Action | undefined, fromBot = false) {
    if (!actor || readOnly || botTurn !== fromBot) return;
    try {
      const done: RecordedAction[] = [];
      const events = [];
      let base = s;
      if (skippable && !ANSWERS.includes(action.type)) {
        const r0 = apply(db, s, actor, { type: "pass-queue" });
        base = r0.state;
        events.push(...r0.events);
        done.push({ player: actor, action: { type: "pass-queue" } });
      }
      const r = apply(db, base, actor, action);
      let st = r.state;
      events.push(...r.events);
      const entries = events.map((e) => ({ ...e, turn: st.turn }));
      done.push({ player: actor, action });
      const follow = then?.(st);
      if (follow && st.awaiting && (!online || st.awaiting.player === online.seat)) {
        try {
          const p2 = st.awaiting.player;
          const r2 = apply(db, st, p2, follow);
          st = r2.state;
          entries.push(...r2.events.map((e) => ({ ...e, turn: st.turn })));
          done.push({ player: p2, action: follow });
        } catch (e) { if (!(e instanceof RuleError)) throw e; }
      }
      if (online) {
        if (traceOnline) console.info("[online] local", applied.current, JSON.stringify(done.map((r) => r.action)));
        online.send(done);
        applied.current += done.length;
      }
      commit(st, entries, done);
    } catch (e) {
      if (e instanceof RuleError) setError(e.msg); else throw e;
    }
  }

  // Show the new board after actions were played: the mulligan's cards go back to the deck first, revealed cards stay on show for a moment
  // The other side's abilities, one after another, each for at least ABILITY_MS of time on screen (doesn't hold up the game).
  // Revealed cards cover the middle of the board, so the clock waits while they are shown
  function showAbilities(list: ShownAbility[]) {
    const idle = !abilityQueue.current.length;
    abilityQueue.current.push(...list);
    if (!idle || !list.length) return;
    const step = () => {
      const a = abilityQueue.current[0];
      setShownAbility(a);
      if (!a) return;
      const tick = (left: number) => setTimeout(() => {
        const more = revealing.current ? left : left - TICK_MS;
        if (more > 0) tick(more); else { abilityQueue.current.shift(); step(); }
      }, TICK_MS);
      tick(ABILITY_MS);
    };
    step();
  }

  function commit(st: GameState, entries: LogEntry[], done: RecordedAction[]) {
    const shown = revealedBy(entries, st);
    if (remote && !readOnly) showAbilities(abilitiesStarted(db, entries, st, remote));
    const shuffled = [...new Set(entries.filter((e) => e.text.key === "log.shuffle" || e.text.key === "log.returnToDeck").map((e) => e.player))];
    if (shuffled.length && !readOnly) {
      setShuffling(Object.fromEntries(shuffled.map((p) => [p, true])));
      setTimeout(() => setShuffling({}), SHUFFLE_MS);
    }
    bot?.observe?.(entries);
    setPast((h) => h.concat({ s, log, actions }));
    setFuture([]);
    setLog(log.concat(entries));
    setActions(actions.concat(done));
    const mull = done.find((r) => r.action.type === "mulligan" && r.action.returnUids.length);
    if (mull?.action.type === "mulligan") {
      const n = mull.action.returnUids.length;
      setS(returningToDeck(s, mull.player, mull.action.returnUids));
      setStaged(true);
      setTimeout(() => { setS(st); setStaged(false); }, MOVE_MS + (n - 1) * DEAL_GAP_MS);   // redraw once the last card reaches the deck
    } else if (shown) {
      const steps = revealSteps(s, shown);
      setStaged(true);
      const play = (i: number) => {
        if (i === steps.length) { setS(st); setReveal(undefined); revealing.current = false; setStaged(false); return; }
        setS(steps[i].s);
        setReveal({ player: shown.player, cards: steps[i].cards, drive: steps[i].drive });
        revealing.current = steps[i].cards.length > 0;
        setTimeout(() => play(i + 1), MOVE_MS + REVEAL_MS);
      };
      play(0);
    } else setS(st);
    clearUi();
  }

  // Online: play the opponent's new actions (after any cards on show have finished, so each step starts from the settled board)
  useEffect(() => {
    if (!online || staged || desync || !s.awaiting) return;   // no awaiting = not dealt yet (or the game is over)
    const fresh = online.actions.slice(applied.current);
    if (!fresh.length) return;
    if (traceOnline) console.info("[online] remote", applied.current, JSON.stringify(fresh.map((r) => r.action)));
    applied.current += fresh.length;
    let st = s;
    const entries: LogEntry[] = [];
    try {
      for (const r of fresh) {
        const res = apply(db, st, r.player, r.action);
        st = res.state;
        entries.push(...res.events.map((e) => ({ ...e, turn: st.turn })));
      }
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      const zones = (p: "me" | "bot") => ({ hand: st.players[p].hand.map((h) => h.uid).join(" "), deckTop: st.players[p].deck.slice(0, 5).map((h) => h.uid).join(" "), drop: st.players[p].drop.map((h) => h.uid).join(" "), damage: st.players[p].damage.map((h) => h.uid).join(" "), soul: st.players[p].soul.map((h) => h.uid).join(" ") });
      console.error("[online] desync: a remote action was refused " + JSON.stringify({ applied: applied.current - fresh.length, fresh, error: e.msg.key, phase: st.phase, step: st.step, turn: st.turn, me: zones("me"), bot: zones("bot") }));
      setDesync(true);
      online.outOfSync?.();
      return;
    }
    commit(st, entries, fresh);
  }, [online?.actions, staged, desync]);

  // The bot's turn: let the bot think and send an action (cancelled if the state changes before it finishes, e.g. undo)
  useEffect(() => {
    if (!bot || !botTurn) return;
    let alive = true;
    const decision = s.awaiting!;
    const t = setTimeout(() => {
      bot.decide(s, decision).then((a) => { if (alive) act(a, undefined, true); }, (e) => console.error(e));
    }, BOT_DELAY_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [s, bot, botTurn]);

  // Undo/redo one action at a time (state and log go back together)
  // Playing the bot: skip the points where the bot decides, stopping on the player's turn
  function travel(back: boolean) {
    let from = back ? past : future;
    let to = back ? future : past;
    let cur: Snapshot = { s, log, actions };
    do {
      const nx = from.at(-1);
      if (!nx) break;
      from = from.slice(0, -1);
      to = to.concat(cur);
      cur = nx;
    } while (bot && cur.s.awaiting?.player === "bot" && !cur.s.winner);
    if (cur.s === s) return;
    (back ? setPast : setFuture)(from);
    (back ? setFuture : setPast)(to);
    setS(cur.s);
    setLog(cur.log);
    setActions(cur.actions);
    clearUi();
  }

  // A heal trigger that will heal, with damage cards that differ (face up/down or card): the player picks which one, after the Power target
  function healPick(p: PlayerId) {
    const ps = s.players[p];
    return trig?.kind === "heal" && ps.damage.length > 0 && ps.damage.length >= s.players[other(p)].damage.length
      && new Set(ps.damage.map((d) => `${d.key}:${d.faceUp}`)).size > 1;
  }

  function clearUi() {
    setFocus(undefined);
    setQueuePick(undefined);
    setOpened(false);
    setSel(null);
    setMode(null);
    setChoicePicks([]);
    setTrigArmed(false);
    setChoiceMin(false);
    setHover(undefined);
  }

  function clickHand(p: PlayerId, inst: CardInstance) {
    if (p === remote) return;   // the opponent's hand is face down, can't be viewed
    setInspect(inst.uid);
    if (botTurn) return;
    if (actor && p !== actor) { setError(msg("err.turnOf", { player: playerMsg(actor) })); return; }
    if (choice || (ordering && !skippable) || offered.some((e) => e.uid === inst.uid)) return;
    if (guarding && mode?.kind !== "gguard") {
      const picks = mode?.kind === "guard" ? mode.picks : [];
      const next = picks.includes(inst.uid) ? picks.filter((u) => u !== inst.uid) : picks.concat(inst.uid);
      setMode(next.length ? { kind: "guard", picks: next } : null);
      return;
    }
    if (mode?.kind === "mulligan" || mode?.kind === "stride") {
      const picks = mode.picks.includes(inst.uid) ? mode.picks.filter((u) => u !== inst.uid) : mode.picks.concat(inst.uid);
      setMode({ ...mode, picks });
      return;
    }
    if (mode?.kind === "gguard") {
      if (db[inst.key].trigger !== "heal") { setError(msg("ui.pickHealDiscard")); return; }
      setMode({ ...mode, discardUid: mode.discardUid === inst.uid ? undefined : inst.uid });
      return;
    }
    setSel(sel?.kind === "hand" && sel.uid === inst.uid ? null : { kind: "hand", player: p, uid: inst.uid });
  }

  function clickCircle(p: PlayerId, c: Circle) {
    const unit = s.players[p].circles[c];
    if (unit) setInspect(unit.uid);
    if (botTurn) return;
    if (choice?.kind === "circle") {
      if (p === choice.side && choice.options.includes(c)) act({ type: "select-target", uids: [], to: c });
      return;
    }
    if (fieldChoice) { if (unit && fieldChoice.options.includes(unit.uid)) toggleChoicePick(unit.uid); return; }
    if (choice || (ordering && !skippable) || (unit && offered.some((e) => e.uid === unit.uid))) return;
    const mine = p === actor;
    // Trigger: click the trigger card first, then choose the unit to receive the effect
    if (mine && mode?.kind === "trigger" && trig) {
      if (!unit || !trigArmed) return;
      if (trig.kind === "critical" || trig.kind === "stand") {
        if (!mode.powerTo) {
          const canStand = Object.entries(s.players[p].circles).some(([rc, u]) => rc !== "vc" && u?.rested);
          if (trig.kind === "stand" && !canStand) { act({ type: "trigger-target", powerTo: c }); return; }
          setMode({ kind: "trigger", powerTo: c });
          return;
        }
        act({ type: "trigger-target", powerTo: mode.powerTo, extraTo: c });
      } else if (healPick(p)) { setMode({ kind: "trigger", powerTo: c }); setPile({ player: p, zone: "damage" }); }   // then pick the damage card to heal
      else act({ type: "trigger-target", powerTo: c });
      return;
    }
    if (mine && guarding && unit && canIntercept(c)) { act({ type: "guard", uids: [], intercept: [c] }); return; }
    if (mine && sel?.kind === "hand") {
      if (s.phase === "ride" && s.step === "ride" && c === "vc") { act({ type: "ride", uid: sel.uid }); return; }
      if (s.phase === "main" && c !== "vc") { act({ type: "call", uid: sel.uid, to: c }); return; }
    }
    if (mine && s.phase === "main" && sel?.kind === "circle" && SAME_COLUMN[sel.circle] === c) {
      act({ type: "move", from: sel.circle, to: c });
      return;
    }
    if (s.phase === "battle" && s.step === "attack" && !mine && FRONT.includes(c) && unit && sel?.kind === "attack") {
      if (!sel.front) { setError(msg("ui.pickAttackerFirst")); return; }
      act({ type: "attack", attacker: sel.col, target: c, booster: sel.back ? BEHIND[sel.col] : undefined });
      return;
    }
    // Choose attacker/booster: in the same column, click to add/remove either card; clicking another column starts over
    if (mine && unit && s.phase === "battle" && s.step === "attack") {
      const col = columnOf(c), isFront = c === col;
      if (isFront && unit.rested) { setError(msg("err.restedAttack")); return; }
      if (!isFront && !canBoost(db, unit)) { setError(msg("err.boostGrade")); return; }
      const cur = sel?.kind === "attack" && sel.col === col ? sel : { kind: "attack" as const, player: p, col, front: false, back: false };
      const next = isFront ? { ...cur, front: !cur.front } : { ...cur, back: !cur.back };
      setSel(next.front || next.back ? next : null);
      return;
    }
    if (mine && unit) setSel(sel?.kind === "circle" && sel.circle === c ? null : { kind: "circle", player: p, circle: c });
  }

  function clickPileCard(p: PlayerId, zone: Zone, inst: CardInstance) {
    setInspect(inst.uid);
    if (healing && mode?.kind === "trigger" && mode.powerTo && zone === "damage" && p === actor) { act({ type: "trigger-target", powerTo: mode.powerTo, healUid: inst.uid }); setPile(null); return; }
    if (offered.some((e) => e.uid === inst.uid)) { setPile(null); return; }
    if (zone !== "gZone" || p !== actor || inst.faceUp) return;
    const type = db[inst.key].type;
    if (s.phase === "ride" && s.step === "stride" && type === "g-unit") { setMode({ kind: "stride", gUid: inst.uid, picks: mode?.kind === "stride" ? mode.picks : [] }); setPile(null); }
    // A G zone card's ACT (e.g. Sebreeze): focus it to ask whether to use it
    if (acts.some((e) => e.uid === inst.uid)) { setFocus(inst.uid); setPile(null); }
    if (guarding && type === "g-guardian") {
      const why = gGuardianBlocked(db, s, p);
      if (why) { setError(why); return; }
      const heals = s.players[p].hand.filter((c) => cardMatches(db[c.key], guardianDiscardFilter(db[inst.key]), { db }));
      setMode({ kind: "gguard", gUid: inst.uid, discardUid: heals.length === 1 ? heals[0].uid : undefined });   // only one Heal, choose it automatically
      setSel(null);
      setPile(null);
    }
  }

  function toggleChoicePick(uid: string) {
    if (choice?.kind !== "cards") return;
    setChoicePicks((ps) => ps.includes(uid) ? ps.filter((x) => x !== uid) : ps.length >= choice.max ? [...ps.slice(1), uid] : [...ps, uid]);
    setInspect(uid);
  }

  // Clicking your own card on GC while waiting to guard: return that card to where it came from (hand, or the RC it intercepted from)
  // Done by going back to before that card was placed, then replaying the following actions without it (abilities caused by that card disappear too)
  function unguard(uid: string): boolean {
    if (online || readOnly || botTurn || s.awaiting?.kind !== "guard" || !actor) return false;
    if (!s.players[actor].guardian.some((g) => g.uid === uid)) return false;
    let i = past.length - 1;
    while (i >= 0 && past[i].s.players[actor].guardian.some((g) => g.uid === uid)) i--;
    if (i < 0) return false;
    const base = past[i];
    const circle = (Object.entries(base.s.players[actor].circles) as [Circle, CardInstance | undefined][]).find(([, u]) => u?.uid === uid)?.[0];
    const redo: RecordedAction[] = [];
    for (const r of actions.slice(base.actions.length)) {
      const a = r.action;
      if (a.type !== "guard" || r.player !== actor) { redo.push(r); continue; }
      const next = { ...a, uids: a.uids.filter((u) => u !== uid), intercept: a.intercept?.filter((c) => c !== circle) };
      if (next.uids.length || next.intercept?.length) redo.push({ ...r, action: next });
    }
    let cur: Snapshot = base;
    const snaps: Snapshot[] = [];
    try {
      for (const r of redo) {
        snaps.push(cur);
        const res = apply(db, cur.s, r.player, r.action);
        cur = { s: res.state, log: cur.log.concat(res.events.map((e) => ({ ...e, turn: res.state.turn }))), actions: cur.actions.concat(r) };
      }
    } catch (e) {
      if (e instanceof RuleError) { setError(msg("err.unguard")); return true; }
      throw e;
    }
    setPast(past.slice(0, i).concat(snaps));
    setFuture([]);
    setS(cur.s);
    setLog(cur.log);
    setActions(cur.actions);
    clearUi();
    return true;
  }

  // Close an ability just opened: go back to before the card was clicked (not counted as a redo-able step)
  function cancelOpened() {
    const prev = past.at(-1);
    if (!prev) return;
    setPast(past.slice(0, -1));
    setS(prev.s);
    setLog(prev.log);
    setActions(prev.actions);
    clearUi();
  }

  // First question of an ability just opened by clicking: the decline/skip button becomes Cancel
  function question(): { prompt?: Msg; buttons: QuestionButton[] } | undefined {
    const q = baseQuestion();
    if (!opened || !s.resolving || !choice) return q;
    const cancel = { label: msg("btn.cancel"), onClick: cancelOpened };
    const keep = (q?.buttons ?? []).filter((b) => typeof b.label === "string" || (b.label.key !== "btn.no" && b.label.key !== "btn.none"));
    return { prompt: q?.prompt ?? s.awaiting?.prompt, buttons: [...keep, cancel] };
  }

  // Question in the middle bar: an ability chosen by clicking (yes/no), or a question while an ability resolves (yes/no, choose effect, choose circle)
  function baseQuestion(): { prompt?: Msg; buttons: QuestionButton[] } | undefined {
    const useQ = (label: string, cost: string[]) => cost.length ? msg("q.useCost", { label: abilityTag(label), cost: cost.join(", ") }) : msg("q.use", { label: abilityTag(label) });
    const yes = msg("btn.yes"), no = msg("btn.no");
    if (botTurn || readOnly) return undefined;
    if (queuePick && ordering) {
      const here = queued.map((e, i) => ({ e, i })).filter(({ e }) => e.uid === queuePick && !e.blocked);
      // The same ability triggered by several events (e.g. each unit placed from the drop): name the card each one is about
      const about = (e: QueueEntry) => {
        const u = e.event && "uid" in e.event ? e.event.uid : undefined;
        const f = u && u !== e.uid ? findCard(s, u) : undefined;
        return here.filter((h) => h.e.key === e.key).length > 1 && f ? ` · ${db[f.inst.key].name}` : "";
      };
      const card = findCard(s, queuePick)?.inst;
      return { prompt: msg("q.whichAbility"), buttons: [
        ...here.map(({ e, i }) => ({ label: abilityTag(e.label) + about(e), title: card && abilitySummary(db[card.key].text, db[card.key].abilities, /^\d+$/.test(e.key) ? db[card.key].abilities[Number(e.key)] : e.ability), onClick: () => openQueued(i) })),
        { label: msg("btn.cancel"), onClick: () => setQueuePick(undefined) },
      ] };
    }
    if (focusedAct) {
      return { prompt: useQ(focusedAct.label, focusedAct.cost), buttons: [
        { label: yes, onClick: () => act({ type: "activate", cardUid: focusedAct.uid, abilityIndex: focusedAct.index }) },
        { label: no, onClick: () => setFocus(undefined) },
      ] };
    }
    // Stride step: stride = click the G zone, pick a G unit, then pick hand cards to discard (total grade 3+)
    if (striding && mode?.kind === "stride") {
      const gs = mode.picks.reduce((n, u) => n + strideCostGrade(db, s, actor!, findCard(s, u)!.inst), 0);
      const g = mode.gUid && db[findCard(s, mode.gUid)!.inst.key].name;
      const gUid = mode.gUid, discardUids = mode.picks;
      const buttons = [{ label: msg("btn.cancel"), onClick: () => setMode(null) }];
      const picked = mode.picks.map((u) => findCard(s, u)!.inst);
      if (gUid && strideCostOk(db, s, actor!, db[findCard(s, gUid)!.inst.key], picked)) buttons.unshift({ label: msg("btn.stride"), onClick: () => act({ type: "stride", gUid, discardUids }) });
      return { prompt: msg("q.stride", { g: g ?? msg("q.pickGUnit"), n: gs }), buttons };
    }
    // Guard: pick hand cards or a G guardian, then confirm
    if (guarding && mode?.kind === "gguard") {
      const g = findCard(s, mode.gUid)!.inst;
      const gCard = { card: db[g.key].name, shield: shieldOf(db, { ...g, mods: [] }) };
      const cancel = { label: no, onClick: () => setMode(null) };
      if (!mode.discardUid) return { prompt: msg("q.gGuardPickHeal", gCard), buttons: [cancel] };
      return { prompt: msg("q.gGuardConfirm", { ...gCard, discard: db[findCard(s, mode.discardUid)!.inst.key].name }), buttons: [
        { label: yes, onClick: () => act({ type: "call-g-guardian", gUid: mode.gUid, discardUid: mode.discardUid! }) }, cancel,
      ] };
    }
    if (guarding && mode?.kind === "guard") {
      const uids = mode.picks;
      return { buttons: [
        { label: yes, onClick: () => act({ type: "guard", uids }) },
        { label: no, onClick: () => setMode(null) },
      ] };
    }
    if (fieldChoice) {
      const ok = choicePicks.length >= fieldChoice.min && choicePicks.length <= fieldChoice.max;
      return { buttons: ok ? [{ label: yes, onClick: () => act({ type: "select-target", uids: choicePicks }) }] : [] };
    }
    if (choice?.kind === "cards" && choiceMin) return { buttons: [{ label: msg("btn.pickCards"), onClick: () => setChoiceMin(false) }] };
    const prompt = s.awaiting?.prompt;
    if (choice?.kind === "circle") return { prompt, buttons: [{ label: msg("btn.none"), onClick: () => act({ type: "select-target", uids: [] }) }] };
    if (choice?.kind === "yesno") return { prompt, buttons: [{ label: yes, onClick: () => act({ type: "choose", option: "yes" }) }, { label: no, onClick: () => act({ type: "choose", option: "no" }) }] };
    if (choice?.kind === "option") return { prompt, buttons: choice.options.map((o) => ({ label: o, onClick: () => act({ type: "choose", option: o }) })) };
  }

  // Phase button: pending abilities are treated as declined (forced ones resolve automatically in order), then continue if still on the same step
  function next() {
    if (s.awaiting?.kind === "guard") { act({ type: "end-guard" }); return; }
    if (!ordering) { act({ type: "next-phase" }); return; }
    const at = `${s.turn}:${s.phase}:${s.step}`;
    act({ type: "pass-queue" }, (st) => `${st.turn}:${st.phase}:${st.step}` !== at ? undefined
      : st.awaiting?.kind === "next-phase" ? { type: "next-phase" } : st.awaiting?.kind === "guard" ? { type: "end-guard" } : undefined);
  }

  return {
    s, log, error, actor,
    lightOf: (uid: string): Light =>
      trig && !botTurn && uid === s.battle?.checkCard?.uid ? (trigArmed ? "active" : "source")
      : healing && s.players[actor!].damage.some((d) => d.uid === uid) ? "source"
      : fieldChoice?.options.includes(uid) ? (choicePicks.includes(uid) ? "active" : "source")
      : (striding || mode?.kind === "stride") && s.players[actor!]?.gZone.some((g) => g.uid === uid && !g.faceUp && db[g.key].type === "g-unit") ? (mode?.kind === "stride" && mode.gUid === uid ? "active" : "source")
      : active.includes(uid) ? "active" : sources.includes(uid) ? "source" : undefined,
    // Trigger: click the revealed check card and the cursor shows what it will give (the trigger's Power first, then Critical/Stand); the unit chosen for Power shows the value in advance
    // Only the trigger's owner arms it; the other player (or the side the bot plays) just inspects the card
    clickCheck: (uid: string) => { setInspect(uid); if (trig && !botTurn && uid === s.battle?.checkCard?.uid) setTrigArmed(true); },
    trigTip: trig && trigArmed
      ? mode?.kind === "trigger" && mode.powerTo ? { text: trig.kind === "critical" ? msg("tip.critical", { v: "+1" }) : trig.kind === "heal" ? msg("tip.heal") : msg("tip.stand"), kind: "cri" } : { text: msg("tip.power", { v: `+${fmt(trig.power)}` }), kind: "pow" }
      : undefined,
    trigBonus: trig && mode?.kind === "trigger" && mode.powerTo ? { player: trig.owner, bonus: { [mode.powerTo]: trig.power } as Partial<Record<Circle, number>> }
      : fieldChoice?.bonus?.stat === "power" ? { player: actor!, bonus: Object.fromEntries(choicePicks.map((u) => [locate(s, u)!.circle!, fieldChoice.bonus!.value])) as Partial<Record<Circle, number>> }
      : undefined,
    // Choosing the unit to receive the effect on the board: the cursor shows what it will get (until all are chosen)
    choiceTip: fieldChoice?.bonus && choicePicks.length < fieldChoice.max
      ? { text: msg(`tip.${fieldChoice.bonus.stat}`, { v: `${fieldChoice.bonus.value > 0 ? "+" : ""}${fmt(fieldChoice.bonus.value)}` }), kind: fieldChoice.bonus.stat === "critical" ? "cri" : "pow" }
      : undefined,
    fieldChoice: !!fieldChoice, choiceMin, setChoiceMin,
    pileLight: (p: PlayerId, zone: string): Light =>
      healing && p === actor && zone === "damage" ? "source"
      : (striding || mode?.kind === "stride") && p === actor && zone === "gZone" ? (mode?.kind === "stride" && mode.gUid ? "active" : "source")
      : activePiles[p].has(zone) ? "active" : waitingPiles[p].has(zone) || choicePiles[p].has(zone) ? "source" : undefined,
    choice, ordering, trig, guarding, mode, choicePicks, pile,
    selUid: sel?.kind === "hand" ? sel.uid : sel?.kind === "circle" ? s.players[sel.player].circles[sel.circle]?.uid : undefined,
    // Units chosen to attack/boost (red border) and the Power the boost will give
    // A declared battle: attacker/booster red border, target yellow border (the defender sees who attacks whom)
    battleMarks: s.battle ? {
      [s.turnPlayer]: { atk: [s.battle.attacker, s.battle.booster].filter((c): c is Circle => !!c), aimed: [] as Circle[] },
      [s.turnPlayer === "me" ? "bot" : "me"]: { atk: [] as Circle[], aimed: [s.battle.target] },
    } as Record<PlayerId, { atk: Circle[]; aimed: Circle[] }> : undefined,
    // Shield from the currently selected cards (shown in advance on the guard number) and whether a sentinel is among them
    guardPreview: guarding ? (() => {
      const uids = mode?.kind === "guard" ? mode.picks : mode?.kind === "gguard" ? [mode.gUid] : [];
      const insts = uids.map((u) => findCard(s, u)!.inst);
      return { shield: insts.reduce((n, i) => n + shieldOf(db, i), 0), sentinel: insts.some((i) => isSentinel(db[i.key])) };
    })() : undefined,
    attackPick: sel?.kind === "attack" ? {
      player: sel.player,
      circles: [sel.front && sel.col, sel.back && BEHIND[sel.col]].filter((c): c is Circle => !!c),
      bonus: sel.front && sel.back ? { [sel.col]: powerOf(db, s.players[sel.player], BEHIND[sel.col]!) } as Partial<Record<Circle, number>> : {},
    } : undefined,
    picks: mode && "picks" in mode ? mode.picks : mode?.kind === "gguard" && mode.discardUid ? [mode.discardUid] : [],
    inspectedOf,
    setHover,
    closeInspect: (p: PlayerId) => setInspectUids((i) => ({ ...i, [p]: undefined })),
    isTarget: (p: PlayerId, c: Circle) => (mode?.kind !== "trigger" || trigArmed) && isTarget({ s, db, actor, choice, sel, mode }, p, c),
    // Mulligan at game start (once per player): choosing no cards = keep the hand
    mulligan: !botTurn && !readOnly && s.awaiting?.kind === "mulligan" && mode?.kind === "mulligan"
      ? { picks: mode.picks.length, confirm: () => act({ type: "mulligan", returnUids: mode.picks }) }
      : undefined,
    undo: past.length && !readOnly && !staged && !online ? () => travel(true) : undefined,
    redo: future.length && !readOnly && !staged && !online ? () => travel(false) : undefined,
    act, unguard, clickHand, clickCircle, clickPileCard, toggleChoicePick, question, next,
    canNext: !botTurn && !readOnly && (s.awaiting?.kind === "next-phase" || s.awaiting?.kind === "guard" || ordering),
    botTurn, hiddenHand: remote, reveal, desync, shuffling,
    shownAbility: shownAbility ?? (remote && !readOnly && !staged ? abilityResolving(db, s, remote) : undefined),
    actions, readOnly,
    setInspect, setPile,
    setState: setS,   // replace the whole board, used when dealing after Start
  };
}

export type BoardModel = ReturnType<typeof useBoard>;
