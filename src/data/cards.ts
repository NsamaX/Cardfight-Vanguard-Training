import type { Card } from "../engine/types";
import content from "./content.json";

// การ์ดทุกใบจาก content/cards/*/*.yaml (แปลงเป็น JSON โดย scripts/gen-content.mjs) เพิ่มการ์ดใหม่ = เพิ่มไฟล์ .yaml แล้วรีสตาร์ต dev server
type CardFile = Omit<Card, "key" | "power" | "powerPlus" | "image" | "triggerPower"> & { power?: number | string; trigger_power?: number };

const images = new Set(content.images);

export const cardKey = (id: string) => id.split(" ")[0];
const imageName = (key: string) => key.replace("/", "_") + ".png";

function toCard({ power, trigger_power, ...file }: CardFile): Card {
  const key = cardKey(file.ids[0]);
  const powerText = power != null ? String(power) : undefined;
  return {
    ...file,
    key,
    power: powerText ? parseInt(powerText, 10) : undefined,
    powerPlus: powerText?.endsWith("+"),
    triggerPower: trigger_power,
    abilities: file.abilities ?? [],
    image: images.has(imageName(key)) ? "/images/" + imageName(key) : undefined,
    text: file.text?.trim() ?? "",
  };
}

export const cards: Card[] = (content.cards as unknown as CardFile[]).map(toCard);

export const cardByKey: Record<string, Card> = Object.fromEntries(cards.map((c) => [c.key, c]));
