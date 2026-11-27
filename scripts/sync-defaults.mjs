// Upload the default set from content/ to Supabase: cards -> default_cards, decks -> default_decks,
// card images (content/images/<clan>/*.png) -> card-images bucket under defaults/, sleeves (content/sleeves/*) -> defaults/sleeves/ + default_sleeves
// Needs SUPABASE_SECRET_KEY, so run it only on your machine: npm run sync-defaults
// Players who already signed in get only the defaults they haven't received yet, once each (see claim_defaults in 0006_new_defaults.sql).
import { createClient } from "@supabase/supabase-js";
import { existsSync, globSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { parse } from "yaml";
import { imageName, toCard } from "../src/data/cardFile.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env");

const root = join(import.meta.dirname, "..");
const db = createClient(url, secret, { auth: { persistSession: false } });
const load = (pattern) => globSync(pattern, { cwd: root }).sort().map((p) => ({ path: p, data: parse(readFileSync(join(root, p), "utf8")) }));
const check = ({ error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); };

const cards = [];
// Card files and images sit in a folder per clan, e.g. content/images/granblue/; the bucket keeps them flat under defaults/
const clanDir = (clan) => clan.toLowerCase().replaceAll(" ", "-");
for (const { data } of load("content/cards/*/*/*.yaml")) {
  const card = toCard(data);
  const file = join(root, "content/images", clanDir(card.clan), imageName(card.key));
  let image_path = null;
  if (existsSync(file)) {
    image_path = `defaults/${imageName(card.key)}`;
    check(await db.storage.from("card-images").upload(image_path, readFileSync(file), { contentType: "image/png", upsert: true }), `upload ${image_path}`);
  }
  cards.push({ key: card.key, data: card, image_path });
}
check(await db.from("default_cards").upsert(cards), "default_cards");

const sleeveTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const sleeves = [];
for (const file of globSync("content/sleeves/*", { cwd: root }).sort()) {
  const ext = extname(file).toLowerCase();
  if (!sleeveTypes[ext]) continue;
  const image_path = `defaults/sleeves/${basename(file)}`;
  check(await db.storage.from("card-images").upload(image_path, readFileSync(join(root, file)), { contentType: sleeveTypes[ext], upsert: true }), `upload ${image_path}`);
  sleeves.push({ id: basename(file, extname(file)), image_path });
}
check(await db.from("default_sleeves").upsert(sleeves), "default_sleeves");

// Deck files name a sleeve by its file in content/sleeves/; the app stores the bucket path
const sleevePath = (name) => (name ? `defaults/sleeves/${name}` : undefined);
const decks = load("content/decks/*.yaml").map(({ path, data }) => ({
  id: basename(path, ".yaml"), name: data.name, data: { ...data, sleeve: sleevePath(data.sleeve), g_sleeve: sleevePath(data.g_sleeve) },
}));
check(await db.from("default_decks").upsert(decks), "default_decks");

const keep = (list, col) => `(${list.map((x) => `"${x[col]}"`).join(",")})`;
check(await db.from("default_cards").delete().not("key", "in", keep(cards, "key")), "prune default_cards");
check(await db.from("default_decks").delete().not("id", "in", keep(decks, "id")), "prune default_decks");
check(await db.from("default_sleeves").delete().not("id", "in", keep(sleeves, "id")), "prune default_sleeves");

console.log(`synced ${cards.length} cards (${cards.filter((c) => c.image_path).length} images), ${decks.length} decks, ${sleeves.length} sleeves`);
