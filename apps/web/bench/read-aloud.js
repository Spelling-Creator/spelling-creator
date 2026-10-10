// Times Kokoro on the device that opens this page. See read-aloud.html.
//
// The numbers that decide whether Kokoro can replace speechSynthesis:
//
//   First audio: from pressing play on a step to hearing it, once the model is
//   loaded. Only the first chunk has to be ready for that; the rest are made
//   while it plays.
//   Stalls: how long the voice would go quiet mid-step because the next chunk
//   wasn't ready when the last one ended. Worked out from the measured times,
//   as if each chunk started playing the moment it was ready and the one before
//   it had finished.
//   RTF (real-time factor): time to make a chunk over how long it speaks for.
//   Under 1 keeps ahead of playback.

import {
  loadReadAloud,
  VOICES,
  DEFAULT_VOICE,
} from "@spelling-creator/core/browser/readAloud";
import fixture from "./read-aloud-text.json";

const $ = (id) => document.getElementById(id);

const results = { env: {}, runs: [] };
let lastAudio = [];

function addRow(list, term, value) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  list.append(dt, dd);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round = (n, places = 0) => Number(n.toFixed(places));

async function describeDevice() {
  const info = {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: navigator.deviceMemory ?? null,
    crossOriginIsolated: globalThis.crossOriginIsolated ?? false,
    webgpu: false,
  };
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        info.webgpu = true;
        info.gpu = [
          adapter.info?.vendor,
          adapter.info?.architecture,
          adapter.info?.description,
        ]
          .filter(Boolean)
          .join(" ");
        info.shaderF16 = adapter.features.has("shader-f16");
        info.maxBufferMB = round(adapter.limits.maxBufferSize / 2 ** 20);
      }
    } catch {
      // No adapter is the same answer as no navigator.gpu.
    }
  }
  results.env = info;

  const list = $("env");
  addRow(list, "Browser", info.userAgent);
  addRow(list, "CPU threads", String(info.hardwareConcurrency ?? "unknown"));
  addRow(
    list,
    "Memory",
    info.deviceMemory ? `${info.deviceMemory} GB or more` : "not reported",
  );
  addRow(
    list,
    "WebGPU",
    info.webgpu ? `yes, ${info.gpu || "unnamed adapter"}` : "no",
  );
  if (info.webgpu) {
    addRow(list, "shader-f16", info.shaderF16 ? "yes" : "no");
    addRow(list, "Max buffer", `${info.maxBufferMB} MB`);
  }
  addRow(
    list,
    "Cross-origin isolated",
    info.crossOriginIsolated
      ? "yes (multithreaded WASM)"
      : "no (single-threaded WASM, as in production)",
  );

  if (!info.webgpu) $("device").value = "wasm";
  syncDtype();
}

// What kokoro.js recommends for each device, as the starting choice.
function syncDtype() {
  $("dtype").value = $("device").value === "webgpu" ? "fp32" : "q8";
}

function fillVoices() {
  for (const [id, { name, lang }] of Object.entries(VOICES)) {
    const option = new Option(`${name} (${lang})`, id);
    $("voice").append(option);
  }
  $("voice").value = DEFAULT_VOICE;
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").className = isError ? "error" : "";
}

function renderSummary(run) {
  const list = $("summary");
  list.replaceChildren();
  addRow(
    list,
    "Setup",
    `${run.device}, ${run.dtype}, ${VOICES[run.voice].name}`,
  );
  addRow(
    list,
    "Model load",
    `${run.loadMs} ms${run.downloaded ? " (included the download)" : ""}`,
  );
  addRow(list, "First audio", `${run.firstAudioMs} ms`);
  addRow(list, "Median RTF", String(run.medianRtf));
  addRow(list, "Worst RTF", String(run.worstRtf));
  addRow(
    list,
    "Stalls",
    run.stallMs === 0
      ? "none: every chunk was ready before the one before it finished"
      : `${run.stallMs} ms of silence across ${run.stalls} gap${run.stalls === 1 ? "" : "s"}`,
  );
  addRow(
    list,
    "Speech made",
    `${run.speechS} s in ${round(run.totalAudioMs / 1000, 1)} s`,
  );
}

function renderRows(chunks) {
  const rows = chunks.map((chunk, index) => {
    const tr = document.createElement("tr");
    const cells = [
      [index + 1, "num"],
      [chunk.text, ""],
      [chunk.tokens, "num"],
      [chunk.phonemesMs, "num"],
      [chunk.audioMs, "num"],
      [chunk.speechS, "num"],
      [chunk.rtf, "num"],
    ];
    for (const [value, className] of cells) {
      const td = document.createElement("td");
      td.textContent = String(value);
      if (className) td.className = className;
      tr.append(td);
    }
    const td = document.createElement("td");
    const button = document.createElement("button");
    button.textContent = "Play";
    button.addEventListener("click", () => play([lastAudio[index]]));
    td.append(button);
    tr.append(td);
    return tr;
  });
  $("rows").replaceChildren(...rows);
}

let context = null;
let playing = [];

function play(clips) {
  context ??= new AudioContext();
  for (const source of playing) source.stop();
  playing = [];
  let at = context.currentTime + 0.05;
  for (const { audio, sampleRate } of clips) {
    const buffer = context.createBuffer(1, audio.length, sampleRate);
    buffer.copyToChannel(audio, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(at);
    at += buffer.duration;
    playing.push(source);
  }
}

async function run() {
  const device = $("device").value;
  const dtype = $("dtype").value;
  const voice = $("voice").value;
  for (const control of $("controls").querySelectorAll("select, button")) {
    control.disabled = true;
  }
  const progress = $("progress");
  let downloaded = false;

  try {
    setStatus("Loading the model...");
    const loadStart = performance.now();
    const reader = await loadReadAloud({
      device,
      dtype,
      onDownloadProgress: (fraction) => {
        downloaded = true;
        progress.hidden = false;
        progress.value = fraction;
      },
    });
    const loadMs = round(performance.now() - loadStart);
    progress.hidden = true;

    // Chunks are made one after another from a single start time, the way a
    // step would be read, so the playback timeline below is a fair one.
    const chunks = [];
    lastAudio = [];
    const texts = fixture.steps.flat();
    const runStart = performance.now();
    for (const [index, text] of texts.entries()) {
      setStatus(`Reading chunk ${index + 1} of ${texts.length}...`);
      const t0 = performance.now();
      const phonemes = reader.toPhonemes(text, { voice });
      const t1 = performance.now();
      const { audio, sampleRate, tokens } = await reader.fromPhonemes(
        phonemes,
        { voice },
      );
      const t2 = performance.now();
      const speechMs = (audio.length / sampleRate) * 1000;
      lastAudio.push({ audio, sampleRate });
      chunks.push({
        text,
        phonemes,
        tokens,
        phonemesMs: round(t1 - t0, 1),
        audioMs: round(t2 - t1),
        speechS: round(speechMs / 1000, 2),
        rtf: round((t2 - t1) / speechMs, 2),
        readyAt: t2 - runStart,
        speechMs,
      });
    }

    // Steps are spoken one at a time, so each step's first chunk starts the
    // moment it is ready, and only a wait inside a step counts as a stall:
    // a chunk that is ready after the one before it has finished playing.
    let stallMs = 0;
    let stalls = 0;
    let offset = 0;
    for (const step of fixture.steps) {
      const stepChunks = chunks.slice(offset, offset + step.length);
      let playedUntil = stepChunks[0].readyAt;
      for (const chunk of stepChunks) {
        if (chunk.readyAt > playedUntil) {
          if (chunk !== stepChunks[0]) {
            stallMs += chunk.readyAt - playedUntil;
            stalls += 1;
          }
          playedUntil = chunk.readyAt;
        }
        playedUntil += chunk.speechMs;
      }
      offset += step.length;
    }

    const rtfs = chunks.map((chunk) => chunk.rtf);
    const runResult = {
      device,
      dtype,
      voice,
      loadMs,
      downloaded,
      firstAudioMs: round(chunks[0].phonemesMs + chunks[0].audioMs),
      medianRtf: round(median(rtfs), 2),
      worstRtf: round(Math.max(...rtfs), 2),
      stallMs: round(stallMs),
      stalls,
      speechS: round(chunks.reduce((sum, c) => sum + c.speechMs, 0) / 1000, 1),
      totalAudioMs: round(chunks.reduce((sum, c) => sum + c.audioMs, 0)),
      // The timeline fields were only for working out the stalls.
      chunks: chunks.map(
        ({ text, phonemes, tokens, phonemesMs, audioMs, speechS, rtf }) => ({
          text,
          phonemes,
          tokens,
          phonemesMs,
          audioMs,
          speechS,
          rtf,
        }),
      ),
    };
    results.runs.push(runResult);

    renderSummary(runResult);
    renderRows(runResult.chunks);
    $("json").textContent = JSON.stringify(results, null, 2);
    setStatus("Done.");
  } catch (err) {
    progress.hidden = true;
    setStatus(err?.message || String(err), true);
    console.error(err);
  } finally {
    for (const control of $("controls").querySelectorAll("select, button")) {
      control.disabled = false;
    }
    $("play").disabled = lastAudio.length === 0;
    $("copy").disabled = results.runs.length === 0;
  }
}

$("device").addEventListener("change", syncDtype);
$("run").addEventListener("click", run);
$("play").addEventListener("click", () => play(lastAudio));
$("copy").addEventListener("click", async () => {
  const text = JSON.stringify(results, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied.");
  } catch {
    setStatus("Couldn't copy here. Select the results below instead.", true);
  }
});

fillVoices();
describeDevice();
