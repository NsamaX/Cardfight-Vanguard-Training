import { cards as bundledCards } from "../data/cards";
import { presetDecks } from "../data/decks";
import type { Sleeve } from "../data/sleeves";
import type { Card, Deck } from "../engine/types";
import type { Replay } from "../replay/types";
import { supabase } from "./supabase";

// Guest: the default set, read-only, bot games only. Signed in: the player's own cards and decks (default set copied on first sign-in).
export interface Library {
  cards: Card[];
  decks: Deck[];
  sleeves: Sleeve[];    // default set, plus the player's own uploads when signed in
  userId?: string;      // set = signed in, cards and decks are editable
}

const BUCKET = "card-images";

interface CardRow { key: string; data: Omit<Card, "key" | "image">; image_path: string | null }
interface DeckRow { id: string; name: string; data: Omit<Deck, "id" | "name"> }

// Public URL of a card image or sleeve in the bucket (undefined without Supabase)
export const publicUrl = (path?: string | null) => (path && supabase ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : undefined);

const toCard = (r: CardRow): Card => ({ ...r.data, key: r.key, image: publicUrl(r.image_path) });
const toDeck = (r: DeckRow): Deck => ({ ...r.data, id: r.id, name: r.name });
const toDefaultSleeve = (r: { id: string; image_path: string }): Sleeve => ({ path: r.image_path, name: r.id });

function must<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function loadLibrary(userId?: string): Promise<Library> {
  if (!supabase) return { cards: [...bundledCards], decks: presetDecks, sleeves: [] };
  const defaultSleeves = supabase.from("default_sleeves").select("id, image_path").order("id");
  if (!userId) {
    const [c, d, sl] = await Promise.all([
      supabase.from("default_cards").select("key, data, image_path"),
      supabase.from("default_decks").select("id, name, data").order("id"),
      defaultSleeves,
    ]);
    return { cards: must(c).map(toCard), decks: must(d).map(toDeck), sleeves: must(sl).map(toDefaultSleeve) };
  }
  must(await supabase.rpc("claim_defaults"));
  const [c, d, sl, own] = await Promise.all([
    supabase.from("cards").select("key, data, image_path").eq("owner", userId),
    supabase.from("decks").select("id, name, data").eq("owner", userId).order("name"),
    defaultSleeves,
    supabase.from("sleeves").select("name, image_path").eq("owner", userId).order("created_at"),
  ]);
  return {
    cards: must(c).map(toCard), decks: must(d).map(toDeck),
    sleeves: [...must(sl).map(toDefaultSleeve), ...must(own).map((r: { name: string; image_path: string }) => ({ path: r.image_path, name: r.name, own: true }))],
    userId,
  };
}

// A new image from the card editor arrives as a data URL: upload it under a fresh name (no stale CDN cache), then drop the old file
export async function saveCard(userId: string, card: Card): Promise<Card> {
  const { key, image, ...data } = card;
  const { data: row } = await supabase!.from("cards").select("image_path").eq("owner", userId).eq("key", key).maybeSingle();
  let image_path: string | null = row?.image_path ?? null;
  if (image?.startsWith("data:")) {
    const blob = await (await fetch(image)).blob();
    const path = `${userId}/${key.replace(/[^\w-]/g, "_")}-${Date.now()}.webp`;
    must(await supabase!.storage.from(BUCKET).upload(path, blob, { contentType: blob.type }));
    if (image_path?.startsWith(`${userId}/`)) await supabase!.storage.from(BUCKET).remove([image_path]);
    image_path = path;
  }
  must(await supabase!.from("cards").upsert({ owner: userId, key, data, image_path, updated_at: new Date().toISOString() }, { onConflict: "owner,key" }));
  return { ...card, image: publicUrl(image_path) };
}

// image: data URL from shrinkImage
export async function addSleeve(userId: string, name: string, image: string): Promise<Sleeve> {
  const blob = await (await fetch(image)).blob();
  const path = `${userId}/sleeves/${crypto.randomUUID()}.webp`;
  must(await supabase!.storage.from(BUCKET).upload(path, blob, { contentType: blob.type }));
  must(await supabase!.from("sleeves").insert({ name, image_path: path }));
  return { path, name, own: true };
}

export async function deleteSleeve(path: string) {
  must(await supabase!.from("sleeves").delete().eq("image_path", path));
  must(await supabase!.storage.from(BUCKET).remove([path]));
}

export async function saveDeck(deck: Deck) {
  const { id, name, ...data } = deck;
  must(await supabase!.from("decks").upsert({ id, name, data, updated_at: new Date().toISOString() }));
}

export async function deleteDeck(id: string) {
  must(await supabase!.from("decks").delete().eq("id", id));
}

const REPLAY_LIMIT = 30;

export async function loadCloudReplays(): Promise<Replay[]> {
  const rows = must(await supabase!.from("replays").select("data").order("created_at", { ascending: false }).limit(REPLAY_LIMIT));
  return rows.map((r: { data: Replay }) => r.data);
}

export async function saveCloudReplay(r: Replay) {
  must(await supabase!.from("replays").upsert({ id: r.id, data: r }, { onConflict: "owner,id" }));
}

export async function deleteCloudReplay(id: string) {
  must(await supabase!.from("replays").delete().eq("id", id));
}
