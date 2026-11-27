import { describe, expect, it } from "vitest";
import { codePath, nextSteps, templateFor } from "./abilityDraft";

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
