// On-device translation for comments and lessons, in two layers.
//
// The first choice is the browser's built-in Translator API (with its companion
// LanguageDetector API): Chromium-only, local, free, in the same family as the
// Summarizer API that lesson summaries use (summarizer.ts). Where the two
// features differ is what happens when the API is missing: a summary is a
// nicety, so the summariser fails closed and hides itself, but not being able
// to read a comment at all is worth a heavier fallback. So when the browser
// can't translate a pair, we fall back to running a translation model in the
// page with transformers.js (fallbackTranslator.ts): a small per-pair Opus-MT
// model for the into-English pairs opusMtModels.ts lists, NLLB-200 for every
// other pair.
//
// The fallback is a large download (the library plus quantised models:
// ~110-140 MB for an Opus-MT pair or ~600 MB for NLLB, and ~280 MB to
// detect), so it is reached ONLY through a dynamic
// import() from inside a click
// handler, and nothing here may static-import it. That keeps transformers.js
// out of every bundle a visitor loads to read a lesson, and out of the Worker's
// server build entirely (vite.config.js stubs the chunk out of the SSR graph).
//
// Both engines translate plain text, not markup, which is why translation works
// on the comment's text *blocks* (textBlocksForTranslation) rather than its
// HTML: each paragraph/heading/list item is translated as one string, and the
// UI renders the results as plain paragraphs. The original rich text is one
// "Show original" away, so nothing is lost.
//
// Specs: https://developer.mozilla.org/en-US/docs/Web/API/Translator_API

import { isRichTextHtml } from "../richText.ts";
import {
  languageForTag,
  sameTranslationLanguage,
  sourceLanguageChoices,
} from "../translationLanguages.ts";

export { sameTranslationLanguage, sourceLanguageChoices };

// The DOM lib doesn't describe the browser's built-in AI APIs yet, so the
// parts this module and summarizer.ts use are described here.

/** What a built-in AI API says about whether it can run. */
export type BuiltInAvailability =
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

/** The monitor a built-in API's create() hands to its `monitor` option. */
export interface CreateMonitor {
  addEventListener(
    type: "downloadprogress",
    listener: (event: ProgressEvent) => void,
  ): void;
}

interface LanguageDetector {
  detect(input: string): Promise<{ detectedLanguage?: string }[]>;
  destroy?(): void;
}

/** The browser's LanguageDetector global. */
export interface LanguageDetectorApi {
  availability(): Promise<BuiltInAvailability>;
  create(options?: { signal?: AbortSignal }): Promise<LanguageDetector>;
}

interface BuiltInTranslator {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
}

interface TranslatorApi {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<BuiltInAvailability>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    signal?: AbortSignal;
    monitor?(monitor: CreateMonitor): void;
  }): Promise<BuiltInTranslator>;
}

/** Which engine translated: the built-in API or one of the in-page models. */
export type TranslationEngine = "browser" | "opus-mt" | "nllb";

export interface TranslateOptions {
  /**
   * BCP-47, from detectLanguage() or picked by the reader
   * (sourceLanguageChoices). Missing when detection couldn't tell.
   */
  sourceLanguage?: string | null;
  /** BCP-47, the reader's language. */
  targetLanguage: string;
  signal?: AbortSignal;
  /**
   * 0-1 fraction, reported while whichever engine runs downloads a model. May
   * restart from 0 when the browser pair turns out to need the fallback after
   * all.
   */
  onDownloadProgress?: (loaded: number) => void;
}

export interface TranslationResult {
  blocks: string[];
  engine: TranslationEngine;
}

/** An error whose message was written for the reader (see readerError). */
export interface ReaderError extends Error {
  readerFacing: true;
  code?: string;
}

/**
 * The `code` on errors that came from the source language: detection couldn't
 * name it, or named one translation doesn't cover. Detection is a guess, so a
 * wrong guess lands here too, and the reader can recover by choosing the source
 * themselves (see sourceLanguageChoices).
 */
export const SOURCE_LANGUAGE_ERROR = "source-language";

// The APIs are exposed as globals; reach them through `globalThis` so importing
// this module never throws on browsers that don't ship them.
const aiGlobals = globalThis as typeof globalThis & {
  Translator?: TranslatorApi;
  LanguageDetector?: LanguageDetectorApi;
};

function translatorApi() {
  return aiGlobals.Translator;
}

function detectorApi() {
  return aiGlobals.LanguageDetector;
}

// The `name` of whatever was thrown, read as `err?.name` would.
function errorName(err: unknown): unknown {
  return typeof err === "object" && err !== null && "name" in err
    ? err.name
    : undefined;
}

// The fallback chunk, fetched once on first use. Only a successful load is
// memoised: caching a rejected promise would turn one flaky network moment into
// "translation is broken until you reload" (same reasoning as lib/exports/load.js
// in the web app).
let fallbackPromise: Promise<typeof import("./fallbackTranslator.ts")> | null =
  null;

function loadFallback() {
  if (!fallbackPromise) {
    fallbackPromise = import("./fallbackTranslator.ts").catch((err) => {
      fallbackPromise = null;
      throw err;
    });
  }
  return fallbackPromise;
}

/**
 * A comment body as translatable text blocks, one per paragraph-ish unit.
 *
 * Rich-text bodies are parsed (DOMParser, so browser-only; fine, translation
 * is click-driven), every block element gets a trailing newline, and the body
 * is then read as text and split on those newlines. Appending rather than
 * selecting is what keeps this correct however the markup nests: tiptap wraps
 * a list item's text in a paragraph, but a sanitized body may equally carry
 * bare "<li>one</li><li>two</li>", and either way each item is its own block
 * instead of "onetwo". Nested blocks just stack newlines, which the blank-line
 * filter drops, so nothing is ever counted twice. Legacy plain-text comments
 * split on their own line breaks.
 *
 * @param value  The stored body: rich-text HTML or a plain string.
 * @returns Non-empty text blocks in reading order.
 */
export function textBlocksForTranslation(
  value: string | null | undefined,
): string[] {
  if (!value) return [];
  const toLines = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  if (!isRichTextHtml(value)) return toLines(value);

  const doc = new DOMParser().parseFromString(value, "text/html");
  // A hard break inside a paragraph should stay a break, not two words fused.
  for (const br of doc.body.querySelectorAll("br")) {
    br.replaceWith("\n");
  }
  const blockElements = doc.body.querySelectorAll(
    "p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, ul, ol",
  );
  for (const el of blockElements) {
    el.append("\n");
  }
  return toLines(doc.body.textContent || "");
}

/**
 * Best guess at the language `text` is written in, as a BCP-47 tag, or null
 * when no engine can tell.
 *
 * Asks the browser's LanguageDetector first; when that API is missing or
 * undecided, falls back to the fallback chunk's XLM-RoBERTa detector. That
 * detector is a one-time model download of its own, which is why this takes
 * the same onDownloadProgress as translateBlocks, and why it is still only
 * called from the click that would need the fallback to translate anyway.
 */
export async function detectLanguage(
  text: string,
  {
    signal,
    onDownloadProgress,
  }: {
    signal?: AbortSignal;
    onDownloadProgress?: (loaded: number) => void;
  } = {},
): Promise<string | null> {
  const api = detectorApi();
  if (api) {
    try {
      if ((await api.availability()) !== "unavailable") {
        const detector = await api.create({ signal });
        try {
          const [best] = await detector.detect(text);
          if (best?.detectedLanguage && best.detectedLanguage !== "und") {
            return best.detectedLanguage;
          }
        } finally {
          detector.destroy?.();
        }
      }
    } catch (err) {
      if (errorName(err) === "AbortError") throw err;
      // A detector that breaks is the same as no detector: try the fallback.
    }
  }
  const fallback = await loadFallback();
  return fallback.detectLanguage(text, { signal, onDownloadProgress });
}

// Can the built-in Translator handle this pair? Fails closed: a missing API, an
// unknown pair or a probe that throws all mean "use the fallback".
async function browserPairAvailability(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<BuiltInAvailability> {
  const api = translatorApi();
  if (!api) return "unavailable";
  try {
    return (
      (await api.availability({ sourceLanguage, targetLanguage })) ||
      "unavailable"
    );
  } catch {
    return "unavailable";
  }
}

async function translateWithBrowser(
  blocks: string[],
  options: TranslateOptions & { sourceLanguage: string },
) {
  const { sourceLanguage, targetLanguage, signal, onDownloadProgress } =
    options;
  // Only called once browserPairAvailability found the API.
  const translator = await translatorApi()!.create({
    sourceLanguage,
    targetLanguage,
    signal,
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        onDownloadProgress?.(event.loaded);
      });
    },
  });
  try {
    const out: string[] = [];
    for (const block of blocks) {
      out.push(await translator.translate(block, { signal }));
    }
    return out;
  } finally {
    translator.destroy?.();
  }
}

// An error whose message was written for the reader, so translationErrorMessage
// can pass it through instead of hiding it behind the generic line. `code`
// marks the errors a reader can fix by picking the source language themselves.
function readerError(message: string, code?: string): ReaderError {
  const error: ReaderError = Object.assign(new Error(message), {
    readerFacing: true as const,
  });
  if (code) error.code = code;
  return error;
}

function isReaderError(error: unknown): error is ReaderError {
  return (
    typeof error === "object" &&
    error !== null &&
    "readerFacing" in error &&
    Boolean(error.readerFacing)
  );
}

/**
 * Translate text blocks into `targetLanguage`, on this device.
 *
 * Tries the browser's Translator API for the pair first; anything it can't do
 * falls through to an in-page model via transformers.js (Opus-MT or NLLB,
 * fallbackTranslator.ts's pick). Call from a click
 * handler: the built-in API wants transient activation for a model download,
 * and the fallback's download is far too heavy to start uninvited.
 *
 * @param blocks  From textBlocksForTranslation().
 */
export async function translateBlocks(
  blocks: string[],
  options: TranslateOptions,
): Promise<TranslationResult> {
  const { sourceLanguage, targetLanguage } = options;
  if (!sourceLanguage) {
    throw readerError(
      "Couldn't tell what language this is in.",
      SOURCE_LANGUAGE_ERROR,
    );
  }

  const availability = await browserPairAvailability(
    sourceLanguage,
    targetLanguage,
  );
  if (availability !== "unavailable") {
    try {
      return {
        blocks: await translateWithBrowser(blocks, {
          ...options,
          sourceLanguage,
        }),
        engine: "browser",
      };
    } catch (err) {
      if (errorName(err) === "AbortError") throw err;
      // The probe said yes but the run said no (a download that failed, a pair
      // the model turned down): the fallback gets its chance below.
    }
  }

  // The fallback needs both languages in its table; the reader's language not
  // being there is the one we can say something useful about.
  if (!languageForTag(targetLanguage)) {
    throw readerError("Your language isn't supported for translation.");
  }
  if (!languageForTag(sourceLanguage)) {
    throw readerError(
      "This language isn't supported for translation.",
      SOURCE_LANGUAGE_ERROR,
    );
  }

  const fallback = await loadFallback();
  return fallback.translateBlocks(blocks, { ...options, sourceLanguage });
}

/**
 * A message worth showing a reader, given whatever translation threw. Errors
 * thrown above carry their own reader-facing text; everything else falls back
 * to a generic line rather than leaking an internal message.
 */
export function translationErrorMessage(error: unknown): string {
  if (isReaderError(error)) return error.message;
  switch (errorName(error)) {
    case "NetworkError":
      return "The translation model download didn't finish. Check your connection and try again.";
    case "QuotaExceededError":
      return "This text is too long for on-device translation.";
    default:
      return "Couldn't translate this.";
  }
}
