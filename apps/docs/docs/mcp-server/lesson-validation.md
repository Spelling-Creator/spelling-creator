---
title: Lesson validation
---

# Lesson validation

Every tool that writes a lesson (`create_lesson`, `create_lesson_file`, `update_lesson`
and `patch_lesson`) checks it against the authoring standard first. **Errors reject the
write; warnings ride along with a successful one.**

The point of validating rather than only documenting is that the standard then holds even
when the model never read it. Server `instructions` are optional in the MCP spec and some
clients drop them (claude.ai's connector UI is the notable one), and a tool description is
advice the model may or may not follow. Validation does not depend on either.

The split between the two halves of the standard lives in two files:

| File                        | Holds                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mcp/src/standards.md` | The rules that need judgement: tone, difficulty, what makes a tight open easy. Sent as MCP `instructions` and embedded in `create_lesson`'s description. |
| `apps/mcp/src/validate.js`  | The rules a script can decide. Enforced on write, whatever the client showed the model.                                                                  |

Keep them in step: a rule stated in one that the other also covers should describe the
same thing.

## The two orange types

Nearly every check below that reads the passage belongs to **`multiple`**, the tight of the
two semi-open types. None of them run on **`multiple_open`**.

The guidebook the standard follows describes semi-open questions as a spectrum: tight
("Name a cardinal direction": a finite answer set the text establishes) through less tight
("Give a synonym for gratitude": bounded by the topic, but open to improvisation). Both
print orange. They are two types rather than one type with a flag because `answers` means
opposite things at the two ends:

|                             | `multiple` | `multiple_open` |
| --------------------------- | ---------- | --------------- |
| answers verbatim in passage | required   | not required    |
| answers form one whole list | required   | n/a             |
| prompt blanks its list out  | expected   | n/a             |
| answer key is               | exhaustive | advisory        |

Run against the loose end, the tight checks would reject exactly the question the standard
asks for: a synonym is by definition not in the passage, and a definition question has no
list behind it. So `E_GROUNDING_MULTIPLE`, `E_ORANGE_PARAPHRASED`, `E_ORANGE_NOT_A_LIST`,
`E_ORANGE_PARTIAL_LIST`, `E_ORANGE_ANSWER_IN_PROMPT` and `W_ORANGE_NO_BLANK` are scoped to
`multiple` alone.

Two further exemptions follow from the key being advisory rather than authoritative: a
`multiple_open` suggestion is not a word the speller has to produce, so:

- its answers are **outside `E_ANSWER_WORD_REUSED` and `E_SPELLING_COLLISION`**. A word that
  merely illustrates what would count is not "the answer to a question", and blocking a
  write because a warm-up word turns up among the examples would reject a lesson with
  nothing wrong with it.
- its answers are **not recall answers** for `E_ANSWER_REVEALED_CROSS`, in either direction.
  Naming one in another prompt gives nothing away, and its own prompt has to name the word
  it is asking about, so a leak there warns (`W_ANSWER_REVEALED_OPEN`) rather than blocks.

What still holds at both ends is what the two ends agree on: `W_ORANGE_MULTIWORD`, since a
letterboard speller has to spell every word either way, and having a key at all.

Because the two types are interchangeable in a section's two orange slots, `W_QUESTION_SHAPE`
accepts either in either slot and `W_ORANGE_ORDER` carries the ordering rule instead.

## Errors: the write is rejected

| Code                        | What tripped it                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E_GROUNDING_SINGLE`        | A green (`single`) answer does not appear, word for word, in its own section's passage.                                                                                                                                                                                                                                                                                   |
| `E_GROUNDING_MULTIPLE`      | A multi-word tight-orange (`multiple`) answer is not in its own section's passage.                                                                                                                                                                                                                                                                                        |
| `E_ORANGE_PARAPHRASED`      | A single-word `multiple` answer is not in the passage: usually paraphrase ("HOT" for "superheated"), general knowledge (which belongs in a `background` question), or a question that was really a synonym or definition (which belongs in `multiple_open`).                                                                                                              |
| `E_ORANGE_ANSWER_IN_PROMPT` | A `multiple` prompt contains one of its own accepted answers. The prompt quotes the passage's sentence with the list **blanked out**; writing the list into the prompt hands the answer over.                                                                                                                                                                             |
| `E_ORANGE_NOT_A_LIST`       | A `multiple` question's answers are all in the passage, but never together as one explicit list; the question was reverse-engineered out of prose that has none.                                                                                                                                                                                                          |
| `E_ORANGE_PARTIAL_LIST`     | A `multiple` question accepts only part of the list its passage states: the prose lists three things and the question accepts two, so a speller who names the third is marked wrong.                                                                                                                                                                                      |
| `E_GROUNDING_NUMBER_FILL`   | A fill-in-the-blank `number` answer (one with no `steps`) is not in the passage.                                                                                                                                                                                                                                                                                          |
| `E_ANSWER_REVEALED_CROSS`   | A green, `multiple`, purple or blue prompt names another question's recall answer from the same section (a green answer or a `multiple` option), so the speller can copy it across instead of recalling it. A topic word whose own question wants a _number_ back is exempt, since it gives nothing away; pink and `wyr` prompts warn instead (`W_ANSWER_REVEALED_OPEN`). |
| `E_BACKGROUND_IN_TEXT`      | A blue (`background`) answer **does** appear in its own passage, defeating the point of the type.                                                                                                                                                                                                                                                                         |
| `E_BACKGROUND_NO_CONTEXT`   | A `background` question has no `background` field.                                                                                                                                                                                                                                                                                                                        |
| `E_SPELLING_LENGTH`         | A spelling word is outside 6-9 letters.                                                                                                                                                                                                                                                                                                                                   |
| `E_SPELLING_DUPLICATE`      | A spelling word is used in two sections (or twice in one).                                                                                                                                                                                                                                                                                                                |
| `E_SPELLING_COLLISION`      | A spelling word appears **inside** an answer anywhere in the lesson: `PRISON` within "the prisoner's dilemma". Matched as a raw substring, which is the point.                                                                                                                                                                                                            |
| `E_ANSWER_WORD_REUSED`      | The same answer word answers two different questions, anywhere in the lesson and at any length. Also fires when a one-word answer reappears inside a longer answer.                                                                                                                                                                                                       |
| `E_NUMBER_DUPLICATE`        | Two questions resolve to the same number.                                                                                                                                                                                                                                                                                                                                 |
| `E_OPEN_HAS_ANSWER`         | An `open`, `paraphrase` or `wyr` question carries `answer`, `answers` or `exampleAnswer`. All three store no answer at all, and `buildBlock` drops the field silently, so the write is refused instead.                                                                                                                                                                   |
| `E_RETIRED_STEM`            | A pink question uses the retired "...one word that comes to mind..." stem.                                                                                                                                                                                                                                                                                                |

A rejection names the section, the offending value and the fix, because the model reads it
and resubmits: `"validation failed"` buys a guess, a specific message buys a correction in
one round trip. Up to 25 are listed at a time.

## Warnings: saved, and reported back

Returned as a `warnings` array on the successful result:

```json
{
  "id": "…",
  "url": "…",
  "warnings": [
    {
      "code": "W_NUMBER_NO_STEPS",
      "section": 3,
      "message": "Section 3 \"Deserts\": no purple question carries `steps`. …"
    }
  ]
}
```

| Code                     | What it flags                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `W_SECTION_COUNT`        | The lesson isn't 6 sections. Lesson-wide, so it carries no `section`.                                                                                                                                                                                                                                                                                                    |
| `W_QUESTION_SHAPE`       | A section's question types or order differ from 3 `single`, 2 `number`, 2 orange, 1 `background`, 7 `open`. Either orange type fills an orange slot.                                                                                                                                                                                                                     |
| `W_NO_QUESTION`          | A section has no questions at all.                                                                                                                                                                                                                                                                                                                                       |
| `W_OPEN_SPLIT`           | A section's 7 pink questions don't read as 4 tight opens followed by 3 extended ones.                                                                                                                                                                                                                                                                                    |
| `W_ORANGE_MULTIWORD`     | An orange answer is more than one word. Applies to both orange types, since a letterboard speller has to spell every word either way.                                                                                                                                                                                                                                    |
| `W_ORANGE_ANSWER_COUNT`  | A `multiple` question accepts fewer than 2 or more than 4 answers, or a `multiple_open` one suggests none at all.                                                                                                                                                                                                                                                        |
| `W_ORANGE_NO_BLANK`      | A `multiple` prompt has no `______` where the passage's list was. A section has two orange questions, so a bare "Name one." doesn't say which list is meant. A warning because a prompt can identify its list without a literal blank.                                                                                                                                   |
| `W_ORANGE_ORDER`         | A section asks a `multiple_open` question before a `multiple` one. The two are one family on a spectrum and are asked tight first.                                                                                                                                                                                                                                       |
| `W_SPELLING_COUNT`       | A section doesn't have exactly 4 spelling words.                                                                                                                                                                                                                                                                                                                         |
| `W_NUMBER_NO_STEPS`      | A section's word problem has no `steps`.                                                                                                                                                                                                                                                                                                                                 |
| `W_SPELLING_IN_CAPS`     | A spelling word is also ALL-CAPS learning vocabulary in the same passage. A warning rather than an error because acronyms trip it legitimately.                                                                                                                                                                                                                          |
| `W_ANSWER_REVEALED_OPEN` | A pink, `wyr` or `multiple_open` prompt names another question's recall answer. The same defect `E_ANSWER_REVEALED_CROSS` rejects elsewhere, but these exist to make the speller talk about a particular word: "In your own words, explain how a delta forms" cannot avoid DELTA without going vague, and "Give a synonym for DELTA" has to say it outright.             |
| `W_WYR_SHAPE`            | A `wyr` prompt doesn't read as a choice: it should start "Would you rather" and join two options with one "or" (a short list, "Paris, London, or New York", is fine). Also fires when the prompt chains several "or"s ("a train or a bus or a bike"); idioms such as "an hour or so" don't count. A warning because the wording is a convention, not a correctness rule. |
| `W_VAKT_NOT_LAST`        | A section's VAKT activity isn't last; there is other content after it. VAKT activities are optional, so nothing is ever said about a section that has none; this only fires on a misplaced one, and only as a warning, since a break mid-section is a legitimate thing to want.                                                                                          |

These are warnings and not errors because a legitimate lesson can trip each one: a user who
asks for four sections gets `W_SECTION_COUNT` and should not be blocked by it.

## Checking before you write

A rejected write is all-or-nothing: `create_lesson` saves nothing at all when any error
fires. A default lesson is six sections of 4 spelling words and 15 questions in a fixed
order, every answer of which has to be findable in its own passage and unique across the
whole lesson, so an assistant composing the lot in a single call, with no way to check
its work until it submits, rarely lands it first time.

**`validate_lesson`** is the same checks with the write taken off the end. Nothing is
created, nothing is overwritten, and no version is added to anyone's History tab: write a
section, check it, fix what the messages name, move on.

Checking `sections` you are composing is a **local** check (nothing is fetched either), so
it can be called as often as the assistant likes. Checking by `id` reads the lesson from the
hub first, which still writes nothing but is an ordinary API read like any other, so it is
not free and should not be polled.

It takes either content being composed or a lesson that already exists:

```json
{ "title": "Volcanoes", "sections": [ … ] }   // create_lesson's shape — one section is fine
{ "id": "…" }                                  // a stored lesson, as it stands
{ "id": "…", "operations": [ … ] }             // what that patch WOULD produce
```

The result answers the question actually being asked before either list, so a model that
reads no further still gets it right:

```json
{
  "ok": false,
  "checked": "draft content — 1 section, nothing saved",
  "errors": [{ "code": "E_GROUNDING_SINGLE", "section": 1, "message": "…" }],
  "warnings": [{ "code": "W_SECTION_COUNT", "message": "…" }],
  "note": "A write of this would be REJECTED. …"
}
```

`errors` are what would be rejected; `warnings` are what would ride along with a successful
write. With `operations`, the baseline rule below applies exactly as it does to
`patch_lesson` (defects already in the stored lesson are counted under `preexisting`
rather than held against the caller), and the operations are applied to a copy in memory,
so the stored lesson is untouched whatever the verdict.

The tool and the writing tools share one implementation of the check (`standardFindings`
in `apps/mcp/src/tools.js`), which is the only thing that makes "check here, then write"
worth anything: two copies would disagree the first time a rule changed.

## `skipValidation`

Every writing tool takes `skipValidation: true`, which turns the **errors** off (and with
them the warnings; nothing is checked). It exists for the user who deliberately wants a
lesson the standard forbids, not as a way around a defect that should be fixed.

That distinction used to live entirely in the flag's description: advice to the model,
which nobody could audit and which the user never saw. The assistant set the flag, the
standard was waived, and the only trace was a lesson that quietly broke the rules.

So the findings are now computed even when the flag is set, and on a client that supports
[elicitation](/mcp-server/tools#decisions-that-are-the-users), the override becomes a
question put to the user, listing what would be waived:

```text
The assistant is about to save a lesson that breaks the authoring standard in
2 ways, by overriding the check:

1. [E_GROUNDING_SINGLE] Section 1 "Reading": the answer "obsidian" does not …
2. [E_SPELLING_LENGTH] Section 1 "Reading": the spelling word "ash" is 3 …

Save it as it is?
```

Say no and nothing is saved: the write fails with the findings and an instruction not to
try the override again unasked. Say yes and it saves exactly as before. Nothing is asked
when the lesson breaks no rule anyway: the flag is often set defensively, and there is
nothing to waive.

On a client that can't ask, the flag behaves exactly as it always has. That is a real gap,
not a temporary one: elicitation is optional in the MCP spec and most clients don't
implement it. Validation is still the thing that holds without the model's cooperation;
this only closes the loop on the one escape hatch the model controls.

## Patching an existing lesson

`patch_lesson` validates the lesson **before** and **after** the edit and holds the caller
only to the difference. Without that, a one-line tweak to a lesson written in the web
editor (or written before these rules existed) would be blocked by defects the patch
never touched and the assistant may have no mandate to change. The filter applies to
**warnings as well as errors**, so a patch reports only what its own edit introduced.

Findings are matched on the defect's identity rather than its message, which has to hold
two properties at once:

- **Section numbers can't be part of it.** Moving or inserting a section would otherwise
  make every later finding look new. The identity uses the section's and block's **ids**,
  which survive `move_section`, `move_block` and `replace_block`.
- **Block identity has to be part of it.** Code plus offending value alone is not enough:
  a patch can add a genuinely new question carrying the same defect on the same word, and
  it would be written off as pre-existing. Including the block's id separates them.

For a collision, which names two parties (two spelling words, two questions), the pair is
sorted before it becomes a key; otherwise reordering the sections swaps which end the
walk reaches first and rewrites the identity of a defect nobody touched.

`update_lesson` replaces the whole document, so it gets no such exemption: whatever the
result contains, the caller sent. That is a reason to prefer `patch_lesson` for small
edits.

## Comparison rules

Text is normalised before any comparison: uppercased, punctuation dropped, whitespace
collapsed. Two details matter and both caused false failures before they were handled:

- **Thousands separators.** The passage says `3,776` and the answer field holds `3776`.
  Both normalise to `3776`.
- **Decimal points.** `112.5` has to survive the punctuation strip as one token, while the
  full stop in `MAGMA.` must not.

Grounding uses **whole-word** matching, so `ASH` is not found inside `WASHED`. The spelling
collision check deliberately uses **raw substring** matching instead, because `PRISON`
really is inside `PRISONER'S`.

Passages are flattened out of rich text first, so a lesson round-tripped through the web
editor (which stores HTML) is compared on its words rather than its markup.

## Why a `multiple` question is checked against the passage's punctuation

`E_ORANGE_NOT_A_LIST` is the one check that reads the prose as prose. A `multiple` question
retrieves a list the passage states ("The blast sent out red-hot rock, choking gas, and
clouds of ash"), so its answers have to appear **in one sentence, as one series**. The
passage is therefore re-read a second way for this check alone: split into sentences, and
normalised with commas and semicolons **kept** as tokens, since the comma is exactly what
separates a real list from a noun phrase.

Two answers count as adjacent members of a list when a comma or an `and`/`or` sits between
them and no more than four other words do. That is what tells the three failures apart:

| Passage                                                  | Options        | Verdict                                     |
| -------------------------------------------------------- | -------------- | ------------------------------------------- |
| `rock, choking gas, and clouds of ash`                   | ROCK, GAS, ASH | A list: separators, items close together.   |
| `the Pacific Ocean`                                      | PACIFIC, OCEAN | Nothing between them: one noun phrase.      |
| `a scale called the VEI, the Volcanic Explosivity Index` | SCALE, INDEX   | A comma, but six words apart: not a series. |

A two-item list joined by `and` alone passes; commas aren't required, a series is.

### One question, one whole list

Finding the answers inside a series isn't enough on its own: they have to be **all** of it.
Where the passage says `boulder, cobble, and silt` and the question accepts only `boulder`
and `cobble`, a speller who answers SILT has read exactly what they were told to read and
is marked wrong. That is `E_ORANGE_PARTIAL_LIST`.

An English series closes with `and X` / `or X`, so the check looks just past the last
accepted answer for a conjunction with an item attached: `boulder, cobble` is unfinished
in front of `and silt`. It looks there regardless of any conjunction _inside_ the run,
since `cats and dogs and rabbits` has one in both places.

The difficulty is that the same conjunction joins clauses: `rock, gas, and ash, and the
valley went dark` ends its list at ASH. Nothing short of parsing the sentence separates the
two for certain, so **length decides**: an item is a word or two before the next separator
or the sentence's end, and anything longer reads as a clause:

| After the last accepted answer         | Read as            | Result   |
| -------------------------------------- | ------------------ | -------- |
| `and silt,`                            | item               | partial  |
| `and rabbits.`                         | item               | partial  |
| `and the valley went dark.`            | clause             | complete |
| `, all of them steel` (no conjunction) | not a continuation | complete |
| nothing (sentence ends)                | series ended here  | complete |

Two shapes are therefore left alone that a stricter reading would reject: a complete series
with no conjunction at all (`rope, hammer, pitons`), and a clause coordinated onto a
finished list. The cost is a subset whose sentence carries on unpunctuated past the final
item, which goes unreported, along with a subset that happens to include the final item.
Both are the safe direction to miss in: this runs on a write path, where a false positive
blocks an author who did nothing wrong.

The check is skipped unless every accepted answer is a single word already found in the
passage, so it never piles onto a question that `E_ORANGE_PARAPHRASED` or
`E_GROUNDING_MULTIPLE` has already rejected.

The rule is an error rather than a warning because the standard requires the list to exist
in the prose: a `multiple` question without one is not a lesson written to the standard but a
question forced onto text that can't support it. The fix is upstream: **write the list
into the passage**, then quote that sentence with it blanked out. A question that was never
about a list belongs to the other orange type, `multiple_open`, where none of this runs.
