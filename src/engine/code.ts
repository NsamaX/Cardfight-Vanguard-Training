// Parses ability code from card files, e.g. call(drop→RC, n≤1, filter=grade≤2 & not-same-name), into a data structure

export interface Code {
  name: string;
  pos: string[];                     // positional arguments, e.g. "drop→RC", "n≤1"
  named: Record<string, string>;     // name=value arguments, e.g. filter, to, until, if
}

// Split on the separator only at the top level (not inside () [] or quotes)
export function splitTop(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quoted = false, cur = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === "(" || ch === "[")) depth++;
    if (!quoted && (ch === ")" || ch === "]")) depth--;
    if (!quoted && depth === 0 && src.startsWith(sep, i)) {
      out.push(cur.trim());
      cur = "";
      i += sep.length - 1;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Codes come from card files, which are limited in number, so cache the results (the bot simulates thousands of steps per decision); callers must not modify the result
const cache = new Map<string, Code>();

export function parseCode(src: string): Code {
  let c = cache.get(src);
  if (!c) { c = parse(src); cache.set(src, c); }
  return c;
}

function parse(src: string): Code {
  const open = src.indexOf("(");
  if (open < 0) return { name: src.trim(), pos: [], named: {} };
  const name = src.slice(0, open).trim();
  const inner = src.slice(open + 1, src.lastIndexOf(")"));
  const pos: string[] = [];
  const named: Record<string, string> = {};
  for (const part of splitTop(inner, ",")) {
    const m = part.match(/^([a-zA-Z][\w-]*)=([\s\S]*)$/);
    if (m) named[m[1]] = m[2].trim(); else pos.push(part);
  }
  return { name, pos, named };
}

export const quoted = (s: string) => s.match(/"([^"]*)"/)?.[1] ?? "";
