# รายการรหัสมาตรฐาน

รหัสกลางสำหรับเขียนความสามารถของการ์ดให้เป็นแบบเดียวกัน ไม่ว่าคำแปลบนการ์ดจะเขียนต่างกันแค่ไหน ข้อความจริงบนการ์ดยังเก็บไว้ในช่อง **ผล** ตามเดิม ส่วนรหัสในไฟล์นี้ใช้สำหรับค้นหาและจับคู่คอมโบ

รายการนี้ตั้งจากการ์ด 28 ไฟล์ในคลังตอนนี้ (ภาค G) ถ้าการ์ดใหม่มีเหตุการณ์หรือผลที่ยังไม่มีรหัส ให้เพิ่มรหัสในไฟล์นี้ก่อนใช้

## รูปแบบการเขียน

```
ชื่อรหัส(ค่าหลัก, ชื่อพารามิเตอร์=ค่า)
```

| ค่าที่ใช้บ่อย | ความหมาย |
|---|---|
| `self` | การ์ดใบนี้เอง |
| `other-own` | ยูนิทใบอื่นของเรา |
| `own-VC` | แวนการ์ดของเรา |
| `opp` | ฝ่ายคู่แข่ง |
| `VC` / `RC` / `GC` | ช่องบนสนาม |
| `hand` / `drop` / `deck` / `soul` / `damage` / `G` | มือ / ดรอปโซน / กองการ์ด / โซล / ดาเมจโซน / G โซน |
| `n` | จำนวน ใช้ `≤` ถ้าการ์ดเขียนว่า "ไม่เกิน" |

---

## 1. จังหวะ (เหตุการณ์ที่ทำให้ AUTO ทำงาน)

| รหัส | ความหมาย | ถ้อยคำบนการ์ด | การ์ดที่ใช้ |
|---|---|---|---|
| `enter(RC, self)` | ใบนี้เข้าสู่ RC (จากที่ไหนก็ได้) | "เมื่อยูนิทนี้เข้าสู่ช่อง (RC)" | Negrolazy, Honoly, คีย์เวิร์ดฮอลโล่ว์ |
| `enter(RC, self, from=hand)` | ใบนี้เข้าสู่ RC จากมือ | "เมื่อยูนิทนี้เข้าสู่ช่อง (RC) จากมือคุณ" | Tommy |
| `enter(RC, self, from=drop)` | ใบนี้เข้าสู่ RC จากดรอปโซน | "เมื่อยูนิทนี้เข้าสู่ช่อง (RC) จากดรอปโซนคุณ" | Skeleton Cannoneer, King Serpent, Mick |
| `enter(RC, other-own, from=drop)` | ยูนิทใบอื่นของเราเข้าสู่ RC จากดรอปโซน | "เมื่อยูนิทคุณเข้าสู่ช่อง (RC) ช่องอื่นจากดรอปโซน" | Nightrose (Starlight) |
| `enter(VC, self)` | ใบนี้เข้าสู่ VC (ไรด์หรือสไตรด์) | "เมื่อยูนิทนี้เข้าสู่ช่อง (VC)" | Nightstorm, Obadiah, Immortal Galleon, Megiddo |
| `enter(GC, self)` | ใบนี้เข้าสู่ GC (จากที่ไหนก็ได้) | "เมื่อยูนิทนี้**ลง**ช่อง (GC)" / "เมื่อยูนิทนี้**เข้าสู่**ช่อง (GC)" | จิน BT02, Chappie, Negrolily, Negronora, Agleam, Deep Corpse Dragon |
| `enter(GC, self, from=hand)` | ใบนี้เข้าสู่ GC จากมือ | "เมื่อยูนิทนี้เข้าสู่ช่อง (GC) จากมือคุณ" | Waterspout Djinn |
| `stride(own)` | เราทำการสไตรด์ | "เมื่อ G ยูนิทคุณทำการ STRIDE" / "เมื่อคุณทำการ STRIDE G ยูนิท" | Nightrose (Night Fog), Nightrose (Starlight) |
| `attack(self)` | ใบนี้โจมตี (เป้าหมายอะไรก็ได้) | "เมื่อยูนิทนี้โจมตี" | Negrorook |
| `attack(self, target=VC)` | ใบนี้โจมตีแวนการ์ด | "เมื่อยูนิทนี้โจมตีแวนการ์ด" | Zombie Whale |
| `attack(own-VC)` | แวนการ์ดของเราโจมตี | "เมื่อแวนการ์ดของคุณโจมตี" | Rampage Shade |
| `battle-end(self, did=attack-VC)` | จบการต่อสู้ที่ใบนี้โจมตีแวนการ์ด | "เมื่อจบการต่อสู้ที่ยูนิทนี้โจมตีแวนการ์ด" | Nightstorm |
| `battle-end(self, did=attack)` | จบการต่อสู้ที่ใบนี้โจมตี | "เมื่อจบการต่อสู้ที่ยูนิทนี้โจมตี" | ความสามารถที่Megiddoมอบให้ |
| `battle-end(self, did=boost-RC)` | จบการต่อสู้ที่ใบนี้บูสท์ให้เรียร์การ์ด | "เมื่อจบการต่อสู้ที่ยูนิทนี้ทำการบูสท์ให้เรียร์การ์ด" | Negrobone |
| `to-drop(own, from=RC)` | เรียร์การ์ดของเราใบไหนก็ได้ตกลงดรอปโซน | "เมื่อเรียร์การ์ดของคุณตกลงดรอปโซน" | Nightrose (Night Fog) |
| `to-drop(self, from=RC, by=hollow)` | ใบนี้ตกจาก RC ลงดรอปโซนเพราะฮอลโล่ว์ | "เมื่อยูนิทนี้ตกลงช่องดรอปโซนคุณจากช่อง (RC) ด้วย/โดยความสามารถฮอลโล่ว์" | Grenache, ความสามารถที่Negrolazyมอบให้ |
| `retired(self, from=RC)` | ใบนี้ถูกรีไทร์จาก RC | "เมื่อยูนิทนี้ถูกรีไทร์จากช่อง (RC)" | ความสามารถที่Mick มอบให้ |
| `discarded(self, from=hand, as=g-guardian-cost)` | ใบนี้ถูกทิ้งจากมือเป็นคอสต์คอล G การ์เดี้ยน | "เมื่อการ์ดใบนี้ถูกทิ้งจากบนมือเพื่อเป็นคอสต์ของการคอล G GUARDIAN" | Dewey the Ghostie |
| `phase-start(battle, own)` | เริ่มแบทเทิลเฟสของเรา | "เมื่อเริ่มต้นช่วงแบทเทิลเฟสคุณ" | Nightrose (G unit) |
| `turn-end` | จบเทิร์น | "เมื่อจบเทิร์น" | คีย์เวิร์ดฮอลโล่ว์, Immortal Galleon |
| `ridden-upon(self)` | มีการ์ดไรด์ทับใบนี้ | (ในคีย์เวิร์ดผู้เริ่มต้น) | คีย์เวิร์ดผู้เริ่มต้น |
| `step(stride, own)` | สไตรด์สเต็ปของเรา (จังหวะของ STRIDE และ ULTIMATE STRIDE) | "-สไตรด์สเต็ป-" | G ยูนิททุกใบ |
| `step(guard, opp)` | การ์ดสเต็ปของเทิร์นคู่แข่ง (จังหวะของ G GUARDIAN) | "-ในช่วงการ์ดสเต็ปของเทิร์นคู่แข่ง-" | G การ์เดี้ยนทุกใบ |

## 2. เงื่อนไข

| รหัส | ความหมาย | การ์ดที่ใช้ |
|---|---|---|
| `GB(n)` | Generation Break n | หลายใบ |
| `1/turn` | ใช้ได้ 1 ครั้งต่อเทิร์น | Nightrose (Night Fog), Nightrose (Starlight), Nightrose (G unit) |
| `own-turn` | เฉพาะในเทิร์นเรา ("ในเทิร์นคุณ") | Nightrose (Night Fog), Nightrose (Starlight) |
| `self-hollowed` | ใบนี้ติดสถานะฮอลโล่ว์อยู่ | Nightstorm, Zombie Whale, Skeleton Cannoneer, Negrorook, Mick |
| `vc-name("Nightrose")` | แวนการ์ดเรามีคำว่า "Nightrose" ในชื่อ | Negrolazy, Negrobone |
| `vc-name("Nightrose") & vc-grade≥3` | แวนการ์ดเราเป็นเกรด 3 ขึ้นไปและมีคำว่า "Nightrose" ในชื่อ | Rampage Shade |
| `vc-clan(Granblue)` | แวนการ์ดเราเป็นแคลนGranblue | Rough Seas Banshee |
| `drop-count≤5` | ดรอปโซนเรามี 5 ใบหรือน้อยกว่า | Zombie Whale (CONT ลด Power) |
| `name-in-drop("Waterspout Djinn")` | มีการ์ดชื่อนี้ในดรอปโซน | Waterspout Djinn |
| `attack-count≥5` | การโจมตีครั้งที่ 5 ขึ้นไปของเทิร์น | Honoly |
| `while(stride-cost)` | ขณะจ่ายคอสต์สไตรด์ | Tommy |
| `called≥3` | คอลการ์ดจากผลนี้ได้ 3 ใบขึ้นไป | Nightrose (G unit) |
| `hollow-milled≥2` | การ์ดที่มีฮอลโล่ว์ตกดรอปโซนจากผลนี้ 2 ใบขึ้นไป | Obadiah |
| `called-has-hollow` | การ์ดที่คอลมามีความสามารถฮอลโล่ว์ | Nightrose (Starlight) |
| `vc-grade=3 & G-faceup=0 & opp-vc-grade=2 & opp-no-ride-last-turn` | เงื่อนไขสไตรด์พิเศษ (การ์ดเขียนไว้ครบในช่อง ผล) | Sebreeze |

## 3. คอสต์

| รหัส | ความหมาย | การ์ดที่ใช้ |
|---|---|---|
| `CB(n)` | Counter Blast n | หลายใบ |
| `SB(n)` | Soul Blast n | Nightrose (Starlight), Nightstorm, Negrolazy, Negronora |
| `discard(n, filter)` | ทิ้งการ์ดจากมือ ตามเงื่อนไขของการ์ดนั้น | Gust Jinn, Waterspout Djinn, Sebreeze, Agleam, STRIDE, G GUARDIAN |
| `mill(n)` | ส่งการ์ดบนสุดของกองการ์ดลงดรอปโซน | Nightrose (Night Fog) (3), Deep Corpse Dragon (2) |
| `reveal(filter)` | แสดงการ์ดจากมือ | Tommy (เกรด 3) |
| `retire-own(n)` | รีไทร์เรียร์การ์ดของเรา | Negrolily |
| `soul-in(self)` | นำใบนี้เข้าโซล | Rough Seas Banshee, Rampage Shade |
| `bind(filter)` | ไบนด์การ์ดแบบหงายหน้า | Dewey the Ghostie (ใบนี้ + Heal Trigger อีกใบจากดรอปโซน) |
| `flip-G-up(filter)` | หงายการ์ดที่คว่ำอยู่ใน G โซน | Negronora (G GUARDIAN), Nightrose G ยูนิท (ชื่อเดียวกับใบนี้) |

## 4. ผล

| รหัส | ความหมาย | การ์ดที่ใช้ |
|---|---|---|
| `call(drop→RC, n, filter)` | คอลจากดรอปโซนลง RC | Nightrose (Night Fog), Nightrose (Starlight), Nightstorm, Negrolazy, Negrobone, Negrolily, Obadiah, Nightrose (G unit), Immortal Galleon |
| ↳ `to=` ช่องที่คอลลงได้ | ไม่ระบุ = RC ไหนก็ได้ (มียูนิทอยู่ = คอลทับ) · `empty` = RC ที่ไม่มียูนิทอยู่ · `not-self` = RC ที่ไม่มียูนิทนี้อยู่ · `different` = คนละช่องกับใบที่คอลไปแล้วในผลนี้ · `same-column` = แนวเดียวกับยูนิทนี้ | Negrolily (`empty`), Nightstorm (`not-self`), Nightrose (G unit) (`different`), Obadiah (`same-column`) |
| `call(hand+drop→RC, n)` | คอลจากมือและดรอปโซนรวมกันลง RC | Megiddo (≤5) |
| `call(drop→GC, n, filter)` | คอลจากดรอปโซนลง GC | Negronora (2 ใบเกรดต่างกัน) |
| `mill(n)` | ส่งการ์ดบนสุดของกองการ์ดลงดรอปโซน (ในฐานะผล) | Nightrose (Starlight) (≤3) |
| `search(deck→drop, n, filter)` | ค้นกองการ์ดแล้วส่งลงดรอปโซน | Obadiah (≤3), Chappie (≤1 Granblue) |
| `search(deck→hand, n, filter)` | ค้นกองการ์ดขึ้นมือ | Tommy (เกรด 3 "Nightrose"), Nightstorm (ดู 5 ใบบนสุด เอาการ์ดที่มีฮอลโล่ว์) |
| `draw(n)` | จั่วการ์ด | Skeleton Cannoneer, Rampage Shade, Agleam, Rough Seas Banshee |
| `retire(opp-RC, n)` | รีไทร์เรียร์การ์ดคู่แข่ง | Skeleton Cannoneer |
| `retire(own, target)` | รีไทร์ยูนิทของเรา (ในฐานะผล) | Negrobone (ยูนิทที่ถูกบูสท์) |
| `power(±X, target, until)` | เพิ่ม/ลด Power | หลายใบ |
| `shield(+X, self)` | เพิ่ม Shield | Negrolily (+10000), Deep Corpse Dragon (+5000) |
| `critical(+n, target)` | เพิ่ม Critical | Nightrose (G unit) |
| `no-hit(target)` | ยูนิทเป้าหมายไม่ถูกฮิทจนจบการต่อสู้ | Gust Jinn, Waterspout Djinn |
| `CC(n)` | Counter Charge | Waterspout Djinn, Grenache, Dewey, King Serpent, ความสามารถที่Negrolazyมอบให้ |
| `SC(n)` | Soul Charge | King Serpent, Dewey, ความสามารถที่Negrolazyมอบให้ |
| `damage-facedown(n)` | คว่ำการ์ดหงายในดาเมจโซน (ในฐานะผล ไม่ใช่คอสต์) | Honoly |
| `hollow(target)` | ทำให้ติดสถานะฮอลโล่ว์ | คีย์เวิร์ดฮอลโล่ว์, Nightrose (G unit) คอลในสภาพฮอลโล่ว์ |
| `grant(ability, target, until)` | มอบความสามารถให้ยูนิท | Negrolazy, Mick, Megiddo |
| `return-to-deck(self)` | นำใบนี้กลับกองการ์ดแล้วสลับ | ความสามารถที่Mick มอบให้ |
| `swap(self, other-own-RC)` | สลับตำแหน่งยูนิท | ความสามารถที่Megiddoมอบให้ |
| `grade(+n, self)` | ปรับเกรด | Tommy (+2 ขณะจ่ายคอสต์สไตรด์) |
| `attack-tax(CB(1), RC)` | เรียร์การ์ดต้องจ่ายคอสต์ก่อนโจมตีแวนการ์ด | Honoly |
| `stride-from-G(self)` | สไตรด์ด้วยวิธีพิเศษจาก G โซน | Sebreeze |
| `remove-G-zone(own)` | นำ G โซนทั้งหมดของเราออกจากเกม | Megiddo (อัลติเมทสไตรด์) |
| `all-clan(self)` | นับเป็นทุกแคลนและทุกเนชั่น | Honoly, Agleam, Sebreeze |
| `stride(self)` | สไตรด์การ์ดใบนี้ลง VC (ผลของ STRIDE) | G ยูนิททุกใบ |
| `call(G→GC, self)` | คอลใบนี้จาก G โซนลง GC (ผลของ G GUARDIAN) | G การ์เดี้ยนทุกใบ |
| `call(self→RC)` | คอลใบนี้ลง RC (ผลของผู้เริ่มต้น) | Grenache |
| `discard(n)` | ทิ้งการ์ดจากมือ (ในฐานะผล ไม่ใช่คอสต์) | Tommy |
| `choose(A, B)` | เลือกผลอย่างใดอย่างหนึ่ง | Dewey (CC1 หรือ SC1), ความสามารถที่Negrolazyมอบให้ (CC1 / SC1) |
| `keyword(ชื่อ)` | คีย์เวิร์ดที่ไม่มีผลระหว่างเกม มีแค่กฎจัดเด็ค | `keyword(Sentinel)` (Gust Jinn, Waterspout Djinn) |

### ตัวช่วยใน filter และ n

| รหัส | ความหมาย | ตัวอย่าง |
|---|---|---|
| `name("คำ")` | การ์ดที่มีคำนี้ในชื่อ | `filter=grade-3 & name("Nightrose")` |
| `count-in-drop(filter)` | จำนวนการ์ดในดรอปโซนที่ตรง filter | `n=count-in-drop(name("Nightrose"))` |
| `if=เงื่อนไข` | ผลนี้เกิดเฉพาะเมื่อเงื่อนไขเป็นจริง | `draw(1, if=self-hollowed)` |
| `until=` | ระยะเวลาของผล: `battle-end` จบการต่อสู้, `turn-end` จบเทิร์น | `power(+2000, self, until=turn-end)` |
| `at=` | ผลเกิดภายหลังตามจังหวะที่ระบุ | `retire(self, at=turn-end)` |

---

## 5. ผลที่ไปเปิดจังหวะของใบอื่น (หัวใจของการหาคอมโบ)

ผลหรือคอสต์ทางซ้ายทำให้เกิดเหตุการณ์ทางขวา การ์ดที่มีจังหวะตรงกับเหตุการณ์นั้นจะทำงานต่อ

| ผล / คอสต์ / กฎ | ทำให้เกิด | การ์ดที่รอเหตุการณ์นี้ |
|---|---|---|
| `call(drop→RC)` | `enter(RC, self, from=drop)` และ `enter(RC, other-own, from=drop)` | Skeleton Cannoneer, King Serpent, Mick, Nightrose (Starlight) |
| `call(…→RC)` ทุกแบบ และการคอลปกติจากมือ | `enter(RC, self)` | Negrolazy, Honoly, คีย์เวิร์ดฮอลโล่ว์ |
| คีย์เวิร์ดฮอลโล่ว์ (รีไทร์ตอนจบเทิร์น) | `retired(self, from=RC)`, `to-drop(self, from=RC, by=hollow)`, `to-drop(own, from=RC)` | Mick (ที่ได้รับความสามารถ), Grenache, Negrolazy (ที่ได้รับความสามารถ), Nightrose (Night Fog) |
| `retire-own` (คอสต์) / `retire(own)` (ผล) | `retired(…, from=RC)`, `to-drop(own, from=RC)` | Nightrose (Night Fog), Mick (ที่ได้รับความสามารถ) |
| STRIDE ทุกแบบ | `stride(own)`, `enter(VC, self)` ของ G ยูนิท | Nightrose (Night Fog), Nightrose (Starlight), Obadiah, Immortal Galleon, Megiddo |
| ทิ้งDeweyเป็นคอสต์ G GUARDIAN | `discarded(self, as=g-guardian-cost)` | Dewey the Ghostie |
| `mill`, `search(deck→drop)`, คอสต์ `discard` | จำนวนการ์ดในดรอปโซนเพิ่ม และมีเป้าหมายให้คอลจากดรอปโซน | Zombie Whale (`drop-count`), Waterspout Djinn (`name-in-drop`), Nightrose (G unit) (นับชื่อ "Nightrose" ในดรอปโซน), ทุกใบที่มี `call(drop→…)` |
| `flip-G-up`, G ยูนิทกลับ G โซนตอนจบเทิร์น, G การ์เดี้ยนกลับ G โซนหลังการต่อสู้ | การ์ดหงายหน้าใน G โซนเพิ่ม ทำให้นับ `GB(n)` ได้เร็วขึ้น | ทุกใบที่มี `GB(n)`, อัลติเมทสไตรด์ (ต้องการหงายหน้า 3 ใบขึ้นไป) |

### ตัวอย่างการไล่คอมโบจากตาราง

1. เรียร์การ์ดที่ติดฮอลโล่ว์ถูกรีไทร์ตอนจบเทิร์น เกิด `to-drop(own, from=RC)`
2. **Nightrose (Night Fog)** (VC, GB2, 1/turn) ทำงาน จ่าย `mill(3)` แล้วคอลการ์ดใบนั้นกลับลง RC
3. การคอลครั้งนี้เกิด `enter(RC, self, from=drop)` ถ้าการ์ดใบนั้นคือ**Skeleton Cannoneer** จะทำงานต่อ (GB1, CB1): รีไทร์เรียร์การ์ดคู่แข่ง และจั่วการ์ดถ้าติดฮอลโล่ว์

การ `mill(3)` ในขั้นที่ 2 ยังเพิ่มการ์ดในดรอปโซนให้Zombie WhaleและNightrose (G unit) ด้วย

ลำดับตามกฎของตัวอย่างนี้ดูได้ที่ [timing-g.md](timing-g.md) (ข้อสังเกตข้อ 1–2): ในเอนด์เฟส G ยูนิทกลับ G โซนก่อนฮอลโล่ว์รีไทร์ Nightroseจึงทำงานได้แม้เทิร์นนั้นสไตรด์ และยูนิทที่ถูกคอลกลับไม่ต้องเลือกติดฮอลโล่ว์
