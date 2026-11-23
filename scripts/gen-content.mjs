// แปลงการ์ด/เด็ค/คอมโบ (.yaml) ใน content/ เป็น src/data/content.json ก่อน dev/build/test เบราว์เซอร์จึงไม่ต้องโหลดไลบรารี yaml
// รายชื่อสลีฟอ่านจาก public/sleeves/ (เบราว์เซอร์โหลดรูปจากโฟลเดอร์นี้ตรงๆ)
// เพิ่มหรือแก้ไฟล์ข้อมูลแล้วต้องรีสตาร์ต dev server (หรือรัน npm run content)
import { globSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..");
const load = (pattern) =>
  globSync(pattern, { cwd: root }).sort().map((p) => ({ path: p.replaceAll("\\", "/"), data: parse(readFileSync(join(root, p), "utf8")) }));

const sleeves = readdirSync(join(root, "public/sleeves")).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();

const content = {
  cards: load("content/cards/*/*.yaml").map(({ path, data }) => ({ ...data, source: path })),
  decks: load("content/decks/*.yaml").map(({ path, data }) => ({ id: basename(path, ".yaml"), ...data })),
  combos: load("content/combos/*.yaml").map(({ data }) => data),
  images: readdirSync(join(root, "public/images")).filter((f) => f.endsWith(".png")),
  sleeves,
};

writeFileSync(join(root, "src/data/content.json"), JSON.stringify(content));
