// The player, with the browser's voice, Web Audio and the Kokoro door stood
// in for. A natural voice chosen on an earlier visit has to be the one that
// reads, without being picked again in practice mode. Once it's downloaded,
// it loads as soon as speech is on and the first step waits for it; before
// that, the browser's voice reads while it downloads.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadAloudReader } from "./readAloudEngine.ts";
import type { SpeechPlayer } from "./speechPlayer.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let possible: ReturnType<typeof deferred<boolean>>;
let cached: boolean;
let load: ReturnType<typeof deferred<ReadAloudReader>>;
vi.mock("./readAloud.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./readAloud.ts")>()),
  readAloudPossible: vi.fn(() => possible.promise),
  readAloudCached: vi.fn(() => Promise.resolve(cached)),
  loadReadAloud: vi.fn(() => load.promise),
}));

const { loadReadAloud } = await import("./readAloud.ts");
const { createSpeechPlayer } = await import("./speechPlayer.ts");

// Just enough Web Audio to queue a clip and say it was played.
const played: string[] = [];
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  createBuffer(_channels: number, length: number) {
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
    tokens: 1,
  })),
} as unknown as ReadAloudReader;

const synth = {
  getVoices: () => [],
  cancel: vi.fn(),
  speak() {
    played.push("browser");
  },
};

// Lets the speak deferred a tick by speakBrowser run, under real or fake
// timers.
const tick = () =>
  vi.isFakeTimers()
    ? vi.advanceTimersByTimeAsync(0)
    : new Promise((resolve) => setTimeout(resolve, 0));

/** A player as the walkthrough configures it, with a natural voice stored. */
function player(enabled = true): SpeechPlayer {
  const made = createSpeechPlayer();
  made.configure({
    voiceURI: "kokoro:af_heart",
    naturalId: null,
    rate: 1,
    enabled,
  });
  return made;
}

/** The device check answers yes, and the page tells the player the voice is on offer. */
async function deviceCheckPasses(made: SpeechPlayer) {
  possible.resolve(true);
  await tick();
  made.configure({ naturalId: "af_heart" });
  await tick();
}

describe("a player with a stored natural voice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    played.length = 0;
    possible = deferred();
    load = deferred();
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads a downloaded voice straight away and reads the first step with it", async () => {
    cached = true;
    const made = player();
    // Speaks before the device check has even answered, as practice mode
    // does when it opens.
    made.speak("Hello there.");
    await tick();
    await deviceCheckPasses(made);
    expect(loadReadAloud).toHaveBeenCalledTimes(1);
    expect(made.getSnapshot()).toMatchObject({
      speaking: true,
      load: { status: "loading", cached: true },
    });

    load.resolve(reader);
    await tick();
    await tick();
    expect(played).toEqual(["natural"]);
    expect(made.getSnapshot().load).toEqual({ status: "ready" });
  });

  it("reads with the browser's voice when a downloaded voice is slow to load, then the natural one", async () => {
    vi.useFakeTimers();
    cached = true;
    const made = player();
    await deviceCheckPasses(made);
    made.speak("Hello there.");
    await vi.advanceTimersByTimeAsync(4900);
    expect(played).toEqual([]);

    await vi.advanceTimersByTimeAsync(200);
    expect(played).toEqual(["browser"]);

    load.resolve(reader);
    await vi.advanceTimersByTimeAsync(0);
    made.speak("And now.");
    await vi.advanceTimersByTimeAsync(0);
    expect(played).toEqual(["browser", "natural"]);
    expect(loadReadAloud).toHaveBeenCalledTimes(1);
  });

  it("tries a downloaded voice that failed to load once a step, without waiting again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cached = true;
    const made = player();
    await deviceCheckPasses(made);
    made.speak("Hello there.");
    await tick();
    load.reject(new Error("no GPU"));
    await tick();
    await tick();
    expect(played).toEqual(["browser"]);
    expect(loadReadAloud).toHaveBeenCalledTimes(1);
    expect(made.getSnapshot().load).toEqual({
      status: "failed",
      reason: "load",
      retry: true,
    });

    load = deferred();
    made.speak("And now.");
    await tick();
    await tick();
    expect(played).toEqual(["browser", "browser"]);
    expect(loadReadAloud).toHaveBeenCalledTimes(2);
    expect(made.getSnapshot().load).toEqual({
      status: "loading",
      cached: true,
    });
  });

  it("reads a waiting step in the voice chosen while it waited", async () => {
    cached = true;
    const made = player();
    await deviceCheckPasses(made);
    made.speak("Hello there.");
    await tick();
    made.configure({ voiceURI: "", naturalId: null });
    load.resolve(reader);
    await tick();
    await tick();
    expect(played).toEqual(["browser"]);
  });

  it("reads with the browser's voice while a voice that isn't downloaded yet downloads", async () => {
    cached = false;
    const made = player();
    await deviceCheckPasses(made);
    expect(loadReadAloud).not.toHaveBeenCalled();

    made.speak("Hello there.");
    await tick();
    await tick();
    expect(loadReadAloud).toHaveBeenCalledTimes(1);
    expect(made.getSnapshot().load).toEqual({
      status: "loading",
      cached: false,
    });
    expect(played).toEqual(["browser"]);
  });

  it("starts the download when the device check answers after the first step", async () => {
    cached = false;
    const made = player();
    made.speak("Hello there.");
    await tick();
    expect(loadReadAloud).not.toHaveBeenCalled();

    await deviceCheckPasses(made);
    await tick();
    expect(loadReadAloud).toHaveBeenCalledTimes(1);
    expect(played).toEqual(["browser"]);
  });

  it("downloads nothing with speech off", async () => {
    cached = true;
    const made = player(false);
    await deviceCheckPasses(made);
    await tick();
    expect(loadReadAloud).not.toHaveBeenCalled();
    expect(made.getSnapshot().load).toEqual({ status: "idle" });
  });

  it("shows the download's progress in its own store", async () => {
    cached = false;
    const made = player();
    await deviceCheckPasses(made);
    const seen: number[] = [];
    made.progress.subscribe(() => seen.push(made.progress.getSnapshot()));
    made.speak("Hello there.");
    await tick();
    await tick();

    const options = vi.mocked(loadReadAloud).mock.calls[0][0]!;
    options.onDownloadProgress!(0.123);
    options.onDownloadProgress!(0.126);
    options.onDownloadProgress!(0.5);
    expect(seen).toEqual([0.12, 0.5]);
  });

  it("silences both voices on stop, and the step after starts fresh", async () => {
    cached = false;
    const made = player();
    made.configure({ voiceURI: "", naturalId: null });
    made.speak("Hello there.");
    await tick();
    expect(played).toEqual(["browser"]);
    expect(made.getSnapshot().speaking).toBe(true);

    made.stop();
    expect(synth.cancel).toHaveBeenCalled();
    expect(made.getSnapshot().speaking).toBe(false);

    made.speak("Again.");
    await tick();
    expect(played).toEqual(["browser", "browser"]);
    made.dispose();
    expect(made.getSnapshot().speaking).toBe(false);
  });

  it("says nothing where the browser can't speak", async () => {
    vi.stubGlobal("speechSynthesis", undefined);
    const made = player();
    made.configure({ voiceURI: "", naturalId: null });
    made.speak("Hello there.");
    await tick();
    expect(played).toEqual([]);
    expect(made.getSnapshot().speaking).toBe(false);
  });
});
