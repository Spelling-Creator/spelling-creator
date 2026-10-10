// Which Kokoro model to load, and its English voices graded C+ or better on
// the model card, which is where the drop in quality gets audible. Kept apart
// from readAloudEngine.js so a voice picker can list the voices, and
// readAloud.js can look for the model in the cache, without fetching the
// engine.

export const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
// Pinned to a commit, so a later push to the repo can't change what readers
// download without someone here choosing to move the pin.
export const MODEL_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";

// The first letter of an id is the accent (a for American, b for British), the
// second the voice's gender. `lang` is shown the way the browser's own voices
// show theirs, so the two lists read alike.
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
