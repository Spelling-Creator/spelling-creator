// Text-to-speech for interactive mode, which reads each step aloud. Two voices
// can do the reading:
//
//   The browser's own, over the Web Speech API (`speechSynthesis`). It ships
//   in every current browser and needs no download, so it is the default and
//   the fallback.
//
//   A natural voice: Kokoro, a small voice model running in the page (see
//   readAloudEngine.ts). Offered only where the device can run it (readAloud.ts
//   readAloudPossible), and chosen in the same voice picker.
//
// Everything here runs on the reader's own device. Like the on-device lesson
// summaries, there's no Worker call and no cost, and the lesson text never
// leaves the machine. Speech synthesis is still probed rather than assumed:
// where it's missing, `speak` does nothing and the page hides the controls.
//
// What to say arrives as spoken text (see ../speech.ts): lines of words that
// can carry a pronunciation, a substitution, a spell-out or a pause. The
// natural voice follows all of them; the browser's voice is given plain words
// (spokenForBrowser), so it says an alias and spells a word out but reads a
// pronunciation as written. A long pause is silence between two chunks.
//
// A formula is spoken from the MathML MathJax parses it into, by a speech
// rule engine. Both load the first time a formula is about to be read (see
// formulas.ts), so a step with math in it starts a moment later the first
// time, and a lesson without math never loads them. The words are worked out
// before the step is spoken (withFormulaSpeech), for both voices.
//
// Two quirks of the browser's voices shape this file. (A third, voices loading
// late, belongs to the voice list and is handled by the page.)
//
//   Long utterances get cut off. Chromium stops speaking after ~15 seconds of a
//   single utterance. Splitting the text into sentence-sized chunks
//   (chunkSpeech) and queueing them keeps every individual utterance well
//   under that, which also makes `cancel()` feel instant.
//
//   Cancelling is not synchronous. `cancel()` then an immediate `speak()` can
//   drop the new utterance in Chromium, so speaking is deferred a tick after a
//   cancel.
//
// And four facts shape the natural voice:
//
//   The first use downloads about 330 MB. So nothing downloads until something
//   is actually spoken with a natural voice chosen and speech on, and the
//   browser's voice reads in the meantime rather than leaving a learner in
//   silence for minutes. Once it's downloaded, loading it from the cache takes
//   a couple of seconds, so that starts as soon as practice mode opens, and a
//   step spoken meanwhile waits for it (up to CACHED_WAIT_MS) rather than
//   being read in a voice nobody chose.
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
// Nothing here knows about React, and nothing here remembers a preference:
// the page keeps the on/off, voice and pace settings (persisted, so someone
// who needs speech doesn't re-enable it on every lesson) and passes them in
// through `configure`. The player is a store (see ../store.ts) whose snapshot
// says whether it is speaking and how the natural voice's load is going;
// apps/web/src/lib/useSpeech.js is the hook over it.

import {
  chunkSpeech,
  hasFormulaSpeech,
  speechKey,
  spokenForBrowser,
  withFormulaSpeech,
  type SpeechChunk,
  type SpeechScript,
  type SpokenRun,
} from "../speech.ts";
import { createStore, createValueStore, type ReadableStore } from "../store.ts";
import { formulaWords } from "./formulas.ts";
import {
  loadReadAloud,
  readAloudCached,
  readAloudPossible,
  type ReadAloudReader,
} from "./readAloud.ts";
import type { ReadAloudAudio } from "./readAloudEngine.ts";
import { naturalVoiceId, type VoiceId } from "./readAloudVoices.ts";

// The silence a long pause makes in the natural voice, in seconds. The
// browser's voice can't be given silence, so for it a long pause is only the
// gap between two utterances.
const LONG_PAUSE_SECONDS = 0.7;

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

// How long a step waits for a downloaded natural voice to load from the cache
// before the browser's voice reads it instead. Loading takes about two seconds
// on a Mac, most of it compiling the model for the GPU.
const CACHED_WAIT_MS = 5000;

/**
 * How the natural voice's load is going: "idle" before anything has been
 * spoken, "loading" during the download (`cached` when it is only coming out
 * of the cache), "ready", or "failed" with a `reason`: "load" for a download
 * that failed (`retry` says whether a later step will try again) or "read" for
 * a model that loaded but kept failing to read.
 */
export type VoiceLoad =
  | { status: "idle" }
  | { status: "loading"; cached: boolean }
  | { status: "ready" }
  | { status: "failed"; reason: "load"; retry: boolean }
  | { status: "failed"; reason: "read" };

/** The reader's preferences, as the page holds them. */
export interface SpeechSettings {
  /**
   * The stored voice choice: a browser voice's voiceURI, a natural voice's
   * (see naturalVoiceURI), or "" for the browser's default.
   */
  voiceURI: string;
  /**
   * The natural voice to read with: the one `voiceURI` names, once the device
   * check has passed, and null until then or for a browser voice. A stored
   * choice from before a connection turned metered stays stored, but the
   * browser's voice reads until the check passes again.
   */
  naturalId: VoiceId | null;
  /** 1 is the voice's normal pace. */
  rate: number;
  /** Whether speech is on at all. Decides whether a chosen natural voice loads ahead of time. */
  enabled: boolean;
}

export interface SpeechPlayerState {
  speaking: boolean;
  load: VoiceLoad;
}

export interface SpeechPlayer extends ReadableStore<SpeechPlayerState> {
  /** The reader's preferences now. Any subset; the rest stay as they were. */
  configure(settings: Partial<SpeechSettings>): void;
  /** Say this, in the chosen voice, stopping whatever was being said. */
  speak(script: SpeechScript): void;
  /** Make the start of `script` ahead of time, for the natural voice. */
  prepare(script: SpeechScript): void;
  /** Silence both voices, including what was already queued. */
  stop(): void;
  /** Leaving the page: stop, and let the audio context go. */
  dispose(): void;
  /**
   * The download's progress, 0 to 1, in its own store: it changes a hundred
   * times during a download, and only the one line that shows it should
   * render for that.
   */
  readonly progress: ReadableStore<number>;
}

// The browser's own synthesizer, where there is one.
function synth(): SpeechSynthesis | null {
  return typeof speechSynthesis === "undefined" ? null : speechSynthesis;
}

export function createSpeechPlayer(
  initial: Partial<SpeechSettings> = {},
): SpeechPlayer {
  const store = createStore<SpeechPlayerState>({
    speaking: false,
    load: { status: "idle" },
  });
  const progress = createValueStore(0);

  let settings: SpeechSettings = {
    voiceURI: "",
    naturalId: null,
    rate: 1,
    enabled: false,
    ...initial,
  };

  let reader: ReadAloudReader | null = null;
  const natural = {
    // The load in progress, resolving to whether it worked, or null.
    loading: null as Promise<boolean> | null,
    // Whether the model is in the cache, asked once a visit (see isCached),
    // and the answer once there is one.
    inCache: null as Promise<boolean> | null,
    cached: false,
    // Set once a load from the cache has failed or overrun CACHED_WAIT_MS, so
    // later steps don't wait for it again.
    noWait: false,
    attempts: 0,
    readFailures: 0,
    brokenForVisit: false,
  };

  // The utterances (or clips) we queued, so `stop()` can tell "the user
  // cancelled" apart from "it finished on its own". A cancel fires `onend` for
  // every queued utterance, and without this the speaking flag flickers.
  let generation = 0;
  // Whether anything has been spoken yet (see maybePreload).
  let spoken = false;
  // The preload in flight, so settings that change under it cancel it.
  let preloadSeq = 0;

  // The natural voice's audio: one context for the page, the sources playing
  // now, made clips by text, the step waiting to be prepared, and which speak
  // (by generation) is making its chunks now, if any.
  const audio = {
    context: null as AudioContext | null,
    sources: [] as AudioBufferSourceNode[],
    clips: new Map<string, Promise<ReadAloudAudio>>(),
    pending: null as {
      script: SpeechScript;
      voice: VoiceId;
      speed: number;
    } | null,
    busy: null as number | null,
  };

  const setSpeaking = (speaking: boolean) => store.patch({ speaking });
  const setLoad = (load: VoiceLoad) => store.patch({ load });

  function stopClips() {
    for (const source of audio.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped, or never started; either way it's silent.
      }
    }
    audio.sources = [];
  }

  // Whether the model is already downloaded. Cache Storage only, so it answers
  // in a moment, without waiting on the GPU. Asked once a visit: a download
  // that finishes later sets the reader, which every caller checks first.
  function isCached() {
    natural.inCache ??= readAloudCached().then((cached) => {
      natural.cached = cached;
      return cached;
    });
    return natural.inCache;
  }

  // Start (or retry) the load, resolving to whether the voice is loaded. Never
  // runs twice at once (a second call gets the load in progress), gives up
  // after MAX_LOAD_ATTEMPTS, and asks the device check again first, so a
  // connection that has turned metered since the page loaded doesn't start a
  // download. Loading a model that's already downloaded is allowed on one.
  function startLoad(): Promise<boolean> {
    if (reader) return Promise.resolve(true);
    if (natural.loading) return natural.loading;
    if (natural.brokenForVisit || natural.attempts >= MAX_LOAD_ATTEMPTS) {
      return Promise.resolve(false);
    }
    natural.attempts += 1;
    progress.set(0);
    const { cached } = natural;
    setLoad({ status: "loading", cached });
    natural.loading = readAloudPossible({ download: !cached })
      .then((possible) => {
        if (!possible) {
          throw new Error("This device can't load the natural voice now.");
        }
        return loadReadAloud({
          // Whole percents only; nobody reads a finer gauge.
          onDownloadProgress: (fraction) =>
            progress.set(Math.floor(fraction * 100) / 100),
        });
      })
      .then((loaded) => {
        reader = loaded;
        setLoad({ status: "ready" });
        return true;
      })
      .catch((err) => {
        console.error("The natural voice couldn't load.", err);
        setLoad({
          status: "failed",
          reason: "load",
          retry: natural.attempts < MAX_LOAD_ATTEMPTS,
        });
        return false;
      })
      .finally(() => {
        natural.loading = null;
      });
    return natural.loading;
  }

  // Load a chosen natural voice ahead of being asked to speak. A downloaded
  // voice is loaded straight away, so the first step can use it. One that
  // isn't downloaded waits for something to be spoken, and this covers the
  // device check answering late: interactive mode speaks its first step the
  // moment it opens, which can be before the check has answered, and this
  // starts the download as soon as the answer comes (through `configure`)
  // rather than waiting for the next step to ask. Only while speech is on:
  // choosing a natural voice with speech off, or turning speech off before
  // the answer comes, loads nothing.
  function maybePreload() {
    const { naturalId, enabled } = settings;
    if (!naturalId || !enabled || store.getSnapshot().load.status !== "idle") {
      return;
    }
    const mine = ++preloadSeq;
    isCached().then((cached) => {
      if (mine !== preloadSeq) return;
      if (store.getSnapshot().load.status !== "idle") return;
      if (cached || spoken) startLoad();
    });
  }

  // A chunk's audio, made once per voice, pace and runs. Only ever called with
  // a loaded reader.
  function clipFor(runs: SpokenRun[], voice: VoiceId, speed: number) {
    const { clips } = audio;
    const key = `${voice}|${speed}|${speechKey(runs)}`;
    let clip = clips.get(key);
    if (!clip) {
      clip = reader!.synthesize(runs, { voice, speed });
      // A failed chunk is not kept, so asking again tries again.
      clip.catch(() => clips.delete(key));
      clips.set(key, clip);
      if (clips.size > MAX_CACHED_CLIPS) {
        clips.delete(clips.keys().next().value!);
      }
    }
    return clip;
  }

  // Make the waiting step's opening chunks, unless a step is being made now,
  // in which case that step's speak runs this when it's done.
  function runPending() {
    if (audio.busy !== null || !audio.pending || !reader) return;
    const { script, voice, speed } = audio.pending;
    audio.pending = null;
    const make = (chunks: SpeechChunk[]) => {
      for (const chunk of chunks.slice(0, PREPARED_CHUNKS)) {
        clipFor(chunk.runs, voice, speed).catch(() => {});
      }
    };
    const chunks = chunkSpeech(script);
    if (!hasFormulaSpeech(chunks)) {
      make(chunks);
      return;
    }
    // A formula's words come first. If a step started being made meanwhile,
    // this one waits for it again, unless a newer step has taken its place.
    withFormulaSpeech(chunks, formulaWords).then((said) => {
      if (audio.busy === null) make(said);
      else audio.pending ??= { script, voice, speed };
    });
  }

  function speakBrowser(chunks: SpeechChunk[], mine: number) {
    const engine = synth();
    if (!engine) return;
    // `cancel()` isn't synchronous in Chromium, so speaking in the same tick
    // can be swallowed by the cancellation that's still settling.
    setTimeout(() => {
      if (generation !== mine) return;
      const voice = (engine.getVoices() || []).find(
        (candidate) => candidate.voiceURI === settings.voiceURI,
      );
      chunks.forEach((chunk, index) => {
        const utterance = new SpeechSynthesisUtterance(
          spokenForBrowser(chunk.runs),
        );
        if (voice) {
          utterance.voice = voice;
          // Some engines ignore `voice` unless the language agrees with it.
          utterance.lang = voice.lang;
        }
        utterance.rate = settings.rate;
        if (index === chunks.length - 1) {
          // Only the last chunk ends the run. A cancel bumps the generation,
          // so the stale utterances it flushes don't clear a newer run's flag.
          const finish = () => {
            if (generation === mine) setSpeaking(false);
          };
          utterance.onend = finish;
          utterance.onerror = finish;
        } else {
          utterance.onerror = () => {
            if (generation === mine) setSpeaking(false);
          };
        }
        engine.speak(utterance);
      });
      setSpeaking(true);
    }, 0);
  }

  async function speakNatural(
    chunks: SpeechChunk[],
    mine: number,
    voice: VoiceId,
  ) {
    // Claimed before the first await, so a prepare() made in the same tick
    // (the walkthrough asks for the next step straight after this one) waits
    // for this step instead of queueing ahead of it. Claimed by generation,
    // so a cancelled speak finishing late can't release a newer one's claim.
    audio.busy = mine;
    setSpeaking(true);
    const speed = settings.rate;
    let queuedUntil = 0;
    let next = 0;
    try {
      audio.context ??= new AudioContext();
      const context = audio.context;
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
      if (generation !== mine) return;
      if (context.state !== "running") {
        speakBrowser(chunks, mine);
        return;
      }

      try {
        for (const [index, chunk] of chunks.entries()) {
          const { audio: samples, sampleRate } = await clipFor(
            chunk.runs,
            voice,
            speed,
          );
          if (generation !== mine) return;
          const buffer = context.createBuffer(1, samples.length, sampleRate);
          // The engine makes each clip over its own buffer, never shared
          // memory, which is all the narrower type is asking.
          buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          const startAt = Math.max(context.currentTime, queuedUntil);
          source.start(startAt);
          queuedUntil =
            startAt +
            buffer.duration +
            (chunk.pauseAfter ? LONG_PAUSE_SECONDS : 0);
          next = index + 1;
          audio.sources.push(source);
          if (index === chunks.length - 1) {
            source.onended = () => {
              if (generation === mine) setSpeaking(false);
            };
          }
        }
        natural.readFailures = 0;
      } catch (err) {
        // The model couldn't make a chunk. What was already queued plays
        // out, then the browser's voice reads from the chunk that failed.
        console.error("The natural voice couldn't read this.", err);
        if (generation !== mine) return;
        natural.readFailures += 1;
        if (natural.readFailures >= MAX_READ_FAILURES) {
          natural.brokenForVisit = true;
          setLoad({ status: "failed", reason: "read" });
        }
        const rest = chunks.slice(next);
        const wait = Math.max(0, (queuedUntil - context.currentTime) * 1000);
        setTimeout(() => {
          if (generation === mine) speakBrowser(rest, mine);
        }, wait);
      }
    } finally {
      if (audio.busy === mine) audio.busy = null;
      runPending();
    }
  }

  function stop() {
    generation += 1;
    synth()?.cancel();
    stopClips();
    setSpeaking(false);
  }

  function speak(script: SpeechScript) {
    const engine = synth();
    if (!engine) return;
    const raw = chunkSpeech(script);
    if (raw.length === 0) return;

    generation += 1;
    const mine = generation;
    engine.cancel();
    stopClips();
    spoken = true;

    const { naturalId } = settings;
    // Whether a natural voice is wanted, by the stored choice rather than
    // naturalId, since the device check may not have answered yet (startLoad
    // asks it too).
    const wantsNatural =
      Boolean(naturalVoiceId(settings.voiceURI)) && !natural.brokenForVisit;
    // Web Audio is started now, while the click that asked for this step
    // still counts, since a browser may not let it start once a wait (for
    // the voice to load, or for a formula's words) is over. Not when the
    // model is known not to be downloaded, where the browser's voice is
    // going to read.
    const startAudio = () => {
      if (natural.inCache === null || natural.cached || reader) {
        audio.context ??= new AudioContext();
        audio.context.resume().catch(() => {});
      }
    };

    const start = (chunks: SpeechChunk[]) => {
      if (naturalId && reader && !natural.brokenForVisit) {
        speakNatural(chunks, mine, naturalId);
        return;
      }
      if (!wantsNatural) {
        speakBrowser(chunks, mine);
        return;
      }
      setSpeaking(true);
      startAudio();
      // The wait is counted from here, so nothing before it can stretch it.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), CACHED_WAIT_MS);
      });
      isCached()
        .then((cached) => {
          // Not downloaded, or a load from the cache that already failed or
          // ran long: the browser's voice reads at once, with one load
          // attempt per step behind it. A download needs the device check
          // to have passed; if it answers only now, maybePreload starts it
          // instead.
          if (!cached || natural.noWait) {
            if (cached || naturalId) startLoad();
            return false;
          }
          return Promise.race([startLoad(), deadline]).then((ready) => {
            if (!ready) natural.noWait = true;
            return ready;
          });
        })
        .then((ready) => {
          if (generation !== mine) return;
          // Read in the voice chosen now: it may have changed while waiting.
          const chosen = naturalVoiceId(settings.voiceURI);
          if (ready && chosen) speakNatural(chunks, mine, chosen);
          else speakBrowser(chunks, mine);
        })
        .finally(() => clearTimeout(timer));
    };

    if (!hasFormulaSpeech(raw)) {
      start(raw);
      return;
    }
    // A step with a formula waits for its words first. Speaking is shown as
    // under way meanwhile, and Web Audio is started while the click counts.
    setSpeaking(true);
    if (wantsNatural) startAudio();
    withFormulaSpeech(raw, formulaWords).then((chunks) => {
      if (generation === mine) start(chunks);
    });
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    progress,
    speak,
    stop,

    configure(next) {
      settings = { ...settings, ...next };
      preloadSeq += 1;
      maybePreload();
    },

    // Only the latest request is kept: the learner can only move on to one
    // step.
    prepare(script) {
      const { naturalId, rate } = settings;
      if (!naturalId || !reader || natural.brokenForVisit) return;
      audio.pending = { script, voice: naturalId, speed: rate };
      runPending();
    },

    // Leaving the page mid-sentence should not leave a voice talking over
    // whatever the reader does next: speechSynthesis is global to the tab and
    // outlives the page. The generation bump is what makes the cancel stick:
    // a `speak` still waiting out the tick it defers by would otherwise queue
    // its utterances after this, and carry on talking into a page that no
    // longer has any way to stop it.
    dispose() {
      stop();
      preloadSeq += 1;
      audio.context?.close().catch(() => {});
      audio.context = null;
    },
  };
}
