// Shared download-progress plumbing for the transformers.js fallback engines
// (fallbackTranslator.js, fallbackSummarizer.js). Each engine module creates
// one instance at module scope, so every run through that engine reports into
// the same gauge.
//
// Progress goes through a listener set rather than a callback bound at model
// load time, so a second run started during the first download still sees
// progress.

export function createDownloadProgress() {
  const listeners = new Set();

  // transformers.js reports per-file progress events, and a model is several
  // files (weights, tokenizer, config), so sum them into the single 0-1
  // fraction the UI shows. Several models can download through one instance,
  // so entries are keyed per model AND per file. Files announce their totals
  // as they start, which can make the fraction dip when a new large file
  // joins the denominator; harmless, and truthful.
  const fileProgress = new Map();

  // Pass as `progress_callback` when loading a model.
  function reportProgress(event) {
    if (event.status !== "progress" || !event.total) return;
    fileProgress.set(`${event.name}/${event.file}`, {
      loaded: event.loaded,
      total: event.total,
    });
    let loaded = 0;
    let total = 0;
    for (const file of fileProgress.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    if (!total) return;
    const fraction = Math.min(loaded / total, 1);
    for (const listener of listeners) listener(fraction);
  }

  // Subscribe `onDownloadProgress` for the duration of `run`, however it ends.
  async function withProgress(onDownloadProgress, run) {
    const listener = onDownloadProgress
      ? (fraction) => onDownloadProgress(fraction)
      : null;
    if (listener) listeners.add(listener);
    try {
      return await run();
    } finally {
      if (listener) listeners.delete(listener);
    }
  }

  return { reportProgress, withProgress };
}
