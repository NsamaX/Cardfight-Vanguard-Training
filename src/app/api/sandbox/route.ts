// The sandbox replay that scripts/sandbox.ts writes, for the live view at /?sandbox; dev server only
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  const text = await readFile(join(process.cwd(), ".temp/sandbox.json"), "utf8").catch(() => undefined);
  if (text === undefined) return new Response(null, { status: 204 });
  return new Response(text, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
