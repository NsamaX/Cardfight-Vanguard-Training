// Power, Shield, Critical, drive, and grade changes
import { msg, type Msg } from "../../../i18n/msg";
import { locate } from "../../state";
import { amount } from "../counters";
import { say } from "../ctx";
import { isChoice, pickUnits } from "../selectors";
import type { Ctx, OpSpec } from "../types";

type Stat = "power" | "shield" | "critical";

// e.g. Power+5000 (no thousands separator, as printed on the card)
const statMsg = (stat: Stat | "drive", value: number): Msg => msg(`stat.${stat}`, { v: `${value > 0 ? "+" : ""}${value}` });

// "+3000", "+3000 per souled", "+1000 per 2 drop"; per=<counter> multiplies too (per=returned)
function valueOf(ctx: Ctx): number {
  const m = ctx.c.pos[0].match(/^([+-]\d+)(?: per (.+))?$/);
  if (!m) return 0;
  return +m[1] * (m[2] ? amount(ctx, m[2]) : 1) * (ctx.c.named.per ? amount(ctx, ctx.c.named.per) : 1);
}

// The units a stat change goes to: the second argument is the selector; how many from the third argument or n=
function targets(ctx: Ctx, bonus?: { stat: Stat; value: number }) {
  const n = ctx.c.pos[2] ?? (ctx.c.named.n ? `n=${ctx.c.named.n}` : undefined);
  return pickUnits(ctx, {
    who: ctx.c.pos[1] ?? "self", n, filter: ctx.c.named.filter, upTo: true, bonus,
    prompt: bonus ? (k) => msg("choice.stat", { bonus: statMsg(bonus.stat, bonus.value), n: k }) : undefined,
  });
}

// CONT: the same value and targets, but only selectors that need no choice ("all of your rear-guards get ...")
function contMods(ctx: Ctx, stat: Stat | "drive", value: number) {
  if (!value || isChoice(ctx.c.pos[1] ?? "self")) return;
  const uids = targets(ctx);
  if (uids === false) return;
  for (const u of uids) {
    const at = locate(ctx.s, u);
    if (at?.zone === "circle") at.inst.mods.push({ stat, value, source: ctx.r.label, until: "cont" });
  }
}

const statOp = (stat: Stat, forms: string[], text: string): OpSpec => ({
  forms, text,
  cont: (ctx) => contMods(ctx, stat, valueOf(ctx)),
  run: (ctx) => {
    const value = valueOf(ctx);
    if (!value) return true;
    const uids = targets(ctx, { stat, value });
    if (uids === false) return false;
    const until = (ctx.c.named.until ?? "turn-end") as "battle-end" | "turn-end";
    for (const u of uids) {
      const at = locate(ctx.s, u);
      if (!at || (at.zone !== "circle" && at.zone !== "guardian")) continue;
      at.inst.mods.push({ stat, value, source: ctx.r.label, until });
      say(ctx, "log.stat", { card: ctx.db[at.inst.key].name, bonus: statMsg(stat, value) }, u);
    }
    return true;
  },
});

export const STAT_OPS: Record<string, OpSpec> = {
  power: statOp("power", [
    "power(+#, self, until=turn-end)", "power(+#, own-VC, until=turn-end)", "power(+#, other-own, n≤#, filter=…, until=turn-end)",
    "power(+#, front-row ≤#, filter=…)", "power(+#, called, until=turn-end)", "power(+# per souled, own-VC & self, until=turn-end)",
    "power(+# per # drop, self, until=battle-end)", "power(+#, own-units, n=count-in-drop(filter), until=turn-end)",
    "power(+# per count-in-soul(filter), own-RC)", "power(-#, self)",
  ], "Change Power (until= battle-end or turn-end)"),
  shield: statOp("shield", ["shield(+#, self, until=battle-end)", "shield(+#, self, per=returned, until=battle-end)"], "Change Shield"),
  critical: statOp("critical", ["critical(+#, self)"], "Change Critical"),
  drive: {
    forms: ["drive(+#, self)", "drive(-#, stood, until=turn-end)"], text: "Change drive (how many drive checks a vanguard makes)",
    cont: (ctx) => contMods(ctx, "drive", parseInt(ctx.c.pos[0], 10)),
    run: (ctx) => {
      const value = parseInt(ctx.c.pos[0], 10);
      const uids = targets(ctx);
      if (uids === false) return false;
      for (const u of uids) {
        const at = locate(ctx.s, u);
        if (at?.zone !== "circle") continue;
        at.inst.mods.push({ stat: "drive", value, source: ctx.r.label, until: (ctx.c.named.until ?? "turn-end") as "battle-end" | "turn-end" });
        say(ctx, "log.stat", { card: ctx.db[at.inst.key].name, bonus: statMsg("drive", value) }, u);
      }
      return true;
    },
  },
  // Only in CONT abilities (read by the rules, e.g. the stride cost); as an effect step it does nothing
  grade: { forms: ["grade(+#, self)"], text: "Change grade (CONT, e.g. while paying the stride cost; read by the rules, see cont.ts)", run: () => true, cont: () => {} },
};
