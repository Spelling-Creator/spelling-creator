---
title: Interactive mode
---

# Interactive mode

For how to use this, see [Interactive mode](../../guide/interactive-mode.md).

Interactive mode is the lesson's **Practice** tab (`/hub/:id/practice`, see
[Pages & routing](./pages-and-routing.md)), opened from **Start lesson** on the
lesson page. A section's material appears as one step, then that section's
questions one after another, each with a field to type an answer into. At the
end, a signed-in user's answers are filed privately to their account; an
unfinished run-through is kept in the browser so it can be resumed.

A letterboard tablet can follow the walkthrough and answer into it; that is its
own page, [Letterboard sync](./letterboard-sync.md).

The route only decides when it is open. `InteractiveLesson` is still a dialog,
deliberately: it is a focus mode with its own bottom bars and its own idea of the
viewport. `LessonPractice` renders it with `open` and navigates back to the
overview on close (rather than `history.back()`, since a deep link has no history
to go back to). A lesson whose sections are all empty isn't playable
(`isInteractivePlayable`): `LessonTabs` hides the tab, `LessonLayout` hides the
button, and a direct link to `/practice` redirects to the lesson.

## Derived from the document

There is no "interactive lesson" document type and nothing to switch on when
authoring. The walkthrough is **derived from the lesson document**
(`buildInteractiveSteps` in `packages/core/src/interactive.ts`), so every lesson
ever published works, including ones made before this feature existed and ones
written by the [MCP server](../mcp-server/overview.md). Nothing is added to a
lesson to make it playable, and a lesson stays exactly as printable as it was.

| In the document                                   | Becomes                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A section's text, image, spelling and VAKT blocks | One **content step** (`kind: "content"`), holding them together in document order. |
| Each question block                               | One **question step** (`kind: "question"`), after that section's content.          |
| A section with only questions                     | No content step; it opens straight on its first question.                          |
| A section with nothing in it                      | Nothing.                                                                           |
| A lesson with no questions at all                 | A read-through: every content step, no answer fields, nothing saved.               |

VAKT blocks belong to the content step rather than being steps of their own: a
regulation break is something whoever runs the session does with the speller,
not something the speller answers, so it must not be counted by the progress bar.

Each step has a stable `key` (`<sectionId>:content` or `<sectionId>:<blockId>`,
falling back to positions for documents without ids). Answers are keyed by block
id (`answerKey`), so re-ordering a lesson between sittings doesn't shuffle which
answer belongs to which question.

Text blocks keep their bold, italics and underlining, but not their footnote
markers: this is the screen the speller reads, and a superscript number with
nowhere on the screen to lead to is clutter there. The voice reads the words
with their read-aloud hints and pauses (see
[Formatting, footnotes & sources](./formatting-and-footnotes.md#read-aloud-hints)).

Questions are numbered from 1 within each section, matching the editor's `Q7`
numbering (see [Navigating large lessons](./navigating-large-lessons.md)).

## Presentation

Interactive mode is full-screen and drawn in the app's own theme, light or dark,
as is the lesson page below it, rather than reproducing the white sheet the
[DOCX/PDF export](./export-pipeline.md) produces. The blocks are re-rendered at a
scale for reading and answering over a whole session: prose at reading size,
images framed in the app's border and radius and sized by the reading column
rather than by the size and alignment they carry (so a picture fills the width on
a phone), spelling words as large cards, and a
[VAKT activity](./vakt-activities.md) set apart as a red-edged card. Only the
presentation differs; the content is the same blocks.

## Showing the answers

`questionAnswer(block)` flattens each question type's stored answer into one
shape, `{ answer, answers, steps, suggested }`, or null when there is nothing to
reveal:

| Type                                                                                                                  | What the reveal shows                                              |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `single`, `background`                                                                                                | `answer`                                                           |
| `number`                                                                                                              | `answer` plus the working `steps` (either alone is still revealed) |
| `multiple`                                                                                                            | every entry in `answers`, the whole accepted set                   |
| `multiple_open`                                                                                                       | the same list with `suggested: true`, labeled as suggestions       |
| `tight_open` with examples                                                                                            | its examples with `suggested: true`, labeled the same way          |
| `broad_open`, `paraphrase`, `wyr`, a legacy `open`, a tight open without examples, an unknown type, or a blank answer | null: "This question has no set answer."                           |

`revealedAnswers` turns that into the flat list of boxes the UI draws (the
working is not one of them; it stays a numbered list below, each step drawn
with its formatting and formulas, since a step is inline text), and
`hasRevealableAnswers(steps)` decides whether the toggle is rendered at all.

The two semi-open types share a color and an `answers` list because the app's
default treats them as one family (see the comment in
`packages/core/src/questions.ts`). Other Spelling practitioners categorize
questions differently, and the
[Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)
lists the loose end as an open question.
`suggested` is what tells the two apart, and it
travels with the answers so the person looking at the reveal doesn't have to
remember the question type.

The toggle state lives in `InteractiveLesson` and is reset to off every time the
dialog opens; unlike the speech settings it is never persisted. On a question
step each answer box is a button (`RevealedAnswer` with `onUse`) that replaces
the field's value and focuses it with the caret at the end. On the summary
`onUse` is absent, which is what keeps the boxes there read-only. Nothing
compares the typed answer with the author's anywhere.

## Progress on the device

`packages/core/src/browser/interactiveProgress.ts` keeps the unfinished
run-through (every answer, plus the current step's key) in `localStorage` under
`spelling-creator:interactive-progress`.

|              | Progress (unfinished)                                       | A saved run-through (finished)    |
| ------------ | ----------------------------------------------------------- | --------------------------------- |
| Lives in     | this browser (`localStorage`)                               | `lesson_responses`, on the server |
| Needs        | nothing; signed out works too                               | a signed-in session               |
| Travels      | no: this device only                                        | yes: any device you sign in on    |
| Kept until   | it is filed, you start again or discard it, or 90 days pass | you delete it                     |
| Anyone else? | never sent anywhere at all                                  | only you can read it              |

- Records are keyed by **owner and lesson**. The owner is the signed-in user's
  id, or `""` when signed out, so signed-out users of one browser share a record
  per lesson. Per-owner keys exist for the shared computer (a clinic, or a home
  with more than one speller), where resuming into the previous person's answers
  would be worse than not resuming at all. The shared signed-out record is why a
  resumed run-through always shows the resume notice with **Start again**.
- A run-through is pinned to the owner it started as (`runOwner` in
  `InteractiveLesson`). If the signed-in account changes with the dialog open,
  writes keep going to the original record, and **Finish** refuses to file to
  the new account (`summary.signedInSince`).
- `MAX_PROGRESS_RECORDS` is 20 (most recently touched lessons) and
  `PROGRESS_MAX_AGE_MS` is 90 days, applied by `pruneProgress`. Pruning is fine
  here in a way it isn't for saved run-throughs: this is a resume cache, not the
  only copy of anything someone chose to keep.
- Every write reports whether it landed. Where storage is refused (private
  browsing, a full quota) or missing, the leave confirmation switches back to
  warning that leaving discards the answers, so it only promises what was
  actually kept.
- The record is cleared as soon as a run-through is filed. A failed save leaves
  it, so closing and coming back is a way to retry; signed out, it stays, since
  it is the only copy.
- If the remembered step key no longer exists (the step was deleted), the lesson
  opens at the top with the answers still restored.
- `hasInteractiveProgress` is what makes `LessonLayout` label the button
  **Continue lesson**.

Syncing progress across devices was rejected on purpose: it would mean putting
half-written answers on the server, a much bigger promise than "your tab
remembers".

## Privacy of saved answers

- Every endpoint that touches saved answers requires a signed-in session, and the
  Worker scopes each query to `user_id = <verified caller>`; that filter is the
  only way a row is ever addressed, not a check layered on top of one. Deleting
  someone else's row matches nothing and returns 404.
- There is **no endpoint that returns another user's answers**: not for the
  lesson's author, a moderator or an admin.
- `lesson_responses` has RLS enabled with no policies, unlike `lessons`,
  `comments` and `ratings`; only the service-role Worker reads or writes it.
  `user_id` is never returned.
- Answers are **not** run through the profanity filter that
  [comments](./hub-and-accounts.md) go through. There's no audience to protect.
- The in-progress copy has no endpoint at all: nothing to scope server-side, and
  no way for anyone to learn that a lesson was even opened.

`MyLessonAnswers` renders the "Your answers" panel on the lesson's overview tab
(`LessonOverview.jsx`), under the lesson, and renders nothing when signed out or
when there are none.

## Worker endpoints

| Method & path                        | Auth                    | Response                                                                                             |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /lessons/:id/responses`         | `Bearer <Supabase JWT>` | `{ "responses": [{ id, lessonId, answers, completedAt }] }`; **the caller's own only**, newest first |
| `POST /lessons/:id/responses`        | `Bearer <Supabase JWT>` | `{ "response": { id, lessonId, answers, completedAt } }`                                             |
| `DELETE /lessons/:id/responses/:rid` | `Bearer <Supabase JWT>` | `{ "ok": true }`, the caller's own only; else `404`                                                  |

- `POST` body is `{ answers }`, one entry per question:
  `{ blockId, sectionId, sectionName, questionType, prompt, answer }`. The Worker
  rebuilds every entry from known fields and drops anything else, so the stored
  `jsonb` can only hold that shape. `answer` must be a string of at most 5,000
  characters or the request is refused with `400`; the other fields are cut to
  their maximum length (100 for ids, 300 for the section name, 2,000 for the
  prompt), and an unrecognized `questionType` is stored as `open`.
- The **prompt is snapshotted** alongside the answer on purpose: a saved
  run-through has to stay readable after the lesson is edited, re-ordered, or has
  that question deleted.
- Skipped questions are stored as blank answers rather than dropped, so the set
  still says which questions were asked.
- Limits (shared between browser and Worker in
  `packages/core/src/interactive.ts`): `MAX_RESPONSE_LENGTH` 5,000 characters per
  answer and `MAX_RESPONSES` 500 answers per submission.
- You may keep **20 saved run-throughs of any one lesson**
  (`MAX_STORED_RESPONSES`). Past that a `POST` is rejected with `409` and a
  message asking you to delete an older one, rejected rather than silently
  pruning the oldest, for the same reason the draft cap (see
  [Lesson hub & accounts](./hub-and-accounts.md)) is: they're the user's own
  answers, and quietly deleting them to make room isn't ours to decide.
- `POST` also checks the lesson is one the caller could have read in the first
  place (`canPlayLesson`): published and not shadowbanned, or theirs, trusted or
  moderated. Otherwise `404`.

## Supabase schema

```sql
create table if not exists public.lesson_responses (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  answers      jsonb not null,
  completed_at timestamptz not null default now()
);

create index if not exists lesson_responses_user_lesson_idx
  on public.lesson_responses (user_id, lesson_id, completed_at desc);

-- No public read policy, unlike lessons/comments/ratings: this data is private.
alter table public.lesson_responses enable row level security;
```

The full schema, with the reasoning in comments, is `apps/api/schema.sql`.

## Reading aloud

Speech uses the browser's
[Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
(`speechSynthesis`), or a [natural voice](#natural-voices-kokoro) where the
device can run one. Like [lesson summaries](./lesson-summaries.md), this runs
entirely on the reader's own device: no Worker call, no API key, no cost, and the
lesson text never leaves the machine. Speech is probed for (`speechSupported`)
rather than assumed, from an effect so server rendering and hydration agree;
where it's missing, neither the controls nor the settings section is rendered.

`stepSpeech(step)` builds what a step says: the section name, then the
prose, image captions (never their [credits](./images.md)), spelling words, a VAKT
activity's text without its label or links, or the question prompt, with the
prompt's own read-aloud hints and formulas (`inlineTextSpeech`). A question's
answer is deliberately never included, even with the reveal on.
(`stepSpeechText` is the same as plain text, one line per utterance.)

What it builds is spoken text, the format `@spelling-creator/core/speech`
defines: lines of runs that are words, or a text block's
[read-aloud hints](./formatting-and-footnotes.md#read-aloud-hints) (a
pronunciation in IPA, words to say instead, a spell-out) and pauses. Everything
but a text block is plain words. `chunkSpeech` cuts it into the chunks a voice
is handed: by line, then at every long pause, then by sentence for a line too
long to say at once, never splitting a hint. A chunk followed by a long pause
is marked `pauseAfter`. The two kinds of voice then take it differently:

- **The browser's voice** only takes text, so each chunk goes through
  `spokenForBrowser`: an alias replaces its words, a spell-out becomes its
  letters with commas between ("R, E, E, F"), a short pause becomes a comma, and
  a pronunciation can't be followed, so its words are read as written. A long
  pause is the gap between two utterances.
- **A natural voice** speaks phonemes, so it follows every hint (see below), and
  a long pause is 0.7 seconds of silence on the audio timeline
  (`LONG_PAUSE_SECONDS` in `useSpeech.js`).

A formula in a text block is either its author's spoken words or a formula run
(`{ text: source, formula }`). Before a step with one is spoken, `useSpeech`
has `withFormulaSpeech` replace each with the words the speech rule engine
makes from the formula's MathML (`formulaWords` in `core/browser/formulas.ts`;
see [Formulas](./formatting-and-footnotes.md#formulas)), for both voices. The
first such step loads MathJax and the engine, so it starts a moment later;
`prepare` does the same for the step after. A lesson without formulas never
loads them.

The on/off, voice and pace preferences live in `localStorage` under
`spelling-creator:tts-enabled`, `spelling-creator:tts-voice` and
`spelling-creator:tts-rate`, read and written through
`apps/web/src/lib/speechPrefs.js` by both interactive mode and the **Reading
aloud** section of the settings page. `SPEECH_RATES` is `[0.7, 0.85, 1, 1.25,
1.5]`; an unrecognized stored rate falls back to 1. A change made in one place
reaches the other the next time it mounts, not live (no `storage` listener).

Three platform quirks are handled between the two files. `speechPrefs.js` takes
the one that belongs to the voice list: voices load asynchronously, announced by
`voiceschanged`. `useSpeech.js` takes the two that belong to speaking: Chromium
cuts off a single utterance after about 15 seconds (so text is split into chunks
of at most 180 characters, `MAX_CHUNK` in `core/speech.ts`, and queued), and
`cancel()` isn't synchronous (so a new utterance is deferred a tick after one).

### Natural voices (Kokoro)

The natural voices are
[Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), an
82M-parameter voice model that runs in the page with transformers.js
(`@huggingface/transformers` 4), like the summary and import models. The model is
pinned to a commit (`MODEL_REVISION` in `readAloudVoices.js`) and loaded at fp32
on WebGPU. Eight of its English voices, the ones graded C+ or better on the model
card, are listed under **Natural voices** in the voice picker, above the
browser's own, in both the popover and the settings page
(`apps/web/src/components/SpeechVoiceSelect.jsx`):

| Id                   | Name    | Accent |
| -------------------- | ------- | ------ |
| `af_heart` (default) | Heart   | en-US  |
| `af_bella`           | Bella   | en-US  |
| `af_nicole`          | Nicole  | en-US  |
| `am_fenrir`          | Fenrir  | en-US  |
| `am_michael`         | Michael | en-US  |
| `am_puck`            | Puck    | en-US  |
| `bf_emma`            | Emma    | en-GB  |
| `bm_george`          | George  | en-GB  |

The choice is stored in the same voice preference as `kokoro:<voice id>`; no
browser `voiceURI` starts with that prefix.

How it behaves:

- **Only where it can run.** The list is shown only on a device with a WebGPU
  adapter that isn't a phone or tablet, and isn't on a metered connection unless
  the model is already downloaded, since loading it from the cache uses no data
  (`readAloudPossible` in `packages/core/src/browser/readAloud.js`). Phones and
  tablets are excluded by name, because WebGPU alone doesn't rule them out: an
  iPad has it, and Kokoro froze and then crashed Safari on one. iPadOS calls
  itself a Mac, so it's recognized by having a touch screen. A stored natural
  voice the device can't use right now (on a metered connection before it's
  downloaded, say) shows as the browser default in the picker, since that is
  what reads; the choice itself is kept.
- **Opt-in, because of the download.** The browser default stays the default.
  Choosing a natural voice says that the first use downloads about 330 MB
  (`DOWNLOAD_MB`), once. Nothing downloads until practice mode speaks with speech
  on, so choosing one on the settings page, or with speech off, downloads
  nothing. The device check runs again just before, so a connection that has
  turned metered since the page loaded doesn't start one. The weights go into
  the shared model cache, which **Delete models** on the settings page clears.
- **Never silent while it downloads.** During the download the browser's voice
  reads, and a line under the step count shows the progress. Screen readers hear
  that it's downloading once, not every percent. The natural voice takes over
  from the next thing spoken.
- **Ready from the first step once downloaded.** When the model is already in the
  cache (`readAloudCached` in `readAloud.js` looks for its weights), it loads as
  soon as practice mode opens with speech on, which takes a couple of seconds. A
  step spoken meanwhile waits for it, up to five seconds from when it was asked
  for (`CACHED_WAIT_MS`), instead of being read in the browser's voice, and the
  line under the step count says "Getting the natural voice ready...". If the
  load runs past that or fails, the browser's voice reads that step and later
  steps don't wait again: the natural voice takes over once it's loaded, and a
  failed load is tried again once a step, like a failed download. Web Audio is
  started as the step is asked for, while the click behind it still counts, so
  the wait doesn't cost the browser's permission to play. A voice changed during
  the wait is the one that reads.
- **The browser's voice is the fallback**, in three ways, and the same line says
  which:
  - a download that fails is tried again on the next step, up to three attempts
    in a visit (`MAX_LOAD_ATTEMPTS`; files that finished are cached, so a retry
    picks up where a dropped connection left off);
  - a chunk the model fails to make costs only that step: what was already
    queued plays out, then the browser's voice reads from the failed chunk. Two
    steps in a row like that (`MAX_READ_FAILURES`) and the natural voice is
    dropped for the visit;
  - if the browser won't start Web Audio (no recent click, a strict autoplay
    rule), that step is read by the browser's voice rather than queued in
    silence.
- **Steps play as one stream.** Each chunk is made, then queued on a Web Audio
  timeline straight after the one before, so playback runs on while the next
  chunk is made.
- **The next step is made ahead.** While a step plays, the first two chunks of
  the next step are made too (`prepare` in `useSpeech.js`, `PREPARED_CHUNKS`), so
  pressing Next starts speaking at once. This waits until the current step has
  been made: the model does one thing at a time, so running it alongside would
  hold up the chunks being listened to. Made clips are kept (up to 24,
  `MAX_CACHED_CLIPS`), so replaying a step or a spelling word doesn't make it
  again.
- **English only.** Like choosing an English browser voice, picking one for a
  lesson in another language reads it with English pronunciation.

Kokoro reads phonemes, not text. `packages/core/src/browser/readAloudText.js`
spells out numbers and abbreviations, turns the words into IPA with
[Spellophone](https://spellophone.spellingcreator.org/) (our WebAssembly build of
espeak-ng, the phonemizer Kokoro was trained against, installed from npm as
`@spelling-creator/spellophone`), and `readAloudEngine.js` passes that to the
model. A read-aloud hint changes what goes in: a pronunciation's IPA goes in as
written (with the ASCII people type for IPA, such as a plain `g` or `:` for
length, swapped for the symbols in Kokoro's vocabulary by `kokoroIpa`), an
alias or a spell-out is turned into phonemes in place of its words, and a
short pause is a comma, which Kokoro pauses at. `readAloudText.js` loads none of
the model, so its tests run against the Node build of Spellophone. The text
clean-up follows kokoro.js, the reference JavaScript port. That package isn't used itself
because it pins transformers.js 3, which would put a second ONNX runtime in the
bundle. Only Spellophone's English data is bundled, as hashed assets of the build
rather than fetched from a CDN: about 860 KB with the WebAssembly. `readAloudEngine.js` is only ever
reached through a dynamic `import()` in `readAloud.js`, so none of this weight
lands in the main bundle.

### Timing it

To time it on a device, run `pnpm dev:web` and open `/bench/read-aloud.html`
(`apps/web/bench/read-aloud.html`). The page reads the first six steps of a real
hub lesson, chunked as `useSpeech.js` chunks them, and reports:

- **first audio**: from pressing play to sound, once the model is loaded;
- **RTF** (real-time factor): time to make a chunk over how long it speaks.
  Under 1 keeps ahead of playback;
- **stalls**: silence mid-step while the next chunk is still being made.

The page is served by the dev server only; the production build's one entry is
`index.html`. WebGPU needs a secure context, so a phone or tablet has to reach it
over HTTPS.

Measured on a Mac, 110 s of speech, `af_heart`:

| Browser and backend       | First audio | Median RTF | Stalls |
| ------------------------- | ----------- | ---------- | ------ |
| Chrome 154, WebGPU, fp32  | 0.56 s      | 0.17       | none   |
| WebKit 26.6, WebGPU, fp32 | 0.85 s      | 0.25       | 0.4 s  |
| Chrome 154, WASM, fp32    | 2.4 s       | 1.16       | 39 s   |
| Chrome 154, WASM, q8      | 3.0 s       | 1.48       | 70 s   |

What the numbers decided:

- **WebGPU or nothing.** The site isn't cross-origin isolated, so the WASM
  backend runs on one thread, and on one thread Kokoro is slower than speech even
  on a Mac. q8 is slower than fp32 there, too. The device check asks for WebGPU
  for this reason.
- **A throwaway run while loading.** The first run is slow while WebGPU compiles
  its shaders (1.9 s against 0.4 s for the same short line), so the engine does
  one as part of loading.
- **Making the next step ahead.** The one WebKit stall is a short section name
  followed by a long chunk: the name finishes playing before the next chunk is
  ready. The first two chunks of every step after the first are made while the
  step before plays.
- **Computers only.** On an iPad it freezes and then crashes (Safari, WebGPU,
  fp32). Kokoro is aimed at computers, which is what the spellers we know use for
  sessions, and phones and tablets keep the browser's voices.

## Where the code lives

| File                                               | What it does                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/core/src/interactive.ts`                 | Turns a document into steps; speech text; the answers the reveal shows; limits and validation. |
| `packages/core/src/browser/interactiveProgress.ts` | The unfinished run-through kept on the device: resume, expiry, pruning.                        |
| `packages/core/src/lessonResponses.ts`             | Client for the three endpoints above.                                                          |
| `apps/api/src/routes/lessonResponses.js`           | The endpoints, and the privacy scoping.                                                        |
| `apps/web/src/components/InteractiveLesson.jsx`    | The full-screen walkthrough, the reveal, speech controls, resume, summary and the letterboard. |
| `apps/web/src/lib/practiceLink.js`                 | The letterboard session's host side (see [Letterboard sync](./letterboard-sync.md)).           |
| `apps/web/src/pages/lesson/LessonPractice.jsx`     | The Practice tab route that opens it.                                                          |
| `apps/web/src/components/MyLessonAnswers.jsx`      | The private "Your answers" panel on the lesson page.                                           |
| `apps/web/src/pages/lesson/LessonLayout.jsx`       | Start vs. **Continue lesson** on the lesson page's button.                                     |
| `apps/web/src/lib/useSpeech.js`                    | Speaking: the browser's voices or a natural one, the fallback, making ahead.                   |
| `apps/web/src/lib/speechPrefs.js`                  | The read-aloud preferences and voice lists, shared with the settings page.                     |
| `apps/web/src/components/SpeechVoiceSelect.jsx`    | The voice picker the popover and the settings page share.                                      |
| `packages/core/src/browser/readAloud.js`           | The device check for natural voices, the cache check, and the door to their engine.            |
| `packages/core/src/speech.ts`                      | Spoken text: a text block's hints and pauses, chunking, plain text for the browser's voice.    |
| `packages/core/src/browser/readAloudText.js`       | Kokoro's input: text clean-up, espeak-ng phonemes, read-aloud hints.                           |
| `packages/core/src/browser/readAloudEngine.js`     | Kokoro: the model, made from the phonemes readAloudText.js gives.                              |
| `packages/core/src/browser/readAloudVoices.js`     | The model id and pin, and the Kokoro voices on offer, listable without loading the engine.     |
| `apps/web/bench/read-aloud.html`                   | The dev-only timing page for Kokoro.                                                           |
