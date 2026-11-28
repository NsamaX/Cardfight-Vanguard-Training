import type { Ability, AbilityKind } from "../engine/types";

// One ability on a card: the text the player reads (from the text field) paired with its code in abilities
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

// The text field is split into sections by kind, and within a kind follows the abilities order, so they pair by order within the kind
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

// What an ability does, as one line of plain text for a tooltip: the card text's block for it, or its code (granted abilities have no text)
export function abilitySummary(text: string, abilities: Ability[], ab: Ability): string {
  const b = parseBlocks(text, abilities).find((x) => x.ability === ab) ?? blocksFromCodes([ab])[0];
  const plain = (s: string) => s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return [b.timing && `Timing: ${plain(b.timing)}`, b.cost && `Cost: ${plain(b.cost)}`, plain(b.effect)].filter(Boolean).join(" | ");
}

// A text field not written in the ### format (cards created in the app): build the boxes from the code instead
export const blocksFromCodes = (abilities: Ability[]): SkillBlock[] => abilities.map((a) => ({
  kind: a.kind, zone: a.zone, timing: a.timing, cond: a.cond?.join(", "), cost: a.cost?.join(", "), effect: a.effect.join(", "), ability: a,
}));
