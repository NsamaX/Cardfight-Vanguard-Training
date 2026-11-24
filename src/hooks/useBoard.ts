// สถานะของหน้าสนามและการตอบสนองต่อการคลิก แปลงการคลิกเป็น Action ของ engine
import { useEffect, useState } from "react";
import type { Bot } from "../bot/types";
import { cardByKey as db } from "../data/cards";
import { apply, gGuardianBlocked, usableActs } from "../engine/game";
import { abilityTag, locate, playerMsg } from "../engine/state";
import { msg, type Msg } from "../i18n/msg";
import { fmt } from "../lib/format";
import { BEHIND, FRONT, RuleError, SAME_COLUMN, isSentinel, powerOf, shieldOf, strideCostGrade } from "../engine/rules";
import type { Action, CardInstance, Circle, GameState, PlayerId } from "../engine/types";
import type { RecordedAction } from "../replay/types";
import { canBoost, canIntercept, columnOf, findCard, isTarget, sourcePiles, type Light, type LogEntry, type Mode, type Sel, type Zone } from "../lib/board";

const BOT_DELAY_MS = 450;   // เว้นจังหวะระหว่างการกระทำของบอท ให้มองตามทัน

// ภาพสนาม ณ ก้าวหนึ่ง พร้อมประวัติและ action ทั้งหมดจนถึงก้าวนั้น (ใช้ย้อนกลับและบันทึก replay)
interface Snapshot { s: GameState; log: LogEntry[]; actions: RecordedAction[] }

// bot: บอทที่เล่นฝั่ง "bot" (ไม่มี = คุมเองทั้งสองฝั่ง)
// view: หน้าดูย้อนหลัง (แสดงสนามพร้อมประวัติที่ให้มา คลิกแล้วไม่มีผลต่อเกม)
export function useBoard(initial: GameState, bot?: Bot, view?: { log: LogEntry[] }) {
  const readOnly = !!view;
  const [s, setS] = useState(initial);
  const [log, setLog] = useState<LogEntry[]>(view?.log ?? []);
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [inspect, setInspectUids] = useState<Partial<Record<PlayerId, string>>>({});   // การ์ดที่กดดูล่าสุด แยกตามเจ้าของ
  const [hover, setHover] = useState<string>();                                         // การ์ดในมือที่ชี้เมาส์อยู่ (แสดงแทนชั่วคราว)
  const [pile, setPile] = useState<{ player: PlayerId; zone: Zone } | null>(null);
  const [choicePicks, setChoicePicks] = useState<string[]>([]);
  const [error, setError] = useState<Msg>();
  const [focus, setFocus] = useState<string>();
  const [opened, setOpened] = useState(false);                                           // เพิ่งคลิกการ์ดเปิดความสามารถที่รออยู่: คำถามแรกกด Cancel ย้อนกลับได้
  const [trigArmed, setTrigArmed] = useState(false);
  const [choiceMin, setChoiceMin] = useState(false);                                    // ย่อหน้าต่างเลือกการ์ดไว้ดูสนาม                                    // คลิกการ์ดทริกเกอร์แล้ว เมาส์แสดงผลที่จะให้                                         // การ์ดที่คลิกเลือกความสามารถที่รออยู่

  const actor = s.awaiting?.player;
  const botTurn = !!bot && actor === "bot" && !s.winner;
  const choice = s.awaiting?.choice;
  const ordering = s.awaiting?.kind === "order-queue";
  const trig = choice || ordering ? undefined : s.battle?.pendingTrigger;
  const guarding = s.step === "guard" && !!s.battle;
  // คำถามเลือกการ์ดที่ตัวเลือกเป็นยูนิทบนสนามทั้งหมด: เลือกบนสนามแทนหน้าต่าง
  const fieldChoice = choice?.kind === "cards" && choice.options.every((u) => locate(s, u)?.zone === "circle") ? choice : undefined;
  const striding = s.phase === "ride" && s.step === "stride" && s.awaiting?.kind === "next-phase" && !s.strodeThisTurn;
  // ความสามารถที่รอผู้เล่น: การ์ดขอบเหลือง (sources) คลิกแล้วเป็นขอบส้ม (active) และถามว่าจะใช้ไหม
  // ระหว่างความสามารถทำงานและรอคำตอบ การ์ดต้นทางเป็นขอบส้ม
  const queued = ordering ? s.queue.filter((e) => e.owner === actor) : [];
  const acts = usableActs(db, s);                                                       // ACT ที่กดใช้ได้ในเมนเฟส
  const focusedAct = acts.find((a) => a.uid === focus);
  const active = focusedAct ? [focus!] : choice && s.resolving ? [s.resolving.uid] : [];
  const sources = [...queued, ...acts].map((e) => e.uid).filter((u) => !active.includes(u));
  const waitingPiles = sourcePiles(s, sources), activePiles = sourcePiles(s, active);

  // หน้าดูย้อนหลัง: เลื่อนก้าวแล้วแสดงสนามของก้าวนั้น (ไม่สร้างหน้าสนามใหม่ การ์ดจึงเลื่อนต่อเนื่อง)
  useEffect(() => {
    if (!view) return;
    setS(initial);
    setLog(view.log);
  }, [initial]);
  useEffect(() => { if (!error) return; const t = setTimeout(() => setError(undefined), 2600); return () => clearTimeout(t); }, [error]);
  useEffect(() => {
    // โหมดเลือกการ์ดเปลี่ยนมีเฉพาะตอนรอเปลี่ยนการ์ดบนมือ (ทีละฝั่ง ล้างเมื่อพ้นขั้นนี้)
    const mulliganing = s.awaiting?.kind === "mulligan";
    if (mulliganing && !mode) setMode({ kind: "mulligan", picks: [] });
    if (!mulliganing && mode?.kind === "mulligan") setMode(null);
    if (trig && mode?.kind !== "trigger") setMode({ kind: "trigger" });
  }, [s, mode, trig]);

  // คลิกการ์ดที่ไหนก็ได้: แสดงรายละเอียด ถ้ามีความสามารถรออยู่ เปิดคำถามแรกของความสามารถนั้น (Cancel = ปิด ความสามารถยังรออยู่)
  // ACT ในเมนเฟสยังถามก่อนใช้ เพราะคลิกดูการ์ดบนสนามอย่างเดียวก็ได้
  function setInspect(uid: string) {
    const f = findCard(s, uid);
    if (f) setInspectUids((i) => ({ ...i, [f.player]: uid }));
    const i = queued.findIndex((e) => e.uid === uid);
    if (i >= 0 && !botTurn && !readOnly) { act({ type: "order-queue", index: i, ask: true }); setOpened(true); return; }
    setFocus(acts.some((e) => e.uid === uid) ? uid : undefined);
  }

  function inspectedOf(p: PlayerId) {
    const hovered = hover ? findCard(s, hover) : undefined;
    const uid = inspect[p];
    const f = hovered?.player === p ? hovered : uid ? findCard(s, uid) : undefined;
    if (!f) return undefined;
    return { ...f, power: f.circle ? powerOf(db, s.players[f.player], f.circle) : undefined };
  }

  // then: action ต่อเนื่องที่คำนวณจาก state ใหม่ (ทำต่อเฉพาะเมื่อถูกกฎ)
  // ตาของบอท: รับเฉพาะ action จากบอท (fromBot) การคลิกของผู้เล่นไม่มีผล
  function act(action: Action, then?: (st: GameState) => Action | undefined, fromBot = false) {
    if (!actor || readOnly || botTurn !== fromBot) return;
    try {
      const r = apply(db, s, actor, action);
      let st = r.state;
      const entries = r.events.map((e) => ({ ...e, turn: st.turn }));
      const done: RecordedAction[] = [{ player: actor, action }];
      const follow = then?.(st);
      if (follow && st.awaiting) {
        try {
          const p2 = st.awaiting.player;
          const r2 = apply(db, st, p2, follow);
          st = r2.state;
          entries.push(...r2.events.map((e) => ({ ...e, turn: st.turn })));
          done.push({ player: p2, action: follow });
        } catch (e) { if (!(e instanceof RuleError)) throw e; }
      }
      bot?.observe?.(entries);
      setPast((h) => h.concat({ s, log, actions }));
      setFuture([]);
      setLog(log.concat(entries));
      setActions(actions.concat(done));
      setS(st);
      clearUi();
    } catch (e) {
      if (e instanceof RuleError) setError(e.msg); else throw e;
    }
  }

  // ตาของบอท: ให้บอทคิดแล้วส่ง action (ยกเลิกถ้า state เปลี่ยนก่อนบอทคิดเสร็จ เช่น กดย้อนกลับ)
  useEffect(() => {
    if (!bot || !botTurn) return;
    let alive = true;
    const decision = s.awaiting!;
    const t = setTimeout(() => {
      bot.decide(s, decision).then((a) => { if (alive) act(a, undefined, true); }, (e) => console.error(e));
    }, BOT_DELAY_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [s, bot, botTurn]);

  // ย้อนกลับ/ไปหน้า ทีละ action (state และ log กลับไปพร้อมกัน)
  // เล่นกับบอท: ข้ามจุดที่บอทตัดสินใจ ไปหยุดที่ตาของผู้เล่น
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

  function clearUi() {
    setFocus(undefined);
    setOpened(false);
    setSel(null);
    setMode(null);
    setChoicePicks([]);
    setTrigArmed(false);
    setChoiceMin(false);
    setHover(undefined);
  }

  function clickHand(p: PlayerId, inst: CardInstance) {
    if (bot && p === "bot") return;   // มือบอทคว่ำอยู่ ดูไม่ได้
    setInspect(inst.uid);
    if (botTurn) return;
    if (actor && p !== actor) { setError(msg("err.turnOf", { player: playerMsg(actor) })); return; }
    if (choice || ordering) return;
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
    if (choice || ordering) return;
    const mine = p === actor;
    if (mine && mode?.kind === "trigger" && trig) {
      if (!unit) return;
      if (trig.kind === "critical" || trig.kind === "stand") {
        if (!mode.powerTo) {
          const canStand = Object.entries(s.players[p].circles).some(([rc, u]) => rc !== "vc" && u?.rested);
          if (trig.kind === "stand" && !canStand) { act({ type: "trigger-target", powerTo: c }); return; }
          setMode({ kind: "trigger", powerTo: c });
          return;
        }
        act({ type: "trigger-target", powerTo: mode.powerTo, extraTo: c });
      } else act({ type: "trigger-target", powerTo: c });
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
    // เลือกตัวโจมตี/ตัวบูสท์: แนวเดียวกันกดเพิ่ม/เอาออกได้ทั้ง 2 ใบ กดแนวอื่นเริ่มเลือกใหม่
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
    if (queued.some((e) => e.uid === inst.uid)) { setPile(null); return; }
    if (zone !== "gZone" || p !== actor || inst.faceUp) return;
    const type = db[inst.key].type;
    if (s.phase === "ride" && s.step === "stride" && type === "g-unit") { setMode({ kind: "stride", gUid: inst.uid, picks: mode?.kind === "stride" ? mode.picks : [] }); setPile(null); }
    if (guarding && type === "g-guardian") {
      const why = gGuardianBlocked(db, s, p);
      if (why) { setError(why); return; }
      const heals = s.players[p].hand.filter((c) => db[c.key].trigger === "heal");
      setMode({ kind: "gguard", gUid: inst.uid, discardUid: heals.length === 1 ? heals[0].uid : undefined });   // Heal ใบเดียว เลือกให้เลย
      setSel(null);
      setPile(null);
    }
  }

  function toggleChoicePick(uid: string) {
    if (choice?.kind !== "cards") return;
    setChoicePicks((ps) => ps.includes(uid) ? ps.filter((x) => x !== uid) : ps.length >= choice.max ? [...ps.slice(1), uid] : [...ps, uid]);
    setInspect(uid);
  }

  // ปิดความสามารถที่เพิ่งเปิด: กลับไปก่อนคลิกการ์ด (ไม่นับเป็นก้าวที่ redo ได้)
  function cancelOpened() {
    const prev = past.at(-1);
    if (!prev) return;
    setPast(past.slice(0, -1));
    setS(prev.s);
    setLog(prev.log);
    setActions(prev.actions);
    clearUi();
  }

  // คำถามแรกของความสามารถที่เพิ่งคลิกเปิด: ปุ่มไม่ใช้/ข้าม เปลี่ยนเป็น Cancel
  function question(): { prompt?: Msg; buttons: { label: Msg | string; onClick: () => void }[] } | undefined {
    const q = baseQuestion();
    if (!opened || !s.resolving || !choice) return q;
    const cancel = { label: msg("btn.cancel"), onClick: cancelOpened };
    const keep = (q?.buttons ?? []).filter((b) => typeof b.label === "string" || (b.label.key !== "btn.no" && b.label.key !== "btn.none"));
    return { prompt: q?.prompt ?? s.awaiting?.prompt, buttons: [...keep, cancel] };
  }

  // คำถามในแถบกลาง: ความสามารถที่คลิกเลือก (ใช่/ไม่) หรือคำถามระหว่างความสามารถทำงาน (ใช่/ไม่ เลือกผล เลือกช่อง)
  function baseQuestion(): { prompt?: Msg; buttons: { label: Msg | string; onClick: () => void }[] } | undefined {
    const useQ = (label: string, cost: string[]) => cost.length ? msg("q.useCost", { label: abilityTag(label), cost: cost.join(", ") }) : msg("q.use", { label: abilityTag(label) });
    const yes = msg("btn.yes"), no = msg("btn.no");
    if (botTurn || readOnly) return undefined;
    if (focusedAct) {
      return { prompt: useQ(focusedAct.label, focusedAct.cost), buttons: [
        { label: yes, onClick: () => act({ type: "activate", cardUid: focusedAct.uid, abilityIndex: focusedAct.index }) },
        { label: no, onClick: () => setFocus(undefined) },
      ] };
    }
    // สไตรด์สเต็ป: ตรงกลางเป็นปุ่ม Skip (ไปเมนเฟส) สไตรด์ = กด G โซน เลือก G ยูนิท แล้วเลือกการ์ดบนมือที่จะทิ้ง (เกรดรวม 3 ขึ้นไป)
    if (striding && mode?.kind === "stride") {
      const gs = mode.picks.reduce((n, u) => n + strideCostGrade(db[findCard(s, u)!.inst.key]), 0);
      const g = mode.gUid && db[findCard(s, mode.gUid)!.inst.key].name;
      const gUid = mode.gUid, discardUids = mode.picks;
      const buttons = [{ label: msg("btn.cancel"), onClick: () => setMode(null) }];
      if (gUid && gs >= 3) buttons.unshift({ label: msg("btn.stride"), onClick: () => act({ type: "stride", gUid, discardUids }) });
      return { prompt: msg("q.stride", { g: g ?? msg("q.pickGUnit"), n: gs }), buttons };
    }
    // การ์ด: เลือกการ์ดบนมือ หรือ G การ์เดี้ยน แล้วยืนยัน
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

  // ปุ่มเปลี่ยนเฟส: ถ้ามีความสามารถรออยู่ ถือว่าไม่ใช้ (แบบบังคับทำเองตามลำดับ) แล้วไปต่อถ้ายังอยู่สเต็ปเดิม
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
      trig && uid === s.battle?.checkCard?.uid ? (trigArmed ? "active" : "source")
      : fieldChoice?.options.includes(uid) ? (choicePicks.includes(uid) ? "active" : "source")
      : (striding || mode?.kind === "stride") && s.players[actor!]?.gZone.some((g) => g.uid === uid && !g.faceUp && db[g.key].type === "g-unit") ? (mode?.kind === "stride" && mode.gUid === uid ? "active" : "source")
      : active.includes(uid) ? "active" : sources.includes(uid) ? "source" : undefined,
    // ทริกเกอร์: คลิกการ์ดที่เปิดเช็คแล้วเมาส์บอกผลที่จะให้ (Power ของทริกเกอร์ก่อน แล้ว Critical/Stand) ยูนิทที่เลือกรับ Power แสดงค่าล่วงหน้า
    clickCheck: (uid: string) => { setInspect(uid); if (trig && uid === s.battle?.checkCard?.uid) setTrigArmed(true); },
    trigTip: trig && trigArmed
      ? mode?.kind === "trigger" && mode.powerTo ? { text: trig.kind === "critical" ? msg("tip.critical", { v: "+1" }) : msg("tip.stand"), kind: "cri" } : { text: msg("tip.power", { v: `+${fmt(trig.power)}` }), kind: "pow" }
      : undefined,
    trigBonus: trig && mode?.kind === "trigger" && mode.powerTo ? { player: trig.owner, bonus: { [mode.powerTo]: trig.power } as Partial<Record<Circle, number>> }
      : fieldChoice?.bonus?.stat === "power" ? { player: actor!, bonus: Object.fromEntries(choicePicks.map((u) => [locate(s, u)!.circle!, fieldChoice.bonus!.value])) as Partial<Record<Circle, number>> }
      : undefined,
    // เลือกยูนิทรับผลบนสนาม: เมาส์บอกผลที่จะได้ (จนกว่าจะเลือกครบ)
    choiceTip: fieldChoice?.bonus && choicePicks.length < fieldChoice.max
      ? { text: msg(`tip.${fieldChoice.bonus.stat}`, { v: `${fieldChoice.bonus.value > 0 ? "+" : ""}${fmt(fieldChoice.bonus.value)}` }), kind: fieldChoice.bonus.stat === "critical" ? "cri" : "pow" }
      : undefined,
    fieldChoice: !!fieldChoice, choiceMin, setChoiceMin,
    pileLight: (p: PlayerId, zone: string): Light => (striding || mode?.kind === "stride") && !botTurn && !readOnly && p === actor && zone === "gZone" ? (mode?.kind === "stride" && mode.gUid ? "active" : "source") : (activePiles[p].has(zone) ? "active" : waitingPiles[p].has(zone) ? "source" : undefined), choice, ordering, trig, guarding, mode, choicePicks, pile,
    selUid: sel?.kind === "hand" ? sel.uid : sel?.kind === "circle" ? s.players[sel.player].circles[sel.circle]?.uid : undefined,
    // ยูนิทที่เลือกโจมตี/บูสท์ (ขอบแดง) และ Power ที่จะได้จากบูสท์
    // การต่อสู้ที่ประกาศแล้ว: ตัวโจมตี/บูสท์ขอบแดง เป้าหมายขอบเหลือง (ฝั่งป้องกันเห็นว่าโดนอะไรโจมตีใคร)
    battleMarks: s.battle ? {
      [s.turnPlayer]: { atk: [s.battle.attacker, s.battle.booster].filter((c): c is Circle => !!c), aimed: [] as Circle[] },
      [s.turnPlayer === "me" ? "bot" : "me"]: { atk: [] as Circle[], aimed: [s.battle.target] },
    } as Record<PlayerId, { atk: Circle[]; aimed: Circle[] }> : undefined,
    // Shield ที่จะได้จากการ์ดที่เลือกอยู่ (แสดงล่วงหน้าที่ตัวเลขป้องกัน) และมีพิทักษ์ในนั้นไหม
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
    isTarget: (p: PlayerId, c: Circle) => isTarget({ s, db, actor, choice, sel, mode }, p, c),
    // เปลี่ยนการ์ดบนมือตอนเริ่มเกม (ครั้งเดียวต่อผู้เล่น): ไม่เลือกการ์ด = เก็บมือเดิม
    mulligan: !botTurn && !readOnly && s.awaiting?.kind === "mulligan" && mode?.kind === "mulligan"
      ? { picks: mode.picks.length, confirm: () => act({ type: "mulligan", returnUids: mode.picks }) }
      : undefined,
    undo: past.length && !readOnly ? () => travel(true) : undefined,
    redo: future.length && !readOnly ? () => travel(false) : undefined,
    act, clickHand, clickCircle, clickPileCard, toggleChoicePick, question, next,
    canNext: !botTurn && !readOnly && (s.awaiting?.kind === "next-phase" || s.awaiting?.kind === "guard" || ordering),
    botTurn, hideBotHand: !!bot,
    actions, readOnly,
    setInspect, setPile,
  };
}

export type BoardModel = ReturnType<typeof useBoard>;
