// Copies a whole GameState (several times faster than structuredClone, since it knows the state's shape)
// - objects referenced from several places (e.g. checkCard and battle.triggers[].card) stay the same object in the copy
// - Abilities come from db and are never modified, so they're shared without copying
import type { CardInstance, GameState, PlayerState } from "./types";

export function cloneState(s: GameState): GameState {
  const seen = new Map<object, unknown>();
  const card = (i: CardInstance): CardInstance => {
    const hit = seen.get(i) as CardInstance | undefined;
    if (hit) return hit;
    const c: CardInstance = { ...i, mods: i.mods.length ? i.mods.map((m) => ({ ...m })) : [], usedThisTurn: i.usedThisTurn.slice() };
    if (i.grants) c.grants = i.grants.slice();
    seen.set(i, c);
    return c;
  };
  const cards = (l: CardInstance[]) => { const out = new Array<CardInstance>(l.length); for (let k = 0; k < l.length; k++) out[k] = card(l[k]); return out; };
  const player = (p: PlayerState): PlayerState => {
    const circles: PlayerState["circles"] = {};
    for (const k in p.circles) { const u = p.circles[k as keyof typeof circles]; if (u) circles[k as keyof typeof circles] = card(u); }
    const r: PlayerState = {
      ...p, circles, guardian: cards(p.guardian), hand: cards(p.hand), deck: cards(p.deck), drop: cards(p.drop),
      soul: cards(p.soul), damage: cards(p.damage), gZone: cards(p.gZone), bind: cards(p.bind), removed: cards(p.removed ?? []),
    };
    if (p.heart) r.heart = card(p.heart);
    return r;
  };
  // The rest is small: generic copy (cards inside point to the same copies as on the board)
  const any = (v: unknown, key?: string): unknown => {
    if (v === null || typeof v !== "object" || key === "ability") return v;
    const hit = seen.get(v);
    if (hit) return hit;
    if (Array.isArray(v)) {
      const a = new Array(v.length);
      seen.set(v, a);
      for (let k = 0; k < v.length; k++) a[k] = key === "grants" ? v[k] : any(v[k]);
      return a;
    }
    if ("uid" in v && "mods" in v) return card(v as CardInstance);
    const o: Record<string, unknown> = {};
    seen.set(v, o);
    for (const k in v) o[k] = any((v as Record<string, unknown>)[k], k);
    return o;
  };
  const out: GameState = { ...s, players: { me: player(s.players.me), bot: player(s.players.bot) }, mulliganDone: s.mulliganDone.slice() };
  for (const k of ["battle", "events", "queue", "resolving", "awaiting"] as const) if (s[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = any(s[k]);
  return out;
}
