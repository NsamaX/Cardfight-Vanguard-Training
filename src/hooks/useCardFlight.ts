import { useLayoutEffect, useRef, type RefObject } from "react";

export const MOVE_MS = 400;
export const MOVE_EASE = "cubic-bezier(.2,.7,.2,1)";
export const FLIP_MS = 200;
export const DEAL_GAP_MS = 90;   // several cards entering the hand/returning to the deck at once (game start/mulligan) go one at a time

// Center of a card on screen; turned = placed horizontally (rest/damage)
export interface Spot { x: number; y: number; turned: boolean }

const spotOf = (r: DOMRect): Spot => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, turned: r.width > r.height });
const flights = new WeakMap<HTMLElement, HTMLElement>();

// A card that moved on the board: hide the real one, and let its ghost fly from the old position to the new one
// The ghost lives in body, so it isn't clipped by the source/target zone and floats above other cards
// look: the ghost's appearance (unset = the card's look at its new place) delay: wait before flying; meanwhile the ghost stays at the old place
function fly(el: HTMLElement, from: Spot, to: Spot, look: HTMLElement = el, delay = 0) {
  const w = el.offsetWidth, h = el.offsetHeight;
  const ghost = look.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-uid");
  ghost.classList.remove("sel", "picked", "source", "active");
  ghost.classList.add("ghost");
  const css = getComputedStyle(el);
  for (const v of ["--sleeve", "--g-sleeve"]) ghost.style.setProperty(v, css.getPropertyValue(v));
  Object.assign(ghost.style, { left: `${to.x - w / 2}px`, top: `${to.y - h / 2}px`, width: `${w}px`, height: `${h}px` });
  document.body.appendChild(ghost);
  flights.get(el)?.remove();
  flights.set(el, ghost);
  el.style.visibility = "hidden";
  const turn = (t: boolean) => (t ? " rotate(90deg)" : "");
  const anim = ghost.animate([
    { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)${turn(from.turned)}` },
    { transform: `translate(0px, 0px)${turn(to.turned)}` },
  ], { duration: MOVE_MS, delay, easing: MOVE_EASE, fill: "both" });
  const done = () => {
    ghost.remove();
    if (flights.get(el) !== ghost) return;
    flights.delete(el);
    el.style.visibility = "";
  };
  anim.finished.then(done, done);
}

// Flip a card in place from face down to face up: the first half shrinks the back to a vertical line, the second half opens the face
// During the first half the back is temporarily laid over the face
function flip(el: HTMLElement) {
  const back = document.createElement("span");
  back.className = "back";
  el.appendChild(back);
  el.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: FLIP_MS / 2, easing: "ease-in" }).finished.then(() => {
    back.remove();
    el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: FLIP_MS / 2, easing: "ease-out" });
  }, () => back.remove());
}

// Remember every card's position (by uid) on every state change; cards whose position changed fly to the new place
// Cards in hand are moved by Hand itself (using these remembered positions as the start for cards entering the hand); cards in dialogs don't count
// Cards returning from hand to the deck: the ghost looks like it did in hand, flying one by one left to right like a draw
// Units turned face up without moving (the vanguard at game start) flip visibly
export function useCardFlight(root: RefObject<HTMLElement | null>, dep: unknown) {
  const seen = useRef(new Map<string, Spot>()).current;
  const inHand = useRef(new Map<string, HTMLElement>()).current;   // copies of the previous hand cards (the real ones are gone once they leave the hand)
  const faceDown = useRef(new Set<string>()).current;
  useLayoutEffect(() => {
    const main = root.current;
    if (!main) return;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const prev = new Map(seen), prevHand = new Map(inHand), prevDown = new Set(faceDown);
    seen.clear();
    inHand.clear();
    faceDown.clear();
    const toDeck: { el: HTMLElement; from: Spot; now: Spot; look: HTMLElement }[] = [];
    for (const el of main.querySelectorAll<HTMLElement>("[data-uid]")) {
      const uid = el.dataset.uid!;
      if (seen.has(uid) || el.closest(".veil")) continue;
      const now = spotOf(el.getBoundingClientRect());
      seen.set(uid, now);
      if (el.closest(".hand")) {
        inHand.set(uid, el.cloneNode(true) as HTMLElement);
        // A card that just entered the hand is still sliding (its measured position is still the old place): remeasure when it finishes
        const moving = el.closest(".hand-slot")?.getAnimations?.() ?? [];
        if (moving.length) Promise.all(moving.map((a) => a.finished)).then(() => { if (seen.get(uid) === now && el.isConnected) seen.set(uid, spotOf(el.getBoundingClientRect())); }, () => {});
      }
      const down = !!el.querySelector(":scope > .back");
      if (down) faceDown.add(uid);
      const from = prev.get(uid);
      if (!still && prevDown.has(uid) && !down && el.closest(".slot") && from && Math.abs(from.x - now.x) < 1 && Math.abs(from.y - now.y) < 1 && typeof el.animate === "function") flip(el);
      if (still || !from || !(el.classList.contains("card") || el.closest(".deck")) || el.closest(".hand") || typeof el.animate !== "function") continue;
      if (Math.abs(from.x - now.x) < 1 && Math.abs(from.y - now.y) < 1) continue;
      const look = prevHand.get(uid);
      if (look && el.closest(".deck")) toDeck.push({ el, from, now, look });
      else fly(el, from, now, look);
    }
    toDeck.sort((a, b) => a.from.x - b.from.x).forEach((f, i) => fly(f.el, f.from, f.now, f.look, i * DEAL_GAP_MS));
  }, [dep]);
  return seen;
}
