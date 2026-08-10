/* Image compression worker — keeps the page responsive while encoding. */

import { compressDrawable } from "./image-engine.js";
import { UserError } from "./utils.js";

self.onmessage = async ({ data: { id, file, target } }) => {
  let bitmap = null;
  try {
    try {
      bitmap = await createImageBitmap(file); // EXIF orientation applied per spec
    } catch {
      throw new UserError("This browser can't decode this image format.");
    }
    const result = await compressDrawable(bitmap, target, (msg) => self.postMessage({ id, progress: msg }));
    self.postMessage({ id, done: result });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err), isUser: err?.isUser === true });
  } finally {
    bitmap?.close();
  }
};
