// Timings: which game event an AUTO ability waits for, e.g. enter(RC, self, from=hand) or to-drop(self, from=soul)
import { quoted } from "../code";
import type { TimingSpec } from "./types";

const side = (target: string | undefined, e: { target: string }) => !target || target === (e.target === "vc" ? "VC" : "RC");

export const TIMINGS: Record<string, TimingSpec> = {
  enter: {
    forms: ["enter(RC, self)", "enter(VC, self)", "enter(GC, self)", "enter(RC, self, from=hand)", "enter(RC, other-own, from=drop)"],
    text: "A card is placed on a circle (from= where it came from)",
    matches: (e, c, uid, owner) => e.kind === "enter" && e.zone === c.pos[0] && (!c.named.from || c.named.from === e.from)
      && (c.pos[1] === "self" ? e.uid === uid : c.pos[1] === "other-own" ? e.player === owner && e.uid !== uid : false),
  },
  stride: {
    forms: ["stride(own)", 'stride(own, filter=name("$"))'], text: "We stride a G unit (filter on its original card name)",
    matches: (e, c, _u, owner, db) => e.kind === "stride" && e.player === owner && (!c.named.filter || db[e.key].name.includes(quoted(c.named.filter))),
  },
  "attack-hit": {
    forms: ["attack-hit(self)", "attack-hit(self, target=VC)"], text: "This unit's attack hits (target= VC or RC)",
    matches: (e, c, uid) => e.kind === "attack-hit" && e.uid === uid && side(c.named.target, e),
  },
  "to-soul": { forms: ["to-soul(own)"], text: "A card is put into our soul (once per card)", matches: (e, c, _u, owner) => e.kind === "to-soul" && c.pos[0] === "own" && e.player === owner },
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
    matches: (e, c, uid, owner) => e.kind === "to-drop" && (c.pos[0] === "own" ? e.player === owner : e.uid === uid) && (!c.named.by || c.named.by === e.by) && (!c.named.from || c.named.from === e.from),
  },
  retired: {
    forms: ["retired(self)", "retired(own)"], text: "A unit is retired",
    matches: (e, c, uid, owner) => e.kind === "retired" && (c.pos[0] === "own" ? e.player === owner : e.uid === uid) && (!c.named.by || c.named.by === e.by),
  },
  discarded: { forms: ["discarded(self, from=hand, as=g-guardian-cost)"], text: "This card is discarded (as= for which cost)", matches: (e, c, uid) => e.kind === "discarded" && e.uid === uid && (!c.named.as || c.named.as === e.as) },
  "phase-start": { forms: ["phase-start(battle)"], text: "Our battle phase starts", matches: (e, c, _u, owner) => e.kind === "phase-start" && e.player === owner && e.phase === c.pos[0] },
  // STRIDE / G GUARDIAN abilities: the rules (game.ts) use them in their step, they never trigger as AUTO
  step: { forms: ["step(stride, own)", "step(guard, opp)"], text: "Used in this step by the rules (STRIDE, G GUARDIAN)", matches: () => false },
};
