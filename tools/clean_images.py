"""ทำความสะอาดรูปการ์ด: crop ชิดการ์ด, ขนาดเท่ากัน, ปรับแสง/สีให้ใกล้กัน, มุมมนโปร่งใส, ตั้งชื่อตามรหัสการ์ดไทยในคลัง
และรูปสลีฟ: crop ชิดสลีฟ, ขนาดเท่ากัน (ไม่ปรับสี ไม่ทำมุมมน)

python tools/clean_images.py                # การ์ด: .temp/ → public/images/  สลีฟ: .temp/sleeves/ → public/sleeves/
ไฟล์ต้นฉบับไม่ถูกแก้ไข เพิ่มรูปใหม่ได้โดยเพิ่มบรรทัดใน SOURCES หรือ SLEEVES
"""
import glob, os, re, sys
import numpy as np
import yaml
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".temp")
OUT = os.path.join(ROOT, "public", "images")
SIZE = (544, 793)          # สัดส่วนเดียวกับรูปต้นฉบับส่วนใหญ่ (~0.686)
RADIUS = 26                # รัศมีมุมมนที่ขนาด SIZE
TARGET_LUMA = 128          # ความสว่างเฉลี่ยเป้าหมาย (0-255)
TARGET_SAT = 0.46          # ความอิ่มสีเฉลี่ยเป้าหมาย (0-1)
SLEEVE_SRC = os.path.join(SRC, "sleeves")
SLEEVE_OUT = os.path.join(ROOT, "public", "sleeves")
SLEEVE_SIZE = (440, 640)   # เท่ากับสลีฟชุดแรก ถ้าสัดส่วนไม่ตรง ตัดส่วนเกินออกจากกึ่งกลาง (ไม่ยืดภาพ)

# ไฟล์ต้นฉบับใน .temp/sleeves/ → ชื่อไฟล์สลีฟ (ไม่ต้องใส่นามสกุล บันทึกเป็น .jpg)
SLEEVES = {
}

# ไฟล์ต้นฉบับ → ชื่อการ์ดไทย (ตรงกับ name ในไฟล์การ์ด)
SOURCES = {
    "BT02-026EN_R.webp": "ผีน้อยจั๊บปี้",
    "D-PV01-028EN-RR_(Sample).webp": "ไลต์เอเลเมนทัล โฮโนลี่",
    "D-PV01-047EN-RR_(Sample).webp": "แรมเพจ·เชด",
    "D-PV01-071EN-RR_(Sample).webp": "ผีน้อย เดวย์",
    "G-BT06-019EN-RR.webp": "หมออาคมแห่งความเหนื่อยหน่าย, เนโครเลซี่",
    "G-BT06-020EN-RR.webp": "พายุหมุนพิฆาตจิน",
    "G-BT06-040EN-R.webp": "หมออาคมแห่งผงกระดูก, เนโครโบน",
    "G-BT06-087EN-C.webp": "พลปืนใหญ่โครงกระดูก",
    "G-BT06-094EN-C.webp": "ผีน้อยมิคและครอบครัว",
    "G-CHB03-006EN-RRR.webp": "เจ้าหญิงผีดูดเลือดแห่งแสงดารา, ไนท์โรส",
    "G-CHB03-026EN-R.webp": "คิง·เซอเพนท์",
    "G-FC03-043EN-RR.webp": "มังกรซากศพที่ถูกกัดกิน, ดีพ คอร์ปส์-ดราก้อน",
    "G-FC03-049EN-RR.webp": "แอร์เอเลเมนต์, ซีบรีซ",
    "G-FC04-019EN-GR.webp": "นาวาอมตะ, อิมมอร์ทัล·กัลเลียน",
    "G-RC02-006EN-ZR_(Sample).webp": "เซรอธดราก้อนแห่งท้องทะเลไกลโพ้น, เมกิดโด้",
    "G-TD08-004EN.webp": "เจ้าหญิงผีดูดเลือดแห่งหมอกยามค่ำคืน, ไนท์โรส",
    "G-TD08-007EN.webp": "หมออาคมแห่งทะเลเน่าเฟะ, เนโครรูค",
    "G-TD08-014EN.webp": "ผู้ตายที่ไม่ยอมตาย, กรูนาช",
    "G-TD08-018EN.webp": "แบนชีน้ำวน",
    "PR-0255EN.webp": "ไลท์เอเลเมนท์, อากรีม",
    "PR-0373EN.png": "ซอมบี้ปลาวาฬแห่งมหาสมุทรลึก",
    "PR-0415EN.webp": "ราชาโจรสลัดแห่งกุหลาบยามค่ำคืน ไนท์โรส",
    "V-SS09-129EN-RRR_(Sample).webp": "หนึ่งคนแกร่งเท่าหนึ่งพัน, ไนท์สตอร์ม",
    "V-SS10-032EN-TD_(Sample).webp": "ราชาผีน้อย, โอบาไดอา",
    "V-SS10-036EN-TD_(Sample).webp": "ผู้ใช้ภูตมายาแห่งการเรียกหา, เนโครนอร่า",
    "V-SS10-038EN-TD_(Sample).webp": "หมออาคมใหญ่แห่งงานเลี้ยงยามค่ำคืน, เนโครลิลลี่",
    "V-SS10-050EN-TD_(Sample).webp": "ผีน้อยพี่น้องทอมมี่",
    "VGE_BT02-014EN.webp": "พายุกระหน่ำ จิน",
}


def card_ids():
    ids = {}
    for f in glob.glob(os.path.join(ROOT, "content", "cards", "*", "*.yaml")):
        fm = yaml.safe_load(open(f, encoding="utf-8"))
        ids[fm["name"]] = fm["ids"][0]
    return ids


def file_code(card_id):
    """'G-CHB03/S11TH SP' -> 'G-CHB03_S11TH'"""
    return card_id.split()[0].replace("/", "_")


def crop_to_card(im):
    """ตัดพื้นที่โปร่งใสหรือพื้นขาวรอบการ์ดออก"""
    a = np.asarray(im.convert("RGBA")).astype(int)
    alpha = a[..., 3]
    content = alpha > 128
    near_white = (a[..., :3] > 235).all(axis=2)
    content &= ~near_white
    rows = np.where(content.mean(axis=1) > 0.5)[0]
    cols = np.where(content.mean(axis=0) > 0.5)[0]
    return im.crop((cols.min(), rows.min(), cols.max() + 1, rows.max() + 1))


def flatten(im):
    """เติมมุมโปร่งใสด้วยสีขอบการ์ดใกล้เคียง เพื่อไม่ให้ขอบดำ/ขาวตอนปรับแสง"""
    rgba = im.convert("RGBA")
    base = rgba.convert("RGB").filter(ImageFilter.MaxFilter(9))
    out = base.copy()
    out.paste(rgba.convert("RGB"), mask=rgba.split()[3])
    return out


def normalize(im):
    a = np.asarray(im).astype(np.float32) / 255
    luma = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    lo, hi = np.percentile(luma, [0.5, 99.5])
    a = np.clip((a - lo) / max(hi - lo, 1e-3), 0, 1)
    mean = float((a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)).mean())
    gamma = np.log(TARGET_LUMA / 255) / np.log(max(min(mean, 0.95), 0.05))
    a = a ** float(np.clip(gamma, 0.6, 1.6))
    im = Image.fromarray((a * 255).round().astype(np.uint8))
    sat = np.asarray(im.convert("HSV"))[..., 1].mean() / 255
    factor = float(np.clip(TARGET_SAT / max(sat, 1e-3), 1.0, 1.6))
    im = ImageEnhance.Color(im).enhance(factor)
    return im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))


def round_corners(im):
    mask = Image.new("L", (im.width * 4, im.height * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, mask.width - 1, mask.height - 1), RADIUS * 4, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask.resize(im.size, Image.LANCZOS))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    ids = card_ids()
    missing = [n for n in SOURCES.values() if n not in ids]
    if missing:
        sys.exit(f"ไม่พบการ์ดในคลัง: {missing}")
    for src, name in SOURCES.items():
        path = os.path.join(SRC, src)
        if not os.path.exists(path):
            print(f"ข้าม (ไม่มีไฟล์): {src}")
            continue
        im = crop_to_card(Image.open(path))
        im = flatten(im).resize(SIZE, Image.LANCZOS)
        im = round_corners(normalize(im))
        dst = file_code(ids[name]) + ".png"
        im.save(os.path.join(OUT, dst), optimize=True)
        print(f"{src:34} -> public/images/{dst}")

    os.makedirs(SLEEVE_OUT, exist_ok=True)
    for src, name in SLEEVES.items():
        path = os.path.join(SLEEVE_SRC, src)
        if not os.path.exists(path):
            print(f"ข้าม (ไม่มีไฟล์): sleeves/{src}")
            continue
        im = crop_to_card(Image.open(path)).convert("RGB")
        im = ImageOps.fit(im, SLEEVE_SIZE, Image.LANCZOS)
        im.save(os.path.join(SLEEVE_OUT, name + ".jpg"), quality=90, optimize=True)
        print(f"sleeves/{src:26} -> public/sleeves/{name}.jpg")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
