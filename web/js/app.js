/* Image & PDF compressor — everything runs locally in this browser tab.
   No uploads, no analytics, no cookies. UI + job dispatch live here;
   the compression itself is in image-engine.js / pdf-engine.js. */

import { formatBytes, KB, MB, makeJobWorker, outputName, UserError } from "./utils.js";
import { compressDrawable } from "./image-engine.js";
import { compressPdf } from "./pdf-engine.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const targetValueEl = document.getElementById("target-value");
const targetUnitEl = document.getElementById("target-unit");
const resultsEl = document.getElementById("results");
const downloadAllBtn = document.getElementById("download-all");

function targetBytes() {
  const v = parseFloat(targetValueEl.value);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v * (targetUnitEl.value === "MB" ? MB : KB));
}

/* ---------- image compression (worker when possible) ---------- */

const supportsWorker =
  typeof Worker !== "undefined" &&
  typeof OffscreenCanvas !== "undefined" &&
  typeof OffscreenCanvas.prototype.convertToBlob === "function";

const runImageJob = makeJobWorker(new URL("image-worker.js", import.meta.url));

async function compressImage(file, target, report) {
  if (supportsWorker) {
    return runImageJob({ file, target }, report);
  }
  // Fallback: decode via <img> (EXIF-oriented) and compress on the main thread.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new UserError("This browser can't decode this image format.");
    });
    return await compressDrawable(img, target, report);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- result cards ---------- */

function makeCard(file) {
  const li = document.createElement("li");
  li.className = "card";
  li.innerHTML = `
    <div class="card-head">
      <span class="card-name"></span>
      <span class="card-sizes"><span class="orig"></span><span class="arrow" hidden>→</span><span class="final"></span></span>
    </div>
    <p class="card-status" role="status">Queued…</p>
    <p class="card-note" hidden></p>
    <p class="card-warn" hidden></p>
    <div class="card-actions" hidden><a class="download btn" download>Download</a></div>`;
  li.querySelector(".card-name").textContent = file.name;
  li.querySelector(".orig").textContent = formatBytes(file.size);
  resultsEl.prepend(li);
  return {
    status: (msg) => (li.querySelector(".card-status").textContent = msg),
    done({ blob, name, note, warn, savedPct }) {
      li.classList.add("done");
      li.querySelector(".card-status").hidden = true;
      li.querySelector(".arrow").hidden = false;
      li.querySelector(".final").textContent = `${formatBytes(blob.size)}${savedPct != null ? ` (−${savedPct}%)` : ""}`;
      if (note) {
        const el = li.querySelector(".card-note");
        el.textContent = note;
        el.hidden = false;
      }
      if (warn) {
        const el = li.querySelector(".card-warn");
        el.textContent = warn;
        el.hidden = false;
        li.classList.add("warned");
      }
      const a = li.querySelector(".download");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      li.querySelector(".card-actions").hidden = false;
      updateDownloadAll();
    },
    fail(message) {
      li.classList.add("failed");
      const st = li.querySelector(".card-status");
      st.textContent = message;
      st.hidden = false;
    },
  };
}

function updateDownloadAll() {
  downloadAllBtn.hidden = resultsEl.querySelectorAll(".card.done").length < 2;
}

downloadAllBtn.addEventListener("click", () => {
  for (const a of resultsEl.querySelectorAll(".card.done .download")) a.click();
});

/* ---------- queue ---------- */

const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isImage = (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif|svg)$/i.test(f.name);

let queue = Promise.resolve();

function enqueue(file, target) {
  const card = makeCard(file);
  queue = queue.then(async () => {
    try {
      if (file.size <= target) {
        card.done({
          blob: file,
          name: file.name,
          note: "Already at or under the target — original kept unchanged.",
          savedPct: null,
        });
        return;
      }
      let result;
      if (isPdf(file)) result = await compressPdf(file, target, card.status);
      else if (isImage(file)) result = await compressImage(file, target, card.status);
      else throw new UserError("Unsupported file type — drop images or PDFs.");
      card.done({
        blob: result.blob,
        name: outputName(file.name, isPdf(file) ? "pdf" : "jpg"),
        note: result.note,
        warn: result.warn,
        savedPct: Math.max(0, Math.round(100 - (result.blob.size / file.size) * 100)),
      });
    } catch (err) {
      console.error(err);
      card.fail(err instanceof UserError ? err.message : "Something went wrong while compressing this file.");
    }
  });
}

function handleFiles(files) {
  const target = targetBytes();
  if (target == null) {
    targetValueEl.reportValidity();
    targetValueEl.focus();
    return;
  }
  for (const file of files) enqueue(file, target);
}

/* ---------- dropzone & settings wiring ---------- */

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => {
  handleFiles([...fileInput.files]);
  fileInput.value = "";
});
["dragenter", "dragover"].forEach((t) =>
  dropzone.addEventListener(t, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragging");
  })
);
["dragleave", "drop"].forEach((t) =>
  dropzone.addEventListener(t, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
  })
);
dropzone.addEventListener("drop", (e) => handleFiles([...e.dataTransfer.files]));

/* remember the last target (stored locally in this browser only) */
try {
  const saved = JSON.parse(localStorage.getItem("target") ?? "null");
  if (saved) {
    targetValueEl.value = saved.value;
    targetUnitEl.value = saved.unit;
  }
} catch {}
for (const el of [targetValueEl, targetUnitEl]) {
  el.addEventListener("change", () => {
    localStorage.setItem("target", JSON.stringify({ value: targetValueEl.value, unit: targetUnitEl.value }));
  });
}
