// เขียนการ์ดที่แก้ในโปรแกรมกลับลงไฟล์ .yaml (ใช้ฝั่ง server เท่านั้น) แก้เฉพาะช่องที่หน้าแก้การ์ดแก้ได้ ช่องอื่น เช่น ids, notes คงเดิม
// รูปแบบตามไฟล์ที่เขียนมือ: ข้อความใน "", รายการรหัสเป็น [..] บรรทัดเดียว, text เป็น block |
import { Document, isMap, parseDocument, Scalar, YAMLMap, YAMLSeq } from "yaml";
import type { Ability, Card } from "../engine/types";

const ORDER = ["ids", "name", "format", "type", "trigger", "grade", "power", "shield", "critical", "skill", "trigger_power", "race", "clan", "abilities", "text", "notes"];
const ABILITY_ORDER: (keyof Ability)[] = ["kind", "zone", "timing", "cond", "cost", "effect", "optional"];

const str = (v: string) => Object.assign(new Scalar(v), { type: Scalar.QUOTE_DOUBLE });
const flow = (doc: Document, list: string[]) => Object.assign(new YAMLSeq(doc.schema), { flow: true, items: list.map(str) });

function abilityNode(doc: Document, a: Ability): YAMLMap {
  const m = new YAMLMap(doc.schema);
  for (const k of ABILITY_ORDER) {
    const v = a[k];
    if (v == null) continue;
    m.set(k, Array.isArray(v) ? flow(doc, v) : typeof v === "string" ? str(v) : v);
  }
  return m;
}

export function cardToYaml(source: string, card: Card): string {
  const doc = parseDocument(source);
  if (!isMap(doc.contents)) throw new Error("not a card file");
  const fields: Record<string, unknown> = {
    name: str(card.name),
    type: card.type,
    trigger: card.type === "trigger" ? card.trigger : undefined,
    grade: card.grade,
    power: card.power == null ? undefined : card.powerPlus ? str(`${card.power}+`) : card.power,
    shield: card.shield,
    critical: card.critical,
    skill: card.skill,
    trigger_power: card.type === "trigger" ? card.triggerPower : undefined,
    race: str(card.race),
    clan: str(card.clan),
    abilities: Object.assign(new YAMLSeq(doc.schema), { items: card.abilities.map((a) => abilityNode(doc, a)) }),
    text: card.text.trim() ? Object.assign(new Scalar(card.text.trim() + "\n"), { type: Scalar.BLOCK_LITERAL }) : undefined,
  };
  const map = doc.contents as YAMLMap<unknown, unknown>;
  for (const [k, v] of Object.entries(fields)) {
    // ไฟล์เดิมไม่มี shield = 0 ไม่ต้องเพิ่มช่อง
    if (v == null || (k === "shield" && v === 0 && !map.has(k))) map.delete(k);
    else map.set(k, v);
  }
  map.items.sort((a, b) => ORDER.indexOf(String(a.key)) - ORDER.indexOf(String(b.key)));
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}
