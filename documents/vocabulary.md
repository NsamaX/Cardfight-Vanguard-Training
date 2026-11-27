# Standard ability codes

Shared codes for writing card abilities the same way no matter how the card's translation words them. The card's real text stays in the card file's `text` field; the codes here are what the engine runs and what combo search matches on.

This list was built from the 49 card files currently in the library (G era). If a new card has an event or effect with no code yet, add the code here before using it.

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

## 1. Timing (events that trigger AUTO abilities)

| Code | Meaning | Card wording | Cards |
|---|---|---|---|
| `enter(RC, self)` | This card is placed on RC (from anywhere) | "When this unit is placed on (RC)" | Negrolazy, Honoly, the Hollow keyword |
| `enter(RC, self, from=hand)` | This card is placed on RC from hand | "When this unit is placed on (RC) from your hand" | Tommy |
| `enter(RC, self, from=drop)` | This card is placed on RC from the drop zone | "When this unit is placed on (RC) from your drop zone" | Skeleton Cannoneer, King Serpent, Mick |
| `enter(RC, other-own, from=drop)` | Another of our units is placed on RC from the drop zone | "When your unit is placed on another (RC) from your drop zone" | Nightrose (Starlight) |
| `enter(VC, self)` | This card is placed on VC (ride or stride) | "When this unit is placed on (VC)" | Nightstorm, Obadiah, Immortal Galleon, Megiddo |
| `enter(GC, self)` | This card is placed on GC (from anywhere) | "When this unit is placed on (GC)" | Gust Jinn (BT02), Chappie, Negrolily, Negronora, Agleam, Deep Corpse Dragon |
| `enter(GC, self, from=hand)` | This card is placed on GC from hand | "When this unit is placed on (GC) from your hand" | Waterspout Djinn |
| `stride(own)` | We stride | "When your G unit strides" / "When you stride a G unit" | Nightrose (Night Fog), Nightrose (Starlight) |
| `attack(self)` | This card attacks (any target) | "When this unit attacks" | Negrorook |
| `attack(self, target=VC)` | This card attacks a vanguard | "When this unit attacks a vanguard" | Zombie Whale |
| `attack(own-VC)` | Our vanguard attacks | "When your vanguard attacks" | Rampage Shade |
| `battle-end(self, did=attack-VC)` | End of a battle in which this card attacked a vanguard | "At the end of the battle that this unit attacked a vanguard" | Nightstorm |
| `battle-end(self, did=attack)` | End of a battle in which this card attacked | "At the end of the battle that this unit attacked" | The ability Megiddo grants |
| `battle-end(self, did=boost-RC)` | End of a battle in which this card boosted a rear-guard | "At the end of the battle that this unit boosted a rear-guard" | Negrobone |
| `to-drop(own, from=RC)` | Any of our rear-guards is put into the drop zone | "When your rear-guard is put into the drop zone" | Nightrose (Night Fog) |
| `to-drop(self, from=RC, by=hollow)` | This card goes from RC to the drop zone because of Hollow | "When this unit is put into your drop zone from (RC) by the Hollow ability" | Grenache, the ability Negrolazy grants |
| `retired(self, from=RC)` | This card is retired from RC | "When this unit is retired from (RC)" | The ability Mick grants |
| `discarded(self, from=hand, as=g-guardian-cost)` | This card is discarded from hand to pay a G guardian call | "When this card is discarded from hand for the cost of calling a G GUARDIAN" | Dewey the Ghostie |
| `phase-start(battle, own)` | Start of our battle phase | "At the beginning of your battle phase" | Nightrose (G unit) |
| `turn-end` | End of the turn | "At the end of the turn" | The Hollow keyword, Immortal Galleon |
| `ridden-upon(self)` | A card rides on this card | (in the Forerunner keyword) | The Forerunner keyword |
| `to-drop(self, from=soul)` | This card goes from the soul to the drop zone (e.g. paid as Soul Blast) | "When this card is put into the drop zone from your soul" | Norn, Achlis, Genil, Jotun |
| `to-soul(own)` | Cards are put into our soul (once per effect, however many cards; also riding) | "When your card is put into your soul" | The ability Verthandi grants |
| `attack-hit(self, target=VC)` | This unit's attack hits a vanguard | "When this unit's attack hits a vanguard" | The ability Verthandi grants |
| `stride(own, filter=…)` | We stride a G unit matching the filter (in its original card name) | "When your G unit with \"Regalia\" in its original card name strides" | Angelica, Verthandi |
| `attack(own-VC, filter=…)` | Our vanguard matching the filter attacks | "When your vanguard with \"Regalia\" in its card name attacks" | Freyja |
| `step(stride, own)` | Our stride step (timing of STRIDE and ULTIMATE STRIDE) | "-Stride Step-" | Every G unit |
| `step(guard, opp)` | The guard step of the opponent's turn (timing of G GUARDIAN) | "-During the guard step of your opponent's turn-" | Every G guardian |

## 2. Conditions

| Code | Meaning | Cards |
|---|---|---|
| `GB(n)` | Generation Break n | Many |
| `1/turn` | Once per turn | Nightrose (Night Fog), Nightrose (Starlight), Nightrose (G unit) |
| `own-turn` | Only during our turn ("during your turn") | Nightrose (Night Fog), Nightrose (Starlight) |
| `self-hollowed` | This card is hollowed | Nightstorm, Zombie Whale, Skeleton Cannoneer, Negrorook, Mick |
| `vc-name("Nightrose")` | Our vanguard has "Nightrose" in its name | Negrolazy, Negrobone |
| `vc-name("Nightrose") & vc-grade≥3` | Our vanguard is grade 3 or higher with "Nightrose" in its name | Rampage Shade |
| `vc-clan(Granblue)` | Our vanguard is Granblue | Rough Seas Banshee |
| `drop-count≤5` | Our drop zone has 5 or fewer cards | Zombie Whale (CONT Power reduction) |
| `name-in-drop("Waterspout Djinn")` | A card with this name is in the drop zone | Waterspout Djinn |
| `attack-count≥5` | The 5th or later attack of the turn | Honoly |
| `while(stride-cost)` | While paying the stride cost | Tommy, Flap Angel |
| `heart-name("Regalia")` | Our heart card has this word in its name | Urth |
| `G-faceup≥n`, `G-faceup(filter)≥n` | n or more face-up cards (matching the filter) in our G zone | Kukurihime, Urth |
| `souled≥n`, `souled-name("Regalia")` | This effect put n or more cards / a card with this word into the soul | Eir (G guardian), Iris, Angelica, Daylight Angel |
| `returned≥n` | This effect returned n or more cards to the deck | Dreaming Dragon |
| `called≥3` | This effect called 3 or more cards | Nightrose (G unit) |
| `hollow-milled≥2` | This effect put 2 or more cards with Hollow into the drop zone | Obadiah |
| `called-has-hollow` | The called card has the Hollow ability | Nightrose (Starlight) |
| `vc-grade=3 & G-faceup=0 & opp-vc-grade=2 & opp-no-ride-last-turn` | A special stride condition (written out in full in the card text) | Sebreeze |

## 3. Costs

| Code | Meaning | Cards |
|---|---|---|
| `CB(n)` | Counter Blast n | Many |
| `SB(n)` | Soul Blast n | Nightrose (Starlight), Nightstorm, Negrolazy, Negronora |
| `SB(n, filter)` | Soul Blast only cards matching the filter | Minerva, Verthandi |
| `to-deck-top(self)` | Put this unit on the top of the deck | Dreaming Dragon |
| `discard(n, filter)` | Discard cards from hand matching the card's condition | Gust Jinn, Waterspout Djinn, Sebreeze, Agleam, STRIDE, G GUARDIAN |
| `mill(n)` | Put the top cards of the deck into the drop zone | Nightrose (Night Fog) (3), Deep Corpse Dragon (2) |
| `reveal(filter)` | Reveal a card from hand | Tommy (grade 3) |
| `retire-own(n)` | Retire our rear-guards | Negrolily |
| `soul-in(self)` | Put this card into the soul | Rough Seas Banshee, Rampage Shade |
| `bind(filter)` | Bind cards face up | Dewey the Ghostie, Eir (Heal) (this card + another Heal trigger from the drop zone), Jotun (`bind(self)`) |
| `flip-G-up(filter)` | Flip a face-down card in the G zone face up | Negronora (G GUARDIAN), the Nightrose G unit (same name as this card) |

## 4. Effects

| Code | Meaning | Cards |
|---|---|---|
| `call(drop→RC, n, filter)` | Call from the drop zone to RC | Nightrose (Night Fog), Nightrose (Starlight), Nightstorm, Negrolazy, Negrobone, Negrolily, Obadiah, Nightrose (G unit), Immortal Galleon |
| ↳ `to=` allowed circles | Unset = any RC (an occupied one is called over) · `empty` = an RC with no unit · `not-self` = an RC without this unit · `different` = a different circle from cards already called by this effect · `same-column` = the same column as this unit | Negrolily (`empty`), Nightstorm (`not-self`), Nightrose (G unit) (`different`), Obadiah (`same-column`) |
| `call(hand+drop→RC, n)` | Call from hand and the drop zone combined to RC | Megiddo (≤5) |
| `call(drop→GC, n, filter)` | Call from the drop zone to GC | Negronora (2 cards of different grades) |
| `mill(n)` | Put the top cards of the deck into the drop zone (as an effect) | Nightrose (Starlight) (≤3) |
| `search(deck→drop, n, filter)` | Search the deck and put cards into the drop zone | Obadiah (≤3), Chappie (≤1 Granblue) |
| `search(deck→hand, n, filter)` | Search the deck and add cards to hand | Tommy (grade 3 "Nightrose"), Nightstorm (look at the top 5, take a card with Hollow) |
| `draw(n)` | Draw cards | Skeleton Cannoneer, Rampage Shade, Agleam, Rough Seas Banshee |
| `retire(opp-RC, n)` | Retire the opponent's rear-guards | Skeleton Cannoneer |
| `retire(own, target)` | Retire our unit (as an effect) | Negrobone (the boosted unit) |
| `power(±X, target, until)` | Raise/lower Power | Many |
| `shield(+X, self)` | Raise Shield | Negrolily (+10000), Deep Corpse Dragon (+5000) |
| `critical(+n, target)` | Raise Critical | Nightrose (G unit) |
| `no-hit(target)` | The target unit can't be hit until the end of the battle | Gust Jinn, Waterspout Djinn |
| `CC(n)` | Counter Charge | Waterspout Djinn, Grenache, Dewey, King Serpent, the ability Negrolazy grants |
| `SC(n)` | Soul Charge | King Serpent, Dewey, the ability Negrolazy grants |
| `damage-facedown(n)` | Flip face-up damage face down (as an effect, not a cost) | Honoly |
| `hollow(target)` | Make a unit hollowed | The Hollow keyword, Nightrose (G unit) calls units hollowed |
| `grant(ability, target, until)` | Give a unit an ability | Negrolazy, Mick, Megiddo |
| `return-to-deck(self)` | Return this card to the deck and shuffle | The ability Mick grants |
| `swap(self, other-own-RC)` | Swap unit positions | The ability Megiddo grants |
| `grade(+n, self)` | Change the grade | Tommy (+2 while paying the stride cost) |
| `attack-tax(CB(1), RC)` | Rear-guards must pay a cost before attacking a vanguard | Honoly |
| `stride-from-G(self)` | Stride from the G zone in a special way | Sebreeze |
| `remove-G-zone(own)` | Remove our whole G zone from the game | Megiddo (ultimate stride) |
| `all-clan(self)` | Counts as every clan and nation | Honoly, Agleam, Sebreeze |
| `stride(self)` | Stride this card onto VC (the STRIDE effect) | Every G unit |
| `call(G→GC, self)` | Call this card from the G zone to GC (the G GUARDIAN effect) | Every G guardian |
| `call(self→RC)` | Call this card to RC (the Forerunner effect) | Grenache |
| `discard(n)` | Discard cards from hand (as an effect, not a cost) | Tommy |
| `choose(A, B)` | Choose one of the effects | Dewey (CC1 or SC1), the ability Negrolazy grants (CC1 / SC1) |
| `keyword(name)` | A keyword with no in-game effect, only a deck building rule | `keyword(Sentinel)` (Gust Jinn, Waterspout Djinn, Jotun); `keyword(Revelation)` (Inanna, placeholder: the card doesn't define it) |
| `to-soul(from, n, filter)` | Put cards from a zone into our soul (`all` = every matching card) | Hemera, Freyja, Bragi, Angelica, Urth, Eir (G guardian), Iris; `to-soul(self, at=battle-end)` Genil |
| `look(n, hand=k, soul=k, rest=drop)`, `soul=n≤k` = up to k | Look at / reveal the top n cards, pick some for hand, then for soul; `rest=drop` puts the others into the drop zone | Angelica, Daylight Angel, the ability Verthandi grants |
| `to-hand(from, n, filter)` | Return cards from a zone to hand | Jotun |
| `to-deck(from, n, filter)` | Return cards from a zone to the deck | Laurier, Dreaming Dragon |
| `shuffle(deck)` | Shuffle the deck | Laurier, Dreaming Dragon |
| `stand(own, filter)` | Stand our units | Minerva |
| `drive(±n, target)` | Change drive | Minerva |
| `opp-retires(opp-RC, n)` | The opponent chooses and retires their own rear-guards | Inanna |
| `power(+X per souled, target)` | Power for each card this effect put into the soul | Bragi |

### Helpers in filter and n

| Code | Meaning | Example |
|---|---|---|
| `name("word")` | Cards with this word in their name | `filter=grade-3 & name("Nightrose")` |
| `count-in-drop(filter)` | Number of drop zone cards matching the filter | `n=count-in-drop(name("Nightrose"))` |
| `if=condition` | The effect happens only if the condition is true | `draw(1, if=self-hollowed)` |
| `until=` | Effect duration: `battle-end` end of battle, `turn-end` end of turn | `power(+2000, self, until=turn-end)` |
| `at=` | The effect happens later, at the given timing | `retire(self, at=turn-end)` |

---

## 5. Effects that open another card's timing (the core of combo search)

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
