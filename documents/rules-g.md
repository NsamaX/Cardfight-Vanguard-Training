# G-era rules

The rules the program implements, and the reference for writing card ability code. For when abilities resolve during each part of a turn, see [timing-g.md](timing-g.md).

## Abbreviations

| Abbreviation | Full name | Meaning |
|---|---|---|
| VC | Vanguard Circle | The vanguard's circle (center of the front row) |
| RC | Rear-guard Circle | A rear-guard circle |
| GC | Guardian Circle | The guardian circle |
| CB | Counter Blast | Flip that many face-up damage cards face down |
| CC | Counter Charge | Flip that many face-down damage cards face up |
| SB | Soul Blast | Put that many cards from the soul into the drop zone |
| SC | Soul Charge | Put that many cards from the top of the deck into the soul |
| GB | Generation Break | See Generation Break below |

## Deck building

- **Main deck:** 50 cards, including exactly 16 trigger units. At most 4 cards with the same name (counted together even with different card codes).
- **Heal triggers:** at most 4.
- **Sentinels:** at most 4 cards with the Sentinel keyword in total (per the card text).
- **G zone:** at most 16 G units, separate from the main deck, placed face down before the game. At most 4 G units with the same name. G units can't go in the main deck.
- **G guardians:** any number in the G zone (within its 16 cards), but one can only be called while there are 3 or fewer face-up G guardians in the G zone.

## Game setup

- Place a grade 0 vanguard face down on VC.
- Draw 5 cards, then mulligan once.
- At the start of the game, both grade 0 vanguards are flipped face up together.
- On the first turn, the first player draws but can't attack.

## Winning and losing

- A player with 6 damage loses.
- A player whose deck reaches 0 cards loses immediately, even before needing to draw.

## Phases of a turn

1. **Stand phase:** stand all of your rested units.
2. **Draw phase:** draw 1 card, then the G assist step.
   - **G assist:** if your vanguard is below grade 3 and your hand has no unit one grade above it, you may: reveal your hand to the opponent, look at the top 5 cards of your deck, add up to 1 unit of that grade to hand, then shuffle. If you added a card, choose 2 cards from your hand and remove them from the game.
3. **Ride phase:** two steps.
   - **Ride step:** ride a card from hand of the same grade or one grade higher on top of your vanguard, once. The old card goes to the soul.
   - **Stride step:** see Stride.
4. **Main phase:** call units from hand to RC, use ACT abilities, and move rear-guards between the front and back row in the same column.
5. **Battle phase:** see Battle.
6. **End phase:** the strode G unit returns to the G zone, and "until end of turn" effects end.

## Stride

- **Condition:** both players' vanguards are grade 3 or higher.
- **Cost:** discard 1 or more cards from hand with a total grade of 3 or more, e.g. one grade 3, grade 2+1, or three grade 1s.
- **How:** choose 1 face-down G unit in the G zone and put it face up on top of your vanguard, standing or rested like the old vanguard.
- **Allowed on the turn you rode grade 3:** striding doesn't count as a ride.
- **Heart:** the old vanguard under the G unit is the heart.
  - The G unit gets the heart's name and Power, e.g. a card printed 15000+ has Power = 15000 + the heart's Power.
  - The heart's abilities don't work while it's the heart.
  - The heart can't be used for an SB cost.
- **At end of turn:** the G unit returns to the G zone face up, and the heart becomes the vanguard again.
  - A face-up G unit in the G zone can't stride again for the rest of the game.
- **Drive:** G units have Triple Drive (3 drive checks).

## Generation Break (GB)

**GB X** is active while you have X or more face-up G units on VC and in your G zone combined (per the card text).

## G GUARDIAN

- **Conditions:**
  - Both players' vanguards are grade 3 or higher.
  - You have 3 or fewer face-up G guardians in your G zone.
- **Timing:** the guard step of the opponent's turn.
- **Cost:** discard 1 card with the Heal icon from hand.
- **Effect:** call the G guardian from face down in the G zone to GC, with Shield 15000.
- **After the battle:** the G guardian returns to the G zone face up instead of going to the drop zone.

## ULTIMATE STRIDE

- **Usable when:** you have 3 or more face-up cards in the G zone.
- **Cost:** discard 1 card from hand with the same name as your vanguard, then stride.
- **When it returns to the G zone:** remove your whole G zone from the game.
- **Zeroth Dragons:** can ultimate stride onto any clan of their own nation, e.g. Megiddo works with Granblue because both are Megalaricca.

The text about returning to the G zone is only partly legible on the card.

## Battle (battle phase)

- **Attack:** a standing front-row unit rests to attack an opponent's front-row unit.
- **Boost:** a grade 0 or 1 in the back-row RC directly behind rests to add its Power to the attacker.
- **Guard:** the attacked player calls cards from hand to GC to add Shield.
  - Grade 0: Shield 10000
  - Grades 1 and 2: Shield 5000
  - Sentinels: Shield 0 (as printed on the card)
  - Grade 3: no Shield
- **Intercept:** a grade 2 in a front-row RC can move to GC.
- **Resolution:** if the attacker's Power is greater than or equal to the defender's Power + Shield, it hits.
  - Hitting the vanguard: the defender does damage checks equal to the attacker's Critical.
  - Hitting a rear-guard: that rear-guard is retired.
- **Drive check:** an attacking vanguard reveals the top card of the deck and adds it to hand.
  - Twin Drive (grade 3): twice.
  - Triple Drive (G units): three times.
- **Triggers:** a trigger revealed in a drive check or damage check gives one unit Power+5000 plus its own effect.
  - Critical: Critical+1
  - Stand: stand 1 rear-guard
  - Heal: if your damage is greater than or equal to the opponent's, heal 1 damage
  - Draw: draw 1 card

## Keywords in this library

| Keyword | Meaning |
|---|---|
| Hollow | When the unit is placed on RC, you may make it hollowed. If you do, it is retired at the end of the turn (per the card text). |
| Sentinel | At most 4 per deck. Usually used to make an attack not hit. |
| Forerunner | When a unit of the same clan rides on this card, you may call this card to RC. |
| This card is from all clans and nations | Cray Elemental cards count as every clan and nation and fit in any deck. |
