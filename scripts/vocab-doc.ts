// Writes the generated code reference (sections 1–8) into documents/vocabulary.md from the engine's registry
// Run: npm run vocab-doc
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cards } from "../src/data/cards";
import { vocabularyMarkdown, withGenerated } from "../src/engine/vocab/doc";

const file = join(import.meta.dirname, "../documents/vocabulary.md");
const doc = readFileSync(file, "utf8").replace(/\r\n/g, "\n");   // git may check it out with CRLF
writeFileSync(file, withGenerated(doc, vocabularyMarkdown(cards)));
console.log("documents/vocabulary.md updated");
