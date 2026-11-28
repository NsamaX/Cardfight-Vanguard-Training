// The ability resolver: catch events → queue the AUTO abilities they trigger → resolve each ability step by step,
// stopping to ask the player midway. What each code means lives in vocab/ (one registry for every code).
import { msg, type Msg } from "../i18n/msg";
import { parseCode } from "./code";
import { RC, other, type CardDB } from "./rules";
import { ev, locate, playerMsg, win, type Out } from "./state";
import type { Ability, CardInstance, Circle, GameState, PlayerId, QueueEntry, Resolving, TriggerEvent } from "./types";
import { canDoCode, canPayCode, delayOf, isPassive, runCode, withoutDelay } from "./vocab";
import { condsHold } from "./vocab/conditions";
import { willLeave } from "./vocab/ops/units";
import { TIMINGS } from "./vocab/timings";
import type { Ctx } from "./vocab/types";

export type ResumeHandlers = Record<string, (db: CardDB, s: GameState, out: Out) => void>;

const label = (db: CardDB, inst: CardInstance, ab: Ability) => `${db[inst.key].name} [${ab.kind}]`;

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

// Is a card at `where` (a circle, "guardian", "hand", ...) in a zone the ability works from ("VC", "RC", "VC/RC", "GC", "hand")?
export function abilityZoneOk(zone: string | undefined, where: string): boolean {
  if (!zone) return true;
  return zone.split("/").some((z) =>
    z === "VC" ? where === "vc" : z === "RC" ? RC.includes(where as Circle) : z === "GC" ? where === "guardian" : z === "hand" ? where === "hand" : z === "G zone" ? where === "gZone" : false);
}

export function condOk(db: CardDB, s: GameState, owner: PlayerId, inst: CardInstance, key: string, ab: Ability, phase: "trigger" | "resolve"): boolean {
  return condsHold({ db, s, owner, source: inst, key }, ab.cond, phase);
}

// ---------- Catch events → queue ----------

// Send an event, then check right away which AUTO abilities trigger (using card positions at the moment the event happened)
export function emit(db: CardDB, s: GameState, e: TriggerEvent) {
  s.events.push(e);
  collectTriggers(db, s);
}

function triggers(db: CardDB, ab: Ability, e: TriggerEvent, uid: string, owner: PlayerId): boolean {
  if (ab.kind !== "AUTO" || !ab.timing) return false;
  const c = parseCode(ab.timing);
  return !!TIMINGS[c.name]?.matches(e, c, uid, owner, db);
}

function collectTriggers(db: CardDB, s: GameState) {
  for (const e of s.events.splice(0)) {
    for (const p of [s.turnPlayer, other(s.turnPlayer)]) {
      const ps = s.players[p];
      const cands: { inst: CardInstance; where: string; grants: Ability[] }[] = [];
      for (const [c, inst] of Object.entries(ps.circles)) if (inst) cands.push({ inst, where: c, grants: inst.grants ?? [] });
      for (const g of ps.guardian) cands.push({ inst: g, where: "guardian", grants: g.grants ?? [] });
      // The card the event is about may have just left the board: it can still trigger its own ability (with the grants it had)
      const selfUid = "uid" in e && e.player === p ? e.uid : undefined;
      if (selfUid) {
        const at = locate(s, selfUid);
        const captured = e.kind === "move" ? e.grants : [];
        const known = cands.find((c) => c.inst.uid === selfUid);
        if (known) known.grants = [...known.grants, ...captured];
        else if (at) cands.push({ inst: at.inst, where: at.zone, grants: captured });
      }
      for (const { inst, where, grants } of cands) {
        for (const [key, ab] of abilitiesOf(db, inst, grants)) {
          if (!triggers(db, ab, e, inst.uid, p)) continue;
          if (inst.uid !== selfUid && !abilityZoneOk(ab.zone, where)) continue;
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

// ---------- Delayed steps ("at the end of that battle / turn, ...") ----------

// Queue the ability parts waiting for this moment; they resolve like forced AUTO abilities
export function releaseDelayed(s: GameState, at: "battle-end" | "turn-end") {
  const now = (s.delayed ?? []).filter((d) => d.at === at);
  if (!now.length) return;
  s.delayed = s.delayed!.filter((d) => d.at !== at);
  s.queue.push(...now.map((d) => d.entry));
}

// A step with at=…: it and the steps after it wait for that moment, keeping what the earlier steps did
function delay(db: CardDB, s: GameState, r: Resolving, out: Out) {
  const op = r.ops[r.i], at = delayOf(op)!;
  const effect = [withoutDelay(op), ...r.ops.slice(r.i + 1)];
  const entry: QueueEntry = { owner: r.owner, uid: r.uid, key: r.key, ability: { kind: "AUTO", effect }, event: r.event, label: r.label, optional: false, carry: { done: r.done, at } };
  (s.delayed ??= []).push({ at, entry });
  if (at === "turn-end") {
    for (const u of willLeave(stepCtx(db, s, r, out), effect[0])) { const l = locate(s, u); if (l) l.inst.leaving = true; }
  }
}

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
      } else if (mine.length > 1 && !sameAbility(mine)) { s.ordering = p; return; }   // wait for the owner to choose which one / which order
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

// The same ability of the same card waiting several times (e.g. several cards put into the soul at once): no order to choose
const sameAbility = (q: QueueEntry[]) => q.every((e) => e.uid === q[0].uid && e.key === q[0].key && !e.optional);

export function declineEntry(s: GameState, entry: QueueEntry, out: Out) {
  s.queue.splice(s.queue.indexOf(entry), 1);
  ev(out, "skip", entry.owner, msg("log.skip", { label: entry.label }), entry.uid);
}

const toResolving = (entry: QueueEntry, activated: boolean): Resolving => ({
  ...entry, ops: [...(entry.ability.cost ?? []), ...entry.ability.effect].filter((o) => !isPassive(o)),
  i: 0, asked: activated || !(entry.ability.cost?.length), confirmed: activated, local: {},
  done: Object.fromEntries(Object.entries(entry.carry?.done ?? {}).map(([k, v]) => [k, [...v]])), usedCircles: [],
});

function stepCtx(db: CardDB, s: GameState, r: Resolving, out: Out): Omit<Ctx, "c"> {
  return { db, s, owner: r.owner, source: locate(s, r.uid)?.inst, key: r.key, r, out };
}

// Why a queued ability can't resolve right now (undefined = it can)
export function blocked(db: CardDB, s: GameState, entry: QueueEntry): Msg | undefined {
  if (entry.carry) return undefined;   // a delayed part: its conditions were checked when the ability first resolved
  const at = locate(s, entry.uid);
  // The old vanguard's "when it strides" ability can still resolve even though it's now the heart
  const asHeart = at?.zone === "heart" && entry.event?.kind === "stride";
  const where = at?.zone === "circle" ? at.circle! : asHeart ? "vc" : at?.zone ?? "";
  const self = entry.event && "uid" in entry.event && entry.event.uid === entry.uid;
  if (!at || (!self && !abilityZoneOk(entry.ability.zone, where)) || !condOk(db, s, entry.owner, at.inst, entry.key, entry.ability, "resolve")) return msg("reason.condUnmet");
  const ctx = stepCtx(db, s, toResolving(entry, false), []);
  if (!(entry.ability.cost ?? []).every((code) => canPayCode(ctx, code))) return msg("reason.cannotPay");
  // A "you may" with no cost whose first step has nothing to work on (e.g. no card to choose): nothing to decide
  const first = entry.ability.effect[0];
  if (entry.optional && !entry.ability.cost?.length && first && !canDoCode(ctx, first)) return msg("reason.nothingToDo");
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
    if (!r.answer) { r.choice = { kind: "yesno", prompt: msg("q.useCost", { label: r.label, cost: r.ability.cost!.join(", ") }) }; return false; }
    const yes = r.answer.option === "yes";
    r.answer = undefined;
    r.asked = true;
    if (!yes) { ev(out, "skip", r.owner, msg("log.skip", { label: r.label }), r.uid); s.resolving = undefined; return true; }
    markUsed(s, r);
  }
  while (r.i < r.ops.length) {
    if (delayOf(r.ops[r.i])) { delay(db, s, r, out); break; }
    if (!runCode(stepCtx(db, s, r, out), r.ops[r.i])) return false;
    r.i++;
    r.local = {};
    r.answer = undefined;
    if (s.winner) break;
  }
  s.resolving = undefined;
  return true;
}
