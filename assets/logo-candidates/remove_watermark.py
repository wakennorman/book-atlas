# -*- coding: utf-8 -*-
"""去掉 C1 右下角水印 + 采样关键颜色（用于动画 SVG 重绘）"""
from PIL import Image, ImageFilter
import os

SRC = r"D:\Claude Code+DeepSeekV4\book-atlas\assets\logo-candidates\C1-openbook-panel-lowerleft-gold-rose.png"
DST = r"D:\Claude Code+DeepSeekV4\book-atlas\assets\logo-candidates\C1-clean.png"

img = Image.open(SRC).convert("RGB")
W, H = img.size
print("size:", img.size)

# ---- 1. 采样颜色 ----
def sample(x, y, r=4):
    px = []
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            px.append(img.getpixel((x + dx, y + dy)))
    n = len(px)
    avg = tuple(sum(c[i] for c in px) // n for i in range(3))
    return "#%02x%02x%02x" % avg

colors = {
    "background_top": sample(500, 150),
    "background_mid": sample(850, 400),
    "gold_page": sample(500, 880),
    "gold_face": sample(400, 560),
    "brow_pink": sample(285, 480),
    "eye_dark": sample(272, 600),
    "eye_highlight": sample(289, 592),
}
for k, v in colors.items():
    print(k, v)

# ---- 2. 去水印：从上方克隆一块干净背景盖住右下角文字区 ----
# 水印区域大约 (875, 940) - (1020, 1015)
box_x0, box_y0, box_x1, box_y1 = 860, 930, 1024, 1024
pw, ph = box_x1 - box_x0, box_y1 - box_y0
patch = img.crop((box_x0, box_y0 - ph - 12, box_x1, box_y0 - 12))  # 从正上方取同宽同高的一块

# 羽化蒙版：边缘 14px 渐变，让补丁与背景自然过渡
mask = Image.new("L", (pw, ph), 255)
feather = 14
for i in range(feather):
    a = int(255 * i / feather)
    for x in range(pw):
        for y in range(ph):
            if x < feather - i or y < feather - i:
                if mask.getpixel((x, y)) > a:
                    mask.putpixel((x, y), a)
mask = mask.filter(ImageFilter.GaussianBlur(3))
img.paste(patch, (box_x0, box_y0), mask)

img.save(DST)
print("saved:", DST, os.path.getsize(DST), "bytes")
