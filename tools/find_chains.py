"""ค้นหาวงจรคอมโบจากรหัสในไฟล์การ์ด (.yaml)

ตัวอย่าง:
  python tools/find_chains.py                              # เทิร์นคู่แข่ง เริ่มจาก G GUARDIAN
  python tools/find_chains.py --vc "หมอกยามค่ำคืน" --gb 2    # ระบุแวนการ์ดและ GB เพื่อตัดเส้นทางที่เงื่อนไขไม่ผ่าน
  python tools/find_chains.py --turn own --start "โอบาไดอา"   # เทิร์นเรา เริ่มจากการ์ดที่ชื่อมีคำนี้
"""
import argparse, glob, os, re, sys
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_cards():
    cards = []
    for f in sorted(glob.glob(os.path.join(ROOT, "content", "cards", "*", "*.yaml"))):
        fm = yaml.safe_load(open(f, encoding="utf-8"))
        fm["abilities"] = [dict(a, card=fm["name"], idx=i + 1) for i, a in enumerate(fm["abilities"])]
        fm["has_hollow"] = any("hollow(self)" in a.get("effect", []) for a in fm["abilities"])
        cards.append(fm)
    return cards


# คอสต์/ผลแบบไหน ก่อเหตุการณ์อะไร และเหตุการณ์นั้นเกิดกับใคร
#   same   = ความสามารถของการ์ดใบนี้เองเท่านั้น
#   chosen = การ์ดที่ผลนี้เลือก (ต้องผ่าน filter ของผลนั้น)
#   any    = การ์ดใบไหนก็ได้ที่เฝ้าเหตุการณ์นี้
EMITS = [
    (r"^retire-own", [("to-drop(own, from=RC)", "any"), ("retired(self, from=RC)", "chosen")]),
    (r"^retire\(own", [("to-drop(own, from=RC)", "any"), ("retired(self, from=RC)", "chosen")]),
    (r"^call\((drop|hand\+drop)→RC", [("enter(RC, self, from=drop)", "chosen"), ("enter(RC, self)", "chosen"),
                                      ("enter(RC, other-own, from=drop)", "any")]),
    (r"^call\(drop→GC", [("enter(GC, self)", "chosen")]),
    (r"^call\(G→GC", [("enter(GC, self)", "same")]),
    (r"^stride\(self\)", [("stride(own)", "any"), ("enter(VC, self)", "same")]),
    (r"^discard\(1, filter=heal\)", [("discarded(self, from=hand, as=g-guardian-cost)", "chosen")]),
]

# รหัสที่ใช้ได้เฉพาะในเทิร์นเรา / เทิร์นคู่แข่ง
OWN_ONLY_TIMING = ("step(stride, own)", "phase-start(battle, own)", "attack(", "battle-end(")
OPP_ONLY_TIMING = ("step(guard, opp)", "enter(GC", "discarded(")


def turn_ok(a, turn):
    t = a.get("timing", "")
    if turn == "opp":
        if "own-turn" in a.get("cond", []) or a["kind"] in ("ACT", "STRIDE", "ULTIMATE STRIDE"):
            return False
        return not t.startswith(OWN_ONLY_TIMING)
    return a["kind"] != "G GUARDIAN" and not t.startswith(OPP_ONLY_TIMING)


def cond_ok(a, card, args):
    if args.vc and a.get("zone") == "VC" and args.vc not in card["name"]:
        return False
    for c in a.get("cond", []):
        m = re.fullmatch(r"GB\((\d+)\)", c)
        if m and args.gb is not None and int(m.group(1)) > args.gb:
            return False
        for word in re.findall(r'vc-name\("([^"]+)"\)', c):
            if args.vc_name is not None and word not in args.vc_name:
                return False
    return True


def filter_of(item):
    i = item.find("filter=")
    if i < 0:
        return ""
    depth, out = 0, []
    for ch in item[i + len("filter="):]:
        if depth == 0 and ch in ",)":
            break
        depth += (ch == "(") - (ch == ")")
        out.append(ch)
    return "".join(out).strip()


def passes_filter(card, flt, source_card):
    if card["type"] in ("g-unit", "g-guardian"):
        return False
    for tok in [t.strip() for t in flt.split("&") if t.strip()]:
        g = re.fullmatch(r"grade-(\d+)", tok)
        le = re.fullmatch(r"grade≤(\d+)", tok)
        nm = re.fullmatch(r'name\("([^"]+)"\)', tok)
        if g and card["grade"] != int(g.group(1)):
            return False
        if le and card["grade"] > int(le.group(1)):
            return False
        if nm and nm.group(1) not in card["name"]:
            return False
        if tok == "not-same-name" and card["name"] == source_card:
            return False
        if tok == "has-hollow" and not card["has_hollow"]:
            return False
        if tok == "normal-unit" and card["type"] != "normal":
            return False
        if tok == "heal" and card.get("trigger") != "heal":
            return False
    return True


def is_hollow_keyword(a):
    return a.get("effect", [])[:1] == ["hollow(self)"] and a.get("timing") == "enter(RC, self)"


def emitted(a):
    out = []
    for item in a.get("cost", []) + a.get("effect", []):
        for pat, evs in EMITS:
            if re.search(pat, item):
                out += [(ev, who, filter_of(item)) for ev, who in evs]
    return out


def consumers(a, cards, by_name, args, seen):
    found = []
    for ev, who, flt in dict.fromkeys(emitted(a)):
        for card in cards:
            if who == "same" and card["name"] != a["card"]:
                continue
            if who == "chosen" and not passes_filter(card, flt, a["card"]):
                continue
            for b in card["abilities"]:
                if (b["card"], b["idx"]) in seen or b.get("timing") != ev or is_hollow_keyword(b):
                    continue
                if turn_ok(b, args.turn) and cond_ok(b, card, args):
                    found.append((ev, b))
    return found


def label(a):
    zone = f" {a['zone']}" if "zone" in a else ""
    return f"{a['card']} [{a['kind']}{zone} #{a['idx']}]"


def add_resources(tally, a):
    """รวมค่าใช้จ่าย CB/SB และสิ่งที่ได้คืน CC/SC ของความสามารถ a เข้ากับยอดสะสม"""
    t = dict(tally)
    for item in a.get("cost", []):
        for kind in ("CB", "SB"):
            m = re.fullmatch(kind + r"\((\d+)\)", item)
            if m:
                t[kind] += int(m.group(1))
    for item in a.get("effect", []):
        m = re.fullmatch(r"damage-facedown\((\d+)\)", item)
        if m:  # คว่ำดาเมจของเราเอง ใช้ทรัพยากรเดียวกับ CB
            t["CB"] += int(m.group(1))
            continue
        if item.startswith("choose("):
            t["choice"] += 1
            continue
        for kind in ("CC", "SC"):
            m = re.match(kind + r"\((\d+)(, if=([^)]*))?\)", item)
            if m:
                key = kind + ("?" if m.group(3) else "")
                t[key] += int(m.group(1))
    return t


def fmt(t):
    parts = [f"CB {t['CB']}", f"SB {t['SB']}"]
    gains = []
    for key, name in (("CC", "CC"), ("SC", "SC")):
        if t[key]:
            gains.append(f"{name}+{t[key]}")
        if t[key + "?"]:
            gains.append(f"{name}+{t[key + '?']} มีเงื่อนไข")
    if t["choice"]:
        gains.append(f"CC/SC+{t['choice']} เลือก")
    return "  {" + ", ".join(parts) + (" | ได้คืน " + ", ".join(gains) if gains else "") + "}"


EMPTY = {"CB": 0, "SB": 0, "CC": 0, "SC": 0, "CC?": 0, "SC?": 0, "choice": 0}


def walk(a, cards, by_name, args, seen, depth, out, tally):
    seen = seen | {(a["card"], a["idx"])}
    if depth >= args.depth:
        return
    for ev, b in consumers(a, cards, by_name, args, seen):
        t = add_resources(tally, b)
        out.append("    " * (depth + 1) + f"└ {ev} → {label(b)}{fmt(t)}")
        walk(b, cards, by_name, args, seen, depth + 1, out, t)


def main():
    p = argparse.ArgumentParser(description="ค้นหาวงจรคอมโบจากไฟล์การ์ด")
    p.add_argument("--turn", choices=["opp", "own"], default="opp", help="เทิร์นของใคร (ค่าเริ่มต้น: opp = เทิร์นคู่แข่ง)")
    p.add_argument("--start", help="เริ่มจากการ์ดที่ชื่อมีคำนี้ (ไม่ระบุ = จุดเริ่มต้นมาตรฐานของเทิร์นนั้น)")
    p.add_argument("--vc", help="ชื่อ (บางส่วน) ของแวนการ์ด ใช้ตัดความสามารถ (VC) ของใบอื่นออก")
    p.add_argument("--gb", type=int, help="จำนวน GB ที่มี ใช้ตัดความสามารถที่ต้องการ GB สูงกว่า")
    p.add_argument("--depth", type=int, default=6, help="ไล่ลึกสุดกี่ชั้น (ค่าเริ่มต้น 6)")
    args = p.parse_args()
    args.vc_name = None
    cards = load_cards()
    by_name = {c["name"]: c for c in cards}
    if args.vc:
        match = [c for c in cards if args.vc in c["name"]]
        if not match:
            sys.exit(f"ไม่พบการ์ดที่ชื่อมี '{args.vc}'")
        args.vc_name = match[0]["name"]

    entry = ("G GUARDIAN",) if args.turn == "opp" else ("STRIDE", "ULTIMATE STRIDE", "ACT")
    pool = [c for c in cards if not args.start or args.start in c["name"]]
    if not pool:
        sys.exit(f"ไม่พบการ์ดที่ชื่อมี '{args.start}'")
    starts = []
    for c in pool:
        usable = [a for a in c["abilities"] if turn_ok(a, args.turn)]
        entries = [a for a in usable if a["kind"] in entry]
        starts += entries if entries or not args.start else usable

    for s in starts:
        out = []
        t = add_resources(EMPTY, s)
        walk(s, cards, by_name, args, set(), 0, out, t)
        if out:
            print(label(s) + fmt(t))
            print("\n".join(out))
            print()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
