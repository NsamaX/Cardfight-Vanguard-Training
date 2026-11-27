-- Regalia of Hypocenter, Kukurihime: its ACT can be used with any vanguard; "grade 3 or greater vanguard" gates only the Power+3000.
-- Players who already received the default card keep the old ability (defaults are copied once), so fix their copies here,
-- but only where the ability is still exactly the old default, so a card the player edited isn't overwritten.
-- Run once in Supabase Dashboard > SQL Editor, after 0006_new_defaults.sql (and run npm run sync-defaults for default_cards).

update public.cards set
  data = jsonb_set(data, '{abilities,0}',
    (data->'abilities'->0) - 'cond'
      || '{"effect": ["power(+3000, other-own, n≤1, until=turn-end, if=vc-grade≥3)", "draw(1, if=G-faceup≥1)"]}'::jsonb),
  updated_at = now()
where key = 'G-BT14/040TH'
  and data->'abilities'->0->'cond' = '["vc-grade≥3"]'::jsonb
  and data->'abilities'->0->'effect' = '["power(+3000, other-own, n≤1, until=turn-end)", "draw(1, if=G-faceup≥1)"]'::jsonb;
