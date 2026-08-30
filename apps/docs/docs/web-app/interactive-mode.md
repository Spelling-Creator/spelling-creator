---
title: Interactive lesson mode
---

# Interactive lesson mode

Any lesson on the hub can be **worked through** instead of read. Press **Start
lesson** on a lesson page — or open `/hub/:id/practice` directly — and the lesson
takes over the screen: a section's material appears on its own, one step at a
time, then that section's questions appear one after another, each with a field
to type an answer into.

It has its own URL (it is a tab of the lesson — see
[Pages & routing](./pages-and-routing.md)), so a teacher can send a class
straight into the walkthrough rather than to the lesson with an instruction to
press a button. Closing it returns to the lesson. The component itself is still
a dialog, deliberately: it is a focus mode with its own bottom bars and its own
idea of the viewport, and the route only decides when it is open.

You don't have to finish in one sitting: what you type is kept in your browser as
you go, and the lesson reopens where you left it. See
[Picking up where you left off](#picking-up-where-you-left-off).

At the end you get a summary of everything you wrote, and — if you're signed in —
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
have** (`packages/core/src/interactive.js`), so every lesson ever published works
— including ones made long before this feature existed and ones written by the
[MCP server](/mcp-server/overview). Nothing is added to a lesson to make it
playable, and a lesson stays exactly as printable as it was.

The rules that turn a document into steps:

| In the document                             | Becomes                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| A section's text, image and spelling blocks | One **content step**, holding them together in document order.          |
| Each question block                         | One **question step**, with a text field, after that section's content. |
| A section with only questions               | No content step — it opens straight on its first question.              |
| A section with nothing in it                | Nothing.                                                                |
| A lesson with no questions at all           | A read-through: every content step, no answer fields, nothing saved.    |

Questions are numbered from 1 within each section, matching the editor's `Q7`
numbering (see [Navigating large lessons](./navigating-large-lessons.md#question-numbering)).

## What it looks like

Interactive mode is **full-screen** and drawn in the app's own theme, light or
dark — as is the lesson page below it, which follows the theme too rather than
reproducing the white sheet the [DOCX/PDF export](./export-pipeline.md)
produces. What's different here is the _scale_: a surface you read and answer on
for twenty minutes gets its own treatment, so the blocks are re-rendered — prose
at reading size, images framed in the app's border and radius, spelling words as
cards you could read across a room. Only the presentation differs; the content
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
  _somewhere_ — a lesson of purely open-ended questions has nothing behind it.
- Each question type shows what it stores: the answer for a single, number or
  background question, the working steps as well for a number question, and
  every accepted answer for a multiple-answer one. An open-ended question — which
  by design has no author's answer — says so rather than leaving a gap.
- **Every answer gets a box of its own**, so a multiple-answer question shows
  three answers as three things rather than as a bulleted list under one
  heading. They're stacked as equals rather than numbered: any of them is a right
  answer, and a list numbered 1, 2, 3 reads as an order to give them in. A number
  question's _working_ is not one of these boxes — it's how you reach the answer,
  not an answer, and it stays a numbered list below them.
- **Clicking an answer puts it in your field.** It replaces what's there (a
  multiple-answer question wants one of its accepted answers, not all of them run
  together), then focuses the field with the caret at the end, since the point of
  putting text there is usually to keep working on it. What lands in the field is
  from then on your own answer: it counts as answered, it's kept by
  [progress](#picking-up-where-you-left-off), and it's what gets filed at the end.
  A shortcut through typing, not a verdict — see below.
- The reveal also applies to the **end-of-lesson summary**, where the author's
  answer sits under the one you wrote. Useful for going back over the questions
  as a class. The boxes are read-only there: there is no field to fill on the
  summary, so nothing there is clickable.
- Answers are still **never spoken** — see [Reading aloud](#reading-aloud-text-to-speech).

Showing an answer is not marking one; see below.

## Picking up where you left off

A lesson is twenty minutes of typing, and a bell goes, or a tab gets closed, or a
laptop lid comes down. So the run-through you are in the middle of is **written
to your browser as you work** — every answer and which step you were on — and
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
| Needs        | nothing — signed out works too                              | a signed-in session            |
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
  change with the walkthrough open — a sign-in in another tab, a sign-out — and
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
  out now says that instead of warning about it — and carries a _Discard answers_
  button for deliberately throwing the attempt away. Where the browser refuses us
  storage (private browsing, a full quota) or has none at all, the old warning
  comes back, because by then it is true again: every write reports whether it
  landed, and the confirmation only promises what was actually kept.
- The local copy is dropped **as soon as the run-through is filed** to your
  account. A _failed_ save deliberately leaves it, so closing and coming back is
  a way to try again rather than a way to lose the lot. Signed out — where saving
  was never possible — it also stays, since it is the only copy there is.
- Answers are keyed by **block id**, so a lesson edited between two sittings still
  matches each answer to its question. The step you were on is remembered by key
  rather than by number for the same reason; if that step has since been deleted
  the lesson opens at the top, with the answers still restored.

## What it deliberately doesn't do

**It doesn't mark your answers.** Nothing you type is ever compared against the
author's answer, and no verdict is ever drawn — not while answering, not on the
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
  the Worker scopes each query to `user_id = <verified caller>` — that filter is
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
  scope by user id server-side, and no new way for anyone — author, moderator,
  admin — to learn that a lesson was even opened.

Your saved run-throughs appear in a **Your answers** panel on the lesson page,
below the lesson itself and above the comments. It renders for you and nobody
else, and each one can be deleted outright.

Signed out, you can still work through a lesson start to finish and see your
summary — there's just no account to save it to, and the summary says so.

## Reading aloud (text-to-speech)

The speaker button in the top bar turns on **read aloud**, using the browser's
[Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
(`speechSynthesis`). Like [lesson summaries](./lesson-summaries.md), this runs
entirely on the reader's own device: no Worker call, no API key, no cost, and the
lesson text never leaves the machine. Unlike summaries, it needs no special
hardware and is supported across current browsers — but it's still probed for
rather than assumed, and where it's missing the controls aren't rendered at all.

With it on:

- each step is read as it appears — the section name, then the prose, image
  captions, or the question prompt;
- a **replay** button re-reads the current step (and turns into a stop button
  while it's speaking);
- every **spelling word gets its own speaker button**, because hearing one word
  again is the commonest thing a learner wants and a different job from hearing
  the whole step;
- the settings popover picks a **voice** from the ones the browser offers and a
  **pace** from 0.7× to 1.5×.

A question's answer is never spoken, even with
[show answers](#showing-the-answers-for-whoever-is-presenting) on: speech is a
learner's setting as often as a presenter's, and saying the answer out loud the
moment a question appears would give it away to the one person meant to be
working it out. Revealing it on screen is a deliberate act; speaking it would be
a side effect of one.

Your choice of on/off, voice and pace is remembered in `localStorage`, so someone
who needs speech doesn't re-enable it on every lesson. On a browser with no
speech synthesis the controls aren't rendered at all, rather than offering a
button that can't work.

Three platform quirks are handled in `apps/web/src/lib/useSpeech.js`: voices load
asynchronously (`voiceschanged`), Chromium cuts off a single utterance after
about 15 seconds (so text is split into sentence-sized chunks and queued), and
`cancel()` isn't synchronous (so a new utterance is deferred a tick after one).

## Worker endpoints

| Method & path                        | Auth                    | Response                                                                                              |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /lessons/:id/responses`         | `Bearer <Supabase JWT>` | `{ "responses": [{ id, lessonId, answers, completedAt }] }` — **the caller's own only**, newest first |
| `POST /lessons/:id/responses`        | `Bearer <Supabase JWT>` | `{ "response": { id, lessonId, answers, completedAt } }`                                              |
| `DELETE /lessons/:id/responses/:rid` | `Bearer <Supabase JWT>` | `{ "ok": true }` — the caller's own only; else `404`                                                  |

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
  rejected with `409` and a message asking you to delete an older one — rejected
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
| `apps/web/src/lib/useSpeech.js`                    | Web Speech API wrapper, preferences, and the platform workarounds.                |
