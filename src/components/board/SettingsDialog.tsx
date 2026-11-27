import { useState } from "react";
import { BOT_LEVELS, SELECTABLE_BOT_LEVELS, type BotLevel } from "../../bot";
import type { PlayerId } from "../../engine/types";
import { useAuth } from "../../hooks/useAuth";
import { LOCALES, type Locale } from "../../i18n";
import { useI18n } from "../../i18n/react";
import { DEFAULT_BOT, type GameSettings } from "../../lib/settings";

function DiceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {[[5, 5], [11, 5], [8, 8], [5, 11], [11, 11]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.2" fill="currentColor" />)}
    </svg>
  );
}

// Dice button toggling randomization every game
const DiceToggle = ({ on, onToggle, title }: { on: boolean; onToggle: () => void; title: string }) => (
  <button type="button" className={`btn icon-btn ${on ? "on" : ""}`} aria-pressed={on} onClick={onToggle} title={title} aria-label={title}><DiceIcon /></button>
);

// Game settings: bot, who goes first and the seed; Apply is enabled only when one of them changed; close with X or by clicking outside
// Apply: the bot level takes effect at once; who goes first and the seed take effect next game (at once if the game hasn't started)
// The language changes as soon as it's chosen, no new game needed
export function SettingsDialog({ settings, current, onApply, onClose }: {
  settings: GameSettings;
  current: { seed: number; firstPlayer: PlayerId };   // this game's values, used as defaults when randomization is turned off
  onApply: (s: GameSettings) => void;
  onClose: () => void;
}) {
  const [first, setFirst] = useState(settings.firstPlayer === "random" ? current.firstPlayer : settings.firstPlayer);
  const [firstRandom, setFirstRandom] = useState(settings.firstPlayer === "random");
  const [seed, setSeed] = useState(settings.seed === "random" ? current.seed : settings.seed);
  const [seedRandom, setSeedRandom] = useState(settings.seed === "random");
  const [bot, setBot] = useState<BotLevel>(settings.bot && SELECTABLE_BOT_LEVELS.includes(settings.bot) ? settings.bot : DEFAULT_BOT);
  const { locale, setLocale, t } = useI18n();
  const auth = useAuth();
  const userName = auth.user?.user_metadata.full_name ?? auth.user?.email;
  const next: GameSettings = { seed: seedRandom ? "random" : seed, firstPlayer: firstRandom ? "random" : first, bot };
  const changed = next.seed !== settings.seed || next.firstPlayer !== settings.firstPlayer || bot !== (settings.bot ?? DEFAULT_BOT);

  return (
    <div className="veil" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (changed) onApply(next); }}>
        <div className="dialog-head"><span>{t("settings.title")}</span><button type="button" className="btn" onClick={onClose}>×</button></div>
        {auth.available && (
          <label>{t("settings.account")}
            <span className="field-row">
              <input readOnly value={auth.user ? userName : t("account.signedOut")} />
              {auth.user
                ? <button type="button" className="btn" onClick={() => auth.signOut()}>{t("account.signOut")}</button>
                : <button type="button" className="btn" onClick={() => auth.signIn()}>{t("account.signIn")}</button>}
            </span>
          </label>
        )}
        <label>{t("settings.language")}
          <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            {Object.entries(LOCALES).map(([l, label]) => <option key={l} value={l}>{label}</option>)}
          </select>
        </label>
        <label>{t("settings.bot")}
          <select value={bot} onChange={(e) => setBot(e.target.value as BotLevel)}>
            {BOT_LEVELS.map((l) => {
              const locked = !SELECTABLE_BOT_LEVELS.includes(l);
              return <option key={l} value={l} disabled={locked} className={locked ? "locked" : undefined}>{t(`bot.${l}`)}</option>;
            })}
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
        <button className="btn primary" type="submit" disabled={!changed}>{t("btn.apply")}</button>
      </form>
    </div>
  );
}
