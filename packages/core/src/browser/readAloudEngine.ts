// Read-aloud with Kokoro, a small neural voice running in the page with
// transformers.js, in place of whatever voices the browser's speechSynthesis
// happens to ship on this device.
//
// Kokoro speaks phonemes, not text, so a line goes through three steps:
//
//   1. normalizeText: numbers, money, times and a few abbreviations into words.
//   2. espeak-ng (via Spellophone, our WebAssembly build of it) turns the words
//      into IPA, the same phonemizer Kokoro was trained against.
//   3. The model turns the IPA, plus a voice's style vector, into 24 kHz audio.
//
// Steps 1 and 2, and the lesson's pronunciations, substitutions, spell-outs and
// pauses, are in readAloudText.js. They follow kokoro.js
// (github.com/hexgrad/kokoro, Apache-2.0), the reference JavaScript port, so
// what the model hears matches what it expects. That package itself is not
// used: it pins transformers.js 3, which would put a second ONNX runtime in the
// bundle next to the one the app already has.
//
// This module is HEAVY: transformers.js and an ONNX runtime on top of a model
// download of 92 to 326 MB, depending on the dtype. Nothing may static-import
// this file: it is reached only through the dynamic import() in readAloud.js.
// vite.config.js additionally stubs it out of the Worker's SSR build.
//
// Model: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
// Licence: Apache-2.0, as the base model (hexgrad/Kokoro-82M).

import {
  AutoTokenizer,
  StyleTextToSpeech2Model,
  Tensor,
} from "@huggingface/transformers";
import { createEspeak } from "@spelling-creator/spellophone/browser";
import espeakWasmUrl from "@spelling-creator/spellophone/wasm/espeak-ng.wasm?url";
import espeakManifestUrl from "@spelling-creator/spellophone/espeak-ng-data/manifest.json?url";
import espeakCoreUrl from "@spelling-creator/spellophone/espeak-ng-data/core.bin.gz?url";
import espeakEnglishUrl from "@spelling-creator/spellophone/espeak-ng-data/en_dict.gz?url";
import { createDownloadProgress } from "./downloadProgress.ts";
import { phonemize, phonemizeSpoken } from "./readAloudText.ts";
import {
  DEFAULT_VOICE,
  MODEL_ID,
  MODEL_REVISION,
  WEBGPU_DTYPE,
} from "./readAloudVoices.ts";

export const SAMPLE_RATE = 24000;

// A voice file is a table of style vectors, one row of STYLE_DIM floats per
// input length from 0 to 509 tokens; the row matching the line's length is
// the one the model was trained to pair with it.
const STYLE_DIM = 256;
const MAX_STYLE_ROW = 509;

// Only English is bundled. Spellophone fetches each data file as
// new URL(name, dataUrl); this maps those names onto the hashed assets Vite
// emits for the imports above, so the data is self-hosted, cached with the rest
// of the build, and never fetched from a CDN.
const ESPEAK_FILES = {
  "manifest.json": espeakManifestUrl,
  "core.bin.gz": espeakCoreUrl,
  "en_dict.gz": espeakEnglishUrl,
};
const ESPEAK_DATA_URL = "https://espeak-ng-data.invalid/";

// A server may send the .gz files with Content-Encoding: gzip (Vite's dev
// server does), so the browser has unzipped them already. Spellophone spots
// that and passes them on as they are, so nothing needs doing about it here.
function fetchEspeakFile(url) {
  const name = new URL(url).pathname.split("/").pop();
  const asset = ESPEAK_FILES[name];
  if (!asset) {
    return Promise.resolve(
      new Response(null, { status: 404, statusText: "Not bundled" }),
    );
  }
  return fetch(asset);
}

let espeakPromise = null;

function loadEspeak() {
  if (!espeakPromise) {
    espeakPromise = createEspeak({
      dataUrl: ESPEAK_DATA_URL,
      wasmUrl: espeakWasmUrl,
      fetch: fetchEspeakFile,
      languages: ["en"],
    }).catch((err) => {
      espeakPromise = null;
      throw err;
    });
  }
  return espeakPromise;
}

const voiceCache = new Map();

function loadVoice(voice) {
  let promise = voiceCache.get(voice);
  if (!promise) {
    promise = fetch(
      `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/voices/${voice}.bin`,
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load the ${voice} voice.`);
        return res.arrayBuffer();
      })
      .then((buffer) => new Float32Array(buffer))
      .catch((err) => {
        voiceCache.delete(voice);
        throw err;
      });
    voiceCache.set(voice, promise);
  }
  return promise;
}

const { reportProgress, withProgress } = createDownloadProgress();

// One model per device and dtype per page. Only a successful load is memoised,
// so a failed download can be retried without a reload.
const models = new Map();

function loadModel(device, dtype) {
  const key = `${device}/${dtype}`;
  let promise = models.get(key);
  if (!promise) {
    promise = Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID, {
        revision: MODEL_REVISION,
        progress_callback: reportProgress,
      }),
      StyleTextToSpeech2Model.from_pretrained(MODEL_ID, {
        revision: MODEL_REVISION,
        device,
        dtype,
        progress_callback: reportProgress,
      }),
    ])
      .then(async ([tokenizer, model]) => {
        // The first run on a device is several times slower than the rest
        // (WebGPU compiles its shaders then; about 1.9 s against 0.4 s for the
        // same short line in Chrome on a Mac), so it happens here, behind the
        // load, rather than as a pause after the reader presses play.
        await model({
          input_ids: tokenizer("həlˈoʊ.").input_ids,
          style: new Tensor("float32", new Float32Array(STYLE_DIM), [
            1,
            STYLE_DIM,
          ]),
          speed: new Tensor("float32", [1], [1]),
        });
        return { tokenizer, model };
      })
      .catch((err) => {
        models.delete(key);
        throw err;
      });
    models.set(key, promise);
  }
  return promise;
}

// One generation at a time: the ONNX session is shared module state.
let turn = Promise.resolve();

/**
 * Load the phonemizer and the model, and return a reader for them.
 *
 * @param {object} [options]
 * @param {"webgpu"|"wasm"} [options.device]
 * @param {"fp32"|"fp16"|"q8"|"q4f16"} [options.dtype]  fp32 on WebGPU
 *   and q8 on WASM are what kokoro.js recommends.
 * @param {(loaded: number) => void} [options.onDownloadProgress]
 */
export async function loadReadAloud({
  device = "webgpu",
  dtype = device === "webgpu" ? WEBGPU_DTYPE : "q8",
  onDownloadProgress,
} = {}) {
  const [espeak, { tokenizer, model }] = await Promise.all([
    loadEspeak(),
    withProgress(onDownloadProgress, () => loadModel(device, dtype)),
  ]);

  /**
   * Text to IPA, exposed separately so its cost can be measured on its own.
   * @param {string | import("../speech.ts").SpokenRun[]} text  Plain words, or
   *   spoken text with its hints and pauses.
   * @param {object} [options]
   * @param {string} [options.voice]
   */
  function toPhonemes(text, { voice = DEFAULT_VOICE } = {}) {
    const accent = voice[0] === "b" ? "b" : "a";
    return typeof text === "string"
      ? phonemize(espeak, text, accent)
      : phonemizeSpoken(espeak, text, accent);
  }

  /**
   * IPA to audio.
   * @param {string} phonemes
   * @param {object} [options]
   * @param {string} [options.voice]
   * @param {number} [options.speed]  1 is the voice's natural pace.
   * @returns {Promise<{audio: Float32Array, sampleRate: number, tokens: number}>}
   */
  async function fromPhonemes(
    phonemes,
    { voice = DEFAULT_VOICE, speed = 1 } = {},
  ) {
    const styles = await loadVoice(voice);
    const { input_ids } = tokenizer(phonemes, { truncation: true });
    // The ids include a start and an end token, which don't count.
    const tokens = Math.min(
      Math.max(input_ids.dims.at(-1) - 2, 0),
      MAX_STYLE_ROW,
    );
    const offset = tokens * STYLE_DIM;
    const inputs = {
      input_ids,
      style: new Tensor("float32", styles.slice(offset, offset + STYLE_DIM), [
        1,
        STYLE_DIM,
      ]),
      speed: new Tensor("float32", [speed], [1]),
    };
    const run = turn.catch(() => {}).then(() => model(inputs));
    turn = run;
    const { waveform } = await run;
    return { audio: waveform.data, sampleRate: SAMPLE_RATE, tokens };
  }

  /**
   * Text to audio, for one chunk of speech (see chunkSpeech in core/speech.ts).
   * @param {string | import("../speech.ts").SpokenRun[]} text
   * @param {object} [options]
   * @param {string} [options.voice]
   * @param {number} [options.speed]
   */
  async function synthesize(text, options = {}) {
    return fromPhonemes(toPhonemes(text, options), options);
  }

  return { device, dtype, toPhonemes, fromPhonemes, synthesize };
}
