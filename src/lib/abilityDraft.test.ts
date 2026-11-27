import { describe, expect, it } from "vitest";
import { cards } from "../data/cards";
import { validateCard } from "../engine/vocab";
import { codePath, codeTemplates, fill, nextSteps, templateFor, templateOf, valuesOf } from "./abilityDraft";

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
    const card = { ...cards[0], abilities: effects.map((e) => ({ kind: "AUTO" as const, timing: "turn-end", effect: [fill(e, [])] })) };
    expect(validateCard(card)).toEqual([]);
  });
});
