// Text view of a game for the command-line players (seat.ts, sandbox.ts): the board, the pending decision with the action JSON
// to answer it, and the log. `open` lists the sides whose hand and G zone are shown (the other side's stay hidden).
import { gGuardianBlocked, usableActs } from "../src/engine/game";
import { criticalOf, other, powerOf, RC, shieldOf, type CardDB } from "../src/engine/rules";
import type { GameEvent, GameState, PlayerId } from "../src/engine/types";
import { translate } from "../src/i18n";

export interface TableOpts {
  label: Record<PlayerId, string>;   // heading of each side, e.g. "CLAUDE (me)"
  open: PlayerId[];
  deckTop?: number;                  // show this many top cards of each open deck (sandbox: the order was set by the scenario)
}

export function table(db: CardDB, names: Record<PlayerId, string>, opts: TableOpts) {
  const name = (k: string) => db[k]?.name ?? k;
  const msgNames = {
    "player.me": names.me, "player.bot": names.bot, "winner.me": `${names.me} wins`, "winner.bot": `${names.bot} wins`,
  };
  const tr = (m: Parameters<typeof translate>[1]) => translate("en", m, undefined, msgNames);
  const everyCard = (s: GameState) => Object.values(s.players).flatMap((p) =>
    [...Object.values(p.circles), ...p.hand, ...p.drop, ...p.soul, ...p.deck, ...p.damage, ...p.gZone, ...p.guardian, ...p.bind]);

  function board(s: GameState, bottom: PlayerId): string {
    const out: string[] = [];
    const side = (p: PlayerId) => {
      const ps = s.players[p], open = opts.open.includes(p);
      out.push(`== ${opts.label[p]} ==`);
      for (const c of ["vc", ...RC] as const) {
        const u = ps.circles[c];
        if (!u) continue;
        if (!u.faceUp && !open) { out.push(`  ${c.padEnd(12)} face down [${u.uid}]`); continue; }   // the opponent's starter before the game starts
        const mods = u.mods.filter((x) => x.stat === "power").reduce((n, x) => n + x.value, 0);
        out.push(`  ${c.padEnd(12)} ${name(u.key)} | P${powerOf(db, ps, c)}${mods ? ` (${mods > 0 ? "+" : ""}${mods})` : ""} C${criticalOf(db, u)}${u.rested ? " REST" : ""}${u.hollowed ? " HOLLOW" : ""}${u.grants?.length ? ` +${u.grants.length} granted` : ""} [${u.uid}]`);
      }
      if (ps.heart) out.push(`  heart        ${name(ps.heart.key)}`);
      const faceUpDmg = ps.damage.filter((d) => d.faceUp).length;
      out.push(`  damage ${ps.damage.length} (face up ${faceUpDmg}): ${ps.damage.map((d) => `${name(d.key)}${d.faceUp ? "" : " (down)"} [${d.uid}]`).join(", ")}`);
      out.push(`  soul ${ps.soul.length}: ${ps.soul.map((x) => name(x.key)).join(", ")}`);
      out.push(`  drop ${ps.drop.length}: ${ps.drop.map((x) => name(x.key)).join(", ")}`);
      out.push(`  G zone: ${ps.gZone.filter((g) => !g.faceUp).length} face down${open ? ` (${ps.gZone.filter((g) => !g.faceUp).map((g) => `${name(g.key)} [${g.uid}]`).join(", ")})` : ""}; face up: ${ps.gZone.filter((g) => g.faceUp).map((g) => name(g.key)).join(", ") || "-"}`);
      if (ps.guardian.length) out.push(`  guardians: ${ps.guardian.map((g) => `${name(g.key)} S${shieldOf(db, g)}`).join(", ")} (total ${ps.guardian.reduce((n, g) => n + shieldOf(db, g), 0)})`);
      if (ps.bind.length) out.push(`  bind: ${ps.bind.map((x) => name(x.key)).join(", ")}`);
      const top = open && opts.deckTop ? `; top: ${ps.deck.slice(0, opts.deckTop).map((x) => name(x.key)).join(", ")}` : "";
      out.push(`  deck ${ps.deck.length}${top}`);
      if (open) out.push(`  hand ${ps.hand.length}: ${ps.hand.map((h) => `${name(h.key)} (G${db[h.key].grade}${db[h.key].trigger ? " " + db[h.key].trigger : ""}, S${shieldOf(db, h)}) [${h.uid}]`).join("; ")}`);
      else out.push(`  hand ${ps.hand.length}`);
    };
    out.push(`Turn ${s.turn} (${opts.label[s.turnPlayer]}'s turn) phase=${s.phase}${s.step ? `/${s.step}` : ""}${s.battle ? ` battle: ${s.battle.attacker} → ${s.battle.target}` : ""}`);
    side(other(bottom));
    side(bottom);
    if (s.winner) out.push(`GAME OVER: ${opts.label[s.winner]} wins`);
    return out.join("\n");
  }

  // Which card a pending ability is about, when it isn't the ability's own card (e.g. Nightrose [AUTO 1] for each retired rear-guard)
  const about = (s: GameState, e: GameState["queue"][number]) => {
    const u = e.event && "uid" in e.event ? e.event.uid : undefined;
    const card = u && u !== e.uid ? everyCard(s).find((i) => i?.uid === u) : undefined;
    return card ? ` (about ${name(card.key)} [${u}])` : "";
  };

  // The decision the game waits for, if `seat` makes it (undefined = anyone's)
  function decision(s: GameState, seat?: PlayerId): string {
    const a = s.awaiting;
    if (!a) return s.winner ? "" : "Nothing to decide.";
    if (seat && a.player !== seat) return "Not my decision.";
    const out = [`DECIDE${seat ? "" : ` (${opts.label[a.player]})`}: ${a.kind}${a.prompt ? ` — ${tr(a.prompt)}` : ""}`];
    const c = a.choice;
    if (c?.kind === "cards") out.push(`  pick ${c.min}-${c.max} of: ${c.options.map((u) => { const l = everyCard(s).find((i) => i?.uid === u); return `${l ? name(l.key) : "?"} [${u}]`; }).join("; ")}  → {"type":"select-target","uids":[...]}`);
    if (c?.kind === "circle") out.push(`  circle of: ${c.options.join(", ")}  → {"type":"select-target","uids":[],"to":"..."}`);
    if (c?.kind === "yesno" || c?.kind === "option") out.push(`  options: ${(c.kind === "yesno" ? ["yes", "no"] : c.options).join(", ")}  → {"type":"choose","option":"..."}`);
    if (a.kind === "order-queue") out.push(`  queue: ${s.queue.filter((e) => e.owner === a.player).map((e, i) => `${i}: ${e.label}${about(s, e)}${e.optional ? " (optional)" : ""}`).join("; ")}  → {"type":"order-queue","index":n} / {"type":"decline-queue","index":n}`);
    if (a.kind === "next-phase" && s.phase === "main") {
      const acts = usableActs(db, s);
      if (acts.length) out.push(`  ACT: ${acts.map((x) => `${x.label} {"type":"activate","cardUid":"${x.uid}","abilityIndex":${x.index}}`).join("; ")}`);
      out.push(`  call: {"type":"call","uid":"...","to":"front_left|front_right|back_left|back_center|back_right"}; move: {"type":"move","from":"..","to":".."}; next: {"type":"next-phase"}`);
    }
    if (a.kind === "next-phase" && s.phase === "battle") out.push(`  attack: {"type":"attack","attacker":"vc|front_left|front_right","target":"vc|front_left|front_right","booster":"back_center|back_left|back_right"}; end battle: {"type":"next-phase"}`);
    if (a.kind === "next-phase" && s.phase === "ride") out.push(`  ${s.step === "stride" ? `stride: {"type":"stride","gUid":"...","discardUids":[...]}` : `ride: {"type":"ride","uid":"..."}`}; skip: {"type":"next-phase"}`);
    if (a.kind === "guard") out.push(`  guard: {"type":"guard","uids":[...],"intercept":["front_left"]}; G guardian${gGuardianBlocked(db, s, a.player) ? " (not now)" : ""}: {"type":"call-g-guardian","gUid":"...","discardUid":"..."}; done: {"type":"end-guard"}`);
    if (a.kind === "trigger-target") {
      const kind = s.battle?.pendingTrigger?.kind, ps = s.players[a.player];
      const units = (["vc", ...RC] as const).filter((c) => ps.circles[c]);
      const extra = kind === "critical" ? `, "extraTo": one of ${units.join("|")}`
        : kind === "stand" ? `, "extraTo": a rested rear-guard (${RC.filter((c) => ps.circles[c]?.rested).join("|") || "none: leave it out"})`
        : kind === "heal" ? `, optional "healUid": a damage card [uid] (default: the last one)` : "";
      out.push(`  {"type":"trigger-target","powerTo":${units.join("|")}${extra}} (${kind})`);
    }
    if (a.kind === "mulligan") out.push(`  {"type":"mulligan","returnUids":[...]}`);
    return out.join("\n");
  }

  const log = (events: GameEvent[]) => events.map((e) => `  · ${tr(e.text)}`).join("\n");

  return { board, decision, log };
}
