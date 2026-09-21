# 把 logo 的矢量源文件渲染成站点要用的位图资源。
# 依赖：本机 Edge（无头截图）+ Pillow。
# 跑法：python scripts/make-icons.py
import os
import shutil
import subprocess
import sys
import tempfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not os.path.exists(EDGE):
    EDGE = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"


def render_svg(svg_path: str, size: int) -> Image.Image:
    """用 Edge 无头模式把 SVG 渲染成 RGBA 位图。"""
    with tempfile.TemporaryDirectory() as td:
        # 用 HTML 包一层，避免浏览器给 SVG 文档加默认边距
        html = os.path.join(td, "r.html")
        with open(html, "w", encoding="utf-8") as f:
            f.write(
                '<!doctype html><meta charset="utf-8">'
                "<style>html,body{margin:0;padding:0;overflow:hidden;background:#0000}"
                "img{display:block;width:100vw;height:100vh}</style>"
                '<img src="file:///%s">' % svg_path.replace("\\", "/")
            )
        out = os.path.join(td, "shot.png")
        subprocess.run(
            [
                EDGE, "--headless", "--disable-gpu", "--hide-scrollbars",
                "--force-device-scale-factor=1",
                "--screenshot=" + out,
                "--window-size=%d,%d" % (size, size),
                "--virtual-time-budget=1500",
                "file:///" + html.replace("\\", "/"),
            ],
            check=True, capture_output=True, timeout=90,
        )
        return Image.open(out).convert("RGBA")


def save(img: Image.Image, name: str, size: int):
    path = os.path.join(ASSETS, name)
    img.resize((size, size), Image.LANCZOS).save(path)
    print("  %-26s %dx%d  %d B" % (name, size, size, os.path.getsize(path)))


def main():
    full = os.path.join(ASSETS, "icon.svg")       # 满幅：favicon / PWA / 社交
    mark = os.path.join(ASSETS, "logo-mark.svg")  # 紧凑：小尺寸更清晰
    ico_dir = tempfile.mkdtemp()

    print("渲染中（Edge 无头）…")
    full_img = render_svg(full, 1024)
    mark_img = render_svg(mark, 1024)

    print("输出：")
    save(full_img, "icon-512.png", 512)
    save(mark_img, "apple-touch-icon.png", 180)
    save(mark_img, "favicon-32x32.png", 32)
    save(mark_img, "favicon-16x16.png", 16)

    # favicon.ico（16/32/48 三档）
    ico = os.path.join(ASSETS, "favicon.ico")
    prov = Image.open(os.path.join(ASSETS, "favicon-32x32.png")).convert("RGBA")
    prov.save(ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("  %-26s multi   %d B" % ("favicon.ico", os.path.getsize(ico)))

    shutil.rmtree(ico_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
