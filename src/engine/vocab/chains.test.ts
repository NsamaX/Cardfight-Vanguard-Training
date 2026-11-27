import { describe, expect, it } from "vitest";
import { cardByKey as db, cards } from "../../data/cards";
import { causedBy, setsOff } from "./chains";

const card = (part: string) => cards.find((c) => c.name.includes(part))!;

describe("chain search", () => {
  it("an effect sets off the timings that wait for the moves it causes", () => {
    const nightFog = card("Night Fog"), serpent = card("King Serpent"), starlight = card("Starlight");
    const [mill, call] = causedBy(nightFog.abilities[0]);
    expect(mill.move).toEqual({ from: "deck", to: "drop" });
    expect(setsOff(db, call, nightFog, serpent, serpent.abilities[0])).toBe(true);           // enter(RC, self, from=drop)
    expect(setsOff(db, call, nightFog, starlight, starlight.abilities[1])).toBe(true);       // enter(RC, other-own, from=drop)
    expect(setsOff(db, mill, nightFog, serpent, serpent.abilities[0])).toBe(false);
  });

  it("a Soul Blast with a filter sets off only cards that pass it", () => {
    const minerva = card("Minerva"), norn = card("Norn"), dreaming = card("Dreaming Dragon");
    const sb = causedBy(minerva.abilities[1]).find((c) => c.move?.from === "soul")!;
    expect(setsOff(db, sb, minerva, norn, norn.abilities[0])).toBe(true);
    expect(setsOff(db, sb, minerva, dreaming, { kind: "AUTO", timing: "to-drop(self, from=soul)", effect: ["draw(1)"] })).toBe(false);
  });

  it("a G guardian's discard is a g-guardian-cost discard", () => {
    const eirG = card("Affection, Eir"), eir = card("Regalia of Service, Eir");
    const [discard] = causedBy(eirG.abilities[0]);
    expect(setsOff(db, discard, eirG, eir, eir.abilities[0])).toBe(true);
  });
});
