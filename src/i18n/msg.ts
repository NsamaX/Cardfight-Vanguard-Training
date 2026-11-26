// Text the engine and lib emit as a key + values; the screen translates into the chosen language when displaying
// Numeric values are formatted with fmt; nested Msgs are translated before substitution
import type { en } from "./en";

export type MsgKey = keyof typeof en;
export type Param = string | number | Msg;
export type Params = Record<string, Param>;

export interface Msg {
  key: MsgKey;
  params?: Params;
}

// A template is text with {name} placeholders, or a function (used when words change with count, e.g. English)
export type Template = string | ((p: Record<string, string>) => string);
export type Dict = Record<MsgKey, Template>;

export const msg = (key: MsgKey, params?: Params): Msg => (params ? { key, params } : { key });
