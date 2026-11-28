// The game's buttons folded into one round button: hover or click opens a column of icons, and hovering an icon slides out its name.
// Only the round button itself opens it on hover, so a pointer passing over the folded column doesn't open it.
// It sits right of our deck on the battle bar and stays on screen over the deck editor.
// Dragging it anywhere on the board (the spot remembered) is built but switched off with DRAGGABLE
import { useEffect, useRef, useState, type RefObject } from "react";
import { ICONS } from "./Icons";

export interface MenuItem { icon: keyof typeof ICONS; label: string; onClick: () => void; alert?: boolean }

const ORB = 34, ITEM_GAP = 8, DRAG_PX = 4;
const DRAGGABLE = false;
const STORE = "game-menu-pos";   // where the player dragged it, as fractions of the board's size

type Pos = { x: number; y: number };

const readSaved = (): Pos | undefined => {
  try { const v = JSON.parse(localStorage.getItem(STORE) ?? "null"); return typeof v?.x === "number" && typeof v?.y === "number" ? v : undefined; } catch { return undefined; }
};
const save = (p: Pos | undefined) => {
  try { if (p) localStorage.setItem(STORE, JSON.stringify(p)); else localStorage.removeItem(STORE); } catch { /* private window: not remembered */ }
};

// board: the element the menu is placed in; home: where it sits by default (right of our deck slot, on the battle bar), in board pixels;
// layout: the board's arrangement, measured again when it changes even if the board's size doesn't
export function GameMenu({ items, label, board, home, layout }: { items: MenuItem[]; label: string; board: RefObject<HTMLElement | null>; home: () => Pos | undefined; layout?: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Pos | undefined>(() => (DRAGGABLE ? readSaved() : undefined));
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [homePos, setHomePos] = useState<Pos>();
  const [drag, setDrag] = useState<Pos>();   // while dragging, in board pixels
  const box = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; from: Pos; moved: boolean }>(undefined);
  const dragged = useRef(false);   // the click that ends a drag doesn't open the menu

  // The board's size and our deck's place change with the window (a passive effect: the board's ref is set after this child's layout effects)
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const measure = () => { setSize({ w: el.clientWidth, h: el.clientHeight }); setHomePos(home()); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [board, layout]);

  // A click elsewhere closes it (opened by a click on a touch screen, where there is no hover to leave)
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);

  const clamp = (p: Pos): Pos => ({ x: Math.min(Math.max(p.x, 4), Math.max(4, size.w - ORB - 4)), y: Math.min(Math.max(p.y, 4), Math.max(4, size.h - ORB - 4)) });
  const at = drag ?? (saved && size.w ? clamp({ x: saved.x * size.w, y: saved.y * size.h }) : homePos && clamp(homePos));

  function down(e: React.PointerEvent) {
    if (!at) return;
    press.current = { x: e.clientX, y: e.clientY, from: at, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    p.moved = true;
    setOpen(false);
    setDrag(clamp({ x: p.from.x + dx, y: p.from.y + dy }));
  }
  function up() {
    const p = press.current;
    press.current = undefined;
    if (!p?.moved) return;
    dragged.current = true;
    if (drag && size.w) { const s = { x: drag.x / size.w, y: drag.y / size.h }; setSaved(s); save(s); }
    setDrag(undefined);
  }
  // Double-click the button: back to its place beside the deck
  function reset() { setSaved(undefined); save(undefined); }

  // Open toward where there is room: down unless too close to the bottom, names on the left unless too close to the left edge
  const listH = items.length * (ORB + ITEM_GAP);
  const up_ = !!at && at.y + ORB + listH > size.h && at.y > listH;
  const right = !!at && at.x < 160;
  const alert = items.some((i) => i.alert);
  return (
    <div ref={box} className={`game-menu ${open ? "open" : ""} ${up_ ? "up" : ""} ${right ? "names-right" : ""} ${drag ? "dragging" : ""}`}
      style={at ? { left: at.x, top: up_ ? at.y - listH : at.y } : { visibility: "hidden" }} onMouseLeave={() => { if (!press.current) setOpen(false); }}>
      <button className={`menu-orb ${alert ? "alert" : ""}`} aria-label={label} aria-expanded={open} title={label}
        onMouseEnter={() => { if (!press.current) setOpen(true); }} {...(DRAGGABLE ? { onPointerDown: down, onPointerMove: move, onPointerUp: up, onDoubleClick: reset } : {})}
        onClick={() => { if (dragged.current) dragged.current = false; else setOpen((o) => !o); }}>
        {ICONS.scroll}
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
