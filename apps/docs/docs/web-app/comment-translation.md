---
title: Comment translation (on-device AI)
---

# Comment translation (on-device AI)

Any comment on a lesson's **Discussion** tab can be translated into the reader's
own language, **on the reader's device**. Nothing is sent to a server. Every
comment with text shows a **Translate** action (next to Reply/Edit, but with no
sign-in needed: comments read publicly, so they translate publicly too). Clicking
it swaps the comment body for the translation, with a note saying what language
it came from and a **Show original** toggle, so the real comment is never more
than a click away.

Like [lesson summaries](./lesson-summaries.md), this runs on browser-local
models. Unlike summaries, it doesn't hide when the browser can't do it (not
being able to read a comment at all is worth a heavier fallback), so it has two
engines:

1. **The browser's built-in [Translator API](https://developer.mozilla.org/en-US/docs/Web/API/Translator_API)**
   (Chromium 138+). Fast, free, local; the browser fetches a small language pack
   per pair on first use.
2. **[NLLB-200 (distilled, 600M)](https://huggingface.co/Xenova/nllb-200-distilled-600M)
   running in the page with [transformers.js](https://huggingface.co/docs/transformers.js)**,
   for every other browser, and for pairs the built-in API turns down. Still
   local, since the model runs in the tab, but the first use downloads a
   **~600 MB quantised model** (then cached in browser storage, so it's a
   one-time cost per device). A progress bar under the comment shows the
   download.

## How it works

```
CommentsSection.jsx                    the Translate action, per-comment state, skeleton + progress
  └── core/browser/translator          blocks from HTML, detection, engine choice (no React)
        └── core/browser/nllbTranslator  the fallback: transformers.js + NLLB + an XLM-RoBERTa detector
              (lazy: dynamic import(), its own chunk, never in the main bundle)
```

1. **Blocks, not markup.** Comments are stored as sanitized
   [rich text](./rich-text.md), but both engines translate plain strings. So
   `textBlocksForTranslation()` parses the body and takes each paragraph,
   heading, list item and code block as one string (legacy plain-text comments
   split on their line breaks). The translation renders as plain paragraphs;
   formatting isn't carried over, but it isn't lost either, because
   **Show original** brings the rich text back.
2. **Detect the source.** The browser's LanguageDetector API where it exists,
   otherwise an
   [XLM-RoBERTa language-detection model](https://huggingface.co/onnx-community/xlm-roberta-base-language-detection-ONNX)
   (the `papluca/xlm-roberta-base-language-detection` fine-tune, converted for
   transformers.js) running in the lazy fallback chunk. That detector is a
   quantised ~280 MB one-time download of its own, reported through the same
   progress bar and cached the same way. If the comment is already in the
   reader's language, a toast says so and nothing is translated.
3. **Pick the engine.** `Translator.availability({sourceLanguage, targetLanguage})`
   decides: anything usable runs in the browser's own translator, everything
   else falls through to NLLB. The target language is the app language
   (i18next's `resolvedLanguage`, see
   [internationalization](./internationalization.md)).
4. **Translate.** Block by block, showing a [skeleton](./overview.md) where the
   body was. Results live in component state only; translations are per-reader
   and per-visit, never stored.

## The language table

The parties involved name languages differently: the browser APIs speak BCP-47
(`es`), and so does the XLM-RoBERTa detector (its labels are bare two-letter
codes), while NLLB wants FLORES-200 codes (`spa_Latn`).
`@spelling-creator/core/translationLanguages` is the one table tying the two
together, currently around forty widely used languages, a deliberate subset of
NLLB's two hundred. Adding a language is adding a row;
`translationLanguages.test.js` checks the table stays consistent and covers
every label the detector can answer with.

A language is only a possible _source_ when a detector can name it: the
browser's LanguageDetector covers the whole table, while the fallback detector
classifies twenty languages. A comment in, say, Ukrainian still translates
wherever the LanguageDetector API exists, even when the translation itself runs
on NLLB; without that API the detector can't name the source and translation
says so.

The built-in Translator API is not limited by this table. It's only consulted
for the fallback, and for the "already in your language" check.

## Keeping the heavy path out of every bundle

transformers.js and its ONNX runtime are far too big to ride along with the app.
`nllbTranslator.js` is therefore reached **only** through a memoised dynamic
`import()` inside `translator.js` (the same pattern as the
[export pipeline](./export-pipeline.md)'s `lib/exports/load.js`, and with the
same rule: a failed load isn't cached, so the next click retries). Three guards
keep it contained:

- Nothing may static-import `nllbTranslator.js`. That would pull the library
  into the main bundle for every visitor.
- `vite.config.js` lists it in `SSR_UNREACHABLE`, so the Worker's
  [server-rendering](./server-rendering.md) build ships a stub instead of an
  unusable multi-megabyte chunk.
- `optimizeDeps.exclude` keeps Vite's dev-server pre-bundling away from
  `@huggingface/transformers`, whose ONNX runtime resolves its `.wasm` files
  relative to its own module URL.

The package also depends on `onnxruntime-node`, transformers.js's Node backend.
Its install script downloads native binaries the app never uses (models only run
in the browser), so `pnpm-workspace.yaml` marks it `onnxruntime-node: false` in
`allowBuilds`.

## Testing it

The built-in path needs Chrome or Edge 138+ on hardware the browser accepts;
check from the devtools console:

```js
await Translator.availability({ sourceLanguage: "es", targetLanguage: "en" });
// "available" | "downloadable" | "downloading" | "unavailable"
```

To exercise the fallback in a capable browser, delete the `Translator` and
`LanguageDetector` globals before clicking Translate:

```js
delete window.Translator;
delete window.LanguageDetector;
```

Expect the first fallback run to download for a while; that's the detector and
the translation model arriving, once per device. transformers.js caches them in the browser's
Cache Storage (look for `transformers-cache` under the Application panel in
devtools).
