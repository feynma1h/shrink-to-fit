# Shrink to Fit

**Compress images and PDFs to an exact file-size limit — entirely in your browser.**

**→ Use it here: https://feynma1h.github.io/shrink-to-fit/**

## Why

Every so often an upload form says *“maximum size: 500 KB”* and rejects your file.
The usual fix is googling an online compressor, and that means two problems:

1. Most tools compress by a preset percentage — they don't target **your exact limit**.
2. You're uploading your photos and documents to a stranger's server and hoping
   they aren't keeping them.

This tool fixes both. You type the limit, it finds the highest quality that fits,
and **your files never leave your device** — all compression runs locally in your
browser. Nothing is ever uploaded.

## Privacy promises

- **No uploads** — files are processed in your browser (canvas, WebAssembly Ghostscript, pdf.js); there is no server.
- **No analytics, no cookies, no tracking of any kind.** The only network traffic is fetching this page's own static files.
- **Metadata stripped** — the JPEGs it produces contain no EXIF data, so GPS location, device model, and timestamps are removed as a side effect.
- **Auditable** — this repo is the entire app. What you read here is what GitHub Pages serves.

## Features

- Exact size targeting (e.g. `500 KB`, `2 MB`) via binary search over JPEG quality — and automatic downscaling when quality alone can't get there
- **Images**: JPEG, PNG, WebP, and anything else your browser can decode → compressed JPEG
- **PDFs**: real, text-preserving PDF compression via Ghostscript (WASM), with an automatic rasterize fallback for stubborn cases (see below)
- Compression runs in Web Workers — the page stays responsive, even mid-job in a background tab
- Multiple files at once, drag & drop, dark mode, keyboard accessible
- Works offline once everything has loaded (the PDF engines lazy-load on your first PDF)

### How PDFs are compressed

1. **Ghostscript first** ([compiled to WebAssembly](web/vendor/ghostscript/NOTICE.md), running locally):
   images inside the PDF are downsampled along a DPI ladder (200 → 55) until the
   output fits your target. **Text, fonts, and vector content stay intact** —
   the output is still a real, searchable PDF. This alone is often dramatic:
   a 1.1 MB text-plus-photos document shrinks to ~34 KB.
2. **Rasterize fallback**: if even Ghostscript's lowest settings can't reach the
   target (or Ghostscript fails), each page is re-rendered with
   [pdf.js](https://mozilla.github.io/pdf.js/) and rebuilt as a compressed image
   with [pdf-lib](https://pdf-lib.js.org/). This reaches almost any size for
   scans — but text in the output stops being selectable. The result card
   always tells you which engine produced your file.

If neither engine can reach the target, you get the smallest file achieved and
a clear warning. Password-protected PDFs aren't supported — remove the password
first.

## CLI (offline alternative)

An equivalent Python script is included for batch/offline use:

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r cli/requirements.txt

python cli/compress_image.py photo.jpg --target 500KB
python cli/compress_image.py *.png --target 2MB          # batch
python cli/compress_image.py scan.jpg -t 200KB -o out.jpg
```

## How it works

Both the web app and the CLI use the same idea: JPEG quality is searched
(binary search, quality 20–95) for the **highest quality whose output fits the
target**. If even the lowest quality is too large, dimensions are scaled down
(estimated from the overshoot) and the search runs again. PDFs walk quality/DPI
ladders instead (Ghostscript image resolution 200 → 55 DPI; the rasterize
fallback at 150 → 72 DPI), stopping at the first rung that fits.

## Repository layout

```
web/    the site GitHub Pages serves — app code in web/js/, offline deps in web/vendor/
cli/    the Python CLI and its tests
.github/workflows/   Pages deploy + CI (CLI tests)
```

## Run locally

The web app is a static site — any file server works:

```bash
python3 -m http.server 8000 -d web
# open http://localhost:8000
```

Run the CLI tests with:

```bash
python -m unittest discover -s cli
```

## Vendored dependencies

Kept in-repo (no CDNs) so the page can't be tampered with by a third party and
works offline:

- [Ghostscript](https://ghostscript.com) compiled to WebAssembly (**AGPL-3.0** —
  see [web/vendor/ghostscript/NOTICE.md](web/vendor/ghostscript/NOTICE.md) for
  source links). ~15 MB, fetched lazily only when you compress a PDF.
- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0)
- [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT)

License files ship alongside each in [web/vendor/](web/vendor/).

## License

The app's own code is [MIT](LICENSE). The vendored Ghostscript WASM build
remains AGPL-3.0 (unmodified, with corresponding-source links in its NOTICE).
