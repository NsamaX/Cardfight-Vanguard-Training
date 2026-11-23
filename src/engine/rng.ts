// ตัวสุ่มที่กำหนด seed ได้ (mulberry32): seed เดิม + การกระทำเดิม = เกมเดิมทุกครั้ง
// ห้ามใช้ Math.random() ใน engine ไม่อย่างนั้น replay จะเล่นซ้ำไม่ได้

export function nextRandom(state: number): [value: number, nextState: number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export function shuffle<T>(items: T[], state: number): [T[], number] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    let r: number;
    [r, s] = nextRandom(s);
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}
