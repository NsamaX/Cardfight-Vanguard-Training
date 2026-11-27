// Chain search without a board: which abilities an ability's costs and effects can set off, using the same timings as the engine.
// Each op declares the moves it causes (OpSpec.causes); a move is turned into a sample event and checked against every timing.
import { parseCode } from "../code";
import { isG, type CardDB } from "../rules";
import type { Ability, Card, MoveEvent, PlayerId, TriggerEvent } from "../types";
import { cardMatches } from "./filters";
import { OPS } from "./index";
import { TIMINGS } from "./timings";
import type { Caused } from "./types";

// What an ability causes: its costs and effects, plus the rules' own consequences (a G guardian's cost discards; Hollow retires)
export function causedBy(ab: Ability): Caused[] {
  return [...(ab.cost ?? []), ...ab.effect].flatMap((code) => {
    const c = parseCode(code);
    return OPS[c.name]?.causes?.(c, ab) ?? [];
  });
}

const WATCHER = "watcher", OTHER = "other";

// Sample events for a caused move, seen by a card that may be the one moving (watcherMoves) or not
function samples(cause: Caused, source: Card, watcher: Card): { e: TriggerEvent; owner: PlayerId }[] {
  if (cause.stride) return [{ e: { kind: "stride", player: "me", uid: OTHER, key: source.key }, owner: "me" }];
  const m = cause.move!;
  const move = (uid: string, key: string, player: PlayerId): MoveEvent => ({ kind: "move", player, uid, key, from: m.from, to: m.to, by: m.by, as: m.as, grants: [] });
  if (cause.who === "self") {
    const same = watcher.key === source.key;
    return [{ e: move(same ? WATCHER : OTHER, source.key, "me"), owner: "me" }];
  }
  if (cause.who === "opp") {
    // An opponent's card moved: the watcher is either that card (on the other side) or one of ours watching
    return [{ e: move(WATCHER, watcher.key, "bot"), owner: "bot" }, { e: move(OTHER, source.key, "bot"), owner: "me" }];
  }
  const out = [{ e: move(OTHER, source.key, "me") as TriggerEvent, owner: "me" as PlayerId }];
  if (!isG(watcher) && cardMatches(watcher, cause.filter ?? "", { db: {}, source, sourceKey: source.key })) out.push({ e: move(WATCHER, watcher.key, "me"), owner: "me" });
  return out;
}

// The timing of watcher's ability b that this cause sets off, if any
export function setsOff(db: CardDB, cause: Caused, source: Card, watcher: Card, b: Ability): boolean {
  if (b.kind !== "AUTO" || !b.timing) return false;
  const c = parseCode(b.timing);
  const t = TIMINGS[c.name];
  if (!t) return false;
  return samples(cause, source, watcher).some(({ e, owner }) => t.matches(e, c, WATCHER, owner, db));
}
