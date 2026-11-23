// บน Windows ถ้า working directory ขึ้นต้นด้วยไดรฟ์ตัวเล็ก (d:\) vitest จะหาเทสต์ไม่เจอ
// สคริปต์นี้รัน vitest ใหม่โดยใช้ไดรฟ์ตัวใหญ่
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cwd = process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase());
const vitest = createRequire(import.meta.url).resolve("vitest/vitest.mjs");
const r = spawnSync(process.execPath, [vitest, "run", ...process.argv.slice(2)], { cwd, stdio: "inherit" });
process.exit(r.status ?? 1);
