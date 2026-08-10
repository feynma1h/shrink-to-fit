#!/usr/bin/env python3
"""Compress images to fit an exact file-size target (JPEG output).

Offline CLI counterpart to the web app. Examples (from the repo root):

    python cli/compress_image.py photo.jpg --target 500KB
    python cli/compress_image.py *.png --target 2MB
    python cli/compress_image.py scan.jpg -t 200KB -o passport_scan.jpg
"""

import argparse
import io
import re
import sys
from pathlib import Path

from PIL import Image

QUALITY_MIN = 20
QUALITY_MAX = 95
MIN_DIMENSION = 150  # stop downscaling below this many pixels on a side


def parse_size(text: str) -> int:
    """'500KB', '2MB', or a bare number (KB) -> bytes."""
    m = re.fullmatch(r"\s*([\d.]+)\s*(kb|mb|b)?\s*", text, re.IGNORECASE)
    if not m:
        raise argparse.ArgumentTypeError(f"can't parse size {text!r} (try e.g. 500KB or 2MB)")
    value = float(m.group(1))
    unit = (m.group(2) or "kb").lower()
    factor = {"b": 1, "kb": 1024, "mb": 1024 * 1024}[unit]
    bytes_ = int(value * factor)
    if bytes_ <= 0:
        raise argparse.ArgumentTypeError("target size must be positive")
    return bytes_


def flatten(img: Image.Image) -> Image.Image:
    """Convert to RGB, compositing any transparency onto white."""
    if img.mode == "RGB":
        return img
    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return img.convert("RGB")


def encode(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)  # EXIF/GPS not carried over
    return buf.getvalue()


def search_quality(img: Image.Image, target: int):
    """Binary-search the highest JPEG quality that fits, or the floor if none does."""
    lo, hi = QUALITY_MIN, QUALITY_MAX
    best = floor = None
    while lo <= hi:
        mid = (lo + hi) // 2
        data = encode(img, mid)
        if len(data) <= target:
            best = (data, mid)
            lo = mid + 1
        else:
            floor = (data, mid)
            hi = mid - 1
    return best, floor


def compress_to_target(img: Image.Image, target: int):
    """Returns (jpeg_bytes, quality, (w, h), reached_target)."""
    img = flatten(img)
    work = img
    while True:
        best, floor = search_quality(work, target)
        if best:
            return best[0], best[1], work.size, True
        # Even the lowest quality is too big: scale dimensions down and retry.
        ratio = target / len(floor[0])
        factor = max(0.4, ratio**0.5 * 0.95)
        w = round(work.width * factor)
        h = round(work.height * factor)
        if w < MIN_DIMENSION or h < MIN_DIMENSION:
            return floor[0], floor[1], work.size, False
        work = work.resize((w, h), Image.LANCZOS)


def output_path(input_path: Path, override: Path | None) -> Path:
    if override:
        return override
    return input_path.with_name(f"{input_path.stem}_compressed.jpg")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("images", nargs="+", type=Path, help="input image(s)")
    parser.add_argument("-t", "--target", type=parse_size, default="500KB",
                        help="target size, e.g. 500KB or 2MB (default: 500KB)")
    parser.add_argument("-o", "--output", type=Path,
                        help="output path (only valid with a single input)")
    args = parser.parse_args()

    if args.output and len(args.images) > 1:
        parser.error("--output can only be used with a single input image")

    failures = 0
    for path in args.images:
        try:
            with Image.open(path) as img:
                data, quality, size, reached = compress_to_target(img, args.target)
        except FileNotFoundError:
            print(f"✗ {path}: not found", file=sys.stderr)
            failures += 1
            continue
        except OSError as err:
            print(f"✗ {path}: {err}", file=sys.stderr)
            failures += 1
            continue

        out = output_path(path, args.output)
        out.write_bytes(data)
        kb = len(data) / 1024
        note = f"quality {quality}, {size[0]}x{size[1]}"
        if reached:
            print(f"✓ {path} -> {out}  ({kb:.1f} KB, {note})")
        else:
            failures += 1
            print(f"! {path} -> {out}  ({kb:.1f} KB, {note}) — couldn't reach "
                  f"{args.target / 1024:.0f} KB without going below {MIN_DIMENSION}px", file=sys.stderr)

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
