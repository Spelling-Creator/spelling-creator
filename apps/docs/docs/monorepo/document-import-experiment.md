---
title: Document import experiment
---

# Document import experiment

Can a small on-device model turn a lesson that exists only as a document (a
Word file, a typed page) into lesson JSON? This page records a measured answer,
taken in October 2026 with the script in `packages/core/scripts/extract-eval/`,
so the question is settled by numbers rather than by instinct before any import
feature is built on a local model.

The idea under test: the app already runs on-device models through
transformers.js for [translation](../web-app/comment-translation.md) and
[summaries](../web-app/lesson-summaries.md), so an extraction model such as
[LFM2 Extract](https://huggingface.co/LiquidAI/LFM2-1.2B-Extract) could take
the same route, keep the document on the author's machine, and cost nothing per
request.

## Method

1. **Test set.** The newest six-section lessons on the public hub (four at the
   time: The History of Domestic Cats, Pompeii, Volcanoes, An Introduction to
   Quantum Physics), fetched from `GET /lessons/:id` and cached.
2. **Documents.** Each lesson is rendered two ways. `docx` is the app's own Word
   export (`buildDocument`), read back as raw text with mammoth, which is what a
   generic importer sees: no section headings, question types carried only by
   colour and so invisible, answers after a gap on the question line. `plain`
   is a hand-typed style: section headings, a "Spelling words:" line, numbered
   questions with the answer in brackets.
3. **Splitting.** A document is cut into sections before any model sees it, by
   structure rather than headings: a passage paragraph that follows questions
   starts a new section, a chunk with no questions is a closing paragraph and
   stays with its section, and whatever trails the last section (sources,
   footnote bodies) is dropped. This found 6 of 6 sections in all 8 documents.
   A small model does far better on one section (about 1,000 tokens) than on a
   whole lesson.
4. **Extraction.** Each model runs on the CPU through transformers.js at `q4`,
   greedy decoding, one section at a time, with the lesson shape given as a
   JSON Schema in the system prompt (the LFM2 Extract model card's format). Keys
   a model drifts to (`section_title`, `spelling_words`, a singular `answer`)
   are mapped back before scoring, as an import would do.
5. **Scoring.** Each extraction is compared with the section it was rendered
   from: share of passage words recovered, paragraph-level similarity, spelling
   words (F1), question prompts found (F1), question type, and answers (exact
   set match, ignoring case and punctuation). Then the extractions are rebuilt
   into a lesson through `normalizeLessonFile` and run through the
   [lesson checks](../web-app/lesson-checks.md).

The question type is scored twice. "Types (model)" is the model's own guess.
"Types (derived)" is a deterministic rule applied afterwards: "Would you
rather" is `wyr`, "in your own words" is `paraphrase`, no answer is `open`,
several answers are `multiple` (or `multiple_open` when one is not in the
passage), a numeric answer is `number`, and a lone answer is `single` when it
is in the passage and `background` when it is not. That is how an import would
assign types, and the composite score uses it.

Two sections per lesson, so 8 sections per model and style, on an Apple M4
with 16 GB.

## Results

| model             | style | parsed | passage words | spelling | prompts F1 | types (model) | types (derived) | answers | composite | tok/s | s/section |
| ----------------- | ----- | -----: | ------------: | -------: | ---------: | ------------: | --------------: | ------: | --------: | ----: | --------: |
| LFM2-1.2B-Extract | docx  |   100% |           32% |      45% |        44% |           20% |             23% |     24% |       34% |    30 |        28 |
| LFM2-1.2B-Extract | plain |   100% |           74% |     100% |        97% |           26% |             49% |     50% |       74% |    30 |        31 |
| LFM2-350M-Extract | docx  |   100% |           48% |      71% |        40% |            0% |             37% |     33% |       46% |    54 |        10 |
| LFM2-350M-Extract | plain |    88% |           52% |      81% |        54% |            0% |             34% |     46% |       53% |    57 |        12 |
| LFM2-1.2B (chat)  | docx  |    88% |           65% |      18% |        58% |           30% |             31% |     26% |       40% |    15 |        84 |
| LFM2-1.2B (chat)  | plain |   100% |           89% |      56% |        88% |           45% |             42% |     41% |       63% |    15 |        83 |
| Qwen3-0.6B (chat) | docx  |    63% |           59% |      50% |        49% |           27% |             35% |     36% |       46% |    11 |        97 |
| Qwen3-0.6B (chat) | plain |    13% |           11% |      13% |        10% |            8% |              8% |     10% |       10% |    11 |        79 |

Lesson checks on the rebuilt two-section lessons, averaged over the four
lessons (the originals average 27 errors and 19 warnings, because three of the
four predate the current checks):

| model             | style | errors | warnings |
| ----------------- | ----- | -----: | -------: |
| LFM2-1.2B-Extract | plain |   12.0 |     10.5 |
| LFM2-350M-Extract | docx  |    3.3 |      5.8 |
| LFM2-350M-Extract | plain |    5.5 |      5.3 |
| LFM2-1.2B (chat)  | plain |   12.0 |      6.8 |

The low error counts for the 350M model are not good news: it drops most of
the questions, and a section with few questions has little for the checks to
object to.

## What the models got wrong

- **LFM2-1.2B-Extract on the Word export.** On half the sections it ignored
  the schema and produced flat keys of its own (`paragraph_1`, `question_1`),
  which no alias mapping recovers. On one section it fell into a repetition
  loop (`"word": "BOAT"` to the token cap). Where it did follow the schema it
  split paragraphs into sentences and invented answers for open questions
  ("Wolf", "Fox", "Snake" for "Name a wild animal that hunts"), which is the
  Extract family's instinct to fill every field.
- **LFM2-1.2B-Extract on the typed style** is the one result that looks like
  an import: 97% of prompts and 100% of spelling words found, 74% of passage
  words. But answers were right half the time (merged, renamed, or made up),
  and a type derived from a wrong answer is wrong too.
- **LFM2-350M-Extract** is fast, keeps to the schema, and finds only a fifth to
  a third of the questions.
- **The two chat models** are three to six times slower than the Extract
  models at the same size, and no more accurate. Qwen3-0.6B answered the open
  questions itself and broke its own JSON on most sections.

Both Extract models guessed the type no better than chance. Deriving it from
the answers afterwards does better everywhere, so an import should never ask a
model for it.

## Conclusions

1. **Stock, none of these models is import-ready.** The best case, the 1.2B
   Extract model on a tidy typed document, reaches about three quarters on the
   composite and half on answers. An import that gets half the answers wrong
   makes more work than typing the lesson in.
2. **The structure is not the hard part.** Section splitting is deterministic
   and found every section. For the two regular formats tested, a parser (the
   way [`docxImport`](../web-app/export-pipeline.md) already reads the app's
   own export) would beat all four models on every column. A model earns its
   place only on genuinely messy documents.
3. **Fine-tuning is the next step if the local route is wanted, and the data
   is nearly free.** The renderer in this script turns any hub lesson into
   training pairs (document text, lesson JSON) in both styles, and more
   layouts are a few lines each. Liquid publishes SFT notebooks for the Extract
   family. The targets to move are answers (copy, never invent; empty when none
   is printed), paragraphs (whole, not sentences), and schema adherence on the
   Word-export style.
4. **The type should always be derived, not extracted**, and the lesson checks
   should run on the result either way, exactly as they do on a hand-written
   lesson.
5. **Speed is fine for a desktop import.** About 30 seconds per section at 30
   tokens per second on a CPU; WebGPU would be faster. The chat models are too
   slow to be worth their accuracy.

## Second pass: parser first, model last

The first pass said the structure is not the hard part. The second pass tested
that by building the import the other way round (`parse.mjs`): the line
classifier that already finds the sections also says which lines are passage,
spelling, question and working-out, so the parser takes those directly and
asks a model one thing only, where a question line's prompt ends and its answer
begins, and only for a line no rule can split. With no model, a heuristic
(a trailing run of capitals, a short tail after the last colon) stands in.

To give the parser something to be unsure about, five more typed-up layouts
were added (`layouts.mjs`): question and answer on separate lines (`qa`),
answers as a bare run of capitals with no headings at all (`caps`), bulleted
questions with answers in square brackets (`bullets`), numbered questions with
the answer after a colon (`colon`), and a number question's working-out on a
line of its own (`worked`). The splitter found 6 of 6 sections in all 28
documents. All six sections of all four lessons, 24 per layout:

| strategy                   | style   | passage words | spelling | prompts F1 | types (derived) | answers | composite | model calls | s/section |
| -------------------------- | ------- | ------------: | -------: | ---------: | --------------: | ------: | --------: | ----------: | --------: |
| parser + heuristic         | docx    |          100% |     100% |       100% |             89% |    100% |       98% |           0 |       0.0 |
| parser + heuristic         | plain   |          100% |     100% |       100% |             89% |    100% |       98% |           0 |       0.0 |
| parser + heuristic         | qa      |          100% |     100% |       100% |             89% |    100% |       98% |           0 |       0.0 |
| parser + heuristic         | caps    |          100% |     100% |        99% |             86% |     96% |       96% |           0 |       0.0 |
| parser + heuristic         | bullets |          100% |     100% |       100% |             89% |    100% |       98% |           0 |       0.0 |
| parser + heuristic         | colon   |          100% |     100% |       100% |             89% |    100% |       98% |           0 |       0.0 |
| parser + heuristic         | worked  |          100% |     100% |       100% |             89% |    100% |       98% |           0 |       0.0 |
| parser + LFM2-1.2B-Extract | caps    |          100% |     100% |        83% |             27% |     32% |       68% |        11.6 |      25.3 |
| parser + LFM2-1.2B-Extract | colon   |          100% |     100% |        90% |             24% |     30% |       69% |        11.9 |      25.7 |

The parser with a heuristic is right about every passage, every spelling word
and every prompt, and about every answer except a handful on the capitals
layout. Handing the ambiguous lines to the model made things worse, not
better: given one line and a two-field schema, the 1.2B Extract model still
wrote its own answers ("Domestication is the slow change of a wild animal
into a tame one", four variants of it) and returned objects where strings were
asked for. On these layouts it should not be asked.

The 11 percent the derived type misses is not the parser's. Of the 371
questions, 21 are "In your own words, explain..." questions that three older
lessons typed as `open`; the current standard and the newest lesson call them
`paraphrase`, and the rule follows the standard. The rest are a handful of
`single`/`background` swaps where "is the answer in the passage" is too blunt a
test ("THE ROMANS" against a passage that says "Roman town"). Using the lesson
checks' own grounding logic for that call would close most of it.

**Training pairs for the fine-tune** come from the same renderers.
`make-dataset.mjs` takes every published hub lesson (13 at the time), renders
each in every layout, splits them with the import's own splitter, and pairs
every section with its lesson JSON in chat format (system schema, user
document, assistant JSON). The first run, on the seven regular layouts, made
412 training examples and 84 held out from the two newest lessons. Lessons
written by a hosted model to the authoring standard would add volume without
any hand labelling.

**Layouts the rules cannot read.** That first dataset had a blind spot: the
import only calls the model for what the rules cannot read, and the rules read
all seven layouts, so nothing the model was trained on could ever reach it.
Two more layouts fill that gap, both modelled on how a real document loses its
structure:

- `nomarks`: questions typed with no question marks and no numbers, the answer
  tacked on after a space, and the spelling line unlabelled ("Words to learn
  ...").
- `runon`: a numbered list that lost its line breaks, as when it is copied out
  of a web page or a PDF, so a section's questions are all on one line.

For these two (`HARD_LAYOUTS`), a section becomes a training example only if
`sectionNeedsModel` would send it to the model, and its target is what the
document says: a prompt with no question mark where the layout dropped it, and
no section name where the document shows no heading. The parser on them, same
four lessons:

| style   | sections found | passage words | spelling | prompts F1 | answers | composite | offered to the model |
| ------- | -------------: | ------------: | -------: | ---------: | ------: | --------: | -------------------: |
| nomarks |          24/24 |          100% |       0% |        98% |     61% |       66% |                24/24 |
| runon   |          24/24 |          100% |     100% |         0% |      0% |       40% |                24/24 |

Getting the sections right took two changes to the splitter, both of which
leave the seven regular layouts exactly where they were (and none of their 168
sections offered to the model): a line with no closing punctuation is never a
passage however long it is, and a numbered line that runs into the next
number is questions. Before that, a long question with no question mark
started a section of its own, and each run-on list did too. With the two
layouts, the dataset is 529 training examples and 108 held out, 70 and 71 of
them from `nomarks` and `runon`.

### Where this leaves the local model

1. **Ship the parser.** For any document with a recognisable layout, which
   covers the app's own export and every typed-up style tried here, the rules
   get 96 to 98 percent with no model, no download and no wait. The type is
   derived, and the lesson checks run on the result. This is now the editor's
   [Import from text](/web-app/document-import); the parser lives in
   `packages/core/src/documentImport.js` and the scripts here call it.
2. **Keep the model out of the regular path.** Stock, it loses to a regular
   expression on the one job left for it. A fine-tuned LFM2 Extract is still
   the right tool for a document the parser cannot read at all (a scan, a page
   with no consistent layout), and the dataset for that is generated. Measure
   it with the same script on the held-out lessons before it goes anywhere
   near the import.
3. **Fall back to the hosted Worker** only when neither the parser nor the
   model produces a lesson that passes the checks, mirroring the translator's
   built-in-first chain.

## Converting a fine-tuned LFM2 to ONNX for transformers.js

The stock LFM2 files the app loads come from onnx-community, and transformers.js
v4 no longer ships the conversion script that made them, so the route for a
fine-tuned checkpoint had to be worked out. The onnx-community graphs carry
the fingerprints of Microsoft's onnxruntime-genai model builder (its node
names, GroupQueryAttention and MatMulNBits), and that builder is public,
supports `Lfm2ForCausalLM`, and takes a local checkpoint folder:

```bash
pip install onnxruntime-genai onnx onnx_ir onnxscript
python -m onnxruntime_genai.models.builder -i merged -o build-cpu -p int4 -e cpu \
    --extra_options shared_embeddings=false
python -m onnxruntime_genai.models.builder -i merged -o build-webgpu -p int4 -e webgpu
python relayout-onnx.py build-cpu onnx-repo q4 merged
python relayout-onnx.py build-webgpu onnx-repo q4f16 merged
```

Neither optimum-onnx (no LFM2 support) nor Liquid's own LiquidONNX wrapper
(its output targets onnxruntime-genai, and its README says it is not loadable
by transformers.js) does this on its own. The builder's raw output is not
loadable either, for three small reasons that `relayout-onnx.py` fixes:

- the convolution caches are named `past.N.conv`, where transformers.js feeds
  `past_conv.N` and maps `present_conv.N` back to it;
- the key/value cache's head dimension is left symbolic, and transformers.js
  sizes the first empty cache from the declared shape, so it allocated a
  zero-width cache;
- the chat template is a separate `chat_template.jinja` file, and the config
  lacks the `transformers.js_config` block that tells the browser to fetch the
  external weights file. The files also go under `onnx/model_<dtype>.onnx`.

One more for the CPU build: for a model that ties its input and output
embeddings, which LFM2 does, the builder emits an int8 embedding lookup
(`GatherBlockQuantized`) that onnxruntime-web's wasm backend has no kernel
for. `shared_embeddings=false` keeps the embedding as a plain table, as the
onnx-community files have it. The WebGPU backend runs the quantised one, so
the q4f16 build keeps the smaller default.

Verified on the stock 350M Extract model with the same transformers.js version
the app uses: through onnxruntime-node (38 tokens in 0.3 seconds), and in
headless Chromium on both backends, WebGPU with q4f16 (0.8 seconds) and wasm
with q4 (15.7 seconds, single-threaded). All three produced the same correct
JSON. The notebook's last cells run exactly this, and the result is a repo
`run.mjs --models` and the app's own loader can take.

One caveat found on the fine-tuned checkpoint itself: its WebGPU `q4f16`
export copies a real section faithfully, but its CPU `q4` export paraphrases
the passage instead of copying it, with or without the embedding option and
with full-precision matmul compute, while the stock model's CPU export is
fine. The cause was not found. `publish-colab.ipynb` builds an int8 CPU export
instead and checks it before uploading, and that one is faithful.

### The fine-tuned model through the same scorer

The published int8 export, scored with `run.mjs --dtype int8` on the two
lessons held out of training (two sections each, all seven layouts):

| layout  | parsed | passage words | spelling | prompts F1 | types (model) | types (derived) | answers | composite |
| ------- | -----: | ------------: | -------: | ---------: | ------------: | --------------: | ------: | --------: |
| docx    |   100% |          100% |     100% |       100% |           99% |             88% |    100% |       98% |
| plain   |   100% |          100% |     100% |       100% |           96% |             88% |    100% |       98% |
| qa      |   100% |          100% |      81% |       100% |           93% |             88% |     98% |       94% |
| caps    |    75% |           75% |      75% |        75% |           73% |             63% |     75% |       73% |
| bullets |   100% |          100% |     100% |       100% |           96% |             88% |    100% |       98% |
| colon   |   100% |          100% |     100% |        98% |           94% |             89% |     96% |       97% |
| worked  |   100% |          100% |     100% |       100% |           93% |             88% |    100% |       98% |

Set beside the stock model's 74 percent composite on the typed layout and 34
percent on the Word export, and the rules' 96 to 98 percent, the fine-tune
has caught up with the parser on every regular layout. The one miss in the
capitals layout is a single long section whose reply hit the 1,500-token cap
before closing its JSON. Two things the sample in the training notebook did
not show: the fine-tuned model's own type guesses are now right 93 to 99
percent of the time, above the derived rule, and the answers are exact on
every layout but the capitals one. About 30 seconds a section on an M4's CPU
through onnxruntime-node.

### The second fine-tune, with the layouts the rules cannot read

Retrained on the dataset with `nomarks` and `runon` (521 training examples),
and scored the same way but on every section of both held-out lessons, 12 per
layout rather than 4, so the two tables are not on the same sample:

| layout  | parsed | passage words | spelling | prompts F1 | types (model) | types (derived) | answers | composite |
| ------- | -----: | ------------: | -------: | ---------: | ------------: | --------------: | ------: | --------: |
| docx    |   100% |           99% |      98% |        97% |           93% |             87% |     99% |       96% |
| plain   |   100% |          100% |     100% |        98% |           96% |             87% |    100% |       97% |
| qa      |   100% |           99% |      85% |        99% |           96% |             87% |    100% |       94% |
| caps    |   100% |           99% |      98% |        98% |           97% |             87% |     99% |       96% |
| bullets |    92% |           91% |      92% |        90% |           87% |             80% |     92% |       89% |
| colon   |   100% |           99% |     100% |        99% |           96% |             85% |     96% |       96% |
| worked  |    92% |           89% |      92% |        89% |           88% |             78% |     92% |       88% |
| nomarks |   100% |          100% |      98% |        98% |           94% |             87% |     97% |       96% |
| runon   |    92% |           92% |      92% |        91% |           88% |             80% |     91% |       89% |

The two rows that matter are the last two, since those are the sections the
import actually hands to the model: 96 and 89 percent, where the rules get 66
and 40. Every row below 94 is one section out of twelve whose reply is not
valid JSON, and none of them hit the token cap: one run-on section wrote the
`spellingWords` key inside the paragraph list, one worked section dropped an
answer in as a bare string where a question belonged, and one bulleted
section repeated itself. The import shows such a section as unread rather
than guessing. On the sections that parse, every layout is 96 to 100 percent,
and the capitals layout's long section now fits. The app pins this export.

The model cards for both repos live in `scripts/extract-eval/model-cards/`
and are pushed with the Hub CLI (the README there has the commands). The
published exports:
[LFM2-1.2B-Extract-lesson](https://huggingface.co/playforgecoding/LFM2-1.2B-Extract-lesson)
(merged weights) and
[LFM2-1.2B-Extract-lesson-ONNX](https://huggingface.co/playforgecoding/LFM2-1.2B-Extract-lesson-ONNX)
(`q4f16` for WebGPU and `int8` for a CPU; the first fine-tune's `q4` file was
removed when the second replaced it, since its weights no longer matched).

## Running it again

```bash
cd packages/core
node scripts/extract-eval/run.mjs --dry-run --styles all            # render + split only
node scripts/extract-eval/run.mjs --lessons 4 --sections 2          # first pass, models
node scripts/extract-eval/run.mjs --strategy rules --styles all     # the parser, no model
node scripts/extract-eval/rescore.mjs                               # re-score saved outputs
node scripts/extract-eval/make-dataset.mjs                          # fine-tuning pairs
```

The fine-tune is `scripts/extract-eval/finetune-colab.ipynb`: open it in
Google Colab on a GPU runtime, upload the two JSONL files, set your Hugging
Face name in the first cell, and run it top to bottom. It trains a LoRA adapter
on the base Extract model, scores the held-out sections, merges the adapter,
converts the result to ONNX with the onnxruntime-genai builder and
`relayout-onnx.py` (`q4f16` for WebGPU, `int8` for a CPU; see above), and
pushes a repo in the onnx-community layout, which `run.mjs --models` then
measures against the same held-out lessons. A new upload only reaches the app
once `MODEL_REVISION` in `packages/core/src/browser/documentModelEngine.js`
points at its commit.

`--models` takes any transformers.js-compatible causal LM on the Hub; a model
id containing "Extract" gets the model card's schema prompt, anything else the
same schema inside an instruction. `--local-models <dir>` reads them from a
folder laid out the Hub way instead (`<dir>/<name>/onnx/model_<dtype>.onnx`),
for an export that has not been uploaded yet. Outputs, rendered documents and the summary
table land in `scripts/extract-eval/out/` (or the `--out` folder); models are
cached in `scripts/extract-eval/.cache/` (about 3.5 GB for the four above). All
of it is gitignored.
