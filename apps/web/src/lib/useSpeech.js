// Text-to-speech over the Web Speech API (`window.speechSynthesis`), used by
// interactive mode to read each step aloud.
//
// Everything here runs on the reader's own device — like the on-device lesson
// summaries, no Worker call, no cost, and the lesson text never leaves the
// machine. The API ships in every current browser, but it is still probed rather
// than assumed: where it's missing the hook reports `supported: false` and the
// UI hides the controls entirely instead of offering a button that can't work.
//
// Two quirks of the platform shape this file (a third — voices loading late —
// belongs to the voice list, and is handled in lib/speechPrefs.js):
//
//   Long utterances get cut off. Chromium stops speaking after ~15 seconds of a
//   single utterance. Splitting the text into sentence-sized chunks and queueing
//   them keeps every individual utterance well under that, which also makes
//   `cancel()` feel instant.
//
//   Cancelling is not synchronous. `cancel()` then an immediate `speak()` can
//   drop the new utterance in Chromium, so speaking is deferred a tick after a
//   cancel.
//
// The user's preferences (on/off, voice, rate) are persisted, so someone who
// needs speech doesn't re-enable it on every lesson. They live in
// lib/speechPrefs.js, alongside the voice list, because the settings page sets
// the same three without ever wanting anything below.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpeechPrefs, useSpeechVoices } from "./speechPrefs.js";

// Longest chunk we hand to a single utterance. Short enough to stay clear of
// Chromium's ~15s cutoff at the slowest rate we offer, long enough that a normal
// sentence is spoken as one unit with its natural intonation.
const MAX_CHUNK = 180;

/**
 * Split text into utterance-sized chunks: first by line (the caller composes one
 * idea per line — see stepSpeechText in core/interactive.js), then by sentence,
 * then, only if a single sentence is still enormous, on whitespace. Chunking on
 * punctuation rather than a raw character count matters: a cut mid-clause is
 * audible as a wrong-sounding pause.
 * @param {string} text
 * @returns {string[]}
 */
export function chunkForSpeech(text) {
  const chunks = [];

  for (const line of (text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length <= MAX_CHUNK) {
      chunks.push(trimmed);
      continue;
    }
    // Keep the terminator with the sentence it ends, so the voice still falls at
    // a full stop and rises at a question mark.
    for (const sentence of trimmed.match(/[^.!?]+[.!?]*\s*/g) || [trimmed]) {
      const part = sentence.trim();
      if (!part) continue;
      if (part.length <= MAX_CHUNK) {
        chunks.push(part);
        continue;
      }
      let buffer = "";
      for (const word of part.split(/\s+/)) {
        if (buffer && `${buffer} ${word}`.length > MAX_CHUNK) {
          chunks.push(buffer);
          buffer = word;
        } else {
          buffer = buffer ? `${buffer} ${word}` : word;
        }
      }
      if (buffer) chunks.push(buffer);
    }
  }

  return chunks;
}

/**
 * Speech synthesis for the current browser, with the user's remembered
 * preferences.
 *
 * @returns {{
 *   supported: boolean,
 *   enabled: boolean, setEnabled: (on: boolean) => void,
 *   speaking: boolean,
 *   speak: (text: string) => void,
 *   stop: () => void,
 *   voices: SpeechSynthesisVoice[],
 *   voiceURI: string, setVoiceURI: (uri: string) => void,
 *   rate: number, setRate: (rate: number) => void,
 * }}
 */
export function useSpeech() {
  // Both probed/adopted in effects rather than at render: the server has no
  // `window`, and a hydrating client has to render the same markup the server
  // sent. See lib/speechPrefs.js.
  const { supported, voices } = useSpeechVoices();
  const {
    enabled,
    setEnabled: persistEnabled,
    voiceURI,
    setVoiceURI,
    rate,
    setRate,
  } = useSpeechPrefs();
  const [speaking, setSpeaking] = useState(false);

  // The utterances we queued, so `stop()` can tell "the user cancelled" apart
  // from "it finished on its own" — a cancel fires `onend` for every queued
  // utterance, and without this the speaking flag flickers.
  const generation = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis)
      return undefined;
    const synth = window.speechSynthesis;

    return () => {
      // Leaving the page mid-sentence should not leave a voice talking over
      // whatever the user does next: speechSynthesis is global to the tab and
      // outlives this component. The generation bump is what makes the cancel
      // stick — a `speak` still waiting out the tick it defers by would
      // otherwise queue its utterances *after* this, and carry on talking into
      // a page that no longer has any way to stop it.
      generation.current += 1;
      synth.cancel();
    };
  }, []);

  // Turning speech off has to silence what is already in the queue, not just
  // stop the next step from speaking — which is the one thing the bare
  // preference setter can't do, and the reason it's wrapped here.
  const setEnabled = useCallback(
    (next) => {
      persistEnabled(next);
      if (!next && typeof window !== "undefined" && window.speechSynthesis) {
        generation.current += 1;
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
    },
    [persistEnabled],
  );

  const stop = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    generation.current += 1;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      const chunks = chunkForSpeech(text);
      if (chunks.length === 0) return;

      const synth = window.speechSynthesis;
      generation.current += 1;
      const mine = generation.current;
      synth.cancel();

      // `cancel()` isn't synchronous in Chromium — speaking in the same tick can
      // be swallowed by the cancellation that's still settling.
      setTimeout(() => {
        if (generation.current !== mine) return;
        const voice = (synth.getVoices() || []).find(
          (candidate) => candidate.voiceURI === voiceURI,
        );
        chunks.forEach((chunk, index) => {
          const utterance = new SpeechSynthesisUtterance(chunk);
          if (voice) {
            utterance.voice = voice;
            // Some engines ignore `voice` unless the language agrees with it.
            utterance.lang = voice.lang;
          }
          utterance.rate = rate;
          if (index === chunks.length - 1) {
            // Only the last chunk ends the run. A cancel bumps the generation,
            // so the stale utterances it flushes don't clear a newer run's flag.
            const finish = () => {
              if (generation.current === mine) setSpeaking(false);
            };
            utterance.onend = finish;
            utterance.onerror = finish;
          } else {
            utterance.onerror = () => {
              if (generation.current === mine) setSpeaking(false);
            };
          }
          synth.speak(utterance);
        });
        setSpeaking(true);
      }, 0);
    },
    [rate, voiceURI],
  );

  return useMemo(
    () => ({
      supported,
      enabled,
      setEnabled,
      speaking,
      speak,
      stop,
      voices,
      voiceURI,
      setVoiceURI,
      rate,
      setRate,
    }),
    [
      supported,
      enabled,
      setEnabled,
      speaking,
      speak,
      stop,
      voices,
      voiceURI,
      setVoiceURI,
      rate,
      setRate,
    ],
  );
}
