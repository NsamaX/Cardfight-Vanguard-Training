import type { Action } from "../engine/types";
import content from "./content.json";

// คอมโบ tutorial จาก content/combos/*.yaml รูปแบบไฟล์ดูตัวอย่างใน content/combos/off-turn-shot.yaml

export interface ComboStep {
  action: Action["type"];
  hint: string;
  [param: string]: unknown;   // พารามิเตอร์ของ action เช่น card, to, option
}

export interface Combo {
  id: string;
  name: string;
  difficulty: number;
  summary: string;
  tags: string[];
  setup: Record<string, unknown>;
  steps: ComboStep[];
  result: string;
}

export const combos: Combo[] = (content.combos as unknown as Combo[])
  .slice()
  .sort((a, b) => a.difficulty - b.difficulty);
