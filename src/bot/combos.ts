// วิเคราะห์คอมโบของเด็คก่อนเริ่มเกม: เช็คการ์ด → หาคอมโบ → จัดประเภท → คะแนนความยาก/ความคุ้ม → บันทึกกับเด็ค
// คอมโบ = สายความสามารถที่ผลของขั้นหนึ่งไปกระตุ้นจังหวะของขั้นถัดไป เช่น call(drop→RC) → enter(RC, self, from=drop)
import { parseCode, quoted, splitTop } from "../engine/code";
import { isG, printedShield, type CardDB } from "../engine/rules";
import type { Ability, Card, Deck } from "../engine/types";

export type ComboKind = "attack" | "defense" | "finisher";
// ตำแหน่งที่ชิ้นส่วนต้องอยู่: hand = ต้องมีบนมือ (คอล/ไรด์/ทิ้ง), drop = ต้องอยู่ในดรอป, G = G โซน, starter = การ์ดเริ่มต้น
export type PieceAt = "hand" | "drop" | "G" | "starter";

export interface ComboStep { key: string; ability: number; at: PieceAt }
export interface Combo {
  steps: ComboStep[];
  pieces: { key: string; at: PieceAt }[];
  kind: ComboKind;
  difficulty: number;
  value: number;
  score: number;      // value / difficulty: ง่ายและคุ้ม = สูง
  profile: ComboProfile;
}

// ข้อมูลที่คอมโบใช้และให้ (ประมาณจากโค้ดความสามารถ ไม่ได้จำลองจริง)
export interface ComboProfile {
  cb: number; sb: number;           // คอสต์รวมทั้งคอมโบ
  cc: number; sc: number;           // ได้คืนระหว่างคอมโบ
  cbNeed: number; sbNeed: number;   // ต้องมีก่อนเริ่ม (หักที่ได้คืนจากขั้นก่อนหน้าแล้ว)
  gb: number;                       // GB ที่ต้องมี
  flipG: number;                    // G โซนที่ต้องหงาย (ไม่นับการคอล G การ์เดี้ยน)
  handUse: number;                  // การ์ดบนมือที่ใช้ (ทิ้ง/คอล/ไรด์)
  deckUse: number;                  // การ์ดที่ออกจากกอง (ทิ้งกอง ค้น จั่ว)
  draw: number;
  attacks: { power: number; crit: number }[];   // การโจมตีที่คอมโบเพิ่ม/เสริม (รวม Power ตัวบูสท์แล้ว)
  shield: number;                   // Shield ที่ได้ตอนป้องกัน
  noHit: boolean;
  disrupt: { ownTurn: number; oppTurn: number };   // ยิง/ขัดขวางคู่แข่ง (รีไทร์ ฯลฯ) ในเทิร์นตัวเอง/เทิร์นคู่แข่ง
}
export interface DeckCombos {
  signature: string;
  combos: Combo[];
  handPiece: Map<string, number>;   // การ์ด → คะแนนคอมโบดีสุดที่การ์ดใบนี้เป็นชิ้นส่วนบนมือ
}

// ---------- 1. เช็คการ์ดใน deck และ G zone ----------

interface Entry { key: string; card: Card; copies: number }

function deckCards(db: CardDB, deck: Deck): Entry[] {
  return [...Object.entries(deck.main), ...Object.entries(deck.g_zone)]
    .filter(([k, n]) => db[k] && n > 0)
    .map(([key, copies]) => ({ key, card: db[key], copies }));
}

// ---------- 2. คำนวณคอมโบที่เป็นไปได้ ----------

// เหตุการณ์ที่ผลหรือคอสต์ของความสามารถทำให้เกิด
type Ev =
  | { t: "enter"; zone: string; from?: string; who: "self" | "called"; filter: string }
  | { t: "to-drop"; by: string; who: "self" | "called" | "own"; filter: string }
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
    if (c.name === "hollow") out.push({ t: "to-drop", by: "hollow", who: c.pos[0] === "called" ? "called" : "self", filter: callFilter });
    if ((c.name === "retire" && c.pos[0] === "own") || c.name === "retire-own") out.push({ t: "to-drop", by: "retire", who: "own", filter: "" });
    if (c.name === "stride") out.push({ t: "stride" }, { t: "enter", zone: "VC", who: "self", filter: "" });
    if (c.name === "discard" && ab.kind === "G GUARDIAN") out.push({ t: "discarded", as: "g-guardian-cost", filter: c.named.filter ?? "" });
  }
  return out;
}

// การ์ด k ตรงกับตัวกรอง (ตรวจแบบไม่มีสนาม: ตัวกรองที่ต้องดูสนามถือว่าผ่าน)
function fits(k: Card, flt: string, source: Card, subject?: string): boolean {
  for (const t of splitTop(flt, "&")) {
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^grade-(\d+)$/))) { if (k.grade !== +m[1]) return false; }
    else if ((m = t.match(/^grade≤(\d+)$/))) { if (k.grade > +m[1]) return false; }
    else if (t.startsWith("name(")) { if (!k.name.includes(quoted(t))) return false; }
    else if (t === "not-same-name") { if (k.name === source.name) return false; }
    else if (t === "same-name") { if (k.key !== source.key) return false; }
    else if (t === "has-hollow") { if (!k.abilities.some((a) => a.effect.some((e) => e.startsWith("hollow(self")))) return false; }
    else if (t === "normal-unit") { if (k.type !== "normal") return false; }
    else if (t === "heal" || t === "heal-trigger") { if (k.trigger !== "heal") return false; }
    else if (t === "G-GUARDIAN") { if (k.type !== "g-guardian") return false; }
    else if (t === "that-card") { if (subject && k.key !== subject) return false; }
    else if (t === "different-grades" || t === "grade-sum≥3" || t === "") { /* ตรวจตอนเลือก */ }
    else if (k.clan !== t) return false;
  }
  return true;
}

const isUnit = (c: Card) => !isG(c);

// ความสามารถ b ของการ์ด k ถูกกระตุ้นด้วยเหตุการณ์ e ที่การ์ด p ทำให้เกิดไหม คืนตำแหน่งที่ k ต้องอยู่
function consumes(k: Card, b: Ability, e: Ev, p: Card, subject?: string): PieceAt | undefined {
  if (b.kind !== "AUTO" || !b.timing) return undefined;
  const c = parseCode(b.timing);
  const [a0, a1] = c.pos;
  const n = c.named;
  const field: PieceAt = isG(k) ? "G" : "hand";
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
      if (e.t !== "to-drop" || (n.by && n.by !== e.by)) return undefined;
      if (a0 === "own") return field;
      if (e.who === "self") return k.key === p.key ? field : undefined;
      return e.who === "called" && fits(k, e.filter, p, subject) ? "drop" : undefined;
    }
    case "stride": return e.t === "stride" ? field : undefined;
    case "discarded": return e.t === "discarded" && n.as === e.as && fits(k, e.filter, p) ? "hand" : undefined;
  }
  return undefined;
}

// จุดเริ่มคอมโบ: สิ่งที่ผู้เล่นทำเองได้ (คอล ไรด์ สไตรด์ โจมตี การ์ด ใช้ ACT)
function starterAt(e: Entry, ab: Ability, starter: string): PieceAt | undefined {
  if (isG(e.card)) return ["ACT", "STRIDE", "ULTIMATE STRIDE", "G GUARDIAN"].includes(ab.kind) ? "G" : undefined;
  const own = e.key === starter ? "starter" : "hand";
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
    // ขั้นสุดท้ายต้องได้ผลจริง (ไม่ใช่แค่ฮอลโล่ว์ตัวเอง) ไม่งั้นเป็นแค่ทางผ่านไปขั้นถัดไป
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

// ---------- 3. จัดประเภทคอมโบ ----------

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

function kindOf(abs: Ability[]): ComboKind {
  const first = abs[0];
  if (first.kind === "G GUARDIAN" || DEFENSE_START.test(first.timing ?? "")) return "defense";
  if (abs.some((ab) => ab.effect.some((e) => /^(shield|no-hit)\(/.test(e)))) return "defense";
  const t = totals(abs);
  if (t.calls >= 3 || t.critical > 0 || t.ultimate || t.gb >= 8) return "finisher";
  return "attack";
}

// ---------- 4. คะแนนความยากของเงื่อนไข ----------

const PIECE_BASE = 0.5;
const COST_WEIGHT: Record<string, number> = { CB: 0.6, SB: 0.3, "flip-G-up": 1, mill: 0.1, discard: 0.5, "retire-own": 0.5, bind: 0.3, reveal: 0.2 };

function difficultyOf(pieces: { key: string; at: PieceAt; copies: number }[], abs: Ability[]): number {
  let d = 0;
  for (const p of pieces) {
    if (p.at === "starter" || p.at === "G") continue;
    d += PIECE_BASE + 2 / Math.max(1, p.copies) + (p.at === "drop" ? 0.5 : 0);
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

// ---------- 5. คะแนนความคุ้มค่าตามการใช้งาน ----------

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

// ---------- 6. บันทึกคอมโบกับเด็ค ----------

export const deckSignature = (deck: Deck) =>
  JSON.stringify([deck.starter, Object.entries(deck.main).sort(), Object.entries(deck.g_zone).sort()]);

const saved = new Map<string, DeckCombos>();

// เด็คเดิม = ใช้คอมโบที่บันทึกไว้ เด็คถูกแก้ (รายการการ์ดเปลี่ยน) = คิดใหม่
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
    // เงื่อนไขชื่อแวนการ์ด: ต้องไรด์การ์ดชื่อนั้น (เกรด 3 ที่มีหลายใบที่สุด)
    for (const ab of abs) for (const x of ab.cond ?? []) {
      if (!x.startsWith("vc-name(")) continue;
      const nm = quoted(x);
      if (pieces.some((p) => db[p.key].name.includes(nm) && !isG(db[p.key]))) continue;
      const vc = cards.filter((e) => !isG(e.card) && e.card.grade === 3 && e.card.name.includes(nm)).sort((a, b) => b.copies - a.copies)[0];
      if (vc) pieces.push({ key: vc.key, at: "hand" });
    }
    const difficulty = difficultyOf(pieces.map((p) => ({ ...p, copies: copies.get(p.key) ?? 1 })), abs) + 1;
    const value = valueOf(abs, steps.map((s) => db[s.key]));
    if (value <= 0) continue;
    const kind = kindOf(abs);
    combos.push({ steps, pieces, kind, difficulty, value, score: value / difficulty, profile: profileOf(steps, cards, kind) });
  }
  combos.sort((a, b) => b.score - a.score);
  const handPiece = new Map<string, number>();
  for (const c of combos) for (const p of c.pieces) {
    if (p.at === "hand") handPiece.set(p.key, Math.max(handPiece.get(p.key) ?? 0, c.score));
  }
  return { signature, combos, handPiece };
}

// ---------- ข้อมูลคอมโบ: ทรัพยากร การโจมตี การป้องกัน การขัดขวาง ----------

const HEART = 11000;   // G ยูนิทบนแวนการ์ดได้ Power ของฮาร์ท (เกรด 3 ทั่วไป)

interface Unit { key: string; power: number; crit: number; vc: boolean }

// ยูนิทที่ถูกคอล: ใบในสายคอมโบก่อน ที่เหลือเลือกใบ Power สูงสุดในเด็คที่ตรงตัวกรอง (นับจำนวนใบ)
function calledUnits(cards: Entry[], source: Card, filter: string, n: number, chained: string | undefined): Unit[] {
  const out: Unit[] = [];
  const left = new Map(cards.map((e) => [e.key, e.copies]));
  const take = (k: string) => { out.push({ key: k, power: cards.find((e) => e.key === k)!.card.power ?? 0, crit: 1, vc: false }); left.set(k, left.get(k)! - 1); };
  if (chained) take(chained);
  const pool = cards.filter((e) => !isG(e.card) && fits(e.card, filter, source)).sort((a, b) => (b.card.power ?? 0) - (a.card.power ?? 0));
  for (const e of pool) while (out.length < n && (left.get(e.key) ?? 0) > 0) take(e.key);
  return out;
}

// Shield จากการคอลการ์ดลง GC: ใบ Shield สูงสุด (different-grades = เกรดไม่ซ้ำกัน)
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
          // "+1000 per 2 drop" ขึ้นกับดรอปโซน: ประมาณ +5000
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
  // เกรด 0-1 เป็นตัวบูสท์ (บวก Power ให้ตัวโจมตีที่ยังไม่มีตัวบูสท์) เกรด 2 ขึ้นไปและแวนการ์ดเป็นตัวโจมตี
  const gradeOf = (u: Unit) => (u.vc ? 4 : card(u.key.split("@")[0]).grade);
  const attackers = units.filter((u) => gradeOf(u) >= 2).sort((a, b) => b.power - a.power).map((u) => ({ power: u.power, crit: u.crit }));
  const boosters = units.filter((u) => gradeOf(u) <= 1).sort((a, b) => b.power - a.power);
  boosters.forEach((b, j) => { if (attackers[j]) attackers[j].power += b.power; });
  pr.attacks = attackers;
  return pr;
}

// Shield ที่คู่แข่งต้องใช้กันทุกการโจมตีของคอมโบ (ใช้ประเมินว่าตีบ่อยลดการ์ดบนมือคู่แข่งได้เท่าไร)
// การโจมตีที่ Power ไม่ถึงแวนการ์ดคู่แข่งไม่บังคับให้ใช้การ์ด
export function shieldForced(pr: ComboProfile, oppVc: number): number {
  return pr.attacks.reduce((n, a) => n + (a.power >= oppVc ? Math.ceil((a.power - oppVc + 1) / 5000) * 5000 : 0), 0);
}

// เล่นคอมโบนี้ได้ไหมด้วยทรัพยากรที่มี (CB SB GB G โซนคว่ำ) และกองไม่หมด
export function affordable(pr: ComboProfile, res: { cb: number; sb: number; gb: number; gFaceDown: number; deck: number }): boolean {
  return res.cb >= pr.cbNeed && res.sb >= pr.sbNeed && res.gb >= pr.gb && res.gFaceDown >= pr.flipG && res.deck > pr.deckUse;
}

function distinctPieces(steps: ComboStep[]): { key: string; at: PieceAt }[] {
  const out: { key: string; at: PieceAt }[] = [];
  for (const s of steps) if (!out.some((p) => p.key === s.key)) out.push({ key: s.key, at: s.at });
  return out;
}
