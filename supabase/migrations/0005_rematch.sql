-- Online play: play again in the same room. After a game both players press Ready; that creates the next match in 'setup',
-- where each player may change their deck, and it starts once both have pressed Start.
-- Run once in Supabase Dashboard > SQL Editor, after 0004_online_codes.sql

alter table public.matches drop constraint matches_status_check;
alter table public.matches add constraint matches_status_check check (status in ('waiting', 'setup', 'playing', 'done'));

alter table public.matches
  add column host_ready boolean not null default false,   -- 'done': wants a rematch; 'setup': pressed Start
  add column guest_ready boolean not null default false,
  add column next_match uuid references public.matches (id) on delete set null,
  add column abandoned boolean not null default false;    -- a player left; no rematch

-- Ready after a game: the second Ready creates the next match (same players and decks) and returns its id
create function public.ready_rematch(p_match uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  nid uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or auth.uid() not in (m.host, m.guest) then raise exception 'match not found'; end if;
  if m.status not in ('playing', 'done') or m.abandoned then raise exception 'match not open'; end if;
  if m.next_match is not null then return m.next_match; end if;

  update public.matches set
    status = 'done',
    host_ready = host_ready or auth.uid() = host,
    guest_ready = guest_ready or auth.uid() = guest
  where id = m.id
  returning * into m;
  if not (m.host_ready and m.guest_ready) then return null; end if;

  insert into public.matches (engine_version, host, host_deck, host_cards, guest, guest_deck, guest_cards, status)
  values (m.engine_version, m.host, m.host_deck, m.host_cards, m.guest, m.guest_deck, m.guest_cards, 'setup')
  returning id into nid;
  update public.matches set next_match = nid where id = m.id;
  return nid;
end;
$$;

-- Change your deck before the game starts; both players have to press Start again
create function public.set_match_deck(p_match uuid, p_deck jsonb, p_cards jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.matches set
    host_deck = case when auth.uid() = host then p_deck else host_deck end,
    host_cards = case when auth.uid() = host then p_cards else host_cards end,
    guest_deck = case when auth.uid() = guest then p_deck else guest_deck end,
    guest_cards = case when auth.uid() = guest then p_cards else guest_cards end,
    host_ready = false,
    guest_ready = false
  where id = p_match and status = 'setup' and auth.uid() in (host, guest);
end;
$$;

-- Press Start; the second one rolls the seed and who goes first and starts the game
create function public.start_match(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
begin
  update public.matches set
    host_ready = host_ready or auth.uid() = host,
    guest_ready = guest_ready or auth.uid() = guest
  where id = p_match and status = 'setup' and auth.uid() in (host, guest)
  returning * into m;
  if m.id is null or not (m.host_ready and m.guest_ready) then return; end if;
  update public.matches set
    seed = floor(random() * 2147483647)::integer,
    first_player = case when random() < 0.5 then 'host' else 'guest' end,
    status = 'playing',
    host_ready = false,
    guest_ready = false
  where id = m.id;
end;
$$;

-- Leave the room: ends the match for both players, with no rematch
create function public.leave_match(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.matches set status = 'done', abandoned = true
  where id = p_match and auth.uid() in (host, guest);
end;
$$;

revoke execute on function public.ready_rematch(uuid) from public, anon;
revoke execute on function public.set_match_deck(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.start_match(uuid) from public, anon;
revoke execute on function public.leave_match(uuid) from public, anon;
grant execute on function public.ready_rematch(uuid) to authenticated;
grant execute on function public.set_match_deck(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.start_match(uuid) to authenticated;
grant execute on function public.leave_match(uuid) to authenticated;
