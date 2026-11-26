import type { Card } from "../engine/types";

// Shared by the app (src/data/cards.ts) and scripts/sync-defaults.mjs, so both normalize .yaml cards the same way.
// Only type imports here: the sync script loads this file through Node's type stripping.

export type CardFile = Omit<Card, "key" | "power" | "powerPlus" | "image" | "triggerPower"> & { power?: number | string; trigger_power?: number };

export const cardKey = (id: string) => id.split(" ")[0];
export const imageName = (key: string) => key.replace("/", "_") + ".png";

export function toCard({ power, trigger_power, ...file }: CardFile): Card {
  const key = cardKey(file.ids[0]);
  const powerText = power != null ? String(power) : undefined;
  return {
    ...file,
    key,
    power: powerText ? parseInt(powerText, 10) : undefined,
    powerPlus: powerText?.endsWith("+"),
    triggerPower: trigger_power,
    abilities: file.abilities ?? [],
    text: file.text?.trim() ?? "",
  };
}
