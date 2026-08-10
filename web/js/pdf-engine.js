/* PDF compression, two stages:
   1. Ghostscript (WASM, in gs-worker.js) — downsamples images inside the PDF;
      text, fonts, and vectors stay intact.
   2. Rasterize fallback — pdf.js renders each page, pdf-lib rebuilds the
      document from compressed page images. Reaches almost any size, but text
      stops being selectable.
   If neither fits the target, the smaller of the two attempts wins. */

import { formatBytes, makeJobWorker, UserError } from "./utils.js";
import { encodeJpeg, makeCanvas, releaseCanvas } from "./image-engine.js";

/* Quality ladder used for rasterized PDF pages (JPEG quality, high → low). */
const PDF_QUALITIES = [0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48, 0.4, 0.33, 0.26, 0.2];
/* Rendering resolutions tried for rasterized pages, in DPI (high → low). */
const PDF_DPIS = [150, 120, 96, 72];
/* Estimated PDF container overhead beyond the JPEG streams themselves. */
const pdfOverhead = (pages) => 2048 + 450 * pages;

const asset = (path) => new URL(path, import.meta.url).href;

const runGsJob = makeJobWorker(asset("gs-worker.js"));

export async function compressPdf(file, target, report) {
  let gsBest = null;
  if (await looksLikePdf(file)) {
    try {
      const gs = await runGsJob({ file, target }, report);
      if (gs.fit) {
        return { blob: gs.blob, note: `Ghostscript, images at ${gs.dpi} DPI — text & vectors preserved`, warn: null };
      }
      gsBest = gs.best; // may be null if every rung failed
    } catch (err) {
      console.warn("Ghostscript engine unavailable, falling back to rasterizing:", err);
    }
  }

  const raster = await rasterizePdf(file, target, report);
  if (raster.blob.size <= target) return { blob: raster.blob, note: raster.note, warn: null };

  if (gsBest && gsBest.size < raster.blob.size) {
    return {
      blob: gsBest.blob,
      note: `Ghostscript, images at ${gsBest.dpi} DPI — text & vectors preserved`,
      warn: `Couldn't reach ${formatBytes(target)} — smallest achievable was ${formatBytes(gsBest.size)}.`,
    };
  }
  return {
    blob: raster.blob,
    note: raster.note,
    warn: `Couldn't reach ${formatBytes(target)} — smallest achievable was ${formatBytes(raster.blob.size)}.`,
  };
}

async function looksLikePdf(file) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  outer: for (let i = 0; i + sig.length <= head.length; i++) {
    for (let j = 0; j < sig.length; j++) if (head[i + j] !== sig[j]) continue outer;
    return true;
  }
  return false;
}

/* ---------- rasterize fallback ---------- */

let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= import("../vendor/pdfjs/pdf.min.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = asset("../vendor/pdfjs/pdf.worker.min.mjs");
    return pdfjs;
  });
  return pdfjsPromise;
}

let pdfLibPromise = null;
function loadPdfLib() {
  pdfLibPromise ??= import("../vendor/pdf-lib/pdf-lib.esm.min.js");
  return pdfLibPromise;
}

async function openPdf(file) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    cMapUrl: asset("../vendor/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: asset("../vendor/pdfjs/standard_fonts/"),
    wasmUrl: asset("../vendor/pdfjs/wasm/"),
    iccUrl: asset("../vendor/pdfjs/iccs/"),
  });
  try {
    return { task, doc: await task.promise };
  } catch (err) {
    if (err?.name === "PasswordException")
      throw new UserError("This PDF is password-protected — remove the password and try again.");
    throw new UserError("This file doesn't look like a valid PDF.");
  }
}

/* Render every page at `dpi` and JPEG-encode it at each ladder quality.
   Returns per-quality blobs plus page dimensions in PDF points. */
async function renderAtDpi(doc, dpi, qualities, report) {
  const pages = [];
  const totals = new Array(qualities.length).fill(0);
  for (let p = 1; p <= doc.numPages; p++) {
    report(`Rendering page ${p}/${doc.numPages} at ${dpi} DPI…`);
    const page = await doc.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: dpi / 72 });
    const canvas = makeCanvas(Math.max(1, Math.floor(vp.width)), Math.max(1, Math.floor(vp.height)));
    // "print" intent: full fidelity, and rendering keeps going even when the
    // tab is hidden (display intent schedules via rAF, which pauses there).
    await page.render({ canvas, viewport: vp, intent: "print" }).promise;

    const byQuality = [];
    for (let qi = 0; qi < qualities.length; qi++) {
      const blob = await encodeJpeg(canvas, qualities[qi]);
      byQuality.push(blob);
      totals[qi] += blob.size;
    }
    releaseCanvas(canvas);
    page.cleanup();
    pages.push({ widthPt: vp1.width, heightPt: vp1.height, byQuality });
  }
  return { pages, totals };
}

async function assemblePdf(pages, qi) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  out.setProducer("Shrink to Fit (client-side)");
  for (const p of pages) {
    const jpg = await out.embedJpg(new Uint8Array(await p.byQuality[qi].arrayBuffer()));
    const page = out.addPage([p.widthPt, p.heightPt]);
    page.drawImage(jpg, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
  }
  const bytes = await out.save({ useObjectStreams: true });
  return new Blob([bytes], { type: "application/pdf" });
}

async function rasterizePdf(file, target, report) {
  const { task, doc } = await openPdf(file);
  try {
    // Long documents: coarser ladder to bound memory.
    const qualities = doc.numPages > 60 ? PDF_QUALITIES.filter((_, i) => i % 2 === 0) : PDF_QUALITIES;
    const overhead = pdfOverhead(doc.numPages);

    let dpiIndex = 0;
    for (;;) {
      const dpi = PDF_DPIS[dpiIndex];
      const { pages, totals } = await renderAtDpi(doc, dpi, qualities, report);

      let qi = totals.findIndex((t) => t + overhead <= target);
      if (qi === -1) {
        const smallest = totals[totals.length - 1] + overhead;
        // Try a lower resolution if one is predicted to fit (JPEG size ~ pixel area).
        let nextIndex = dpiIndex;
        while (nextIndex + 1 < PDF_DPIS.length) {
          nextIndex++;
          if (smallest * (PDF_DPIS[nextIndex] / dpi) ** 2 <= target * 0.9) break;
        }
        if (nextIndex > dpiIndex) {
          dpiIndex = nextIndex;
          continue; // re-render at the lower DPI
        }
        qi = qualities.length - 1; // give the smallest we can produce
      }

      report("Rebuilding PDF…");
      let blob = await assemblePdf(pages, qi);
      // Container overhead was an estimate; step quality down until it truly fits.
      while (blob.size > target && qi + 1 < qualities.length) {
        qi++;
        blob = await assemblePdf(pages, qi);
      }

      const note = `${doc.numPages} page${doc.numPages > 1 ? "s" : ""} rasterized at ${dpi} DPI, JPEG quality ${Math.round(qualities[qi] * 100)} — text not selectable`;
      return { blob, note };
    }
  } finally {
    task.destroy();
  }
}
