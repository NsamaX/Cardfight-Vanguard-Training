// การกระทำที่เป็นไปได้ ณ จุดที่ engine รอ: สร้างจากกฎแบบหยาบ แล้วให้ engine ตัดสินว่าถูกกฎไหม (กฎอยู่ที่ engine ที่เดียว)
import { apply, usableActs, type Result } from "../engine/game";
import { BEHIND, FRONT, RC, RuleError, SAME_COLUMN, bothVanguardsGrade3, canBoost, isG, other, vcGrade, type CardDB } from "../engine/rules";
import type { Action, CardInstance, Circle, GameState, PlayerId } from "../engine/types";

export function tryApply(db: CardDB, s: GameState, p: PlayerId, a: Action): Result | undefined {
  try { return apply(db, s, p, a); } catch (e) { if (e instanceof RuleError) return undefined; throw e; }
}

export const legal = (db: CardDB, s: GameState, p: PlayerId, a: Action) => !!tryApply(db, s, p, a);

// การ์ดต่างใบแต่รหัสเดียวกันให้ผลเหมือนกัน เลือกตัวแทนใบเดียว
export function distinctByKey(list: CardInstance[]): CardInstance[] {
  const seen = new Set<string>();
  return list.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

export function ownQueue(s: GameState, p: PlayerId) {
  return s.queue.filter((e) => e.owner === p);
}

// รายการการกระทำทั้งหมดที่ควรพิจารณา (ยังไม่ตรวจกฎ ยกเว้นส่วนที่สร้างจากรายการตัวเลือกของ engine)
export function candidates(db: CardDB, s: GameState, p: PlayerId): Action[] {
  const d = s.awaiting;
  if (!d || d.player !== p) return [];
  const ps = s.players[p], opp = s.players[other(p)];
  const out: Action[] = [];
  switch (d.kind) {
    case "mulligan": return [{ type: "mulligan", returnUids: [] }];
    case "next-phase": {
      if (s.phase === "ride" && s.step === "ride" && !s.rodeThisTurn) {
        const g = vcGrade(db, ps);
        for (const c of distinctByKey(ps.hand)) {
          const card = db[c.key];
          if (!isG(card) && (card.grade === g || card.grade === g + 1)) out.push({ type: "ride", uid: c.uid });
        }
      }
      if (s.phase === "ride" && s.step === "stride" && !s.strodeThisTurn && bothVanguardsGrade3(db, s)) {
        for (const g of distinctByKey(ps.gZone.filter((x) => !x.faceUp && db[x.key].type === "g-unit"))) {
          out.push({ type: "stride", gUid: g.uid, discardUids: [] });   // ใบที่ทิ้งเลือกโดย policy
        }
      }
      if (s.phase === "main") {
        const g = vcGrade(db, ps);
        for (const c of distinctByKey(ps.hand)) {
          if (isG(db[c.key]) || db[c.key].grade > g) continue;
          for (const to of RC) out.push({ type: "call", uid: c.uid, to });
        }
        for (const [from, to] of Object.entries(SAME_COLUMN) as [Circle, Circle][]) {
          if (ps.circles[from] && FRONT.includes(from)) out.push({ type: "move", from, to });
        }
        for (const a of usableActs(db, s)) out.push({ type: "activate", cardUid: a.uid, abilityIndex: a.index });
      }
      if (s.phase === "battle" && s.step === "attack" && !(s.turn === 1 && p === s.firstPlayer)) {
        for (const a of FRONT) {
          const u = ps.circles[a];
          if (!u || u.rested) continue;
          const b = BEHIND[a];
          const bu = b ? ps.circles[b] : undefined;
          const booster = bu && !bu.rested && canBoost(db[bu.key]) ? b : undefined;
          for (const t of FRONT) if (opp.circles[t]) out.push({ type: "attack", attacker: a, target: t, booster });
        }
      }
      out.push({ type: "next-phase" });
      return out;
    }
    case "guard": {
      out.push({ type: "end-guard" });
      return out;
    }
    case "order-queue": {
      ownQueue(s, p).forEach((e, i) => {
        out.push({ type: "order-queue", index: i });
        if (e.optional) out.push({ type: "decline-queue", index: i });
      });
      out.push({ type: "pass-queue" });
      return out;
    }
    case "choose": {
      const c = d.choice;
      if (c?.kind === "yesno") return [{ type: "choose", option: "yes" }, { type: "choose", option: "no" }];
      if (c?.kind === "option") return c.options.map((o) => ({ type: "choose", option: o }));
      return [];
    }
    case "select-target": {
      const c = d.choice;
      if (c?.kind === "circle") return [...c.options.map((to) => ({ type: "select-target" as const, uids: [], to })), { type: "select-target", uids: [] }];
      if (c?.kind === "cards") {
        if (c.min === 0) out.push({ type: "select-target", uids: [] });
        if (c.max >= 1 && c.min <= 1) for (const u of c.options) out.push({ type: "select-target", uids: [u] });
        if (c.min > 1) out.push({ type: "select-target", uids: c.options.slice(0, c.min) });
      }
      return out;
    }
    case "trigger-target": {
      const t = s.battle?.pendingTrigger;
      const units = (Object.keys(ps.circles) as Circle[]).filter((c) => ps.circles[c]);
      for (const powerTo of units) {
        if (t?.kind === "critical") for (const extraTo of units) out.push({ type: "trigger-target", powerTo, extraTo });
        else if (t?.kind === "stand") {
          const rested = RC.filter((c) => ps.circles[c]?.rested);
          if (!rested.length) out.push({ type: "trigger-target", powerTo });
          for (const extraTo of rested) out.push({ type: "trigger-target", powerTo, extraTo });
        } else out.push({ type: "trigger-target", powerTo });
      }
      return out;
    }
  }
  return out;
}

// ทางหนีเมื่อ action ที่เลือกผิดกฎ: การกระทำที่ "ไม่ทำอะไรเพิ่ม" ของแต่ละจุด
export function fallbacks(s: GameState): Action[] {
  const d = s.awaiting;
  if (!d) return [];
  const c = d.choice;
  switch (d.kind) {
    case "mulligan": return [{ type: "mulligan", returnUids: [] }];
    case "next-phase": return [{ type: "next-phase" }];
    case "guard": return [{ type: "end-guard" }];
    case "order-queue": return [{ type: "pass-queue" }, { type: "order-queue", index: 0 }];
    case "choose": return c?.kind === "yesno" ? [{ type: "choose", option: "no" }, { type: "choose", option: "yes" }] : c?.kind === "option" ? c.options.map((o) => ({ type: "choose", option: o })) : [];
    case "select-target":
      if (c?.kind === "cards") return [{ type: "select-target", uids: c.options.slice(0, c.min) }, { type: "select-target", uids: c.options.slice(0, Math.max(1, c.min)) }];
      return [{ type: "select-target", uids: [] }, ...(c?.kind === "circle" ? c.options.map((to) => ({ type: "select-target" as const, uids: [], to })) : [])];
    case "trigger-target": return [{ type: "trigger-target", powerTo: "vc" }];
  }
  return [];
}
