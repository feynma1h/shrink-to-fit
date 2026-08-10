/* Shared helpers usable from both the page and workers. */

export const KB = 1024;
export const MB = 1024 * 1024;

/* Errors whose message is safe/useful to show the user verbatim. */
export class UserError extends Error {
  isUser = true;
}

export function formatBytes(n) {
  if (n >= MB) return `${(n / MB).toFixed(n >= 10 * MB ? 1 : 2)} MB`;
  if (n >= KB) return `${Math.round(n / KB)} KB`;
  return `${n} B`;
}

export function outputName(name, ext) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}_compressed.${ext}`;
}

/* One lazy module worker per script URL; each call is a job resolved by id.
   Workers post {id, progress} while running, then {id, done} or
   {id, error, isUser}. */
export function makeJobWorker(url) {
  let worker = null;
  let seq = 0;
  const pending = new Map();
  return (payload, report) => {
    if (!worker) {
      worker = new Worker(url, { type: "module" });
      worker.onmessage = ({ data }) => {
        const job = pending.get(data.id);
        if (!job) return;
        if (data.progress != null) {
          job.report?.(data.progress);
          return;
        }
        pending.delete(data.id);
        if (data.error != null) job.reject(data.isUser ? new UserError(data.error) : new Error(data.error));
        else job.resolve(data.done);
      };
      worker.onerror = (e) => {
        for (const job of pending.values()) job.reject(new Error(e.message || "worker failed to load"));
        pending.clear();
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject, report });
      worker.postMessage({ id, ...payload });
    });
  };
}
