-- Online mode schema: players (Google sign-in), per-player cards/decks, matches, and match actions
-- Run once in Supabase Dashboard > SQL Editor

-- ---------- Players ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: readable by any signed-in player" on public.profiles
  for select to authenticated using (true);
create policy "profiles: owner can update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Create a profile on first sign-in, named after the Google account
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), 'player'));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Cards ----------
-- data = a Card object as in src/engine/types.ts (without image/source)
-- key may repeat across owners: friends may script the same real card's abilities differently

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  key text not null,
  data jsonb not null,
  image_path text,                       -- path in the card-images bucket, e.g. "<owner>/BT02_014TH.webp"
  updated_at timestamptz not null default now(),
  unique (owner, key)
);

alter table public.cards enable row level security;

create policy "cards: readable by any signed-in player" on public.cards
  for select to authenticated using (true);
create policy "cards: insert as self only" on public.cards
  for insert to authenticated with check (owner = auth.uid());
create policy "cards: owner can update" on public.cards
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "cards: owner can delete" on public.cards
  for delete to authenticated using (owner = auth.uid());

-- ---------- Decks ----------
-- data = a Deck object as in src/engine/types.ts (main/g_zone reference the deck owner's card keys)

create table public.decks (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.decks enable row level security;

create policy "decks: readable by any signed-in player" on public.decks
  for select to authenticated using (true);
create policy "decks: insert as self only" on public.decks
  for insert to authenticated with check (owner = auth.uid());
create policy "decks: owner can update" on public.decks
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "decks: owner can delete" on public.decks
  for delete to authenticated using (owner = auth.uid());

-- ---------- Matches ----------
-- Stores a snapshot of both decks and their card data at match start; both clients build the engine db from it only,
-- so editing library cards mid-match cannot make the two clients diverge.
-- Seed and first player are rolled in join_match on the database side, so no one can pick a favorable seed.

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  engine_version text not null,          -- web build version; clients on different versions must not start
  host uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  host_deck jsonb not null,
  host_cards jsonb not null,             -- array of every Card used by the host's deck
  guest uuid references public.profiles (id) on delete cascade,
  guest_deck jsonb,
  guest_cards jsonb,
  seed integer,
  first_player text check (first_player in ('host', 'guest')),
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'done')),
  created_at timestamptz not null default now()
);

alter table public.matches enable row level security;

create policy "matches: readable by participants" on public.matches
  for select to authenticated using (auth.uid() in (host, guest));
create policy "matches: insert as host only" on public.matches
  for insert to authenticated
  with check (host = auth.uid() and guest is null and seed is null and status = 'waiting');
-- No update policy: status changes only through join_match / finish_match, so the snapshot cannot be edited later

create function public.join_match(p_code text, p_engine_version text, p_deck jsonb, p_cards jsonb)
returns public.matches
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
begin
  select * into m from public.matches where code = upper(p_code) for update;
  if m.id is null then raise exception 'match not found'; end if;
  if m.status <> 'waiting' then raise exception 'match already started'; end if;
  if m.host = auth.uid() then raise exception 'cannot join your own match'; end if;
  if m.engine_version <> p_engine_version then raise exception 'engine version mismatch'; end if;

  update public.matches set
    guest = auth.uid(),
    guest_deck = p_deck,
    guest_cards = p_cards,
    seed = floor(random() * 2147483647)::integer,
    first_player = case when random() < 0.5 then 'host' else 'guest' end,
    status = 'playing'
  where id = m.id
  returning * into m;
  return m;
end;
$$;

create function public.finish_match(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.matches set status = 'done'
  where id = p_match and status = 'playing' and auth.uid() in (host, guest);
end;
$$;

revoke execute on function public.join_match(text, text, jsonb, jsonb) from public, anon;
revoke execute on function public.finish_match(uuid) from public, anon;
grant execute on function public.join_match(text, text, jsonb, jsonb) to authenticated;
grant execute on function public.finish_match(uuid) to authenticated;

-- ---------- Match actions ----------
-- seq starts at 0 and is unique per match; if both clients send the same seq at once, the second hits the primary key and must refetch.
-- Reconnect: load the snapshot plus all actions ordered by seq and replay them through the engine.

create table public.match_actions (
  match_id uuid not null references public.matches (id) on delete cascade,
  seq integer not null check (seq >= 0),
  player uuid not null default auth.uid() references public.profiles (id),
  action jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, seq)
);

alter table public.match_actions enable row level security;

create policy "match_actions: readable by participants" on public.match_actions
  for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and auth.uid() in (m.host, m.guest)));
create policy "match_actions: participants insert as self while playing" on public.match_actions
  for insert to authenticated
  with check (
    player = auth.uid()
    and exists (select 1 from public.matches m where m.id = match_id and m.status = 'playing' and auth.uid() in (m.host, m.guest))
  );

-- Realtime pushes new rows to the other client immediately (respects RLS: only your own matches)
alter publication supabase_realtime add table public.matches, public.match_actions;

-- ---------- Card images ----------
-- Public bucket: anyone can load images by URL, but upload/update/delete only within your own <user id>/ folder

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', true, 2097152, array['image/webp', 'image/png', 'image/jpeg']);

-- Overwriting an existing file (upsert) also requires select
create policy "card-images: owner can list own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "card-images: upload to own folder only" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "card-images: update own folder only" on storage.objects
  for update to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "card-images: delete own folder only" on storage.objects
  for delete to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);
