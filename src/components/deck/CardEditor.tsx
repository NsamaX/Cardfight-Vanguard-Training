import { useState, type ChangeEvent } from "react";
import { cards } from "../../data/cards";
import type { Ability, AbilityKind, Card, CardType } from "../../engine/types";
import { useT } from "../../i18n/react";
import { USER_SOURCE } from "../../lib/cardStore";

// สร้าง/แก้การ์ด: ซ้ายคือรูป ข้อมูลการ์ด และข้อความจริงของการ์ด (ช่องเดียว) ขวาคือกล่องความสามารถทีละอัน
// กล่องเลือกรหัสจาก dropdown (รหัสที่การ์ดในคลังใช้) ตัวเลขในรหัสแยกเป็นช่องกรอก

const IMG_W = 408, IMG_H = 595;
const TYPES: CardType[] = ["normal", "trigger", "g-unit", "g-guardian"];
const TRIGGERS = ["critical", "heal", "stand", "draw"] as const;
const SKILLS = ["boost", "intercept", "twin-drive", "triple-drive"] as const;
const ZONES = ["VC", "RC", "GC", "VC/RC", "hand", "G zone"];
// "AUTO+" = AUTO แบบเลือกใช้ (เก็บเป็น optional: true)
const KINDS = ["AUTO", "AUTO+", "ACT", "CONT", "STRIDE", "ULTIMATE STRIDE", "G GUARDIAN"] as const;
type KindPick = (typeof KINDS)[number];

type ListField = "cond" | "cost" | "effect";
interface Draft { kind: KindPick; zone?: string; timing: string; cond: string[]; cost: string[]; effect: string[] }

// ตัวเลขที่เป็นค่าในรหัส (หลัง ( , + - ≤ ≥ = หรือเว้นวรรค) เช่น CB(1), power(+5000, …), grade-3 ส่วน 1/turn ไม่นับ
const NUM = /(?<=[(,+\-≤≥= ])\d+/g;
const templateOf = (code: string) => code.replace(NUM, "#");
const numbersOf = (code: string) => code.match(NUM) ?? [];
function fill(template: string, nums: string[]) {
  let i = 0;
  return template.replace(/#/g, () => nums[i++] || "1");
}

const templates = (pick: (a: Ability) => string[] | undefined) =>
  [...new Set(cards.filter((c) => c.source !== USER_SOURCE).flatMap((c) => c.abilities.flatMap((a) => pick(a) ?? [])).map(templateOf))].sort();

const toDraft = (a: Ability): Draft => ({
  kind: a.kind === "AUTO" && a.optional ? "AUTO+" : a.kind,
  zone: a.zone,
  timing: a.timing ?? "",
  cond: a.cond ?? [],
  cost: a.cost ?? [],
  effect: a.effect,
});

function toAbility(d: Draft): Ability {
  const kind: AbilityKind = d.kind === "AUTO+" ? "AUTO" : d.kind;
  const ability: Ability = { kind, effect: d.effect.filter(Boolean) };
  if (d.zone) ability.zone = d.zone;
  if (d.timing) ability.timing = d.timing;
  if (d.cond.some(Boolean)) ability.cond = d.cond.filter(Boolean);
  if (d.cost.some(Boolean)) ability.cost = d.cost.filter(Boolean);
  if (d.kind === "AUTO+") ability.optional = true;
  return ability;
}

const emptyDraft = (): Draft => ({ kind: "AUTO", timing: "", cond: [], cost: [], effect: [""] });

// dropdown รหัส + ช่องตัวเลขตามจำนวน # ในรหัสที่เลือก
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

export function emptyCard(): Card {
  const key = `USER-${Date.now().toString(36).toUpperCase()}`;
  return { key, ids: [key], name: "", format: ["G"], type: "normal", grade: 0, power: 5000, shield: 10000, critical: 1, race: "", clan: "", abilities: [], text: "", source: USER_SOURCE };
}

// ย่อรูปที่อัพโหลดให้เท่าครึ่งของรูปการ์ดในคลัง ตัดส่วนเกินจากกึ่งกลาง แล้วเก็บเป็น webp (localStorage มีที่จำกัด)
async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = IMG_W;
  canvas.height = IMG_H;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.max(IMG_W / img.width, IMG_H / img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, (IMG_W - w) / 2, (IMG_H - h) / 2, w, h);
  return canvas.toDataURL("image/webp", 0.85);
}

export function CardEditor({ initial, onSave, onCancel }: { initial: Card; onSave: (c: Card) => boolean; onCancel: () => void }) {
  const [card, setCard] = useState(initial);
  const [powerText, setPowerText] = useState(initial.power != null ? `${initial.power}${initial.powerPlus ? "+" : ""}` : "");
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.abilities.map(toDraft));
  const [error, setError] = useState("");
  const t = useT();
  const [codes] = useState(() => ({
    timing: templates((a) => (a.timing ? [a.timing] : undefined)),
    cond: templates((a) => a.cond),
    cost: templates((a) => a.cost),
    effect: templates((a) => a.effect),
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
      set("image", await shrink(file));
    } catch {
      setError(t("cardEd.badImage"));
    }
  }

  function save() {
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
    if (!onSave(out)) setError(t("cardEd.storageFull"));
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
          <button className="btn primary" onClick={save}>{t("cardEd.save")}</button>
        </div>
      </div>
    </div>
  );
}
