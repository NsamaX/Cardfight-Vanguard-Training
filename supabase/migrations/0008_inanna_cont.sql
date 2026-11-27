-- Goddess of Mercy, Inanna: the CONT now runs ("all of your rear-guards get Power+2000 for each card in your soul with Revelation"),
-- written with "per" like other "for each" effects. Fix players' copies that still have the old default code
-- (only where it's exactly the old default, so a card the player edited isn't overwritten).
-- Run once in Supabase Dashboard > SQL Editor, after 0007_kukurihime_fix.sql (and run npm run sync-defaults for default_cards).

update public.cards set
  data = jsonb_set(data, '{abilities,3,effect}', '["power(+2000 per count-in-soul(has-revelation), own-RC)"]'::jsonb),
  updated_at = now()
where key = 'G-BT14/019TH'
  and data->'abilities'->3->'effect' = '["power(+2000, own-RC, n=count-in-soul(has-revelation))"]'::jsonb;
