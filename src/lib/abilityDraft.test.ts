import { describe, expect, it } from "vitest";
import { cards } from "../data/cards";
import { validateCard } from "../engine/vocab";
import { SLOT, codePath, codeTemplates, fill, filterTemplates, filterTerms, fromGrantDraft, joinFilter, joinParts, nextSteps, splitParts, templateFor, templateOf, toGrantDraft, valuesOf } from "./abilityDraft";

const T = ["enter(RC, self)", "enter(RC, self, from=drop)", "enter(GC, self)", "CC(#, if=name-in-drop(\"A, B\"))", "self-hollowed"];

describe("code picker steps", () => {
  it("splits a template at top-level commas only", () => {
    expect(codePath("CC(#, if=name-in-drop(\"A, B\"))")).toEqual(["CC", "#", "if=name-in-drop(\"A, B\")"]);
    expect(codePath("self-hollowed")).toEqual(["self-hollowed"]);
  });

  it("offers one step at a time", () => {
    expect(nextSteps(T, []).options).toEqual(["enter", "CC", "self-hollowed"]);
    expect(nextSteps(T, ["enter"]).options).toEqual(["RC", "GC"]);
    expect(nextSteps(T, ["enter", "RC", "self"])).toEqual({ options: ["from=drop"], ends: true });
  });

  it("a choice leads to the template that stops there, else the first that continues", () => {
    expect(templateFor(T, ["enter", "RC", "self"])).toBe("enter(RC, self)");
    expect(templateFor(T, ["enter", "GC"])).toBe("enter(GC, self)");
  });
});

describe("code templates", () => {
  it("quoted texts become text fields and numbers number fields, and fill puts them back", () => {
    const code = 'power(+3000, other-own, n≤1, filter=name("Regalia"))';
    const tpl = templateOf(code);
    expect(tpl).toBe('power(+#, other-own, n≤#, filter=name("$"))');
    expect(valuesOf(code)).toEqual([{ text: false, v: "3000" }, { text: false, v: "1" }, { text: true, v: "Regalia" }]);
    expect(fill(tpl, ["5000", "2", "Nightrose"])).toBe('power(+5000, other-own, n≤2, filter=name("Nightrose"))');
  });

  it("offers codes from the engine's vocabulary that no card uses yet, and every offered effect is valid", () => {
    const effects = codeTemplates("effect");
    expect(effects).toContain("opp-retires(opp-RC, n=#)");
    expect(effects).toContain("shield(+#, own-VC, until=battle-end)");
    expect(codeTemplates("cond")).toContain("hand≥#");
    const card = { ...cards[0], abilities: effects.map((e) => ({ kind: "AUTO" as const, timing: "turn-end", effect: [joinParts(fill(e, []), {})] })) };
    expect(validateCard(card)).toEqual([]);
  });
});

describe("filter and granted ability parts", () => {
  it("a filter and a granted ability become slots, and go back unchanged", () => {
    const code = 'grant(AUTO-VC/RC[attack-hit(self, target=VC) → look(2, hand=1, soul=1)], front-row ≤3, until=turn-end)';
    const { code: base, parts } = splitParts(code);
    expect(base).toBe(`grant(${SLOT.ability}, front-row ≤3, until=turn-end)`);
    expect(joinParts(base, parts)).toBe(code);
    const f = splitParts('to-soul(drop, n≤2, filter=normal-unit & name("Regalia"))');
    expect(f.code).toBe(`to-soul(drop, n≤2, ${SLOT.filter})`);
    expect(filterTerms(f.parts.filter!)).toEqual(["normal-unit", 'name("Regalia")']);
    expect(joinParts(f.code, { filter: joinFilter(["grade-3", 'name("X")']) })).toBe('to-soul(drop, n≤2, filter=grade-3 & name("X"))');
  });

  it("a granted ability round-trips through its draft, with several effects joined by &", () => {
    const g = toGrantDraft("AUTO-RC[battle-end(self, did=attack) → swap(self, other-own-RC)]");
    expect(g).toEqual({ kind: "AUTO", zone: "RC", timing: "battle-end(self, did=attack)", cost: [], effect: ["swap(self, other-own-RC)"] });
    expect(fromGrantDraft({ ...g, effect: [...g.effect, "draw(1)"] })).toBe("AUTO-RC[battle-end(self, did=attack) → swap(self, other-own-RC) & draw(1)]");
    expect(fromGrantDraft({ kind: "ACT", zone: "VC", timing: "", cost: ["SB(6)"], effect: ["power(+10000, self)", "critical(+1, self)"] }))
      .toBe("ACT-VC[SB(6) → power(+10000, self) & critical(+1, self)]");
  });

  it("templates hold one slot per filter / granted ability instead of every combination", () => {
    const effects = codeTemplates("effect");
    expect(effects).toContain(`grant(${SLOT.ability}, called, until=turn-end)`);
    expect(effects).toContain(`to-soul(drop, n≤#, ${SLOT.filter})`);
    expect(effects.some((e) => e.includes("filter=name"))).toBe(false);
    expect(filterTemplates()).toContain('name("$")');
  });
});
