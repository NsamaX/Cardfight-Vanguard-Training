# Standard ability codes

Shared codes for writing card abilities the same way no matter how the card's translation words them. The card's real text stays in the card file's `text` field; the codes here are what the engine runs and what combo search matches on.

Sections 1–8 are generated from the engine's vocabulary registry (`src/engine/vocab/`), so they always match what the engine runs. To support a new card text, add the code to the registry with its forms and meaning, then run `npm run vocab-doc`. `npm run check-cards` lists the codes in card files the engine doesn't know yet.

## Format

```
code(main value, parameter=value)
```

| Common value | Meaning |
|---|---|
| `self` | This card |
| `other-own` | Another of our units |
| `own-VC` | Our vanguard |
| `opp` | The opponent |
| `VC` / `RC` / `GC` | Circles on the board |
| `hand` / `drop` / `deck` / `soul` / `damage` / `G` | Hand / drop zone / deck / soul / damage zone / G zone |
| `n` | A count; use `≤` when the card says "up to" |

---

<!-- generated from src/engine/vocab: npm run vocab-doc -->

## 1. Timing (events that trigger AUTO abilities)

| Code | Meaning | Cards |
|---|---|---|
| `enter(RC, self)`<br>`enter(VC, self)`<br>`enter(GC, self)`<br>`enter(RC, self, from=hand)`<br>`enter(RC, other-own, from=drop)` | A card is placed on a circle (from= where it came from) | Agleam, Honoly, Iris, Urth, Eir, Laurier, Hemera, Freyja, Flap Angel, Jotun, Bragi, Angelica, Negronora, Deep Corpse Dragon, Obadiah, Negrolily, Immortal Galleon, Chappie the Ghostie, Gust Jinn, King Serpent, Nightstorm, Skeleton Cannoneer, Tommy the Ghostie Brothers, Grenache, Nightrose, Waterspout Djinn, Negrolazy, Negrorook, Zombie Whale of the Ocean Depths, Mick the Ghostie and Family, Megiddo |
| `move(self, from=hand, to=drop)`<br>`move(own, from=deck, to=drop)`<br>`move(opp, from=RC, to=drop)`<br>`move(own, to=bind, filter=…)`<br>`move(own, from=deck, to=hand, by=draw)`<br>`move(own, to=hand, by=drive-check)`<br>`move(own, to=damage, by=damage-check)`<br>`move(own, from=damage, to=drop, by=heal)` | A card moves between zones (who: self / own / other-own / opp; from= and to= a zone: hand, deck, drop, soul, damage, bind, G, VC, RC, GC; by= retire, hollow, draw, drive-check, damage-check, or heal) | - |
| `stride(own)`<br>`stride(own, filter=name("…"))` | We stride a G unit (filter on its original card name) | Angelica, Verthandi, Nightrose |
| `attack-hit(self)`<br>`attack-hit(self, target=VC)` | This unit's attack hits (target= VC or RC) | Verthandi |
| `to-soul(own)` | A card is put into our soul (once per card) | Verthandi |
| `turn-end` | The end of the turn | Dreaming Dragon |
| `ridden-upon(self)` | This vanguard is ridden upon | Daylight Angel, Grenache |
| `attack(self)`<br>`attack(self, target=VC)`<br>`attack(own-VC)` | This unit (or our vanguard) attacks | Minerva, Freyja, Genil, Negrorook, Zombie Whale of the Ocean Depths, Rampage Shade |
| `battle-end(self, did=attack)`<br>`battle-end(self, did=attack-VC)`<br>`battle-end(self, did=boost-RC)` | The end of a battle in which this unit attacked (a vanguard) or boosted a rear-guard | Nightstorm, Negrobone, Megiddo |
| `to-drop(self, from=soul)`<br>`to-drop(self, from=RC, by=hollow)`<br>`to-drop(own, from=RC)` | A card is put into the drop zone (from=, by= how) | Norn, Jotun, Genil, Achlis, Grenache, Nightrose, Negrolazy |
| `retired(self, from=RC)`<br>`retired(own)` | A unit is retired (by an effect, a cost, the rules, or Hollow) | Mick the Ghostie and Family |
| `discarded(self, from=hand, as=g-guardian-cost)`<br>`discarded(self)` | This card is discarded from hand (as= for which cost) | Eir, Dewey the Ghostie |
| `phase-start(battle)` | Our battle phase starts | Nightrose |
| `step(stride, own)`<br>`step(guard, opp)` | Used in this step by the rules (STRIDE, G GUARDIAN) | Sebreeze, Agleam, Inanna, Iris, Urth, Eir, Minerva, Laurier, Negronora, Deep Corpse Dragon, Obadiah, Negrolily, Nightrose, Immortal Galleon, Megiddo |

## 2. Conditions

Used in `cond` and in `if=`. A term is a named condition below, or a counter (section 3) compared with a number: `souled≥2`, `drop-count≤5`, `opp-vc-grade=2`. Terms joined with `&` must all hold. An unknown condition never holds.

| Code | Meaning | Cards |
|---|---|---|
| `GB(#)` | Generation Break n or more | Inanna, Minerva, Laurier, Freyja, Jotun, Genil, Bragi, Dreaming Dragon, Negronora, Immortal Galleon, Nightstorm, Skeleton Cannoneer, Grenache, Nightrose, Negrolazy, Negrobone, Negrorook, Zombie Whale of the Ocean Depths, Mick the Ghostie and Family |
| `1/turn` | Once per turn | Inanna, Minerva, Verthandi, Nightrose |
| `own-turn` | During our turn | Jotun, Genil, Verthandi, Dreaming Dragon, Nightrose |
| `self-hollowed` | This card is hollowed | Nightstorm, Skeleton Cannoneer, Grenache, Nightrose, Negrolazy, Negrorook, Zombie Whale of the Ocean Depths, Mick the Ghostie and Family |
| `vc-name("…")` | Our vanguard (or its heart) has this word in its name | Freyja, Norn, Jotun, Bragi, Achlis, Negrolazy, Negrobone, Rampage Shade |
| `heart-name("…")` | Our heart card has this word in its name | Urth |
| `vc-clan("…")` | Our vanguard is of this clan | Rough Seas Banshee |
| `souled-name("…")` | This ability put a card with this word in its name into the soul | Daylight Angel |
| `name-in-drop("…")` | A card with this word in its name is in our drop zone | Waterspout Djinn |
| `called-has-hollow` | A card this ability called has Hollow | Nightrose |
| `opp-no-ride-last-turn` | No unit was ridden on the opponent's VC during their preceding turn | Sebreeze |
| `while(stride-cost)` | Only while doing this (CONT): stride-cost = paying the stride cost | Flap Angel, Tommy the Ghostie Brothers |

## 3. Counters

Numbers a code can read: in a comparison (`G-faceup≥1`), as an amount (`n≤G-faceup+1`, `n=count-in-drop(…)`), or for "for each" (`+3000 per souled`, `+1000 per 2 drop` = one for every 2, `per=returned`). The tags souled, called, returned, charged, stood, and milled count what this ability's earlier steps did.

| Code | Meaning |
|---|---|
| `GB` | Generation Break: face-up G units on VC and in the G zone |
| `vc-grade` | Our vanguard's grade |
| `opp-vc-grade` | The opponent's vanguard's grade |
| `G-faceup`<br>`G-faceup(filter)` | Face-up cards in our G zone |
| `drop` | Cards in our drop zone |
| `drop-count` | Cards in our drop zone |
| `soul` | Cards in our soul |
| `attack-count` | This turn's battle number (the battle being started counts) |
| `hand` | Cards in our hand |
| `damage` | Cards in our damage zone |
| `count-in-drop(filter)` | Cards in our drop zone matching the filter |
| `count-in-soul(filter)` | Cards in our soul matching the filter |
| `souled`<br>`souled(filter)` | Cards this ability put into the soul |
| `called`<br>`called(filter)` | Cards this ability called |
| `returned`<br>`returned(filter)` | Cards this ability returned to the deck |
| `charged`<br>`charged(filter)` | Cards this ability soul charged |
| `soul-charged(filter)` | Cards this ability soul charged |
| `stood`<br>`stood(filter)` | Units this ability stood |
| `milled`<br>`milled(filter)` | Cards this ability put into the drop zone from the deck |
| `hollow-milled` | Cards with Hollow this ability put into the drop zone from the deck |

## 4. Costs

Codes that can be paid as a cost (the engine checks whether they can be paid before offering the ability).

| Code | Meaning | Cards |
|---|---|---|
| `CB(#)` | Counter Blast: turn face-up damage face down | Sebreeze, Inanna, Urth, Freyja, Daylight Angel, Angelica, Negrolily, Nightrose, Nightstorm, Skeleton Cannoneer, Negrolazy, Negrobone, Megiddo |
| `SB(#)`<br>`SB(#, filter=name("…"))` | Soul Blast: put cards from the soul into the drop zone (filter= which ones) | Urth, Minerva, Verthandi, Negronora, Nightstorm, Nightrose, Negrolazy |
| `RC-SB(#)` | RC Soul Blast: put cards from the soul of this rear-guard into the drop zone | - |
| `flip-G-up(#, filter=same-name)`<br>`flip-G-up(#, filter=G-GUARDIAN)` | Turn a face-down card in our G zone face up | Inanna, Urth, Minerva, Laurier, Negronora, Nightrose |
| `bind(self)`<br>`bind(self + 1 heal-trigger from drop)` | Bind cards face up (this card, and another Heal trigger from the drop zone) | Jotun, Eir, Dewey the Ghostie |
| `mill(#)`<br>`mill(≤#)` | Put cards from the top of the deck into the drop zone (≤n: the player chooses up to n) | Deep Corpse Dragon, Nightrose |
| `discard(#)`<br>`discard(#, filter=heal)`<br>`discard(n, grade-sum≥3)` | Discard cards from hand (filter= which ones) | Sebreeze, Agleam, Inanna, Iris, Urth, Eir, Minerva, Laurier, Flap Angel, Jotun, Negronora, Deep Corpse Dragon, Obadiah, Negrolily, Nightrose, Immortal Galleon, Gust Jinn, Tommy the Ghostie Brothers, Waterspout Djinn, Megiddo |
| `reveal(#, filter=…)` | Reveal cards from hand (they stay in hand) | Flap Angel, Tommy the Ghostie Brothers |
| `soul-in(self)` | Put this unit into the soul (usually a cost) | Daylight Angel, Kukurihime, Rampage Shade, Rough Seas Banshee |
| `retire-own(#)` | Retire our own rear-guards (usually a cost) | Negrolily |

## 5. Effects

| Code | Meaning | Cards |
|---|---|---|
| `CC(#)` | Counter Charge: turn face-down damage face up (the player picks which when there are more) | Eir, King Serpent, Grenache, Waterspout Djinn, Dewey the Ghostie |
| `damage-facedown(#)` | Turn face-up damage face down (not as a cost) | Honoly |
| `SC(#)` | Soul Charge: put cards from the top of the deck into the soul | Inanna, Eir, King Serpent, Dewey the Ghostie |
| `RC-SC(#)` | RC Soul Charge: put cards from the top of the deck into the soul of this rear-guard | - |
| `draw(#)` | Draw cards | Agleam, Freyja, Daylight Angel, Angelica, Dreaming Dragon, Kukurihime, Skeleton Cannoneer, Rampage Shade, Rough Seas Banshee |
| `search(deck→hand, n≤#, filter=…)`<br>`search(deck→drop, n≤#, filter=…)`<br>`search(deck→hand, n≤#, filter=…, look=top-5)` | Search the deck (or its top 5) for cards, put them into hand or the drop zone, then shuffle | Flap Angel, Obadiah, Chappie the Ghostie, Nightstorm, Tommy the Ghostie Brothers |
| `look(#, hand=1, soul=1, rest=drop)`<br>`look(#, soul=n≤1, rest=drop)`<br>`look(#, hand=1, soul=1)`<br>`look(#, reveal, soul=n≤1, rest=drop)` | Look at (or reveal) the top cards of the deck: some to hand, some to the soul, the rest to the drop zone | Daylight Angel, Angelica, Verthandi |
| `to-soul(drop, n≤#, filter=…)`<br>`to-soul(drop, n=#, filter=…)`<br>`to-soul(drop, all, filter=…)`<br>`to-soul(self)` | Put cards from the drop zone (or this unit) into the soul (filter different-grades = all chosen differ in grade) | Iris, Urth, Eir, Hemera, Freyja, Genil, Bragi, Angelica |
| `to-deck(drop, all)`<br>`to-deck(drop+soul, n=#..#, filter=…)` | Return cards to the deck (filter same-grade = all chosen share a grade) | Laurier, Dreaming Dragon |
| `to-deck-top(self)` | Put this unit on the top of the deck | Dreaming Dragon |
| `return-to-deck(self)` | Shuffle this card from the drop zone into the deck | Mick the Ghostie and Family |
| `to-hand(drop, n≤#, filter=…)` | Return cards from the drop zone to hand | Jotun |
| `shuffle(deck)` | Shuffle the deck | Laurier, Dreaming Dragon |
| `call(drop→RC, n≤#, filter=…)`<br>`call(hand+drop→RC, n≤#, filter=…, to=empty)`<br>`call(drop→RC, n=#, filter=that-card)`<br>`call(drop→GC, n≤#, filter=different-grades)`<br>`call(self→RC)`<br>`call(G→GC, self)` | Call cards to rear-guard circles (to= empty / different / not-self / same-column) or to the guardian circle | Agleam, Iris, Eir, Laurier, Daylight Angel, Negronora, Deep Corpse Dragon, Obadiah, Negrolily, Nightrose, Immortal Galleon, Nightstorm, Grenache, Negrolazy, Negrobone, Megiddo |
| `retire(target)`<br>`retire(opp-RC, n≤#)`<br>`retire(own, target=boosted)`<br>`retire(own, target=called, at=turn-end)` | Retire units | Immortal Galleon, Nightstorm, Skeleton Cannoneer, Grenache, Nightrose, Negrolazy, Negrobone, Negrorook, Zombie Whale of the Ocean Depths, Mick the Ghostie and Family |
| `opp-retires(opp-RC, n=#)`<br>`opp-retires(opp-RC, n=soul-charged(filter))` | The opponent chooses and retires that many of their own rear-guards | Inanna |
| `stand(own, filter=…)`<br>`stand(own, filter=…, at=battle-end)` | Stand units | Minerva |
| `swap(self, other-own-RC)` | Switch this rear-guard with another of our rear-guards (may skip) | Megiddo |
| `hollow(self)`<br>`hollow(called)` | Hollow: the unit is retired at the end of the turn (the player may choose not to hollow itself) | Nightrose, Nightstorm, Skeleton Cannoneer, Grenache, Negrolazy, Negrorook, Zombie Whale of the Ocean Depths, Mick the Ghostie and Family |
| `no-hit(own-attacked, until=battle-end)`<br>`no-hit(own-attacked, filter=…, until=battle-end)`<br>`no-hit(own-VC-attacked, until=battle-end)` | Our attacked unit can't be hit this battle | Jotun, Gust Jinn, Waterspout Djinn |
| `power(+#, target, until=…)`<br>`power(-#, target, until=…)`<br>`power(+#, self, until=turn-end)`<br>`power(+#, own-VC, until=turn-end)`<br>`power(+#, other-own, n≤#, filter=…, until=turn-end)`<br>`power(+#, front-row ≤#, filter=…)`<br>`power(+#, called, until=turn-end)`<br>`power(+# per souled, own-VC & self, until=turn-end)`<br>`power(+# per # drop, self, until=battle-end)`<br>`power(+#, own-units, n=count-in-drop(filter), until=turn-end)`<br>`power(+# per count-in-soul(filter), own-RC)`<br>`power(-#, self)` | Change Power (until= battle-end or turn-end) | Inanna, Urth, Minerva, Freyja, Norn, Genil, Bragi, Verthandi, Achlis, Kukurihime, Nightrose, Immortal Galleon, Negrolazy, Negrorook, Zombie Whale of the Ocean Depths, Mick the Ghostie and Family, Rampage Shade, Megiddo |
| `shield(+#, target, until=…)`<br>`shield(+#, self, until=battle-end)`<br>`shield(+#, self, per=returned, until=battle-end)` | Change Shield | Iris, Eir, Laurier, Deep Corpse Dragon, Negrolily |
| `critical(+#, self)`<br>`critical(+#, target, until=…)` | Change Critical | Urth, Nightrose |
| `drive(+#, self)`<br>`drive(-#, stood, until=turn-end)` | Change drive (how many drive checks a vanguard makes) | Minerva |
| `grade(+#, self)` | Change grade (CONT, e.g. while paying the stride cost; read by the rules, see cont.ts) | Flap Angel, Tommy the Ghostie Brothers |
| `grant(AUTO-RC[turn-end → draw(1)], target, until=turn-end)`<br>`grant(ACT-VC[CB(1) → power(+5000, self)], target, until=turn-end)` | Give units an ability until the end of the turn: AUTO-zone[timing → effect & …] or ACT-zone[cost & … → effect & …] | Urth, Verthandi, Negrolazy, Mick the Ghostie and Family, Megiddo |
| `choose(CC(1), SC(1))` | The player chooses one of the effects | Eir, Negrolazy, Dewey the Ghostie |
| `stride(self)` | STRIDE this card (the rules do it in the stride step) | Sebreeze, Inanna, Urth, Minerva, Obadiah, Nightrose, Immortal Galleon, Megiddo |
| `stride-from-G(self)` | STRIDE this card from the G zone onto VC (an ACT used from the G zone) | Sebreeze |
| `remove-G-zone(own, at=return-to-G)` | The whole G zone is removed from the game when this G unit returns (ultimate stride rule) | Megiddo |
| `attack-tax(CB(#), RC)` | Rear-guards can't attack a vanguard unless the cost is paid (CONT; Honoly) | Honoly |
| `keyword(Sentinel)`<br>`keyword(Revelation)` | A keyword (Sentinel: deck limit and guard rules; others are placeholders) | Inanna, Jotun, Gust Jinn, Waterspout Djinn |
| `all-clan(self)` | Counts as every clan for deck building | Sebreeze, Agleam, Honoly |

In a CONT ability, `power`, `shield`, `critical`, `drive`, and `grade` apply for as long as the condition holds (targets that need no choice only).

## 6. Targets

Which units an effect acts on (the second argument of `power`, `grant`, `retire`, ...). `a & b` joins targets that need no choice; ` ≤n` after a target or an `n≤…` argument sets how many may be chosen.

| Code | Meaning |
|---|---|
| `self` | This card (on a circle or the guardian circle) |
| `own-VC` | Our vanguard |
| `own` | All our units |
| `own-RC` | All our rear-guards |
| `other-own, n≤#` | Our units other than this card (choose) |
| `own-units, n=count-in-drop(filter)` | Our units (choose) |
| `other-own-RC` | Our rear-guards other than this card (choose) |
| `front-row ≤#` | Units in our front row (choose) |
| `opp-RC, n≤#` | The opponent's rear-guards (choose) |
| `own-attacked` | Our unit being attacked |
| `own-VC-attacked` | Our vanguard, if it's being attacked |
| `boosted` | The unit this card boosted (at the end of that battle) |
| `called` | The units this ability called |
| `stood` | The units this ability stood |

## 7. Filters

`filter=a & b`: every term must match. A bare capitalized word is a clan name (`filter=Granblue`). Set rules apply to all chosen cards together.

| Code | Meaning |
|---|---|
| `grade-#` | Grade exactly n |
| `grade≤#` | Grade n or less |
| `grade≥#` | Grade n or more |
| `name("…")` | Has this word in its card name |
| `same-name` | The same card as the ability's source |
| `same-name-as-VC` | The same card name as our vanguard |
| `not-same-name` | A different card name than the source |
| `normal-unit` | A normal unit (not a trigger or G card) |
| `heal` | A Heal trigger |
| `heal-trigger` | A Heal trigger |
| `G-GUARDIAN` | A G guardian |
| `has-hollow` | Has the Hollow ability |
| `has-revelation` | Has the Revelation keyword |
| `that-card` | The card the triggering event was about |
| `clan("…")`<br>`Granblue` | Of this clan (a bare capitalized word is a clan name too) |
| `different-grades` | All chosen cards have different grades (set rule) |
| `same-grade` | All chosen cards share one grade (set rule) |
| `grade-sum≥3` | The chosen cards' grades add up to 3 or more (set rule) |

## 8. Parameters

| Code | Meaning | Example |
|---|---|---|
| `if=condition` | The step happens only if the condition (section 2) holds when it resolves | `draw(1, if=souled≥1)` |
| `until=` | How long a change lasts: `battle-end` or `turn-end` (the default) | `power(+2000, self, until=battle-end)` |
| `at=` | This step and the ones after it wait for `battle-end` or `turn-end`, keeping what earlier steps did | `stand(own, filter=name("Regalia"), at=battle-end)`, `drive(-3, stood)` |
| `n≤k`, `n=k`, `n=a..b` | How many: up to k, exactly k, a to b (k may be a counter) | `to-soul(drop, n≤3)`, `call(drop→RC, n≤G-faceup+1)` |

<!-- end of generated part -->

---

## 9. Effects that open another card's timing (the core of combo search)

The effect or cost on the left causes the event on the right; cards whose timing matches that event act next.

| Effect / cost / rule | Causes | Cards waiting for this event |
|---|---|---|
| `call(drop→RC)` | `enter(RC, self, from=drop)` and `enter(RC, other-own, from=drop)` | Skeleton Cannoneer, King Serpent, Mick, Nightrose (Starlight) |
| Every `call(…→RC)` and normal calls from hand | `enter(RC, self)` | Negrolazy, Honoly, the Hollow keyword |
| The Hollow keyword (retire at end of turn) | `retired(self, from=RC)`, `to-drop(self, from=RC, by=hollow)`, `to-drop(own, from=RC)` | Mick (granted ability), Grenache, Negrolazy (granted ability), Nightrose (Night Fog) |
| `retire-own` (cost) / `retire(own)` (effect) | `retired(…, from=RC)`, `to-drop(own, from=RC)` | Nightrose (Night Fog), Mick (granted ability) |
| Every STRIDE | `stride(own)`, the G unit's `enter(VC, self)` | Nightrose (Night Fog), Nightrose (Starlight), Obadiah, Immortal Galleon, Megiddo |
| Discarding Dewey for a G GUARDIAN cost | `discarded(self, as=g-guardian-cost)` | Dewey the Ghostie |
| `mill`, `search(deck→drop)`, `discard` costs | More cards in the drop zone, and targets to call from it | Zombie Whale (`drop-count`), Waterspout Djinn (`name-in-drop`), Nightrose (G unit) (counts "Nightrose" in the drop zone), every card with `call(drop→…)` |
| `flip-G-up`, G units returning at end of turn, G guardians returning after a battle | More face-up cards in the G zone, so `GB(n)` comes sooner | Every card with `GB(n)`, ultimate stride (needs 3 or more face up) |

### Example: tracing a combo through the table

1. A hollowed rear-guard is retired at the end of the turn, causing `to-drop(own, from=RC)`.
2. **Nightrose (Night Fog)** (VC, GB2, 1/turn) triggers, pays `mill(3)`, and calls that card back to RC.
3. That call causes `enter(RC, self, from=drop)`. If the card is **Skeleton Cannoneer**, it triggers next (GB1, CB1): retire an opponent's rear-guard, and draw if hollowed.

The `mill(3)` in step 2 also adds drop zone cards for Zombie Whale and Nightrose (G unit).

For the rules-level ordering of this example see [timing-g.md](timing-g.md) (notes 1–2): in the end phase the G unit returns to the G zone before Hollow retires, so Nightrose works even on a turn you strode, and the called-back unit doesn't have to become hollowed.
