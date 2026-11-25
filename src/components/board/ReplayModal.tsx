import { useRef, useState } from "react";
import { useT } from "../../i18n/react";
import { download, parseReplayFile } from "../../replay/play";
import { deleteReplay, loadReplays, saveReplay } from "../../replay/store";
import type { Replay, ReplaySource } from "../../replay/types";

const fileName = (r: Replay) => `vanguard-${r.createdAt.slice(0, 10)}-turn${r.turn}.json`;

// รายการ replay ที่บันทึกไว้ + บันทึก/ดาวน์โหลดเกมนี้ + เปิดไฟล์ replay
export function ReplayModal({ current, onOpen, onClose }: { current?: () => Replay; onOpen: (src: ReplaySource) => void; onClose: () => void }) {
  const t = useT();
  const [list, setList] = useState(loadReplays);
  const [bad, setBad] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function openFile(f: File) {
    const src = parseReplayFile(await f.text());
    if (src) onOpen(src); else setBad(true);
  }

  const result = (r: Replay) => t(r.winner ? (r.winner === "me" ? "replay.win" : "replay.lose") : "replay.ongoing");
  return (
    <div className="veil" onClick={onClose}>
      <div className="dialog replays" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head"><span>{t("replay.title")}</span><button type="button" className="btn" onClick={onClose}>×</button></div>
        <div className="field-row">
          <button className="btn" disabled={!current} onClick={() => { saveReplay(current!()); setList(loadReplays()); }}>{t("replay.saveCurrent")}</button>
          <button className="btn" disabled={!current} onClick={() => { const r = current!(); download(fileName(r), r); }}>{t("replay.downloadCurrent")}</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>{t("replay.openFile")}</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); }} />
        </div>
        {bad && <span className="mute">{t("replay.badFile")}</span>}
        <div className="replay-list">
          {list.length === 0 && <span className="mute">{t("replay.empty")}</span>}
          {list.map((r) => (
            <div key={r.id} className="replay-row">
              <span className="replay-info">
                <b>{result(r)} · {t("replay.turn", { n: r.turn })}</b>
                <span className="mute">{new Date(r.createdAt).toLocaleString()}{r.bot && r.bot !== "off" && ` · ${t(`bot.${r.bot}`)}`}</span>
              </span>
              <button className="btn" onClick={() => onOpen(r)}>{t("replay.view")}</button>
              <button className="btn" onClick={() => download(fileName(r), r)} title={t("replay.download")} aria-label={t("replay.download")}>↓</button>
              <button className="btn" onClick={() => { deleteReplay(r.id); setList(loadReplays()); }} title={t("replay.delete")} aria-label={t("replay.delete")}>×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
