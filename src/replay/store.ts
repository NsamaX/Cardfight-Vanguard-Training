// Guest replays are kept in the browser (newest first, at most MAX games); if storage can't be read/written, play continues but nothing is remembered
import type { Replay } from "./types";

const KEY = "vanguard.replays";
const MAX = 30;

export function loadReplays(): Replay[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Replay[];
  } catch {
    return [];
  }
}

function write(list: Replay[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Full or not writable: try cutting the older half of the games and write once more
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.ceil(list.length / 2)))); } catch { /* keep going without remembering */ }
  }
}

export function saveReplay(r: Replay) {
  write([r, ...loadReplays().filter((x) => x.id !== r.id)].slice(0, MAX));
}

export function deleteReplay(id: string) {
  write(loadReplays().filter((x) => x.id !== id));
}
