// Run a local ONNX model over one section's text and get the lesson shape back.
//
// Two kinds of model:
//   extract   LFM2 Extract: the system prompt is the schema, the user turn is
//             the document, greedy decoding, as the model card prescribes.
//   instruct  any chat model: the same schema inside an instruction.

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  TextStreamer,
  env,
} from "@huggingface/transformers";

export const QUESTION_TYPE_KEYS = [
  "single",
  "number",
  "multiple",
  "multiple_open",
  "background",
  "open",
  "wyr",
  "paraphrase",
];

// A real JSON Schema: the Extract models are trained on schemas, and the first
// try with a looser sketch had the model renaming keys and inventing types.
export const SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "The section heading, or an empty string if there is none.",
      },
      paragraphs: {
        type: "array",
        description:
          "The passage: one item per paragraph, each paragraph copied in full, word for word, starting with the very first paragraph. Paragraphs are separated by blank lines in the document; a paragraph is a whole block of several sentences, never a single sentence.",
        items: { type: "string" },
      },
      spellingWords: {
        type: "array",
        description:
          "The words on the spelling line, in order, exactly as written.",
        items: { type: "string" },
      },
      questions: {
        type: "array",
        description: "Every question, in order.",
        items: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The question as written, without its answer.",
            },
            type: { type: "string", enum: QUESTION_TYPE_KEYS },
            answers: {
              type: "array",
              description:
                "The answer or answers printed with the question, exactly as written. Empty when none is printed.",
              items: { type: "string" },
            },
            steps: {
              type: "array",
              description:
                "Numbered working-out lines under a number question. Usually empty.",
              items: { type: "string" },
            },
          },
          required: ["prompt", "type", "answers"],
        },
      },
    },
    required: ["name", "paragraphs", "spellingWords", "questions"],
  },
  null,
  1,
);

// The keys a model drifts to, mapped back. An import would do the same.
const KEY_ALIASES = {
  name: [
    "name",
    "section_title",
    "sectiontitle",
    "title",
    "heading",
    "section",
  ],
  paragraphs: ["paragraphs", "passage", "text", "paragraph"],
  spellingWords: ["spellingwords", "spelling_words", "spelling", "words"],
  questions: ["questions"],
};
const QUESTION_ALIASES = {
  prompt: ["prompt", "question", "text"],
  type: ["type", "questiontype", "question_type", "kind"],
  answers: ["answers", "answer", "value", "values"],
  steps: ["steps", "working", "workings"],
};

function pick(obj, aliases) {
  const keys = Object.keys(obj);
  for (const alias of aliases) {
    const key = keys.find((k) => k.toLowerCase() === alias);
    if (key !== undefined) return obj[key];
  }
  return undefined;
}

const asList = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]);

export function normalizeExtraction(json) {
  if (!json || typeof json !== "object") return null;
  const questions = asList(pick(json, KEY_ALIASES.questions))
    .filter((q) => q && typeof q === "object")
    .map((q) => ({
      prompt: String(pick(q, QUESTION_ALIASES.prompt) ?? ""),
      type: String(pick(q, QUESTION_ALIASES.type) ?? ""),
      answers: asList(pick(q, QUESTION_ALIASES.answers)).map(String),
      steps: asList(pick(q, QUESTION_ALIASES.steps)).map(String),
    }));
  return {
    name: String(pick(json, KEY_ALIASES.name) ?? ""),
    paragraphs: asList(pick(json, KEY_ALIASES.paragraphs)).map(String),
    spellingWords: asList(pick(json, KEY_ALIASES.spellingWords)).map(String),
    questions,
  };
}

export const TYPE_GUIDE = `Question types:
- number: the answer is a number (often a blank ___ in the prompt, or a sum).
- single: one short answer taken from the passage.
- multiple: the prompt repeats a list from the passage and asks for one item; several answers are given.
- multiple_open: like multiple, but the answers are only suggestions.
- background: needs knowledge from outside the passage; one answer is given.
- wyr: begins "Would you rather"; no answer.
- paraphrase: asks to retell the passage in your own words; no answer.
- open: any other question with no answer.`;

const INSTRUCT_PREAMBLE = `You convert one section of a spelling lesson into JSON. Copy text exactly; invent nothing. Answer with the JSON object only, no prose and no code fence.

Return a JSON object with this schema:`;

export function modelKind(id) {
  return /extract/i.test(id) ? "extract" : "instruct";
}

export async function loadModel({
  id,
  dtype = "q4",
  cacheDir,
  log = () => {},
}) {
  env.cacheDir = cacheDir;
  env.allowLocalModels = false;
  const seen = new Map();
  const progress_callback = (p) => {
    if (p.status !== "progress") return;
    const pct = Math.floor(p.progress);
    if (seen.get(p.file) === pct || pct % 10) return;
    seen.set(p.file, pct);
    log(`  ${p.file} ${pct}%`);
  };
  const tokenizer = await AutoTokenizer.from_pretrained(id, {
    progress_callback,
  });
  const model = await AutoModelForCausalLM.from_pretrained(id, {
    dtype,
    device: "cpu",
    progress_callback,
  });
  return { id, dtype, kind: modelKind(id), tokenizer, model };
}

export async function unloadModel(ctx) {
  await ctx.model.dispose?.();
}

function messagesFor(kind, text) {
  const system =
    kind === "extract"
      ? `Return data as a JSON object with the following schema:\n${SCHEMA}\n\n${TYPE_GUIDE}`
      : `${INSTRUCT_PREAMBLE}\n${SCHEMA}\n\n${TYPE_GUIDE}`;
  return [
    { role: "system", content: system },
    { role: "user", content: text },
  ];
}

/**
 * @returns {Promise<{raw: string, json: object|null, promptTokens: number, generated: number, ms: number, truncated: boolean}>}
 */
export async function extractSection(
  ctx,
  text,
  { maxNewTokens = 1500, onChunk } = {},
) {
  const inputs = ctx.tokenizer.apply_chat_template(
    messagesFor(ctx.kind, text),
    { add_generation_prompt: true, return_dict: true, enable_thinking: false },
  );
  const promptTokens = inputs.input_ids.dims[1];
  const streamer = new TextStreamer(ctx.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk) => onChunk?.(chunk),
  });
  const t0 = performance.now();
  const output = await ctx.model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    do_sample: false,
    streamer,
  });
  const ms = performance.now() - t0;
  const newTokens = output.slice(null, [promptTokens, null]);
  const generated = newTokens.dims[1];
  const raw = ctx.tokenizer.batch_decode(newTokens, {
    skip_special_tokens: true,
  })[0];
  return {
    raw,
    json: normalizeExtraction(parseJson(raw)),
    promptTokens,
    generated,
    ms,
    truncated: generated >= maxNewTokens,
  };
}

// The object in the reply, with a best effort at closing a truncated one.
export function parseJson(raw) {
  let s = raw.replace(/```(?:json)?/g, "").trim();
  const start = s.indexOf("{");
  if (start < 0) return null;
  s = s.slice(start);
  try {
    return JSON.parse(s);
  } catch {
    // fall through to repair
  }
  const end = s.lastIndexOf("}");
  if (end > 0) {
    try {
      return JSON.parse(s.slice(0, end + 1));
    } catch {
      // fall through to repair
    }
  }
  return JSON.parse(closeJson(s));
}

function closeJson(s) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (inString) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  try {
    return JSON.stringify(JSON.parse(out));
  } catch {
    return "null";
  }
}
