import { useEffect, useState } from "react";

// ป้ายลอยตามเมาส์ บอกผลที่จะให้เมื่อคลิกยูนิทถัดไป (เช่น ผลทริกเกอร์)
export function CursorTip({ text, kind }: { text: string; kind: string }) {
  const [at, setAt] = useState<{ x: number; y: number }>();
  useEffect(() => {
    const move = (e: MouseEvent) => setAt({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);
  if (!at) return null;
  return <div className={`cursor-tip ${kind}`} style={{ left: at.x + 14, top: at.y + 14 }}>{text}</div>;
}
