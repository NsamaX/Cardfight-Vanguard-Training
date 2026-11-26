import type { Action } from "../engine/types";
import content from "./content.json";

// Tutorial combos from content/combos/*.yaml; see content/combos/off-turn-shot.yaml for the file format

export interface ComboStep {
  action: Action["type"];
  hint: string;
  [param: string]: unknown;   // action parameters, e.g. card, to, option
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
