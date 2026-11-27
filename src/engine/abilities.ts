// Card ability system: catch events → check timing queue → resolve code by code, can stop to ask the player midway
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
// Codes the engine handles itself or that have no in-game effect
const SKIP_OPS = /^(keyword|all-clan)\(|^retire\(self, at=turn-end/;

// An ACT by index: printed abilities first, then granted ones (key "g<n>", same as granted AUTO)
export function actAt(db: CardDB, inst: CardInstance, index: number): { key: string; ab?: Ability } {
  const printed = db[inst.key].abilities;
  return index < printed.length ? { key: String(index), ab: printed[index] } : { key: "g" + (index - printed.length), ab: inst.grants?.[index - printed.length] };
}

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

function matches(db: CardDB, timing: string, e: TriggerEvent, uid: string, owner: PlayerId): boolean {
  const c = parseCode(timing);
  const [a0, a1] = c.pos;
  const n = c.named;
  switch (c.name) {
    case "enter":
      return e.kind === "enter" && e.zone === a0 && (!n.from || n.from === e.from)
        && (a1 === "self" ? e.uid === uid : a1 === "other-own" ? e.player === owner && e.uid !== uid : false);
    case "stride": return e.kind === "stride" && e.player === owner && (!n.filter || db[e.key].name.includes(quoted(n.filter)));
    case "attack-hit": return e.kind === "attack-hit" && e.uid === uid && (!n.target || n.target === (e.target === "vc" ? "VC" : "RC"));
    case "to-soul": return e.kind === "to-soul" && a0 === "own" && e.player === owner;
    case "turn-end": return e.kind === "turn-end";
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
      return e.kind === c.name && (a0 === "own" ? e.player === owner : e.uid === uid) && (!n.by || n.by === e.by) && (!n.from || n.from === e.from);
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
      else if (t.startsWith("heart-name(")) { const h = s.players[owner].heart; if (!h || !db[h.key].name.includes(quoted(t))) return false; }
      else if ((m = t.match(/^vc-grade≥(\d+)$/))) { if (vcInfo(db, s, owner).grade < +m[1]) return false; }
      else if ((m = t.match(/^vc-clan\((.+)\)$/))) { if (vcInfo(db, s, owner).clan !== m[1]) return false; }
    }
  }
  return true;
}

// ---------- Catch events → queue ----------

// Send an event, then check right away which AUTO abilities trigger (using card positions at the moment the event happened)
export function emit(db: CardDB, s: GameState, e: TriggerEvent) {
  s.events.push(e);
  collectTriggers(db, s);
}

// A rear-guard leaves the board for the drop zone (retire)
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

// Place a unit on RC; if a unit is already there, the old unit is retired
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
          if (!matches(db, ab.timing, e, inst.uid, p)) continue;
          if (!condOk(db, s, p, inst, key, ab, "trigger")) continue;
          s.queue.push({ owner: p, uid: inst.uid, key, ability: ab, event: e, label: label(db, inst, ab), optional: isOptional(ab) });
        }
      }
    }
  }
}

// AUTO abilities the player may decline: marked optional, has a cost, or the first effect is a "may" (starter calling itself, choosing to hollow)
const MAY_FIRST = /^(call\(self→RC\)|hollow\(self\))$/;
export const isOptional = (ab: Ability) => !!ab.optional || !!ab.cost?.length || MAY_FIRST.test(ab.effect[0] ?? "");

// ---------- Main loop ----------

export function settle(db: CardDB, s: GameState, out: Out, resume: ResumeHandlers) {
  for (let guard = 0; guard < 2000; guard++) {
    if (s.winner) return;
    // rule action: a deck with 0 cards loses immediately, no need to wait for the draw
    const empty = [s.turnPlayer, other(s.turnPlayer)].find((q) => s.players[q].deck.length === 0);
    if (empty) { win(s, other(empty), out, msg("win.deckOut", { player: playerMsg(empty) })); return; }
    if (s.resolving) { if (!runResolving(db, s, out)) return; continue; }
    if (s.events.length) { collectTriggers(db, s); continue; }
    if (s.battle?.pendingTrigger) return;
    if (s.ordering && !s.queue.some((e) => e.owner === s.ordering)) s.ordering = undefined;
    const p = [s.turnPlayer, other(s.turnPlayer)].find((q) => s.queue.some((e) => e.owner === q));
    if (p) {
      const mine = s.queue.filter((e) => e.owner === p);
      // Only one left but it can't be used: skip it with a reason, so the player doesn't have to press it
      // (With several, don't skip yet, since the chosen order may make it usable, e.g. hollow first, or CC before paying CB)
      if (mine.length === 1 && blocked(db, s, mine[0])) { startResolving(db, s, mine[0], out); continue; }
      if (s.passQueue === p) {
        const skip = mine.find((e) => e.optional);
        if (skip) { declineEntry(s, skip, out); continue; }
      } else if (mine.length > 1) { s.ordering = p; return; }   // wait for the owner to choose which one / which order
      else if (mine[0].optional || s.ordering === p) return;
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

// Why a queued ability can't resolve right now (undefined = it can)
export function blocked(db: CardDB, s: GameState, entry: QueueEntry): Msg | undefined {
  const at = locate(s, entry.uid);
  // The old vanguard's "when it strides" ability can still resolve even though it's now the heart
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
  if (entry.ability.cond?.includes("1/turn")) {
    const same = s.queue.filter((e) => e.owner === entry.owner && e.uid === entry.uid && e.key === entry.key);
    if (same.length) r.thatCards = [entry, ...same].map((e) => eventUid(e.event)).filter((u): u is string => !!u);
  }
  s.resolving = r;
  ev(out, "ability", entry.owner, msg("log.abilityStart", { label: entry.label }), entry.uid);
  if (r.asked) markUsed(s, r);
}

const eventUid = (e?: QueueEntry["event"]) => (e && "uid" in e ? e.uid : undefined);
const thatCards = (r: Resolving) => r.thatCards ?? [eventUid(r.event)].filter((u): u is string => !!u);

// Once a 1/turn ability is used, the same ability's other triggers waiting in the queue can't resolve this turn: drop them
// (their cards were already offered as "that card")
function markUsed(s: GameState, r: Resolving) {
  if (!r.ability.cond?.includes("1/turn")) return;
  locate(s, r.uid)?.inst.usedThisTurn.push(r.key);
  s.queue = s.queue.filter((e) => !(e.owner === r.owner && e.uid === r.uid && e.key === r.key));
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

// bonus: what the chosen unit will get (the screen shows it in advance when choosing on the board)
const askCards = (r: Resolving, prompt: Msg, options: CardInstance[], min: number, max: number, bonus?: { stat: "power" | "shield" | "critical"; value: number }) =>
  ask(r, { kind: "cards", prompt, options: options.map((i) => i.uid), min, max, bonus });

// ---------- Filters and conditions ----------

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
    else if (t === "that-card") { if (!thatCards(r).includes(inst.uid)) return false; }
    else if (t === "different-grades" || t === "same-grade" || t === "grade-sum≥3") { /* checked when choosing */ }
    else if (card.clan !== t) return false;          // clan name, e.g. Granblue
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
  if ((m = expr.match(/^souled≥(\d+)$/))) return (r.souled?.length ?? 0) >= +m[1];
  if ((m = expr.match(/^returned≥(\d+)$/))) return (r.returned ?? 0) >= +m[1];
  if ((m = expr.match(/^G-faceup(?:\((.+)\))?≥(\d+)$/))) {
    const flt = m[1] ?? "";
    return s.players[r.owner].gZone.filter((g) => g.faceUp && matchFilter(db, s, r, g, flt)).length >= +m[2];
  }
  if (expr.startsWith("souled-name(")) return (r.souled ?? []).some((n) => n.includes(quoted(expr)));
  return false;   // a condition the engine can't check yet: skip the effect rather than give it for free
}

const frontRow = (ps: GameState["players"][PlayerId]) => (["vc", "front_left", "front_right"] as const).map((c) => ps.circles[c]).filter((i): i is CardInstance => !!i);
const rcUnits = (s: GameState, p: PlayerId) => RC.map((c) => s.players[p].circles[c]).filter((i): i is CardInstance => !!i);

function canPay(db: CardDB, s: GameState, r: Resolving): boolean {
  const ps = s.players[r.owner];
  const src = locate(s, r.uid);
  for (const code of r.ability.cost ?? []) {
    const c = parseCode(code);
    const n = num(c.pos[0]);
    switch (c.name) {
      case "CB": if (ps.damage.filter((d) => d.faceUp).length < n) return false; break;
      case "SB": if (ps.soul.filter((i) => matchFilter(db, s, r, i, c.named.filter ?? "")).length < n) return false; break;
      case "mill": if (ps.deck.length < n) return false; break;
      case "discard": case "reveal": if (!ps.hand.some((h) => matchFilter(db, s, r, h, c.named.filter ?? ""))) return false; break;
      case "retire-own": if (rcUnits(s, r.owner).filter((u) => u.uid !== r.uid).length < n) return false; break;
      case "soul-in": if (src?.zone !== "circle") return false; break;
      case "bind": if (c.pos[0] !== "self" && !ps.drop.some((d) => d.uid !== r.uid && db[d.key].trigger === "heal")) return false; break;
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

// ---------- Each code (returns true = done, false = waiting for an answer) ----------

function runOp(db: CardDB, s: GameState, r: Resolving, op: string, out: Out): boolean {
  const c: Code = parseCode(op);
  const p = r.owner, ps = s.players[p], opp = other(p);
  const src = () => locate(s, r.uid);
  const say = (key: MsgKey, params?: Record<string, string | number | Msg>, uid?: string) => ev(out, c.name, p, msg(key, params), uid);

  switch (c.name) {
    case "CB": { const n = flipDamage(s, p, num(c.pos[0]), false); say("log.cb", { n }); return true; }
    case "CC": {
      if (!evalIf(db, s, r, c.named.if)) return true;
      // More face-down damage than can be flipped: let the player choose which
      const down = ps.damage.filter((d) => !d.faceUp), n = Math.min(num(c.pos[0]), down.length);
      if (down.length > n && !r.answer?.uids) return askCards(r, msg("choice.cc", { n }), down, n, n);
      const picked = down.length > n ? down.filter((d) => r.answer!.uids!.includes(d.uid)) : down;
      for (const d of picked) d.faceUp = true;
      say("log.cc", { n: picked.length }); return true;
    }
    case "damage-facedown": { flipDamage(s, p, num(c.pos[0]), false); say("log.damageFacedown"); return true; }
    case "SB": {
      const n = num(c.pos[0]);
      const opts = ps.soul.filter((i) => matchFilter(db, s, r, i, c.named.filter ?? ""));
      if (opts.length > n && !r.answer?.uids) return askCards(r, msg("choice.soulBlast", { n }), opts, n, n);
      const picked = opts.length > n ? r.answer!.uids!.map((u) => ps.soul.find((i) => i.uid === u)!) : opts;
      say("log.sb", { n: picked.length });
      for (const inst of picked) {
        pull(s, inst.uid);
        ps.drop.push(reset(inst));
        emit(db, s, { kind: "to-drop", player: p, uid: inst.uid, from: "soul", grants: [] });
      }
      return true;
    }
    case "SC": {
      for (let i = 0; i < num(c.pos[0]) && ps.deck.length; i++) ps.soul.push(reset(ps.deck.shift()!));
      if (num(c.pos[0])) emit(db, s, { kind: "to-soul", player: p });
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
    case "reveal": {
      const opts = ps.hand.filter((h) => matchFilter(db, s, r, h, c.named.filter ?? ""));
      const n = Math.min(num(c.pos[0]), opts.length);
      if (!n) return true;
      if (!r.answer?.uids) return askCards(r, msg("choice.reveal", { n }), opts, n, n);
      for (const u of r.answer.uids) say("log.reveal", { card: name(db, locate(s, u)!.inst) }, u);
      return true;
    }
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
      if (at?.zone === "circle") { pull(s, r.uid); ps.soul.push(reset(at.inst)); say("log.soulIn", { card: name(db, at.inst) }, r.uid); emit(db, s, { kind: "to-soul", player: p }); }
      return true;
    }
    case "bind": {
      if (!r.local.selfDone) {
        const at = src();
        if (at && at.zone !== "bind") { pull(s, r.uid); ps.bind.push(reset(at.inst)); say("log.bind", { card: name(db, at.inst) }, r.uid); }
        r.local.selfDone = 1;
      }
      if (c.pos[0] === "self") return true;
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
      // Moved to the end so the face-up cards stay in the order they were used (shown that way next to the G zone)
      const g = ps.gZone.splice(ps.gZone.findIndex((x) => x.uid === r.answer!.uids![0]), 1)[0];
      g.faceUp = true;
      ps.gZone.push(g);
      say("log.flipG", { card: name(db, g) }, g.uid);
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
      // Reveal the hand, look at the top 5 of the deck, add 1 unit of the wanted grade to hand, then shuffle; if you guard, remove 2 hand cards from the game
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
      // Remember the chosen effect; it may ask further (e.g. CC must choose a damage card), then come back to this code again
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
      if (!evalIf(db, s, r, c.named.if)) return true;
      const m = c.pos[0].match(/^(AUTO|ACT)(?:-([\w/]+))?\[(.*) → (.*)\]$/);
      if (!m) return true;
      // AUTO[timing → effect] / ACT[cost & cost → effect & effect]
      const ab: Ability = m[1] === "AUTO"
        ? { kind: "AUTO", zone: m[2], timing: m[3], effect: [m[4]] }
        : { kind: "ACT", zone: m[2], cost: splitTop(m[3], "&"), effect: splitTop(m[4], "&") };
      const who = c.pos[1] ?? "self";
      let targets = who === "called" ? r.called : who === "own-VC" ? [ps.circles.vc?.uid].filter((u): u is string => !!u) : [r.uid];
      if (who.startsWith("front-row")) {
        const opts = frontRow(ps).filter((u) => matchFilter(db, s, r, u, c.named.filter ?? ""));
        if (!opts.length) return true;
        if (!r.answer?.uids) return askCards(r, msg("choice.grant", { n: Math.min(num(who), opts.length) }), opts, 0, Math.min(num(who), opts.length));
        targets = r.answer.uids;
      }
      for (const u of targets) { const i = locate(s, u); if (i?.zone === "circle") (i.inst.grants ??= []).push(ab); }
      say("log.grant", { n: targets.length });
      return true;
    }
    case "to-soul": return opToSoul(db, s, r, c, out);
    case "to-deck": return opToDeck(db, s, r, c, out);
    case "to-deck-top": {
      const at = src();
      if (at?.zone === "circle") { pull(s, r.uid); ps.deck.unshift(reset(at.inst, false)); say("log.toDeckTop", { card: name(db, at.inst) }, r.uid); }
      return true;
    }
    case "shuffle": {
      [ps.deck, s.rngState] = shuffle(ps.deck, s.rngState);
      say("log.shuffle");
      return true;
    }
    case "drive": {
      // drive(+1, self) / drive(-3, stood): "stood" = the units a stand(…, at=battle-end) just before will stand
      const value = parseInt(c.pos[0], 10);
      if (c.pos[1] === "stood") {
        const later = s.battle?.atEnd?.filter((e) => e.source === r.uid).at(-1);
        if (later) later.drive = value;
        return true;
      }
      const at = src();
      if (at?.zone !== "circle") return true;
      at.inst.mods.push({ stat: "drive", value, source: r.label, until: (c.named.until ?? "turn-end") as "battle-end" | "turn-end" });
      say("log.stat", { card: name(db, at.inst), bonus: msg("stat.drive", { v: c.pos[0] }) }, r.uid);
      return true;
    }
    case "stand": {
      // stand(own, filter=…, at=battle-end): stand our matching units in the close step of this battle (see standAtBattleEnd)
      if (c.named.at === "battle-end") {
        if (s.battle) (s.battle.atEnd ??= []).push({ player: p, source: r.uid, filter: c.named.filter ?? "", drive: 0 });
        return true;
      }
      for (const u of fieldUnits(ps)) if (u.rested && matchFilter(db, s, r, u, c.named.filter ?? "")) { u.rested = false; say("log.stand", { card: name(db, u) }, u.uid); }
      return true;
    }
    case "to-hand": {
      // to-hand(drop, n≤1, filter=…): return cards from the drop zone to hand
      const max = num(c.pos[1] ?? "n≤1");
      const opts = ps.drop.filter((i) => matchFilter(db, s, r, i, c.named.filter ?? ""));
      if (!opts.length) return true;
      if (!r.answer?.uids) return askCards(r, msg("choice.toHand", { n: max }), opts, (c.pos[1] ?? "").startsWith("n≤") ? 0 : Math.min(max, opts.length), Math.min(max, opts.length));
      for (const u of r.answer.uids) { const { inst } = pull(s, u); ps.hand.push(reset(inst)); say("log.toHand", { card: name(db, inst) }, u); }
      return true;
    }
    case "look": return opLook(db, s, r, c, out);
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

// to-deck(drop, all) / to-deck(drop+soul, n=2..3, filter=…): return cards to the deck (shuffle with a separate shuffle(deck));
// filter same-grade = all chosen cards share one grade
function opToDeck(db: CardDB, s: GameState, r: Resolving, c: Code, out: Out): boolean {
  const p = r.owner, ps = s.players[p];
  const from = c.pos[0].split("+");
  const flt = c.named.filter ?? "";
  const pool = [...(from.includes("drop") ? ps.drop : []), ...(from.includes("soul") ? ps.soul : [])].filter((i) => matchFilter(db, s, r, i, flt));
  const amount = c.pos[1] ?? "all";
  let uids: string[];
  if (amount === "all") uids = pool.map((i) => i.uid);
  else {
    const range = amount.match(/^n=(\d+)\.\.(\d+)$/);
    const min = range ? +range[1] : amount.startsWith("n≤") ? 0 : num(amount);
    const max = range ? +range[2] : num(amount);
    if (pool.length < Math.max(min, 1)) return true;
    if (!r.answer?.uids) return askCards(r, msg("choice.toDeck", { n: max }), pool, min, Math.min(max, pool.length));
    uids = r.answer.uids;
    if (flt.includes("same-grade") && new Set(uids.map((u) => db[locate(s, u)!.inst.key].grade)).size > 1) throw new RuleError("err.sameGrade");
  }
  for (const u of uids) {
    const { inst } = pull(s, u);
    ps.deck.push(reset(inst, false));
    ev(out, "to-deck", p, msg("log.returnToDeck", { card: name(db, inst) }), u);
  }
  r.returned = (r.returned ?? 0) + uids.length;
  return true;
}

// Close step: the stands an ability set up for the end of this battle (e.g. Minerva), with their drive change
export function standAtBattleEnd(db: CardDB, s: GameState, out: Out) {
  for (const e of s.battle?.atEnd ?? []) {
    const r = { uid: e.source, owner: e.player } as Resolving;
    for (const u of fieldUnits(s.players[e.player])) {
      if (!matchFilter(db, s, r, u, e.filter)) continue;
      u.rested = false;
      ev(out, "stand", e.player, msg("log.stand", { card: name(db, u) }), u.uid);
      if (e.drive) u.mods.push({ stat: "drive", value: e.drive, source: "stand", until: "turn-end" });
    }
  }
}

// Remember what this ability put into the soul, for later codes of the same ability: "if you put ..." (souled≥n, souled-name) and "for each card put" (per souled)
function noteSouled(db: CardDB, r: Resolving, insts: CardInstance[]) {
  r.souled = [...(r.souled ?? []), ...insts.map((i) => db[i.key].name)];
}

// to-soul(drop, n≤3 | n=1 | all, filter=…): cards from the drop zone into the soul
// to-soul(self, at=battle-end): this unit goes into the soul at the end of the battle
function opToSoul(db: CardDB, s: GameState, r: Resolving, c: Code, out: Out): boolean {
  const p = r.owner, ps = s.players[p];
  const into = (inst: CardInstance) => { ps.soul.push(reset(inst)); ev(out, "to-soul", p, msg("log.soulIn", { card: name(db, inst) }), inst.uid); };
  if (c.pos[0] === "self") {
    const at = locate(s, r.uid);
    if (at?.zone !== "circle") return true;
    if (c.named.at === "battle-end") { at.inst.soulAtBattleEnd = true; return true; }
    into(pull(s, r.uid).inst);
    noteSouled(db, r, [at.inst]);
    emit(db, s, { kind: "to-soul", player: p });
    return true;
  }
  if (c.pos[0] !== "drop") { ev(out, "to-soul", p, msg("log.unsupported", { name: c.name, op: c.name })); return true; }
  const flt = c.named.filter ?? "";
  const pool = ps.drop.filter((i) => matchFilter(db, s, r, i, flt));
  const amount = c.pos[1] ?? "all";
  let uids: string[];
  if (amount === "all") uids = pool.map((i) => i.uid);
  else {
    if (!pool.length) return true;
    const max = Math.min(num(amount), pool.length);
    if (!r.answer?.uids) return askCards(r, msg("choice.toSoul", { n: max }), pool, amount.startsWith("n≤") ? 0 : max, max);
    uids = r.answer.uids;
    if (flt.includes("different-grades") && new Set(uids.map((u) => db[locate(s, u)!.inst.key].grade)).size !== uids.length) {
      throw new RuleError("err.differentGrades");
    }
  }
  const moved = uids.map((u) => pull(s, u).inst);
  moved.forEach(into);
  noteSouled(db, r, moved);
  if (moved.length) emit(db, s, { kind: "to-soul", player: p });
  return true;
}

// look(n, hand=1, soul=1 | soul=n≤1, rest=drop): look at the top n cards, pick some for hand, then for soul; the rest go to the drop zone (unset = stay on top)
function opLook(db: CardDB, s: GameState, r: Resolving, c: Code, out: Out): boolean {
  const p = r.owner, ps = s.players[p];
  if (r.local.looked === undefined) {
    const top = ps.deck.slice(0, num(c.pos[0]));
    if (!top.length) return true;
    r.local.looked = top.map((i) => i.uid).join(",");
    ev(out, "look", p, msg("log.lookTop", { n: top.length }));
  }
  const left = () => String(r.local.looked).split(",").filter((u) => ps.deck.some((d) => d.uid === u)).map((u) => ps.deck.find((d) => d.uid === u)!);
  const steps = (["hand", "soul"] as const).filter((d) => c.named[d] !== undefined);
  for (let i = Number(r.local.lookStep ?? 0); i < steps.length; i = Number(r.local.lookStep)) {
    const dest = steps[i], want = c.named[dest], opts = left();
    const max = Math.min(num(want), opts.length);
    if (max && !r.answer?.uids) return askCards(r, msg(dest === "hand" ? "choice.lookHand" : "choice.lookSoul", { n: max }), opts, want.startsWith("n≤") ? 0 : max, max);
    const picked = (r.answer?.uids ?? []).map((u) => pull(s, u).inst);
    r.answer = undefined;
    r.local.lookStep = i + 1;
    for (const inst of picked) {
      if (dest === "hand") { ps.hand.push(reset(inst)); ev(out, "look", p, msg("log.searchHand", { card: name(db, inst) }), inst.uid); }
      else { ps.soul.push(reset(inst)); ev(out, "to-soul", p, msg("log.soulIn", { card: name(db, inst) }), inst.uid); }
    }
    if (dest === "soul") { noteSouled(db, r, picked); if (picked.length) emit(db, s, { kind: "to-soul", player: p }); }
  }
  if (c.named.rest === "drop") {
    for (const inst of left()) { pull(s, inst.uid); ps.drop.push(reset(inst)); ev(out, "look", p, msg("log.searchDrop", { card: name(db, inst) }), inst.uid); }
  }
  return true;
}

function opCall(db: CardDB, s: GameState, r: Resolving, c: Code, out: Out): boolean {
  const [src, dst] = c.pos[0].split("→");
  const p = r.owner, ps = s.players[p];
  if (src === "G" || !evalIf(db, s, r, c.named.if)) return true;

  if (src === "self") {   // starter: call itself from the soul
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
      if (r.answer) { r.local.card = undefined; return true; }   // no circle chosen = stop calling
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

// e.g. Power+5000 (no thousands separator, as printed on the card)
const statMsg = (stat: "power" | "shield" | "critical", value: number): Msg => msg(`stat.${stat}`, { v: `${value > 0 ? "+" : ""}${value}` });

function opStat(db: CardDB, s: GameState, r: Resolving, c: Code, out: Out): boolean {
  if (!evalIf(db, s, r, c.named.if)) return true;
  const p = r.owner, ps = s.players[p];
  const stat = c.name as "power" | "shield" | "critical";
  const until = (c.named.until ?? "turn-end") as "battle-end" | "turn-end";
  const m = c.pos[0].match(/^([+-]\d+)(?: per (\d+) drop| per (souled))?$/);
  if (!m) return true;
  const per = c.named.per === "returned" ? (r.returned ?? 0) : 1;
  const value = per * (m[3] ? (r.souled?.length ?? 0) * +m[1] : m[2] ? Math.floor(ps.drop.length / +m[2]) * +m[1] : +m[1]);
  if (!value) return true;
  const target = c.pos[1];
  let uids: string[] = [];
  if (target === "self") uids = [r.uid];
  else if (target === "own-VC & self") uids = [ps.circles.vc?.uid, r.uid].filter((u): u is string => !!u);
  else if (target.startsWith("front-row")) {
    const opts = frontRow(ps).filter((u) => matchFilter(db, s, r, u, c.named.filter ?? ""));
    const limit = Math.min(num(target), opts.length);
    if (!limit) return true;
    if (!r.answer?.uids) return askCards(r, msg("choice.stat", { bonus: statMsg(stat, value), n: limit }), opts, 0, limit, { stat, value });
    uids = r.answer.uids;
  }
  else if (target === "own-VC") uids = ps.circles.vc ? [ps.circles.vc.uid] : [];
  else if (target === "called") uids = r.called;
  else if (target === "other-own" || target === "own-units") {
    const limit = target === "own-units"
      ? ps.drop.filter((i) => db[i.key].name.includes(quoted(c.named.n ?? ""))).length
      : num(c.pos[2] ?? "n≤1");
    const opts = fieldUnits(ps).filter((u) => (target === "own-units" || u.uid !== r.uid) && matchFilter(db, s, r, u, c.named.filter ?? ""));
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
