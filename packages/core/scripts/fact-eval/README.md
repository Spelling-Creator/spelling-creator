# Fact claim model experiment

Can a small on-device model do the language half of fact checking, listing the
checkable facts in a lesson passage, so the whole check can run in the page?
The checker itself (`src/factCheck.js`) already runs anywhere, and Wikipedia
and Wikidata answer the browser directly. Today the listing is the Worker's AI
provider's job (`apps/api/src/lib/factCheck.js`).

```bash
cd packages/core
node scripts/fact-eval/write-passages.mjs     # more passages (Claude, through the Claude Code CLI)
node scripts/fact-eval/label.mjs --check      # labels for anything without one yet
node scripts/fact-eval/make-dataset.mjs       # training pairs
node scripts/fact-eval/run.mjs --holdout      # score models on the held-out lessons
node scripts/fact-eval/findings.mjs out/<model>.int8.json   # what the author would see, against Wikidata
```

`claude.mjs` makes every Claude call: `claude -p` with structured output, no
tools, no MCP servers, no settings, run from an empty folder. It uses a Claude
subscription and needs no API key; `--model` picks the model (Opus by
default).

1. `lessons.mjs` reads every published hub lesson but those in `NOT_ARCHIVED`
   (`../extract-eval/lessons.mjs`, authors not yet asked), through the import
   experiment's fetcher and cache (`../extract-eval/.cache/lessons`).
2. `write-passages.mjs` has Claude write two-paragraph sections in the hub's
   style on topics chosen to cover every property the checker knows, and a few
   with no checkable fact at all. They go to `data/synthetic/`.
3. `label.mjs` asks Claude for each lesson's and section's facts with the exact
   prompt and schema the Worker sends its provider (`factCheckPrompt`,
   `FACT_CLAIMS_SCHEMA` in `src/factClaims.js`), and keeps each reply in
   `data/labels/`. Every claim then goes through the production gates: its
   quote must be in a passage, and its shape must be one the checker takes.
   `--check` runs the kept claims against Wikidata and counts what it says, as
   a read on the labels rather than a filter.

`data/` is committed. A label costs a Claude call and comes out a little
different every time, so the labels are archived rather than remade; both
scripts only ask about what has nothing there yet.

4. `make-dataset.mjs` turns each labelled passage into a chat-format example
   with the on-device prompt (`passageClaimsMessages`): the rules and schema as
   the system turn, the lesson's title and the passage as the user turn, and
   the passage's claims as the reply. Passages with no checkable fact stay in
   with an empty list. The lessons in `HOLDOUT_LESSONS` go to `holdout.jsonl`.
5. `run.mjs` runs ONNX models through transformers.js on the CPU, one passage at
   a time, through the import experiment's runner (`../extract-eval/extract.mjs`),
   and scores them with `score.mjs`: a claim is found when a label has the same
   property and an overlapping quote or the same value, and of those the
   subject, value, unit and qualifier are compared. Quotes that are not in the
   passage are counted as invented. Outputs go to `out/`.

The built dataset is public, CC BY 4.0, as
[playforgecoding/spelling-creator-fact-claims](https://huggingface.co/datasets/playforgecoding/spelling-creator-fact-claims),
with `data/` as its `raw/` folder; its card is `dataset-card.md`. To publish a
rebuilt one:

```bash
cp dataset-card.md out/dataset/README.md && cp -R data out/dataset/raw
hf upload playforgecoding/spelling-creator-fact-claims out/dataset . --repo-type dataset
```

3. `make-dataset.mjs` turns each labelled passage into a chat-format example
   with the on-device prompt (`passageClaimsMessages`): the rules and schema as
   the system turn, the lesson's title and the passage as the user turn, and
   the passage's claims as the reply. Passages with no checkable fact stay in
   with an empty list. The lessons in `HOLDOUT_LESSONS` go to `holdout.jsonl`.
4. `run.mjs` runs ONNX models through transformers.js on the CPU, one passage at
   a time, through the import experiment's runner (`../extract-eval/extract.mjs`),
   and scores them with `score.mjs`: a claim is found when a label has the same
   property and an overlapping quote or the same value, and of those the
   subject, value, unit and qualifier are compared. Quotes that are not in the
   passage are counted as invented. Outputs go to `out/`.

`finetune-colab.ipynb` is the fine-tune: set your Hugging Face name and run it
top to bottom. It loads the published dataset, or `train.jsonl` and
`holdout.jsonl` if you upload them. It trains a LoRA adapter on
LFM2-350M-Extract, scores the held-out passages, merges, and exports `q4f16`
and `int8` ONNX with the same builder and `../extract-eval/relayout-onnx.py` as
the import model.

The results are written up in the docs site under Monorepo, "Fact claim
model".
