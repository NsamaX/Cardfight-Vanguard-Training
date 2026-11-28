// Play an online match from the command line (a second player for testing online play with a real person).
// Signs in with CLAUDE_EMAIL / CLAUDE_PASSWORD from .env, keeps the current room in .temp/seat.json, and prints only what a player
// may see: own hand, the board, and public zones (never the opponent's hand or any deck order).
//   npm run seat -- create            open a room with the deck named in SEAT_DECK (default "Genesis Regalia"); prints the code
//   npm run seat -- join <code>       join a friend's room
//   npm run seat -- wait [minutes]    wait until this player has to decide (or the game ends); prints the board and the choices
//   npm run seat -- show              print the board now
//   npm run seat -- act '<json>'      play an action, e.g. '{"type":"next-phase"}'; prints the board after it
//   npm run seat -- ready | start     after a game: ready for a rematch / start it
//   npm run seat -- leave             leave the room
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
process.loadEnvFile(join(ROOT, ".env"));
// Must equal the build the other player runs (next.config.ts uses the same commit hash)
process.env.NEXT_PUBLIC_BUILD_ID ??= execSync("git rev-parse --short=12 HEAD", { cwd: ROOT }).toString().trim();

const STATE_FILE = join(ROOT, ".temp/seat.json");

// supabase-js keeps the session in localStorage; Node has none, so without this every request after sign-in is anonymous
const memory = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {   // Node 24 has a localStorage that needs a flag to work: replace it
  getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); },
  removeItem: (k: string) => { memory.delete(k); },
};

async function main() {
  const { supabase } = await import("../src/lib/supabase");
  const online = await import("../src/lib/online");
  const { loadLibrary } = await import("../src/lib/library");
  const { cardByKey: db, setCards } = await import("../src/data/cards");
  const { apply, createGame } = await import("../src/engine/game");
  const { other } = await import("../src/engine/rules");
  const { table } = await import("./table");
  type GameState = import("../src/engine/types").GameState;
  type PlayerId = import("../src/engine/types").PlayerId;
  type Action = import("../src/engine/types").Action;
  type GameEvent = import("../src/engine/types").GameEvent;
  type OnlineMatch = import("../src/lib/online").OnlineMatch;

  if (!supabase) throw new Error("Supabase isn't configured in .env");
  const email = process.env.CLAUDE_EMAIL, password = process.env.CLAUDE_PASSWORD;
  if (!email || !password) throw new Error("Set CLAUDE_EMAIL and CLAUDE_PASSWORD in .env");
  const { data: auth, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !auth.user) throw new Error(`Sign-in failed: ${error?.message}`);
  const userId = auth.user.id;

  interface Saved { room?: { id: string; code: string }; match?: string; seen?: number }
  const load = (): Saved => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {});
  const save = (s: Saved) => { mkdirSync(join(ROOT, ".temp"), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s)); };

  const deckName = process.env.SEAT_DECK ?? "Genesis Regalia";
  const library = async () => {
    const lib = await loadLibrary(userId);
    const deck = lib.decks.find((d) => d.name === deckName);
    if (!deck) throw new Error(`No deck named "${deckName}" (decks: ${lib.decks.map((d) => d.name).join(", ")})`);
    return { lib, deck };
  };

  // ---------- the game as this player sees it ----------

  async function current(saved: Saved): Promise<{ m: OnlineMatch; s?: GameState; events: GameEvent[][] } | undefined> {
    let id = saved.match;
    if (!id && saved.room) {
      const m = await online.pollRoom(saved.room, userId).catch(() => undefined);
      if (!m) return undefined;
      id = m.id;
    }
    if (!id) return undefined;
    let m = await online.fetchMatch(id, userId);
    while (m.next) m = await online.fetchMatch(m.next, userId, m.opponent);   // a rematch started: follow it
    if (m.id !== saved.match) save({ ...saved, match: m.id, seen: 0 });
    setCards(m.cards);
    if (m.status !== "playing" && m.status !== "done") return { m, events: [] };
    if (m.seed === undefined || !m.firstPlayer) return { m, events: [] };
    const actions = await online.fetchActions(m.id, m.host, 0);
    let s = createGame(db, { seed: m.seed, firstPlayer: m.firstPlayer, decks: m.decks });
    const events: GameEvent[][] = [];
    for (const r of actions) { const res = apply(db, s, r.player, r.action); s = res.state; events.push(res.events); }
    return { m, s, events };
  }

  const view = (seat: PlayerId) => table(db, { me: seat === "me" ? "Claude" : "Opponent", bot: seat === "bot" ? "Claude" : "Opponent" },
    { label: { [seat]: "CLAUDE (me)", [other(seat)]: "OPPONENT" } as Record<PlayerId, string>, open: [seat] });

  function report(saved: Saved, cur: NonNullable<Awaited<ReturnType<typeof current>>>) {
    const { m, s, events } = cur;
    if (!s) { console.log(`Room status: ${m.status}${m.status === "setup" ? " (both press start)" : ""}; opponent: ${m.opponent}`); return; }
    const seat = m.seat;
    const from = Math.min(saved.seen ?? 0, events.length);
    const v = view(seat), log = v.log(events.slice(from).flat());
    if (log) console.log(`--- since last look ---\n${log}`);
    console.log(v.board(s, seat));
    console.log(`match ${m.id} status=${m.status}`);
    console.log(v.decision(s, seat));
    save({ ...saved, match: m.id, seen: events.length });
  }

  const [cmd, arg] = process.argv.slice(2);
  const saved = load();
  if (cmd === "create") {
    const { lib, deck } = await library();
    const room = await online.createRoom(userId, deck, lib.cards);
    save({ room });
    console.log(`Room code: ${room.code}`);
  } else if (cmd === "join") {
    const { lib, deck } = await library();
    const m = await online.joinRoom(userId, arg, deck, lib.cards);
    save({ match: m.id, seen: 0 });
    console.log(`Joined ${m.opponent}'s room`);
    const cur = await current(load());
    if (cur) report(load(), cur);
  } else if (cmd === "wait") {
    const until = Date.now() + Number(arg ?? 30) * 60_000;
    for (;;) {
      const cur = await current(load());
      const mine = cur?.s ? cur.s.awaiting?.player === cur.m.seat || !!cur.s.winner : cur?.m.status === "setup";
      if (cur && mine) { report(load(), cur); break; }
      if (Date.now() > until) { console.log("Still waiting (timed out)"); if (cur) report(load(), cur); break; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } else if (cmd === "show") {
    const cur = await current(saved);
    if (cur) report(saved, cur); else console.log("No match yet");
  } else if (cmd === "act") {
    const cur = await current(saved);
    if (!cur?.s) throw new Error("No game in progress");
    const action = JSON.parse(arg) as Action;
    const res = apply(db, cur.s, cur.m.seat, action);   // throws a RuleError if the action isn't allowed
    const seq = (await online.fetchActions(cur.m.id, cur.m.host, 0)).length;
    await online.sendAction(cur.m.id, seq, action);
    console.log(view(cur.m.seat).log(res.events));
    const after = await current(load());
    if (after) report({ ...load(), seen: (load().seen ?? 0) + 1 }, after);
  } else if (cmd === "ready") {
    if (!saved.match) throw new Error("No match");
    const next = await online.readyRematch(saved.match);
    console.log(next ? `Rematch created: ${next}` : "Ready; waiting for the opponent");
  } else if (cmd === "start") {
    const cur = await current(saved);
    if (!cur) throw new Error("No match");
    await online.startMatch(cur.m.id);
    console.log("Pressed Start");
  } else if (cmd === "leave") {
    if (saved.match) await online.leaveMatch(saved.match);
    else if (saved.room) await online.closeRoom(saved.room.id);
    save({});
    console.log("Left");
  } else {
    console.log("Commands: create | join <code> | wait [minutes] | show | act '<json>' | ready | start | leave");
  }
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
