// ค้นหาด้วยการจำลอง: แต่ละตัวเลือกถูกลองเล่นต่อหลายรอบ (สุ่มข้อมูลที่ซ่อนใหม่ทุกรอบ ทั้งสองฝ่ายเดินด้วย policy)
// แล้วให้คะแนนสนามตอนจบช่วงที่มองล่วงหน้า เลือกตัวเลือกที่คะแนนเฉลี่ยดีที่สุด
import { nextRandom } from "../engine/rng";
import { FRONT, type CardDB } from "../engine/rules";
import type { Action, Circle, Deck, GameState, PlayerId } from "../engine/types";
import { candidates, fallbacks, ownQueue, tryApply } from "./actions";
import { evaluate } from "./eval";
import { attackOptions, fastMode, guardPlans, policy, rankedCalls, rideAction, strideDiscard, strideOptions } from "./policy";
import { determinize } from "./view";

export interface SearchConfig {
  ms: number;         // เวลาคิดสูงสุดต่อการตัดสินใจ
  maxIter: number;
  horizon: number;    // มองต่อกี่เทิร์นหลังเทิร์นปัจจุบัน (0 = จบเทิร์นนี้)
  margin: number;     // ต้องดีกว่าตัวเลือกของ policy เท่านี้จึงเปลี่ยนใจ (กันผลสุ่มหลอก)
}

// เดิน 1 ก้าวด้วย policy ถ้า action ผิดกฎใช้ทางสำรอง
export function step(db: CardDB, s: GameState): GameState | undefined {
  const p = s.awaiting?.player;
  if (!p || s.winner) return undefined;
  const tries = [policy(db, s, p), ...fallbacks(s)];
  for (const a of tries) {
    const r = tryApply(db, s, p, a);
    if (r) return r.state;
  }
  for (const a of candidates(db, s, p)) {
    const r = tryApply(db, s, p, a);
    if (r) return r.state;
  }
  return undefined;
}

export function rollout(db: CardDB, s: GameState, lastTurn: number, maxSteps = 400): GameState {
  let cur = s;
  for (let i = 0; i < maxSteps && !cur.winner && cur.turn <= lastTurn; i++) {
    const next = step(db, cur);
    if (!next) break;
    cur = next;
  }
  return cur;
}

const keyOf = (a: Action) => JSON.stringify(a);

function dedupe(list: (Action | undefined)[]): Action[] {
  const seen = new Set<string>();
  return list.filter((a): a is Action => !!a && (seen.has(keyOf(a)) ? false : (seen.add(keyOf(a)), true)));
}

// ตัวเลือกที่ควรค้น (ตัดตัวเลือกที่ไม่มีเหตุผลออกก่อน ไม่งั้นเวลาคิดไม่พอ)
export function searchCandidates(db: CardDB, s: GameState, p: PlayerId): Action[] {
  const d = s.awaiting!;
  const pol = policy(db, s, p);
  switch (d.kind) {
    case "mulligan": return [pol];
    case "next-phase": {
      if (s.phase === "ride" && s.step === "ride") {
        return dedupe([pol, rideAction(db, s, p), ...candidates(db, s, p).filter((a) => a.type === "ride"), { type: "next-phase" }]);
      }
      if (s.phase === "ride" && s.step === "stride") {
        const discardUids = strideDiscard(db, s, p);
        const gs = discardUids ? strideOptions(db, s, p).map((g): Action => ({ type: "stride", gUid: g.uid, discardUids })) : [];
        return dedupe([pol, ...gs, { type: "next-phase" }]);
      }
      if (s.phase === "main") {
        const calls = rankedCalls(db, s, p).slice(0, 4).map((c) => c.action);
        const other = candidates(db, s, p).filter((a) => a.type === "activate");
        return dedupe([pol, ...calls, ...other, { type: "next-phase" }]);
      }
      if (s.phase === "battle") return dedupe([pol, ...attackOptions(db, s, p), { type: "next-phase" }]);
      return [pol];
    }
    case "guard": return dedupe([pol, ...guardPlans(db, s, p).slice(0, 6).map((g) => g.actions[0]), { type: "end-guard" }]);
    case "trigger-target": {
      const ps = s.players[p];
      const main = (FRONT as Circle[]).filter((c) => ps.circles[c]);
      const extra = [...main, ...(["back_left", "back_right"] as Circle[]).filter((c) => ps.circles[c]?.rested)];
      return dedupe([pol, ...candidates(db, s, p).filter((a) => a.type === "trigger-target" && main.includes(a.powerTo) && (!a.extraTo || extra.includes(a.extraTo)))]).slice(0, 12);
    }
    case "order-queue": {
      // คิวมีใบเดียวที่เลือกไม่ใช้ได้: ข้ามคิว = ไม่ใช้ใบนั้น
      const q = ownQueue(s, p);
      const single = q.length === 1 && q[0].optional;
      return dedupe([pol, ...candidates(db, s, p).filter((a) => !(single && a.type === "pass-queue"))]).slice(0, 10);
    }
    default: return dedupe([pol, ...candidates(db, s, p)]).slice(0, 10);
  }
}

// ผลจำลองมีหางยาว (แพ้/ชนะ = ±60) ถ้าเก็บรอบน้อย SE จะต่ำกว่าจริงเพราะยังไม่เจอเกมที่จบ จึงยังไม่ตัดก่อนรอบนี้
const MIN_ROUNDS = 30;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const pause = () => new Promise<void>((r) => setTimeout(r, 0));

// เทียบแบบจับคู่: แต่ละรอบสุ่มโลก (ข้อมูลที่ซ่อน + ลำดับกอง) ครั้งเดียว แล้วลองทุกตัวเลือกในโลกเดียวกัน
// ผลต่างกับตัวเลือกของ policy (cands[0]) จึงสะท้อนการตัดสินใจ ไม่ใช่โชค
// ตัวเลือกที่ไม่มีทางถูกเลือกถูกตัดออกระหว่างทาง เวลาที่เหลือไปลงกับตัวที่สูสี และหยุดทันทีเมื่อคำตอบชัดแล้ว
export async function search(
  db: CardDB, view: GameState, decks: Record<PlayerId, Deck>, p: PlayerId, cands: Action[], cfg: SearchConfig, seed: { v: number },
): Promise<{ action: Action; stats: { action: Action; n: number; mean: number; se: number }[] }> {
  const stats = cands.map((action) => ({ action, n: 0, sum: 0, sq: 0, live: true }));
  const t0 = now();
  let lastPause = t0;
  const rand = () => { let v: number; [v, seed.v] = nextRandom(seed.v); return Math.floor(v * 2 ** 31) | 1; };
  const lastTurn = view.turn + cfg.horizon;
  const se = (x: typeof stats[number]) => (x.n > 1 ? Math.sqrt(Math.max(0, x.sq / x.n - (x.sum / x.n) ** 2) / (x.n - 1)) : Infinity);
  const mean = (x: typeof stats[number]) => x.sum / x.n;
  const value = (det: GameState, a: Action) => {
    const r = tryApply(db, det, p, a);
    if (!r) return undefined;
    fastMode.on = true;
    try { return evaluate(db, rollout(db, r.state, lastTurn), p); } finally { fastMode.on = false; }
  };
  const alts = stats.slice(1);
  let rollouts = 0;
  for (let round = 0; rollouts < cfg.maxIter && now() - t0 < cfg.ms; round++) {
    const live = alts.filter((x) => x.live);
    if (!live.length) break;
    if (live.length === 1 && round >= MIN_ROUNDS && mean(live[0]) - 2 * se(live[0]) > cfg.margin) break;
    const det = determinize(db, view, decks, rand());
    const base = value(det, cands[0]);
    rollouts++;
    if (base === undefined) break;
    for (const x of live) {
      const v = value(det, x.action);
      rollouts++;
      if (v === undefined) { x.live = false; continue; }
      const d = v - base;
      x.n++; x.sum += d; x.sq += d * d;
      if (now() - lastPause > 15) { await pause(); lastPause = now(); }
    }
    // ตัดตัวที่แย่กว่า policy ชัดเจน
    if (round >= 3) for (const x of alts) if (x.live && mean(x) + 2 * se(x) < 0) x.live = false;
    // ตัดตัวที่ไม่มีทางผ่านเกณฑ์เปลี่ยนใจ (ต่ำกว่า margin ชัดเจน หรือแพ้ตัวที่ดีกว่า policy ชัดเจนแล้ว)
    if (round >= MIN_ROUNDS) {
      const bar = Math.max(cfg.margin, ...alts.filter((x) => x.live).map((x) => mean(x) - 2 * se(x)));
      for (const x of alts) if (x.live && mean(x) + 2 * se(x) < bar) x.live = false;
    }
  }
  stats[0].n = Math.max(1, ...stats.map((x) => x.n));
  const scored = stats.filter((x) => x.n > 0).map((x) => ({ action: x.action, n: x.n, mean: x === stats[0] ? 0 : x.sum / x.n, se: x === stats[0] ? 0 : se(x) }));
  // เปลี่ยนจาก policy เมื่อดีกว่าเกินผลสุ่ม (ค่าเฉลี่ย - 1 SE ยังมากกว่า margin)
  const best = scored.slice(1).filter((x) => x.n >= 4 && x.mean - x.se > cfg.margin).sort((a, b) => b.mean - b.se - (a.mean - a.se))[0];
  return { action: best?.action ?? cands[0], stats: scored };
}
