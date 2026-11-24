// ระบบความสามารถของการ์ด: จับเหตุการณ์ → คิว check timing → ทำงานทีละรหัส หยุดถามผู้เล่นได้กลางทาง
import { msg, type Msg, type MsgKey } from "../i18n/msg";
import { parseCode, quoted, splitTop, type Code } from "./code";
import { shuffle } from "./rng";
import { RC, RuleError, SAME_COLUMN, circleMsg, generationBreak, hasHollow, isG, other, type CardDB } from "./rules";
import { circleOf, drawCard, ev, fieldUnits, locate, name, playerMsg, pull, reset, win, type Out } from "./state";
import type { Ability, CardInstance, Choice, Circle, GameState, PlayerId, QueueEntry, Resolving, TriggerEvent } from "./types";

export type ResumeHandlers = Record<string, (db: CardDB, s: GameState, out: Out) => void>;

const KIND_TH: Record<string, string> = { AUTO: "AUTO", ACT: "ACT", CONT: "CONT" };
const label = (db: CardDB, inst: CardInstance, ab: Ability) => `${db[inst.key].name} [${KIND_TH[ab.kind] ?? ab.kind}]`;
const num = (t?: string) => parseInt((t ?? "1").replace(/[^\d]/g, ""), 10) || 0;
// รหัสที่ engine จัดการเองหรือไม่มีผลระหว่างเกม
const SKIP_OPS = /^(keyword|all-clan)\(|^retire\(self, at=turn-end/;

function abilitiesOf(db: CardDB, inst: CardInstance, grants: Ability[]): [string, Ability][] {
  return [
    ...db[inst.key].abilities.map((a, i) => [String(i), a] as [string, Ability]),
    ...grants.map((a, i) => ["g" + i, a] as [string, Ability]),
  ];
}

function zoneOk(zone: string | undefined, where: string): boolean {
  if (!zone) return true;
  return zone.split("/").some((z) =>
    z === "VC" ? where === "vc" : z === "RC" ? RC.includes(where as Circle) : z === "GC" ? where === "guardian" : z === "hand" ? where === "hand" : false);
}

function matches(timing: string, e: TriggerEvent, uid: string, owner: PlayerId): boolean {
  const c = parseCode(timing);
  const [a0, a1] = c.pos;
  const n = c.named;
  switch (c.name) {
    case "enter":
      return e.kind === "enter" && e.zone === a0 && (!n.from || n.from === e.from)
        && (a1 === "self" ? e.uid === uid : a1 === "other-own" ? e.player === owner && e.uid !== uid : false);
    case "stride": return e.kind === "stride" && e.player === owner;
    case "ridden-upon": return e.kind === "ridden-upon" && e.uid === uid;
    case "attack":
      if (e.kind !== "attack") return false;
      if (a0 === "own-VC") return e.player === owner && e.circle === "vc";
      return e.uid === uid && (!n.target || n.target === (e.target === "vc" ? "VC" : "RC"));
    case "battle-end":
      if (e.kind !== "battle-end") return false;
      if (n.did === "attack-VC") return e.attackerUid === uid && e.target === "vc";
      if (n.did === "attack") return e.attackerUid === uid;
      if (n.did === "boost-RC") return e.boosterUid === uid && e.attackerCircle !== "vc";
      return false;
    case "to-drop":
    case "retired":
      return e.kind === c.name && (a0 === "own" ? e.player === owner : e.uid === uid) && (!n.by || n.by === e.by);
    case "discarded": return e.kind === "discarded" && e.uid === uid && (!n.as || n.as === e.as);
    case "phase-start": return e.kind === "phase-start" && e.player === owner && e.phase === a0;
    default: return false;
  }
}

function vcInfo(db: CardDB, s: GameState, p: PlayerId) {
  const ps = s.players[p];
  const vc = ps.circles.vc ? db[ps.circles.vc.key] : undefined;
  const names = [vc?.name ?? "", ps.heart && vc?.type === "g-unit" ? db[ps.heart.key].name : ""].join(" ");
  return { names, grade: vc?.grade ?? 0, clan: vc?.clan ?? "" };
}

export function condOk(db: CardDB, s: GameState, owner: PlayerId, inst: CardInstance, key: string, ab: Ability, phase: "trigger" | "resolve"): boolean {
  for (const c of ab.cond ?? []) {
    for (const t of splitTop(c, "&")) {
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^GB\((\d+)\)$/))) { if (generationBreak(db, s.players[owner]) < +m[1]) return false; }
      else if (t === "1/turn") { if (inst.usedThisTurn.includes(key)) return false; }
      else if (t === "own-turn") { if (s.turnPlayer !== owner) return false; }
      else if (t === "self-hollowed") { if (phase === "resolve" && !inst.hollowed) return false; }
      else if (t.startsWith("vc-name(")) { if (!vcInfo(db, s, owner).names.includes(quoted(t))) return false; }
      else if ((m = t.match(/^vc-grade≥(\d+)$/))) { if (vcInfo(db, s, owner).grade < +m[1]) return false; }
      else if ((m = t.match(/^vc-clan\((.+)\)$/))) { if (vcInfo(db, s, owner).clan !== m[1]) return false; }
    }
  }
  return true;
}

// ---------- จับเหตุการณ์ → คิว ----------

// ส่งเหตุการณ์ แล้วตรวจทันทีว่าเปิด AUTO ใบไหน (ใช้ตำแหน่งการ์ด ณ ตอนที่เหตุการณ์เกิด)
export function emit(db: CardDB, s: GameState, e: TriggerEvent) {
  s.events.push(e);
  collectTriggers(db, s);
}

// เรียร์การ์ดออกจากสนามลงดรอปโซน (รีไทร์)
export function retireUnit(db: CardDB, s: GameState, p: PlayerId, c: Circle, out: Out, why: Msg, by?: "hollow") {
  const ps = s.players[p];
  const inst = ps.circles[c];
  if (!inst) return;
  delete ps.circles[c];
  const grants = inst.grants ?? [];
  ps.drop.push(reset(inst));
  ev(out, "retired", p, msg("log.retired", { card: name(db, inst), why }), inst.uid);
  emit(db, s, { kind: "retired", player: p, uid: inst.uid, from: "RC", grants });
  emit(db, s, { kind: "to-drop", player: p, uid: inst.uid, from: "RC", by, grants });
}

// วางยูนิทลง RC ถ้ามียูนิทอยู่แล้ว ยูนิทเดิมถูกรีไทร์
export function placeOnRC(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance, c: Circle, from: string, out: Out) {
  if (s.players[p].circles[c]) retireUnit(db, s, p, c, out, msg("reason.overCall"));
  s.players[p].circles[c] = reset(inst);
  ev(out, "call", p, msg("log.call", { player: playerMsg(p), card: name(db, inst), circle: circleMsg(c) }), inst.uid);
  emit(db, s, { kind: "enter", player: p, uid: inst.uid, zone: "RC", from });
}

function collectTriggers(db: CardDB, s: GameState) {
  for (const e of s.events.splice(0)) {
    for (const p of [s.turnPlayer, other(s.turnPlayer)]) {
      const ps = s.players[p];
      const cands: { inst: CardInstance; where: string; grants: Ability[] }[] = [];
      for (const [c, inst] of Object.entries(ps.circles)) if (inst) cands.push({ inst, where: c, grants: inst.grants ?? [] });
      for (const g of ps.guardian) cands.push({ inst: g, where: "guardian", grants: g.grants ?? [] });
      const selfUid = "uid" in e && e.player === p ? e.uid : undefined;
      if (selfUid) {
        const at = locate(s, selfUid);
        const captured = e.kind === "to-drop" || e.kind === "retired" ? e.grants : [];
        const known = cands.find((c) => c.inst.uid === selfUid);
        if (known) known.grants = [...known.grants, ...captured];
        else if (at) cands.push({ inst: at.inst, where: at.zone, grants: captured });
      }
      for (const { inst, where, grants } of cands) {
        for (const [key, ab] of abilitiesOf(db, inst, grants)) {
          if (ab.kind !== "AUTO" || !ab.timing) continue;
          const self = inst.uid === selfUid;
          if (!self && !zoneOk(ab.zone, where)) continue;
          if (!matches(ab.timing, e, inst.uid, p)) continue;
          if (!condOk(db, s, p, inst, key, ab, "trigger")) continue;
          s.queue.push({ owner: p, uid: inst.uid, key, ability: ab, event: e, label: label(db, inst, ab), optional: isOptional(ab) });
        }
      }
    }
  }
}

// AUTO ที่ผู้เล่นเลือกไม่ใช้ได้: มีคอสต์ หรือผลแรกเป็นแบบ "ได้" (ผู้เริ่มต้นคอลตัวเอง, เลือกติดฮอลโล่ว์)
const MAY_FIRST = /^(call\(self→RC\)|hollow\(self\))$/;
export const isOptional = (ab: Ability) => !!ab.cost?.length || MAY_FIRST.test(ab.effect[0] ?? "");

// ---------- วงรอบหลัก ----------

export function settle(db: CardDB, s: GameState, out: Out, resume: ResumeHandlers) {
  for (let guard = 0; guard < 2000; guard++) {
    if (s.winner) return;
    // rule action: กองการ์ดเหลือ 0 ใบเป็นฝ่ายแพ้ทันที ไม่ต้องรอจั่ว
    const empty = [s.turnPlayer, other(s.turnPlayer)].find((q) => s.players[q].deck.length === 0);
    if (empty) { win(s, other(empty), out, msg("win.deckOut", { player: playerMsg(empty) })); return; }
    if (s.resolving) { if (!runResolving(db, s, out)) return; continue; }
    if (s.events.length) { collectTriggers(db, s); continue; }
    if (s.battle?.pendingTrigger) return;
    const p = [s.turnPlayer, other(s.turnPlayer)].find((q) => s.queue.some((e) => e.owner === q));
    if (p) {
      const mine = s.queue.filter((e) => e.owner === p);
      // เหลืออันเดียวแต่ใช้ไม่ได้: ข้ามพร้อมบอกเหตุ ไม่ให้ผู้เล่นต้องกดเอง
      // (ถ้ามีหลายอัน ยังไม่ข้าม เพราะลำดับที่เลือกอาจทำให้ใช้ได้ เช่น ติดฮอลโล่ว์ก่อน หรือ CC ก่อนจ่าย CB)
      if (mine.length === 1 && blocked(db, s, mine[0])) { startResolving(db, s, mine[0], out); continue; }
      if (s.passQueue === p) {
        const skip = mine.find((e) => e.optional);
        if (skip) { declineEntry(s, skip, out); continue; }
      } else if (mine.length > 1 || mine[0].optional) return;   // รอเจ้าของเลือกว่าจะใช้อันไหน/ลำดับไหน
      startResolving(db, s, mine[0], out);
      continue;
    }
    s.passQueue = undefined;
    if (s.resume) { const r = s.resume; s.resume = undefined; resume[r](db, s, out); continue; }
    return;
  }
  throw new Error("ability resolution did not settle");
}

export function declineEntry(s: GameState, entry: QueueEntry, out: Out) {
  s.queue.splice(s.queue.indexOf(entry), 1);
  ev(out, "skip", entry.owner, msg("log.skip", { label: entry.label }), entry.uid);
}

const toResolving = (entry: QueueEntry, activated: boolean): Resolving => ({
  ...entry, ops: [...(entry.ability.cost ?? []), ...entry.ability.effect].filter((o) => !SKIP_OPS.test(o)),
  i: 0, asked: activated || !(entry.ability.cost?.length), confirmed: activated, local: {}, called: [], usedCircles: [], hollowMilled: 0,
});

// เหตุที่ความสามารถในคิวทำงานไม่ได้ตอนนี้ (undefined = ทำได้)
export function blocked(db: CardDB, s: GameState, entry: QueueEntry): Msg | undefined {
  const at = locate(s, entry.uid);
  // ความสามารถ "เมื่อสไตรด์" ของแวนการ์ดเดิม ทำงานต่อได้แม้ตอนนี้เป็นฮาร์ทแล้ว
  const asHeart = at?.zone === "heart" && entry.event?.kind === "stride";
  const where = at?.zone === "circle" ? at.circle! : asHeart ? "vc" : at?.zone ?? "";
  const self = entry.event && "uid" in entry.event && entry.event.uid === entry.uid;
  if (!at || (!self && !zoneOk(entry.ability.zone, where)) || !condOk(db, s, entry.owner, at.inst, entry.key, entry.ability, "resolve")) return msg("reason.condUnmet");
  if (!canPay(db, s, toResolving(entry, false))) return msg("reason.cannotPay");
}

export function startResolving(db: CardDB, s: GameState, entry: QueueEntry, out: Out, activated = false) {
  s.queue.splice(s.queue.indexOf(entry), 1);
  const why = blocked(db, s, entry);
  if (why) { ev(out, "skip", entry.owner, msg("log.blocked", { label: entry.label, why }), entry.uid); return; }
  const r = toResolving(entry, activated);
  s.resolving = r;
  ev(out, "ability", entry.owner, msg("log.abilityStart", { label: entry.label }), entry.uid);
  if (r.asked) markUsed(s, r);
}

function markUsed(s: GameState, r: Resolving) {
  if (r.ability.cond?.includes("1/turn")) locate(s, r.uid)?.inst.usedThisTurn.push(r.key);
}

function runResolving(db: CardDB, s: GameState, out: Out): boolean {
  const r = s.resolving!;
  if (!r.asked) {
    if (!r.answer) return ask(r, { kind: "yesno", prompt: msg("q.useCost", { label: r.label, cost: r.ability.cost!.join(", ") }) });
    const yes = r.answer.option === "yes";
    r.answer = undefined;
    r.asked = true;
    if (!yes) { ev(out, "skip", r.owner, msg("log.skip", { label: r.label }), r.uid); s.resolving = undefined; return true; }
    markUsed(s, r);
  }
  while (r.i < r.ops.length) {
    if (!runOp(db, s, r, r.ops[r.i], out)) return false;
    r.i++;
    r.local = {};
    r.answer = undefined;
    if (s.winner) break;
  }
  s.resolving = undefined;
  return true;
}

function ask(r: Resolving, choice: Choice): false {
  r.choice = choice;
  return false;
}

// bonus: ผลที่ยูนิทที่เลือกจะได้ (หน้าจอแสดงล่วงหน้าเมื่อเลือกบนสนาม)
const askCards = (r: Resolving, prompt: Msg, options: CardInstance[], min: number, max: number, bonus?: { stat: "power" | "shield" | "critical"; value: number }) =>
  ask(r, { kind: "cards", prompt, options: options.map((i) => i.uid), min, max, bonus });

// ---------- ตัวกรองและเงื่อนไข ----------

function matchFilter(db: CardDB, s: GameState, r: Resolving, inst: CardInstance, flt: string): boolean {
  const card = db[inst.key];
  const source = locate(s, r.uid)?.inst;
  for (const t of splitTop(flt, "&")) {
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^grade-(\d+)$/))) { if (card.grade !== +m[1]) return false; }
    else if ((m = t.match(/^grade≤(\d+)$/))) { if (card.grade > +m[1]) return false; }
    else if (t.startsWith("name(")) { if (!card.name.includes(quoted(t))) return false; }
    else if (t === "not-same-name") { if (source && card.name === db[source.key].name) return false; }
    else if (t === "same-name") { if (source && inst.key !== source.key) return false; }
    else if (t === "has-hollow") { if (!hasHollow(card)) return false; }
    else if (t === "normal-unit") { if (card.type !== "normal") return false; }
    else if (t === "heal" || t === "heal-trigger") { if (card.trigger !== "heal") return false; }
    else if (t === "G-GUARDIAN") { if (card.type !== "g-guardian") return false; }
    else if (t === "that-card") { const e = r.event; if (!e || !("uid" in e) || e.uid !== inst.uid) return false; }
    else if (t === "different-grades" || t === "grade-sum≥3") { /* ตรวจตอนเลือก */ }
    else if (card.clan !== t) return false;          // ชื่อแคลน เช่น Granblue
  }
  return true;
}

function evalIf(db: CardDB, s: GameState, r: Resolving, expr?: string): boolean {
  if (!expr) return true;
  const src = locate(s, r.uid)?.inst;
  let m: RegExpMatchArray | null;
  if (expr === "self-hollowed") return !!src?.hollowed;
  if (expr === "called-has-hollow") return r.called.some((u) => { const i = locate(s, u)?.inst; return !!i && hasHollow(db[i.key]); });
  if ((m = expr.match(/^hollow-milled≥(\d+)$/))) return r.hollowMilled >= +m[1];
  if ((m = expr.match(/^called≥(\d+)$/))) return r.called.length >= +m[1];
  if (expr.startsWith("name-in-drop(")) return s.players[r.owner].drop.some((i) => db[i.key].name.includes(quoted(expr)));
  return true;
}

const rcUnits = (s: GameState, p: PlayerId) => RC.map((c) => s.players[p].circles[c]).filter((i): i is CardInstance => !!i);

function canPay(db: CardDB, s: GameState, r: Resolving): boolean {
  const ps = s.players[r.owner];
  const src = locate(s, r.uid);
  for (const code of r.ability.cost ?? []) {
    const c = parseCode(code);
    const n = num(c.pos[0]);
    switch (c.name) {
      case "CB": if (ps.damage.filter((d) => d.faceUp).length < n) return false; break;
      case "SB": if (ps.soul.length < n) return false; break;
      case "mill": if (ps.deck.length < n) return false; break;
      case "discard": case "reveal": if (!ps.hand.some((h) => matchFilter(db, s, r, h, c.named.filter ?? ""))) return false; break;
      case "retire-own": if (rcUnits(s, r.owner).filter((u) => u.uid !== r.uid).length < n) return false; break;
      case "soul-in": if (src?.zone !== "circle") return false; break;
      case "bind": if (!ps.drop.some((d) => d.uid !== r.uid && db[d.key].trigger === "heal")) return false; break;
      case "flip-G-up": if (!ps.gZone.some((g) => !g.faceUp && matchFilter(db, s, r, g, c.named.filter ?? ""))) return false; break;
    }
  }
  return true;
}

function flipDamage(s: GameState, p: PlayerId, n: number, toFaceUp: boolean): number {
  let done = 0;
  for (const d of s.players[p].damage) if (done < n && d.faceUp !== toFaceUp) { d.faceUp = toFaceUp; done++; }
  return done;
}

function circleOptions(s: GameState, r: Resolving, to?: string): Circle[] {
  const ps = s.players[r.owner];
  if (to === "empty") return RC.filter((c) => !ps.circles[c]);
  if (to === "different") return RC.filter((c) => !r.usedCircles.includes(c));
  if (to === "not-self") return RC.filter((c) => c !== circleOf(s, r.owner, r.uid));
  if (to === "same-column") {
    const sc = circleOf(s, r.owner, r.uid);
    if (sc === "vc") return ["back_center"];
    const pair = sc && SAME_COLUMN[sc];
    return pair ? [pair] : [];
  }
  return RC;
}

// ---------- รหัสแต่ละตัว (คืน true = เสร็จ, false = รอคำตอบ) ----------

function runOp(db: CardDB, s: GameState, r: Resolving, op: string, out: Out): boolean {
  const c: Code = parseCode(op);
  const p = r.owner, ps = s.players[p], opp = other(p);
  const src = () => locate(s, r.uid);
  const say = (key: MsgKey, params?: Record<string, string | number | Msg>, uid?: string) => ev(out, c.name, p, msg(key, params), uid);

  switch (c.name) {
    case "CB": { const n = flipDamage(s, p, num(c.pos[0]), false); say("log.cb", { n }); return true; }
    case "CC": {
      if (!evalIf(db, s, r, c.named.if)) return true;
      // ดาเมจคว่ำมากกว่าจำนวนที่หงายได้ ให้ผู้เล่นเลือกใบ
      const down = ps.damage.filter((d) => !d.faceUp), n = Math.min(num(c.pos[0]), down.length);
      if (down.length > n && !r.answer?.uids) return askCards(r, msg("choice.cc", { n }), down, n, n);
      const picked = down.length > n ? down.filter((d) => r.answer!.uids!.includes(d.uid)) : down;
      for (const d of picked) d.faceUp = true;
      say("log.cc", { n: picked.length }); return true;
    }
    case "damage-facedown": { flipDamage(s, p, num(c.pos[0]), false); say("log.damageFacedown"); return true; }
    case "SB": {
      for (let i = 0; i < num(c.pos[0]) && ps.soul.length; i++) ps.drop.push(reset(ps.soul.pop()!));
      say("log.sb", { n: num(c.pos[0]) }); return true;
    }
    case "SC": {
      for (let i = 0; i < num(c.pos[0]) && ps.deck.length; i++) ps.soul.push(reset(ps.deck.shift()!));
      say("log.sc", { n: num(c.pos[0]) }); return true;
    }
    case "mill": {
      const n = num(c.pos[0]);
      for (let i = 0; i < n && ps.deck.length; i++) ps.drop.push(reset(ps.deck.shift()!));
      say("log.mill", { n }); return true;
    }
    case "draw": {
      if (!evalIf(db, s, r, c.named.if)) return true;
      for (let i = 0; i < num(c.pos[0]); i++) if (!drawCard(s, p, out)) return true;
      return true;
    }
    case "reveal": say("log.reveal"); return true;
    case "discard": {
      const opts = ps.hand.filter((h) => matchFilter(db, s, r, h, c.named.filter ?? ""));
      const n = Math.min(num(c.pos[0]), opts.length);
      if (!n) return true;
      if (!r.answer?.uids) return askCards(r, msg("choice.discard", { n }), opts, n, n);
      for (const u of r.answer.uids) { const { inst } = pull(s, u); ps.drop.push(reset(inst)); say("log.discard", { card: name(db, inst) }, u); }
      return true;
    }
    case "retire-own": {
      const opts = rcUnits(s, p).filter((u) => u.uid !== r.uid);
      if (!r.answer?.uids) return askCards(r, msg("choice.retireOwn"), opts, 1, 1);
      retireUnit(db, s, p, circleOf(s, p, r.answer.uids[0])!, out, msg("reason.cost"));
      return true;
    }
    case "soul-in": {
      const at = src();
      if (at?.zone === "circle") { pull(s, r.uid); ps.soul.push(reset(at.inst)); say("log.soulIn", { card: name(db, at.inst) }, r.uid); }
      return true;
    }
    case "bind": {
      if (!r.local.selfDone) {
        const at = src();
        if (at && at.zone !== "bind") { pull(s, r.uid); ps.bind.push(reset(at.inst)); say("log.bind", { card: name(db, at.inst) }, r.uid); }
        r.local.selfDone = 1;
      }
      const opts = ps.drop.filter((d) => db[d.key].trigger === "heal");
      if (!opts.length) return true;
      if (!r.answer?.uids) return askCards(r, msg("choice.bindHeal"), opts, 1, 1);
      const { inst } = pull(s, r.answer.uids[0]); ps.bind.push(reset(inst)); say("log.bind", { card: name(db, inst) }, inst.uid);
      return true;
    }
    case "flip-G-up": {
      const opts = ps.gZone.filter((g) => !g.faceUp && matchFilter(db, s, r, g, c.named.filter ?? ""));
      if (!opts.length) return true;
      if (!r.answer?.uids) return askCards(r, msg("choice.flipG"), opts, 1, 1);
      const g = ps.gZone.find((x) => x.uid === r.answer!.uids![0])!; g.faceUp = true; say("log.flipG", { card: name(db, g) }, g.uid);
      return true;
    }
    case "call": return opCall(db, s, r, c, out);
    case "search": {
      const [, dst] = c.pos[0].split("→");
      const max = num(c.pos.find((x) => x.startsWith("n")) ?? "n≤1");
      const pool = (c.named.look === "top-5" ? ps.deck.slice(0, 5) : ps.deck).filter((i) => matchFilter(db, s, r, i, c.named.filter ?? ""));
      if (pool.length && !r.answer?.uids) {
        return askCards(r, msg(dst === "hand" ? "choice.searchHand" : "choice.searchDrop", { n: max }), pool, 0, max);
      }
      for (const u of r.answer?.uids ?? []) {
        const { inst } = pull(s, u);
        if (dst === "hand") ps.hand.push(reset(inst)); else ps.drop.push(reset(inst));
        if (dst === "drop" && hasHollow(db[inst.key])) r.hollowMilled++;
        say(dst === "hand" ? "log.searchHand" : "log.searchDrop", { card: name(db, inst) }, u);
      }
      [ps.deck, s.rngState] = shuffle(ps.deck, s.rngState);
      say("log.shuffle");
      return true;
    }
    case "g-assist": {
      // เปิดมือ ดู 5 ใบบนกอง เอายูนิทเกรดที่ต้องการขึ้นมือได้ 1 ใบ แล้วสับกอง ถ้าได้การ์ด นำการ์ดบนมือ 2 ใบออกจากเกม
      if (!r.local.stage) {
        const grade = num(c.pos[0]);
        const pool = ps.deck.slice(0, 5).filter((i) => !isG(db[i.key]) && db[i.key].grade === grade);
        if (!r.answer?.uids) {
          say("log.revealHand", { player: playerMsg(p), cards: ps.hand.map((h) => name(db, h)).join(", ") });
          if (pool.length) return askCards(r, msg("choice.gAssistPick", { grade }), pool, 0, 1);
        }
        const picked = r.answer?.uids ?? [];
        for (const u of picked) { const { inst } = pull(s, u); ps.hand.push(reset(inst)); say("log.searchHand", { card: name(db, inst) }, u); }
        [ps.deck, s.rngState] = shuffle(ps.deck, s.rngState);
        say("log.shuffle");
        if (!picked.length) return true;
        r.local.stage = 1;
        r.answer = undefined;
      }
      const n = Math.min(2, ps.hand.length);
      if (!n) return true;
      if (!r.answer?.uids) return askCards(r, msg("choice.gAssistRemove", { n }), ps.hand, n, n);
      for (const u of r.answer.uids) { const { inst } = pull(s, u); ps.removed.push(reset(inst)); say("log.removed", { card: name(db, inst) }, u); }
      return true;
    }
    case "retire": {
      if (c.named.at === "turn-end" && c.named.target === "called") {
        for (const u of r.called) { const i = locate(s, u); if (i?.zone === "circle") i.inst.retireAtTurnEnd = true; }
        return true;
      }
      if (c.pos[0] === "opp-RC") {
        const opts = rcUnits(s, opp);
        if (!opts.length) return true;
        if (!r.answer?.uids) return askCards(r, msg("choice.retireOpp"), opts, 0, num(c.pos[1] ?? "n≤1"));
        for (const u of r.answer.uids) retireUnit(db, s, opp, circleOf(s, opp, u)!, out, msg("reason.effect", { label: r.label }));
        return true;
      }
      if (c.named.target === "boosted" && r.event?.kind === "battle-end") {
        const cc = circleOf(s, p, r.event.attackerUid);
        if (cc) retireUnit(db, s, p, cc, out, msg("reason.effect", { label: r.label }));
      }
      return true;
    }
    case "power": case "shield": case "critical": return opStat(db, s, r, c, out);
    case "no-hit": { if (s.battle) { s.battle.noHit = true; say("log.noHitEffect"); } return true; }
    case "choose": {
      // จำผลที่เลือกไว้ ผลนั้นอาจถามต่อ (เช่น CC ต้องเลือกใบดาเมจ) แล้วกลับมาที่รหัสนี้อีกรอบ
      if (r.local.pick === undefined) {
        if (!r.answer?.option) return ask(r, { kind: "option", prompt: msg("choice.effect"), options: c.pos });
        r.local.pick = r.answer.option;
        r.answer = undefined;
      }
      return runOp(db, s, r, String(r.local.pick), out);
    }
    case "hollow": {
      if (c.pos[0] === "called") {
        for (const u of r.called) { const i = locate(s, u); if (i?.zone === "circle") i.inst.hollowed = true; }
        return true;
      }
      const at = src();
      if (at?.zone !== "circle") return true;
      if (!r.confirmed && !r.answer?.option) return ask(r, { kind: "yesno", prompt: msg("choice.hollow", { card: name(db, at.inst) }) });
      if (r.confirmed || r.answer?.option === "yes") { at.inst.hollowed = true; say("log.hollow", { card: name(db, at.inst) }, r.uid); }
      return true;
    }
    case "grant": {
      const m = c.pos[0].match(/^AUTO(?:-(\w+))?\[(.*) → (.*)\]$/);
      if (!m) return true;
      const ab: Ability = { kind: "AUTO", zone: m[1], timing: m[2], effect: [m[3]] };
      const targets = c.pos[1] === "called" ? r.called : [r.uid];
      for (const u of targets) { const i = locate(s, u); if (i?.zone === "circle") (i.inst.grants ??= []).push(ab); }
      say("log.grant", { n: targets.length });
      return true;
    }
    case "return-to-deck": {
      const at = src();
      if (at) { pull(s, r.uid); ps.deck.push(reset(at.inst, false)); [ps.deck, s.rngState] = shuffle(ps.deck, s.rngState); say("log.returnToDeck", { card: name(db, at.inst) }, r.uid); }
      return true;
    }
    case "swap": {
      const sc = circleOf(s, p, r.uid);
      if (!sc || sc === "vc") return true;
      const opts = rcUnits(s, p).filter((u) => u.uid !== r.uid);
      if (!opts.length) return true;
      if (!r.answer?.uids) return askCards(r, msg("choice.swap"), opts, 0, 1);
      const u = r.answer.uids[0];
      if (u) { const oc = circleOf(s, p, u)!; const a = ps.circles[sc]!, b = ps.circles[oc]!; ps.circles[sc] = b; ps.circles[oc] = a; say("log.swap"); }
      return true;
    }
    default:
      say("log.unsupported", { name: c.name, op });
      return true;
  }
}

function opCall(db: CardDB, s: GameState, r: Resolving, c: Code, out: Out): boolean {
  const [src, dst] = c.pos[0].split("→");
  const p = r.owner, ps = s.players[p];
  if (src === "G" || !evalIf(db, s, r, c.named.if)) return true;

  if (src === "self") {   // ผู้เริ่มต้น: คอลตัวเองจากโซล
    const at = locate(s, r.uid);
    if (at?.zone !== "soul") return true;
    if (!r.answer) return ask(r, { kind: "circle", prompt: msg("choice.callSelf", { card: name(db, at.inst) }), side: p, options: RC });
    if (r.answer.to) { pull(s, r.uid); placeOnRC(db, s, p, at.inst, r.answer.to, "soul", out); }
    return true;
  }

  let min = 1, max = 1;
  const upTo = c.pos.find((x) => x.startsWith("n≤"));
  if (c.named.n) min = max = num(c.named.n);
  if (upTo) { min = 0; const e = upTo.slice(2); max = e === "G-faceup+1" ? ps.gZone.filter((g) => g.faceUp).length + 1 : num(e); }
  const flt = c.named.filter ?? "";
  const pool = () => [...(src.includes("hand") ? ps.hand : []), ...(src.includes("drop") ? ps.drop : [])]
    .filter((i) => !isG(db[i.key]) && !r.called.includes(i.uid) && matchFilter(db, s, r, i, flt));

  if (dst === "GC") {
    if (!r.answer?.uids) {
      const opts = pool();
      if (!opts.length) return true;
      return askCards(r, msg("choice.callToGC", { n: max }), opts, 0, max);
    }
    const uids = r.answer.uids;
    if (flt.includes("different-grades") && new Set(uids.map((u) => db[locate(s, u)!.inst.key].grade)).size !== uids.length) {
      throw new RuleError("err.differentGrades");
    }
    for (const u of uids) {
      const { inst } = pull(s, u);
      ps.guardian.push(reset(inst));
      ev(out, "call", p, msg("log.callGC", { card: name(db, inst) }), u);
      emit(db, s, { kind: "enter", player: p, uid: u, zone: "GC", from: "drop" });
    }
    return true;
  }

  for (;;) {
    const count = Number(r.local.count ?? 0);
    if (count >= max) return true;
    if (!r.local.card) {
      if (r.answer?.uids) {
        const picked = r.answer.uids[0];
        r.answer = undefined;
        if (!picked) return true;
        r.local.card = picked;
      } else {
        const opts = pool();
        if (!opts.length) return true;
        return askCards(r, msg("choice.callPick", { i: count + 1, max }), opts, count < min ? 1 : 0, 1);
      }
    }
    const circles = circleOptions(s, r, c.named.to);
    if (!circles.length) { r.local.card = undefined; return true; }
    if (!r.answer?.to) {
      if (r.answer) { r.local.card = undefined; return true; }   // ไม่เลือกช่อง = ไม่คอลต่อ
      const inst = locate(s, String(r.local.card))!.inst;
      return ask(r, { kind: "circle", prompt: msg("choice.callCircle", { card: name(db, inst) }), side: p, options: circles });
    }
    const to = r.answer.to;
    r.answer = undefined;
    const { inst, zone } = pull(s, String(r.local.card));
    placeOnRC(db, s, p, inst, to, zone, out);
    r.called.push(inst.uid);
    r.usedCircles.push(to);
    r.local.card = undefined;
    r.local.count = count + 1;
  }
}

// เช่น Power+5000 (ค่าไม่ใส่จุลภาค ตามรูปแบบบนการ์ด)
const statMsg = (stat: "power" | "shield" | "critical", value: number): Msg => msg(`stat.${stat}`, { v: `${value > 0 ? "+" : ""}${value}` });

function opStat(db: CardDB, s: GameState, r: Resolving, c: Code, out: Out): boolean {
  if (!evalIf(db, s, r, c.named.if)) return true;
  const p = r.owner, ps = s.players[p];
  const stat = c.name as "power" | "shield" | "critical";
  const until = (c.named.until ?? "turn-end") as "battle-end" | "turn-end";
  const m = c.pos[0].match(/^([+-]\d+)(?: per (\d+) drop)?$/);
  if (!m) return true;
  const value = m[2] ? Math.floor(ps.drop.length / +m[2]) * +m[1] : +m[1];
  const target = c.pos[1];
  let uids: string[] = [];
  if (target === "self") uids = [r.uid];
  else if (target === "own-VC") uids = ps.circles.vc ? [ps.circles.vc.uid] : [];
  else if (target === "called") uids = r.called;
  else if (target === "other-own" || target === "own-units") {
    const limit = target === "own-units"
      ? ps.drop.filter((i) => db[i.key].name.includes(quoted(c.named.n ?? ""))).length
      : num(c.pos[2] ?? "n≤1");
    const opts = fieldUnits(ps).filter((u) => target === "own-units" || u.uid !== r.uid);
    if (!limit || !opts.length) return true;
    if (!r.answer?.uids) {
      return askCards(r, msg("choice.stat", { bonus: statMsg(stat, value), n: limit }), opts, 0, limit, { stat, value });
    }
    uids = r.answer.uids;
  }
  for (const u of uids) {
    const at = locate(s, u);
    if (!at || (at.zone !== "circle" && at.zone !== "guardian")) continue;
    at.inst.mods.push({ stat, value, source: r.label, until });
    ev(out, stat, p, msg("log.stat", { card: name(db, at.inst), bonus: statMsg(stat, value) }), u);
  }
  return true;
}
