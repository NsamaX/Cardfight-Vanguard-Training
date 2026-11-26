"use client";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!supabase);   // false until the stored session has been read

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  return {
    available: supabase !== null,
    ready,
    user,
    signIn: () => supabase?.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } }),
    signOut: () => supabase?.auth.signOut(),
  };
}
