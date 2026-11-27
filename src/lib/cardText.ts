import type { AbilityKind } from "../engine/types";

// Card text is stored in a markdown layout that the inspector splits into ability boxes (see skillBlocks.ts):
//   ### AUTO
//
//   - **Condition:** GB1 | **Timing:** When this unit is placed on (GC) | **Cost:** SB1
//     - **Effect:** You may pay the cost. ...
//   - Hollow
// The card editor shows and edits it as plain text instead, one "Label: value" per line, a blank line between abilities:
//   AUTO
//   Condition: GB1
//   Timing: When this unit is placed on (GC)
//   Cost: SB1
//   Effect: You may pay the cost. ...
//
//   Hollow
// Text that has no ability-kind headings (free text) is left as it is both ways.

const KINDS: AbilityKind[] = ["AUTO", "ACT", "CONT", "STRIDE", "ULTIMATE STRIDE", "G GUARDIAN"];
const LABEL = /^(Zone|Condition|Timing|Cost|Effect):\s*(.*)$/;

export function toPlainText(md: string): string {
  if (!/^### /m.test(md)) return md;
  const out: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith("### ")) {
      if (out.length) out.push("");
      out.push(line.slice(4).trim());
      continue;
    }
    const sub = line.match(/^\s+- \*\*Effect:\*\*\s*(.*)$/);
    if (sub) { out.push(`Effect: ${sub[1]}`); continue; }
    const top = line.match(/^- (.*)$/);
    if (!top) continue;
    if (!KINDS.includes(out[out.length - 1] as AbilityKind)) out.push("");   // blank line between abilities of the same kind
    const parts = top[1].split(" | ").map((p) => p.match(/^\*\*(\w+):\*\*\s*(.*)$/));
    if (parts.every(Boolean)) for (const m of parts) out.push(`${m![1]}: ${m![2]}`);
    else out.push(top[1]);
  }
  return out.join("\n");
}

export function fromPlainText(plain: string): string {
  const lines = plain.split(/\r?\n/).map((l) => l.trim());
  if (!lines.some((l) => KINDS.includes(l as AbilityKind))) return plain;
  const sections: { kind: string; items: string[] }[] = [];
  let top: string[] = [], subs: string[] = [];
  const close = () => {
    const s = sections[sections.length - 1];
    if (s && (top.length || subs.length)) {
      s.items.push(top.length ? `- ${top.join(" | ")}` : `- ${subs.shift()}`);
      for (const e of subs) s.items.push(`  - **Effect:** ${e}`);
    }
    top = []; subs = [];
  };
  for (const l of lines) {
    if (!l) { close(); continue; }
    if (KINDS.includes(l as AbilityKind)) { close(); sections.push({ kind: l, items: [] }); continue; }
    if (!sections.length) sections.push({ kind: "AUTO", items: [] });
    const m = l.match(LABEL);
    if (m?.[1] === "Effect") { subs.push(m[2]); continue; }
    if (m) {
      if (subs.length) close();
      top.push(`**${m[1]}:** ${m[2]}`);
      continue;
    }
    close();
    sections[sections.length - 1].items.push(`- ${l}`);
  }
  close();
  return sections.map((s) => `### ${s.kind}\n\n${s.items.join("\n")}`).join("\n\n");
}
