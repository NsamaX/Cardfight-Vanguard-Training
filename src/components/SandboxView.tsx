import { useEffect, useRef, useState } from "react";
import { cardByKey as db, setCards } from "../data/cards";
import type { LibraryHandle } from "../hooks/useLibrary";
import { useT } from "../i18n/react";
import type { GameSettings } from "../lib/settings";
import { replayTimeline, type Timeline } from "../replay/play";
import type { Replay } from "../replay/types";
import { ReplayViewer } from "./ReplayViewer";

const POLL_MS = 1000;

// Watch Claude play the sandbox (scripts/sandbox.ts) live: polls the replay it writes and shows each new step as it arrives.
// The rules come from the replay's cards (the bundled set the script played with); the images from the library.
export function SandboxView({ settings, library, onClose }: { settings: GameSettings; library: LibraryHandle; onClose: () => void }) {
  const t = useT();
  const [live, setLive] = useState<{ r: Replay; tl: Timeline } | null>(null);
  const seen = useRef("");

  useEffect(() => {
    let stop = false;
    const images = new Map(library.cards.map((c) => [c.key, c.image]));
    async function poll() {
      const res = await fetch("/api/sandbox", { cache: "no-store" }).catch(() => undefined);
      const text = res?.status === 200 ? await res.text() : "";
      if (stop || !text || text === seen.current) return;
      seen.current = text;
      const r = JSON.parse(text) as Replay;
      setCards((r.cards ?? library.cards).map((c) => ({ ...c, image: c.image ?? images.get(c.key) })));
      setLive({ r, tl: replayTimeline(db, r) });
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [library]);

  if (!live) return <div className="veil"><div className="dialog"><span>{t("sandbox.waiting")}</span></div></div>;
  return <ReplayViewer key={live.r.id} tl={live.tl} decks={live.r.decks} settings={settings} library={library} follow onClose={onClose} />;
}
