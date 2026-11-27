// Moving units on and off the board with the events abilities listen for (shared by the rules and by ability ops)
import { msg, type Msg } from "../i18n/msg";
import { emit } from "./abilities";
import { circleMsg, type CardDB } from "./rules";
import { ev, name, playerMsg, reset, type Out } from "./state";
import type { CardInstance, Circle, GameState, PlayerId } from "./types";

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
