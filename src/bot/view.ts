// What the bot may see by the rules, and filling hidden information randomly to simulate ahead (determinization)
// The bot knows both decklists (the decks chosen in the program) but not the deck order, the opponent's hand, or the opponent's face-down G zone
import { cloneState } from "../engine/clone";
import { deckCombos, type DeckCombos } from "./combos";
import { nextRandom, shuffle } from "../engine/rng";
import { PLAYERS, isG, other, type CardDB } from "../engine/rules";
import { PILE_ZONES } from "../engine/state";
import type { Card, CardInstance, Deck, GameState, PlayerId } from "../engine/types";

export const HIDDEN = "?";

const PLACEHOLDER: Card = {
  key: HIDDEN, ids: [HIDDEN], name: HIDDEN, format: [], type: "normal", grade: 0, power: 0,
  race: "", clan: "", abilities: [], text: "",
};

// db that knows the hidden card (engine functions can read db[key] without crashing)
export const withHidden = (db: CardDB): CardDB => ({ ...db, [HIDDEN]: PLACEHOLDER });

export const isHidden = (inst: CardInstance) => inst.key === HIDDEN;

// seen = uids of cards that were revealed (drive checks, searches to hand); if still in the opponent's hand we still know which card it is
export function viewFor(s: GameState, p: PlayerId, seen: ReadonlySet<string> = new Set()): GameState {
  const v = cloneState(s);
  v.rngState = 0;
  const keep = new Set(seen);
  if (s.awaiting?.player === p && s.awaiting.choice?.kind === "cards") for (const u of s.awaiting.choice.options) keep.add(u);
  const hide = (i: CardInstance) => { if (!keep.has(i.uid)) i.key = HIDDEN; };
  const me = v.players[p], opp = v.players[other(p)];
  me.deck.forEach(hide);
  opp.deck.forEach(hide);
  opp.hand.forEach(hide);
  opp.gZone.filter((g) => !g.faceUp).forEach(hide);
  return v;
}

function ownedInstances(s: GameState, p: PlayerId): CardInstance[] {
  const ps = s.players[p];
  const list: CardInstance[] = [...Object.values(ps.circles).filter((i): i is CardInstance => !!i)];
  if (ps.heart) list.push(ps.heart);
  for (const z of PILE_ZONES) list.push(...ps[z]);
  const b = s.battle;
  if (b?.checkCard) {
    const owner = b.pendingTrigger?.owner ?? (s.step === "drive" ? s.turnPlayer : other(s.turnPlayer));
    if (owner === p) list.push(b.checkCard);
  }
  const seen = new Set<string>();
  return list.filter((i) => (seen.has(i.uid) ? false : (seen.add(i.uid), true)));
}

// Cards not yet seen = decklist − every visible card of p (main = unknown hand + deck, g = face-down unknown G zone)
export function unseenPool(db: CardDB, s: GameState, p: PlayerId, deck: Deck) {
  const pool = { main: new Map(Object.entries(deck.main)), g: new Map(Object.entries(deck.g_zone)) };
  const hidden = { main: [] as CardInstance[], g: [] as CardInstance[] };
  for (const inst of ownedInstances(s, p)) {
    if (isHidden(inst)) { (s.players[p].gZone.includes(inst) ? hidden.g : hidden.main).push(inst); continue; }
    const card = db[inst.key];
    if (!card) continue;
    const m = isG(card) ? pool.g : pool.main;
    const n = m.get(inst.key);
    if (n) m.set(inst.key, n - 1);
  }
  return { pool, hidden };
}

// Counts the bot keeps, attached to the view (a randomly filled board has none, since the deck is already visible)
export interface Reads {
  oppPassive: number;     // how often the opponent took damage at high damage (suggests little Shield in hand)
  oppRevealedG3: boolean; // the opponent revealed a grade 3 from hand this turn (Tommy's cost), so they have at least 1 grade 3
}
export interface Intel {
  pools: Record<PlayerId, { main: Map<string, number>; g: Map<string, number> }>;
  reads: Reads;
  combos: Record<PlayerId, DeckCombos>;
}
const INTEL = new WeakMap<GameState, Intel>();
export const intelOf = (s: GameState) => INTEL.get(s);
export function attachPools(db: CardDB, view: GameState, decks: Record<PlayerId, Deck>, reads: Reads = { oppPassive: 0, oppRevealedG3: false }) {
  INTEL.set(view, {
    pools: { me: unseenPool(db, view, "me", decks.me).pool, bot: unseenPool(db, view, "bot", decks.bot).pool },
    reads,
    combos: { me: deckCombos(db, decks.me), bot: deckCombos(db, decks.bot) },
  });
}

// Cards that may be in p's deck: visible deck = real deck, hidden deck = cards not yet seen (counted from the decklist)
export function deckOdds(db: CardDB, s: GameState, p: PlayerId): { size: number; count: (f: (c: Card) => boolean) => number } {
  const deck = s.players[p].deck;
  const pool = INTEL.get(s)?.pools[p].main;
  if (!deck.some(isHidden) || !pool) {
    return { size: deck.length, count: (f) => deck.filter((c) => !isHidden(c) && f(db[c.key])).length };
  }
  const total = [...pool.values()].reduce((n, x) => n + Math.max(0, x), 0) || 1;
  // Use the ratios from cards not yet seen (unknown hand + deck) times the real deck size
  return { size: deck.length, count: (f) => [...pool].reduce((n, [k, x]) => n + (db[k] && f(db[k]) ? Math.max(0, x) : 0), 0) * deck.length / total };
}

// Fill hidden cards with not-yet-seen cards from the decklist, then re-randomize rng (the simulated game's future doesn't match the real one)
export function determinize(db: CardDB, view: GameState, decks: Record<PlayerId, Deck>, seed: number): GameState {
  const s = cloneState(view);
  let r = seed >>> 0 || 1;
  const reads = INTEL.get(view)?.reads;
  for (const p of PLAYERS) {
    const { pool, hidden } = unseenPool(db, s, p, decks[p]);
    for (const kind of ["main", "g"] as const) {
      const keys = [...pool[kind]].flatMap(([k, n]) => Array<string>(Math.max(0, n)).fill(k));
      let shuffled: string[];
      [shuffled, r] = shuffle(keys, r);
      const handSlot = kind === "main" ? hidden.main.findIndex((i) => s.players[p].hand.includes(i)) : -1;
      if (reads?.oppRevealedG3 && handSlot >= 0 && !s.players[p].hand.some((h) => !isHidden(h) && db[h.key].grade === 3)) {
        const g3 = shuffled.findIndex((k) => db[k]?.grade === 3 && !isG(db[k]));
        if (g3 >= 0) [shuffled[handSlot], shuffled[g3]] = [shuffled[g3], shuffled[handSlot]];
      }
      hidden[kind].forEach((inst, i) => { inst.key = shuffled[i] ?? HIDDEN; });
    }
  }
  let v: number;
  [v, r] = nextRandom(r);
  s.rngState = Math.floor(v * 2 ** 31) | 1;
  return s;
}
