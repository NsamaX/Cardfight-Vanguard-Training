-- Regalia of Frost, Jotun: "choose one of your units with Regalia" is now a real choice (no-hit(own-unit, ...)), not always the attacked unit.
-- Regalia of Benevolent Wind, Flap Angel: the deck is shuffled after the discard, as the card says (search(..., shuffle=later), discard, shuffle).
-- Fix players' copies that still have the old default code (only where it's exactly the old default, so a card the player edited isn't overwritten).
-- Run once in Supabase Dashboard > SQL Editor, after 0009_daylight_reveal.sql (and run npm run sync-defaults for default_cards).

update public.cards set
  data = jsonb_set(data, '{abilities,0,effect}', '["no-hit(own-unit, filter=name(\"Regalia\"), until=battle-end)"]'::jsonb),
  updated_at = now()
where key = 'G-BT14/021TH'
  and data->'abilities'->0->'effect' = '["no-hit(own-attacked, filter=name(\"Regalia\"), until=battle-end)"]'::jsonb;

update public.cards set
  data = jsonb_set(data, '{abilities,0,effect}', '["search(deck→hand, n≤1, filter=grade-3 & name(\"Regalia\"), shuffle=later)", "discard(1)", "shuffle(deck)"]'::jsonb),
  updated_at = now()
where key = 'G-BT14/039TH'
  and data->'abilities'->0->'effect' = '["search(deck→hand, n≤1, filter=grade-3 & name(\"Regalia\"))", "discard(1)"]'::jsonb;
