// The game's buttons folded into one round button next to the deck: hover or click opens a column of icons below it,
// and hovering an icon slides out its name beside it
import { useEffect, useRef, useState } from "react";
import { ICONS } from "./Icons";

export interface MenuItem { icon: keyof typeof ICONS; label: string; onClick: () => void; alert?: boolean }

export function GameMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // A click elsewhere closes it (opened by a click on a touch screen, where there is no hover to leave)
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);

  const alert = items.some((i) => i.alert);
  return (
    <div ref={box} className={`game-menu ${open ? "open" : ""}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className={`menu-orb ${alert ? "alert" : ""}`} aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="orb-ring" />
      </button>
      <div className="menu-items" role="menu">
        {items.map((it, i) => (
          <button key={it.icon + i} role="menuitem" className={`menu-item ${it.alert ? "alert" : ""}`} style={{ transitionDelay: open ? `${i * 30}ms` : "0ms" }}
            aria-label={it.label} tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); it.onClick(); }}>
            {ICONS[it.icon]}
            <span className="menu-label">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
