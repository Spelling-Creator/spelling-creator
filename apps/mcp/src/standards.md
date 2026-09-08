# Lesson authoring standards

Defaults — honour the user if they ask for something different.

## Shape

6 sections. Each section = [image?] + 2 text paragraphs + 4 spelling words + 15 questions, in that
order. Questions belong to their own section; never collect them into a separate quiz section at
the end.

## Passages

2 short paragraphs per section (~60-110 words each). ALL-CAPS words are the harder, less-common
learning vocabulary — a SEPARATE set of words from the spelling list (below), never overlapping.

PLANT THE ORANGE QUESTIONS' LISTS HERE, before writing any question: the prose needs ONE explicit
"X, Y, and Z" series of 2-4 parallel single-word items per `multiple` question — TWO by default
("red-hot rock, choking gas, and clouds of ash"; "shaped into tools, blades, and arrowheads"),
because those lists ARE that section's orange questions (see below). One fewer for every orange
slot given to a `multiple_open` question, which retrieves nothing and needs no list at all; a
section using both slots that way plants none. Decide WHICH TWO QUESTIONS THE SECTION IS ASKING
before you write the prose, not after, then write the paragraph around whatever lists they need —
the items must be genuinely parallel, all the same kind of thing, and each one a single word.

Any fact a math question needs must be stated in the passage first. Describe other cultures with
curiosity, never as strange ("Fascinating Countries", not "Unusual Countries") — this is a hard
rule. Handle mental illness, war, death, and disability factually and with dignity, without
euphemism or tragedy-framing. Verify anything time-sensitive (records, prices, "world's largest
X") before writing it down.

## Spelling

Exactly 4 words per section, each 6-9 letters. Thematically related to the topic but NOT drawn
from the passage's ALL-CAPS vocabulary (reusing it is redundant and too obvious). A spelling word
must never appear as, or as a substring inside, any answer anywhere in the lesson (e.g. PRISON
inside "the prisoner's dilemma" is a conflict). No spelling word repeats across sections.

## Questions

Per section, always in this exact order (15 total):

### 1-3 · `single` (green)

3 questions; each answer appears VERBATIM in this section's passage.

Verbatim is necessary but NOT SUFFICIENT: a green answer must also be a HARD FACT the passage
states outright, with one right answer. The test is whether a reasonable speller could give a
different, equally valid answer — if they could, it isn't green. "What was the goddess called? ->
BASTET" is a fact and nothing else is right. "What is a cat called when it purrs on a lap? ->
COMPANION" is interpretation: pet, friend and lap-cat are all just as fair, and COMPANION only
looks right because the passage happened to use that word. Don't dress a soft, one-of-many answer
up as factual retrieval just because the word is in the text — either make it a pink open
question, or replace it with a fact the passage states outright ("Which animal does the cat now
rival as the most popular pet? -> THE DOG").

### 4 · `number` (purple)

Fill-in-the-blank; the number appears in the passage.

### 5 · `number` (purple)

A word problem (see MATH below).

### 6-7 · `multiple` / `multiple_open` (orange)

2 SEMI-OPEN questions: questions with several known or semi-known answers rooted in the text. Their
demand sits above a green single fact and below the extended opens, and they run along a spectrum
from TIGHT to LESS TIGHT — both printed orange, and asked in that order, tighter first.

The two ends are two types, because "answers" means opposite things at each: for `multiple` it is
the exhaustive accepted set, for `multiple_open` it is a suggestion. Default to two `multiple`
questions, one per list planted in the passage; reach for `multiple_open` when the question you
want is genuinely the looser kind, and put it second.

#### `multiple` — the tight end

A finite, known answer set drawn from the text. This is LIST RETRIEVAL, and it is the easiest
question in the set to fake badly. The pattern:

1. the passage states the list as an explicit series — "The blast sent out red-hot rock, choking
   gas, and clouds of ash";
2. the question QUOTES THAT SENTENCE WITH THE LIST BLANKED OUT and asks the speller to name one
   item listed — "The blast sent out ______. Name one thing the eruption threw out.";
3. the accepted answers are EVERY item of that one list -> ROCK, GAS, ASH.

Accepting only some of them is rejected: a speller who names the item you left out has read the
passage exactly as told and would be marked wrong. 2-4 answers, each a SINGLE WORD appearing
verbatim in this section's text.

NEVER WRITE THE LIST INTO THE PROMPT: "Cats travelled with the Roman army, traders, and settlers —
name one" hands the answer over and tests nothing; "Cats travelled with the Roman ______ —
name one group" is the question. This is the single easiest orange mistake to make, and a prompt
containing its own answers is rejected on save.

ROOT CAUSE: a weak orange question is almost always weak TEXT, not weak question-writing. Where
the prose holds no genuine list there is nothing sound to build on, and the temptation is to force
one: PACIFIC / OCEAN out of "the Pacific Ocean" (one noun phrase, not a list), MANTLE / CORE out
of "the mantle... toward the core" (not a parallel series), SCALE / INDEX out of "a scale called
the VEI, the Volcanic Explosivity Index" (not like items). All three are real mistakes and all
three are wrong. So WHEN A QUESTION IS WEAK, REWRITE THE PASSAGE, NOT THE QUESTION — patching the
question just moves the flaw around; add the real list to the prose and let the question fall out
of it. Answers that don't appear together as a list are rejected.

Two further limits:

- no general knowledge — an answer that is not in the planted list is a blue background question,
  not an orange one;
- no paraphrase — if the passage says "superheated" and "dangerous", then HOT and DEADLY are wrong
  answers, because they aren't the words the passage uses.

#### `multiple_open` — the less tight end

The answers are bounded by the topic, theme or lesson, but leave ROOM FOR IMPROVISATION: "Give a
synonym for GRATITUDE", "What is a delta, according to the text?". A tight question can also be
built without quoting anything at all — "Name a cardinal direction" names a category whose answer
set the text has established — and that belongs here too when the answers aren't one written list.

THE ANSWER KEY IS A GUIDELINE, NOT A REQUIRED STRING. Write the suggested answers in "answers" as
usual, but the speller need not produce one of them: any response within the bounds of the topic or
theme is correct. This is the one place in a lesson where a printed answer is advisory rather than
authoritative, which is why it is a type of its own — whoever scores the lesson has to be able to
see which questions it applies to. The lesson prints it in the same orange, in italic.

Because the key is advisory, the tight end's rules do not apply to it: its answers are NOT held to
the passage (a synonym is by definition not in the text — that is the point of asking for one),
they need not come from a list, and the prompt blanks nothing out because there is no list behind
it. Give at least one suggestion, ideally two or three.

What holds at BOTH ends: the answers stay rooted in the lesson — bounded by the passage, topic or
theme, since an answer with no connection to it is a blue background question — and they stay
SHORT, ideally one word. No evidence answers phrased as long quotations: they ask the speller to
hold too much in mind and to spell long strings on a letterboard.

### 8 · `background` (blue)

Prior knowledge the passage deliberately does NOT contain; always include the "background" field
with that context.

### 9-12 · `open` (pink)

4 TIGHT OPENS: open-ended, with no single correct answer, but they must elicit an EASY one-word
answer from the speller's own world, never from the passage. Two properties both matter:

- the prompt names an everyday category broad enough that almost any speller can answer instantly;
- the load is LIGHT — the answer should come the moment they read the prompt, with no reasoning,
  no searching the lesson, nothing abstract or philosophical.

Good: "Name a color of a crayon", "Name something found in a hospital", "Name something that uses
electricity", "Name a recreational activity to do on a lake".

Too hard, do NOT write these: "What is one word for a puzzle that is very hard to solve?"
(abstract), "Think of a word that means never-ending" (a vocabulary puzzle), "Name something that
sounds impossible but is real" (philosophical).

Relate the CATEGORY to the section's theme — a dam lesson invites "Name something that floats" —
but keep the ANSWER in everyday life; the link is thematic and light and must never turn the
question into a comprehension check. Vary the stems: "Name a...", "Name something that...", "Name
something found in...", "Name a kind of...", "Name a place where...", "Name an animal that...".
NEVER use "Give one word that comes to mind when you..." (retired — overused to the point of
becoming a tic).

### 13-15 · `open` (pink)

3 EXTENDED OPENS: full-sentence responses, e.g. "In your own words, explain..." / "...Defend your
answer." / "...Explain your thinking." The very last question of the whole lesson should look back
across all sections, e.g. "Of the six parts of this lesson, which idea did you find most
astonishing? Defend your answer."

"open" questions carry no answer, answers, or exampleAnswer field at all — just the "prompt".

### `paraphrase` (brown)

A `paraphrase` question asks the speller to restate the section's passage in their own words
("In your own words, explain why..." / "In your own words, describe..."). It is the one extended
open whose job is comprehension of the passage itself rather than opinion about it, which is why it
prints in its own colour. Like `open`, it carries no answer, answers, or exampleAnswer field —
just the "prompt".

The default section shape above still asks for 3 `open` extended opens; a `paraphrase` may be used
in place of the first of them where a section wants the distinction drawn explicitly.

## No prompt gives away another question's answer

Within a section, no question's prompt may contain a word another question expects the speller to
RETRIEVE — that is, a green answer or a `multiple` option. (A `multiple_open` suggestion is not
retrieval: nobody is asked to remember it, so naming one elsewhere gives nothing away.) A speller
who can read the word off a neighbouring prompt is copying, not recalling. Real case: the green question "Which land did cats
reach? -> BRITAIN", followed by a purple prompt reading "...cats reached Britain around the year
___", which hands BRITAIN over; the fix was "...reached the British Isles...". Naming an orange
option in a green prompt does the same thing ("such as Siamese or Persian").

Two things are fine. A prompt may name a topic word whose own question wants a NUMBER back: "more
than ___ mummies at Bubastis" doesn't help anyone produce BUBASTIS for its own question, and
scrubbing every such mention makes prompts clumsy for no gain. And a pink or `multiple_open` prompt
may name the section's subject even when it is also a green answer, because both exist to make the
speller talk about that word — "In your own words, explain how a delta forms" can't avoid DELTA
without going vague, and "Give a synonym for DELTA" has to say it outright. Everywhere else, a
prompt that names another question's recall answer is rejected on save; on those two it is only
flagged, so reword it if the naming wasn't necessary.

## One answer word, one question

No answer word may be used by more than one question anywhere in the lesson, at ANY length — not
just across sections and not only for longer words. A word that is a green answer cannot also be
a `multiple` option (MAGMA as both); a word cannot be a `multiple` option in two different
questions (GAS appearing in three sections' orange lists); and a one-word green answer cannot
reappear inside a longer answer elsewhere. `multiple_open` suggestions are outside this rule, since
they are examples rather than the answer to anything. Give every question its own distinct
vocabulary. Theme words
that unavoidably recur inside multi-word technical terms ("A SHIELD VOLCANO" and "A
STRATOVOLCANO") are distinct whole answers and are fine. Numeric answers must all be distinct
across the lesson too.

## Math (number questions)

Scale difficulty to the audience — for a 14+ speller, "two more than five" is not acceptable. Use
real mathematics: percentage increase and percentages to 1-2 decimal places, powers of ten and
scientific notation, combinatorics (nCr, permutations, single-elimination counting),
compound/independent probability, prime factorisation, modular arithmetic, inequalities. Draw the
problem from THIS section's own content, so solving it produces an insight rather than sitting
beside the lesson.

ALWAYS put the worked solution in the "steps" array, one step per element, in order — never bake
it into the prompt string, never give a bare answer. Good steps show the set-up, flag the common
error where one exists (e.g. "divide by the ORIGINAL value, not the new one"), break hard
arithmetic into pieces, and verify where verification is cheap. The plain fill-in-the-blank number
question (item 4 above) doesn't need steps — and it is the absence of steps that marks it as the
fill-in-the-blank one, whose answer must appear in the passage.

## Images

Source only from Wikimedia Commons via search_images (freely licensed: CC / CC0 / public domain);
keep the attribution in the caption — if overriding it, append the original attribution rather
than replacing it. An image should go FIRST in its section, above both paragraphs — but
add_image's default placement is the END of the section's prose (just before any question blocks),
so to get the image first pass "index": 0 (with "sectionId"/"sectionIndex") explicitly; don't rely
on the default when the image goes with a section's opening. Prefer images that do double duty
(reinforce a green answer AND illustrate) or diagrams that carry an argument, over decorative
photos. Check the image doesn't contradict the text (e.g. a shift direction, an orientation).
Choose on content rather than on file size — add_image downloads a downscaled rendering of
whatever you pick, so a large original is not a problem. Some clients show the search_images
candidates to the user as pictures; when the result says so, the choice is theirs — stop and
wait for it rather than adding one yourself.

## VAKT activities

OPTIONAL, and OFF by default. A `vakt` block is a regulation activity — a movement or sensory
break addressed to whoever is running the lesson, never a question and never answered: "VAKT: Bob
likes to do jumping jacks. Let's do 3 of those." Write the activity alone in "text"; the "VAKT:"
label is added when the lesson is rendered.

Do NOT add them to a lesson unless the user asks for them. When the user does want them, put the
activity LAST — after that section's 15 questions, at the very end of the section. One per section
is usually enough; the rule that is checked is the placement, not the count.

Keep the activity concrete and doable in the room: a named number of a named movement, a
breathing or pressure exercise, something to hold or press. Name the speller when the user has
told you who the lesson is for, as in the example above. A block may also carry "links" (a video
to play, a song, a printable) and an "image" from add_image, both optional. A VAKT picture takes
the same "size" and "align" an image block does; leave them off unless the user asks for
something particular, since the default (medium, centred) suits a picture that illustrates the
action rather than carrying the lesson.

## Branding

None. Do not add any brand name, byline, or footer to a generated lesson unless the user
explicitly supplies one.

## Validation on save

`create_lesson`, `create_lesson_file`, `update_lesson` and `patch_lesson` check the lesson before
writing it, and REJECT the write when a rule below is broken. Each rejection names the section,
the offending value, and the fix, so read it and resubmit — you do not have to guess.

A rejection throws away the whole call, and the rules below are strict enough that six sections
written blind rarely pass on the first attempt. Do not compose the entire lesson and hope.
`validate_lesson` runs these same checks and saves nothing, so check each section as you finish
it, fix what the messages name, and call a writing tool once the lesson comes back clean.
Checking `sections` you are composing is a local check — nothing is written and nothing is
fetched — so do it as often as you like. Checking by `id` reads the lesson from the hub first,
which is an ordinary API read: still writes nothing, but it is a request like any other, so
don't poll with it.

For a long lesson you can also write it in passes rather than in one call: `create_lesson` with
the first section or two, then `patch_lesson` with an `add_section` op for each one after that,
passing a `summary` that says what the pass added. Each pass is validated, recorded and
reversible on its own.

Every check below that reads the passage belongs to `multiple`, the TIGHT orange type. None of them
run on `multiple_open`, whose answers are suggestions — held to the passage or to a list, it would
be rejected for being exactly what it is meant to be.

Rejected (errors):

- a green (single) answer that does not appear, word for word, in its own section's passage
- a `multiple` accepted answer that does not appear in its own section's passage — the usual causes
  are paraphrase and general knowledge (if the question was really a synonym or a definition, it is
  a `multiple_open` one)
- a `multiple` question whose prompt contains one of its own accepted answers — blank the list out
  of the sentence you quote
- a `multiple` question whose accepted answers do not appear together in the passage as one explicit
  list — the fix is to write the list into the prose, not to reword the question
- a `multiple` question that accepts only part of the list its passage states (the prose lists three
  things, the question accepts two)
- a fill-in-the-blank purple answer (a number question with no steps) that is not in the passage
- a green, `multiple`, purple or blue prompt that names another question's recall answer (a green
  answer or a `multiple` option) from the same section — rephrase around the word
- a blue (background) answer that DOES appear in its own section's passage, or a blue question
  with no "background" field
- a spelling word outside 6-9 letters, repeated in another section, or appearing inside any answer
- the same answer word used by two different questions, anywhere, at any length
- the same numeric answer given by two different questions
- an open or paraphrase question carrying an answer, answers, or exampleAnswer
- a pink question using the retired "...one word that comes to mind..." stem

Flagged but allowed (warnings, returned with the saved lesson): a section count other than 6, a
section with no questions at all, a section whose 15 questions differ in type or order from the
list above, pink questions that don't read as 4 tight + 3 extended, a multi-word orange answer, a
`multiple` question with fewer than 2 or more than 4 answers, a `multiple_open` question suggesting
no answers at all, a `multiple` prompt that doesn't blank out the list it is asking about, a
`multiple_open` question asked before a `multiple` one in the same section, a section without
exactly 4 spelling words, a word problem with no steps, a pink or `multiple_open` prompt that names
another question's recall answer, a spelling word that is also ALL-CAPS vocabulary in the same
section, and a VAKT activity that isn't last in its section.

If the user deliberately wants a lesson the standard forbids — a 3-section lesson, questions in a
different order — pass "skipValidation": true, which turns the errors off. Don't reach for it to
get around a defect you should just fix.

## Check before saving

Things validation cannot decide for you:

- every fact a math problem depends on is stated in the passage
- every green answer is a hard fact with one right answer, not an interpretation the passage
  happened to word that way
- tight opens are easy everyday recall — not abstract, not vocabulary puzzles, not lesson-dependent
- each section's prose carries a genuine list for every `multiple` question it holds, and the items
  in them are parallel — the same kind of thing, one word each
- a `multiple_open` question is genuinely the looser kind, not a `multiple` one whose list you
  couldn't ground: the type is not a way around the checks, and using it that way costs the speller
  the question
- anything time-sensitive has been verified
- the image agrees with the text it sits above
