"use client";
import { useEffect, useRef, useState } from "react";
import { cards, dropCard, putCard, setCards } from "../data/cards";
import { presetDecks } from "../data/decks";
import type { Sleeve } from "../data/sleeves";
import type { Card, Deck } from "../engine/types";
import type { MsgKey } from "../i18n/msg";
import { useT } from "../i18n/react";
import * as cloud from "../lib/library";
import type { Library } from "../lib/library";

// The player's cards, decks, and sleeves plus the edits the deck screens make.
// Edits update local state right away; signed-in players' edits are also written to Supabase.
export interface LibraryHandle extends Library {
  saveDeck(d: Deck): void;
  deleteDeck(id: string): void;
  saveCard(c: Card): Promise<MsgKey | null>;
  deleteCard(key: string): Promise<MsgKey | null>;
  addSleeve(name: string, image: string): Promise<void>;
  deleteSleeve(path: string): Promise<Deck[]>;   // returns the decks that fell back to the default sleeve
}

// Bundled default set with no persistence (tests, or a build without Supabase)
export const offlineLibrary: LibraryHandle = {
  cards, decks: presetDecks, sleeves: [],
  saveDeck() {}, deleteDeck() {}, addSleeve: async () => {}, deleteSleeve: async () => [],
  saveCard: async () => "cardEd.writeFailed",
  deleteCard: async () => "cardEd.deleteFailed",
};

const upsert = (decks: Deck[], d: Deck) => (decks.some((x) => x.id === d.id) ? decks.map((x) => (x.id === d.id ? d : x)) : [...decks, d]);

// Loads the library once auth is known and again on sign-in/out; onLoaded runs after each load (not after edits)
export function useLibrary(ready: boolean, userId: string | undefined, onLoaded: (l: Library) => void) {
  const t = useT();
  const [lib, setLib] = useState<Library | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const latest = useRef(lib);
  latest.current = lib;

  useEffect(() => {
    if (!ready) return;
    let live = true;
    setFailed(false);
    cloud.loadLibrary(userId).then((l) => {
      if (!live) return;
      if (!l.decks.length) throw new Error("library has no decks");
      setCards(l.cards);
      setLib(l);
      loaded.current(l);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [ready, userId, attempt]);

  const warn = () => alert(t("library.saveFailed"));
  const update = (f: (l: Library) => Library) => setLib((l) => l && f(l));

  const handle: LibraryHandle | null = lib && {
    ...lib,
    saveDeck(d) {
      update((l) => ({ ...l, decks: upsert(l.decks, d) }));
      if (userId) cloud.saveDeck(d).catch(warn);
    },
    deleteDeck(id) {
      update((l) => ({ ...l, decks: l.decks.filter((x) => x.id !== id) }));
      if (userId) cloud.deleteDeck(id).catch(warn);
    },
    async saveCard(c) {
      if (!userId) return "cardEd.writeFailed";
      try {
        putCard(await cloud.saveCard(userId, c));
        update((l) => ({ ...l, cards: [...cards] }));
        return null;
      } catch {
        return "cardEd.writeFailed";
      }
    },
    async deleteCard(key) {
      if (!userId) return "cardEd.deleteFailed";
      try {
        await cloud.deleteCard(userId, key);
        dropCard(key);
        update((l) => ({ ...l, cards: [...cards] }));
        return null;
      } catch {
        return "cardEd.deleteFailed";
      }
    },
    async addSleeve(name, image) {
      if (!userId) return;
      try {
        const sl: Sleeve = await cloud.addSleeve(userId, name, image);
        update((l) => ({ ...l, sleeves: [...l.sleeves, sl] }));
      } catch {
        warn();
      }
    },
    async deleteSleeve(path) {
      try {
        await cloud.deleteSleeve(path);
      } catch {
        warn();
        return [];
      }
      const affected = (latest.current?.decks ?? []).filter((d) => d.sleeve === path || d.g_sleeve === path)
        .map((d) => ({ ...d, sleeve: d.sleeve === path ? undefined : d.sleeve, g_sleeve: d.g_sleeve === path ? undefined : d.g_sleeve }));
      update((l) => ({ ...l, sleeves: l.sleeves.filter((x) => x.path !== path), decks: affected.reduce(upsert, l.decks) }));
      for (const d of affected) cloud.saveDeck(d).catch(warn);
      return affected;
    },
  };

  return { library: handle, failed, retry: () => setAttempt((n) => n + 1) };
}
