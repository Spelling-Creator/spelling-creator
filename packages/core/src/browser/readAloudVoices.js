// Kokoro's English voices graded C+ or better on the model card, which is
// where the drop in quality gets audible. The first letter of an id is the
// accent (a for American, b for British), the second the voice's gender. Kept
// apart from readAloudEngine.js so a voice picker can list them without
// fetching the engine. `lang` is shown the way the browser's own voices show
// theirs, so the two lists read alike.

export const VOICES = {
  af_heart: { name: "Heart", lang: "en-US" },
  af_bella: { name: "Bella", lang: "en-US" },
  af_nicole: { name: "Nicole", lang: "en-US" },
  am_fenrir: { name: "Fenrir", lang: "en-US" },
  am_michael: { name: "Michael", lang: "en-US" },
  am_puck: { name: "Puck", lang: "en-US" },
  bf_emma: { name: "Emma", lang: "en-GB" },
  bm_george: { name: "George", lang: "en-GB" },
};

export const DEFAULT_VOICE = "af_heart";
