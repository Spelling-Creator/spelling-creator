---
title: Interactive lesson mode
---

# Interactive lesson mode

Any lesson on the hub can be **worked through** instead of read. Press **Start
lesson** on a lesson page (or open `/hub/:id/practice` directly) and the lesson
takes over the screen: a section's material appears on its own, one step at a
time, then that section's questions appear one after another, each with a field
to type an answer into.

It has its own URL (it is a tab of the lesson; see
[Pages & routing](./pages-and-routing.md)), so a teacher can send a class
straight into the walkthrough rather than to the lesson with an instruction to
press a button. Closing it returns to the lesson. The component itself is still
a dialog, deliberately: it is a focus mode with its own bottom bars and its own
idea of the viewport, and the route only decides when it is open.

You don't have to finish in one sitting: what you type is kept in your browser as
you go, and the lesson reopens where you left it. See
[Picking up where you left off](#picking-up-where-you-left-off).

At the end you get a summary of everything you wrote, and, if you're signed in,
it is saved **privately to your account**. Nobody else can read it, including the
person who wrote the lesson. See [Privacy](#privacy-who-can-read-your-answers)
below, which is the part of this feature worth being precise about.

The lesson can also be **read aloud** with the browser's built-in speech
synthesis, on the reader's own device. See
[Reading aloud](#reading-aloud-text-to-speech).

Someone presenting a lesson to a class can turn on
[show answers](#showing-the-answers-for-whoever-is-presenting) to see the
author's answer to each question alongside it.

## Every existing lesson already works

There is no "interactive lesson" document type and nothing to switch on when
authoring. The walkthrough is **derived from the lesson document you already
have** (`packages/core/src/interactive.js`), so every lesson ever published works,
including ones made long before this feature existed and ones written by the
[MCP server](/mcp-server/overview). Nothing is added to a lesson to make it
playable, and a lesson stays exactly as printable as it was.

The rules that turn a document into steps:

| In the document                                   | Becomes                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| A section's text, image, spelling and VAKT blocks | One **content step**, holding them together in document order.          |
| Each question block                               | One **question step**, with a text field, after that section's content. |
| A section with only questions                     | No content step; it opens straight on its first question.               |
| A section with nothing in it                      | Nothing.                                                                |
| A lesson with no questions at all                 | A read-through: every content step, no answer fields, nothing saved.    |

Text blocks keep their bold, italics and underlining, but not their footnote
markers: this is the screen the speller reads, and a superscript number with
nowhere on the screen to lead to is clutter there. The voice reads the plain
words (see [Formatting, footnotes & sources](./formatting-and-footnotes.md)).

Questions are numbered from 1 within each section, matching the editor's `Q7`
numbering (see [Navigating large lessons](./navigating-large-lessons.md#question-numbering)).

## What it looks like

Interactive mode is **full-screen** and drawn in the app's own theme, light or
dark, as is the lesson page below it, which follows the theme too rather than
reproducing the white sheet the [DOCX/PDF export](./export-pipeline.md)
produces. What's different here is the _scale_: a surface you read and answer on
for twenty minutes gets its own treatment, so the blocks are re-rendered: prose
at reading size, images framed in the app's border and radius and sized by the
reading column rather than by the size and alignment they carry (so a picture
fills the width on a phone), spelling words as
cards you could read across a room, and a
[VAKT activity](./vakt-activities.md) set apart as a red-edged card so whoever is
presenting spots it mid-passage and stops. Only the presentation differs; the content
is the same blocks.

A progress bar across the top counts the steps and how many questions you've
answered so far.

## Showing the answers (for whoever is presenting)

The eye button in the top bar turns on **show answers**, and each question then
displays the answer its author wrote, under the field you type into. It's there
for the person running the lesson at the front of a room, who would otherwise
keep the lesson open in a second window to see what they're walking a class
towards.

- It starts **off every time interactive mode opens**. Unlike the speech
  settings it isn't remembered, so a learner's own run-through never begins with
  the answers on screen.
- The button is only rendered when the lesson has an answer to reveal
  _somewhere_; a lesson of purely open-ended questions has nothing behind it.
- Each question type shows what it stores: the answer for a single, number or
  background question, the working steps as well for a number question, and
  every accepted answer for a multiple-answer one. An open-ended question, which
  by design has no author's answer, says so rather than leaving a gap.
- A **suggested-answers** question labels its reveal as suggestions and says that
  anything fitting the topic counts. Whoever is looking at the reveal is usually
  the person deciding whether the learner was right, and for that one type the
  decision is genuinely theirs: reading three boxes as the only right answers
  would mark a learner wrong for an answer the question was written to accept.
- **Every answer gets a box of its own**, so a multiple-answer question shows
  three answers as three things rather than as a bulleted list under one
  heading. They're stacked as equals rather than numbered: any of them is a right
  answer, and a list numbered 1, 2, 3 reads as an order to give them in. A number
  question's _working_ is not one of these boxes: it's how you reach the answer,
  not an answer, and it stays a numbered list below them.
- **Clicking an answer puts it in your field.** It replaces what's there (a
  multiple-answer question wants one of its accepted answers, not all of them run
  together), then focuses the field with the caret at the end, since the point of
  putting text there is usually to keep working on it. What lands in the field is
  from then on your own answer: it counts as answered, it's kept by
  [progress](#picking-up-where-you-left-off), and it's what gets filed at the end.
  A shortcut through typing, not a verdict; see below.
- The reveal also applies to the **end-of-lesson summary**, where the author's
  answer sits under the one you wrote. Useful for going back over the questions
  as a class. The boxes are read-only there: there is no field to fill on the
  summary, so nothing there is clickable.
- Answers are still **never spoken**; see [Reading aloud](#reading-aloud-text-to-speech).

Showing an answer is not marking one; see below.

## Picking up where you left off

A lesson is twenty minutes of typing, and a bell goes, or a tab gets closed, or a
laptop lid comes down. So the run-through you are in the middle of is **written
to your browser as you work** (every answer and which step you were on), and
opening the lesson again drops you back exactly there, with what you'd typed
still in the fields. The lesson page's button says **Continue lesson** rather
than **Start lesson** when there is something to come back to, and the step you
resume at says so, with a **Start again** button beside it for when the thing
waiting is somebody else's half-finished attempt.

This is deliberately **not** the same mechanism as the saved run-throughs above,
and the differences are the point:

|              | Progress (unfinished)                                       | A saved run-through (finished) |
| ------------ | ----------------------------------------------------------- | ------------------------------ |
| Lives in     | this browser (`localStorage`)                               | your account, on the server    |
| Needs        | nothing; signed out works too                               | a signed-in session            |
| Travels      | no: this device only                                        | yes: any device you sign in on |
| Kept until   | it is filed, you start again or discard it, or 90 days pass | you delete it                  |
| Anyone else? | never sent anywhere at all                                  | only you can read it           |

Consequences worth knowing:

- Progress **does not follow you between devices**. Starting on a school desktop
  and finishing on a phone still starts over. Syncing it would mean putting
  half-written answers on the server, which is a much bigger promise than "your
  tab remembers", and this feature isn't worth making it.
- Records are kept **per signed-in learner as well as per lesson**. A shared
  classroom machine is the normal case here, and resuming into whatever the
  previous user typed would be worse than not resuming at all. Two learners who
  are both **signed out** do share one record per lesson, because there is
  nothing to tell them apart: the browser is the only identity on offer. That is
  the same bargain as a half-filled form left in a shared browser, and it is why
  a resumed run-through always says so and offers _Start again_ rather than
  quietly continuing.
- A run-through belongs to **whoever started it**. The signed-in account can
  change with the walkthrough open (a sign-in in another tab, a sign-out), and
  the run then carries on writing to the record it began in, rather than moving
  one person's half-written answers into the account that just appeared.
  Pressing **Finish** in that state doesn't file them either; the summary says
  why, and the answers stay on the device for the learner they belong to. This is
  why the copy has always said to sign in _before_ you start.
- A browser keeps the 20 most recently touched lessons and forgets a run-through
  nobody came back to within 90 days. Pruning is fine here in a way it explicitly
  [isn't for saved run-throughs](#worker-endpoints): this is a resume cache, not
  the only copy of anything you chose to keep.
- **Closing mid-way no longer discards anything**, so the confirmation on the way
  out now says that instead of warning about it, and carries a _Discard answers_
  button for deliberately throwing the attempt away. Where the browser refuses us
  storage (private browsing, a full quota) or has none at all, the old warning
  comes back, because by then it is true again: every write reports whether it
  landed, and the confirmation only promises what was actually kept.
- The local copy is dropped **as soon as the run-through is filed** to your
  account. A _failed_ save deliberately leaves it, so closing and coming back is
  a way to try again rather than a way to lose the lot. Signed out, where saving
  was never possible, it also stays, since it is the only copy there is.
- Answers are keyed by **block id**, so a lesson edited between two sittings still
  matches each answer to its question. The step you were on is remembered by key
  rather than by number for the same reason; if that step has since been deleted
  the lesson opens at the top, with the answers still restored.

## What it deliberately doesn't do

**It doesn't mark your answers.** Nothing you type is ever compared against the
author's answer, and no verdict is ever drawn: not while answering, not on the
summary, and not with the reveal above turned on, which only puts the two side
by side. Spelling is about the learner producing the response; a right/wrong
verdict from a string comparison would be wrong a lot of the time and the wrong
shape of feedback even when it wasn't.

Taking an author's answer into your field by
[clicking it](#showing-the-answers-for-whoever-is-presenting) doesn't change
that. It's a deliberate act on a panel you had to switch on, and all it does is
save you typing: the answer that lands there is treated exactly like one you
wrote yourself, and nothing anywhere notices where it came from.

**It doesn't store a half-finished run-through as a completed one.** Progress is
a browser-side scratchpad; nothing reaches `lesson_responses` until you press
**Finish**, and the _Your answers_ panel only ever lists run-throughs that were
finished.

## Privacy: who can read your answers

Only you.

- Every endpoint that touches saved answers requires a signed-in session, and
  the Worker scopes each query to `user_id = <verified caller>`; that filter is
  the only way a row is ever addressed, not a check layered on top of one.
- There is **no endpoint that returns another user's answers**. Not for the
  lesson's author, not for a moderator, not for an admin. A lesson author can see
  that their lesson exists and who commented on it; they cannot see who worked
  through it or what they wrote.
- The `lesson_responses` table has no public read policy, unlike `lessons`,
  `comments` and `ratings`.
- Answers are **not** run through the profanity filter that
  [comments](./lesson-hub-and-accounts.md) go through. There's no audience to
  protect: nobody but their author ever reads them.
- The in-progress copy described in
  [Picking up where you left off](#picking-up-where-you-left-off) is narrower
  still: it never leaves the device. There is no endpoint behind it, nothing to
  scope by user id server-side, and no new way for anyone (author, moderator,
  admin) to learn that a lesson was even opened.

Your saved run-throughs appear in a **Your answers** panel on the lesson page,
below the lesson itself and above the comments. It renders for you and nobody
else, and each one can be deleted outright.

Signed out, you can still work through a lesson start to finish and see your
summary; there's just no account to save it to, and the summary says so.

## Reading aloud (text-to-speech)

The speaker button in the top bar turns on **read aloud**, using the browser's
[Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
(`speechSynthesis`), or a [natural voice](#natural-voices) where the device
can run one. Like [lesson summaries](./lesson-summaries.md), this runs
entirely on the reader's own device: no Worker call, no API key, no cost, and the
lesson text never leaves the machine. Unlike summaries, the browser's voices
need no special hardware and are supported across current browsers, but speech
is still probed for rather than assumed, and where it's missing the controls
aren't rendered at all.

With it on:

- each step is read as it appears: the section name, then the prose, image
  captions (never their [credits](./image-credits.md)), or the question prompt;
- a **replay** button re-reads the current step (and turns into a stop button
  while it's speaking);
- every **spelling word gets its own speaker button**, because hearing one word
  again is the commonest thing a learner wants and a different job from hearing
  the whole step;
- the settings popover picks a **voice** (the natural voices, if this device
  can run them, then the ones the browser offers) and a **pace** from 0.7x to
  1.5x.

A question's answer is never spoken, even with
[show answers](#showing-the-answers-for-whoever-is-presenting) on: speech is a
learner's setting as often as a presenter's, and saying the answer out loud the
moment a question appears would give it away to the one person meant to be
working it out. Revealing it on screen is a deliberate act; speaking it would be
a side effect of one.

Your choice of on/off, voice and pace is remembered in `localStorage`, so someone
who needs speech doesn't re-enable it on every lesson. The same three settings
appear under **Reading aloud** on the [settings page](./pages-and-routing.md),
for anyone who would rather set them up before starting a lesson than from the
popover mid-walkthrough; both read and write the same keys through
`apps/web/src/lib/speechPrefs.js`. A change made in one reaches the other the
next time it's opened, not while both are on screen.

On a browser with no speech synthesis neither the controls nor the settings
section is rendered at all, rather than offering a button that can't work.

Three platform quirks are handled between the two files. `speechPrefs.js` takes
the one that belongs to the voice list: voices load asynchronously, announced by
`voiceschanged`. `useSpeech.js` takes the two that belong to speaking: Chromium
cuts off a single utterance after about 15 seconds (so text is split into
sentence-sized chunks and queued), and `cancel()` isn't synchronous (so a new
utterance is deferred a tick after one).

### Natural voices

The browser's voices depend on the device, and some are robotic. The natural
voices are [Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX),
an 82M-parameter voice model that runs in the page with transformers.js, like
the summary and import models. Eight of its English voices (the ones graded C+
or better) are listed under **Natural voices** in the voice picker, above the
browser's own, in both the popover and the settings page
(`apps/web/src/components/SpeechVoiceSelect.jsx`). The choice is stored in the
same voice preference as `kokoro:<voice id>`.

How it behaves:

- **Only where it can run.** The list is shown only on a device with WebGPU
  that isn't a phone or tablet and isn't on a metered connection
  (`readAloudPossible` in `packages/core/src/browser/readAloud.js`). Phones
  and tablets are excluded by name, because WebGPU alone doesn't rule them
  out: an iPad has it, and Kokoro froze and then crashed Safari on one.
  iPadOS calls itself a Mac, so it's recognised by having a touch screen.
  A stored natural voice the device can't use right now (on a metered
  connection, say) shows as the browser default in the picker, since that is
  what reads; the choice itself is kept.
- **Opt-in, because of the download.** The browser default stays the
  default. Choosing a natural voice says that the first use downloads about
  330 MB, once. Nothing downloads until practice mode speaks with speech on,
  so choosing one on the settings page, or with speech off, downloads
  nothing. The device check runs again just before, so a connection that has
  turned metered since the page loaded doesn't start one.
- **Never silent while it downloads.** During the download the browser's
  voice reads, and a line under the step count shows the progress. Screen
  readers hear that it's downloading once, not every percent. The natural
  voice takes over from the next thing spoken.
- **Ready from the first step once downloaded.** When the model is already
  in the cache (`readAloudCached` in `readAloud.js` looks for its weights),
  it loads as soon as practice mode opens with speech on, which takes a
  couple of seconds. A step spoken meanwhile waits for it, up to five
  seconds, instead of being read in the browser's voice, and the line under
  the step count says "Getting the natural voice ready...". Past the five
  seconds the browser's voice reads that step and the natural one takes over
  from the next.
- **The browser's voice is the fallback**, in three ways, and the same line
  says which:
  - a download that fails is tried again on the next step, up to three times
    in a visit (files that finished are cached, so a retry picks up where a
    dropped connection left off);
  - a chunk the model fails to make costs only that step: what was already
    queued plays out, then the browser's voice reads from the failed chunk.
    Two steps in a row like that and the natural voice is dropped for the
    visit;
  - if the browser won't start Web Audio (no recent click, a strict autoplay
    rule), that step is read by the browser's voice rather than queued in
    silence.
- **Steps play as one stream.** Each chunk is made, then queued on a Web Audio
  timeline straight after the one before, so playback runs on while the next
  chunk is made.
- **The next step is made ahead.** While a step plays, the first two chunks of
  the next step are made too (`prepare` in `useSpeech.js`), so pressing Next
  starts speaking at once. This waits until the current step has been made:
  the model does one thing at a time, so running it alongside would hold up
  the chunks being listened to. Made chunks are kept for a few steps, so
  replaying a step or a spelling word doesn't make it again.
- **English only.** Like choosing an English browser voice, picking one for a
  lesson in another language reads it with English pronunciation.

Kokoro reads phonemes, not text. `packages/core/src/browser/readAloudEngine.js`
spells out numbers and abbreviations, turns the words into IPA with
[Spellophone](https://spellophone.spellingcreator.org/) (our WebAssembly build
of espeak-ng, the phonemizer Kokoro was trained against), and passes that to
the model. The text clean-up follows kokoro.js, the reference JavaScript port.
That package isn't used itself because it pins transformers.js 3, which would
put a second ONNX runtime in the bundle. Only Spellophone's English data is
bundled (about 830 KB), as hashed assets of the build, not fetched from a CDN.

To time it on a device, run `pnpm dev:web` and open
`/bench/read-aloud.html`. The page reads the first six steps of a real hub
lesson, chunked as `useSpeech.js` chunks them, and reports:

- **first audio**: from pressing play to sound, once the model is loaded;
- **RTF** (real-time factor): time to make a chunk over how long it speaks.
  Under 1 keeps ahead of playback;
- **stalls**: silence mid-step while the next chunk is still being made.

The page is served by the dev server only; the production build's one entry is
`index.html`. WebGPU needs a secure context, so a phone or tablet has to reach
it over HTTPS.

Measured on a Mac, 110 s of speech, `af_heart`:

| Browser and backend       | First audio | Median RTF | Stalls |
| ------------------------- | ----------- | ---------- | ------ |
| Chrome 154, WebGPU, fp32  | 0.56 s      | 0.17       | none   |
| WebKit 26.6, WebGPU, fp32 | 0.85 s      | 0.25       | 0.4 s  |
| Chrome 154, WASM, fp32    | 2.4 s       | 1.16       | 39 s   |
| Chrome 154, WASM, q8      | 3.0 s       | 1.48       | 70 s   |

What the numbers decided:

- **WebGPU or nothing.** The site isn't cross-origin isolated, so the WASM
  backend runs on one thread, and on one thread Kokoro is slower than speech
  even on a Mac. q8 is slower than fp32 there, too. The device check asks for
  WebGPU for this reason.
- **A throwaway run while loading.** The first run is slow while WebGPU
  compiles its shaders (1.9 s against 0.4 s for the same short line), so the
  engine does one as part of loading.
- **Making the next step ahead.** The one WebKit stall is a short section name
  followed by a long chunk: the name finishes playing before the next chunk is
  ready. The first two chunks of every step after the first are made while the
  step before plays.
- **Computers only.** On an iPad it freezes and then crashes (Safari, WebGPU,
  fp32). Kokoro is aimed at computers, which is what the spellers we know use
  for sessions, and phones and tablets keep the browser's voices.

## Worker endpoints

| Method & path                        | Auth                    | Response                                                                                             |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /lessons/:id/responses`         | `Bearer <Supabase JWT>` | `{ "responses": [{ id, lessonId, answers, completedAt }] }`; **the caller's own only**, newest first |
| `POST /lessons/:id/responses`        | `Bearer <Supabase JWT>` | `{ "response": { id, lessonId, answers, completedAt } }`                                             |
| `DELETE /lessons/:id/responses/:rid` | `Bearer <Supabase JWT>` | `{ "ok": true }`, the caller's own only; else `404`                                                  |

- `POST` body is `{ answers }`, where `answers` is one entry per question:
  `{ blockId, sectionId, sectionName, questionType, prompt, answer }`. The
  Worker normalises every field to a string of known maximum length and drops
  anything else, so the stored `jsonb` can only hold that shape.
- The **prompt is snapshotted** alongside the answer on purpose: a saved
  run-through has to stay readable after the lesson is edited, re-ordered, or has
  that question deleted.
- Skipped questions are stored as blank answers rather than dropped, so the set
  still says which questions were asked.
- Limits (shared between browser and Worker in
  `packages/core/src/interactive.js`): 5,000 characters per answer and 500
  answers per submission.
- You may keep **20 saved run-throughs of any one lesson**. Past that a `POST` is
  rejected with `409` and a message asking you to delete an older one, rejected
  rather than silently pruning the oldest, for the same reason the
  [draft cap](./lesson-hub-and-accounts.md) is: they're the user's own answers,
  and quietly deleting them to make room isn't ours to decide.
- `POST` also checks the lesson is one the caller could have read in the first
  place: published and not shadowbanned, or theirs / trusted / moderated.

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

## Where the code lives

| File                                               | What it does                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/core/src/interactive.js`                 | Turns a document into steps; the answers the reveal shows; limits and validation. |
| `packages/core/src/browser/interactiveProgress.js` | The unfinished run-through kept on the device: resume, expiry, pruning.           |
| `packages/core/src/lessonResponses.js`             | Client for the three endpoints above.                                             |
| `apps/api/src/routes/lessonResponses.js`           | The endpoints, and the privacy scoping.                                           |
| `apps/web/src/components/InteractiveLesson.jsx`    | The full-screen walkthrough.                                                      |
| `apps/web/src/components/MyLessonAnswers.jsx`      | The private "Your answers" panel on the lesson page.                              |
| `apps/web/src/pages/lesson/LessonLayout.jsx`       | Start vs. **Continue lesson** on the lesson page's button.                        |
| `apps/web/src/lib/useSpeech.js`                    | Speaking: the browser's voices or a natural one, the fallback, making ahead.      |
| `apps/web/src/lib/speechPrefs.js`                  | The read-aloud preferences and voice lists, shared with the settings page.        |
| `apps/web/src/components/SpeechVoiceSelect.jsx`    | The voice picker the popover and the settings page share.                         |
| `packages/core/src/browser/readAloud.js`           | The device check for natural voices, and the door to their engine.                |
| `packages/core/src/browser/readAloudEngine.js`     | Kokoro: text clean-up, espeak-ng phonemes, the model.                             |
| `packages/core/src/browser/readAloudVoices.js`     | The Kokoro voices on offer, listable without loading the engine.                  |
| `apps/web/bench/read-aloud.html`                   | The dev-only timing page for Kokoro.                                              |
