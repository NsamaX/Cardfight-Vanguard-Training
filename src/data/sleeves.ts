import content from "./content.json";

// สลีฟจาก public/sleeves/ (รายชื่อไฟล์อ่านโดย scripts/gen-content.mjs)
export const sleeves: string[] = content.sleeves;

export const sleeveUrl = (file?: string) => (file && sleeves.includes(file) ? `/sleeves/${encodeURIComponent(file)}` : undefined);
