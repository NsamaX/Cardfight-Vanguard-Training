-- Sleeves: a shared default set (from content/sleeves/) plus sleeves each signed-in player uploads
-- Decks store the sleeve's image_path, so the opponent's client can load the image from the public bucket
-- Run once in Supabase Dashboard > SQL Editor, after 0002_defaults_and_replays.sql

create table public.default_sleeves (
  id text primary key,                   -- file name in content/sleeves/ without extension
  image_path text not null               -- e.g. "defaults/sleeves/moon.jpg"
);

alter table public.default_sleeves enable row level security;

create policy "default_sleeves: readable by everyone" on public.default_sleeves
  for select to anon, authenticated using (true);

create table public.sleeves (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  image_path text not null,              -- "<owner>/sleeves/<uuid>.webp"
  created_at timestamptz not null default now()
);

alter table public.sleeves enable row level security;

create policy "sleeves: owner can read" on public.sleeves
  for select to authenticated using (owner = auth.uid());
create policy "sleeves: insert as self only" on public.sleeves
  for insert to authenticated with check (owner = auth.uid() and image_path like auth.uid()::text || '/sleeves/%');
create policy "sleeves: owner can delete" on public.sleeves
  for delete to authenticated using (owner = auth.uid());
