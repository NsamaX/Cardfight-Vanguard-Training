// ประเมินฝั่งคู่แข่งจากข้อมูลที่เห็นได้: มือ (การ์ดที่รู้ + คาดเดาจากการ์ดที่ยังไม่ปรากฏ), G การ์เดี้ยน, ทรัพยากร, แรงตีเทิร์นหน้า
// สนามที่สุ่มเติมแล้ว (ใช้ในการจำลอง) เห็นมือจริงทั้งหมด ค่าประเมินจึงเป็นค่าจริงของโลกที่สุ่มนั้น
import {
  BEHIND, FRONT, bothVanguardsGrade3, canBoost, criticalOf, generationBreak, isG, isSentinel, other, powerOf, printedShield, type CardDB,
} from "../engine/rules";
import type { Card, GameState, PlayerId } from "../engine/types";
import { intelOf, isHidden } from "./view";

const hasNoHit = (c: Card) => isSentinel(c) && c.abilities.some((a) => a.effect.some((e) => e.startsWith("no-hit")));

// ค่าเฉลี่ยต่อใบของการ์ดบนมือที่ไม่รู้ (จากการ์ดที่ยังไม่ปรากฏของ q)
function unknownCardStats(db: CardDB, s: GameState, q: PlayerId) {
  const pool = intelOf(s)?.pools[q].main;
  let n = 0, shield = 0, sentinel = 0, heal = 0, g3 = 0;
  for (const [k, x] of pool ?? []) {
    const c = db[k];
    if (!c || x <= 0 || isG(c)) continue;
    n += x;
    shield += x * (hasNoHit(c) ? 0 : printedShield(c));
    if (hasNoHit(c)) sentinel += x;
    if (c.trigger === "heal") heal += x;
    if (c.grade === 3) g3 += x;
  }
  return n ? { shield: shield / n, sentinel: sentinel / n, heal: heal / n, g3: g3 / n } : { shield: 6000, sentinel: 0.08, heal: 0.08, g3: 0.15 };
}

export interface Defense {
  shield: number;       // Shield ที่คาดว่ามีบนมือ (ไม่นับพิทักษ์)
  sentinels: number;    // จำนวนพิทักษ์ที่คาดว่ามี (กันได้การโจมตีละใบ ต้องมีการ์ดอื่นให้ทิ้ง)
  gGuard: number;       // Shield ที่คาดว่าได้จาก G การ์เดี้ยน (คูณโอกาสมี Heal)
  cards: number;
}

// การป้องกันที่คู่แข่ง q น่าจะมีในเทิร์นนี้
export function estimateDefense(db: CardDB, s: GameState, q: PlayerId): Defense {
  const ps = s.players[q];
  const st = unknownCardStats(db, s, q);
  const reads = intelOf(s)?.reads;
  let shield = 0, sentinels = 0, heals = 0, hidden = 0;
  for (const h of ps.hand) {
    if (isHidden(h)) { hidden++; continue; }
    const c = db[h.key];
    if (isG(c)) continue;
    if (hasNoHit(c)) sentinels++; else shield += printedShield(c);
    if (c.trigger === "heal") heals++;
  }
  // คู่แข่งที่ยอมรับดาเมจตอนดาเมจสูงบ่อย น่าจะมี Shield น้อยกว่าค่าเฉลี่ย
  const passive = Math.max(0.6, 1 - 0.12 * (reads?.oppPassive ?? 0));
  shield += hidden * st.shield * passive;
  sentinels += hidden * st.sentinel;
  const pHeal = heals > 0 ? 1 : 1 - (1 - st.heal) ** hidden;
  return { shield, sentinels, gGuard: gGuardianLeft(db, s, q) ? 15000 * pHeal : 0, cards: ps.hand.length };
}

// คู่แข่งยังคอล G การ์เดี้ยนได้ไหม (แวนการ์ดเกรด 3 ทั้งคู่ หงายไม่เกิน 3 ใบ เหลือใบคว่ำ)
export function gGuardianLeft(db: CardDB, s: GameState, q: PlayerId): boolean {
  if (!bothVanguardsGrade3(db, s)) return false;
  const ps = s.players[q];
  if (ps.gZone.filter((g) => g.faceUp && !isHidden(g) && db[g.key].type === "g-guardian").length > 3) return false;
  const known = ps.gZone.some((g) => !g.faceUp && !isHidden(g) && db[g.key].type === "g-guardian");
  const pool = intelOf(s)?.pools[q].g;
  const unseen = [...(pool ?? [])].some(([k, n]) => n > 0 && db[k]?.type === "g-guardian");
  return known || (unseen && ps.gZone.some((g) => !g.faceUp));
}

// ทรัพยากรที่คู่แข่งใช้ได้ (ใช้ตัดสินว่าคอมโบไหนของคู่แข่งทำงานได้)
export function resources(db: CardDB, s: GameState, q: PlayerId) {
  const ps = s.players[q];
  return { cb: ps.damage.filter((d) => d.faceUp).length, soul: ps.soul.length, gb: generationBreak(db, ps) };
}

// ภัยของยูนิทบนสนามของ q: Power, ความสามารถตอนโจมตี/จบการต่อสู้/บูสท์ที่ทำงานได้ด้วยทรัพยากรที่มี
export function unitThreat(db: CardDB, s: GameState, q: PlayerId, uid: string): number {
  const ps = s.players[q];
  const c = (Object.keys(ps.circles) as (keyof typeof ps.circles)[]).find((k) => ps.circles[k]?.uid === uid);
  const inst = c ? ps.circles[c] : undefined;
  if (!inst || !c) return 0;
  const card = db[inst.key];
  if (inst.hollowed || inst.retireAtTurnEnd) return 0.1;
  const res = resources(db, s, q);
  let v = 0.3 + (card.power ?? 0) / 20000;
  for (const ab of card.abilities) {
    if (ab.kind !== "AUTO" && ab.kind !== "ACT") continue;
    if (!/(RC|^$)/.test(ab.zone ?? "")) continue;
    const gb = (ab.cond ?? []).map((x) => x.match(/GB\((\d+)\)/)).find(Boolean);
    if (gb && res.gb < +gb[1]) continue;
    const cb = (ab.cost ?? []).map((x) => x.match(/^CB\((\d+)\)/)).find(Boolean);
    if (cb && res.cb < +cb[1]) continue;
    if (/attack\(self|battle-end\(self|boost/.test(ab.timing ?? "")) v += 0.5;
  }
  const front = FRONT.includes(c);
  if (!front && canBoost(card)) {
    const f = FRONT.find((x) => BEHIND[x] === c);
    if (f && ps.circles[f]) v += 0.3;   // ตัวบูสท์ของแนวที่มีตัวโจมตี
  }
  return v;
}

// แรงตีเทิร์นหน้าของคู่แข่ง q ใส่แวนการ์ดของ p: Shield รวมที่ p ต้องใช้กันการโจมตีที่โดนแล้วแพ้ (ไม่นับทริกเกอร์)
// แวนการ์ดคู่แข่งคิดเป็นสไตรด์ (15000 + ฮาร์ท) ถ้าสไตรด์ได้
// สนามเดียวกันได้คำตอบเดิม (ถูกเรียกซ้ำตอนเทียบการคอลทุกแบบ) เก็บไว้ใช้ซ้ำ
const needCache = new WeakMap<GameState, Partial<Record<PlayerId, number>>>();
export function nextTurnNeed(db: CardDB, s: GameState, p: PlayerId): number {
  const c = needCache.get(s) ?? {};
  if (c[p] === undefined) { c[p] = computeNextTurnNeed(db, s, p); needCache.set(s, c); }
  return c[p]!;
}

function computeNextTurnNeed(db: CardDB, s: GameState, p: PlayerId): number {
  const q = other(p);
  const ops = s.players[q], me = s.players[p];
  const dmg = me.damage.length;
  const def = powerOf(db, me, "vc");
  const vc = ops.circles.vc;
  if (!vc) return 0;
  const vcCard = db[vc.key];
  const heartPower = vcCard.type === "g-unit" && ops.heart ? db[ops.heart.key].power ?? 0 : vcCard.power ?? 0;
  const canStride = vcCard.grade >= 3 && ops.gZone.some((g) => !g.faceUp);
  let need = 0;
  for (const col of FRONT) {
    const u = col === "vc" ? vc : ops.circles[col];
    if (!u) continue;
    const b = ops.circles[BEHIND[col]!];
    const boost = b && canBoost(db[b.key]) ? db[b.key].power ?? 0 : 0;
    const base = col === "vc" ? (canStride ? 15000 + heartPower : heartPower) : db[u.key].power ?? 0;
    const crit = col === "vc" ? criticalOf(db, vc) : 1;
    if (dmg + crit + (col === "vc" ? 1 : 0) < 6) continue;   // แวนการ์ดเผื่อ Critical จากไดรฟ์เช็ค 1 ใบ
    const n = base + boost - def + 1;
    if (n > 0) need += Math.ceil(n / 5000) * 5000;
  }
  return need;
}
