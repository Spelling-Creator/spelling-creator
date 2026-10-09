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

// The schema, the type guide and the reply handling live in core
// (src/documentImportModel.js), which the app's import uses too, so the
// prompt the model is trained and scored with is the one the app sends.
import {
  QUESTION_TYPE_KEYS,
  SCHEMA,
  TYPE_GUIDE,
  parseModelJson,
  parseModelReply,
} from "../../src/documentImportModel.js";

export { QUESTION_TYPE_KEYS, SCHEMA, TYPE_GUIDE };
export const parseJson = parseModelJson;

const INSTRUCT_PREAMBLE = `You convert one section of a spelling lesson into JSON. Copy text exactly; invent nothing. Answer with the JSON object only, no prose and no code fence.

Return a JSON object with this schema:`;

export function modelKind(id) {
  return /extract/i.test(id) ? "extract" : "instruct";
}

export async function loadModel({
  id,
  dtype = "q4",
  cacheDir,
  localDir,
  log = () => {},
}) {
  env.cacheDir = cacheDir;
  // A folder of models laid out the Hub way (<id>/onnx/model_<dtype>.onnx)
  // instead of the Hub itself: for an export that has not been uploaded yet.
  env.allowLocalModels = Boolean(localDir);
  env.allowRemoteModels = !localDir;
  if (localDir) env.localModelPath = localDir;
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
    json: parseModelReply(raw),
    promptTokens,
    generated,
    ms,
    truncated: generated >= maxNewTokens,
  };
}
