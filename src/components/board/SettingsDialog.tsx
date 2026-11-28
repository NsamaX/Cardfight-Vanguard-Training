import { useState } from "react";
import { BOT_LEVELS, SELECTABLE_BOT_LEVELS, type BotLevel } from "../../bot";
import type { PlayerId } from "../../engine/types";
import { useAuth } from "../../hooks/useAuth";
import { LOCALES, type Locale } from "../../i18n";
import { useI18n } from "../../i18n/react";
import { DEFAULT_BOT, type GameSettings, type ViewSettings } from "../../lib/settings";

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
// The language and the board view change as soon as they're chosen, no new game needed
// viewOnly (online match, replay): only the language and the board view
export function SettingsDialog({ settings, current, onApply, onClose, view, onView, viewOnly }: {
  settings: GameSettings;
  current: { seed: number; firstPlayer: PlayerId };   // this game's values, used as defaults when randomization is turned off
  onApply: (s: GameSettings) => void;
  onClose: () => void;
  view: ViewSettings;
  onView: (v: ViewSettings) => void;
  viewOnly?: boolean;
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
      <form className="dialog settings" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (changed) onApply(next); }}>
        <div className="dialog-head"><span>{t("settings.title")}</span><button type="button" className="btn" onClick={onClose}>×</button></div>
        {auth.available && !viewOnly && (
          <div className="set-row">
            <span className="set-user" title={auth.user ? userName : undefined}>{auth.user ? userName : t("account.signedOut")}</span>
            {auth.user
              ? <button type="button" className="btn" onClick={() => auth.signOut()}>{t("account.signOut")}</button>
              : <button type="button" className="btn" onClick={() => auth.signIn()}>{t("account.signIn")}</button>}
          </div>
        )}
        <section className="set-group">
          <h3>{t("settings.view")}</h3>
          <label className="set-row"><span>{t("settings.language")}</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              {Object.entries(LOCALES).map(([l, label]) => <option key={l} value={l}>{label}</option>)}
            </select>
          </label>
          <label className="set-row"><span>{t("settings.layout")}</span>
            <select value={view.layout} onChange={(e) => onView({ ...view, layout: e.target.value as ViewSettings["layout"] })}>
              <option value="vertical">{t("settings.vertical")}</option>
              <option value="horizontal">{t("settings.horizontal")}</option>
            </select>
          </label>
          <label className="set-row" title={t("settings.boardOnlyHint")}><span>{t("settings.boardOnly")}</span>
            <input type="checkbox" checked={view.boardOnly} onChange={(e) => onView({ ...view, boardOnly: e.target.checked })} />
          </label>
        </section>
        {!viewOnly && <>
          <section className="set-group">
            <h3>{t("settings.game")}</h3>
            <label className="set-row"><span>{t("settings.bot")}</span>
              <select value={bot} onChange={(e) => setBot(e.target.value as BotLevel)}>
                {BOT_LEVELS.map((l) => {
                  const locked = !SELECTABLE_BOT_LEVELS.includes(l);
                  return <option key={l} value={l} disabled={locked} className={locked ? "locked" : undefined}>{t(`bot.${l}`)}</option>;
                })}
              </select>
            </label>
            <label className="set-row"><span>{t("settings.first")}</span>
              <span className="field-row">
                <select value={firstRandom ? "" : first} disabled={firstRandom} onChange={(e) => setFirst(e.target.value as PlayerId)}>
                  <option value="" hidden />
                  <option value="me">{t("player.me")}</option><option value="bot">{t("player.bot")}</option>
                </select>
                <DiceToggle on={firstRandom} onToggle={() => setFirstRandom(!firstRandom)} title={t("settings.firstRandom")} />
              </span>
            </label>
            <label className="set-row" title={t("settings.seedHint")}><span>{t("settings.seed")}</span>
              <span className="field-row">
                <input type="number" value={seedRandom ? "" : seed} disabled={seedRandom} onChange={(e) => setSeed(Number(e.target.value))} />
                <DiceToggle on={seedRandom} onToggle={() => setSeedRandom(!seedRandom)} title={t("settings.seedRandom")} />
              </span>
            </label>
          </section>
          <button className="btn primary" type="submit" disabled={!changed}>{t("btn.apply")}</button>
        </>}
      </form>
    </div>
  );
}
