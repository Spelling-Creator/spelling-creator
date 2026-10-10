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
2. **[LFM2.5-1.2B](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX)
   running in the page with
   [transformers.js](https://huggingface.co/docs/transformers.js)**, for
   browsers without the API. Still local (the model runs in the tab on
   WebGPU), but the first use downloads **about 760 MB** of quantised weights
   (then cached in browser storage, so it's a one-time cost per device). The
   card says so before the click and shows a progress bar during.

The catch is that plenty of machines can run neither.

## Availability: the feature hides itself

The Summarizer API is **Chromium-only** (Chrome/Edge 138+, desktop), and even
there the browser refuses to run it unless the machine clears a hardware bar
(enough free disk space for the model, enough VRAM, and a non-metered connection
for the one-time download). Firefox and Safari don't ship it at all. The LFM
fallback applies an equivalent bar of its own, so a device is never offered a
760 MB model it can't run or shouldn't fetch: **WebGPU with f16 shader support**,
adapter buffer limits of at least 1 GiB (enough to turn away phone-class
adapters, and deliberately no higher: desktop browsers cap the limits they
report a few bytes short of 2 GiB however capable the GPU, so a bigger bar
would shut out the very browsers the fallback exists for), and, where the
browser can tell (the Network Information API), not a metered connection.
Both checks live in `packages/core/src/browser/deviceCheck.js`, shared with
the import model and the natural read-aloud voice.

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

The engine is `"browser"` or `"lfm"`, and it picks the wording around the
button: the fallback's heads-up names the 760 MB download, because that is not a
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
              └── core/browser/fallbackSummarizer  LFM2.5 via transformers.js,
                  a lazy chunk only a click ever loads
```

1. **Probe.** On mount, `summarizerAvailability()` asks whether this device can
   summarise, and with which engine. No usable engine means the card doesn't
   render.
2. **Click.** `createSummarizer()` opens a session: the built-in API when it
   can take the options, LFM otherwise. This _must_ happen from a click: the
   built-in API requires
   [transient activation](https://developer.mozilla.org/en-US/docs/Glossary/Transient_activation),
   and the fallback's download is far too heavy to start uninvited. The
   fallback chunk itself (transformers.js and all) is only `import()`ed here,
   so readers who never click never fetch it, and the Worker's SSR build stubs
   it out entirely (`vite.config.js`).

   The built-in engine can pass the probe and still refuse `create()` (a
   failed download, low disk, an option combination the model turns down).
   `createSummarizer()` then moves on to LFM, but announces it first
   through its `onEngine` hook, before the fallback does any work. If the
   reader was never shown the 760 MB notice (the probe had promised the
   built-in engine), the card aborts the run right there, before the
   download starts, and re-offers the button with the LFM wording, so
   the download only ever begins from an informed click.

3. **Download (first run only).** If the model isn't on the machine yet, the
   card shows a determinate progress bar (the built-in session's `monitor`
   events, or transformers.js's per-file progress summed into one fraction by
   `core/browser/downloadProgress.js`, the same plumbing the translation
   fallback uses). This is a one-time cost per device, not per lesson. The
   built-in engine's download stops when the run is aborted; an LFM download
   can't be interrupted once started, so the abort signal is checked right
   before it would begin and an aborted run never starts one.

   Until the first real progress arrives, the bar is full and pulsing and
   the line above it says the download is starting (not "0%").

   A built-in download can also never start. Chrome needs about 20 GB of free
   disk to install its model, but `availability()` still answers
   `"downloadable"` below that, and `create()` then waits without ever
   settling. So the built-in download gets 15 seconds
   (`BUILT_IN_DOWNLOAD_START_MS`) to report its first real progress. A real
   download on a fresh Chrome 154 profile reported its first progress after
   3.1 seconds. If it doesn't, the create is aborted and the run moves to LFM
   where this machine can run it (through the same `onEngine` re-warning as
   above). The stall is kept in `sessionStorage`, so later runs in the tab,
   reloads included, skip the built-in engine. A new tab tries it again, which
   is how freed-up disk space gets noticed. Without LFM, the card says the
   download didn't start and that Chrome needs about 20 GB free. Only the start is
   timed: once bytes arrive, a slow download (or the long unpacking step near
   the end) runs to completion or until the reader cancels.
   `chrome://on-device-internals` (debug pages have to be switched on at
   `chrome://chrome-urls` first) shows the disk check as "Enough disk space to
   install".

4. **Trim to quota.** A model session has a finite input budget (`inputQuota`). A
   long lesson can overrun it, which would make the summary throw. `fitToQuota()`
   measures the text with `measureInputUsage()` and, if it's over, scales it down
   to fit, so a long lesson gets a summary of its first part (the card says so)
   rather than an error. The LFM session implements the same two members
   (a token budget, and a tokenizer count), so the card doesn't care which
   engine it's trimming for.
5. **Stream.** `summarizeStreaming()` yields the summary in chunks, which the card
   appends as they arrive. A [skeleton](./overview.md) covers the gap between the
   click and the first chunk; the summary then writes itself into place. The
   built-in session hands back a `ReadableStream` and the LFM session an
   async generator; both are async iterables, so the card's `for await` loop
   is the same either way.
6. **Clean up.** Leaving the page (or starting another run) aborts the in-flight
   request and calls `destroy()` on the session. For the built-in engine that
   frees the model; for LFM it stops the generation, while the loaded model
   stays cached for the page's lifetime (reloading 760 MB of weights per summary
   would make Regenerate unusable).

## What the reader can change

Two dropdowns map onto the Summarizer API's own options:

- **Style** maps to `type`: **Key points** (default, a bulleted list), **TL;DR**,
  **Teaser**, **Headline**.
- **Length** maps to `length`: **Short** (default), **Medium**, **Long**, relative
  sizes, not word counts.

The LFM engine honours the same options by prompt: each type/length pair
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
list of words doesn't read as body text. An image's caption goes in, labelled
`Picture:`, since it says what the picture shows. Its
[credit](./image-credits.md) is left out: a name and a license tell the model
nothing about the lesson.

A `sharedContext` string tells the model it's looking at a spelling lesson written
for a class, and that it's summarising for another teacher deciding whether to use
it. Without it, a lesson full of question prompts and word lists reads to the model
like a worksheet to fill in rather than a lesson to describe. The LFM engine
puts the same framing in a system message, and spells it out more firmly: a
small model left to itself answers the lesson's questions ("What surprised me
most was..."), so the system message forbids that. It also loses track of an
instruction placed before three thousand tokens of lesson, so the lesson sits
inside `<lesson>` tags and the requested shape is repeated after it.

A summary is written in the lesson's own language where the engine can manage
it. The built-in engine always gets an `outputLanguage`, because Chrome warns on
every request that leaves it out:

- The availability probe asks about English output, which every build of the
  model writes. That keeps the probe about the browser and its hardware.
- On the click, `createSummarizer()` runs the lesson text through the browser's
  [LanguageDetector](https://developer.mozilla.org/en-US/docs/Web/API/LanguageDetector)
  (it ships alongside the Summarizer) and asks `availability()` whether the
  model can write that language. If it can, a Spanish lesson gets a Spanish
  summary. If it can't, or the language can't be told, the summary is in
  English. The detector is only used when its model is already on the device,
  so a detector download never eats into the click's user activation before the
  Summarizer needs it.

Only languages on Chrome's own list (`de`, `en`, `es`, `fr` and `ja`, in
`BUILT_IN_OUTPUT_LANGUAGES`) are asked about. Asking `availability()` about any
other language makes Chrome log a console error as well as answering
"unavailable", so a Danish lesson goes straight to English. A listed language is
still checked with `availability()`, because older builds of the model write
fewer of them. `expectedInputLanguages` stays unset, because a lesson doesn't
record its language.

LFM gets the same detected language. Its
[model card](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct) lists eight
languages it is trained on (English, Arabic, Chinese, French, German, Japanese,
Korean and Spanish), and it writes badly in anything else, so
`LFM_LANGUAGES` in `fallbackSummarizer.js` keeps it to those. A Spanish lesson is
summarised in Spanish, and a Danish one in English. (Told to answer a Danish
lesson in the lesson's own language, it wrote garbled German.)

Browsers that reach LFM usually have no LanguageDetector (Firefox and Safari),
and there every summary is in English. Leaving the choice to the model was
tried and doesn't work: told to use the lesson's language only if it is one of
the eight, it wrote English for Spanish and German lessons as well, and asked to
name a lesson's language, it answered "English" for Spanish, German and Danish
alike.

## The LFM fallback, in a little more detail

`core/browser/fallbackSummarizer.js` runs Liquid AI's
[LFM2.5-1.2B-Instruct](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX)
with transformers.js, at `q4f16` quantisation, about 760 MB. It's pinned to one
commit of the repo in `MODEL_REVISION`, so a push upstream can't change what
readers download. Generation is greedy with the light repetition penalty (1.05)
Liquid recommends, which stops a small model looping on the same bullet. The
quantisation is also why the probe requires WebGPU's `shader-f16` feature, not
just WebGPU, alongside the buffer-limit and metered-connection checks described
under [Availability](#availability-the-feature-hides-itself).

The model is under the [LFM Open License v1.0](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX/blob/main/LICENSE),
not an OSI license: it's free to use for any organization under $10M a year in
revenue, with no commercial license above that. Qualifying non-profits are
exempt from that limit only for non-commercial or research use. Readers'
browsers fetch the weights straight from Hugging Face, so the app never
redistributes them itself. If Spelling Creator ever passes $10M a year, this
model has to go.

The module presents the same session surface the card already speaks
(`summarizeStreaming()`, `inputQuota`, `measureInputUsage()`, `destroy()`), so
everything above the engine picker is engine-blind. It carries
`engine: "lfm"`, which the card uses to pick the honest wording for the
download heads-up and the "generated by" caveat. Generation streams through a
`TextStreamer` bridged to an async generator, aborts between tokens via an
`InterruptableStoppingCriteria`, and runs one generation at a time (the ONNX
sessions are shared page state).

### Languages

LFM2.5-1.2B officially supports eight languages: English, Arabic, Chinese,
French, German, Japanese, Korean and Spanish. On a lesson in anything else it
can produce a confident summary of a story that isn't there. Tested on the
hub's Danish "Prindsessen paa Ærten", it described a prince facing "political
challenges in Denmark", in English. Gemma was vague on the same lesson but not
wrong. Readers on the built-in engine aren't affected.

### Why this model

Every candidate was run in Chromium on an Apple Silicon Mac against the same
two hub lessons: "Volcanoes" (six sections, about 2,900 tokens) and the Danish
"Prindsessen paa Ærten". Times are for the whole Volcanoes lesson.

| Model                                                                                            | q4f16 download | First word | Whole summary | Outcome                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | -------------- | ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [Gemma 4 E2B](https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX) (the previous fallback) | about 3.1 GB   | 14 to 15 s | 16 to 29 s    | Good summaries, but half the download is one per-layer embedding table, and it took 53 s to load.                                      |
| **[LFM2.5-1.2B-Instruct](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX)**            | about 760 MB   | 5 to 6 s   | 6 to 7 s      | Summaries on a par with Gemma's in English, loads in about 20 s. Weak outside its eight languages (above).                             |
| [LFM2.5-2.6B](https://huggingface.co/LiquidAI/LFM2.5-2.6B-ONNX)                                  | about 1.5 GB   | 9 s        | 22 to 28 s    | The best summaries of the lot, Danish included, but only with its reasoning on, which it streams before every answer. Off, it's worse. |
| [Qwen3-1.7B](https://huggingface.co/schmuell/Qwen3-1.7B) (Apache 2.0)                            | about 760 MB   | 21 s       | 24 s          | Works, but slower than Gemma to start writing, and the onnx-community build won't load at all (`std::bad_alloc`).                      |
| [Qwen3.5-2B](https://huggingface.co/onnx-community/Qwen3.5-2B-ONNX) (Apache 2.0)                 | about 1.4 GB   | minutes    | minutes       | 42 s before the first word on a 236-token excerpt.                                                                                     |
| [Granite 4.0 1B](https://huggingface.co/onnx-community/granite-4.0-1b-ONNX-web) (Apache 2.0)     | about 1.25 GB  |            |               | Loads, but its q4f16 build writes nothing but `!!!!` (16-bit overflow).                                                                |

A summary is almost all prompt (a whole lesson in, a few lines out), so how
fast a model reads its prompt matters far more here than how fast it writes.
That is what ruled out Qwen3.5, whose linear-attention layers are slow to
prefill in ONNX Runtime Web
([transformers.js#1599](https://github.com/huggingface/transformers.js/issues/1599)).
LFM2.5's short-convolution layers have no such problem.

## Testing it

For the **built-in engine** you need Chrome or Edge 138+ on a desktop machine
that meets the
[hardware requirements](https://developer.mozilla.org/en-US/docs/Web/API/Summarizer_API#browser_compatibility).
Check what your browser thinks from the devtools console:

```js
await Summarizer.availability();
// "available" | "downloadable" | "downloading" | "unavailable"
```

For the **LFM fallback** you need a browser without the Summarizer API (or
one where it answers `"unavailable"`) whose WebGPU clears the probe's bar, on
an unmetered connection:

```js
const adapter = await navigator.gpu?.requestAdapter();
adapter?.features.has("shader-f16") &&
  adapter.limits.maxBufferSize >= 1024 ** 3 &&
  adapter.limits.maxStorageBufferBindingSize >= 1024 ** 3;
```

Be warned that actually clicking Summarise there downloads the 760 MB model.

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

To exercise a download that never starts, have the stub's `availability()`
answer `"downloadable"` and make `create()` return a promise that only
rejects when its `signal` aborts. After 15 seconds the card moves to LFM, or
shows the "didn't start" message when LFM can't run.

The LFM path can be exercised the same way without the 760 MB download: stub
`navigator.gpu` so the probe says yes (an object whose `requestAdapter()`
resolves to `{ features: new Set(["shader-f16"]), limits: { maxBufferSize: 2147483644, maxStorageBufferBindingSize: 2147483644 } }`,
the limits real desktop browsers report; the adapter is asked for once a page,
so stub before the page loads), make sure
`window.Summarizer` is absent, and serve a stub module in place of
`fallbackSummarizer.js` with your browser driver's network mocking (it only
needs `createFallbackSummarizer` returning the session shape above plus
`engine: "lfm"`).

## Trust

The card carries a standing caveat: the summary is generated on the reader's
device (by their browser's built-in AI, or by an open model running in the
browser; the caveat says which), it can be wrong, and the lesson itself is the
source of truth. When a lesson had to be trimmed to fit the model's input
budget, the caveat says that instead, so nobody mistakes a summary of the first
half for a summary of the whole.
