/* Shared image-compression engine. Runs on the main thread (fallback) or
   inside image-worker.js (preferred) — so it only uses APIs available in both. */

import { UserError } from "./utils.js";

const QUALITY_MIN = 20;
const QUALITY_MAX = 95;
const MIN_DIMENSION = 150;
const MAX_AREA = 32e6; // pre-scale gigantic sources so canvas limits aren't hit

const hasOffscreen = typeof OffscreenCanvas !== "undefined" &&
  typeof OffscreenCanvas.prototype.convertToBlob === "function";

export function makeCanvas(w, h) {
  if (hasOffscreen) return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

/* JPEG-encode any canvas type. OffscreenCanvas encodes off the main thread. */
export function encodeJpeg(canvas, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/jpeg", quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new UserError("The browser could not encode this image (it may be too large).")),
      "image/jpeg",
      quality
    );
  });
}

function drawScaled(source, scale) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // flatten transparency to white
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/* Binary search between prior bounds for the highest quality that fits. */
async function refineQuality(canvas, target, known) {
  let lo = QUALITY_MIN + 1, hi = QUALITY_MAX - 1;
  let best = known.fit;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const blob = await encodeJpeg(canvas, mid / 100);
    if (blob.size <= target) {
      best = { blob, quality: mid };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/* Compress a drawable source (ImageBitmap or <img>) to fit `target` bytes.
   Bounds-first: probe q95 (maybe everything fits) and q20 (maybe nothing
   does — then downscale immediately instead of wasting a full search at a
   resolution that can never fit). */
export async function compressDrawable(source, target, report = () => {}) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  let scale = 1;
  if (sw * sh > MAX_AREA) scale = Math.sqrt(MAX_AREA / (sw * sh));

  for (;;) {
    const canvas = drawScaled(source, scale);
    const dims = `${canvas.width}×${canvas.height}`;
    const resized = scale < 1 ? `, resized to ${dims}` : "";
    report(scale === 1 ? "Compressing…" : `Compressing at ${dims}…`);

    const atMax = await encodeJpeg(canvas, QUALITY_MAX / 100);
    if (atMax.size <= target) {
      releaseCanvas(canvas);
      return { blob: atMax, note: `JPEG quality ${QUALITY_MAX}${resized}`, warn: null };
    }

    const atMin = await encodeJpeg(canvas, QUALITY_MIN / 100);
    if (atMin.size <= target) {
      const best = await refineQuality(canvas, target, { fit: { blob: atMin, quality: QUALITY_MIN } });
      releaseCanvas(canvas);
      return { blob: best.blob, note: `JPEG quality ${best.quality}${resized}`, warn: null };
    }

    // Even the lowest quality overshoots: scale dimensions down and retry.
    const next = scale * Math.max(0.4, Math.sqrt(target / atMin.size) * 0.95);
    if (Math.round(sw * next) < MIN_DIMENSION || Math.round(sh * next) < MIN_DIMENSION) {
      releaseCanvas(canvas);
      return {
        blob: atMin,
        note: `JPEG quality ${QUALITY_MIN}${resized}`,
        warn: `Couldn't reach the target without making the image tiny — smallest achievable was ${Math.round(atMin.size / 1024)} KB.`,
      };
    }
    releaseCanvas(canvas);
    scale = next;
  }
}
