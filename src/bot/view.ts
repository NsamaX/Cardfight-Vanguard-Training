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

// เติมการ์ดที่ซ่อนด้วยการ์ดที่ยังไม่ปรากฏตามรายการเด็ค แล้วสุ่ม rng ใหม่ (อนาคตของเกมจำลองไม่ตรงกับเกมจริง)
export function determinize(db: CardDB, view: GameState, decks: Record<PlayerId, Deck>, seed: number): GameState {
  const s = structuredClone(view);
  let r = seed >>> 0 || 1;
  for (const p of PLAYERS) {
    const all = ownedInstances(s, p);
    const pool = { main: new Map(Object.entries(decks[p].main)), g: new Map(Object.entries(decks[p].g_zone)) };
    const hidden = { main: [] as CardInstance[], g: [] as CardInstance[] };
    for (const inst of all) {
      if (isHidden(inst)) { (s.players[p].gZone.includes(inst) ? hidden.g : hidden.main).push(inst); continue; }
      const card = db[inst.key];
      if (!card) continue;
      const m = isG(card) ? pool.g : pool.main;
      const n = m.get(inst.key);
      if (n) m.set(inst.key, n - 1);
    }
    for (const kind of ["main", "g"] as const) {
      const keys = [...pool[kind]].flatMap(([k, n]) => Array<string>(Math.max(0, n)).fill(k));
      let shuffled: string[];
      [shuffled, r] = shuffle(keys, r);
      hidden[kind].forEach((inst, i) => { inst.key = shuffled[i] ?? HIDDEN; });
    }
  }
  let v: number;
  [v, r] = nextRandom(r);
  s.rngState = Math.floor(v * 2 ** 31) | 1;
  return s;
}
