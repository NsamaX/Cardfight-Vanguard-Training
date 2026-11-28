// Runs a TypeScript script with vite-node from an uppercase drive letter (D:\ not d:\): on Windows a lowercase one makes
// vite-node load some modules twice (e.g. two Supabase clients, one signed in and one not). Same fix as scripts/test.mjs.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cwd = process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase());
const bin = createRequire(import.meta.url).resolve("vite-node/vite-node.mjs");
const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: "inherit" });
process.exit(r.status ?? 1);
