-- Regalia of Dawn, Daylight Angel: its ACT reveals the three cards (both players see them), so the look gets the reveal flag.
-- Fix players' copies that still have the old default code (only where it's exactly the old default, so a card the player edited isn't overwritten).
-- Run once in Supabase Dashboard > SQL Editor, after 0008_inanna_cont.sql (and run npm run sync-defaults for default_cards).

update public.cards set
  data = jsonb_set(data, '{abilities,1,effect}', '["look(3, reveal, soul=n≤1, rest=drop)", "draw(1, if=souled-name(\"Regalia\"))"]'::jsonb),
  updated_at = now()
where key = 'G-BT14/071TH'
  and data->'abilities'->1->'effect' = '["look(3, soul=n≤1, rest=drop)", "draw(1, if=souled-name(\"Regalia\"))"]'::jsonb;
