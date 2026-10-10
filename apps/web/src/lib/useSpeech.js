// Text-to-speech for interactive mode, which reads each step aloud. Two voices
// can do the reading:
//
//   The browser's own, over the Web Speech API (`window.speechSynthesis`). It
//   ships in every current browser and needs no download, so it is the default
//   and the fallback.
//
//   A natural voice: Kokoro, a small voice model running in the page (see
//   core/browser/readAloudEngine.js). Offered only where the device can run it
//   (lib/speechPrefs.js useNaturalVoices), and chosen in the same voice picker.
//
// Everything here runs on the reader's own device — like the on-device lesson
// summaries, no Worker call, no cost, and the lesson text never leaves the
// machine. Speech synthesis is still probed rather than assumed: where it's
// missing the hook reports `supported: false` and the UI hides the controls
// entirely instead of offering a button that can't work.
//
// Two quirks of the browser's voices shape this file (a third — voices loading
// late — belongs to the voice list, and is handled in lib/speechPrefs.js):
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
// And three facts shape the natural voice:
//
//   The first use downloads about 330 MB. So nothing loads until something is
//   actually spoken with a natural voice chosen, and the browser's voice reads
//   in the meantime rather than leaving a learner in silence for minutes.
//
//   Audio is made a chunk at a time, faster than it plays (about 0.6 s to the
//   first sound, then roughly six seconds of speech per second of work on a
//   Mac). Each chunk is queued on a Web Audio timeline the moment it is ready,
//   so a step plays as one stream.
//
//   The model does one thing at a time. `prepare` makes the opening of the next
//   step ahead of time, so moving on starts almost at once, but it waits until
//   the current step has been made: run alongside it, it would hold up the very
//   chunks the learner is about to hear.
//
// The user's preferences (on/off, voice, rate) are persisted, so someone who
// needs speech doesn't re-enable it on every lesson. They live in
// lib/speechPrefs.js, alongside the voice lists, because the settings page sets
// the same three without ever wanting anything below.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadReadAloud } from "@spelling-creator/core/browser/readAloud";
import {
  naturalVoiceId,
  useNaturalVoices,
  useSpeechPrefs,
  useSpeechVoices,
} from "./speechPrefs.js";

// Longest chunk we hand to a single utterance. Short enough to stay clear of
// Chromium's ~15s cutoff at the slowest rate we offer, long enough that a normal
// sentence is spoken as one unit with its natural intonation.
const MAX_CHUNK = 180;

// How much of the next step `prepare` makes ahead: enough to cover a short
// section name and the sentence after it, which is where a step would
// otherwise pause while the second chunk is still being made.
const PREPARED_CHUNKS = 2;

// Made audio kept for reuse, so replaying a step or a word, or reaching a
// prepared step, doesn't make it again. A few steps' worth.
const MAX_CACHED_CLIPS = 24;

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
 * Speech for the current browser, with the user's remembered preferences.
 *
 * `voiceLoad` describes the natural voice when one is chosen: "idle" before
 * anything has been spoken, "loading" (with `progress`, 0 to 1) during the
 * download, "ready", or "failed", after which the browser's voice reads for
 * the rest of the visit.
 *
 * @returns {{
 *   supported: boolean,
 *   enabled: boolean, setEnabled: (on: boolean) => void,
 *   speaking: boolean,
 *   speak: (text: string) => void,
 *   prepare: (text: string) => void,
 *   stop: () => void,
 *   voices: SpeechSynthesisVoice[],
 *   naturalVoices: { voiceURI: string, name: string, lang: string }[],
 *   voiceURI: string, setVoiceURI: (uri: string) => void,
 *   rate: number, setRate: (rate: number) => void,
 *   voiceLoad: { status: "idle"|"loading"|"ready"|"failed", progress: number } | null,
 * }}
 */
export function useSpeech() {
  // Both probed/adopted in effects rather than at render: the server has no
  // `window`, and a hydrating client has to render the same markup the server
  // sent. See lib/speechPrefs.js.
  const { supported, voices } = useSpeechVoices();
  const naturalVoices = useNaturalVoices();
  const {
    enabled,
    setEnabled: persistEnabled,
    voiceURI,
    setVoiceURI,
    rate,
    setRate,
  } = useSpeechPrefs();
  const [speaking, setSpeaking] = useState(false);

  // The natural voice is used only once the device check has passed: a stored
  // choice from before a connection turned metered stays stored, but the
  // browser's voice reads until the check passes again.
  const naturalId = naturalVoices.length > 0 ? naturalVoiceId(voiceURI) : null;
  const [load, setLoad] = useState({ status: "idle", progress: 0 });
  const reader = useRef(null);

  // The utterances (or clips) we queued, so `stop()` can tell "the user
  // cancelled" apart from "it finished on its own" — a cancel fires `onend` for
  // every queued utterance, and without this the speaking flag flickers.
  const generation = useRef(0);

  // The natural voice's audio: one context for the page, the sources playing
  // now, made clips by text, and the step waiting to be prepared.
  const audio = useRef({
    context: null,
    sources: [],
    clips: new Map(),
    pending: null,
    busy: false,
  });

  const stopClips = useCallback(() => {
    for (const source of audio.current.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped, or never started; either way it's silent.
      }
    }
    audio.current.sources = [];
  }, []);

  useEffect(() => {
    const state = audio.current;
    const synth =
      typeof window !== "undefined" ? window.speechSynthesis : undefined;

    return () => {
      // Leaving the page mid-sentence should not leave a voice talking over
      // whatever the user does next: speechSynthesis is global to the tab and
      // outlives this component. The generation bump is what makes the cancel
      // stick — a `speak` still waiting out the tick it defers by would
      // otherwise queue its utterances *after* this, and carry on talking into
      // a page that no longer has any way to stop it.
      generation.current += 1;
      synth?.cancel();
      stopClips();
      state.context?.close().catch(() => {});
      state.context = null;
    };
  }, [stopClips]);

  // Start the download, once. Only ever called from speak(), so visiting a
  // lesson page with a natural voice chosen downloads nothing.
  const startLoad = useCallback(() => {
    if (load.status !== "idle") return;
    setLoad({ status: "loading", progress: 0 });
    loadReadAloud({
      // Whole percents only: the download reports far more often than the
      // walkthrough, which re-renders for each one, needs to hear about it.
      onDownloadProgress: (fraction) => {
        const progress = Math.floor(fraction * 100) / 100;
        setLoad((current) =>
          current.status === "loading" && current.progress !== progress
            ? { ...current, progress }
            : current,
        );
      },
    })
      .then((loaded) => {
        reader.current = loaded;
        setLoad({ status: "ready", progress: 1 });
      })
      .catch((err) => {
        console.error("The natural voice couldn't load.", err);
        setLoad({ status: "failed", progress: 0 });
      });
  }, [load.status]);

  // Whether anything has been spoken yet. The device check behind
  // naturalVoices is async, and interactive mode speaks its first step the
  // moment it opens, which can be before the check has answered: that step is
  // read by the browser's voice, and this starts the download as soon as the
  // answer comes, rather than waiting for the next step to ask.
  const spoken = useRef(false);
  useEffect(() => {
    if (naturalId && spoken.current) startLoad();
  }, [naturalId, startLoad]);

  // A chunk's audio, made once per voice, pace and text.
  const clipFor = useCallback((text, voice, speed) => {
    const { clips } = audio.current;
    const key = `${voice}|${speed}|${text}`;
    let clip = clips.get(key);
    if (!clip) {
      clip = reader.current.synthesize(text, { voice, speed });
      // A failed chunk is not kept, so asking again tries again.
      clip.catch(() => clips.delete(key));
      clips.set(key, clip);
      if (clips.size > MAX_CACHED_CLIPS) {
        clips.delete(clips.keys().next().value);
      }
    }
    return clip;
  }, []);

  // Make the waiting step's opening chunks, unless a step is being made now,
  // in which case that step's speak runs this when it's done.
  const runPending = useCallback(() => {
    const state = audio.current;
    if (state.busy || !state.pending || !reader.current) return;
    const { text, voice, speed } = state.pending;
    state.pending = null;
    for (const chunk of chunkForSpeech(text).slice(0, PREPARED_CHUNKS)) {
      clipFor(chunk, voice, speed).catch(() => {});
    }
  }, [clipFor]);

  const speakBrowser = useCallback(
    (chunks, mine) => {
      const synth = window.speechSynthesis;
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

  const speakNatural = useCallback(
    async (chunks, mine, voice) => {
      const state = audio.current;
      state.context ??= new AudioContext();
      const context = state.context;
      // A context made outside a click starts suspended; every speak follows
      // one (opening the walkthrough, moving on, a speaker button).
      if (context.state === "suspended") context.resume().catch(() => {});
      setSpeaking(true);
      state.busy = true;
      let queuedUntil = 0;
      try {
        for (const [index, chunk] of chunks.entries()) {
          const { audio: samples, sampleRate } = await clipFor(
            chunk,
            voice,
            rate,
          );
          if (generation.current !== mine) return;
          const buffer = context.createBuffer(1, samples.length, sampleRate);
          buffer.copyToChannel(samples, 0);
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          const startAt = Math.max(context.currentTime, queuedUntil);
          source.start(startAt);
          queuedUntil = startAt + buffer.duration;
          state.sources.push(source);
          if (index === chunks.length - 1) {
            source.onended = () => {
              if (generation.current === mine) setSpeaking(false);
            };
          }
        }
      } catch (err) {
        // The model loaded but couldn't make this; the browser's voice reads
        // it, and everything after it.
        console.error("The natural voice couldn't read this.", err);
        setLoad({ status: "failed", progress: 0 });
        if (generation.current === mine) speakBrowser(chunks, mine);
      } finally {
        state.busy = false;
        runPending();
      }
    },
    [clipFor, rate, runPending, speakBrowser],
  );

  // Turning speech off has to silence what is already in the queue, not just
  // stop the next step from speaking — which is the one thing the bare
  // preference setter can't do, and the reason it's wrapped here.
  const setEnabled = useCallback(
    (next) => {
      persistEnabled(next);
      if (!next && typeof window !== "undefined" && window.speechSynthesis) {
        generation.current += 1;
        window.speechSynthesis.cancel();
        stopClips();
        setSpeaking(false);
      }
    },
    [persistEnabled, stopClips],
  );

  const stop = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    generation.current += 1;
    window.speechSynthesis.cancel();
    stopClips();
    setSpeaking(false);
  }, [stopClips]);

  const speak = useCallback(
    (text) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      const chunks = chunkForSpeech(text);
      if (chunks.length === 0) return;

      generation.current += 1;
      const mine = generation.current;
      window.speechSynthesis.cancel();
      stopClips();
      spoken.current = true;

      if (naturalId && load.status === "ready") {
        speakNatural(chunks, mine, naturalId);
        return;
      }
      if (naturalId) startLoad();
      speakBrowser(chunks, mine);
    },
    [naturalId, load.status, speakNatural, speakBrowser, startLoad, stopClips],
  );

  // Make the start of `text` ahead of time, for the natural voice. Only the
  // latest request is kept: the learner can only move on to one step.
  const prepare = useCallback(
    (text) => {
      if (!naturalId || load.status !== "ready") return;
      audio.current.pending = { text, voice: naturalId, speed: rate };
      runPending();
    },
    [naturalId, load.status, rate, runPending],
  );

  const voiceLoad = naturalId ? load : null;

  return useMemo(
    () => ({
      supported,
      enabled,
      setEnabled,
      speaking,
      speak,
      prepare,
      stop,
      voices,
      naturalVoices,
      voiceURI,
      setVoiceURI,
      rate,
      setRate,
      voiceLoad,
    }),
    [
      supported,
      enabled,
      setEnabled,
      speaking,
      speak,
      prepare,
      stop,
      voices,
      naturalVoices,
      voiceURI,
      setVoiceURI,
      rate,
      setRate,
      voiceLoad,
    ],
  );
}
