-- Default cards and decks added after a player's first sign-in reach that player too, once each.
-- Each profile remembers which default card keys and deck ids it already received, so a deleted deck doesn't come back
-- and a card the player edited isn't overwritten.
-- Run once in Supabase Dashboard > SQL Editor, after 0005_rematch.sql

alter table public.profiles
  add column claimed_cards text[] not null default '{}',
  add column claimed_decks text[] not null default '{}';

-- Players who signed in before this migration: count what they already have as received
-- (cards by key, decks by name), so only defaults they don't have yet arrive
update public.profiles p set
  claimed_cards = coalesce((select array_agg(c.key) from public.cards c where c.owner = p.id), '{}'),
  claimed_decks = coalesce((select array_agg(d.id) from public.default_decks d
                            where exists (select 1 from public.decks x where x.owner = p.id and x.name = d.name)), '{}')
where p.defaults_claimed;

create or replace function public.claim_defaults() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  got_cards text[];
  got_decks text[];
begin
  -- Not synced yet: claim nothing, so the player still gets the set once it is uploaded
  if not exists (select 1 from public.default_cards) then return; end if;

  -- Lock the profile so two loads at once don't copy a deck twice
  select claimed_cards, claimed_decks into got_cards, got_decks from public.profiles where id = me for update;
  if not found then return; end if;

  insert into public.cards (owner, key, data, image_path)
  select me, d.key, d.data, d.image_path from public.default_cards d
  where not (d.key = any(got_cards))
  on conflict (owner, key) do nothing;

  insert into public.decks (owner, name, data)
  select me, d.name, d.data from public.default_decks d
  where not (d.id = any(got_decks))
  order by d.id;

  update public.profiles set
    defaults_claimed = true,
    claimed_cards = array(select distinct k from unnest(got_cards || array(select key from public.default_cards)) k),
    claimed_decks = array(select distinct k from unnest(got_decks || array(select id from public.default_decks)) k)
  where id = me;
end;
$$;
