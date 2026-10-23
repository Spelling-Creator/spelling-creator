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
// (see lessonText.ts) become these runs, and so do a question prompt's (see
// inlineText.ts); everything else a step says (a caption, a heading) is plain
// words. The voices (the web app's useSpeech and
// core/browser/readAloudEngine.ts) take it from here:
//
//   Kokoro speaks phonemes, so it can follow every run: IPA goes in as it is,
//   an alias or a spelled-out word is turned into phonemes in place of the
//   text, a short pause is a comma, and a long one is silence between chunks.
//
//   The browser's voice takes plain text, so it gets spokenForBrowser: the
//   alias instead of the text, the letters of a spelled-out word with commas
//   between them, and the text itself for a pronunciation, which it has no way
//   to follow.
//
// A formula is one more kind of run, and the one that isn't the format's: it
// is said as its author's `spoken` words where there are any, and otherwise as
//
//   { text: "120 xx 3 = 360", formula: { format, source } }
//
// which stands in for speech that hasn't been made yet. Making it takes MathJax
// and a speech rule engine, which nobody should load to read a lesson without
// math, so the voices do that themselves, lazily, with withFormulaSpeech, just
// before speaking. A voice that gets a formula run anyway says its `text`, the
// source, as it would any run it doesn't know.

import { isRecord } from "./guards.ts";
import { inlineTextRuns } from "./inlineText.ts";
import {
  SAY_AS_CHARACTERS,
  normalizeSpokenText as storedSpokenText,
  textBlockParagraphs,
  type SpokenTextRun,
  type TextBlockRun,
} from "./lessonText.ts";
import type { TextBlock } from "./types.ts";

/** A formula still to be made into speech: its notation and its source. */
export interface FormulaSource {
  format: string;
  source: string;
}

/** The format's spoken runs, and the formula run that stands in for speech. */
export type SpokenRun =
  | SpokenTextRun
  | { text: string; formula: FormulaSource };

/** Something to say: a string of lines, or lines that are each a string or runs. */
export type SpeechScript = string | ReadonlyArray<string | SpokenRun[]>;

/** One piece of what to say, handed to a voice whole. */
export interface SpeechChunk {
  runs: SpokenRun[];
  pauseAfter: boolean;
}

function oneLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ") : "";
}

// Append a run, joining it onto a string before it.
function push(runs: SpokenRun[], run: SpokenRun): void {
  if (typeof run === "string") {
    if (!run) return;
    const last = runs.length - 1;
    if (typeof runs[last] === "string") {
      runs[last] += run;
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
 */
export function normalizeSpokenText(value: unknown): SpokenRun[] {
  const runs: SpokenRun[] = [];
  const list: unknown[] = Array.isArray(value) ? value : [value];
  for (const run of list) {
    if (isFormulaRun(run)) {
      const text = oneLine(run.text);
      if (text) runs.push({ text, formula: formulaOf(run.formula) });
      continue;
    }
    // Everything else is the stored shape, which lessonText.ts defines.
    const stored = storedSpokenText(run);
    if (stored === null) continue;
    for (const piece of Array.isArray(stored) ? stored : [stored]) {
      push(runs, piece);
    }
  }
  return runs;
}

function isFormulaRun(
  run: unknown,
): run is { text: string; formula: { format?: unknown; source: string } } {
  return (
    isRecord(run) &&
    typeof run.text === "string" &&
    isRecord(run.formula) &&
    typeof run.formula.source === "string"
  );
}

function formulaOf({
  format,
  source,
}: {
  format?: unknown;
  source: string;
}): FormulaSource {
  return { format: String(format ?? ""), source: oneLine(source) };
}

/**
 * Spoken text as it reads on a screen: its words, each run's text, and nothing
 * for a pause.
 */
export function spokenWords(runs: readonly SpokenRun[]): string {
  return runs
    .map((run) =>
      typeof run === "string" ? run : ("text" in run && run.text) || "",
    )
    .join("");
}

/**
 * A text block's paragraph (one entry of textBlockParagraphs) as spoken text.
 * Footnote markers are not spoken. A formula is its author's spoken words, or
 * a formula run for the voice to make speech from.
 */
export function paragraphSpeech(
  paragraph: readonly TextBlockRun[],
): SpokenRun[] {
  const runs: SpokenRun[] = [];
  for (const run of paragraph) {
    if (run.type === "text") {
      push(runs, run.speech ? { text: run.text, ...run.speech } : run.text);
    } else if (run.type === "pause") {
      runs.push({ pause: run.length });
    } else if (run.type === "math") {
      const words = normalizeSpokenText(run.spoken ?? []);
      if (words.length) {
        for (const word of words) push(runs, word);
      } else {
        runs.push({
          text: run.source,
          formula: { format: run.format, source: run.source },
        });
      }
    }
  }
  return runs;
}

/**
 * The chunks with speech made for every formula run, by `speak`, which takes
 * a run's `formula` and resolves to the words to say, or to null to leave the
 * run as it is (the source is then read). Each distinct formula is asked
 * about once, and a `speak` that throws leaves its formula as it is too.
 */
export async function withFormulaSpeech<Chunk extends { runs: SpokenRun[] }>(
  chunks: Chunk[],
  speak: (formula: FormulaSource) => Promise<string | null>,
): Promise<Chunk[]> {
  const words = new Map<string, Promise<string | null>>();
  for (const chunk of chunks) {
    for (const run of chunk.runs) {
      if (!isFormulaRun(run)) continue;
      const key = speechKey(run.formula);
      if (!words.has(key)) {
        words.set(
          key,
          Promise.resolve()
            .then(() => speak(run.formula))
            .catch(() => null),
        );
      }
    }
  }
  if (!words.size) return chunks;
  const out: Chunk[] = [];
  for (const chunk of chunks) {
    const runs: SpokenRun[] = [];
    for (const run of chunk.runs) {
      if (!isFormulaRun(run)) {
        push(runs, run);
        continue;
      }
      const said = await words.get(speechKey(run.formula));
      push(runs, said ? { text: run.text, alias: said } : run);
    }
    out.push({ ...chunk, runs });
  }
  return out;
}

/** Whether anything in what's to be said is a formula still to be spoken. */
export function hasFormulaSpeech(
  chunks: ReadonlyArray<{ runs: readonly SpokenRun[] }>,
): boolean {
  return chunks.some((chunk) => chunk.runs.some(isFormulaRun));
}

/** A text block as spoken text, one line per paragraph that says anything. */
export function textBlockSpeech(block: Partial<TextBlock>): SpokenRun[][] {
  return textBlockParagraphs(block)
    .map(paragraphSpeech)
    .filter((runs) => spokenWords(runs).trim());
}

/**
 * Inline text (a question's prompt, a working step) as spoken text: its
 * hints, pauses and formulas, the way a paragraph's are. Empty when it says
 * nothing.
 */
export function inlineTextSpeech(value: unknown): SpokenRun[] {
  const runs = paragraphSpeech(inlineTextRuns(value));
  return spokenWords(runs).trim() ? runs : [];
}

/**
 * Something to say, as lines of spoken text. A string is split into lines, one
 * idea per line; a list holds lines that are each a string or a list of runs.
 */
export function speechLines(script: SpeechScript): SpokenRun[][] {
  const lines: ReadonlyArray<string | SpokenRun[]> =
    typeof script === "string"
      ? script.split("\n")
      : Array.isArray(script)
        ? script
        : [];
  return lines.map(normalizeSpokenText).filter((runs) => runs.length);
}

/** Something to say, as it reads on a screen: one line of words per line. */
export function speechText(script: SpeechScript): string {
  return speechLines(script)
    .map((runs) => spokenWords(runs).trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * A word said one character at a time, as words a voice reads that way:
 * "REEF" becomes "R, E, E, F". The commas are what make each letter its own.
 */
export function spellOut(text: string | null | undefined): string {
  return [...String(text ?? "")].filter((ch) => ch.trim()).join(", ");
}

/**
 * Spoken text as plain words for a voice that can only take text (the
 * browser's). An alias is said in place of its text and a spelled-out word as
 * its letters. A pronunciation can't be followed, so its text is said as it is
 * written, and a pause becomes a comma (a long one is a break between chunks,
 * which chunkSpeech has already made).
 */
export function spokenForBrowser(runs: readonly SpokenRun[]): string {
  let out = "";
  for (const run of runs) {
    if (typeof run === "string") out += run;
    else if ("pause" in run) out += ", ";
    else if ("alias" in run && run.alias) out += run.alias;
    else if ("sayAs" in run && run.sayAs === SAY_AS_CHARACTERS)
      out += spellOut(run.text);
    else out += run.text || "";
  }
  return tidy(out);
}

// Spaces as a sentence would have them: one at a time, none before a comma or
// a full stop, and no comma straight after other punctuation.
function tidy(text: string): string {
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
function runLength(run: SpokenRun): number {
  if (typeof run === "string") return run.length;
  return "pause" in run ? 1 : (run.text || "").length;
}

function runsLength(runs: readonly SpokenRun[]): number {
  return runs.reduce((sum, run) => sum + runLength(run), 0);
}

// Strings split into words (each with the space after it), hints and pauses
// whole: the pieces a chunk boundary can fall between.
function atomsOf(runs: readonly SpokenRun[]): SpokenRun[] {
  const atoms: SpokenRun[] = [];
  for (const run of runs) {
    if (typeof run !== "string") atoms.push(run);
    // A space between two hints still keeps their words apart.
    else if (!run.trim()) atoms.push(run);
    // Not blank, so it has at least one word to match.
    else atoms.push(...run.match(/\s*\S+\s*/g)!);
  }
  return atoms;
}

// A word that ends a sentence, so the voice falls at the full stop.
function endsSentence(atom: SpokenRun): boolean {
  return typeof atom === "string" && /[.!?]["'»)\]]*\s*$/.test(atom);
}

// Atoms back into runs, without the space at either end.
function runsOf(atoms: readonly SpokenRun[]): SpokenRun[] {
  const runs: SpokenRun[] = [];
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
 */
export function chunkSpeech(
  script: SpeechScript,
  max: number = MAX_CHUNK,
): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  const add = (atoms: readonly SpokenRun[], pauseAfter = false) => {
    const runs = runsOf(atoms);
    if (spokenWords(runs).trim()) chunks.push({ runs, pauseAfter });
    else if (pauseAfter && chunks.length) chunks.at(-1)!.pauseAfter = true;
  };

  for (const line of speechLines(script)) {
    // Split at long pauses first: each piece is said whole where it fits.
    // `pieces` and `sentences` below start with one list and only grow.
    const pieces: SpokenRun[][] = [[]];
    for (const run of line) {
      if (typeof run === "object" && "pause" in run && run.pause === "long")
        pieces.push([]);
      else pieces.at(-1)!.push(run);
    }
    pieces.forEach((piece, index) => {
      const pauseAfter = index < pieces.length - 1;
      if (runsLength(piece) <= max) {
        add(atomsOf(piece), pauseAfter);
        return;
      }
      const sentences: SpokenRun[][] = [[]];
      for (const atom of atomsOf(piece)) {
        sentences.at(-1)!.push(atom);
        if (endsSentence(atom)) sentences.push([]);
      }
      const nonEmpty = sentences.filter((s) => s.length);
      nonEmpty.forEach((sentence, si) => {
        const last = si === nonEmpty.length - 1;
        if (runsLength(sentence) <= max) {
          add(sentence, last && pauseAfter);
          return;
        }
        let buffer: SpokenRun[] = [];
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
 * A stable key for a chunk's runs, for caching the audio made from it, or for
 * a formula, for asking about each one once.
 */
export function speechKey(runs: readonly SpokenRun[] | FormulaSource): string {
  return JSON.stringify(runs);
}
