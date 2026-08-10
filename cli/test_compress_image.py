"""Unit tests for the CLI. Run from the repo root:

    python -m unittest discover -s cli
"""

import argparse
import random
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from compress_image import compress_to_target, flatten, output_path, parse_size

SCRIPT = Path(__file__).with_name("compress_image.py")


def noise_image(w=600, h=400, seed=42):
    """Random noise compresses poorly — good for forcing the search to work."""
    rng = random.Random(seed)
    data = bytes(rng.getrandbits(8) for _ in range(w * h * 3))
    return Image.frombytes("RGB", (w, h), data)


class ParseSizeTest(unittest.TestCase):
    def test_units(self):
        self.assertEqual(parse_size("500KB"), 500 * 1024)
        self.assertEqual(parse_size("2MB"), 2 * 1024 * 1024)
        self.assertEqual(parse_size("10B"), 10)
        self.assertEqual(parse_size("1.5MB"), int(1.5 * 1024 * 1024))

    def test_bare_number_means_kb(self):
        self.assertEqual(parse_size("300"), 300 * 1024)

    def test_case_and_whitespace(self):
        self.assertEqual(parse_size(" 500 kb "), 500 * 1024)

    def test_invalid(self):
        for bad in ("abc", "", "12GB", "-5KB", "0"):
            with self.assertRaises(argparse.ArgumentTypeError, msg=bad):
                parse_size(bad)


class FlattenTest(unittest.TestCase):
    def test_transparency_composites_onto_white(self):
        img = Image.new("RGBA", (10, 10), (255, 0, 0, 128))
        flat = flatten(img)
        self.assertEqual(flat.mode, "RGB")
        r, g, b = flat.getpixel((5, 5))
        self.assertEqual(r, 255)
        self.assertGreater(g, 100)  # white shows through, not black
        self.assertGreater(b, 100)

    def test_rgb_passthrough(self):
        img = Image.new("RGB", (10, 10), (1, 2, 3))
        self.assertIs(flatten(img), img)


class CompressToTargetTest(unittest.TestCase):
    def test_reaches_target(self):
        target = 50 * 1024
        data, quality, size, reached = compress_to_target(noise_image(), target)
        self.assertTrue(reached)
        self.assertLessEqual(len(data), target)
        self.assertGreaterEqual(quality, 20)

    def test_easy_target_keeps_max_quality(self):
        img = Image.new("RGB", (200, 200), (200, 220, 240))
        data, quality, _, reached = compress_to_target(img, 10 * 1024 * 1024)
        self.assertTrue(reached)
        self.assertEqual(quality, 95)

    def test_impossible_target_reports_not_reached(self):
        data, _, _, reached = compress_to_target(noise_image(), 300)
        self.assertFalse(reached)
        self.assertGreater(len(data), 300)  # smallest achievable, still delivered

    def test_output_is_jpeg(self):
        data, *_ = compress_to_target(noise_image(), 50 * 1024)
        self.assertEqual(data[:2], b"\xff\xd8")  # JPEG SOI marker


class OutputPathTest(unittest.TestCase):
    def test_default_name(self):
        self.assertEqual(output_path(Path("a/b.png"), None), Path("a/b_compressed.jpg"))

    def test_override(self):
        self.assertEqual(output_path(Path("a/b.png"), Path("x.jpg")), Path("x.jpg"))


class CliEndToEndTest(unittest.TestCase):
    def test_compress_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "in.png"
            out = Path(tmp) / "out.jpg"
            noise_image(300, 200).save(src)
            result = subprocess.run(
                [sys.executable, str(SCRIPT), str(src), "-t", "30KB", "-o", str(out)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(out.exists())
            self.assertLessEqual(out.stat().st_size, 30 * 1024)

    def test_missing_file_fails(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "does-not-exist.png"],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 1)


if __name__ == "__main__":
    unittest.main()
