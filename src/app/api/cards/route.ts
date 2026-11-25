// แก้การ์ดในคลังจากหน้าแก้การ์ด: เขียนกลับลง content/cards/*.yaml แล้วแปลง content.json ใหม่ (ใช้ได้เฉพาะ npm run dev)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Card } from "../../../engine/types";
import { cardToYaml } from "../../../lib/cardYaml";

const SOURCE = /^content\/cards\/[\w-]+\/[^/]+\.yaml$/;

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "dev only" }, { status: 403 });
  const card = (await req.json()) as Card;
  if (!SOURCE.test(card.source) || card.source.includes("..")) return Response.json({ error: "bad source" }, { status: 400 });
  const root = process.cwd();
  const path = join(root, card.source);
  const eol = readFileSync(path, "utf8").includes("\r\n") ? "\r\n" : "\n";
  const src = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  writeFileSync(path, cardToYaml(src, card).replace(/\n/g, eol));
  execFileSync(process.execPath, [join(root, "scripts/gen-content.mjs")]);
  return Response.json({ ok: true });
}
