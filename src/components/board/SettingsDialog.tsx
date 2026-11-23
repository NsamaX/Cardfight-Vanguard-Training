import { useState } from "react";
import type { PlayerId } from "../../engine/types";
import { LOCALES, type Locale } from "../../i18n";
import { useI18n } from "../../i18n/react";

export const randomSeed = () => Math.floor(Math.random() * 1e9);

// ค่าที่ตั้งไว้สำหรับเกมถัดไป: "random" = สุ่มใหม่ทุกเกม
export interface GameSettings {
  seed: number | "random";
  firstPlayer: PlayerId | "random";
}

export function resolveSettings(s: GameSettings): { seed: number; firstPlayer: PlayerId } {
  return {
    seed: s.seed === "random" ? randomSeed() : s.seed,
    firstPlayer: s.firstPlayer === "random" ? (Math.random() < 0.5 ? "me" : "bot") : s.firstPlayer,
  };
}

function DiceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {[[5, 5], [11, 5], [8, 8], [5, 11], [11, 11]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.2" fill="currentColor" />)}
    </svg>
  );
}

// ปุ่มลูกเต๋าเปิด/ปิดการสุ่มทุกเกม
const DiceToggle = ({ on, onToggle, title }: { on: boolean; onToggle: () => void; title: string }) => (
  <button type="button" className={`btn icon-btn ${on ? "on" : ""}`} aria-pressed={on} onClick={onToggle} title={title} aria-label={title}><DiceIcon /></button>
);

// ตั้งค่าเกม: ใครเล่นก่อน และ seed กดปุ่มแล้วเริ่มเกมใหม่ด้วยค่านี้ ปิดด้วย X หรือคลิกด้านนอก
// ภาษาเปลี่ยนทันทีที่เลือก ไม่ต้องเริ่มเกมใหม่
export function SettingsDialog({ settings, current, onApply, onClose }: {
  settings: GameSettings;
  current: { seed: number; firstPlayer: PlayerId };   // ค่าของเกมนี้ ใช้เป็นค่าเริ่มต้นเมื่อปิดการสุ่ม
  onApply: (s: GameSettings) => void;
  onClose: () => void;
}) {
  const [first, setFirst] = useState(settings.firstPlayer === "random" ? current.firstPlayer : settings.firstPlayer);
  const [firstRandom, setFirstRandom] = useState(settings.firstPlayer === "random");
  const [seed, setSeed] = useState(settings.seed === "random" ? current.seed : settings.seed);
  const [seedRandom, setSeedRandom] = useState(settings.seed === "random");
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="veil" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onApply({ seed: seedRandom ? "random" : seed, firstPlayer: firstRandom ? "random" : first }); }}>
        <div className="dialog-head"><span>{t("settings.title")}</span><button type="button" className="btn" onClick={onClose}>×</button></div>
        <label>{t("settings.language")}
          <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            {Object.entries(LOCALES).map(([l, label]) => <option key={l} value={l}>{label}</option>)}
          </select>
        </label>
        <label>{t("settings.first")}
          <span className="field-row">
            <select value={firstRandom ? "" : first} disabled={firstRandom} onChange={(e) => setFirst(e.target.value as PlayerId)}>
              <option value="" hidden />
              <option value="me">{t("player.me")}</option><option value="bot">{t("player.bot")}</option>
            </select>
            <DiceToggle on={firstRandom} onToggle={() => setFirstRandom(!firstRandom)} title={t("settings.firstRandom")} />
          </span>
        </label>
        <label>{t("settings.seed")}
          <span className="field-row">
            <input type="number" value={seedRandom ? "" : seed} disabled={seedRandom} onChange={(e) => setSeed(Number(e.target.value))} />
            <DiceToggle on={seedRandom} onToggle={() => setSeedRandom(!seedRandom)} title={t("settings.seedRandom")} />
          </span>
        </label>
        <button className="btn primary" type="submit">{t("btn.reset")}</button>
      </form>
    </div>
  );
}
