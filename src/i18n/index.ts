import { fmt } from "../lib/format";
import { en } from "./en";
import { ja } from "./ja";
import type { Dict, Msg, MsgKey, Params } from "./msg";
import { th } from "./th";

export type Locale = "th" | "en" | "ja";

// ชื่อภาษาแสดงด้วยภาษานั้นเอง ไม่แปล
export const LOCALES: Record<Locale, string> = { th: "ไทย", en: "English", ja: "日本語" };
export const DEFAULT_LOCALE: Locale = "th";

const DICTS: Record<Locale, Dict> = { th, en, ja };

export function translate(locale: Locale, m: Msg | MsgKey, params?: Params): string {
  const { key, params: p = {} } = typeof m === "string" ? { key: m, params } : m;
  const vals: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) vals[k] = typeof v === "number" ? fmt(v) : typeof v === "string" ? v : translate(locale, v);
  const tpl = DICTS[locale][key];
  return typeof tpl === "function" ? tpl(vals) : tpl.replace(/\{(\w+)\}/g, (all, k: string) => vals[k] ?? all);
}

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && v in LOCALES;
