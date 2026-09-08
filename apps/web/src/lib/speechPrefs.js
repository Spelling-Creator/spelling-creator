// The read-aloud preferences — on/off, voice and pace — and the browser's voice
// list. Nothing here speaks.
//
// They live in their own module rather than inside useSpeech.js because two very
// different places need them: interactive mode, which is also doing the
// speaking, and the settings page, which only sets them and has no business
// dragging a queue of utterances and a cancel-on-unmount along for the ride.
// Both sides read and write the same three localStorage keys, so a change made
// in one shows up in the other.
//
// Two platform facts shape the hooks below:
//
//   The server has neither localStorage nor `speechSynthesis`, and a hydrating
//   client has to render exactly what the server sent. So both hooks start at
//   their defaults and adopt the real values in an effect, after mount — the
//   same dance as lib/colorScheme.jsx.
//
//   Voices load late. `getVoices()` returns [] on the first call in most
//   browsers and fills in asynchronously, announced by a `voiceschanged` event.
//   So the list is state, populated from both.
//
// What this deliberately does not do is keep two mounted components in step:
// change the pace on the settings page while a practice session is open in
// another tab and that session keeps its own until it remounts. A `storage`
// listener would close that gap, and isn't worth the machinery for a preference
// nobody changes mid-sentence.

import { useCallback, useEffect, useState } from "react";

const ENABLED_KEY = "spelling-creator:tts-enabled";
const VOICE_KEY = "spelling-creator:tts-voice";
const RATE_KEY = "spelling-creator:tts-rate";

/** Speaking rates offered in the UI. 1 is the browser's normal pace. */
export const SPEECH_RATES = [0.7, 0.85, 1, 1.25, 1.5];
export const DEFAULT_SPEECH_RATE = 1;

function readStored(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored;
  } catch {
    // localStorage unavailable (private browsing, etc.) — use the default.
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not being able to remember the preference is not worth failing over.
  }
}

/**
 * Whether this browser can speak at all. Probe it from an effect, never at
 * render — see the note above about hydration.
 * @returns {boolean}
 */
export function speechSupported() {
  return typeof window !== "undefined" && !!window.speechSynthesis;
}

/**
 * The voices this browser offers, and whether it offers speech at all.
 *
 * @returns {{ supported: boolean, voices: SpeechSynthesisVoice[] }}
 */
export function useSpeechVoices() {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState([]);

  useEffect(() => {
    if (!speechSupported()) return undefined;
    setSupported(true);

    const synth = window.speechSynthesis;
    const readVoices = () => setVoices(synth.getVoices() || []);
    readVoices();
    synth.addEventListener("voiceschanged", readVoices);
    return () => synth.removeEventListener("voiceschanged", readVoices);
  }, []);

  return { supported, voices };
}

/**
 * The user's remembered read-aloud preferences. Each setter persists as it sets
 * — persisting belongs to the act of choosing, not to observing the state, so
 * an effect can never write a default over a stored value during the render
 * before adoption.
 *
 * @returns {{
 *   enabled: boolean, setEnabled: (on: boolean) => void,
 *   voiceURI: string, setVoiceURI: (uri: string) => void,
 *   rate: number, setRate: (rate: number) => void,
 * }}
 */
export function useSpeechPrefs() {
  const [enabled, setEnabledState] = useState(false);
  const [voiceURI, setVoiceURIState] = useState("");
  const [rate, setRateState] = useState(DEFAULT_SPEECH_RATE);

  useEffect(() => {
    setEnabledState(readStored(ENABLED_KEY, "") === "true");
    setVoiceURIState(readStored(VOICE_KEY, ""));
    // An unrecognised stored rate (an older build's, a hand-edited one) leaves
    // the default in place rather than handing NaN to an utterance.
    const storedRate = Number(readStored(RATE_KEY, ""));
    if (SPEECH_RATES.includes(storedRate)) setRateState(storedRate);
  }, []);

  const setEnabled = useCallback((next) => {
    setEnabledState(next);
    writeStored(ENABLED_KEY, next ? "true" : "false");
  }, []);

  const setVoiceURI = useCallback((next) => {
    setVoiceURIState(next);
    writeStored(VOICE_KEY, next);
  }, []);

  const setRate = useCallback((next) => {
    setRateState(next);
    writeStored(RATE_KEY, String(next));
  }, []);

  return { enabled, setEnabled, voiceURI, setVoiceURI, rate, setRate };
}
