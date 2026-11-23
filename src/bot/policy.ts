// กฎตัดสินใจแบบ heuristic ของทุกจุดที่ engine รอ: ใช้เป็นบอทระดับ Normal และเป็นตัวเดินของการจำลองในระดับสูงกว่า
// ทุกฟังก์ชันคืน Action ที่ตั้งใจให้ถูกกฎ ถ้าพลาด ผู้เรียกใช้ fallbacks() แทน
import { gGuardianBlocked, usableActs } from "../engine/game";
import { parseCode } from "../engine/code";
import {
  BEHIND, FRONT, RC, SAME_COLUMN, bothVanguardsGrade3, strideCostGrade, criticalOf, driveOf, generationBreak, isG, isSentinel, other, powerOf, shieldOf, vcGrade,
  type CardDB,
} from "../engine/rules";
import { circleOf, locate } from "../engine/state";
import type { Action, CardInstance, Circle, GameState, PlayerId, PlayerState, QueueEntry } from "../engine/types";
import { distinctByKey, ownQueue } from "./actions";
import { CB_VALUE, DAMAGE_COST } from "./eval";
import { dropCallPayoff, handCallPayoff, hollowPayoff, keepValue, rideScore, shieldIn, strideScore, unitValue } from "./knowledge";
import { isHidden } from "./view";

export function policy(db: CardDB, s: GameState, p: PlayerId): Action {
  const d = s.awaiting!;
  switch (d.kind) {
    case "mulligan": return mulligan(db, s, p);
    case "next-phase": return freeAction(db, s, p);
    case "guard": return guard(db, s, p);
    case "order-queue": return orderQueue(db, s, p);
    case "choose": return choose(db, s, p);
    case "select-target": return selectTarget(db, s, p);
    case "trigger-target": return triggerTarget(db, s, p);
  }
  return { type: "next-phase" };
}

// ---------- เปลี่ยนการ์ดบนมือ: เก็บเส้นทางไรด์เกรด 1-2-3 อย่างละใบ ----------

function mulligan(db: CardDB, s: GameState, p: PlayerId): Action {
  const hand = s.players[p].hand;
  const keep = new Set<string>();
  for (const g of [1, 2, 3]) {
    const pick = hand.filter((c) => db[c.key].grade === g && !isG(db[c.key])).sort((a, b) => rideScore(db[b.key]) - rideScore(db[a.key]))[0];
    if (pick) keep.add(pick.uid);
  }
  const lineDone = keep.size === 3;
  const back = hand.filter((c) => {
    if (keep.has(c.uid)) return false;
    const card = db[c.key];
    if (card.grade === 3) return true;
    if (card.trigger) return !lineDone;
    return false;
  });
  return { type: "mulligan", returnUids: back.map((c) => c.uid) };
}

// ---------- เทิร์นของตัวเอง ----------

function freeAction(db: CardDB, s: GameState, p: PlayerId): Action {
  if (s.phase === "ride" && s.step === "ride") return rideAction(db, s, p);
  if (s.phase === "ride" && s.step === "stride") return strideAction(db, s, p);
  if (s.phase === "main") return mainAction(db, s, p);
  if (s.phase === "battle" && s.step === "attack") return attackAction(db, s, p);
  return { type: "next-phase" };
}

export function rideAction(db: CardDB, s: GameState, p: PlayerId): Action {
  const ps = s.players[p];
  if (s.rodeThisTurn) return { type: "next-phase" };
  const g = vcGrade(db, ps);
  const opts = ps.hand.filter((c) => !isG(db[c.key]) && db[c.key].grade === g + 1 && g < 3);
  if (!opts.length) return { type: "next-phase" };
  const best = opts.sort((a, b) => rideScore(db[b.key]) - rideScore(db[a.key]))[0];
  return { type: "ride", uid: best.uid };
}

// ใบที่ทิ้งเป็นคอสต์สไตรด์: เกรดรวม 3 ขึ้นไป เสียค่าน้อยที่สุด
export function strideDiscard(db: CardDB, s: GameState, p: PlayerId): string[] | undefined {
  const hand = s.players[p].hand.filter((c) => !isG(db[c.key]));
  let best: { uids: string[]; cost: number } | undefined;
  const walk = (i: number, picked: CardInstance[], grade: number, cost: number) => {
    if (grade >= 3) {
      if (!best || cost < best.cost) best = { uids: picked.map((c) => c.uid), cost };
      return;
    }
    if (picked.length >= 3 || i >= hand.length) return;
    for (let j = i; j < hand.length; j++) {
      const c = hand[j];
      const g = strideCostGrade(db[c.key]);
      if (g === 0) continue;
      walk(j + 1, [...picked, c], grade + g, cost + keepValue(db, s, p, c) + 0.05);
    }
  };
  walk(0, [], 0, 0);
  return best?.uids;
}

export function strideOptions(db: CardDB, s: GameState, p: PlayerId): CardInstance[] {
  const ps = s.players[p];
  return distinctByKey(ps.gZone.filter((g) => !g.faceUp && db[g.key].type === "g-unit" && !db[g.key].abilities.some((a) => a.kind === "ULTIMATE STRIDE")));
}

function strideAction(db: CardDB, s: GameState, p: PlayerId): Action {
  if (s.strodeThisTurn || !bothVanguardsGrade3(db, s)) return { type: "next-phase" };
  const discardUids = strideDiscard(db, s, p);
  const gs = strideOptions(db, s, p);
  if (!discardUids || !gs.length) return { type: "next-phase" };
  const best = gs.sort((a, b) => strideScore(db, s, p, b) - strideScore(db, s, p, a))[0];
  return { type: "stride", gUid: best.uid, discardUids };
}

// ---------- เมนเฟส ----------

// จำนวน Shield (หน่วยละ 5000) ที่แนวนี้บังคับให้คู่แข่งใช้ ถ้าต้องการกันไม่ให้โดน
const forced = (power: number, oppVc: number) => (power >= oppVc ? Math.min(3, Math.floor((power - oppVc) / 5000) + 1) : 0);

// Power ของแวนการ์ดคู่แข่งในเทิร์นหน้าของเรา (ไรด์ขึ้นอีกเกรด G ยูนิทกลับ G โซนตอนจบเทิร์นแล้ว)
const TYPICAL_VC = [5000, 7000, 9000, 11000];
function futureOppVc(db: CardDB, s: GameState, p: PlayerId) {
  const opp = s.players[other(p)];
  const vc = opp.circles.vc ? db[opp.circles.vc.key] : undefined;
  const g = vc?.type === "g-unit" && opp.heart ? db[opp.heart.key].grade : vc?.grade ?? 0;
  return TYPICAL_VC[Math.min(3, g + 1)];
}

// แรงกดดันของสนาม (หน่วย = Shield 5000 ที่คู่แข่งต้องใช้) เมื่อวางการ์ดตามที่ระบุ
// ยูนิทอยู่บนสนามหลายเทิร์น จึงคิดทั้งเทียบแวนการ์ดคู่แข่งตอนนี้ และแวนการ์ดคู่แข่งในเทิร์นหน้า
function pressure(db: CardDB, s: GameState, p: PlayerId, place: Partial<Record<Circle, CardInstance | null>> = {}): number {
  return pressureVs(db, s, p, powerOf(db, s.players[other(p)], "vc") || 1, place)
    + pressureVs(db, s, p, futureOppVc(db, s, p), place) * (PERSIST - 1);
}

function pressureVs(db: CardDB, s: GameState, p: PlayerId, oppVc: number, place: Partial<Record<Circle, CardInstance | null>>): number {
  const ps = s.players[p];
  const at = (c: Circle) => (c in place ? place[c] ?? undefined : ps.circles[c]);
  let n = 0;
  for (const c of FRONT) {
    const u = at(c);
    if (!u) continue;
    const back = BEHIND[c]!;
    const bu = at(back);
    const boost = bu && db[bu.key].grade <= 1 ? db[bu.key].power ?? 0 : 0;
    const base = c === "vc" || u === ps.circles[c] ? powerOf(db, ps, c) : db[u.key].power ?? 0;
    n += forced(base + boost, oppVc);
  }
  return n;
}

const PERSIST = 2.2;      // ยูนิทที่อยู่บนสนามได้ใช้หลายเทิร์น
const PER_SHIELD = 0.65;  // Shield 5000 ที่บังคับให้คู่แข่งใช้ (หรือรับดาเมจแทน) มีค่าราวการ์ดครึ่งใบขึ้นไป

export function callScore(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance, to: Circle): number {
  const ps = s.players[p];
  const card = db[inst.key];
  const now = pressure(db, s, p);
  const old = ps.circles[to];
  let gain = (pressure(db, s, p, { [to]: inst }) - now) * PER_SHIELD;
  if (FRONT.includes(to) && !ps.circles[BEHIND[to]!]) {
    // แนวหน้าที่ยังไม่มีตัวบูสท์: คิดรวมกับตัวบูสท์ที่ดีที่สุดบนมือ
    const booster = ps.hand.filter((h) => h.uid !== inst.uid && !isG(db[h.key]) && db[h.key].grade <= 1 && !isSentinel(db[h.key]))
      .sort((a, b) => (db[b.key].power ?? 0) - (db[a.key].power ?? 0))[0];
    if (booster) gain = Math.max(gain, (pressure(db, s, p, { [to]: inst, [BEHIND[to]!]: booster }) - now) * PER_SHIELD - keepValue(db, s, p, booster));
  }
  if (card.grade >= 2 && !FRONT.includes(to)) gain -= 1;
  if (card.grade <= 1 && FRONT.includes(to)) gain -= 0.6;
  // แรงกดดันที่หายไปของตัวเดิมคิดอยู่ใน gain แล้ว เหลือแค่ค่าอื่นของยูนิท (เป็นตัวอินเตอร์เซปต์ ฯลฯ)
  const loss = old && !old.hollowed && !old.retireAtTurnEnd ? 0.35 : 0;
  const danger = ps.damage.length >= 4 ? 1.25 : 1;
  return gain - loss + (handCallPayoff(card) ? 0.45 : 0) - keepValue(db, s, p, inst) * danger;
}

export function rankedCalls(db: CardDB, s: GameState, p: PlayerId): { action: Action; score: number }[] {
  const ps = s.players[p];
  const g = vcGrade(db, ps);
  const out: { action: Action; score: number }[] = [];
  for (const inst of distinctByKey(ps.hand)) {
    const card = db[inst.key];
    if (isG(card) || card.grade > g || isSentinel(card)) continue;
    for (const to of RC) out.push({ action: { type: "call", uid: inst.uid, to }, score: callScore(db, s, p, inst, to) });
  }
  return out.sort((a, b) => b.score - a.score);
}

function wantAct(db: CardDB, s: GameState, p: PlayerId, uid: string, index: number): boolean {
  const ps = s.players[p];
  const at = locate(s, uid);
  if (!at || at.zone !== "circle") return false;
  const ab = db[at.inst.key].abilities[index];
  const cost = ab.cost ?? [];
  if (cost.includes("soul-in(self)")) {
    // ตัวที่ไม่ได้ช่วยโจมตี (แถวหน้า หรือแถวหลังที่ไม่มีใครให้บูสท์) เข้าโซลแลกจั่ว
    const c = at.circle!;
    if (FRONT.includes(c)) return true;
    const front = FRONT.find((f) => BEHIND[f] === c);
    return !front || !ps.circles[front];
  }
  if (ab.effect.some((e) => e.startsWith("call(drop→RC"))) return ps.drop.some((d) => !isG(db[d.key]) && db[d.key].type === "normal");
  return true;
}

function mainAction(db: CardDB, s: GameState, p: PlayerId): Action {
  const ps = s.players[p];
  for (const a of usableActs(db, s)) if (wantAct(db, s, p, a.uid, a.index)) return { type: "activate", cardUid: a.uid, abilityIndex: a.index };
  for (const front of ["front_left", "front_right"] as Circle[]) {
    const back = SAME_COLUMN[front]!;
    const f = ps.circles[front], b = ps.circles[back];
    if (b && db[b.key].grade >= 2 && (!f || db[f.key].grade <= 1)) return { type: "move", from: back, to: front };
  }
  const best = rankedCalls(db, s, p)[0];
  if (best && best.score > 0) return best.action;
  return { type: "next-phase" };
}

// ---------- แบทเทิลเฟส ----------

export function attackPower(db: CardDB, ps: PlayerState, a: Circle, booster?: Circle) {
  return powerOf(db, ps, a) + (booster ? powerOf(db, ps, booster) : 0);
}

export function attackOptions(db: CardDB, s: GameState, p: PlayerId): Extract<Action, { type: "attack" }>[] {
  if (s.turn === 1 && p === s.firstPlayer) return [];
  const ps = s.players[p], opp = s.players[other(p)];
  const out: Extract<Action, { type: "attack" }>[] = [];
  for (const a of FRONT) {
    const u = ps.circles[a];
    if (!u || u.rested) continue;
    const b = BEHIND[a]!;
    const bu = ps.circles[b];
    const booster = bu && !bu.rested && db[bu.key].grade <= 1 ? b : undefined;
    for (const t of FRONT) if (opp.circles[t]) out.push({ type: "attack", attacker: a, target: t, booster });
  }
  return out;
}

function attackAction(db: CardDB, s: GameState, p: PlayerId): Action {
  const ps = s.players[p], opp = s.players[other(p)];
  const opts = attackOptions(db, s, p);
  if (!opts.length) return { type: "next-phase" };
  const oppVc = powerOf(db, opp, "vc");
  const attackers = [...new Set(opts.map((o) => o.attacker))];
  // แวนการ์ดโจมตีก่อน ทริกเกอร์จากไดรฟ์เช็คจะได้ลงยูนิทที่ยังไม่โจมตี
  attackers.sort((a, b) => (a === "vc" ? -1 : b === "vc" ? 1 : attackPower(db, ps, b, BEHIND[b]) - attackPower(db, ps, a, BEHIND[a])));
  const a = attackers[0];
  const o = opts.find((x) => x.attacker === a)!;
  const power = attackPower(db, ps, a, o.booster);
  let target: Circle = "vc";
  if (power < oppVc) {
    const hittable = (["front_left", "front_right"] as Circle[]).filter((c) => opp.circles[c] && powerOf(db, opp, c) <= power)
      .sort((x, y) => unitValue(db, opp.circles[y]!) - unitValue(db, opp.circles[x]!));
    if (hittable[0]) target = hittable[0];
  }
  return { type: "attack", attacker: a, target, booster: o.booster };
}

// ---------- การ์ด ----------

interface GuardItem { uid?: string; intercept?: Circle; shield: number; cost: number }

// โอกาสเปิดทริกเกอร์ต่อการเช็ค 1 ใบ และสัดส่วนคริติคัลในทริกเกอร์
function triggerOdds(db: CardDB, s: GameState, p: PlayerId) {
  const deck = s.players[p].deck;
  if (!deck.length || deck.some(isHidden)) return { q: 0.3, crit: 0.5 };
  const trig = deck.filter((c) => db[c.key].trigger);
  return { q: trig.length / deck.length, crit: trig.length ? trig.filter((c) => db[c.key].trigger === "critical").length / trig.length : 0 };
}

const binom = (n: number, k: number, q: number) => {
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c * q ** k * (1 - q) ** (n - k);
};

// ราคาที่เสียเมื่อโดนดาเมจเพิ่ม n (รวม CB ที่ได้)
export function damageCost(d: number, n: number): number {
  if (d + n >= 6) return 25;
  return DAMAGE_COST[d + n] - DAMAGE_COST[d] - CB_VALUE * n;
}

// ราคาคาดหวังเมื่อการโจมตีนี้โดน โดยทริกเกอร์อย่างน้อย kNeed ใบ (kNeed = จำนวนทริกเกอร์ที่ต้องเปิดจึงโดน)
function expectedHitCost(db: CardDB, s: GameState, p: PlayerId, kNeed: number): number {
  const b = s.battle!;
  const atkSide = s.turnPlayer;
  const atk = s.players[atkSide].circles[b.attacker];
  if (!atk) return 0;
  const drives = b.attacker === "vc" ? driveOf(db, atk) : 0;
  if (kNeed > drives) return 0;
  const { q, crit } = triggerOdds(db, s, atkSide);
  const d = s.players[p].damage.length;
  let total = 0;
  if (b.target !== "vc") {
    const u = s.players[p].circles[b.target];
    const loss = u ? unitValue(db, u) : 0;
    for (let k = Math.max(0, kNeed); k <= drives; k++) total += binom(drives, k, q) * loss;
    return total;
  }
  const c = criticalOf(atk);
  for (let k = Math.max(0, kNeed); k <= drives; k++) {
    let h = 0;
    for (let j = 0; j <= k; j++) h += binom(k, j, crit) * damageCost(d, c + j);
    total += binom(drives, k, q) * h;
  }
  return total;
}

function guardItems(db: CardDB, s: GameState, p: PlayerId): GuardItem[] {
  const ps = s.players[p];
  const items: GuardItem[] = [];
  for (const h of ps.hand) {
    const card = db[h.key];
    if (isG(card) || isSentinel(card)) continue;
    const shield = shieldIn(db, h);
    if (shield > 0) items.push({ uid: h.uid, shield, cost: keepValue(db, s, p, h) });
  }
  for (const c of ["front_left", "front_right"] as Circle[]) {
    const u = ps.circles[c];
    if (u && c !== s.battle!.target && db[u.key].grade === 2) items.push({ intercept: c, shield: shieldOf(db, u), cost: unitValue(db, u) * 1.1 });
  }
  return items.sort((a, b) => b.shield - a.shield);
}

// ชุดการ์ดที่ใช้น้อยที่สุดให้ได้ Shield อย่างน้อย need
function cheapest(items: GuardItem[], need: number): { picks: GuardItem[]; cost: number } | undefined {
  if (need <= 0) return { picks: [], cost: 0 };
  let best: { picks: GuardItem[]; cost: number } | undefined;
  const suffix = items.map((_, i) => items.slice(i).reduce((n, x) => n + x.shield, 0));
  const walk = (i: number, picked: GuardItem[], shield: number, cost: number) => {
    if (best && cost >= best.cost) return;
    if (shield >= need) { best = { picks: picked, cost }; return; }
    if (i >= items.length || shield + suffix[i] < need) return;
    walk(i + 1, [...picked, items[i]], shield + items[i].shield, cost + items[i].cost);
    walk(i + 1, picked, shield, cost);
  };
  walk(0, [], 0, 0);
  return best;
}

// Shield ที่ G การ์เดี้ยนให้ได้จริง (รวมความสามารถเมื่อเข้า GC ที่จ่ายคอสต์ได้)
function gGuardianShield(db: CardDB, s: GameState, p: PlayerId, g: CardInstance): number {
  const ps = s.players[p];
  const card = db[g.key];
  let v = card.shield ?? 0;
  for (const ab of card.abilities) {
    if (ab.kind !== "AUTO") continue;
    const gb = (ab.cond ?? []).map((c) => c.match(/GB\((\d+)\)/)).find(Boolean);
    if (gb && generationBreak(db, ps) + 1 < +gb[1]) continue;
    const cost = ab.cost ?? [];
    if (cost.some((c) => c.startsWith("CB")) && !ps.damage.some((d) => d.faceUp)) continue;
    if (cost.some((c) => c.startsWith("retire-own")) && !RC.some((c) => ps.circles[c])) continue;
    if (cost.some((c) => c.startsWith("SB")) && !ps.soul.length) continue;
    if (cost.some((c) => c.startsWith("flip-G-up")) && ps.gZone.filter((x) => !x.faceUp && db[x.key].type === "g-guardian").length < 2) continue;
    if (cost.some((c) => c.startsWith("mill")) && ps.deck.length < 10) continue;
    for (const e of ab.effect) {
      const m = e.match(/^shield\(\+(\d+), self/);
      if (m) v += +m[1];
      if (/^call\(drop→GC, n=2/.test(e) && ps.drop.length >= 2) v += 10000;
    }
  }
  return v;
}

export interface GuardPlan { actions: Action[]; cost: number; label: string }

// แผนการ์ดที่เป็นไปได้ พร้อมราคารวม (การ์ดที่เสีย + ดาเมจที่คาดว่าจะโดน)
export function guardPlans(db: CardDB, s: GameState, p: PlayerId): GuardPlan[] {
  const b = s.battle!;
  const ps = s.players[p];
  const atkPs = s.players[s.turnPlayer];
  const plans: GuardPlan[] = [];
  if (b.noHit) return [{ actions: [{ type: "end-guard" }], cost: 0, label: "no-hit" }];
  const A = powerOf(db, atkPs, b.attacker);
  const D = powerOf(db, ps, b.target) + ps.guardian.reduce((n, g) => n + shieldOf(db, g), 0);
  const atk = atkPs.circles[b.attacker];
  const drives = atk && b.attacker === "vc" ? driveOf(db, atk) : 0;
  // kNeed ของ Shield S: ต้องเปิดทริกเกอร์กี่ใบการโจมตีจึงโดน
  const kNeedOf = (S: number) => (D + S > A ? Math.ceil((D + S - A) / 5000) : 0);
  plans.push({ actions: [{ type: "end-guard" }], cost: expectedHitCost(db, s, p, kNeedOf(0)), label: "take" });
  const items = guardItems(db, s, p);
  const toAction = (picks: GuardItem[]): Action => ({
    type: "guard", uids: picks.filter((x) => x.uid).map((x) => x.uid!), intercept: picks.filter((x) => x.intercept).map((x) => x.intercept!),
  });
  for (let L = Math.max(1, kNeedOf(0) + 1); L <= drives + 1; L++) {
    const need = A + 5000 * (L - 1) - D + 1;
    const c = cheapest(items, need);
    if (c && c.picks.length) plans.push({ actions: [toAction(c.picks)], cost: c.cost + expectedHitCost(db, s, p, L), label: `pass-${L - 1}` });
  }
  // พิทักษ์: ไม่โดนแน่นอน ต้องมีการ์ดอีกใบให้ทิ้ง
  const others = ps.hand.filter((h) => !isG(db[h.key]));
  for (const sen of distinctByKey(ps.hand.filter((h) => !isHidden(h) && isSentinel(db[h.key])))) {
    const card = db[sen.key];
    const ab = card.abilities.find((x) => x.effect.some((e) => e.startsWith("no-hit")));
    if (!ab) continue;
    const vcOnly = ab.effect.some((e) => e.includes("own-VC-attacked"));
    if (vcOnly && b.target !== "vc") continue;
    const fl = (ab.cost ?? []).map((c) => parseCode(c).named.filter).find(Boolean);
    const target = ps.circles[b.target];
    if (fl && target && db[target.key].clan !== fl) continue;
    const discards = others.filter((h) => h.uid !== sen.uid && (!fl || db[h.key].clan === fl)).map((h) => keepValue(db, s, p, h)).sort((x, y) => x - y);
    if (!discards.length) continue;
    plans.push({ actions: [{ type: "guard", uids: [sen.uid] }], cost: keepValue(db, s, p, sen) + discards[0], label: "sentinel" });
  }
  // G การ์เดี้ยน
  if (!gGuardianBlocked(db, s, p)) {
    const heal = ps.hand.filter((h) => db[h.key].trigger === "heal").sort((x, y) => keepValue(db, s, p, x) - keepValue(db, s, p, y))[0];
    for (const g of distinctByKey(ps.gZone.filter((x) => !x.faceUp && db[x.key].type === "g-guardian"))) {
      const sh = gGuardianShield(db, s, p, g);
      const base = keepValue(db, s, p, heal) - 0.45;   // เสีย Heal แต่ได้ GB และความสามารถตอนทิ้ง
      const rest = items.filter((x) => x.uid !== heal.uid);
      for (let L = Math.max(1, kNeedOf(0) + 1); L <= drives + 1; L++) {
        const need = A + 5000 * (L - 1) - D + 1 - sh;
        const c = cheapest(rest, need);
        if (c) plans.push({ actions: [{ type: "call-g-guardian", gUid: g.uid, discardUid: heal.uid }], cost: base + c.cost + expectedHitCost(db, s, p, L), label: `g-${L - 1}` });
      }
    }
  }
  return plans.sort((x, y) => x.cost - y.cost);
}

function guard(db: CardDB, s: GameState, p: PlayerId): Action {
  return guardPlans(db, s, p)[0].actions[0];
}

// ---------- ความสามารถ ----------

function wantHollow(db: CardDB, s: GameState, entry: QueueEntry): boolean {
  const at = locate(s, entry.uid);
  if (!at || at.zone !== "circle") return false;
  if (entry.event?.kind === "enter" && entry.event.from === "drop") return true;
  return generationBreak(db, s.players[entry.owner]) >= 1 && hollowPayoff(db[at.inst.key]);
}

export function wantUse(db: CardDB, s: GameState, entry: QueueEntry): boolean {
  if (!entry.optional) return true;
  const ps = s.players[entry.owner];
  const ab = entry.ability;
  if (ab.effect[0] === "hollow(self)") return wantHollow(db, s, entry);
  for (const code of ab.cost ?? []) {
    const c = parseCode(code);
    const n = parseInt(c.pos[0] ?? "1", 10) || 1;
    if (c.name === "mill" && ps.deck.length <= n + 8) return false;
    if (c.name === "discard" && !ab.effect.some((e) => e.startsWith("no-hit"))) {
      const spare = ps.hand.filter((h) => h.uid !== entry.uid && keepValue(db, s, entry.owner, h) < 0.95);
      if (!spare.length) return false;
    }
  }
  return true;
}

// ลำดับที่ควรทำ: ได้ CC/SC ก่อน (เอาไปจ่ายคอสต์ต่อ) ฮอลโล่ว์ก่อน (ผลที่ต้องติดฮอลโล่ว์จะได้ทำงาน) ที่ต้องจ่าย CB ทีหลัง
function priority(entry: QueueEntry): number {
  const eff = entry.ability.effect.join(" ");
  const cost = (entry.ability.cost ?? []).join(" ");
  let v = 0;
  if (/\bCC\(|\bSC\(/.test(eff)) v += 3;
  if (entry.ability.effect[0] === "hollow(self)") v += 2;
  if (!entry.optional) v += 1;
  if (/CB\(/.test(cost)) v -= 1;
  return v;
}

function orderQueue(db: CardDB, s: GameState, p: PlayerId): Action {
  const q = ownQueue(s, p);
  const order = q.map((e, i) => ({ e, i })).sort((a, b) => priority(b.e) - priority(a.e));
  for (const { e, i } of order) if (wantUse(db, s, e)) return { type: "order-queue", index: i };
  const skip = q.findIndex((e) => e.optional);
  return skip >= 0 ? { type: "decline-queue", index: skip } : { type: "order-queue", index: 0 };
}

function choose(db: CardDB, s: GameState, p: PlayerId): Action {
  const c = s.awaiting!.choice!;
  const r = s.resolving;
  if (c.kind === "yesno") {
    if (c.prompt.key === "choice.hollow" && r) return { type: "choose", option: wantHollow(db, s, r) ? "yes" : "no" };
    return { type: "choose", option: r && wantUse(db, s, { ...r, optional: true }) ? "yes" : "no" };
  }
  if (c.kind === "option") {
    const ps = s.players[p];
    const cc = c.options.find((o) => o.startsWith("CC"));
    const sc = c.options.find((o) => o.startsWith("SC"));
    if (cc && ps.damage.some((d) => !d.faceUp) && (ps.soul.length >= 2 || !sc)) return { type: "choose", option: cc };
    if (sc) return { type: "choose", option: sc };
    return { type: "choose", option: c.options[0] };
  }
  return { type: "choose", option: "yes" };
}

function currentOp(s: GameState) {
  const r = s.resolving;
  return r ? parseCode(r.ops[r.i] ?? "") : undefined;
}

// ค่ายูนิทเมื่อคอลลงสนาม
function fieldValue(db: CardDB, inst: CardInstance, fromDrop: boolean) {
  const card = db[inst.key];
  return (card.power ?? 0) / 10000 + (fromDrop && dropCallPayoff(card) ? 1.5 : 0) + (hollowPayoff(card) ? 0.3 : 0) - (card.trigger ? 0.6 : 0);
}

// ค่าของการ์ดเมื่อส่งลงดรอปโซน (ค้นลงดรอป): ใบที่คอลจากดรอปได้ผลดี ไม่เอาทริกเกอร์ออกจากกอง
function dropValue(db: CardDB, inst: CardInstance) {
  const card = db[inst.key];
  return (dropCallPayoff(card) ? 2 : 0) + (card.abilities.some((a) => a.effect.includes("hollow(self)")) ? 1 : 0) + (card.type === "normal" && !card.trigger ? 0.5 : -1);
}

// ค่าของการ์ดที่ค้นขึ้นมือ: เกรดที่ยังไม่มีบนมือก่อน
function searchValue(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance) {
  const card = db[inst.key];
  const hand = s.players[p].hand;
  const have = hand.filter((h) => db[h.key].grade === card.grade).length;
  return keepValue(db, s, p, inst) + (have ? 0 : 1) + rideScore(card) * 0.2;
}

function threat(db: CardDB, s: GameState, q: PlayerId, inst: CardInstance) {
  const c = circleOf(s, q, inst.uid);
  const card = db[inst.key];
  return unitValue(db, inst) + (c && FRONT.includes(c) && !inst.rested ? 0.6 : 0) + (card.grade <= 1 && !inst.rested ? 0.3 : 0);
}

function selectTarget(db: CardDB, s: GameState, p: PlayerId): Action {
  const c = s.awaiting!.choice!;
  if (c.kind === "circle") return { type: "select-target", uids: [], to: pickCircle(db, s, p, c.options) };
  if (c.kind !== "cards") return { type: "select-target", uids: [] };
  const op = currentOp(s);
  const insts = c.options.map((u) => locate(s, u)?.inst).filter((i): i is CardInstance => !!i);
  const top = (score: (i: CardInstance) => number, n: number) =>
    [...insts].sort((a, b) => score(b) - score(a)).slice(0, n).map((i) => i.uid);
  const ps = s.players[p];
  const name = op?.name ?? "";
  const dst = op?.pos[0]?.split("→")[1];
  let uids: string[];
  switch (name) {
    case "discard": uids = top((i) => -keepValue(db, s, p, i), c.min); break;
    case "retire-own": uids = top((i) => -unitValue(db, i) + (hollowPayoff(db[i.key]) || dropCallPayoff(db[i.key]) ? 0.2 : 0), c.min); break;
    case "search":
      uids = dst === "hand" ? top((i) => searchValue(db, s, p, i), c.max)
        : insts.filter((i) => dropValue(db, i) > 0).sort((a, b) => dropValue(db, b) - dropValue(db, a)).slice(0, c.max).map((i) => i.uid);
      break;
    case "call":
      if (dst === "GC") {
        const byGrade = new Map<number, CardInstance>();
        for (const i of [...insts].sort((a, b) => shieldOf(db, b) - shieldOf(db, a))) if (!byGrade.has(db[i.key].grade)) byGrade.set(db[i.key].grade, i);
        uids = [...byGrade.values()].sort((a, b) => shieldOf(db, b) - shieldOf(db, a)).slice(0, c.max).map((i) => i.uid);
      } else {
        const fromDrop = (op?.pos[0] ?? "").includes("drop");
        const best = top((i) => fieldValue(db, i, fromDrop && ps.drop.some((d) => d.uid === i.uid)), 1);
        const anyRoom = RC.some((rc) => !ps.circles[rc] || ps.circles[rc]!.hollowed);
        uids = c.min > 0 || anyRoom ? best : [];
      }
      break;
    case "retire": {
      const opp = other(p);
      uids = top((i) => threat(db, s, opp, i), c.max);
      break;
    }
    case "power": case "critical": case "shield": uids = top((i) => statTargetValue(db, s, p, i), c.max); break;
    case "swap": uids = []; break;
    default: uids = top(() => 0, Math.max(c.min, Math.min(1, c.max)));
  }
  if (uids.length < c.min) uids = [...uids, ...c.options.filter((u) => !uids.includes(u))].slice(0, c.min);
  return { type: "select-target", uids: uids.slice(0, c.max) };
}

// ยูนิทที่ได้ประโยชน์จาก Power เพิ่ม: ตัวที่ยังจะโจมตี หรือยังจะบูสท์
function statTargetValue(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance) {
  const c = circleOf(s, p, inst.uid);
  if (!c) return 0;
  if (s.turnPlayer !== p) return c === s.battle?.target ? 3 : c === "vc" ? 1 : 0;
  if (inst.rested) return 0;
  if (c === "vc") return 2.5;
  if (FRONT.includes(c)) return 2;
  const front = FRONT.find((f) => BEHIND[f] === c);
  return front && s.players[p].circles[front] && db[inst.key].grade <= 1 ? 1.5 : 0.2;
}

export function pickCircle(db: CardDB, s: GameState, p: PlayerId, options: Circle[]): Circle | undefined {
  const ps = s.players[p];
  const r = s.resolving;
  const uid = r ? (r.local.card ? String(r.local.card) : r.uid) : undefined;
  const inst = uid ? locate(s, uid)?.inst : undefined;
  if (!inst) return options[0];
  const card = db[inst.key];
  const score = (c: Circle) => {
    const occ = ps.circles[c];
    let v = 0;
    const isFront = FRONT.includes(c);
    if (card.grade <= 1) {
      const front = FRONT.find((f) => BEHIND[f] === c);
      v += isFront ? 0.5 : front && ps.circles[front] ? (front === "vc" ? 3 : 2.5) : 1.5;
    } else v += isFront ? 3 : 0.2;
    if (occ) v -= occ.hollowed || occ.retireAtTurnEnd ? 0.4 : 1 + unitValue(db, occ) * 2;
    return v;
  };
  const best = [...options].sort((a, b) => score(b) - score(a))[0];
  return best && score(best) > -0.5 ? best : undefined;
}

// ---------- ทริกเกอร์ ----------

function triggerTarget(db: CardDB, s: GameState, p: PlayerId): Action {
  const b = s.battle!;
  const t = b.pendingTrigger!;
  const ps = s.players[p];
  const heal = () => {
    if (t.kind !== "heal") return undefined;
    const down = ps.damage.find((d) => !d.faceUp);
    return (down ?? ps.damage.at(-1))?.uid;
  };
  if (t.during === "damage" || s.turnPlayer !== p) return { type: "trigger-target", powerTo: "vc", extraTo: t.kind === "critical" ? "vc" : undefined, healUid: heal() };
  const opp = s.players[other(p)];
  const ap = powerOf(db, ps, b.attacker);
  const dp = powerOf(db, opp, b.target) + opp.guardian.reduce((n, g) => n + shieldOf(db, g), 0);
  const blocked = b.noHit || !opp.circles[b.target];
  // ยูนิทแถวหน้าที่ยังไม่โจมตี และ Power +5000 ทำให้แรงกดดันเพิ่ม
  const oppVc = powerOf(db, opp, "vc");
  const waiting = (["front_left", "front_right"] as Circle[]).filter((c) => ps.circles[c] && !ps.circles[c]!.rested)
    .sort((x, y) => {
      const gain = (c: Circle) => forced(attackPower(db, ps, c, BEHIND[c]) + 5000, oppVc) - forced(attackPower(db, ps, c, BEHIND[c]), oppVc);
      return gain(y) - gain(x) || attackPower(db, ps, y, BEHIND[y]) - attackPower(db, ps, x, BEHIND[x]);
    });
  const willHitWith = (extra: number) => !blocked && ap + extra >= dp;
  if (t.kind === "stand") {
    const rested = (["front_left", "front_right"] as Circle[]).filter((c) => ps.circles[c]?.rested).sort((x, y) => powerOf(db, ps, y) - powerOf(db, ps, x))[0];
    if (rested && b.attacker !== rested) return { type: "trigger-target", powerTo: willHitWith(0) || !willHitWith(5000) ? rested : b.attacker, extraTo: rested };
  }
  const powerTo: Circle = willHitWith(5000) && !willHitWith(0) ? b.attacker : waiting[0] ?? b.attacker;
  if (t.kind === "critical") {
    const hits = willHitWith(powerTo === b.attacker ? 5000 : 0);
    const extraTo: Circle = hits && b.target === "vc" ? b.attacker : waiting[0] ?? b.attacker;
    return { type: "trigger-target", powerTo, extraTo };
  }
  return { type: "trigger-target", powerTo, healUid: heal() };
}
