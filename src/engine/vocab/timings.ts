// Timings: which game event an AUTO ability waits for, e.g. enter(RC, self, from=hand) or to-drop(self, from=soul).
// Card moves are one event (MoveEvent: from, to, by, as); enter / to-drop / to-soul / retired / discarded are names for common moves,
// and move(who, from=…, to=…) covers any other.
import { quoted, type Code } from "../code";
import type { CardDB } from "../rules";
import type { MoveEvent, PlayerId, TriggerEvent } from "../types";
import { cardMatches } from "./filters";
import type { TimingSpec } from "./types";

const side = (target: string | undefined, e: { target: string }) => !target || target === (e.target === "vc" ? "VC" : "RC");

// Whose card moved: self (this card), own (any of ours), other-own (ours but not this one), opp (the opponent's)
function whose(who: string | undefined, e: MoveEvent, uid: string, owner: PlayerId): boolean {
  if (who === "self") return e.uid === uid;
  if (who === "own") return e.player === owner;
  if (who === "other-own") return e.player === owner && e.uid !== uid;
  if (who === "opp") return e.player !== owner;
  return false;
}

// A move matching the code's from= / by= / as= / filter= (each only checked when given)
function moveOk(e: TriggerEvent, c: Code, db: CardDB): e is MoveEvent {
  if (e.kind !== "move") return false;
  const n = c.named;
  if (n.from && n.from !== e.from) return false;
  if (n.by && n.by !== e.by) return false;
  if (n.as && n.as !== e.as) return false;
  return !n.filter || cardMatches(db[e.key], n.filter, { db });
}

export const TIMINGS: Record<string, TimingSpec> = {
  enter: {
    forms: ["enter(RC, self)", "enter(VC, self)", "enter(GC, self)", "enter(RC, self, from=hand)", "enter(RC, other-own, from=drop)"],
    text: "A card is placed on a circle (from= where it came from)",
    matches: (e, c, uid, owner, db) => moveOk(e, c, db) && e.to === c.pos[0] && whose(c.pos[1], e, uid, owner),
  },
  move: {
    forms: ["move(self, from=hand, to=drop)", "move(own, from=deck, to=drop)", "move(opp, from=RC, to=drop)", "move(own, to=bind, filter={filter})",
      "move(own, from=deck, to=hand, by=draw)", "move(own, to=hand, by=drive-check)", "move(own, to=damage, by=damage-check)", "move(own, from=damage, to=drop, by=heal)"],
    text: "A card moves between zones (who: self / own / other-own / opp; from= and to= a zone: hand, deck, drop, soul, damage, bind, G, VC, RC, GC; by= retire, hollow, draw, drive-check, damage-check, or heal)",
    matches: (e, c, uid, owner, db) => moveOk(e, c, db) && (!c.named.to || c.named.to === e.to) && whose(c.pos[0], e, uid, owner),
  },
  stride: {
    forms: ["stride(own)", 'stride(own, filter=name("$"))'], text: "We stride a G unit (filter on its original card name)",
    matches: (e, c, _u, owner, db) => e.kind === "stride" && e.player === owner && (!c.named.filter || db[e.key].name.includes(quoted(c.named.filter))),
  },
  "attack-hit": {
    forms: ["attack-hit(self)", "attack-hit(self, target=VC)"], text: "This unit's attack hits (target= VC or RC)",
    matches: (e, c, uid) => e.kind === "attack-hit" && e.uid === uid && side(c.named.target, e),
  },
  "to-soul": {
    forms: ["to-soul(own)"], text: "A card is put into our soul (once per card)",
    matches: (e, c, uid, owner, db) => moveOk(e, c, db) && e.to === "soul" && e.from !== "soul" && whose(c.pos[0], e, uid, owner),
  },
  "turn-end": { forms: ["turn-end"], text: "The end of the turn", matches: (e) => e.kind === "turn-end" },
  "ridden-upon": { forms: ["ridden-upon(self)"], text: "This vanguard is ridden upon", matches: (e, _c, uid) => e.kind === "ridden-upon" && e.uid === uid },
  attack: {
    forms: ["attack(self)", "attack(self, target=VC)", "attack(own-VC)"], text: "This unit (or our vanguard) attacks",
    matches: (e, c, uid, owner) => e.kind === "attack" && (c.pos[0] === "own-VC" ? e.player === owner && e.circle === "vc" : e.uid === uid && side(c.named.target, e)),
  },
  "battle-end": {
    forms: ["battle-end(self, did=attack)", "battle-end(self, did=attack-VC)", "battle-end(self, did=boost-RC)"],
    text: "The end of a battle in which this unit attacked (a vanguard) or boosted a rear-guard",
    matches: (e, c, uid) => e.kind === "battle-end" && (
      c.named.did === "attack-VC" ? e.attackerUid === uid && e.target === "vc"
        : c.named.did === "attack" ? e.attackerUid === uid
          : c.named.did === "boost-RC" ? e.boosterUid === uid && e.attackerCircle !== "vc" : false),
  },
  "to-drop": {
    forms: ["to-drop(self, from=soul)", "to-drop(self, from=RC, by=hollow)", "to-drop(own, from=RC)"], text: "A card is put into the drop zone (from=, by= how)",
    matches: (e, c, uid, owner, db) => moveOk(e, c, db) && e.to === "drop" && whose(c.pos[0], e, uid, owner),
  },
  retired: {
    forms: ["retired(self, from=RC)", "retired(own)"], text: "A unit is retired (by an effect, a cost, the rules, or Hollow)",
    matches: (e, c, uid, owner, db) => moveOk(e, c, db) && e.to === "drop" && (e.by === "retire" || e.by === "hollow") && whose(c.pos[0], e, uid, owner),
  },
  discarded: {
    forms: ["discarded(self, from=hand, as=g-guardian-cost)", "discarded(self)"], text: "This card is discarded from hand (as= for which cost)",
    matches: (e, c, uid, owner, db) => moveOk(e, c, db) && e.from === "hand" && e.to === "drop" && whose(c.pos[0], e, uid, owner),
  },
  "phase-start": { forms: ["phase-start(battle)"], text: "Our battle phase starts", matches: (e, c, _u, owner) => e.kind === "phase-start" && e.player === owner && e.phase === c.pos[0] },
  // STRIDE / G GUARDIAN abilities: the rules (game.ts) use them in their step, they never trigger as AUTO
  step: { forms: ["step(stride, own)", "step(guard, opp)"], text: "Used in this step by the rules (STRIDE, G GUARDIAN)", matches: () => false },
};
