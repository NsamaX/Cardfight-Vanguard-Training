# G-era timing map

When during a turn each timing code in [vocabulary.md](vocabulary.md) happens, and which library cards act at that point. Use together with the rules in [rules-g.md](rules-g.md).

## How AUTO abilities work

- **Standby:** when an AUTO's condition happens, the ability goes into standby. If the condition happens several times, it goes into standby that many times.
- **Check timing:** abilities in standby resolve at check timing. Each player chooses the order of their own standby abilities and resolves them one at a time until none are left.
- **Who goes first:** the turn player resolves their abilities first, then the other player.
  - On attack: the attacker resolves "when it attacks" AUTO abilities first, then the defender resolves "when it is attacked" ones. If the attacker has none, the defender goes right away.
  - End phase: the turn player goes first.
- **Abilities triggered along the way:** a new AUTO that enters standby while another one is resolving waits for the same check timing, after the current one finishes.
- **The heart has no abilities:** while striding, the old grade 3 vanguard becomes the heart, so its (VC) abilities don't work until the G unit returns to the G zone.

---

## Order of a turn

### 1. Stand phase and 2. Draw phase

No library card acts in these phases. After the draw, the program asks whether to use G assist (when its conditions are met, see [rules-g.md](rules-g.md)).

### 3. Ride phase

| Step | What happens | Timing code | Cards that act |
|---|---|---|---|
| Ride step | Ride onto the vanguard | `ridden-upon(self)`, `enter(VC, self)` | Grenache, Daylight Angel (Forerunner), Nightstorm, Angelica |
| Stride step | Discard cards as the cost, then put a G unit on the vanguard | `step(stride, own)` | Every G unit, Tommy, Flap Angel (+2 grade when paying the cost) |
| | After striding | `stride(own)` | Nightrose (Night Fog), Nightrose (Starlight), Angelica, Verthandi |
| | The G unit is placed on VC | `enter(VC, self)` | Obadiah, Immortal Galleon, Megiddo, Urth |

### 4. Main phase

| What happens | Timing code | Cards that act |
|---|---|---|
| Call a unit from hand to RC | `enter(RC, self)`, `enter(RC, self, from=hand)` | Tommy, Negrolazy, Honoly, every Hollow card, Hemera, Freyja, Bragi, Flap Angel |
| Call from the drop zone by a card effect | `enter(RC, self, from=drop)`, `enter(RC, other-own, from=drop)` | Skeleton Cannoneer, King Serpent, Mick, Nightrose (Starlight) |
| Use an ACT | (no timing, used by choice) | Nightrose (G unit), Minerva, Inanna, Verthandi, Daylight Angel, Kukurihime |
| A card goes from the soul to the drop zone (Soul Blast, during either turn) | `to-drop(self, from=soul)` | Norn, Achlis, Genil and Jotun (during your turn) |

### 5. Battle phase

| Step | What happens | Timing code | Cards that act |
|---|---|---|---|
| Start of battle phase | | `phase-start(battle, own)` | Nightrose (G unit) counts "Nightrose" in the drop zone |
| Attack step | Declare the attack and boost | `attack(self)`, `attack(self, target=VC)`, `attack(own-VC)` | Negrorook, Zombie Whale, Rampage Shade, Minerva, Genil, Freyja |
| Guard step | The defender calls guards to GC, intercepts, calls G guardians | `step(guard, opp)`, `enter(GC, self)`, `discarded(self, as=g-guardian-cost)` | Every G guardian, Gust Jinn, Waterspout Djinn, Jotun, Chappie, Dewey, Eir (Heal) |
| Drive step | Drive checks (attacking vanguard only) | (trigger effects) | — |
| Damage step | Resolve the hit, damage checks, retire a hit rear-guard | `retired(…, from=RC)`, `to-drop(own, from=RC)` (attacked side) | Nightrose (Night Fog) on the opponent's turn |
| Damage step | A hit on the vanguard | `attack-hit(self, target=VC)` | The ability Verthandi grants |
| Close step | End of battle, G guardians return to the G zone, "until end of battle" effects expire | `battle-end(…)` | Nightstorm, Negrobone, the ability Megiddo grants, Minerva (stand), Genil (into soul) |

When a rear-guard attacks, after the defender's guard step the game skips the drive step and goes straight to the damage step.

### 6. End phase

| What happens | Timing code | Cards that act |
|---|---|---|
| 1. The G unit returns to the G zone face up, the heart becomes the vanguard again | — | Raises the GB count, and the grade 3 vanguard's (VC) abilities work again |
| 2. "At the end of the turn" AUTO abilities go into standby, then resolve at check timing (turn player first) | `turn-end` | Every Hollow card, units called by Immortal Galleon, Dreaming Dragon |
| 3. The retires from step 2 cause further events | `retired(self, from=RC)`, `to-drop(self, from=RC, by=hollow)`, `to-drop(own, from=RC)` | Mick (granted ability), Grenache, Negrolazy (granted ability), Nightrose (Night Fog) |
| After every check timing process ends, "until end of turn" effects expire | — | — |
| When nothing is left to do, the turn changes | — | — |

---

## Notes for building combos with this library

1. **Nightrose (Night Fog) doesn't work while striding, but works again in the end phase**
   - Its (VC) ability "when your rear-guard is put into the drop zone" only works while it really is the vanguard.
   - In the end phase the G unit returns to the G zone first, and only then does Hollow retire, so Nightrose is the vanguard again in time. The Hollow → Nightrose (Night Fog) loop works even on a turn you strode.
   - A unit called by Immortal Galleon and retired at the end of the turn chains into Nightrose too (but 1/Turn calls back only one card).
   - The ability has no "during your turn" condition, so it works on the opponent's turn as well, e.g. when our rear-guard is hit and retired, it can be called back right away.
2. **Hollow is optional**
   - The card says "you **may** make this unit hollowed", so a called-back unit doesn't have to become hollowed and stays on the board.
   - Typical play: a unit is retired by Hollow, then called back without choosing Hollow.
   - Trade-off: some cards get an extra effect only while hollowed, e.g. Skeleton Cannoneer draws a card if hollowed. You choose between that effect and keeping the unit on the board.
3. **Fill the drop zone before the battle phase**
   - Nightrose (G unit) counts cards named "Nightrose" in the drop zone at the start of the battle phase.
   - Effects that send cards to the drop zone must happen in the stride step or main phase, e.g. Nightrose (Starlight)'s `mill(≤3)`, Obadiah's `search(deck→drop)`, a STRIDE cost that discards a Nightrose from hand.
4. **"During your turn" abilities**
   - With this condition: Nightrose (Night Fog)'s 2nd ability (when striding), and Nightrose (Starlight)'s 2nd and 3rd abilities.
   - Nightrose (Starlight)'s 2nd ability (when another unit enters RC from the drop zone) works as both vanguard and rear-guard (VC/RC). Placed on RC, it avoids the heart problem.
5. **When GB goes up**
   - Immediately: the `flip-G-up` cost of Negronora and Nightrose (G unit).
   - During the opponent's turn: a G guardian returns to the G zone after the battle.
   - At the end of our turn: the strode G unit returns to the G zone.
6. **1/Turn keeps loops finite:** Nightrose (Night Fog) calls back a unit only once per turn, so the end-phase Hollow loop stops by itself.
