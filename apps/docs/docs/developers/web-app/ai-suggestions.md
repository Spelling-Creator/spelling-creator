---
title: AI suggestions
---

# AI suggestions

For how to use these, see [AI writing help](../../guide/ai-writing-help.md).

Three editor helpers ask the companion Worker (`apps/api`) to write something:
lesson ideas, a block of section text, and a question. They share one endpoint,
`POST /` on the Worker (`handleAi` in `apps/api/src/routes/ai.js`), told apart
by a `mode` field, and the same Turnstile check and rate limiter as
[AI lesson fixes](./ai-lesson-fixes.md), [fact checking](./fact-checking.md)
and the image search.

| Helper       | Dialog                   | Opened from                                                | `mode`       | Browser wrapper        |
| ------------ | ------------------------ | ---------------------------------------------------------- | ------------ | ---------------------- |
| Lesson ideas | `AiLessonIdeaDialog.jsx` | **Suggest ideas**, beside the age range under the title    | `lessonIdea` | `suggestLessonIdeas()` |
| Section text | `AiTextDialog.jsx`       | **Generate with AI** > **Text** in a section's toolbar     | `text`       | `suggestText()`        |
| Question     | `AiQuestionDialog.jsx`   | **Generate with AI** > **Question** in a section's toolbar | `question`   | `suggestQuestion()`    |

The dialogs are in `apps/web/src/components/`, the wrappers in
`packages/core/src/aiSuggest.js`. The two section helpers are mounted by
`SectionCard.jsx`, the idea dialog by `EditorPage.jsx`.

## The shared flow

1. The dialog renders a
   [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/)
   widget. Its token is single-use, so the widget is reset after every request.
2. The wrapper POSTs the token and the mode's fields to `apiUrl()`.
3. The Worker verifies the token server-side against its allowed hostnames
   (`verifyTurnstile`, using Cloudflare's verified `hostname` rather than the
   spoofable `Origin`), then charges the per-IP token bucket: 60 requests a
   minute, refilled continuously, kept in the rate-limit KV store. A cached
   answer is served before the charge and costs nothing. An empty bucket
   answers 429 with `Retry-After`.
4. It calls `generateWithFallback` (see
   [Which model answers](#which-model-answers)) and returns JSON. Any provider
   failure becomes a 502 `Upstream AI error`.

An unknown `mode` falls back to `text`.

The web app needs `VITE_API_URL` and `VITE_TURNSTILE_SITE_KEY`, and the Worker
`TURNSTILE_SECRET_KEY`, a rate-limit store and at least one AI provider. See
[Getting started](./getting-started.md) and the monorepo
[Getting started](../getting-started.md).

## Lesson ideas

`suggestLessonIdeas(ageRange, token)` sends `{ mode: "lessonIdea", ageRange,
token }`. The age range is the lesson's `doc.ageRange`, one of `AGE_RANGES` in
`packages/core/src/ageRanges.js` (`"3-5 years"` through `"16+ years"`, or empty
for any age), stored verbatim so the prompt can use it directly. The Worker
caps it at 60 characters.

The prompt says who the lessons are for: spellers (of the chosen age, when
there is one), described as nonspeaking people who answer on a letterboard and
understand far more than they can say. It tells the model to pick topics that
interest and respect that age, and never to simplify a topic or pitch it below
their age. The age range steers interest, not difficulty. The same framing runs
through the other prompts: question suggestions are "for a Spelling lesson"
answered on a letterboard, and the per-type instructions in
`QUESTION_INSTRUCTIONS` talk about "the speller", not a student.

The prompt asks for six varied topics, each a `title` and a one-sentence
`description`, constrained by `LESSON_IDEA_SCHEMA`
(`apps/api/src/lib/ai/schemas.js`). The response is `{ "ideas": [{ "title",
"description" }] }`, capped at 12. Ideas are not cached, since people expect a
fresh batch each time. Choosing one calls the editor's `setTitle` with its
title; nothing else in the lesson changes.

## Section text

`suggestText(subject, token, { documentName })` sends the section name as
`subject` and the lesson title as `documentName` (no `mode`, so it is the
default). The prompt tells the model to treat the lesson title as the
overarching topic, to write unusual or important words in ALL CAPS so they read
as spelling words (but never the lesson title), and that it may include numbers
for number questions. The response is `{ "text" }`.

Text answers are cached in KV for 30 days (`CACHE_TTL`), keyed by `cacheKey`
on `["text", subject, documentName]`, normalized case-insensitively. A repeat
request is served from the cache before the rate limiter, so it costs neither
a token nor a model call.

### Dislike

A signed-in user can thumbs-down a suggestion. `dislikeText()` calls
`POST /ai-text/dislike` (`handleTextFeedback` in
`apps/api/src/routes/feedback.js`) with the Supabase session as a Bearer token
and the same `subject` and `documentName`. The route verifies the user,
rebuilds the identical cache key and deletes it, so the next request writes a
fresh answer. It is gated by sign-in rather than Turnstile because it changes
the shared server cache, and it neither consumes a rate-limit token nor calls a
model. Deleting a key that has already expired still answers `{ ok: true }`.

After a dislike, the dialog offers **Generate fresh** and demotes **Insert** to
**Insert anyway**.

## Questions

`suggestQuestion(subject, token, { questionType, documentName, sectionText,
existingQuestions })` sends `mode: "question"` with:

- `questionType`, one of the eight keys in `QUESTION_TYPES`
  (`packages/core/src/questions.js`), the same list as the **Add question**
  menu. The dialog defaults to `single`.
- `sectionText`, the section's existing text, so the question is answerable
  from the lesson. For `background` the prompt inverts it: the question must
  test knowledge the text does not explain.
- `existingQuestions`, the prompts already in the section (the Worker keeps the
  first 50 non-empty ones), so the model asks something new.

The Worker answers with JSON matching that type's entry in `QUESTION_SCHEMAS`.
`buildQuestionBlock(newId, questionType, data)` in `questions.js` maps it onto
the same block shape `createQuestionBlock` makes: each `answers` string becomes
an `{ id, text }` row (with at least one row, even if empty), `steps` strings
become step rows, and a number answer is stored as a string. The block is
inserted straight away, with no preview.

Questions are never cached: people often generate several of one type for the
same section and expect a different one each time.

Every type in the **Add question** menu needs an entry in `QUESTION_SCHEMAS`,
`QUESTION_LABELS` and `QUESTION_INSTRUCTIONS` (`apps/api/src/lib/ai/schemas.js`).
The Worker refuses a `questionType` it has no schema for with a 400, so a type
in the menu without one is a button that only returns an error. Add all three
entries whenever a question type is added.

## Which model answers

`generateWithFallback({ prompt, schema, env })` in
`apps/api/src/lib/ai/index.js` tries each configured provider in order, and
within a provider each of its models in order, returning the first answer. A
`schema` (plain JSON Schema) asks for structured output, which each provider
adapter translates into its own API's shape. Every server-side AI feature
(these three, [AI lesson fixes](./ai-lesson-fixes.md) and the claim extraction
in [fact checking](./fact-checking.md)) goes through it.

The default order is `gemini, openai, anthropic, groq, novita, fireworks,
openrouter, openai-compatible, workers-ai`, and `AI_PROVIDER_ORDER` overrides
it. The default models, each overridable with a comma-separated
`<PROVIDER>_MODELS` variable:

| Provider            | Configured by                                          | Default models, tried in order                                                      |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `gemini`            | `GEMINI_API_KEY`                                       | `gemini-3.5-flash`, `gemini-3-flash`, `gemini-2.5-flash`                            |
| `openai`            | `OPENAI_API_KEY`                                       | `gpt-5.4-mini`, `gpt-5-mini`                                                        |
| `anthropic`         | `ANTHROPIC_API_KEY`                                    | `claude-haiku-4-5-20251001`, `claude-sonnet-5`                                      |
| `groq`              | `GROQ_API_KEY`                                         | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`                                         |
| `novita`            | `NOVITA_API_KEY`                                       | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`                                         |
| `fireworks`         | `FIREWORKS_API_KEY`                                    | `accounts/fireworks/models/gpt-oss-120b`, `accounts/fireworks/models/glm-5p3-flash` |
| `openrouter`        | `OPENROUTER_API_KEY`                                   | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`                                         |
| `openai-compatible` | `OPENAI_COMPATIBLE_URL` and `OPENAI_COMPATIBLE_MODELS` | none; the model list is required                                                    |
| `workers-ai`        | the `AI` binding in `wrangler.jsonc`                   | `@cf/meta/llama-3.2-3b-instruct`, `@cf/openai/gpt-oss-20b`                          |

The provider configuration is covered in more detail in the monorepo
[Getting started](../getting-started.md).

None of this applies to [lesson summaries](./lesson-summaries.md),
[comment translation](./comment-translation.md) or
[lesson translation](./lesson-translation.md), which run on the reader's own
device and never call the Worker.
