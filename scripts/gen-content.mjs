// Converts cards/decks/combos (.yaml) in content/ into src/data/content.json before dev/build/test, so the browser doesn't need a yaml library
// After adding or editing data files, restart the dev server (or run npm run content)
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..");
const load = (pattern) =>
  globSync(pattern, { cwd: root }).sort().map((p) => ({ path: p.replaceAll("\\", "/"), data: parse(readFileSync(join(root, p), "utf8")) }));

const content = {
  cards: load("content/cards/*/*.yaml").map(({ data }) => data),
  decks: load("content/decks/*.yaml").map(({ path, data }) => ({ id: basename(path, ".yaml"), ...data })),
  combos: load("content/combos/*.yaml").map(({ data }) => data),
};

writeFileSync(join(root, "src/data/content.json"), JSON.stringify(content));
