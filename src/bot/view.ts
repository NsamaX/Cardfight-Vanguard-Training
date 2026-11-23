// ข้อมูลที่บอทเห็นได้ตามกฎ และการเติมข้อมูลที่ซ่อนอยู่ด้วยการสุ่มเพื่อจำลองล่วงหน้า (determinization)
// บอทรู้รายการเด็คของทั้งสองฝั่ง (เด็คที่เลือกในโปรแกรม) แต่ไม่รู้ลำดับกองการ์ด มือของคู่แข่ง และ G โซนที่คว่ำของคู่แข่ง
import { nextRandom, shuffle } from "../engine/rng";
import { PLAYERS, isG, other, type CardDB } from "../engine/rules";
import { PILE_ZONES } from "../engine/state";
import type { Card, CardInstance, Deck, GameState, PlayerId } from "../engine/types";

export const HIDDEN = "?";

const PLACEHOLDER: Card = {
  key: HIDDEN, ids: [HIDDEN], name: HIDDEN, format: [], type: "normal", grade: 0, power: 0,
  race: "", clan: "", abilities: [], text: "", source: "",
};

// db ที่รู้จักการ์ดซ่อน (ฟังก์ชันของ engine อ่าน db[key] ได้โดยไม่พัง)
export const withHidden = (db: CardDB): CardDB => ({ ...db, [HIDDEN]: PLACEHOLDER });

export const isHidden = (inst: CardInstance) => inst.key === HIDDEN;

// seen = uid ของการ์ดที่เคยเปิดให้เห็น (ไดรฟ์เช็ค ค้นขึ้นมือ) ถ้ายังอยู่บนมือคู่แข่งก็ยังรู้ว่าเป็นใบไหน
export function viewFor(s: GameState, p: PlayerId, seen: ReadonlySet<string> = new Set()): GameState {
  const v = structuredClone(s);
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

// การ์ดที่ยังไม่ปรากฏ = รายการเด็ค − การ์ดทุกใบของ p ที่มองเห็น (main = มือที่ไม่รู้ + กองการ์ด, g = G โซนที่คว่ำและไม่รู้)
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

// ข้อมูลที่บอทนับไว้แนบกับ view (สนามที่สุ่มเติมแล้วไม่มี เพราะมองเห็นกองการ์ดอยู่แล้ว)
export interface Reads {
  oppPassive: number;     // คู่แข่งยอมรับดาเมจตอนดาเมจสูงกี่ครั้ง (บ่งว่า Shield บนมือน้อย)
  oppRevealedG3: boolean; // คู่แข่งแสดงเกรด 3 จากมือในเทิร์นนี้ (คอสต์ของทอมมี่) จึงรู้ว่ามีเกรด 3 อย่างน้อย 1 ใบ
}
export interface Intel {
  pools: Record<PlayerId, { main: Map<string, number>; g: Map<string, number> }>;
  reads: Reads;
}
const INTEL = new WeakMap<GameState, Intel>();
export const intelOf = (s: GameState) => INTEL.get(s);
export function attachPools(db: CardDB, view: GameState, decks: Record<PlayerId, Deck>, reads: Reads = { oppPassive: 0, oppRevealedG3: false }) {
  INTEL.set(view, { pools: { me: unseenPool(db, view, "me", decks.me).pool, bot: unseenPool(db, view, "bot", decks.bot).pool }, reads });
}

// การ์ดที่อาจอยู่ในกองของ p: กองมองเห็น = กองจริง, กองซ่อน = การ์ดที่ยังไม่ปรากฏ (นับจากรายการเด็ค)
export function deckOdds(db: CardDB, s: GameState, p: PlayerId): { size: number; count: (f: (c: Card) => boolean) => number } {
  const deck = s.players[p].deck;
  const pool = INTEL.get(s)?.pools[p].main;
  if (!deck.some(isHidden) || !pool) {
    return { size: deck.length, count: (f) => deck.filter((c) => !isHidden(c) && f(db[c.key])).length };
  }
  const total = [...pool.values()].reduce((n, x) => n + Math.max(0, x), 0) || 1;
  // ใช้สัดส่วนจากการ์ดที่ยังไม่ปรากฏ (มือที่ไม่รู้ + กอง) คูณขนาดกองจริง
  return { size: deck.length, count: (f) => [...pool].reduce((n, [k, x]) => n + (db[k] && f(db[k]) ? Math.max(0, x) : 0), 0) * deck.length / total };
}

// เติมการ์ดที่ซ่อนด้วยการ์ดที่ยังไม่ปรากฏตามรายการเด็ค แล้วสุ่ม rng ใหม่ (อนาคตของเกมจำลองไม่ตรงกับเกมจริง)
export function determinize(db: CardDB, view: GameState, decks: Record<PlayerId, Deck>, seed: number): GameState {
  const s = structuredClone(view);
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
