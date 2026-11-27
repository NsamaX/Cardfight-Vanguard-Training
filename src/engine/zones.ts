// Moving cards between zones. Every move goes through here and sends one kind of event, { kind: "move", from, to, by, as },
// so a timing like "when this card is put into the drop zone from your soul" is only a filter on that event (vocab/timings.ts).
import { msg, type Msg } from "../i18n/msg";
import { emit } from "./abilities";
import { circleMsg, type CardDB } from "./rules";
import { ev, locate, name, playerMsg, pull, reset, takeFrom, type Out } from "./state";
import type { Ability, CardInstance, Circle, GameState, MoveEvent, PlayerId, Zone } from "./types";

// The zone a located card is in, as move events name it
export function zoneOf(at: NonNullable<ReturnType<typeof locate>>): Zone {
  if (at.zone === "circle") return at.circle === "vc" ? "VC" : "RC";
  if (at.zone === "heart") return "VC";
  if (at.zone === "gZone") return "G";
  if (at.zone === "guardian") return "GC";
  return at.zone;
}

export function moved(db: CardDB, s: GameState, e: Omit<MoveEvent, "kind" | "grants"> & { grants?: Ability[] }) {
  emit(db, s, { kind: "move", grants: [], ...e });
}

type Pile = Exclude<Zone, "VC" | "RC">;
const PILE: Record<Pile, keyof Pick<GameState["players"]["me"], "hand" | "deck" | "drop" | "soul" | "damage" | "bind" | "gZone" | "guardian" | "removed">> = {
  hand: "hand", deck: "deck", drop: "drop", soul: "soul", damage: "damage", bind: "bind", G: "gZone", GC: "guardian", removed: "removed",
};

// Move a card to a pile of its owner (not onto a circle, see placeOnRC); top = the top of the deck instead of the bottom
export function moveCard(db: CardDB, s: GameState, uid: string, to: Pile, opts: { top?: boolean; by?: MoveEvent["by"]; as?: MoveEvent["as"] } = {}): CardInstance {
  const at = locate(s, uid);
  if (!at) throw new Error("card not found");
  const from = zoneOf(at), grants = at.inst.grants ?? [];
  pull(s, uid);
  const inst = reset(at.inst, to !== "deck");
  const list = s.players[at.player][PILE[to]];
  if (to === "deck" && opts.top) list.unshift(inst); else list.push(inst);
  moved(db, s, { player: at.player, uid, key: inst.key, from, to, by: opts.by, as: opts.as, grants });
  return inst;
}

// A rear-guard leaves the board for the drop zone (retire)
export function retireUnit(db: CardDB, s: GameState, p: PlayerId, c: Circle, out: Out, why: Msg, by: "retire" | "hollow" = "retire") {
  const inst = s.players[p].circles[c];
  if (!inst) return;
  ev(out, "retired", p, msg("log.retired", { card: name(db, inst), why }), inst.uid);
  moveCard(db, s, inst.uid, "drop", { by });
}

// Place a unit on RC; if a unit is already there, the old unit is retired. from: the zone it came from
export function placeOnRC(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance, c: Circle, from: Zone, out: Out) {
  if (s.players[p].circles[c]) retireUnit(db, s, p, c, out, msg("reason.overCall"));
  s.players[p].circles[c] = reset(inst);
  ev(out, "call", p, msg("log.call", { player: playerMsg(p), card: name(db, inst), circle: circleMsg(c) }), inst.uid);
  moved(db, s, { player: p, uid: inst.uid, key: inst.key, from, to: "RC" });
}

// Stride a G unit from the G zone onto VC: the vanguard becomes its heart (the stride step, or an effect such as Sebreeze's)
export function strideOnto(db: CardDB, s: GameState, p: PlayerId, gUid: string, out: Out) {
  const ps = s.players[p];
  const g = takeFrom(ps.gZone, gUid, "G zone");
  const heart = ps.circles.vc!;
  // The old vanguard's (about to become the heart) AUTO (VC) "when your G unit strides" must be checked while it's still on VC
  emit(db, s, { kind: "stride", player: p, uid: g.uid, key: g.key });
  g.faceUp = true;
  g.rested = heart.rested;
  ps.heart = heart;
  ps.circles.vc = g;
  ev(out, "stride", p, msg("log.stride", { player: playerMsg(p), card: name(db, g), heart: name(db, heart) }), g.uid);
  moved(db, s, { player: p, uid: g.uid, key: g.key, from: "G", to: "VC" });
}

// Take a card out of its zone to put it on a circle, returning the zone it came from
export function takeForCircle(s: GameState, uid: string): { inst: CardInstance; from: Zone } {
  const at = locate(s, uid);
  if (!at) throw new Error("card not found");
  const from = zoneOf(at);
  pull(s, uid);
  return { inst: at.inst, from };
}
