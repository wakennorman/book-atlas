# -*- coding: utf-8 -*-
"""程序化校验：渲染后的画面里，图形主体是否居中（不靠肉眼）。"""
import sys
from PIL import Image

sys.path.insert(0, r"D:\Claude Code+DeepSeekV4\book-atlas\scripts")
import importlib.util
_spec = importlib.util.spec_from_file_location(
    "make_icons", r"D:\Claude Code+DeepSeekV4\book-atlas\scripts\make-icons.py")
_m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_m)
render_svg = _m.render_svg

BG = (0x1D, 0x2A, 0x53)


def check(name: str, path: str, size: int = 1024):
    img = render_svg(path, size).convert("RGB")
    w, h = img.size
    px = img.load()
    min_x, min_y, max_x, max_y, n = w, h, -1, -1, 0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if abs(r - BG[0]) + abs(g - BG[1]) + abs(b - BG[2]) > 30:
                n += 1
                min_x = min(min_x, x); max_x = max(max_x, x)
                min_y = min(min_y, y); max_y = max(max_y, y)
    cx, cy = (min_x + max_x) / 2, (min_y + max_y) / 2
    print("%-16s 画布中心 (%.0f, %.0f) | 图形包围盒中心 (%.0f, %.0f) | 偏移 (%+.0f, %+.0f)"
          % (name, w / 2, h / 2, cx, cy, cx - w / 2, cy - h / 2))
    print("%-16s 包围盒 %dx%d，占画布 %.0f%%（宽） %.0f%%（高），四边留白 左%d 右%d 上%d 下%d"
          % ("", max_x - min_x, max_y - min_y,
             (max_x - min_x) / w * 100, (max_y - min_y) / h * 100,
             min_x, w - max_x, min_y, h - max_y))


A = r"D:\Claude Code+DeepSeekV4\book-atlas\assets"
check("icon.svg", A + r"\icon.svg")
check("logo-mark.svg", A + r"\logo-mark.svg", 900)
