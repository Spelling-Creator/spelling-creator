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
// Everything here runs on the reader's own device. Like the on-device lesson
// summaries, there's no Worker call and no cost, and the lesson text never
// leaves the machine. Speech synthesis is still probed rather than assumed:
// where it's missing the hook reports `supported: false` and the UI hides the
// controls entirely instead of offering a button that can't work.
//
// Two quirks of the browser's voices shape this file. (A third, voices loading
// late, belongs to the voice list and is handled in lib/speechPrefs.js.)
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
// And four facts shape the natural voice:
//
//   The first use downloads about 330 MB. So nothing loads until something is
//   actually spoken with a natural voice chosen and speech on, and the
//   browser's voice reads in the meantime rather than leaving a learner in
//   silence for minutes.
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
//   Things go wrong in two different ways. A download that fails (a dropped
//   connection, most likely) is tried again on a later step, a few times. A
//   loaded model that fails to make a chunk loses only that step, which the
//   browser's voice finishes from where the natural one stopped; only when
//   that keeps happening is the natural voice given up on for the visit.
//
// The user's preferences (on/off, voice, rate) are persisted, so someone who
// needs speech doesn't re-enable it on every lesson. They live in
// lib/speechPrefs.js, alongside the voice lists, because the settings page sets
// the same three without ever wanting anything below.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadReadAloud,
  readAloudPossible,
} from "@spelling-creator/core/browser/readAloud";
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

// Downloads tried per visit before the browser's voice is left to it. Files
// that finished are cached by transformers.js, so a retry picks up roughly
// where a dropped connection left off.
const MAX_LOAD_ATTEMPTS = 3;

// Steps in a row the loaded model may fail to read before it's given up on.
const MAX_READ_FAILURES = 2;

// How long to wait for a suspended AudioContext to start. Past this the
// browser is holding it back (no recent click, a strict autoplay rule), and
// the step is read by the browser's voice instead of being queued in silence.
const RESUME_TIMEOUT_MS = 500;

/**
 * Split text into utterance-sized chunks: first by line (the caller composes one
 * idea per line; see stepSpeechText in core/interactive.js), then by sentence,
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

// The download's progress, 0 to 1, kept outside React state: it changes a
// hundred times during a download, and only the one line that shows it should
// re-render for that, not the whole walkthrough holding the speech object.
// Read with useSyncExternalStore (see useVoiceProgress).
function createProgress() {
  let value = 0;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Speech for the current browser, with the user's remembered preferences.
 *
 * `voiceLoad` describes the natural voice when one is chosen: "idle" before
 * anything has been spoken, "loading" during the download, "ready", or
 * "failed", with a `reason`: "load" for a download that failed (`retry` says
 * whether a later step will try again) or "read" for a model that loaded but
 * kept failing to read. The download's progress is in `voiceProgress`, a
 * store for useSyncExternalStore, so that ticking doesn't re-render whatever
 * holds this object.
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
 *   voiceLoad: { status: "idle"|"loading"|"ready"|"failed", reason?: "load"|"read", retry?: boolean } | null,
 *   voiceProgress: { get: () => number, subscribe: (listener: () => void) => () => void },
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

  // What the UI shows about the natural voice. The decisions are made on the
  // refs below, which every callback reads at the moment it runs, so none of
  // them has to be rebuilt when the voice finishes loading.
  const [load, setLoad] = useState({ status: "idle" });
  // One store for the hook's life: lazily made state that is never set.
  const [progress] = useState(createProgress);
  const reader = useRef(null);
  const natural = useRef({
    loading: false,
    attempts: 0,
    readFailures: 0,
    brokenForVisit: false,
  });

  // The utterances (or clips) we queued, so `stop()` can tell "the user
  // cancelled" apart from "it finished on its own". A cancel fires `onend` for
  // every queued utterance, and without this the speaking flag flickers.
  const generation = useRef(0);

  // The natural voice's audio: one context for the page, the sources playing
  // now, made clips by text, the step waiting to be prepared, and which speak
  // (by generation) is making its chunks now, if any.
  const audio = useRef({
    context: null,
    sources: [],
    clips: new Map(),
    pending: null,
    busy: null,
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
      // stick. A `speak` still waiting out the tick it defers by would
      // otherwise queue its utterances *after* this, and carry on talking into
      // a page that no longer has any way to stop it.
      generation.current += 1;
      synth?.cancel();
      stopClips();
      state.context?.close().catch(() => {});
      state.context = null;
    };
  }, [stopClips]);

  // Start (or retry) the download. Never runs twice at once, gives up after
  // MAX_LOAD_ATTEMPTS, and asks the device check again first, so a connection
  // that has turned metered since the page loaded doesn't start one.
  const startLoad = useCallback(() => {
    const state = natural.current;
    if (reader.current || state.loading || state.brokenForVisit) return;
    if (state.attempts >= MAX_LOAD_ATTEMPTS) return;
    state.loading = true;
    state.attempts += 1;
    progress.set(0);
    setLoad({ status: "loading" });
    readAloudPossible()
      .then((possible) => {
        if (!possible) {
          throw new Error("This device can't download the natural voice now.");
        }
        return loadReadAloud({
          // Whole percents only; nobody reads a finer gauge.
          onDownloadProgress: (fraction) =>
            progress.set(Math.floor(fraction * 100) / 100),
        });
      })
      .then((loaded) => {
        reader.current = loaded;
        setLoad({ status: "ready" });
      })
      .catch((err) => {
        console.error("The natural voice couldn't load.", err);
        setLoad({
          status: "failed",
          reason: "load",
          retry: state.attempts < MAX_LOAD_ATTEMPTS,
        });
      })
      .finally(() => {
        state.loading = false;
      });
  }, [progress]);

  // Whether anything has been spoken yet. The device check behind
  // naturalVoices is async, and interactive mode speaks its first step the
  // moment it opens, which can be before the check has answered: that step is
  // read by the browser's voice, and this starts the download as soon as the
  // answer comes, rather than waiting for the next step to ask. Only while
  // speech is on: choosing a natural voice with speech off downloads nothing.
  const spoken = useRef(false);
  useEffect(() => {
    if (naturalId && enabled && spoken.current && load.status === "idle") {
      startLoad();
    }
  }, [naturalId, enabled, load.status, startLoad]);

  // A chunk's audio, made once per voice, pace and text. Only ever called with
  // a loaded reader.
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
    if (state.busy !== null || !state.pending || !reader.current) return;
    const { text, voice, speed } = state.pending;
    state.pending = null;
    for (const chunk of chunkForSpeech(text).slice(0, PREPARED_CHUNKS)) {
      clipFor(chunk, voice, speed).catch(() => {});
    }
  }, [clipFor]);

  const speakBrowser = useCallback(
    (chunks, mine) => {
      const synth = window.speechSynthesis;
      // `cancel()` isn't synchronous in Chromium, so speaking in the same tick
      // can be swallowed by the cancellation that's still settling.
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
      // Claimed before the first await, so a prepare() made in the same tick
      // (the walkthrough asks for the next step straight after this one) waits
      // for this step instead of queueing ahead of it. Claimed by generation,
      // so a cancelled speak finishing late can't release a newer one's claim.
      state.busy = mine;
      setSpeaking(true);
      let queuedUntil = 0;
      let next = 0;
      try {
        state.context ??= new AudioContext();
        const context = state.context;
        // A context made or left suspended starts on resume(), which a browser
        // only allows soon after a click. Every speak usually follows one
        // (opening the walkthrough, moving on, a speaker button); when it
        // doesn't, the browser's voice reads rather than clips being queued
        // on a clock that isn't running.
        if (context.state !== "running") {
          await Promise.race([
            context.resume().catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS)),
          ]);
        }
        if (generation.current !== mine) return;
        if (context.state !== "running") {
          speakBrowser(chunks, mine);
          return;
        }

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
            next = index + 1;
            state.sources.push(source);
            if (index === chunks.length - 1) {
              source.onended = () => {
                if (generation.current === mine) setSpeaking(false);
              };
            }
          }
          natural.current.readFailures = 0;
        } catch (err) {
          // The model couldn't make a chunk. What was already queued plays
          // out, then the browser's voice reads from the chunk that failed.
          console.error("The natural voice couldn't read this.", err);
          if (generation.current !== mine) return;
          natural.current.readFailures += 1;
          if (natural.current.readFailures >= MAX_READ_FAILURES) {
            natural.current.brokenForVisit = true;
            setLoad({ status: "failed", reason: "read" });
          }
          const rest = chunks.slice(next);
          const wait = Math.max(0, (queuedUntil - context.currentTime) * 1000);
          setTimeout(() => {
            if (generation.current === mine) speakBrowser(rest, mine);
          }, wait);
        }
      } finally {
        if (state.busy === mine) state.busy = null;
        runPending();
      }
    },
    [clipFor, rate, runPending, speakBrowser],
  );

  // Turning speech off has to silence what is already in the queue, not just
  // stop the next step from speaking. That is the one thing the bare
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

      if (naturalId && reader.current && !natural.current.brokenForVisit) {
        speakNatural(chunks, mine, naturalId);
        return;
      }
      // Not loaded yet, or a download that failed and may be tried again.
      if (naturalId) startLoad();
      speakBrowser(chunks, mine);
    },
    [naturalId, speakNatural, speakBrowser, startLoad, stopClips],
  );

  // Make the start of `text` ahead of time, for the natural voice. Only the
  // latest request is kept: the learner can only move on to one step.
  const prepare = useCallback(
    (text) => {
      if (!naturalId || !reader.current || natural.current.brokenForVisit) {
        return;
      }
      audio.current.pending = { text, voice: naturalId, speed: rate };
      runPending();
    },
    [naturalId, rate, runPending],
  );

  const voiceLoad = naturalId ? load : null;
  const voiceProgress = progress;

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
      voiceProgress,
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
      voiceProgress,
    ],
  );
}
