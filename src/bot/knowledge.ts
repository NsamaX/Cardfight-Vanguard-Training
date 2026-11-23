// ความรู้เรื่องค่าของการ์ดที่บอทใช้ร่วมกัน (หน่วย = "การ์ด 1 ใบ" โดยประมาณ)
import { generationBreak, isG, isSentinel, printedShield, vcGrade, type CardDB } from "../engine/rules";
import type { Ability, Card, CardInstance, GameState, PlayerId } from "../engine/types";
import { isHidden } from "./view";

const json = (ab: Ability) => [ab.timing ?? "", ...(ab.cond ?? []), ...(ab.cost ?? []), ...ab.effect].join(" ");

// การ์ดได้ประโยชน์จากการติดฮอลโล่ว์ (มีผลที่ต้องติดฮอลโล่ว์ หรือทำงานเมื่อถูกรีไทร์เพราะฮอลโล่ว์)
export const hollowPayoff = (card: Card) => card.abilities.some((ab) => /self-hollowed|by=hollow/.test(json(ab)));

// มีผลเมื่อถูกคอลจากดรอปโซน
export const dropCallPayoff = (card: Card) => card.abilities.some((ab) => ab.kind === "AUTO" && /^enter\(RC, self, from=drop\)/.test(ab.timing ?? ""));

// มีผลเมื่อถูกคอลจากมือ (ไม่นับฮอลโล่ว์ตัวเอง)
export const handCallPayoff = (card: Card) => card.abilities.some((ab) =>
  ab.kind === "AUTO" && /^enter\(RC, self(, from=hand)?\)$/.test(ab.timing ?? "") && !ab.effect.every((e) => /^(hollow|retire)\(self/.test(e)));

const vcAbilityCount = (card: Card) => card.abilities.filter((ab) =>
  (ab.zone ?? "").includes("VC") || /^(ridden-upon|enter\(VC)/.test(ab.timing ?? "")).length;

export const rcAbilityCount = (card: Card) => card.abilities.filter((ab) =>
  ab.kind !== "CONT" && ((ab.zone ?? "").includes("RC") || /enter\(RC/.test(ab.timing ?? ""))).length;

export const shieldIn = (db: CardDB, inst: CardInstance) => (isHidden(inst) ? 6000 : printedShield(db[inst.key]));

// ค่าของการ์ดบนมือ: Shield ที่ใช้การ์ดได้ + การ์ดสำคัญที่ต้องเก็บไว้ไรด์/สไตรด์/คอล G การ์เดี้ยน
export function keepValue(db: CardDB, s: GameState, p: PlayerId, inst: CardInstance): number {
  if (isHidden(inst)) return 0.9;
  const ps = s.players[p];
  const card = db[inst.key];
  if (isG(card)) return 2;
  let v = 0.55 + printedShield(card) / 10000 * 0.55;
  if (isSentinel(card)) v += 0.9;
  if (card.trigger === "heal" && ps.gZone.some((g) => !g.faceUp && db[g.key].type === "g-guardian")) v += 0.35;
  const g = vcGrade(db, ps);
  const sameGrade = ps.hand.filter((h) => !isHidden(h) && db[h.key].grade === card.grade && !isG(db[h.key]));
  if (card.grade === g + 1 && card.grade <= 3) v += sameGrade[0]?.uid === inst.uid ? 1.6 : 0.1;   // ใบที่ต้องใช้ไรด์เทิร์นหน้า
  if (card.grade === 3 && g >= 3 && sameGrade[0]?.uid === inst.uid) v += 0.35;                   // ทิ้งเป็นคอสต์สไตรด์เทิร์นหน้า
  if (handCallPayoff(card)) v += 0.15;
  return v;
}

// ค่าของยูนิทบนสนาม (ใช้ตอนเลือกยูนิทที่จะเสีย)
export function unitValue(db: CardDB, inst: CardInstance): number {
  const card = db[inst.key];
  if (inst.hollowed || inst.retireAtTurnEnd) return 0.1;
  return 0.35 + (card.power ?? 0) / 25000 + (dropCallPayoff(card) ? 0.1 : 0) + (hollowPayoff(card) ? 0.1 : 0);
}

// คะแนนไรด์: ความสามารถตอนเป็นแวนการ์ดสูง ความสามารถเรียร์การ์ดต่ำ ไม่ไรด์พิทักษ์
export function rideScore(card: Card): number {
  return vcAbilityCount(card) * 1.0 - rcAbilityCount(card) * 0.4 - (isSentinel(card) ? 5 : 0) - (card.trigger ? 3 : 0);
}

// คะแนน G ยูนิท: ความสามารถที่ใช้ได้จริงหลังสไตรด์
export function strideScore(db: CardDB, s: GameState, p: PlayerId, g: CardInstance): number {
  const ps = s.players[p];
  const card = db[g.key];
  const gb = generationBreak(db, ps) + 1;
  const cb = ps.damage.filter((d) => d.faceUp).length;
  const copies = ps.gZone.filter((x) => !x.faceUp && x.key === g.key).length;
  let v = 0.1 * copies;
  for (const ab of card.abilities) {
    if (ab.kind === "STRIDE" || ab.kind === "CONT") continue;
    const need = (ab.cond ?? []).map((c) => c.match(/GB\((\d+)\)/)).find(Boolean);
    if (need && gb < +need[1]) continue;
    const cost = ab.cost ?? [];
    const cbNeed = cost.map((c) => c.match(/^CB\((\d+)\)/)).find(Boolean);
    if (cbNeed && cb < +cbNeed[1]) continue;
    if (cost.some((c) => c.includes("same-name")) && copies < 2) continue;
    if (ab.kind === "ACT" && (ab.zone ?? "").includes("G")) continue;   // ACT จาก G โซน
    // ดูดรอปโซน: คอลจากดรอปคุ้มเมื่อมียูนิทให้คอล ถ้ายังไม่มี ตัวที่ส่งการ์ดลงดรอปคุ้มกว่า
    const callable = ps.drop.filter((d) => !isHidden(d) && db[d.key].type === "normal" && !db[d.key].trigger).length;
    if (ab.effect.some((x) => x.startsWith("call(drop→RC"))) v += 1.5 * Math.min(1, callable / 2);
    else if (ab.effect.some((x) => x.startsWith("search(deck→drop"))) v += callable < 2 ? 2 : 0.8;
    else v += /call\(/.test(json(ab)) ? 1.5 : 1;
  }
  return v;
}
