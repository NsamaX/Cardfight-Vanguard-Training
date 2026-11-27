// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardByKey as db } from "../../data/cards";
import { CardEditor } from "./CardEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement, root: Root;
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });

describe("card editor", () => {
  it("shows a granted ability and a multi-term filter with their own editors, and no problems for a supported card", () => {
    const verthandi = db["G-BT08/014TH"];
    act(() => root.render(<CardEditor initial={verthandi} onSave={async () => null} onCancel={() => {}} />));
    expect(el.querySelectorAll(".grant-pick").length).toBe(2);
    expect(el.querySelector(".code-problems")).toBeNull();
    const freyja = db["G-BT14/038TH"];
    act(() => root.render(<CardEditor key="f" initial={freyja} onSave={async () => null} onCancel={() => {}} />));
    expect(el.querySelectorAll(".nested-row").length).toBeGreaterThan(0);
  });

  it("lists codes the engine can't run", () => {
    const honoly = Object.values(db).find((c) => c.name.includes("Honoly"))!;
    act(() => root.render(<CardEditor initial={honoly} onSave={async () => null} onCancel={() => {}} />));
    expect(el.querySelector(".code-problems")?.textContent).toContain("attack-tax");
  });
});
