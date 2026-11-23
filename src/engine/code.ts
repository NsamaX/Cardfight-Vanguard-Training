// แปลงรหัสความสามารถในไฟล์การ์ด เช่น call(drop→RC, n≤1, filter=grade≤2 & not-same-name) เป็นโครงสร้างข้อมูล

export interface Code {
  name: string;
  pos: string[];                     // อาร์กิวเมนต์ตามตำแหน่ง เช่น "drop→RC", "n≤1"
  named: Record<string, string>;     // อาร์กิวเมนต์ชื่อ=ค่า เช่น filter, to, until, if
}

// แยกด้วยตัวคั่นเฉพาะระดับนอกสุด (ไม่ตัดในวงเล็บ () [] หรือในเครื่องหมายคำพูด)
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

export function parseCode(src: string): Code {
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
