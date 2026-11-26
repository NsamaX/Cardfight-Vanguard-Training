-- Default card/deck set (from content/), copied into each player's account on first sign-in, and per-player replays
-- Run once in Supabase Dashboard > SQL Editor, after 0001_init.sql

-- ---------- Default set ----------
-- Readable by guests too. Written only by scripts/sync-defaults.mjs with the secret key (no write policies).
-- Images live in the card-images bucket under defaults/

create table public.default_cards (
  key text primary key,
  data jsonb not null,
  image_path text
);

create table public.default_decks (
  id text primary key,                   -- file name in content/decks/
  name text not null,
  data jsonb not null
);

alter table public.default_cards enable row level security;
alter table public.default_decks enable row level security;

create policy "default_cards: readable by everyone" on public.default_cards
  for select to anon, authenticated using (true);
create policy "default_decks: readable by everyone" on public.default_decks
  for select to anon, authenticated using (true);

-- ---------- Copy the default set on first sign-in ----------
-- Copied once per player; later changes to the default set do not reach existing players

alter table public.profiles add column defaults_claimed boolean not null default false;

create function public.claim_defaults() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Not synced yet: leave the flag unset so the player still gets the set once it is uploaded
  if not exists (select 1 from public.default_cards) then return; end if;

  update public.profiles set defaults_claimed = true
  where id = auth.uid() and not defaults_claimed;
  if not found then return; end if;

  insert into public.cards (owner, key, data, image_path)
  select auth.uid(), key, data, image_path from public.default_cards
  on conflict (owner, key) do nothing;

  insert into public.decks (owner, name, data)
  select auth.uid(), name, data from public.default_decks order by id;
end;
$$;

revoke execute on function public.claim_defaults() from public, anon;
grant execute on function public.claim_defaults() to authenticated;

-- ---------- Replays ----------
-- data = a Replay object as in src/replay/types.ts; guests keep replays in localStorage instead

create table public.replays (
  id text not null,
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

alter table public.replays enable row level security;

create policy "replays: owner can read" on public.replays
  for select to authenticated using (owner = auth.uid());
create policy "replays: insert as self only" on public.replays
  for insert to authenticated with check (owner = auth.uid());
create policy "replays: owner can update" on public.replays
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "replays: owner can delete" on public.replays
  for delete to authenticated using (owner = auth.uid());
