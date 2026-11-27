// Lists ability codes in content/cards the engine doesn't know (unknown codes, conditions, filters, targets, amounts)
// Run: npm run check-cards
import { cards } from "../src/data/cards";
import { validateCard } from "../src/engine/vocab";

const problems = cards.flatMap(validateCard);
for (const p of problems) console.log(p);
console.log(problems.length ? `\n${problems.length} problem(s) in ${cards.length} cards` : `All ${cards.length} cards use known codes`);
