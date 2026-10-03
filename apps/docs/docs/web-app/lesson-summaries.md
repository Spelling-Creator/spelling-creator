---
title: Lesson summaries (on-device AI)
---

# Lesson summaries (on-device AI)

A published lesson can be summarised **on the reader's own machine**, with no
server involved. The lesson page shows a **Summary** card above the lesson body:
press **Summarise** and a few bullet points appear, streamed in as the model
writes them, so a teacher can tell at a glance whether the lesson suits their
class before reading it end to end.

This is the odd one out among the AI features. The
[text](./ai-text-suggestions.md), [question](./ai-question-suggestions.md) and
[lesson idea](./ai-lesson-ideas.md) helpers all go through the Turnstile-verified
Worker in `apps/api`, which calls a hosted model and costs money per request.
Summaries run locally instead, so there's no Worker call, no Turnstile widget,
no API key, no rate limit and no cost, and the lesson text never leaves the
reader's device. Like [comment translation](./comment-translation.md), it has
two engines:

1. **The browser's built-in [Summarizer API](https://developer.mozilla.org/en-US/docs/Web/API/Summarizer_API)**
   (Chromium 138+, desktop). The model ships with the browser; the first use
   fetches it once.
2. **[Gemma 4](https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX)
   running in the page with
   [transformers.js](https://huggingface.co/docs/transformers.js)**, for
   browsers without the API. Still local (the model runs in the tab on
   WebGPU), but the first use downloads **about 3 GB** of quantised weights
   (then cached in browser storage, so it's a one-time cost per device). The
   card says so before the click and shows a progress bar during.

The catch is that plenty of machines can run neither.

## Availability: the feature hides itself

The Summarizer API is **Chromium-only** (Chrome/Edge 138+, desktop), and even
there the browser refuses to run it unless the machine clears a hardware bar
(enough free disk space for the model, enough VRAM, and a non-metered connection
for the one-time download). Firefox and Safari don't ship it at all. The Gemma
fallback applies an equivalent bar of its own, so a device is never offered a
3 GB model it can't run or shouldn't fetch: **WebGPU with f16 shader support**,
adapter buffer limits large enough to hold the quantised weights (which rules
out phones and most integrated GPUs, not just pre-WebGPU hardware), and, where
the browser can tell (the Network Information API), not a metered connection.

So the card is **capability-gated**: on mount it probes
`summarizerAvailability()`, which asks the built-in API first and, when that
says no, probes WebGPU for the fallback. If neither engine can run, the card
renders **nothing at all**: no button, no "your browser doesn't support this"
notice. A reader who can't use the feature never learns it exists, which beats
showing them a button that can't work.

The probe answers with a state and an engine, and the card reacts to each:

| State          | What it means                                   | What the card does                                                               |
| -------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `available`    | The model is downloaded and ready.              | Summarises immediately on click.                                                 |
| `downloadable` | Supported, but the model must be fetched first. | Shows a heads-up before the click, then a real progress bar during the download. |
| `downloading`  | Supported; a download is already running.       | Same as `downloadable`.                                                          |
| `unavailable`  | Neither engine can run on this machine.         | **Renders nothing.**                                                             |

The engine is `"browser"` or `"gemma"`, and it picks the wording around the
button: the fallback's heads-up names the 3 GB download, because that is not a
click anyone should make uninformed. The fallback always reports
`downloadable` (there's no cheap way to ask whether the browser still has the
model cached; when it does, the download phase is just instant).

Everything in `@spelling-creator/core/browser/summarizer` **fails closed**: a missing API, unsupported
options, or a probe that throws all collapse to the next layer down, and a
machine with no usable layer gets `"unavailable"`, so a browser that
half-implements the API can't produce a broken card.

The card also hides on lessons with **less than `MIN_SUMMARY_CHARS` (400)** of
text; below that the summary would be about as long as the lesson.

## How it works

```
pages/lesson/LessonOverview.jsx
  └── LessonSummary.jsx      the card: probe, controls, progress, streamed output
        └── core/browser/summarizer  the engine picker (no React, fails closed)
              └── core/browser/fallbackSummarizer  Gemma 4 via transformers.js,
                  a lazy chunk only a click ever loads
```

1. **Probe.** On mount, `summarizerAvailability()` asks whether this device can
   summarise, and with which engine. No usable engine means the card doesn't
   render.
2. **Click.** `createSummarizer()` opens a session: the built-in API when it
   can take the options, Gemma otherwise. This _must_ happen from a click: the
   built-in API requires
   [transient activation](https://developer.mozilla.org/en-US/docs/Glossary/Transient_activation),
   and the fallback's download is far too heavy to start uninvited. The
   fallback chunk itself (transformers.js and all) is only `import()`ed here,
   so readers who never click never fetch it, and the Worker's SSR build stubs
   it out entirely (`vite.config.js`).

   The built-in engine can pass the probe and still refuse `create()` (a
   failed download, low disk, an option combination the model turns down).
   `createSummarizer()` then moves on to Gemma, but announces it first
   through its `onEngine` hook, before the fallback does any work. If the
   reader was never shown the 3 GB notice (the probe had promised the
   built-in engine), the card aborts the run right there, before the
   download starts, and re-offers the button with the Gemma wording, so
   the download only ever begins from an informed click.

3. **Download (first run only).** If the model isn't on the machine yet, the
   card shows a determinate progress bar (the built-in session's `monitor`
   events, or transformers.js's per-file progress summed into one fraction by
   `core/browser/downloadProgress.js`, the same plumbing the translation
   fallback uses). This is a one-time cost per device, not per lesson. The
   built-in engine's download stops when the run is aborted; a Gemma download
   can't be interrupted once started, so the abort signal is checked right
   before it would begin and an aborted run never starts one.
4. **Trim to quota.** A model session has a finite input budget (`inputQuota`). A
   long lesson can overrun it, which would make the summary throw. `fitToQuota()`
   measures the text with `measureInputUsage()` and, if it's over, scales it down
   to fit, so a long lesson gets a summary of its first part (the card says so)
   rather than an error. The Gemma session implements the same two members
   (a token budget, and a tokenizer count), so the card doesn't care which
   engine it's trimming for.
5. **Stream.** `summarizeStreaming()` yields the summary in chunks, which the card
   appends as they arrive. A [skeleton](./overview.md) covers the gap between the
   click and the first chunk; the summary then writes itself into place. The
   built-in session hands back a `ReadableStream` and the Gemma session an
   async generator; both are async iterables, so the card's `for await` loop
   is the same either way.
6. **Clean up.** Leaving the page (or starting another run) aborts the in-flight
   request and calls `destroy()` on the session. For the built-in engine that
   frees the model; for Gemma it stops the generation, while the loaded model
   stays cached for the page's lifetime (reloading 3 GB of weights per summary
   would make Regenerate unusable).

## What the reader can change

Two dropdowns map onto the Summarizer API's own options:

- **Style** maps to `type`: **Key points** (default, a bulleted list), **TL;DR**,
  **Teaser**, **Headline**.
- **Length** maps to `length`: **Short** (default), **Medium**, **Long**, relative
  sizes, not word counts.

The Gemma engine honours the same options by prompt: each type/length pair
maps to the shape the built-in API would produce (3/5/7 bullet points for key
points, 1/3/5 sentences for prose, 12/17/22 words for a headline), so the
dropdowns mean the same thing whichever engine answers.

Changing either clears the current summary and returns the card to its resting
state, so what's on screen always matches the controls. The next click regenerates
(and supplies the transient activation the new session needs).

The model is asked for **markdown**, and "key points" comes back as a bullet list.
Rather than pull in a markdown library for the handful of constructs a summary can
contain, `LessonSummary.jsx` renders the subset we actually get (bullets,
headings, paragraphs, bold and italic), falling back to plain text for anything
else. A model that ignores `format` and returns prose still renders correctly.

## Input and prompting

`lessonSummaryText(doc)` (in `@spelling-creator/core/browser/summarizer`) turns the lesson document
into the text handed to the model. It deliberately **isn't** `lessonPlainText()`
(the flattened prose used for the page's [SEO description](./pages-and-routing.md)):
here the structure is the point, so it keeps the title and section headings as
markdown headings, and labels question prompts and spelling word lists so a bare
list of words doesn't read as body text. Image captions are left out; they're
usually attribution boilerplate.

A `sharedContext` string tells the model it's looking at a spelling lesson written
for a class, and that it's summarising for another teacher deciding whether to use
it. Without it, a lesson full of question prompts and word lists reads to the model
like a worksheet to fill in rather than a lesson to describe. The Gemma engine
bakes the same instruction into its prompt, so both engines summarise for the
same reader.

The language options (`expectedInputLanguages` / `outputLanguage`) are left unset
on purpose: naming a language the local model doesn't have makes `create()` throw,
whereas omitting them lets the browser detect the lesson's language and reply in
it. The Gemma prompt asks for the summary in the lesson's own language for the
same effect.

## The Gemma fallback, in a little more detail

`core/browser/fallbackSummarizer.js` runs
[onnx-community/gemma-4-E2B-it-ONNX](https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX)
with transformers.js. The repo is multimodal, but loading it through
`Gemma4ForCausalLM` puts transformers.js in text-only mode, so only the text
components are fetched: the embedding and decoder weights at `q4f16`
quantisation, about 3 GB, skipping the vision and audio encoders entirely.
That quantisation is also why the probe requires WebGPU's `shader-f16`
feature, not just WebGPU, alongside the buffer-limit and metered-connection
checks described under [Availability](#availability-the-feature-hides-itself).

The module presents the same session surface the card already speaks
(`summarizeStreaming()`, `inputQuota`, `measureInputUsage()`, `destroy()`), so
everything above the engine picker is engine-blind. It carries
`engine: "gemma"`, which the card uses to pick the honest wording for the
download heads-up and the "generated by" caveat. Generation streams through a
`TextStreamer` bridged to an async generator, aborts between tokens via an
`InterruptableStoppingCriteria`, and runs one generation at a time (the ONNX
sessions are shared page state).

## Testing it

For the **built-in engine** you need Chrome or Edge 138+ on a desktop machine
that meets the
[hardware requirements](https://developer.mozilla.org/en-US/docs/Web/API/Summarizer_API#browser_compatibility).
Check what your browser thinks from the devtools console:

```js
await Summarizer.availability();
// "available" | "downloadable" | "downloading" | "unavailable"
```

For the **Gemma fallback** you need a browser without the Summarizer API (or
one where it answers `"unavailable"`) whose WebGPU clears the probe's bar, on
an unmetered connection:

```js
const adapter = await navigator.gpu?.requestAdapter();
adapter?.features.has("shader-f16") &&
  adapter.limits.maxBufferSize >= 2 * 1024 ** 3 &&
  adapter.limits.maxStorageBufferBindingSize >= 1024 ** 3;
```

Be warned that actually clicking Summarise there downloads the 3 GB model.

If neither answers yes, the card is _supposed_ to be invisible; that's the
feature working, not a bug. On a machine that can't run it, you can still exercise
the card by stubbing the global before the lesson page mounts:

```js
window.Summarizer = {
  async availability() {
    return "available";
  },
  async create() {
    return {
      // An async generator, not ReadableStream.from(): Chrome iterates
      // ReadableStreams but doesn't ship the static from() helper.
      summarizeStreaming: async function* () {
        yield "* A key point\n";
      },
      destroy() {},
    };
  },
};
```

The Gemma path can be exercised the same way without the 3 GB download: stub
`navigator.gpu` so the probe says yes (an object whose `requestAdapter()`
resolves to `{ features: new Set(["shader-f16"]), limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 30 } }`), make sure
`window.Summarizer` is absent, and serve a stub module in place of
`fallbackSummarizer.js` with your browser driver's network mocking (it only
needs `createFallbackSummarizer` returning the session shape above plus
`engine: "gemma"`).

## Trust

The card carries a standing caveat: the summary is generated on the reader's
device (by their browser's built-in AI, or by an open model running in the
browser; the caveat says which), it can be wrong, and the lesson itself is the
source of truth. When a lesson had to be trimmed to fit the model's input
budget, the caveat says that instead, so nobody mistakes a summary of the first
half for a summary of the whole.
