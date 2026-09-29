#!/usr/bin/env python
"""把 make-tutorial-gifs.mjs 截下的帧合成为 GIF（可选 MP4）。

为什么要共享调色板：每帧单独量化会让同一种颜色在不同帧里取到相近但不同的索引，
整块 UI 会「闪」；用全局调色板量化后 GIF 体积也更小。

用法：
  python scripts/assemble-gif.py --frames docs/tutorial/frames/search --out docs/tutorial/search.gif
  python scripts/assemble-gif.py --frames ... --out ... --fps 10 --colors 128 --width 1120 --mp4

依赖：pillow（pip install pillow）；--mp4 需要 imageio + imageio-ffmpeg
"""
import argparse
import glob
import os
import sys

from PIL import Image


def build_mosaic(images, step=3, max_px=400_000):
    """抽样拼一张马赛克，用它算全局调色板（比只用第 1 帧准）。"""
    samples = images[::step] or images
    # 马赛克总像素别太大，否则量化慢
    while len(samples) > 1 and len(samples) * samples[0].width * samples[0].height > max_px:
        samples = samples[::2] or samples[:1]
    w, h = samples[0].size
    cols = min(len(samples), 4)
    rows = (len(samples) + cols - 1) // cols
    mosaic = Image.new("RGB", (w * cols, h * rows), (255, 255, 255))
    for i, im in enumerate(samples):
        mosaic.paste(im, ((i % cols) * w, (i // cols) * h))
    return mosaic


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True, help="帧目录（*.png，按名字排序）")
    ap.add_argument("--out", required=True, help="输出 GIF 路径")
    ap.add_argument("--fps", type=float, default=10.0)
    ap.add_argument("--colors", type=int, default=128, help="全局调色板颜色数（越小文件越小）")
    ap.add_argument("--width", type=int, default=0, help="按宽度缩放（0＝不缩）")
    ap.add_argument("--start", type=int, default=0, help="丢掉前 N 帧（开场停顿）")
    ap.add_argument("--end", type=int, default=0, help="只保留到第 N 帧（0＝全部）")
    ap.add_argument("--dither", default="floyd", choices=["floyd", "none"])
    ap.add_argument("--mp4", action="store_true", help="同时输出同名 MP4（需 imageio）")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.frames, "*.png")))
    if args.start:
        files = files[args.start:]
    if args.end:
        files = files[: args.end]
    if not files:
        sys.exit(f"没有帧：{args.frames}")

    imgs = [Image.open(f).convert("RGB") for f in files]
    if args.width and imgs[0].width != args.width:
        ratio = args.width / imgs[0].width
        size = (args.width, max(1, round(imgs[0].height * ratio)))
        imgs = [im.resize(size, Image.LANCZOS) for im in imgs]

    mosaic = build_mosaic(imgs)
    palette = mosaic.quantize(colors=args.colors, method=Image.MEDIANCUT)
    dither = Image.FLOYDSTEINBERG if args.dither == "floyd" else Image.NONE
    q = [im.quantize(palette=palette, dither=dither) for im in imgs]

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    duration = max(1, round(1000 / args.fps))
    q[0].save(
        args.out,
        save_all=True,
        append_images=q[1:],
        duration=duration,
        loop=0,
        optimize=True,
        disposal=1,
    )
    kb = os.path.getsize(args.out) / 1024
    print(f"✓ {args.out}  {len(q)} 帧 / {duration}ms ≈ {kb:.0f} KB")

    if args.mp4:
        try:
            import imageio.v2 as imageio  # noqa: PLC0415
        except ImportError:
            print("  （MP4 跳过：pip install imageio imageio-ffmpeg）")
            return
        out_mp4 = os.path.splitext(args.out)[0] + ".mp4"
        writer = imageio.get_writer(out_mp4, fps=args.fps, quality=8, macro_block_size=1)
        for im in imgs:
            writer.append_data(__import__("numpy").asarray(im))
        writer.close()
        print(f"✓ {out_mp4}  {os.path.getsize(out_mp4) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
