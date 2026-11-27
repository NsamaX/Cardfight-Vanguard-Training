-- Online play: 6-digit numeric room codes, and the host can close a room nobody has joined
-- Run once in Supabase Dashboard > SQL Editor, after 0003_sleeves.sql

-- A code only has to be unique among rooms still waiting for a guest, so finished matches don't use up the 1,000,000 codes.
-- A clash with an open room fails the insert (unique violation); the client retries with a new code.
alter table public.matches drop constraint matches_code_key;
alter table public.matches alter column code set default lpad(floor(random() * 1000000)::integer::text, 6, '0');
create unique index matches_open_code on public.matches (code) where status = 'waiting';

create or replace function public.join_match(p_code text, p_engine_version text, p_deck jsonb, p_cards jsonb)
returns public.matches
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
begin
  select * into m from public.matches where code = p_code and status = 'waiting' for update;
  if m.id is null then raise exception 'match not found'; end if;
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

-- Also closes a waiting room (the host cancelled or opened a new one)
create or replace function public.finish_match(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.matches set status = 'done'
  where id = p_match and status in ('waiting', 'playing') and auth.uid() in (host, guest);
end;
$$;
