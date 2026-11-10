// Which Kokoro model to load, and its English voices graded C+ or better on
// the model card, which is where the drop in quality gets audible. Kept apart
// from readAloudEngine.ts so a voice picker can list the voices, and
// readAloud.ts can look for the model in the cache, without fetching the
// engine.

export const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
// Pinned to a commit, so a later push to the repo can't change what readers
// download without someone here choosing to move the pin.
export const MODEL_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
// The weights loaded on WebGPU, the only device it's offered on. kokoro.js
// recommends fp32 there.
export const WEBGPU_DTYPE = "fp32";

/** The weights kokoro.js offers, by dtype. */
export type ReadAloudDtype = "fp32" | "fp16" | "q8" | "q4f16";

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
} as const satisfies Record<string, { name: string; lang: string }>;

export type VoiceId = keyof typeof VOICES;

export const DEFAULT_VOICE: VoiceId = "af_heart";

// A natural voice is stored in the same preference as a browser voice, as this
// prefix plus the voice's id, so choosing one is just choosing a voice. No
// browser voiceURI starts with it.
export const NATURAL_VOICE_PREFIX = "kokoro:";

/** The voice preference that names a natural voice. */
export function naturalVoiceURI(id: VoiceId): string {
  return `${NATURAL_VOICE_PREFIX}${id}`;
}

/**
 * The Kokoro voice id a stored voice preference names, or null for a browser
 * voice (or the browser default).
 */
export function naturalVoiceId(
  voiceURI: string | null | undefined,
): VoiceId | null {
  if (!voiceURI?.startsWith(NATURAL_VOICE_PREFIX)) return null;
  const id = voiceURI.slice(NATURAL_VOICE_PREFIX.length);
  return Object.hasOwn(VOICES, id) ? (id as VoiceId) : null;
}
