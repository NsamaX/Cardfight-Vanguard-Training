import { createContext, useContext, useState, type ChangeEvent } from "react";
import type { Card, CardType } from "../../engine/types";
import { clanNames } from "../../data/cards";
import type { MsgKey } from "../../i18n/msg";
import { useT } from "../../i18n/react";
import {
  DEFAULT_ABILITY, DEFAULT_FILTER, KINDS, SLOT, codePath, codeTemplates, emptyDraft, fill, filterTemplates, filterTerms, fromGrantDraft, joinFilter, joinParts,
  nextSteps, splitParts, templateFor, templateOf, toAbility, toDraft, toGrantDraft, valuesOf, type Draft, type GrantDraft, type KindPick, type ListField, type Parts,
} from "../../lib/abilityDraft";
import { validateCard } from "../../engine/vocab";
import { fromPlainText, toPlainText } from "../../lib/cardText";
import { shrinkImage } from "../../lib/image";

// Create/edit a card: the left side has the image, card data, and the card's real text (one field); the right side has the ability boxes
// Boxes pick codes from a dropdown (every code the engine knows, plus codes library cards use); numbers and quoted texts become input fields

const IMG_W = 408, IMG_H = 595;   // half the size of the library card images
const TYPES: CardType[] = ["normal", "trigger", "g-unit", "g-guardian"];
const TRIGGERS = ["critical", "heal", "stand", "draw"] as const;
const SKILLS = ["boost", "intercept", "twin-drive", "triple-drive"] as const;
const ZONES = ["VC", "RC", "GC", "VC/RC", "hand", "G zone"];
type Codes = Record<ListField | "timing" | "filter", string[]>;
// The templates each field offers, shared with the nested editors (a granted ability has its own timing, cost, and effect lists)
const CodesContext = createContext<Codes>({ timing: [], cond: [], cost: [], effect: [], filter: [] });

// Code picked step by step (name, then each argument, e.g. enter → RC → self → from=drop) + a field for each # (number) and "$" (text) in the code
// Picking a step jumps to the first code that fits it, so the value is always a whole code; "·" = the code stops there
// A filter=… argument and a granted ability get their own editors (FilterPick, GrantPick) in place of the step
function CodePick({ value, options, onChange, onRemove }: { value: string; options: string[]; onChange: (v: string) => void; onRemove?: () => void }) {
  const { code: base, parts } = splitParts(value);
  const tpl = templateOf(base);
  const values = valuesOf(base);
  const nums = values.map((x) => x.v);
  const emit = (code: string, p: Parts = parts) => onChange(code ? joinParts(code, p) : "");
  const opts = base && !options.includes(tpl) ? [tpl, ...options] : options;
  const path = base ? codePath(tpl) : [];
  const pick = (i: number, step: string) => {
    if (i === 0 && !step) return onChange("");
    const next = templateFor(opts, step ? [...path.slice(0, i), step] : path.slice(0, i));
    if (next) emit(fill(next, nums));
  };
  const steps: { value: string; options: string[]; ends: boolean }[] = [];
  for (let i = 0; i <= path.length; i++) {
    const s = nextSteps(opts, path.slice(0, i));
    if (i > 0 && !s.options.length) break;
    steps.push({ value: path[i] ?? "", ...s, ends: i === 0 || s.ends });
  }
  const setValue = (i: number, v: string) => emit(fill(tpl, nums.map((y, j) => (j === i ? v : y))));
  return (
    <div className="code-pick">
      <div className="code-steps mono">
        {steps.map((s, i) => (
          <span key={i} className="code-step">
            {i === 1 && <span className="punct">(</span>}
            {i > 1 && <span className="punct">,</span>}
            <select value={s.value} onChange={(e) => pick(i, e.target.value)}>
              {s.ends && <option value="">{i === 0 ? "-" : "·"}</option>}
              {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {s.value === SLOT.filter && <FilterPick value={parts.filter || DEFAULT_FILTER} onChange={(f) => emit(fill(tpl, nums), { ...parts, filter: f })} />}
            {s.value === SLOT.ability && <GrantPick value={parts.ability || DEFAULT_ABILITY} onChange={(g) => emit(fill(tpl, nums), { ...parts, ability: g })} />}
          </span>
        ))}
        {path.length > 1 && <span className="punct">)</span>}
      </div>
      {values.map((x, i) => x.text
        ? <input key={i} className="mono" value={x.v} onChange={(e) => setValue(i, e.target.value.replace(/"/g, ""))} />
        : <input key={i} className="mono num" type="number" min={0} value={x.v}
          onChange={(e) => setValue(i, e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "") || "0")} />)}
      {onRemove && <button className="btn" onClick={onRemove}>×</button>}
    </div>
  );
}

// filter=a & b & …: one picker per term, joined with &
function FilterPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const codes = useContext(CodesContext);
  const terms = filterTerms(value);
  const set = (k: number, v: string | null) => onChange(joinFilter(v === null ? terms.filter((_, j) => j !== k) : terms.map((x, j) => (j === k ? v : x))) || DEFAULT_FILTER);
  return (
    <span className="nested-pick">
      {terms.map((term, k) => (
        <span key={k} className="nested-row">
          {k > 0 && <span className="punct">&amp;</span>}
          <CodePick value={term} options={codes.filter} onChange={(v) => set(k, v)} onRemove={terms.length > 1 ? () => set(k, null) : undefined} />
        </span>
      ))}
      <button className="btn add-code" title="&" onClick={() => onChange(joinFilter([...terms, DEFAULT_FILTER]))}>&amp;</button>
    </span>
  );
}

const GRANT_ZONES = ["", "VC", "RC", "VC/RC", "GC"];

// A granted ability: AUTO (timing → effects) or ACT (costs → effects), with the zone it works from
function GrantPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const codes = useContext(CodesContext);
  const t = useT();
  const g = toGrantDraft(value);
  const set = (d: Partial<GrantDraft>) => onChange(fromGrantDraft({ ...g, ...d }));
  const list = (f: "cost" | "effect") => (
    <div className="skill-ed-row">
      <span className="k">{t(`skill.${f}`)}</span>
      <div className="code-list">
        {g[f].map((v, k) => (
          <CodePick key={k} value={v} options={codes[f]} onChange={(x) => set({ [f]: g[f].map((y, j) => (j === k ? x : y)) })}
            onRemove={() => set({ [f]: g[f].filter((_, j) => j !== k) })} />
        ))}
        <button className="btn add-code" onClick={() => set({ [f]: [...g[f], ""] })}>+</button>
      </div>
    </div>
  );
  return (
    <div className="nested-pick grant-pick">
      <div className="skill-ed-head">
        <select value={g.kind} onChange={(e) => set({ kind: e.target.value as GrantDraft["kind"] })}>
          <option value="AUTO">AUTO</option>
          <option value="ACT">ACT</option>
        </select>
        <select value={g.zone ?? ""} title={t("cardEd.zone")} onChange={(e) => set({ zone: e.target.value || undefined })}>
          {GRANT_ZONES.map((z) => <option key={z} value={z}>{z || t("cardEd.anyZone")}</option>)}
        </select>
      </div>
      {g.kind === "AUTO"
        ? <div className="skill-ed-row"><span className="k">{t("skill.timing")}</span><div className="code-list"><CodePick value={g.timing} options={codes.timing} onChange={(v) => set({ timing: v })} /></div></div>
        : list("cost")}
      {list("effect")}
    </div>
  );
}

function buildCard(card: Card, powerText: string, text: string, drafts: Draft[]): Card {
  const power = powerText.trim();
  return {
    ...card,
    name: card.name.trim(),
    grade: card.type.startsWith("g-") ? 4 : card.grade,
    power: power ? parseInt(power, 10) : undefined,
    powerPlus: power.endsWith("+") || undefined,
    trigger: card.type === "trigger" ? card.trigger ?? "critical" : undefined,
    triggerPower: card.type === "trigger" ? card.triggerPower : undefined,
    text: fromPlainText(text.trim()),
    abilities: drafts.map(toAbility),
  };
}

export function CardEditor({ initial, onSave, onCancel, onDelete, usedIn = [] }: {
  initial: Card; onSave: (c: Card) => Promise<MsgKey | null>; onCancel: () => void;
  onDelete?: () => Promise<MsgKey | null>;   // unset = a new card not saved yet
  usedIn?: string[];                         // names of the decks holding the card: it can't be deleted until they drop it
}) {
  const [card, setCard] = useState(initial);
  const [powerText, setPowerText] = useState(initial.power != null ? `${initial.power}${initial.powerPlus ? "+" : ""}` : "");
  const [text, setText] = useState(() => toPlainText(initial.text));   // edited as plain text, saved back in the markdown layout
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.abilities.map(toDraft));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [baseline] = useState(() => JSON.stringify(buildCard(card, powerText, text, drafts)));
  const dirty = JSON.stringify(buildCard(card, powerText, text, drafts)) !== baseline;
  const t = useT();
  const [codes] = useState<Codes>(() => ({ timing: codeTemplates("timing"), cond: codeTemplates("cond"), cost: codeTemplates("cost"), effect: codeTemplates("effect"), filter: filterTemplates() }));
  // Codes the engine wouldn't run as written (unknown codes, conditions, filters, targets): shown under the abilities
  const problems = validateCard({ ...card, abilities: drafts.map(toAbility).filter((a) => a.effect.length || a.timing || a.cost?.length) });

  const set = <K extends keyof Card>(k: K, v: Card[K]) => setCard({ ...card, [k]: v });
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const isG = card.type.startsWith("g-");
  const editDraft = (i: number, d: Partial<Draft>) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, ...d } : x)));
  const editItem = (i: number, f: ListField, k: number, v: string | null) =>
    editDraft(i, { [f]: v === null ? drafts[i][f].filter((_, j) => j !== k) : drafts[i][f].map((x, j) => (j === k ? v : x)) });

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      set("image", await shrinkImage(file, IMG_W, IMG_H));
    } catch {
      setError(t("cardEd.badImage"));
    }
  }

  async function save() {
    if (!card.name.trim()) return setError(t("cardEd.needName"));
    const out = buildCard(card, powerText, text, drafts);
    setSaving(true);
    const err = await onSave(out);
    setSaving(false);
    if (err) setError(t(err));
  }

  async function remove() {
    if (!onDelete) return;
    if (usedIn.length) return setError(t("cardEd.inDecks", { decks: usedIn.join(", ") }));
    if (!confirm(t("cardEd.confirmDelete", { name: initial.name }))) return;
    setSaving(true);
    const err = await onDelete();
    setSaving(false);
    if (err) setError(t(err));
  }

  return (
    <CodesContext.Provider value={codes}>
    <div className="veil card-ed-veil" onClick={onCancel}>
      <div className="card-ed" onClick={(e) => e.stopPropagation()}>
        <div className="card-ed-info">
          <label className="card-ed-img" title={t("cardEd.image")}>
            {card.image ? <img src={card.image} alt="" /> : <span className="mute">{t("cardEd.image")}</span>}
            <input type="file" accept="image/*" onChange={upload} />
          </label>
          <label className="fld wide"><span>{t("cardEd.name")}</span><input value={card.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label className="fld"><span>{t("cardEd.type")}</span>
            <select value={card.type} onChange={(e) => set("type", e.target.value as CardType)}>
              {TYPES.map((x) => <option key={x} value={x}>{t(`type.${x}`)}</option>)}
            </select>
          </label>
          {!isG && <label className="fld"><span>{t("insp.grade")}</span><input type="number" min={0} max={4} value={card.grade} onChange={(e) => set("grade", num(e.target.value) ?? 0)} /></label>}
          {card.type === "trigger" && <>
            <label className="fld"><span>{t("cardEd.trigger")}</span>
              <select value={card.trigger ?? "critical"} onChange={(e) => set("trigger", e.target.value as Card["trigger"])}>
                {TRIGGERS.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label className="fld"><span>{t("cardEd.triggerPower")}</span><input type="number" step={1000} value={card.triggerPower ?? ""} onChange={(e) => set("triggerPower", num(e.target.value))} /></label>
          </>}
          <label className="fld"><span>{t("insp.power")}</span><input value={powerText} placeholder={isG ? "15000+" : ""} onChange={(e) => setPowerText(e.target.value)} /></label>
          <label className="fld"><span>{t("insp.shield")}</span><input type="number" step={5000} value={card.shield ?? ""} onChange={(e) => set("shield", num(e.target.value))} /></label>
          <label className="fld"><span>{t("cardEd.critical")}</span><input type="number" min={0} value={card.critical ?? ""} onChange={(e) => set("critical", num(e.target.value))} /></label>
          <label className="fld"><span>{t("cardEd.skill")}</span>
            <select value={card.skill ?? ""} onChange={(e) => set("skill", (e.target.value || undefined) as Card["skill"])}>
              <option value="">-</option>
              {SKILLS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="fld"><span>{t("insp.race")}</span><input value={card.race} onChange={(e) => set("race", e.target.value)} /></label>
          <label className="fld"><span>{t("cardEd.clan")}</span><select value={card.clan} onChange={(e) => set("clan", e.target.value)}>
            <option value="">-</option>
            {clanNames().map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
          <label className="fld wide"><span>{t("cardEd.text")}</span>
            <textarea rows={10} value={text} placeholder={t("cardEd.textHint")} onChange={(e) => setText(e.target.value)} />
          </label>
          <span className="mute mono code">{card.key}</span>
        </div>

        <div className="card-ed-skills">
          {drafts.map((d, i) => (
            <div key={i} className={`skill-ed ${d.follows && i > 0 ? "follows" : ""}`}>
              <div className="skill-ed-head">
                <select value={d.kind} onChange={(e) => editDraft(i, { kind: e.target.value as KindPick })}>
                  {KINDS.map((k) => <option key={k} value={k}>{k === "AUTO" ? `AUTO · ${t("skill.forced")}` : k === "AUTO+" ? `AUTO · ${t("skill.optional")}` : k}</option>)}
                </select>
                <select value={d.zone ?? ""} title={t("cardEd.zone")} onChange={(e) => editDraft(i, { zone: e.target.value || undefined })}>
                  <option value="">{t("cardEd.anyZone")}</option>
                  {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
                {i > 0 && <button className={`btn ${d.follows ? "on" : ""}`} aria-pressed={!!d.follows} title={t("cardEd.followsHint")}
                  onClick={() => editDraft(i, { follows: !d.follows })}>{t("cardEd.follows")}</button>}
                <button className="btn" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>{t("cardEd.removeSkill")}</button>
              </div>
              {(["cond", "timing", "cost", "effect"] as const).map((f) => (
                <div key={f} className="skill-ed-row">
                  <span className="k">{t(`skill.${f}`)}</span>
                  <div className="code-list">
                    {f === "timing"
                      ? <CodePick value={d.timing} options={codes.timing} onChange={(v) => editDraft(i, { timing: v })} />
                      : <>
                          {d[f].map((v, k) => (
                            <CodePick key={k} value={v} options={codes[f]} onChange={(x) => editItem(i, f, k, x)} onRemove={() => editItem(i, f, k, null)} />
                          ))}
                          <button className="btn add-code" onClick={() => editDraft(i, { [f]: [...d[f], ""] })}>+</button>
                        </>}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <button className="btn add-skill" onClick={() => setDrafts([...drafts, emptyDraft()])}>{t("cardEd.addSkill")}</button>
          {problems.length > 0 && (
            <div className="code-problems">
              <span className="err">{t("cardEd.unknownCodes")}</span>
              <ul className="mono">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
        </div>

        <div className="card-ed-foot">
          {onDelete && <button className="btn" disabled={saving} onClick={remove}>{t("cardEd.delete")}</button>}
          <span className="err">{error}</span>
          <button className="btn" onClick={onCancel}>{t("deck.cancel")}</button>
          <button className="btn primary" disabled={saving || !dirty} onClick={save}>{t("cardEd.save")}</button>
        </div>
      </div>
    </div>
    </CodesContext.Provider>
  );
}
