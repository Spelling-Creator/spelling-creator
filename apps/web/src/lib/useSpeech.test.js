// @vitest-environment happy-dom

// A natural voice chosen on an earlier visit has to be the one that reads,
// without being picked again in practice mode. Once it's downloaded, it loads
// as soon as speech is on and the first step waits for it; before that, the
// browser's voice reads while it downloads.

import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

let possible;
let cached;
let load;
vi.mock("@spelling-creator/core/browser/readAloud", () => ({
  VOICES: { af_heart: { name: "Heart", lang: "en-US" } },
  DOWNLOAD_MB: 330,
  readAloudPossible: vi.fn(() => possible.promise),
  readAloudCached: vi.fn(() => Promise.resolve(cached)),
  loadReadAloud: vi.fn(() => load.promise),
}));

const { loadReadAloud } =
  await import("@spelling-creator/core/browser/readAloud");
const { useSpeech } = await import("./useSpeech.js");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

// Just enough Web Audio to queue a clip and say it was played.
const played = [];
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  createBuffer(channels, length) {
    return { duration: length / 24000, copyToChannel() {} };
  }
  createBufferSource() {
    return {
      connect() {},
      start() {
        played.push("natural");
      },
      stop() {},
    };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

const reader = {
  synthesize: vi.fn(async () => ({
    audio: new Float32Array(24),
    sampleRate: 24000,
  })),
};

function mount() {
  const seen = { current: null };
  function Harness() {
    const speech = useSpeech();
    useEffect(() => {
      seen.current = speech;
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  return seen;
}

// Lets the speak deferred a tick by speakBrowser run.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useSpeech with a stored natural voice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    played.length = 0;
    possible = deferred();
    load = deferred();
    window.speechSynthesis = {
      getVoices: () => [],
      addEventListener() {},
      removeEventListener() {},
      cancel() {},
      speak() {
        played.push("browser");
      },
    };
    globalThis.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    globalThis.AudioContext = FakeAudioContext;
    localStorage.setItem("spelling-creator:tts-enabled", "true");
    localStorage.setItem("spelling-creator:tts-voice", "kokoro:af_heart");
  });

  it("loads a downloaded voice straight away and reads the first step with it", async () => {
    cached = true;
    const speech = mount();
    // Speaks before the device check has even answered, as practice mode
    // does when it opens.
    await act(async () => speech.current.speak("Hello there."));
    await act(async () => possible.resolve(true));
    expect(loadReadAloud).toHaveBeenCalledTimes(1);
    expect(speech.current.voiceLoad).toMatchObject({
      status: "loading",
      cached: true,
    });

    await act(async () => load.resolve(reader));
    await act(tick);
    expect(played).toEqual(["natural"]);
  });

  it("reads with the browser's voice while a voice that isn't downloaded yet downloads", async () => {
    cached = false;
    const speech = mount();
    await act(async () => possible.resolve(true));
    expect(loadReadAloud).not.toHaveBeenCalled();

    await act(async () => speech.current.speak("Hello there."));
    await act(tick);
    expect(loadReadAloud).toHaveBeenCalledTimes(1);
    expect(speech.current.voiceLoad).toMatchObject({
      status: "loading",
      cached: false,
    });
    expect(played).toEqual(["browser"]);
  });

  it("starts the download when the device check answers after the first step", async () => {
    cached = false;
    const speech = mount();
    await act(async () => speech.current.speak("Hello there."));
    expect(loadReadAloud).not.toHaveBeenCalled();

    await act(async () => possible.resolve(true));
    await act(tick);
    expect(loadReadAloud).toHaveBeenCalledTimes(1);
    expect(played).toEqual(["browser"]);
  });

  it("downloads nothing with speech off", async () => {
    cached = true;
    localStorage.setItem("spelling-creator:tts-enabled", "false");
    mount();
    await act(async () => possible.resolve(true));
    expect(loadReadAloud).not.toHaveBeenCalled();
  });
});
