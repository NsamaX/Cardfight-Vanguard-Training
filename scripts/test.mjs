// On Windows, if the working directory starts with a lowercase drive letter (d:\), vitest can't find the tests
// This script re-runs vitest with an uppercase drive letter
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cwd = process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase());
const vitest = createRequire(import.meta.url).resolve("vitest/vitest.mjs");
const r = spawnSync(process.execPath, [vitest, "run", ...process.argv.slice(2)], { cwd, stdio: "inherit" });
process.exit(r.status ?? 1);
