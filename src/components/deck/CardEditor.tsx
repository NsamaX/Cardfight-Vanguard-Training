import { useState, type ChangeEvent } from "react";
import type { Card, CardType } from "../../engine/types";
import type { MsgKey } from "../../i18n/msg";
import { useT } from "../../i18n/react";
import { KINDS, codeTemplates, emptyDraft, fill, numbersOf, templateOf, toAbility, toDraft, type Draft, type KindPick, type ListField } from "../../lib/abilityDraft";
import { shrinkImage } from "../../lib/image";

// Create/edit a card: the left side has the image, card data, and the card's real text (one field); the right side has the ability boxes
// Boxes pick codes from a dropdown (codes used by library cards); numbers in a code become input fields

const IMG_W = 408, IMG_H = 595;   // half the size of the library card images
const TYPES: CardType[] = ["normal", "trigger", "g-unit", "g-guardian"];
const TRIGGERS = ["critical", "heal", "stand", "draw"] as const;
const SKILLS = ["boost", "intercept", "twin-drive", "triple-drive"] as const;
const ZONES = ["VC", "RC", "GC", "VC/RC", "hand", "G zone"];
// Code dropdown + number fields for each # in the chosen code
function CodePick({ value, options, onChange, onRemove }: { value: string; options: string[]; onChange: (v: string) => void; onRemove?: () => void }) {
  const tpl = templateOf(value);
  const nums = numbersOf(value);
  const opts = value && !options.includes(tpl) ? [tpl, ...options] : options;
  return (
    <div className="code-pick">
      <select className="mono" value={tpl} onChange={(e) => onChange(e.target.value ? fill(e.target.value, nums) : "")}>
        <option value="">-</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {nums.map((n, i) => (
        <input key={i} className="mono num" type="number" min={0} value={n}
          onChange={(e) => onChange(fill(tpl, nums.map((x, j) => (j === i ? e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "") || "0" : x))))} />
      ))}
      {onRemove && <button className="btn" onClick={onRemove}>×</button>}
    </div>
  );
}


export function CardEditor({ initial, onSave, onCancel }: { initial: Card; onSave: (c: Card) => Promise<MsgKey | null>; onCancel: () => void }) {
  const [card, setCard] = useState(initial);
  const [powerText, setPowerText] = useState(initial.power != null ? `${initial.power}${initial.powerPlus ? "+" : ""}` : "");
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.abilities.map(toDraft));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const t = useT();
  const [codes] = useState(() => ({
    timing: codeTemplates((a) => (a.timing ? [a.timing] : undefined)),
    cond: codeTemplates((a) => a.cond),
    cost: codeTemplates((a) => a.cost),
    effect: codeTemplates((a) => a.effect),
  }));

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
    const power = powerText.trim();
    const out: Card = {
      ...card,
      name: card.name.trim(),
      grade: isG ? 4 : card.grade,
      power: power ? parseInt(power, 10) : undefined,
      powerPlus: power.endsWith("+") || undefined,
      trigger: card.type === "trigger" ? card.trigger ?? "critical" : undefined,
      triggerPower: card.type === "trigger" ? card.triggerPower : undefined,
      text: card.text.trim(),
      abilities: drafts.map(toAbility),
    };
    setSaving(true);
    const err = await onSave(out);
    setSaving(false);
    if (err) setError(t(err));
  }

  return (
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
          <label className="fld"><span>{t("cardEd.clan")}</span><input value={card.clan} onChange={(e) => set("clan", e.target.value)} /></label>
          <label className="fld wide"><span>{t("cardEd.text")}</span>
            <textarea rows={10} value={card.text} placeholder={t("cardEd.textHint")} onChange={(e) => set("text", e.target.value)} />
          </label>
          <span className="mute mono code">{card.key}</span>
        </div>

        <div className="card-ed-skills">
          {drafts.map((d, i) => (
            <div key={i} className="skill-ed">
              <div className="skill-ed-head">
                <select value={d.kind} onChange={(e) => editDraft(i, { kind: e.target.value as KindPick })}>
                  {KINDS.map((k) => <option key={k} value={k}>{k === "AUTO" ? `AUTO · ${t("skill.forced")}` : k === "AUTO+" ? `AUTO · ${t("skill.optional")}` : k}</option>)}
                </select>
                <select value={d.zone ?? ""} title={t("cardEd.zone")} onChange={(e) => editDraft(i, { zone: e.target.value || undefined })}>
                  <option value="">{t("cardEd.anyZone")}</option>
                  {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
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
        </div>

        <div className="card-ed-foot">
          {error && <span className="err">{error}</span>}
          <button className="btn" onClick={onCancel}>{t("deck.cancel")}</button>
          <button className="btn primary" disabled={saving} onClick={save}>{t("cardEd.save")}</button>
        </div>
      </div>
    </div>
  );
}
