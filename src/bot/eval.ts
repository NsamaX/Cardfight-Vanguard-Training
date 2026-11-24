// คะแนนสนามจากมุมมองของผู้เล่น p (หน่วย = การ์ด 1 ใบ) ใช้ตัดสินผลของการจำลองแต่ละรอบ
import { BEHIND, FRONT, canBoost, generationBreak, isSentinel, other, powerOf, type CardDB } from "../engine/rules";
import type { GameState, PlayerId } from "../engine/types";
import { keepValue, unitValue } from "./knowledge";
import { isHidden } from "./view";

export const WIN = 60;
// ราคาของการอยู่ที่ดาเมจ n: ทุกดาเมจพาเข้าใกล้ 6 (เกือบเป็นเส้นตรง) และดาเมจ 5 อันตรายมาก เพราะโดนอีกครั้งเดียวแพ้
export const DAMAGE_COST = [0, 0.6, 1.2, 1.85, 2.75, 4.3];
export const CB_VALUE = 0.15;
// เกรดของแวนการ์ด: เกรดต่ำกว่าคู่แข่ง = คอลเกรดสูงไม่ได้ สไตรด์ไม่ได้ Power ต่ำ
const GRADE_VALUE = 1.4;

function side(db: CardDB, s: GameState, p: PlayerId): number {
  const ps = s.players[p], opp = s.players[other(p)];
  let v = -DAMAGE_COST[Math.min(5, ps.damage.length)];
  const vc = ps.circles.vc ? db[ps.circles.vc.key] : undefined;
  v += (vc?.type === "g-unit" && ps.heart ? db[ps.heart.key].grade : vc?.grade ?? 0) * GRADE_VALUE;
  // CB 2 แต้มแรกมีค่ามาก (ต้องมีไว้ใช้คอมโบ/G การ์เดี้ยนนอกเทิร์น) ที่เกินจากนั้นค่าลดลง
  const cb = ps.damage.filter((d) => d.faceUp).length;
  v += Math.min(cb, 2) * 0.35 + Math.max(0, cb - 2) * CB_VALUE;
  for (const h of ps.hand) v += keepValue(db, s, p, h);
  // กันได้ด้วยพิทักษ์/G การ์เดี้ยนช่วยตอนดาเมจสูง
  if (ps.damage.length >= 4 && ps.hand.some((h) => !isHidden(h) && isSentinel(db[h.key]))) v += 0.4;
  const oppVc = powerOf(db, opp, "vc") || 1;
  for (const c of FRONT) {
    const u = ps.circles[c];
    if (!u) continue;
    if (c !== "vc") v += unitValue(db, u);
    const b = BEHIND[c];
    const bu = b ? ps.circles[b] : undefined;
    const boost = bu && canBoost(db[bu.key]) && !bu.hollowed ? (db[bu.key].power ?? 0) : 0;
    if (bu) v += unitValue(db, bu) * (boost ? 1 : 0.4);
    const col = (c === "vc" ? powerOf(db, ps, c) : db[u.key].power ?? 0) + boost;
    if (col >= oppVc) v += 0.25 + Math.min(2, Math.floor((col - oppVc) / 5000)) * 0.15;
  }
  v += generationBreak(db, ps) * 0.25 + ps.gZone.filter((g) => !g.faceUp).length * 0.08;
  v += Math.min(ps.soul.length, 5) * 0.06 + Math.min(ps.drop.length, 15) * 0.02;
  if (ps.deck.length < 10) v -= (10 - ps.deck.length) * 0.35;
  return v;
}

export function evaluate(db: CardDB, s: GameState, p: PlayerId): number {
  if (s.winner) return s.winner === p ? WIN : -WIN;
  return side(db, s, p) - side(db, s, other(p));
}
