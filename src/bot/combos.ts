// Analyze the deck's combos before the game: check cards → find combos → classify → difficulty/value score → save with the deck
// Combo = a chain of abilities where one step's effect triggers the next step's timing, e.g. call(drop→RC) → enter(RC, self, from=drop)
import { parseCode, quoted, splitTop } from "../engine/code";
import { isG, printedShield, type CardDB } from "../engine/rules";
import type { Ability, Card, Deck } from "../engine/types";
import { cardMatches } from "../engine/vocab/filters";

export type ComboKind = "farm" | "attack" | "defense" | "finisher";
// When in the game the combo becomes playable: early = no GB or stride needed, mid = GB1-2 or a stride, late = GB3+ or a finisher
export type ComboPhase = "early" | "mid" | "late";
// Where a piece must be: hand = in hand (call/discard), VC = ridden as the vanguard, drop/soul = already in that zone,
// G = G zone, starter = the starting card
export type PieceAt = "hand" | "VC" | "drop" | "soul" | "G" | "starter";
// Zones a piece has to be put into before the combo (the bot plays to fill them)
export type SetupZone = "drop" | "soul";

export interface ComboStep { key: string; ability: number; at: PieceAt }
export interface Combo {
  steps: ComboStep[];
  pieces: { key: string; at: PieceAt }[];
  kind: ComboKind;
  phase: ComboPhase;
  difficulty: number;
  value: number;
  score: number;      // value / difficulty: easy and worthwhile = high
  profile: ComboProfile;
}

// What a combo uses and gives (estimated from ability code, not actually simulated)
export interface ComboProfile {
  cb: number; sb: number;           // total cost of the combo
  cc: number; sc: number;           // regained during the combo
  cbNeed: number; sbNeed: number;   // needed before starting (after subtracting what earlier steps regain)
  gb: number;                       // GB required
  flipG: number;                    // G zone cards to flip face up (not counting G guardian calls)
  handUse: number;                  // hand cards used (discard/call/ride)
  deckUse: number;                  // cards leaving the deck (mill, search, draw)
  draw: number;
  attacks: { power: number; crit: number }[];   // attacks the combo adds/boosts (booster Power included)
  shield: number;                   // Shield gained when guarding
  noHit: boolean;
  disrupt: { ownTurn: number; oppTurn: number };   // shooting/disrupting the opponent (retire etc.) on your turn / the opponent's turn
}
// A way to get a card into a setup zone: an ability of a deck card (key + ability), or the piece itself (hollow, guard, ride)
export type EnablerHow = "search" | "discard" | "mill" | "soul-blast" | "hollow" | "guard" | "to-soul" | "soul-charge" | "ride" | "self";
export interface Enabler { how: EnablerHow; key?: string; ability?: number }

export interface DeckCombos {
  signature: string;
  combos: Combo[];
  handPiece: Map<string, number>;   // card → best combo score this card is a hand (or vanguard) piece of
  setupPiece: Record<SetupZone, Map<string, number>>;   // card → best combo score this card is a drop/soul piece of
  enablers: Record<SetupZone, Map<string, Enabler[]>>;  // card → ways to put it into that zone
}

// ---------- 1. Check cards in the deck and G zone ----------

interface Entry { key: string; card: Card; copies: number }

function deckCards(db: CardDB, deck: Deck): Entry[] {
  return [...Object.entries(deck.main), ...Object.entries(deck.g_zone)]
    .filter(([k, n]) => db[k] && n > 0)
    .map(([key, copies]) => ({ key, card: db[key], copies }));
}

// ---------- 2. Compute possible combos ----------

// Events an ability's effect or cost causes
type Ev =
  | { t: "enter"; zone: string; from?: string; who: "self" | "called"; filter: string }
  | { t: "to-drop"; by: string; from: "RC" | "soul"; who: "self" | "called" | "own" | "soul"; filter: string }
  | { t: "stride" }
  | { t: "discarded"; as: string; filter: string };

function produces(ab: Ability): Ev[] {
  const out: Ev[] = [];
  const calls = [...(ab.cost ?? []), ...ab.effect].map(parseCode);
  const callFilter = calls.find((c) => c.name === "call")?.named.filter ?? "";
  for (const c of calls) {
    if (c.name === "call") {
      const [src, zone] = (c.pos[0] ?? "").split("→");
      if (src === "self") out.push({ t: "enter", zone, who: "self", filter: "" });
      else if (src === "G") out.push({ t: "enter", zone, who: "self", filter: "" });
      else for (const from of src.split("+")) out.push({ t: "enter", zone, from, who: "called", filter: c.named.filter ?? "" });
    }
    if (c.name === "hollow") out.push({ t: "to-drop", by: "hollow", from: "RC", who: c.pos[0] === "called" ? "called" : "self", filter: callFilter });
    if ((c.name === "retire" && c.pos[0] === "own") || c.name === "retire-own") out.push({ t: "to-drop", by: "retire", from: "RC", who: "own", filter: "" });
    if (c.name === "SB") out.push({ t: "to-drop", by: "SB", from: "soul", who: "soul", filter: c.named.filter ?? "" });
    if (c.name === "stride") out.push({ t: "stride" }, { t: "enter", zone: "VC", who: "self", filter: "" });
    if (c.name === "discard" && ab.kind === "G GUARDIAN") out.push({ t: "discarded", as: "g-guardian-cost", filter: c.named.filter ?? "" });
  }
  return out;
}

// Card k matches the filter (the engine's filters, checked without a board: "that card" compares the card key, set rules pass)
function fits(k: Card, flt: string, source: Card, subject?: string): boolean {
  const terms = splitTop(flt, "&").filter((t) => t !== "that-card");
  if (subject && flt.includes("that-card") && k.key !== subject) return false;
  return cardMatches(k, terms.join(" & "), { db: {}, source, sourceKey: source.key });
}

const isUnit = (c: Card) => !isG(c);

// Is ability b of card k triggered by event e caused by card p? Returns where k must be
function consumes(k: Card, b: Ability, e: Ev, p: Card, subject?: string): PieceAt | undefined {
  if (b.kind !== "AUTO" || !b.timing) return undefined;
  const c = parseCode(b.timing);
  const [a0, a1] = c.pos;
  const n = c.named;
  const field: PieceAt = isG(k) ? "G" : onlyVC(b) ? "VC" : "hand";
  switch (c.name) {
    case "enter": {
      if (e.t !== "enter" || e.zone !== a0 || (n.from && n.from !== e.from)) return undefined;
      if (a1 === "self") {
        if (e.who === "self") return k.key === p.key ? field : undefined;
        if (!isUnit(k) || !fits(k, e.filter, p, subject)) return undefined;
        return e.from === "drop" ? "drop" : "hand";
      }
      return a1 === "other-own" ? field : undefined;
    }
    case "to-drop":
    case "retired": {
      if (e.t !== "to-drop" || (n.by && n.by !== e.by) || (n.from && n.from !== e.from)) return undefined;
      if (e.who === "soul") return a0 === "self" && isUnit(k) && fits(k, e.filter, p) ? "soul" : undefined;
      if (a0 === "own") return field;
      if (e.who === "self") return k.key === p.key ? field : undefined;
      return e.who === "called" && fits(k, e.filter, p, subject) ? "drop" : undefined;
    }
    case "stride": return e.t === "stride" && (!n.filter || fits(p, n.filter, p)) ? field : undefined;
    case "discarded": return e.t === "discarded" && n.as === e.as && fits(k, e.filter, p) ? "hand" : undefined;
  }
  return undefined;
}

// The ability only works while the card is the vanguard
const onlyVC = (ab: Ability) => { const z = (ab.zone ?? "").split("/"); return z.includes("VC") && !z.includes("RC"); };

// Combo starting points: things the player can do directly (call, ride, stride, attack, guard, use ACT)
function starterAt(e: Entry, ab: Ability, starter: string): PieceAt | undefined {
  if (isG(e.card)) return ["ACT", "STRIDE", "ULTIMATE STRIDE", "G GUARDIAN"].includes(ab.kind) ? "G" : undefined;
  const own = e.key === starter ? "starter" : onlyVC(ab) ? "VC" : "hand";
  if (ab.kind === "ACT") return own;
  if (ab.kind !== "AUTO" || !ab.timing) return undefined;
  const c = parseCode(ab.timing);
  if (c.name === "ridden-upon" || c.name === "attack" || c.name === "battle-end" || c.name === "phase-start") return own;
  if (c.name === "enter" && c.pos[1] === "self" && (!c.named.from || c.named.from === "hand")) return own;
  return undefined;
}

const MAX_STEPS = 4;

function findCombos(cards: Entry[], starter: string): ComboStep[][] {
  const all = cards.flatMap((e) => e.card.abilities.map((ab, i) => ({ e, ab, i })));
  const out: ComboStep[][] = [];
  const walk = (path: ComboStep[], from: { e: Entry; ab: Ability }, subject?: string) => {
    // The last step must have a real effect (not just hollowing itself), otherwise it's only a pass-through to the next step
    if (path.length >= 2 && from.ab.effect.reduce((n, e) => n + effectValue(e), 0) > 0) out.push(path);
    if (path.length >= MAX_STEPS) return;
    for (const ev of produces(from.ab)) {
      const subj = ev.t === "to-drop" && ev.who === "self" ? from.e.key : subject;
      for (const nx of all) {
        if (path.some((s) => s.key === nx.e.key && s.ability === nx.i)) continue;
        const at = consumes(nx.e.card, nx.ab, ev, from.e.card, subj);
        if (!at) continue;
        const known = path.find((s) => s.key === nx.e.key);
        walk([...path, { key: nx.e.key, ability: nx.i, at: known ? known.at : at }], nx, ev.t === "to-drop" ? subj : nx.e.key);
      }
    }
  };
  for (const { e, ab, i } of all) {
    const at = starterAt(e, ab, starter);
    if (at) walk([{ key: e.key, ability: i, at }], { e, ab }, e.key);
  }
  return out;
}

// ---------- 3. Classify combos ----------

const num = (s: string | undefined, dflt = 1) => {
  if (!s) return dflt;
  if (s.includes("G-faceup")) return 3;
  const m = s.match(/(\d+)/);
  return m ? +m[1] : dflt;
};

function totals(abs: Ability[]) {
  let calls = 0, critical = 0, gb = 0, ultimate = false;
  for (const ab of abs) {
    if (ab.kind === "ULTIMATE STRIDE") ultimate = true;
    for (const x of ab.cond ?? []) { const m = x.match(/GB\((\d+)\)/); if (m) gb = Math.max(gb, +m[1]); }
    for (const e of ab.effect) {
      const c = parseCode(e);
      if (c.name === "call" && /→RC/.test(c.pos[0] ?? "") && !(c.pos[0] ?? "").startsWith("self")) calls += num(c.named.n ?? c.pos[1]);
      if (c.name === "critical") critical++;
    }
  }
  return { calls, critical, gb, ultimate };
}

const DEFENSE_START = /^(step\(guard|enter\(GC|discarded\()/;

// Effects that make the attack stronger (calling itself forward doesn't count); a combo without any only gains resources (cards, CB, soul)
const OFFENSE = /^(call\((?!self)[^)]*→RC|power|critical|retire\(opp|opp-retires|stand|drive|grant)/;

function kindOf(abs: Ability[]): ComboKind {
  const first = abs[0];
  if (first.kind === "G GUARDIAN" || DEFENSE_START.test(first.timing ?? "")) return "defense";
  if (abs.some((ab) => ab.effect.some((e) => /^(shield|no-hit)\(/.test(e)))) return "defense";
  const t = totals(abs);
  if (t.calls >= 3 || t.critical > 0 || t.ultimate || t.gb >= 8) return "finisher";
  if (!abs.some((ab) => ab.effect.some((e) => OFFENSE.test(e)))) return "farm";
  return "attack";
}

function phaseOf(kind: ComboKind, abs: Ability[], pieces: { at: PieceAt }[], gb: number): ComboPhase {
  if (kind === "finisher" || gb >= 3) return "late";
  const stride = pieces.some((p) => p.at === "G") && abs.some((ab) => ab.kind !== "G GUARDIAN");
  if (gb >= 1 || stride || pieces.some((p) => p.at === "VC")) return "mid";
  return "early";
}

// ---------- 4. Condition difficulty score ----------

const PIECE_BASE = 0.5;
const COST_WEIGHT: Record<string, number> = { CB: 0.6, SB: 0.3, "flip-G-up": 1, mill: 0.1, discard: 0.5, "retire-own": 0.5, bind: 0.3, reveal: 0.2 };

function difficultyOf(pieces: { key: string; at: PieceAt; copies: number }[], abs: Ability[]): number {
  let d = 0;
  for (const p of pieces) {
    if (p.at === "starter" || p.at === "G") continue;
    d += PIECE_BASE + 2 / Math.max(1, p.copies) + (p.at === "drop" || p.at === "soul" ? 0.5 : 0);
  }
  let gb = 0, grade3 = false;
  for (const ab of abs) {
    for (const code of ab.cost ?? []) {
      const c = parseCode(code);
      if (c.name in COST_WEIGHT) d += COST_WEIGHT[c.name] * (c.name === "discard" && c.named.filter === "heal" ? 1 : num(c.pos[0]));
    }
    for (const x of ab.cond ?? []) {
      const m = x.match(/GB\((\d+)\)/);
      if (m) gb = Math.max(gb, +m[1]);
      if (/vc-grade≥3|vc-name/.test(x)) grade3 = true;
      const up = x.match(/^G-faceup≥(\d+)$/);
      if (up) d += +up[1] * 0.7;
    }
    if (ab.kind === "STRIDE" || ab.kind === "ULTIMATE STRIDE" || ab.timing === "stride(own)") grade3 = true;
  }
  return d + gb + (grade3 ? 1 : 0);
}

// ---------- 5. Value score by use ----------

function effectValue(e: string): number {
  const c = parseCode(e);
  const amount = (s: string | undefined) => num(s?.replace(/^\+/, ""), 0) / 5000;
  switch (c.name) {
    case "call": {
      const src = c.pos[0] ?? "";
      if (src.startsWith("self") || src.startsWith("G")) return 0;
      return num(c.named.n ?? c.pos[1]) * (src.endsWith("GC") ? 0.6 : 1);
    }
    case "power": return amount(c.pos[0]) * 0.5 * (c.pos[1] === "own-units" ? 3 : 1);
    case "shield": return amount(c.pos[0]) * 0.5;
    case "critical": return 1.5;
    case "CC": return 0.4 * num(c.pos[0]);
    case "SC": return 0.15 * num(c.pos[0]);
    case "choose": return 0.4;
    case "draw": return num(c.pos[0]);
    case "search": return (c.pos[0] ?? "").endsWith("hand") ? 1 : 0.2 * num(c.pos[1]);
    case "to-hand": return num(c.named.n ?? c.pos[1]);
    case "retire": return c.pos[0] === "opp-RC" ? 1 : 0;
    case "no-hit": return 2;
    case "damage-facedown": return -0.3;
    default: return 0;
  }
}

function valueOf(abs: Ability[], cards: Card[]): number {
  let v = 0;
  abs.forEach((ab, i) => {
    for (const e of ab.effect) v += effectValue(e);
    if (ab.kind === "G GUARDIAN") v += (cards[i].shield ?? 0) / 5000 * 0.5;
  });
  return v;
}

// ---------- 6. Save combos with the deck ----------

export const deckSignature = (deck: Deck) =>
  JSON.stringify([deck.starter, Object.entries(deck.main).sort(), Object.entries(deck.g_zone).sort()]);

const saved = new Map<string, DeckCombos>();

// Unchanged deck = reuse saved combos, edited deck (card list changed) = recompute
export function deckCombos(db: CardDB, deck: Deck): DeckCombos {
  const signature = deckSignature(deck);
  let r = saved.get(signature);
  if (!r) { r = analyze(db, deck, signature); saved.set(signature, r); }
  return r;
}

export function analyze(db: CardDB, deck: Deck, signature = deckSignature(deck)): DeckCombos {
  const cards = deckCards(db, deck);
  const copies = new Map(cards.map((e) => [e.key, e.copies]));
  const seen = new Set<string>();
  const combos: Combo[] = [];
  for (const steps of findCombos(cards, deck.starter)) {
    const id = steps.map((s) => `${s.key}#${s.ability}`).join(">");
    if (seen.has(id)) continue;
    seen.add(id);
    const abs = steps.map((s) => db[s.key].abilities[s.ability]);
    const pieces = distinctPieces(steps);
    // Vanguard-name condition: must ride a card with that name (the grade 3 with the most copies)
    for (const ab of abs) for (const x of ab.cond ?? []) {
      if (!x.startsWith("vc-name(")) continue;
      const nm = quoted(x);
      if (pieces.some((p) => db[p.key].name.includes(nm) && !isG(db[p.key]))) continue;
      const vc = cards.filter((e) => !isG(e.card) && e.card.grade === 3 && e.card.name.includes(nm)).sort((a, b) => b.copies - a.copies)[0];
      if (vc) pieces.push({ key: vc.key, at: "VC" });
    }
    const difficulty = difficultyOf(pieces.map((p) => ({ ...p, copies: copies.get(p.key) ?? 1 })), abs) + 1;
    const value = valueOf(abs, steps.map((s) => db[s.key]));
    if (value <= 0) continue;
    const kind = kindOf(abs);
    const profile = profileOf(steps, cards, kind);
    combos.push({ steps, pieces, kind, phase: phaseOf(kind, abs, pieces, profile.gb), difficulty, value, score: value / difficulty, profile });
  }
  combos.sort((a, b) => b.score - a.score);
  const handPiece = new Map<string, number>();
  const setupPiece: DeckCombos["setupPiece"] = { drop: new Map(), soul: new Map() };
  const best = (m: Map<string, number>, k: string, v: number) => m.set(k, Math.max(m.get(k) ?? 0, v));
  for (const c of combos) for (const p of c.pieces) {
    if (p.at === "hand" || p.at === "VC") best(handPiece, p.key, c.score);
    if (p.at === "drop" || p.at === "soul") best(setupPiece[p.at], p.key, c.score);
  }
  const enablers: DeckCombos["enablers"] = { drop: new Map(), soul: new Map() };
  for (const zone of ["drop", "soul"] as const) for (const k of setupPiece[zone].keys()) enablers[zone].set(k, enablersOf(cards, db[k], zone));
  return { signature, combos, handPiece, setupPiece, enablers };
}

// ---------- 7. Setup: how a drop/soul piece gets into its zone ----------

const isSelfHollow = (c: Card) => c.abilities.some((a) => a.effect.some((e) => e.startsWith("hollow(self")));

function enablersOf(cards: Entry[], piece: Card, zone: SetupZone): Enabler[] {
  const out: Enabler[] = [];
  const add = (x: Enabler) => { if (!out.some((y) => y.how === x.how && y.key === x.key)) out.push(x); };
  for (const e of cards) e.card.abilities.forEach((ab, i) => {
    for (const code of [...(ab.cost ?? []), ...ab.effect]) {
      const c = parseCode(code);
      const flt = c.named.filter ?? "";
      const src = c.pos[0] ?? "";
      if (zone === "drop") {
        if (c.name === "search" && src.endsWith("→drop") && fits(piece, flt, e.card)) add({ how: "search", key: e.key, ability: i });
        else if (c.name === "mill" || (c.name === "look" && code.includes("rest=drop"))) add({ how: "mill", key: e.key, ability: i });
        else if (c.name === "discard" && fits(piece, flt, e.card)) add({ how: "discard", key: e.key, ability: i });
        else if (c.name === "SB" && fits(piece, flt, e.card)) add({ how: "soul-blast", key: e.key, ability: i });
      } else {
        if (c.name === "to-soul" && src !== "self" && fits(piece, flt, e.card)) add({ how: "to-soul", key: e.key, ability: i });
        else if (c.name === "SC" || (c.name === "look" && code.includes("soul="))) add({ how: "soul-charge", key: e.key, ability: i });
      }
    }
  });
  if (zone === "drop") {
    if (isSelfHollow(piece)) add({ how: "hollow" });
    if (printedShield(piece) > 0 || piece.abilities.some((a) => a.effect.includes("keyword(Sentinel)"))) add({ how: "guard" });
  } else {
    if (piece.type !== "trigger" && piece.grade <= 3) add({ how: "ride" });
    if (piece.abilities.some((a) => [...(a.cost ?? []), ...a.effect].some((x) => /^(soul-in|to-soul)\(self/.test(x)))) add({ how: "self" });
  }
  return out;
}

// ---------- Combo data: resources, attacks, defense, disruption ----------

const HEART = 11000;   // a G unit on the vanguard gets the heart's Power (a typical grade 3)

interface Unit { key: string; power: number; crit: number; vc: boolean }

// Called units: cards in the combo chain first, the rest pick the highest-Power card in the deck matching the filter (counting copies)
function calledUnits(cards: Entry[], source: Card, filter: string, n: number, chained: string | undefined): Unit[] {
  const out: Unit[] = [];
  const left = new Map(cards.map((e) => [e.key, e.copies]));
  const take = (k: string) => { out.push({ key: k, power: cards.find((e) => e.key === k)!.card.power ?? 0, crit: 1, vc: false }); left.set(k, left.get(k)! - 1); };
  if (chained) take(chained);
  const pool = cards.filter((e) => !isG(e.card) && fits(e.card, filter, source)).sort((a, b) => (b.card.power ?? 0) - (a.card.power ?? 0));
  for (const e of pool) while (out.length < n && (left.get(e.key) ?? 0) > 0) take(e.key);
  return out;
}

// Shield from calling cards to GC: the highest-Shield cards (different-grades = no repeated grade)
function gcShield(cards: Entry[], source: Card, filter: string, n: number): number {
  const distinct = filter.includes("different-grades");
  const pool = cards.filter((e) => !isG(e.card) && fits(e.card, filter, source)).sort((a, b) => printedShield(b.card) - printedShield(a.card));
  const picked: Card[] = [];
  for (const e of pool) for (let k = 0; k < e.copies && picked.length < n; k++) {
    if (distinct && picked.some((c) => c.grade === e.card.grade)) break;
    picked.push(e.card);
  }
  return picked.reduce((t, c) => t + printedShield(c), 0);
}

function profileOf(steps: ComboStep[], cards: Entry[], kind: ComboKind): ComboProfile {
  const pr: ComboProfile = {
    cb: 0, sb: 0, cc: 0, sc: 0, cbNeed: 0, sbNeed: 0, gb: 0, flipG: 0, handUse: 0, deckUse: 0, draw: 0,
    attacks: [], shield: 0, noHit: false, disrupt: { ownTurn: 0, oppTurn: 0 },
  };
  const card = (k: string) => cards.find((e) => e.key === k)!.card;
  const units: Unit[] = [];
  let cbBal = 0, sbBal = 0;
  const unitOf = (k: string) => {
    let u = units.find((x) => x.key === k || x.key.startsWith(`${k}@`));
    if (!u) {
      const c = card(k);
      u = { key: k, power: (c.power ?? 0) + (isG(c) ? HEART : 0), crit: 1, vc: isG(c) };
      units.push(u);
    }
    return u;
  };
  pr.handUse = steps.filter((s, i) => s.at === "hand" && steps.findIndex((x) => x.key === s.key) === i).length;
  steps.forEach((st, i) => {
    const c = card(st.key);
    const ab = c.abilities[st.ability];
    for (const code of ab.cost ?? []) {
      const x = parseCode(code);
      const n = num(x.pos[0]);
      if (x.name === "CB") { pr.cb += n; cbBal -= n; }
      if (x.name === "SB") { pr.sb += n; sbBal -= n; }
      if (x.name === "soul-in") { pr.sc += 1; sbBal += 1; }
      if (x.name === "mill") pr.deckUse += n;
      if (x.name === "discard") pr.handUse += x.named.filter === "heal" ? 1 : n;
      if (x.name === "flip-G-up") pr.flipG += n;
      pr.cbNeed = Math.max(pr.cbNeed, -cbBal);
      pr.sbNeed = Math.max(pr.sbNeed, -sbBal);
    }
    for (const x of ab.cond ?? []) { const m = x.match(/GB\((\d+)\)/); if (m) pr.gb = Math.max(pr.gb, +m[1]); }
    if (ab.kind === "G GUARDIAN") pr.shield += c.shield ?? 0;
    if (ab.kind === "STRIDE" || ab.kind === "ULTIMATE STRIDE") unitOf(st.key);
    let called: Unit[] = [];
    for (const e of ab.effect) {
      const x = parseCode(e);
      const n = num(x.named.n ?? x.pos[1] ?? x.pos[0]);
      switch (x.name) {
        case "CC": pr.cc += num(x.pos[0]); cbBal += num(x.pos[0]); break;
        case "SC": pr.sc += num(x.pos[0]); sbBal += num(x.pos[0]); break;
        case "choose": if (e.includes("CC(")) { pr.cc += 1; cbBal += 1; } break;
        case "draw": pr.draw += num(x.pos[0]); pr.deckUse += num(x.pos[0]); break;
        case "mill": pr.deckUse += num(x.pos[0]); break;
        case "search": pr.deckUse += num(x.pos[1]); break;
        case "damage-facedown": pr.cb += num(x.pos[0]); break;
        case "no-hit": pr.noHit = true; break;
        case "shield": pr.shield += num(x.pos[0]?.replace(/^\+/, ""), 0); break;
        case "retire": if ((x.pos[0] ?? "").startsWith("opp")) pr.disrupt[kind === "defense" ? "oppTurn" : "ownTurn"] += num(x.named.n ?? x.pos[1]); break;
        case "call": {
          const [src, zone] = (x.pos[0] ?? "").split("→");
          if (src === "self" || src === "G") break;
          const next = steps[i + 1] && card(steps[i + 1].key);
          const chained = next && !isG(next) && steps[i + 1].at !== "hand" ? steps[i + 1].key : undefined;
          if (zone === "GC") { pr.shield += gcShield(cards, c, x.named.filter ?? "", n); break; }
          called = calledUnits(cards, c, x.named.filter ?? "", n, chained).map((u) => ({ ...u, key: `${u.key}@${i}` }));
          units.push(...called);
          break;
        }
        case "power": case "critical": {
          // "+1000 per 2 drop" depends on the drop zone: about +5000
          const amt = x.pos[0]?.includes("per") ? 5000 : num(x.pos[0]?.replace(/^\+/, ""), 0);
          const target = x.pos[1] ?? "self";
          const add = (u: Unit) => { if (x.name === "power") u.power += amt; else u.crit += 1; };
          if (target === "called") called.forEach(add);
          else if (target === "self") add(unitOf(st.key));
          else if (target === "own-VC") add(units.find((u) => u.vc) ?? unitOf(st.key));
          else if (target === "own-units") units.forEach(add);
          else if (target.startsWith("other-own")) { const u = units.filter((v) => v.key !== st.key).sort((a, b) => b.power - a.power)[0]; if (u) add(u); }
          break;
        }
      }
    }
  });
  // Grades 0-1 are boosters (add Power to an attacker without a booster), grade 2+ and the vanguard are attackers
  const gradeOf = (u: Unit) => (u.vc ? 4 : card(u.key.split("@")[0]).grade);
  const attackers = units.filter((u) => gradeOf(u) >= 2).sort((a, b) => b.power - a.power).map((u) => ({ power: u.power, crit: u.crit }));
  const boosters = units.filter((u) => gradeOf(u) <= 1).sort((a, b) => b.power - a.power);
  boosters.forEach((b, j) => { if (attackers[j]) attackers[j].power += b.power; });
  pr.attacks = attackers;
  return pr;
}

function distinctPieces(steps: ComboStep[]): { key: string; at: PieceAt }[] {
  const out: { key: string; at: PieceAt }[] = [];
  for (const s of steps) if (!out.some((p) => p.key === s.key)) out.push({ key: s.key, at: s.at });
  return out;
}
