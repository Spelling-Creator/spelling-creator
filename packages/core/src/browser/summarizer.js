// On-device lesson summaries, in two layers (the same shape as translator.js).
//
// Unlike the other AI helpers in this app (aiSuggest.js), nothing here talks to
// the Worker: no Turnstile, no API key, no network round-trip. A local model
// runs on the reader's device, so a summary costs us nothing and the lesson
// text never leaves the machine.
//
// The first choice is the browser's built-in Summarizer API. The trade-off is
// that the API barely exists yet: it's Chromium-only, desktop-only, and gated
// behind hardware minimums (free disk space, VRAM, an unmetered connection for
// the one-time model download). For everyone else there is a second layer:
// Gemma 4 running in the page with transformers.js (fallbackSummarizer.js),
// offered only on hardware whose WebGPU can run it, because its one-time model
// download is about 3 GB. The fallback is reached ONLY through a dynamic
// import() from inside a click handler, and nothing here may static-import it.
// That keeps transformers.js out of every bundle a visitor loads to read a
// lesson, and out of the Worker's server build entirely (vite.config.js stubs
// the chunk out of the SSR graph).
//
// With neither engine possible, every entry point here still FAILS CLOSED: we
// report "unavailable" rather than surfacing an error. The UI
// (LessonSummary.jsx) then renders nothing at all, and a browser that can't
// summarise simply never sees the feature instead of seeing a button that
// breaks.
//
// Spec: https://developer.mozilla.org/en-US/docs/Web/API/Summarizer_API

import { VAKT_LABEL, vaktText } from "../vakt.js";

/**
 * The summary shapes the spec defines, in the order the UI offers them.
 * "key-points" (a bulleted list) is the default: it's the most useful read for a
 * teacher scanning a lesson, and it's what the API itself defaults to.
 */
export const SUMMARY_TYPES = [
  { value: "key-points", label: "Key points" },
  { value: "tldr", label: "TL;DR" },
  { value: "teaser", label: "Teaser" },
  { value: "headline", label: "Headline" },
];

/** The spec's `length` values — relative, not a word count. */
export const SUMMARY_LENGTHS = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];

export const DEFAULT_SUMMARY_TYPE = "key-points";
export const DEFAULT_SUMMARY_LENGTH = "short";

// Steers the model: without it, a lesson full of question prompts and word lists
// reads like a worksheet to summarise rather than a lesson to describe. The
// fallback engine bakes the same instruction into its prompt
// (fallbackSummarizer.js), so both engines summarise for the same reader.
const SHARED_CONTEXT =
  "A spelling and literacy lesson written by a teacher, containing lesson text, " +
  "practice questions and spelling word lists. Summarise it for another teacher " +
  "deciding whether the lesson suits their class.";

// Below this, a lesson has less text than the summary would, so we don't offer
// one — the feature is hidden rather than producing a summary longer than the
// thing it summarises.
export const MIN_SUMMARY_CHARS = 400;

// The API is exposed as a `Summarizer` global. Reach it through `globalThis` so
// this module is safe to import anywhere (and so a bare undeclared global never
// throws a ReferenceError on browsers that don't ship it).
function summarizerApi() {
  return globalThis.Summarizer;
}

/** Does this browser expose the Summarizer API at all? */
export function summarizerSupported() {
  return Boolean(summarizerApi());
}

// The fallback chunk, fetched once on first use. Only a successful load is
// memoised: caching a rejected promise would turn one flaky network moment
// into "summaries are broken until you reload" (same reasoning as
// translator.js).
let fallbackPromise = null;

function loadFallback() {
  if (!fallbackPromise) {
    fallbackPromise = import("./fallbackSummarizer.js").catch((err) => {
      fallbackPromise = null;
      throw err;
    });
  }
  return fallbackPromise;
}

// The hardware bar for the Gemma fallback's GPU adapter. The q4f16 weights
// load as a handful of large GPU buffers, the biggest on the order of 2 GB;
// an adapter that can't allocate and bind buffers of that size (most phones,
// older integrated GPUs) would download all 3 GB only to fail, or crash the
// tab, at load time. Checked on the adapter's limits, which report what the
// hardware CAN raise them to, not the small WebGPU defaults.
const FALLBACK_MIN_BUFFER_BYTES = 2 * 1024 ** 3;
const FALLBACK_MIN_STORAGE_BINDING_BYTES = 1024 ** 3;

// Chromium's Network Information API, absent elsewhere; where it's missing we
// assume the connection is fine rather than hiding the feature from every
// non-Chromium browser. The built-in API refuses its (much smaller) download
// on a metered connection, so a 3 GB one should show at least the same
// manners rather than burning through someone's cellular data.
function meteredConnection() {
  const connection = globalThis.navigator?.connection;
  if (!connection) return false;
  return Boolean(connection.saveData) || connection.type === "cellular";
}

// Can this machine run the Gemma fallback? The built-in engine's hardware bar
// (disk, VRAM, an unmetered connection) is applied by the browser; this probe
// is the fallback's equivalent, so a device is never offered a 3 GB model it
// can't run or shouldn't fetch. It needs WebGPU with f16 shader support (the
// quantisation fallbackSummarizer.js loads is q4f16) on an adapter whose
// limits can hold the weights. The probe is cheap and answerable without
// loading the heavy chunk, and the adapter part is memoised because
// requestAdapter() is async and that answer never changes within a page; the
// connection check stays outside the memo because tethering can start
// mid-visit. Fails closed, like the built-in probe above.
let webGpuProbe = null;

function fallbackPossible() {
  if (!globalThis.navigator?.gpu) return Promise.resolve(false);
  if (meteredConnection()) return Promise.resolve(false);
  if (!webGpuProbe) {
    webGpuProbe = navigator.gpu
      .requestAdapter()
      .then(
        (adapter) =>
          Boolean(adapter?.features?.has("shader-f16")) &&
          adapter.limits.maxBufferSize >= FALLBACK_MIN_BUFFER_BYTES &&
          adapter.limits.maxStorageBufferBindingSize >=
            FALLBACK_MIN_STORAGE_BINDING_BYTES,
      )
      .catch(() => false);
  }
  return webGpuProbe;
}

// The options passed to both availability() and create(). We deliberately leave
// the language options (expectedInputLanguages / outputLanguage) unset: naming a
// language the local model doesn't have makes create() throw NotSupportedError,
// whereas leaving them out lets the browser detect the lesson's language and
// answer in it.
function summarizerOptions({ type, length }) {
  return {
    type: type || DEFAULT_SUMMARY_TYPE,
    length: length || DEFAULT_SUMMARY_LENGTH,
    format: "markdown",
    sharedContext: SHARED_CONTEXT,
  };
}

// What the built-in API says about these options, failing closed: a missing
// API, unsupported options or a probe that throws all collapse to
// "unavailable", which hands the decision to the fallback probe.
async function builtInAvailability(options) {
  const api = summarizerApi();
  if (!api) return "unavailable";
  try {
    return (
      (await api.availability(summarizerOptions(options))) || "unavailable"
    );
  } catch {
    return "unavailable";
  }
}

/**
 * Can this device summarise with these options, with which engine, and is the
 * model ready?
 *
 * @param {{type?: string, length?: string}} [options]
 * @returns {Promise<{availability: string, engine: "browser"|"gemma"|null}>}
 *   availability is one of:
 *   "available":    ready to run now.
 *   "downloadable": supported, but the first run downloads the model.
 *   "downloading":  supported, and a download is already in flight.
 *   "unavailable":  neither engine can run here.
 *   engine is "browser" for the built-in Summarizer API, "gemma" for the
 *   transformers.js fallback, null when unavailable. The fallback always
 *   reports "downloadable": the first run's 3 GB download is the state worth
 *   warning about, and we can't cheaply tell whether the browser still has it
 *   cached (a cached model just makes that phase instant).
 */
export async function summarizerAvailability(options = {}) {
  const builtIn = await builtInAvailability(options);
  if (builtIn !== "unavailable") {
    return { availability: builtIn, engine: "browser" };
  }
  if (await fallbackPossible()) {
    return { availability: "downloadable", engine: "gemma" };
  }
  return { availability: "unavailable", engine: null };
}

/**
 * Create a summariser session: the browser's built-in Summarizer when it can
 * take these options, otherwise Gemma 4 in the page via the fallback chunk.
 *
 * Must be called from a user gesture (a click): the built-in API requires
 * transient activation, and the fallback's download is far too heavy to start
 * uninvited.
 *
 * @param {{type?: string, length?: string}} options
 * @param {object} [hooks]
 * @param {AbortSignal} [hooks.signal]  Aborts creation. The built-in engine
 *   also aborts its model download; the fallback's download can't be
 *   interrupted once it has started, so there the signal is checked before
 *   the download begins (an aborted run never starts a 3 GB fetch) and again
 *   when it ends.
 * @param {(loaded: number) => void} [hooks.onDownloadProgress]  Download fraction, 0-1.
 * @param {(engine: "browser"|"gemma") => void} [hooks.onEngine]  Called with
 *   the engine actually being opened, before that engine does any heavy
 *   work. The built-in engine can pass the availability probe and still
 *   refuse create(), in which case this fires again with "gemma" BEFORE the
 *   fallback's 3 GB download starts: the caller's chance to switch its
 *   wording, or to abort and wait for an informed click (what
 *   LessonSummary.jsx does when the reader was never warned about the
 *   download).
 * @returns {Promise<object>} The session. Call `.destroy()` when done. A
 *   fallback session carries `engine: "gemma"`; a built-in one has no engine
 *   property.
 */
export async function createSummarizer(options = {}, hooks = {}) {
  if ((await builtInAvailability(options)) !== "unavailable") {
    hooks.onEngine?.("browser");
    try {
      return await summarizerApi().create({
        ...summarizerOptions(options),
        signal: hooks.signal,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            hooks.onDownloadProgress?.(event.loaded);
          });
        },
      });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      // The probe said yes but create() said no (a download that failed, an
      // option combination the model turned down): the fallback gets its
      // chance below, if this machine can run it.
      if (!(await fallbackPossible())) throw err;
    }
  }

  if (!(await fallbackPossible())) {
    throw new Error("This browser can't summarise on-device.");
  }
  // The engine is decided now: say so before any heavy work, so the caller
  // can re-warn (or abort, which the next check honours) ahead of the
  // fallback's download rather than find out when the session arrives.
  hooks.onEngine?.("gemma");
  if (hooks.signal?.aborted) {
    throw new DOMException("Summary aborted.", "AbortError");
  }
  const fallback = await loadFallback();
  return fallback.createFallbackSummarizer(options, hooks);
}

/**
 * Stream a summary of `text`, yielding each chunk as the model produces it, so
 * the UI can render the summary as it's written instead of after it's finished.
 * Works on either engine's session: the built-in API returns a ReadableStream
 * and the fallback an async generator, and both are async iterables.
 *
 * @param {object} summarizer  A session from createSummarizer().
 * @param {string} text
 * @param {{signal?: AbortSignal}} [options]
 * @returns {AsyncIterable<string>} Successive chunks — concatenate them.
 */
export function summarizeStream(summarizer, text, options = {}) {
  return summarizer.summarizeStreaming(text, { signal: options.signal });
}

/**
 * Trim `text` to the session's input budget.
 *
 * The model can only take so much input (`inputQuota`, in the same opaque units
 * measureInputUsage() reports); a long lesson can exceed it, and summarize() then
 * throws QuotaExceededError. Usage tracks length closely enough that scaling the
 * text down by the overshoot ratio (with headroom) converges in a couple of
 * passes, so we cut the tail rather than fail — a summary of most of the lesson
 * beats no summary. The caller tells the reader when we've had to cut.
 *
 * @returns {Promise<{text: string, truncated: boolean}>}
 */
export async function fitToQuota(summarizer, text) {
  const quota = summarizer.inputQuota;
  if (
    typeof summarizer.measureInputUsage !== "function" ||
    !Number.isFinite(quota)
  ) {
    return { text, truncated: false };
  }

  let candidate = text;
  // Bounded: each pass shrinks the text, and in practice one or two suffice.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let usage;
    try {
      usage = await summarizer.measureInputUsage(candidate);
    } catch {
      // Can't measure — hand it over as-is and let summarize() decide.
      return { text: candidate, truncated: candidate.length < text.length };
    }
    if (!(usage > quota) || !usage) {
      return { text: candidate, truncated: candidate.length < text.length };
    }
    const ratio = (quota / usage) * 0.9; // 10% headroom
    const cut = Math.max(1, Math.floor(candidate.length * ratio));
    candidate = candidate.slice(0, cut);
  }
  return { text: candidate, truncated: true };
}

/**
 * The lesson document as the text we hand the model.
 *
 * This is deliberately NOT `lessonPlainText()` (LessonView.jsx), which flattens a
 * lesson into prose for a meta description. Here the structure is the point: the
 * title and section headings tell the model how the lesson is organised, and
 * labelling the questions and word lists stops a bare list of words reading as
 * body text. Image captions stay out — they're usually attribution boilerplate.
 *
 * @param {object} doc  The lesson body: { title, sections: [{ name, blocks }] }.
 * @returns {string} Markdown-ish plain text in reading order.
 */
export function lessonSummaryText(doc) {
  const parts = [];
  if (doc?.title) parts.push(`# ${doc.title}`);

  for (const section of doc?.sections || []) {
    if (section.name) parts.push(`## ${section.name}`);
    for (const block of section.blocks || []) {
      if (block.type === "text" && block.text) {
        parts.push(block.text);
      } else if (block.type === "question" && block.prompt) {
        parts.push(`Question: ${block.prompt}`);
      } else if (block.type === "spelling") {
        const words = (block.words || [])
          .map((word) => (word.text || "").trim())
          .filter(Boolean);
        if (words.length) parts.push(`Spelling words: ${words.join(", ")}`);
      } else if (block.type === "vakt") {
        // The activity, not its links: a summary wants the prose, and a URL
        // read by a language model is bulk with no meaning in it.
        const activity = vaktText(block);
        if (activity) parts.push(`${VAKT_LABEL} ${activity}`);
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * A message worth showing a reader, given whatever create()/summarize() threw.
 * The spec's DOMException names are the useful signal here; everything else falls
 * back to a generic line rather than leaking an internal message.
 */
export function summarizerErrorMessage(error) {
  switch (error?.name) {
    case "NotAllowedError":
      return "Summarising is blocked on this page.";
    case "NotSupportedError":
      return "This lesson's language isn't supported by the on-device model.";
    case "QuotaExceededError":
      return "This lesson is too long for the on-device model.";
    case "NetworkError":
      return "The model download didn't finish. Check your connection and try again.";
    case "UnknownError":
    case "OperationError":
      return "The on-device model couldn't summarise this lesson. Try again.";
    default:
      return "Couldn't summarise this lesson.";
  }
}
