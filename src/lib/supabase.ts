import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// null when env is missing (tests, or a build without Supabase): online features stay hidden and offline play still works
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
