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
// Steps 1 and 2 follow kokoro.js (github.com/hexgrad/kokoro, Apache-2.0), the
// reference JavaScript port, so what the model hears matches what it expects.
// That package itself is not used: it pins transformers.js 3, which would put
// a second ONNX runtime in the bundle next to the one the app already has.
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
import { createDownloadProgress } from "./downloadProgress.js";
import { DEFAULT_VOICE } from "./readAloudVoices.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
// Pinned to a commit, so a later push to the repo can't change what readers
// download without someone here choosing to move the pin.
const MODEL_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";

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

// A server that sees a .gz file may send it with Content-Encoding: gzip (Vite's
// dev server does, and so can a self-host's), and then the browser has already
// unzipped it by the time Spellophone, which always unzips, reads it. Such a
// body is zipped up again so both kinds of server give the same bytes. This can
// go once Spellophone checks for itself:
// https://github.com/Spelling-Creator/spellophone/issues/2
const GZIP_MAGIC = [0x1f, 0x8b];

async function fetchEspeakFile(url) {
  const name = new URL(url).pathname.split("/").pop();
  const asset = ESPEAK_FILES[name];
  if (!asset)
    return new Response(null, { status: 404, statusText: "Not bundled" });
  const res = await fetch(asset);
  if (!res.ok || !name.endsWith(".gz")) return res;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]) {
    return new Response(bytes);
  }
  return new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
  );
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

/**
 * Spell out what espeak-ng would otherwise read badly or not at all. A port of
 * kokoro.js's normalize_text, minus the handling for CJK punctuation, which an
 * English voice never sees.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return (
    text
      // Quotes and brackets. Brackets become guillemets, which Kokoro's
      // vocabulary has and reads as a parenthetical.
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\(/g, "«")
      .replace(/\)/g, "»")
      // Whitespace.
      .replace(/[^\S \n]/g, " ")
      .replace(/ {2,}/g, " ")
      .replace(/(?<=\n) +(?=\n)/g, "")
      // Abbreviations.
      .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
      .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
      .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
      .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
      .replace(/\betc\.(?! [A-Z])/gi, "etc")
      // Numbers, times, years and money.
      .replace(
        /\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g,
        splitNumber,
      )
      .replace(/(?<=\d),(?=\d)/g, "")
      .replace(
        /[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi,
        flipMoney,
      )
      .replace(/\d*\.\d+/g, pointNumber)
      .replace(/(?<=\d)-(?=\d)/g, " to ")
      .replace(/(?<=\d)S/g, " S")
      // Possessives after a capital, so "CAT'S" isn't read as letters.
      .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
      .replace(/(?<=X')S\b/g, "s")
      // Dotted initials ("U.S.") read as letters, not as sentence ends.
      .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-"))
      .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
      .trim()
  );
}

function splitNumber(match) {
  if (match.includes(".")) return match;
  if (match.includes(":")) {
    const [h, m] = match.split(":").map(Number);
    if (m === 0) return `${h} o'clock`;
    if (m < 10) return `${h} oh ${m}`;
    return `${h} ${m}`;
  }
  const year = parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return match;
  const left = match.slice(0, 2);
  const right = parseInt(match.slice(2, 4), 10);
  const suffix = match.endsWith("s") ? "s" : "";
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${suffix}`;
    if (right < 10) return `${left} oh ${right}${suffix}`;
  }
  return `${left} ${right}${suffix}`;
}

function flipMoney(match) {
  const bill = match[0] === "$" ? "dollar" : "pound";
  const amount = match.slice(1);
  if (Number.isNaN(Number(amount))) return `${amount} ${bill}s`;
  if (!match.includes(".")) {
    return `${amount} ${bill}${amount === "1" ? "" : "s"}`;
  }
  const [b, c] = amount.split(".");
  const d = parseInt(c.padEnd(2, "0"), 10);
  const coins =
    match[0] === "$"
      ? d === 1
        ? "cent"
        : "cents"
      : d === 1
        ? "penny"
        : "pence";
  return `${b} ${bill}${b === "1" ? "" : "s"} and ${d} ${coins}`;
}

function pointNumber(match) {
  const [a, b] = match.split(".");
  return `${a} point ${b.split("").join(" ")}`;
}

// espeak-ng drops punctuation, but Kokoro uses it for pauses and intonation,
// so the text is cut at punctuation, only the words between go to espeak-ng,
// and the punctuation is put back between them unchanged. The long dash (code
// point 2014) is built from its number so the source doesn't carry one.
const PUNCTUATION_MARKS = `;:,.!?¡¿${String.fromCharCode(0x2014)}…"«»“”`;
const PUNCTUATION_RUN = new RegExp(
  String.raw`(\s*[${PUNCTUATION_MARKS}(){}[\]]+\s*)+`,
  "g",
);
// A lone "z" left before punctuation or a space belongs to the word before.
const STRAY_Z = new RegExp(` z(?=[${PUNCTUATION_MARKS} ]|$)`, "g");

/**
 * Text to the IPA string Kokoro takes.
 * @param {object} espeak  A Spellophone instance.
 * @param {string} text
 * @param {"a"|"b"} accent  American or British, from the voice id.
 * @returns {string}
 */
function phonemize(espeak, text, accent) {
  const normalized = normalizeText(text);
  // "en" is espeak-ng's British voice. "en-gb" would be clearer, but
  // Spellophone can't select it by that tag yet:
  // https://github.com/Spelling-Creator/spellophone/issues/1
  const voice = accent === "b" ? "en" : "en-us";
  let ipa = "";
  let last = 0;
  const speakWords = (words) => {
    if (!words) return;
    ipa += espeak.phonemes(words, { voice }).split("\n").join(" ");
  };
  for (const match of normalized.matchAll(PUNCTUATION_RUN)) {
    speakWords(normalized.slice(last, match.index));
    ipa += match[0];
    last = match.index + match[0].length;
  }
  speakWords(normalized.slice(last));

  // kokoro.js's corrections to espeak-ng's output, toward the phoneme set the
  // model was trained on.
  ipa = ipa
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(STRAY_Z, "z");
  if (accent === "a") {
    ipa = ipa.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  }
  return ipa.trim();
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
  dtype = device === "webgpu" ? "fp32" : "q8",
  onDownloadProgress,
} = {}) {
  const [espeak, { tokenizer, model }] = await Promise.all([
    loadEspeak(),
    withProgress(onDownloadProgress, () => loadModel(device, dtype)),
  ]);

  /**
   * Text to IPA, exposed separately so its cost can be measured on its own.
   * @param {string} text
   * @param {object} [options]
   * @param {string} [options.voice]
   */
  function toPhonemes(text, { voice = DEFAULT_VOICE } = {}) {
    return phonemize(espeak, text, voice[0] === "b" ? "b" : "a");
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
   * Text to audio, for one chunk of speech (see the web app's chunkForSpeech).
   * @param {string} text
   * @param {object} [options]
   * @param {string} [options.voice]
   * @param {number} [options.speed]
   */
  async function synthesize(text, options = {}) {
    return fromPhonemes(toPhonemes(text, options), options);
  }

  return { device, dtype, toPhonemes, fromPhonemes, synthesize };
}
