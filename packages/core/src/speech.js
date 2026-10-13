// What read-aloud says: lesson text turned into spoken text, and spoken text cut
// into the chunks a voice is handed one at a time.
//
// Spoken text is the Open Spelling Lesson Format's: a list of runs, each one of
//
//   "words"                                   words to say
//   { text: "FRESNEL", ipa: "freɪˈnɛl" }       said the way the IPA gives it
//   { text: "WWF", alias: "World Wide Fund" }  said as other words
//   { text: "REEF", sayAs: "characters" }      said one character at a time
//   { pause: "short" } / { pause: "long" }     a pause
//
// a deliberately small subset of SSML. A text block's speech hints and pauses
// (see lessonText.js) become these runs, and everything else a step says (a
// prompt, a caption, a heading) is plain words. The voices (the web app's
// useSpeech and core/browser/readAloudEngine.js) take it from here:
//
//   Kokoro speaks phonemes, so it can follow every run: IPA goes in as it is,
//   an alias or a spelled-out word is turned into phonemes in place of the
//   text, a short pause is a comma, and a long one is silence between chunks.
//
//   The browser's voice takes plain text, so it gets spokenForBrowser: the
//   alias instead of the text, the letters of a spelled-out word with commas
//   between them, and the text itself for a pronunciation, which it has no way
//   to follow.

import {
  PAUSE_LENGTHS,
  SAY_AS_CHARACTERS,
  normalizeSpeechHint,
  textBlockParagraphs,
} from "./lessonText.js";

/**
 * @typedef {string
 *   | { text: string, ipa: string }
 *   | { text: string, alias: string }
 *   | { text: string, sayAs: "characters" }
 *   | { pause: "short" | "long" }} SpokenRun
 */

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function oneLine(value) {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ") : "";
}

// Append a run, joining it onto a string before it.
function push(runs, run) {
  if (typeof run === "string") {
    if (!run) return;
    if (typeof runs[runs.length - 1] === "string") {
      runs[runs.length - 1] += run;
      return;
    }
  }
  runs.push(run);
}

/**
 * Spoken text as a list of runs this module understands, from anything that
 * claims to be spoken text (a plain string or a list of runs). A run object it
 * doesn't recognize is said as its `text` where it has one and skipped where it
 * hasn't, as the format asks.
 * @param {unknown} value
 * @returns {SpokenRun[]}
 */
export function normalizeSpokenText(value) {
  const runs = [];
  for (const run of Array.isArray(value) ? value : [value]) {
    if (typeof run === "string") {
      push(runs, oneLine(run));
    } else if (isObject(run) && PAUSE_LENGTHS.includes(run.pause)) {
      runs.push({ pause: run.pause });
    } else if (isObject(run) && typeof run.text === "string") {
      const text = oneLine(run.text);
      if (!text) continue;
      const hint = normalizeSpeechHint(run);
      push(runs, hint ? { text, ...hint } : text);
    }
  }
  return runs;
}

/**
 * Spoken text as it reads on a screen: its words, each run's text, and nothing
 * for a pause.
 * @param {SpokenRun[]} runs
 * @returns {string}
 */
export function spokenWords(runs) {
  return runs
    .map((run) => (typeof run === "string" ? run : run.text || ""))
    .join("");
}

/**
 * A text block's paragraph (one entry of textBlockParagraphs) as spoken text.
 * Footnote markers are not spoken.
 * @param {Array<object>} paragraph
 * @returns {SpokenRun[]}
 */
export function paragraphSpeech(paragraph) {
  const runs = [];
  for (const run of paragraph) {
    if (run.type === "text") {
      push(runs, run.speech ? { text: run.text, ...run.speech } : run.text);
    } else if (run.type === "pause") {
      runs.push({ pause: run.length });
    }
  }
  return runs;
}

/**
 * A text block as spoken text, one line per paragraph that says anything.
 * @param {object} block
 * @returns {SpokenRun[][]}
 */
export function textBlockSpeech(block) {
  return textBlockParagraphs(block)
    .map(paragraphSpeech)
    .filter((runs) => spokenWords(runs).trim());
}

/**
 * Something to say, as lines of spoken text. A string is split into lines, one
 * idea per line; a list holds lines that are each a string or a list of runs.
 * @param {string | Array<string | SpokenRun[]>} script
 * @returns {SpokenRun[][]}
 */
export function speechLines(script) {
  const lines =
    typeof script === "string"
      ? script.split("\n")
      : Array.isArray(script)
        ? script
        : [];
  return lines.map(normalizeSpokenText).filter((runs) => runs.length);
}

/**
 * Something to say, as it reads on a screen: one line of words per line.
 * @param {string | Array<string | SpokenRun[]>} script
 * @returns {string}
 */
export function speechText(script) {
  return speechLines(script)
    .map((runs) => spokenWords(runs).trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * A word said one character at a time, as words a voice reads that way:
 * "REEF" becomes "R, E, E, F". The commas are what make each letter its own.
 * @param {string} text
 * @returns {string}
 */
export function spellOut(text) {
  return [...String(text ?? "")].filter((ch) => ch.trim()).join(", ");
}

/**
 * Spoken text as plain words for a voice that can only take text (the
 * browser's). An alias is said in place of its text and a spelled-out word as
 * its letters. A pronunciation can't be followed, so its text is said as it is
 * written, and a pause becomes a comma (a long one is a break between chunks,
 * which chunkSpeech has already made).
 * @param {SpokenRun[]} runs
 * @returns {string}
 */
export function spokenForBrowser(runs) {
  let out = "";
  for (const run of runs) {
    if (typeof run === "string") out += run;
    else if (run.pause) out += ", ";
    else if (run.alias) out += run.alias;
    else if (run.sayAs === SAY_AS_CHARACTERS) out += spellOut(run.text);
    else out += run.text || "";
  }
  return tidy(out);
}

// Spaces as a sentence would have them: one at a time, none before a comma or
// a full stop, and no comma straight after other punctuation.
function tidy(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?:\s*,)+/g, "$1")
    .replace(/^[\s,]+/, "")
    .trim();
}

// ---- Chunking -----------------------------------------------------------------

/** Longest chunk handed to a voice at once, in characters of words. */
export const MAX_CHUNK = 180;

// A run's share of a chunk's length: the words it shows, or one for a pause.
function runLength(run) {
  if (typeof run === "string") return run.length;
  return run.pause ? 1 : (run.text || "").length;
}

function runsLength(runs) {
  return runs.reduce((sum, run) => sum + runLength(run), 0);
}

// Strings split into words (each with the space after it), hints and pauses
// whole: the pieces a chunk boundary can fall between.
function atomsOf(runs) {
  const atoms = [];
  for (const run of runs) {
    if (typeof run !== "string") atoms.push(run);
    // A space between two hints still keeps their words apart.
    else if (!run.trim()) atoms.push(run);
    else atoms.push(...run.match(/\s*\S+\s*/g));
  }
  return atoms;
}

// A word that ends a sentence, so the voice falls at the full stop.
function endsSentence(atom) {
  return typeof atom === "string" && /[.!?]["'»)\]]*\s*$/.test(atom);
}

// Atoms back into runs, without the space at either end.
function runsOf(atoms) {
  const runs = [];
  for (const atom of atoms) push(runs, atom);
  if (typeof runs[0] === "string") runs[0] = runs[0].trimStart();
  const last = runs.length - 1;
  if (typeof runs[last] === "string") runs[last] = runs[last].trimEnd();
  return runs.filter((run) => run !== "");
}

/**
 * Cut what to say into chunks a voice is handed one at a time: first by line
 * (one idea each), then at every long pause, then, for a line too long to say
 * in one go, by sentence, and only a sentence that is still enormous on
 * whitespace. Cutting at punctuation rather than a raw character count matters:
 * a cut mid-clause is audible as a wrong-sounding pause. Hints and pauses are
 * never split.
 *
 * `pauseAfter` marks a chunk followed by a long pause, which a voice says as
 * silence before the next chunk.
 * @param {string | Array<string | SpokenRun[]>} script
 * @param {number} [max]
 * @returns {Array<{ runs: SpokenRun[], pauseAfter: boolean }>}
 */
export function chunkSpeech(script, max = MAX_CHUNK) {
  const chunks = [];
  const add = (atoms, pauseAfter = false) => {
    const runs = runsOf(atoms);
    if (spokenWords(runs).trim()) chunks.push({ runs, pauseAfter });
    else if (pauseAfter && chunks.length) chunks.at(-1).pauseAfter = true;
  };

  for (const line of speechLines(script)) {
    // Split at long pauses first: each piece is said whole where it fits.
    const pieces = [[]];
    for (const run of line) {
      if (run.pause === "long") pieces.push([]);
      else pieces.at(-1).push(run);
    }
    pieces.forEach((piece, index) => {
      const pauseAfter = index < pieces.length - 1;
      if (runsLength(piece) <= max) {
        add(atomsOf(piece), pauseAfter);
        return;
      }
      const sentences = [[]];
      for (const atom of atomsOf(piece)) {
        sentences.at(-1).push(atom);
        if (endsSentence(atom)) sentences.push([]);
      }
      const nonEmpty = sentences.filter((s) => s.length);
      nonEmpty.forEach((sentence, si) => {
        const last = si === nonEmpty.length - 1;
        if (runsLength(sentence) <= max) {
          add(sentence, last && pauseAfter);
          return;
        }
        let buffer = [];
        for (const atom of sentence) {
          if (buffer.length && runsLength(buffer) + runLength(atom) > max) {
            add(buffer);
            buffer = [];
          }
          buffer.push(atom);
        }
        add(buffer, last && pauseAfter);
      });
    });
  }
  return chunks;
}

/**
 * A stable key for a chunk's runs, for caching the audio made from it.
 * @param {SpokenRun[]} runs
 * @returns {string}
 */
export function speechKey(runs) {
  return JSON.stringify(runs);
}
