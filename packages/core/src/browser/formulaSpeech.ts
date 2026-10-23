// Speech for a formula: its MathML read out in words, with the Speech Rule
// Engine (SRE), the same engine MathJax's own accessibility tools use.
//
// This module is HEAVY: the engine, plus the two JSON files of speech rules
// it needs for English (its base rules and the English ones, about 100 KB
// compressed between them). Nothing may static-import it from the app: it is
// reached only through formulas.ts, and only when a formula is about to be
// read aloud. vite.config.js additionally stubs it out of the Worker's SSR
// build.
//
// The engine is given the rule files by a loader the caller supplies, so that
// in the browser they come from the app's own hashed assets (formulaBrowser.ts)
// and under Node from the package on disk, and so that the engine never
// reaches for its default, a CDN.
//
// ClearSpeak is the rule set: it reads "60 over 5 equals 12" and "x squared",
// the way a teacher says a formula, where MathSpeak would spell the structure
// out for someone navigating it.

export interface FormulaSpeech {
  /**
   * The words for a MathML string, or an empty string when the engine has
   * nothing to say about it.
   */
  speak(mathml: string): string;
}

// Where the engine looks for its configuration as it loads.
const sreScope = globalThis as typeof globalThis & { SREfeature?: object };

/**
 * Load the engine and return something that speaks MathML.
 *
 * @param options.loadLocale  Gives the rule file for a locale name (`base`,
 *   then `en`), as its JSON text or parsed.
 */
export async function createFormulaSpeech({
  loadLocale,
  locale = "en",
}: {
  loadLocale: (locale: string) => Promise<string | object>;
  locale?: string;
}): Promise<FormulaSpeech> {
  const feature = {
    locale,
    domain: "clearspeak",
    modality: "speech",
    custom: loadLocale,
  };
  // Read by the engine as it loads, before setupEngine can be called, so the
  // first rule file it reaches for already goes through the loader. Taken
  // down again once the engine has it: nothing else on the page needs it.
  sreScope.SREfeature = feature;
  let sre;
  try {
    sre = await import("speech-rule-engine/js/common/system.js");
  } finally {
    delete sreScope.SREfeature;
  }
  // The engine's types say every feature is a string or a boolean, but it
  // also takes `custom`, the rule loader (see Engine.setCustomLoader).
  await sre.setupEngine(feature as unknown as Record<string, string | boolean>);
  await sre.engineReady();
  return {
    speak(mathml) {
      return String(sre.toSpeech(mathml) ?? "").trim();
    },
  };
}
