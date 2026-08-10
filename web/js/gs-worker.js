/* Ghostscript (WASM) worker — text-preserving PDF compression.
   Tries a descending image-resolution ladder and reports the first output
   that fits the target, or the smallest one achieved if none does. */

/* Image resolutions to try, in DPI (high → low). Monochrome (line art /
   fax-style) images keep 2× the color resolution, capped at 300. */
const LADDER = [200, 150, 110, 85, 72, 55];
/* Two rungs in a row shrinking by <2% means the file is text/font-bound
   and lower image DPI won't help — bail out early. */
const PLATEAU = 0.98;

let factoryPromise = null;
function loadFactory() {
  factoryPromise ??= import("../vendor/ghostscript/gs.js").then((m) => m.default);
  return factoryPromise;
}

/* Fresh instance per document: callMain is reusable across runs, but the
   WASM heap grows and never shrinks, so re-instantiating between documents
   frees it. The compiled module itself comes from the browser's code cache. */
async function instantiate() {
  const factory = await loadFactory();
  return factory({
    locateFile: (path) => new URL(`../vendor/ghostscript/${path}`, self.location.href).href,
    print: () => {},
    printErr: () => {},
  });
}

function gsArgs(res) {
  return [
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.5",
    "-dNOPAUSE", "-dBATCH", "-dQUIET", "-dSAFER",
    "-dAutoRotatePages=/None",
    "-dDetectDuplicateImages=true",
    "-dPDFSETTINGS=/ebook", // sane global defaults; resolutions below override it
    `-dColorImageResolution=${res}`,
    `-dGrayImageResolution=${res}`,
    `-dMonoImageResolution=${Math.min(300, res * 2)}`,
    "-dColorImageDownsampleThreshold=1.0",
    "-dGrayImageDownsampleThreshold=1.0",
    "-dMonoImageDownsampleThreshold=1.0",
    "-o", "/out.pdf",
    "/in.pdf",
  ];
}

self.onmessage = async ({ data: { id, file, target } }) => {
  try {
    const input = new Uint8Array(await file.arrayBuffer());
    const gs = await instantiate();
    gs.FS.writeFile("/in.pdf", input);

    let best = null; // smallest output seen, even if over target
    let prevSize = Infinity;
    let plateau = 0;

    for (const res of LADDER) {
      self.postMessage({ id, progress: `Ghostscript: images at ${res} DPI…` });
      let code;
      try {
        code = gs.callMain(gsArgs(res));
      } catch (err) {
        code = err?.status ?? -1; // Emscripten ExitStatus
      }
      let out = null;
      try {
        out = gs.FS.readFile("/out.pdf");
        gs.FS.unlink("/out.pdf");
      } catch {}
      if (code !== 0 || !out || out.length === 0) continue;

      if (!best || out.length < best.size) best = { size: out.length, dpi: res, bytes: out };
      if (out.length <= target && out.length < input.length) {
        self.postMessage({
          id,
          done: { fit: true, dpi: res, blob: new Blob([out], { type: "application/pdf" }) },
        });
        return;
      }
      plateau = out.length >= prevSize * PLATEAU ? plateau + 1 : 0;
      if (plateau >= 2) break; // size is dominated by text/fonts, not images
      prevSize = out.length;
    }

    self.postMessage({
      id,
      done: {
        fit: false,
        best: best
          ? { dpi: best.dpi, size: best.size, blob: new Blob([best.bytes], { type: "application/pdf" }) }
          : null,
      },
    });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
