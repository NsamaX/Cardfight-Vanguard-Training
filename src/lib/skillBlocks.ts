import type { Ability, AbilityKind } from "../engine/types";

// ความสามารถหนึ่งอันบนการ์ด: ข้อความที่ผู้เล่นอ่าน (จากช่อง text) คู่กับรหัสใน abilities
export interface SkillBlock {
  kind: AbilityKind;
  zone?: string;
  cond?: string;
  timing?: string;
  cost?: string;
  effect: string;
  ability?: Ability;
}

const FIELDS = { Zone: "zone", Condition: "cond", Timing: "timing", Cost: "cost" } as const;

// ช่อง text แบ่งหัวข้อตามประเภท และในประเภทเดียวกันเรียงตาม abilities จึงจับคู่ด้วยลำดับในประเภทนั้นได้
export function parseBlocks(text: string, abilities: Ability[]): SkillBlock[] {
  const blocks: SkillBlock[] = [];
  let kind: AbilityKind | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("### ")) { kind = line.slice(4).trim() as AbilityKind; continue; }
    const top = line.match(/^- (.*)$/);
    const sub = line.match(/^\s+- \*\*Effect:\*\*\s*(.*)$/);
    if (top && kind) {
      const b: SkillBlock = { kind, effect: "" };
      const parts = top[1].split(" | ").map((p) => p.match(/^\*\*(\w+):\*\*\s*(.*)$/));
      if (parts.every((m) => m && m[1] in FIELDS)) {
        for (const m of parts) b[FIELDS[m![1] as keyof typeof FIELDS]] = m![2].trim();
      } else b.effect = top[1].trim();
      blocks.push(b);
    } else if (sub && blocks.length) {
      const b = blocks[blocks.length - 1];
      b.effect = b.effect ? `${b.effect}\n${sub[1]}` : sub[1];
    }
  }
  const seen: Partial<Record<AbilityKind, number>> = {};
  for (const b of blocks) {
    const i = seen[b.kind] ?? 0;
    seen[b.kind] = i + 1;
    b.ability = abilities.filter((a) => a.kind === b.kind)[i];
  }
  return blocks;
}

// ช่อง text ที่ไม่ได้เขียนตามรูปแบบ ### (การ์ดที่สร้างในโปรแกรม): ทำกล่องจากรหัสแทน
export const blocksFromCodes = (abilities: Ability[]): SkillBlock[] => abilities.map((a) => ({
  kind: a.kind, zone: a.zone, timing: a.timing, cond: a.cond?.join(", "), cost: a.cost?.join(", "), effect: a.effect.join(", "), ability: a,
}));
