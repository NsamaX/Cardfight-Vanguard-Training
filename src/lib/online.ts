// Online matches through Supabase: rooms with a 6-digit code, both decks snapshotted in the match row, and every action stored in order.
// Both clients run the same engine from the same seed and snapshot, so sending the actions is enough to keep the boards equal.
// The host plays the engine's "me" side and the guest the "bot" side; each client shows its own side at the bottom.
// A room can hold several games: each game is its own match row, linked to the next by next_match.
import { cardByKey } from "../data/cards";
import { apply, createGame } from "../engine/game";
import type { Action, Card, Deck, GameState, PlayerId } from "../engine/types";
import type { MsgKey } from "../i18n/msg";
import type { RecordedAction } from "../replay/types";
import { supabase } from "./supabase";

// Clients on different builds could run the engine differently, so join_match refuses to pair them
export const ENGINE_VERSION = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

export const CODE_LENGTH = 6;

// waiting = room open for a guest; setup = before Start (decks can change); playing; done = game over or someone left
export type MatchStatus = "waiting" | "setup" | "playing" | "done";

interface MatchRow {
  id: string;
  code: string;
  host: string;
  host_deck: Deck;
  host_cards: Card[];
  guest: string | null;
  guest_deck: Deck | null;
  guest_cards: Card[] | null;
  seed: number | null;
  first_player: "host" | "guest" | null;
  status: MatchStatus;
  host_ready: boolean;
  guest_ready: boolean;
  next_match: string | null;
  abandoned: boolean;
}

export interface WaitingRoom { id: string; code: string }

export interface OnlineMatch {
  id: string;
  host: string;                        // the host's user id (actions are told apart by who inserted them)
  seat: PlayerId;
  opponent: string;                    // the opponent's display name
  decks: Record<PlayerId, Deck>;
  cards: Card[];                       // every card both decks use (the guest's keys renamed where they clash with the host's)
  seed?: number;                       // rolled when the game starts
  firstPlayer?: PlayerId;
  status: MatchStatus;
  ready: Record<PlayerId, boolean>;    // done: pressed Ready for another game; setup: pressed Start
  next?: string;                       // the next game's match id, once both pressed Ready
  abandoned: boolean;                  // a player left the room
}

// Where a client enters a game: the match and the actions already played (resuming after a reload)
export interface OnlineStart { match: OnlineMatch; actions: RecordedAction[] }

export class OnlineError extends Error {
  constructor(public key: MsgKey) { super(key); }
}

const db = () => {
  if (!supabase) throw new OnlineError("online.failed");
  return supabase;
};

function must<T>({ data, error }: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (error) throw error;
  return data as T;
}

const JOIN_ERRORS: Record<string, MsgKey> = {
  "match not found": "online.notFound",
  "cannot join your own match": "online.ownRoom",
  "engine version mismatch": "online.version",
};

// The deck's card data travels with the match, so the opponent plays it exactly as the owner wrote it
// cards: the owner's library (not the card registry, which holds the opponent's cards during a match)
export function snapshot(deck: Deck, cards: Card[]): Card[] {
  const byKey = new Map(cards.map((c) => [c.key, c]));
  return [...new Set([...Object.keys(deck.main), ...Object.keys(deck.g_zone)])].map((k) => byKey.get(k)!);
}

const ROW = "id, code, host, host_deck, host_cards, guest, guest_deck, guest_cards, seed, first_player, status, host_ready, guest_ready, next_match, abandoned";

export async function createRoom(userId: string, deck: Deck, cards: Card[]): Promise<WaitingRoom> {
  const c = db();
  const old = must(await c.from("matches").select("id").eq("host", userId).eq("status", "waiting"));
  await Promise.all(old.map((m: { id: string }) => c.rpc("finish_match", { p_match: m.id })));
  for (let i = 0; i < 5; i++) {
    const { data, error } = await c.from("matches")
      .insert({ engine_version: ENGINE_VERSION, host_deck: deck, host_cards: snapshot(deck, cards) })
      .select("id, code").single();
    if (!error) return data;
    if (error.code !== "23505") throw error;   // another open room has this code: roll again
  }
  throw new OnlineError("online.failed");
}

export async function closeRoom(id: string) {
  await db().rpc("finish_match", { p_match: id });
}

async function readRow(id: string): Promise<MatchRow> {
  return must(await db().from("matches").select(ROW).eq("id", id).single());
}

// Waiting host: the match once a guest has joined, otherwise undefined
export async function pollRoom(room: WaitingRoom, userId: string): Promise<OnlineMatch | undefined> {
  const row = await readRow(room.id);
  if (row.status === "waiting") return undefined;
  if (row.status === "done") throw new OnlineError("online.roomClosed");
  return toMatch(row, userId);
}

export async function joinRoom(userId: string, code: string, deck: Deck, cards: Card[]): Promise<OnlineMatch> {
  const { data, error } = await db().rpc("join_match", { p_code: code, p_engine_version: ENGINE_VERSION, p_deck: deck, p_cards: snapshot(deck, cards) });
  if (error) throw new OnlineError(JOIN_ERRORS[error.message] ?? "online.failed");
  return toMatch(await readRow((data as MatchRow).id), userId);
}

// A game this player is still in (e.g. after a reload), with the actions played so far
export async function findActiveMatch(userId: string): Promise<OnlineStart | undefined> {
  const rows: MatchRow[] = must(await db().from("matches").select(ROW).in("status", ["setup", "playing"])
    .or(`host.eq.${userId},guest.eq.${userId}`).order("created_at", { ascending: false }).limit(1));
  if (!rows.length) return undefined;
  return { match: await toMatch(rows[0], userId), actions: await fetchActions(rows[0].id, rows[0].host, 0) };
}

// The match row again (opponent: the name already known, so it isn't looked up again)
export async function fetchMatch(id: string, userId: string, opponent?: string): Promise<OnlineMatch> {
  return toMatch(await readRow(id), userId, opponent);
}

export async function finishMatch(id: string) {
  await db().rpc("finish_match", { p_match: id });
}

export async function leaveMatch(id: string) {
  await db().rpc("leave_match", { p_match: id });
}

// Ready for another game: the next match's id once both players are ready
export async function readyRematch(id: string): Promise<string | undefined> {
  const { data, error } = await db().rpc("ready_rematch", { p_match: id });
  if (error) throw new OnlineError("online.failed");
  return (data as string | null) ?? undefined;
}

export async function setMatchDeck(id: string, deck: Deck, cards: Card[]) {
  must(await db().rpc("set_match_deck", { p_match: id, p_deck: deck, p_cards: snapshot(deck, cards) }));
}

export async function startMatch(id: string) {
  must(await db().rpc("start_match", { p_match: id }));
}

interface ActionRow { seq: number; player: string; action: Action }

const toRecorded = (host: string) => (r: ActionRow): { seq: number; rec: RecordedAction } =>
  ({ seq: r.seq, rec: { player: r.player === host ? "me" : "bot", action: r.action } });

export async function fetchActions(matchId: string, host: string, from: number): Promise<RecordedAction[]> {
  const rows: ActionRow[] = must(await db().from("match_actions").select("seq, player, action").eq("match_id", matchId).gte("seq", from).order("seq"));
  return rows.map(toRecorded(host)).filter((r, i) => r.seq === from + i).map((r) => r.rec);
}

export async function sendAction(matchId: string, seq: number, action: Action) {
  must(await db().from("match_actions").insert({ match_id: matchId, seq, action }));
}

// Live updates for one match: new actions from either player, and changes to the match row; returns the unsubscribe function
export function watchMatch(matchId: string, host: string, on: { action: (seq: number, rec: RecordedAction) => void; changed: () => void; connected: () => void }) {
  const c = db();
  const ch = c.channel(`match:${matchId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "match_actions", filter: `match_id=eq.${matchId}` },
      (p) => { const r = toRecorded(host)(p.new as ActionRow); on.action(r.seq, r.rec); })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` }, () => on.changed())
    .subscribe((status) => { if (status === "SUBSCRIBED") on.connected(); });
  return () => { c.removeChannel(ch); };
}

async function displayName(id: string): Promise<string> {
  const { data } = await db().from("profiles").select("display_name").eq("id", id).maybeSingle();
  return data?.display_name ?? "?";
}

const withoutImage = ({ image: _image, ...rest }: Card) => JSON.stringify(rest);

// Both clients build the same card set and decks from the same row: a guest card whose key the host also uses but with
// different data gets a renamed key, so each side plays its own version
export function matchCards(hostCards: Card[], guestCards: Card[], guestDeck: Deck): { cards: Card[]; guestDeck: Deck } {
  const host = new Map(hostCards.map((c) => [c.key, c]));
  const renamed: Record<string, string> = {};
  const cards = [...hostCards];
  for (const c of guestCards) {
    const h = host.get(c.key);
    if (h && withoutImage(h) === withoutImage(c)) continue;
    if (h) renamed[c.key] = `${c.key}~2`;
    cards.push({ ...c, key: renamed[c.key] ?? c.key });
  }
  const k = (key: string) => renamed[key] ?? key;
  const counts = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([key, n]) => [k(key), n]));
  return {
    cards,
    guestDeck: { ...guestDeck, starter: k(guestDeck.starter), main: counts(guestDeck.main), g_zone: counts(guestDeck.g_zone), cover: guestDeck.cover && k(guestDeck.cover) },
  };
}

async function toMatch(row: MatchRow, userId: string, opponent?: string): Promise<OnlineMatch> {
  const seat: PlayerId = row.host === userId ? "me" : "bot";
  const { cards, guestDeck } = matchCards(row.host_cards, row.guest_cards!, row.guest_deck!);
  return {
    id: row.id, host: row.host, seat,
    opponent: opponent ?? await displayName(seat === "me" ? row.guest! : row.host),
    decks: { me: row.host_deck, bot: guestDeck }, cards,
    seed: row.seed ?? undefined, firstPlayer: row.first_player ? (row.first_player === "host" ? "me" : "bot") : undefined,
    status: row.status,
    ready: { me: row.host_ready, bot: row.guest_ready },
    next: row.next_match ?? undefined,
    abandoned: row.abandoned,
  };
}

// The board before Start: only the decks matter (the board shows them undealt), so any seed will do
export const setupBoard = (m: OnlineMatch): GameState => createGame(cardByKey, { seed: 0, firstPlayer: "me", decks: m.decks });

// The board after the given actions (the card registry must already hold the match's cards)
export function rebuild(m: OnlineMatch, actions: RecordedAction[]): GameState {
  let s = createGame(cardByKey, { seed: m.seed!, firstPlayer: m.firstPlayer!, decks: m.decks });
  for (const r of actions) s = apply(cardByKey, s, r.player, r.action).state;
  return s;
}
