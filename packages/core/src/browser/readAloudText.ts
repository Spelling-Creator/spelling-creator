// Text to the IPA Kokoro speaks, for readAloudEngine.ts.
//
// Kokoro speaks phonemes, not text, so a line goes through two steps before the
// model:
//
//   1. normalizeText: numbers, money, times and a few abbreviations into words.
//   2. espeak-ng (via Spellophone, our WebAssembly build of it) turns the words
//      into IPA, the same phonemizer Kokoro was trained against.
//
// Both follow kokoro.js (github.com/hexgrad/kokoro, Apache-2.0), the reference
// JavaScript port, so what the model hears matches what it expects.
//
// Spoken text (see core/speech.ts) adds the lesson's read-aloud hints on top: a
// pronunciation goes in as written, an alias or a spelled-out word goes through
// the same two steps in place of its text, and a short pause is a comma.
//
// Kept apart from the engine, which loads transformers.js and the model, so
// this can be tested with the Node build of Spellophone. It takes an espeak
// instance rather than making one.

import type { Espeak } from "@spelling-creator/spellophone/browser";
import { SAY_AS_CHARACTERS } from "../lessonText.ts";
import { spellOut, type SpokenRun } from "../speech.ts";

/** The part of a Spellophone instance that phonemizing uses. */
export type Phonemizer = Pick<Espeak, "phonemes">;

/** American or British, from the first letter of the voice id. */
export type Accent = "a" | "b";

/**
 * Spell out what espeak-ng would otherwise read badly or not at all. A port of
 * kokoro.js's normalize_text, minus the handling for CJK punctuation, which an
 * English voice never sees.
 */
export function normalizeText(text: string | null | undefined): string {
  return (
    String(text ?? "")
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

function splitNumber(match: string) {
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

function flipMoney(match: string) {
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

function pointNumber(match: string) {
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
 * @param espeak  A Spellophone instance.
 * @param accent  American or British, from the voice id.
 */
export function phonemize(
  espeak: Phonemizer,
  text: string,
  accent: Accent,
): string {
  const normalized = normalizeText(text);
  const voice = accent === "b" ? "en-gb" : "en-us";
  let ipa = "";
  let last = 0;
  const speakWords = (words: string) => {
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

/**
 * A pronunciation an author typed, in the phoneme set Kokoro's vocabulary
 * has. The same corrections kokoro.js makes to espeak-ng's output, plus the
 * ASCII people type for IPA they can't: a plain "g" (the vocabulary only has
 * the IPA "ɡ"), an apostrophe for the stress mark, and a colon for length.
 */
export function kokoroIpa(ipa: string): string {
  return ipa
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/g/g, "ɡ")
    .replace(/['’]/g, "ˈ")
    .replace(/(?<=\p{L}):/gu, "ː")
    .trim();
}

/**
 * Spoken text (see core/speech.ts) to the IPA string Kokoro takes. Words go
 * through espeak-ng as usual; a pronunciation goes in as written; an alias or
 * a spelled-out word is turned into phonemes in place of its text; and a short
 * pause is a comma, which Kokoro pauses at. (A long pause never reaches here:
 * chunkSpeech has already cut the chunk there.)
 * @param espeak  A Spellophone instance.
 */
export function phonemizeSpoken(
  espeak: Phonemizer,
  runs: readonly SpokenRun[],
  accent: Accent,
): string {
  const parts = runs.map((spoken) => {
    if (typeof spoken === "string") return phonemize(espeak, spoken, accent);
    // Each kind of run holds at most one of these, so one view of them all
    // reads whichever it has.
    const run: {
      text?: string;
      pause?: unknown;
      ipa?: string;
      alias?: string;
      sayAs?: string;
    } = spoken;
    if (run.pause) return ",";
    if (run.ipa) return kokoroIpa(run.ipa);
    if (run.alias) return phonemize(espeak, run.alias, accent);
    if (run.sayAs === SAY_AS_CHARACTERS) {
      return phonemize(espeak, spellOut(run.text), accent);
    }
    return phonemize(espeak, run.text || "", accent);
  });
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?…»])/g, "$1")
    .replace(/([,.;:!?])(?:\s*,)+/g, "$1")
    .replace(/^[\s,]+/, "")
    .trim();
}
