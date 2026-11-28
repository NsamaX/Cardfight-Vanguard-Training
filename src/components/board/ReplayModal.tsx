import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/react";
import { deleteCloudReplay, loadCloudReplays, saveCloudReplay } from "../../lib/library";
import { download, parseReplayFile } from "../../replay/play";
import { deleteReplay, loadReplays, saveReplay } from "../../replay/store";
import type { Replay, ReplaySource } from "../../replay/types";

const fileName = (r: Replay) => `vanguard-${r.createdAt.slice(0, 10)}-turn${r.turn}.json`;

// Signed in: replays in Supabase. Guest: replays in this browser's localStorage
const cloud = { load: loadCloudReplays, save: saveCloudReplay, remove: deleteCloudReplay };
const local = { load: async () => loadReplays(), save: async (r: Replay) => saveReplay(r), remove: async (id: string) => deleteReplay(id) };

// List of saved replays + save/download this game + open a replay file. saveOnly (online match): only save/download this game
export function ReplayModal({ signedIn = false, current, saveOnly = false, onOpen, onClose }: { signedIn?: boolean; current?: () => Replay; saveOnly?: boolean; onOpen: (src: ReplaySource) => void; onClose: () => void }) {
  const t = useT();
  const store = signedIn ? cloud : local;
  const [list, setList] = useState<Replay[]>(() => (signedIn ? [] : loadReplays()));
  const [failed, setFailed] = useState(false);
  const refresh = () => store.load().then(setList, () => setFailed(true));
  const run = (op: Promise<void>) => op.then(refresh, () => setFailed(true));
  useEffect(() => { if (signedIn && !saveOnly) void refresh(); }, []);
  const [saved, setSaved] = useState(false);
  const [bad, setBad] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function openFile(f: File) {
    const src = parseReplayFile(await f.text());
    if (src) onOpen(src); else setBad(true);
  }

  const result = (r: Replay) => t(r.winner ? (r.winner === (r.seat ?? "me") ? "replay.win" : "replay.lose") : "replay.ongoing");
  return (
    <div className="veil" onClick={onClose}>
      <div className="dialog replays" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head"><span>{t("replay.title")}</span><button type="button" className="btn" onClick={onClose}>×</button></div>
        <div className="replay-actions">
          {current && <>
            <button className="btn" onClick={() => saveOnly ? store.save(current()).then(() => setSaved(true), () => setFailed(true)) : run(store.save(current()))}>{t("replay.saveCurrent")}</button>
            <button className="btn" onClick={() => { const r = current(); download(fileName(r), r); }}>{t("replay.downloadCurrent")}</button>
          </>}
          {!saveOnly && <>
            <button className="btn" onClick={() => fileRef.current?.click()}>{t("replay.openFile")}</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); }} />
          </>}
        </div>
        {saved && <span className="mute">{t("replay.saved")}</span>}
        {bad && <span className="mute">{t("replay.badFile")}</span>}
        {failed && <span className="bad">{t("library.offline")}</span>}
        {!saveOnly && <div className="replay-list">
          {list.length === 0 && <span className="mute replay-empty">{t("replay.empty")}</span>}
          {list.map((r) => (
            <div key={r.id} className="replay-row">
              <button type="button" className="replay-info" onClick={() => onOpen(r)} title={t("replay.view")}>
                <b>{result(r)} · {t("replay.turn", { n: r.turn })}</b>
                <span className="mute">{new Date(r.createdAt).toLocaleString()}{r.bot && r.bot !== "off" && ` · ${t(`bot.${r.bot}`)}`}</span>
              </button>
              <button className="btn ghost" onClick={() => download(fileName(r), r)} title={t("replay.download")} aria-label={t("replay.download")}>↓</button>
              <button className="btn ghost" onClick={() => run(store.remove(r.id))} title={t("replay.delete")} aria-label={t("replay.delete")}>×</button>
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}
