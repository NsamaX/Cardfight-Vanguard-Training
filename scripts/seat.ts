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
  const { apply, createGame, usableActs, gGuardianBlocked } = await import("../src/engine/game");
  const { powerOf, criticalOf, shieldOf, other, RC, FRONT } = await import("../src/engine/rules");
  const { translate } = await import("../src/i18n");
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

  const name = (k: string) => db[k]?.name ?? k;
  const names = (seat: PlayerId) => ({ "player.me": seat === "me" ? "Claude" : "Opponent", "player.bot": seat === "bot" ? "Claude" : "Opponent",
    "winner.me": seat === "me" ? "Claude wins" : "Opponent wins", "winner.bot": seat === "bot" ? "Claude wins" : "Opponent wins" });
  const tr = (seat: PlayerId, m: Parameters<typeof translate>[1]) => translate("en", m, undefined, names(seat));

  function board(m: OnlineMatch, s: GameState, seat: PlayerId): string {
    const out: string[] = [];
    const side = (p: PlayerId, mine: boolean) => {
      const ps = s.players[p];
      out.push(`== ${mine ? "CLAUDE (me)" : "OPPONENT"} ==`);
      for (const c of ["vc", ...RC] as const) {
        const u = ps.circles[c];
        if (!u) continue;
        if (!u.faceUp && !mine) { out.push(`  ${c.padEnd(12)} face down [${u.uid}]`); continue; }   // the opponent's starter before the game starts
        const mods = u.mods.filter((x) => x.stat === "power").reduce((n, x) => n + x.value, 0);
        out.push(`  ${c.padEnd(12)} ${name(u.key)} | P${powerOf(db, ps, c)}${mods ? ` (${mods > 0 ? "+" : ""}${mods})` : ""} C${criticalOf(db, u)}${u.rested ? " REST" : ""}${u.hollowed ? " HOLLOW" : ""}${u.grants?.length ? ` +${u.grants.length} granted` : ""} [${u.uid}]`);
      }
      if (ps.heart) out.push(`  heart        ${name(ps.heart.key)}`);
      const faceUpDmg = ps.damage.filter((d) => d.faceUp).length;
      out.push(`  damage ${ps.damage.length} (face up ${faceUpDmg}): ${ps.damage.map((d) => name(d.key) + (d.faceUp ? "" : " (down)")).join(", ")}`);
      out.push(`  soul ${ps.soul.length}: ${ps.soul.map((x) => name(x.key)).join(", ")}`);
      out.push(`  drop ${ps.drop.length}: ${ps.drop.map((x) => name(x.key)).join(", ")}`);
      out.push(`  G zone: ${ps.gZone.filter((g) => !g.faceUp).length} face down${mine ? ` (${ps.gZone.filter((g) => !g.faceUp).map((g) => `${name(g.key)} [${g.uid}]`).join(", ")})` : ""}; face up: ${ps.gZone.filter((g) => g.faceUp).map((g) => name(g.key)).join(", ") || "-"}`);
      if (ps.bind.length) out.push(`  bind: ${ps.bind.map((x) => name(x.key)).join(", ")}`);
      out.push(`  deck ${ps.deck.length}`);
      if (mine) out.push(`  hand ${ps.hand.length}: ${ps.hand.map((h) => `${name(h.key)} (G${db[h.key].grade}${db[h.key].trigger ? " " + db[h.key].trigger : ""}, S${shieldOf(db, h)}) [${h.uid}]`).join("; ")}`);
      else out.push(`  hand ${ps.hand.length}`);
    };
    out.push(`Turn ${s.turn} (${s.turnPlayer === seat ? "my" : "opponent's"} turn) phase=${s.phase}${s.step ? `/${s.step}` : ""}${s.battle ? ` battle: ${s.battle.attacker} → ${s.battle.target}` : ""}`);
    side(other(seat), false);
    side(seat, true);
    if (s.winner) out.push(`GAME OVER: ${s.winner === seat ? "Claude wins" : "opponent wins"}`);
    out.push(`match ${m.id} status=${m.status}`);
    return out.join("\n");
  }

  function decision(s: GameState, seat: PlayerId): string {
    const a = s.awaiting;
    if (!a || a.player !== seat) return "Not my decision.";
    const out = [`DECIDE: ${a.kind}${a.prompt ? ` — ${tr(seat, a.prompt)}` : ""}`];
    const c = a.choice;
    if (c?.kind === "cards") out.push(`  pick ${c.min}-${c.max} of: ${c.options.map((u) => { const l = Object.values(s.players).flatMap((p) => [...Object.values(p.circles), ...p.hand, ...p.drop, ...p.soul, ...p.deck, ...p.damage, ...p.gZone, ...p.guardian]).find((i) => i?.uid === u); return `${l ? name(l.key) : "?"} [${u}]`; }).join("; ")}  → {"type":"select-target","uids":[...]}`);
    if (c?.kind === "circle") out.push(`  circle of: ${c.options.join(", ")}  → {"type":"select-target","uids":[],"to":"..."}`);
    if (c?.kind === "yesno" || c?.kind === "option") out.push(`  options: ${(c.kind === "yesno" ? ["yes", "no"] : c.options).join(", ")}  → {"type":"choose","option":"..."}`);
    if (a.kind === "order-queue") out.push(`  queue: ${s.queue.filter((e) => e.owner === seat).map((e, i) => `${i}: ${e.label}${e.optional ? " (optional)" : ""}`).join("; ")}  → {"type":"order-queue","index":n} / {"type":"decline-queue","index":n}`);
    if (a.kind === "next-phase" && s.phase === "main") {
      const acts = usableActs(db, s);
      if (acts.length) out.push(`  ACT: ${acts.map((x) => `${x.label} {"type":"activate","cardUid":"${x.uid}","abilityIndex":${x.index}}`).join("; ")}`);
      out.push(`  call: {"type":"call","uid":"...","to":"front_left|front_right|back_left|back_center|back_right"}; move: {"type":"move","from":"..","to":".."}; next: {"type":"next-phase"}`);
    }
    if (a.kind === "next-phase" && s.phase === "battle") out.push(`  attack: {"type":"attack","attacker":"vc|front_left|front_right","target":"vc|front_left|front_right","booster":"back_center|back_left|back_right"}; end battle: {"type":"next-phase"}`);
    if (a.kind === "next-phase" && s.phase === "ride") out.push(`  ${s.step === "stride" ? `stride: {"type":"stride","gUid":"...","discardUids":[...]}` : `ride: {"type":"ride","uid":"..."}`}; skip: {"type":"next-phase"}`);
    if (a.kind === "guard") out.push(`  guard: {"type":"guard","uids":[...],"intercept":["front_left"]}; G guardian${gGuardianBlocked(db, s, seat) ? " (not now)" : ""}: {"type":"call-g-guardian","gUid":"...","discardUid":"..."}; done: {"type":"end-guard"}`);
    if (a.kind === "trigger-target") out.push(`  {"type":"trigger-target","powerTo":"vc","extraTo":"vc"} (${s.battle?.pendingTrigger?.kind}${s.battle?.pendingTrigger?.kind === "heal" ? ', optional "healUid"' : ""})`);
    if (a.kind === "mulligan") out.push(`  {"type":"mulligan","returnUids":[...]}`);
    return out.join("\n");
  }

  function report(saved: Saved, cur: NonNullable<Awaited<ReturnType<typeof current>>>) {
    const { m, s, events } = cur;
    if (!s) { console.log(`Room status: ${m.status}${m.status === "setup" ? " (both press start)" : ""}; opponent: ${m.opponent}`); return; }
    const seat = m.seat;
    const from = Math.min(saved.seen ?? 0, events.length);
    const log = events.slice(from).flat().map((e) => `  · ${tr(seat, e.text)}`);
    if (log.length) console.log(`--- since last look ---\n${log.join("\n")}`);
    console.log(board(m, s, seat));
    console.log(decision(s, seat));
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
    console.log(res.events.map((e) => `  · ${tr(cur.m.seat, e.text)}`).join("\n"));
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
