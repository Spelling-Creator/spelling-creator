// "Summarise this lesson" card on the lesson page, powered by on-device AI
// (see @spelling-creator/core/browser/summarizer): the browser's built-in
// Summarizer API where it exists, otherwise LFM2.5 running in the page with
// transformers.js on browsers whose WebGPU can carry it. Either way the model
// runs on the reader's own device: no Worker call, no Turnstile, no cost, and
// the lesson text never leaves the machine.
//
// Both engines are gated behind hardware minimums, so the card is strictly
// opt-in on capability: we probe availability once on mount and render
// NOTHING (no button, no "unsupported" notice) unless this device can
// actually summarise. A reader on an old laptop never learns the feature
// exists, which is better than showing them a button that can't work.
//
// Creating a built-in session needs transient activation, and the fallback's
// model download is far too heavy to start uninvited, so summarising is
// always driven by the button click, never by an effect. The probe also says
// which engine would answer, so the copy around the button can be honest
// about the fallback's much larger one-time download.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SparklesIcon, CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "./ui/button.jsx";
import { Badge } from "./ui/badge.jsx";
import { Alert, AlertDescription } from "./ui/alert.jsx";
import { Progress } from "./ui/progress.jsx";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip.jsx";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select.jsx";
import { cn } from "../lib/utils.js";
import { SummarySkeleton } from "./Skeletons.jsx";
import {
  DEFAULT_SUMMARY_LENGTH,
  DEFAULT_SUMMARY_TYPE,
  MIN_SUMMARY_CHARS,
  SUMMARY_LENGTHS,
  SUMMARY_TYPES,
  createSummarizer,
  fitToQuota,
  lessonSummaryText,
  summarizeStream,
  summarizerAvailability,
  summarizerErrorMessage,
} from "@spelling-creator/core/browser/summarizer";

// Bold/italic runs inside one line of the model's markdown.
const INLINE_MARKDOWN = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function renderInline(text) {
  const nodes = [];
  let last = 0;
  let match;
  INLINE_MARKDOWN.lastIndex = 0;
  while ((match = INLINE_MARKDOWN.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1]) nodes.push(<strong key={match.index}>{match[1]}</strong>);
    else nodes.push(<em key={match.index}>{match[2]}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// The summary is requested as markdown, and "key points" comes back as a bullet
// list. Rather than pull in a markdown library for the handful of constructs a
// summary can contain, render the subset we actually get — bullets, headings,
// paragraphs, bold/italic — and let anything else fall through as plain text. That
// also means a model that ignores `format` and returns plain prose still renders
// correctly.
function SummaryMarkdown({ text }) {
  const nodes = [];
  let bullets = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="my-1 pl-6 [&>li]:mb-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm">
            {renderInline(item)}
          </li>
        ))}
      </ul>,
    );
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushBullets();
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }

    flushBullets();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    nodes.push(
      heading ? (
        <p key={nodes.length} className="mt-2 mb-1 text-sm font-medium">
          {renderInline(heading[1])}
        </p>
      ) : (
        <p key={nodes.length} className="mb-2 text-sm">
          {renderInline(line)}
        </p>
      ),
    );
  }
  flushBullets();

  return nodes;
}

export default function LessonSummary({ doc }) {
  const { t } = useTranslation("lesson");
  const [type, setType] = useState(DEFAULT_SUMMARY_TYPE);
  const [length, setLength] = useState(DEFAULT_SUMMARY_LENGTH);

  // Starts "unavailable" so the card is hidden until the probe says otherwise —
  // it fades in when supported rather than flashing in and disappearing when not.
  const [availability, setAvailability] = useState("unavailable");

  // Which engine answers: "browser" (built-in Summarizer API) or "lfm" (the
  // transformers.js fallback). Set by the probe, then kept honest by the run
  // itself through createSummarizer's onEngine hook, because the built-in
  // engine can agree to a probe and still refuse the create.
  const [engine, setEngine] = useState(null);

  // "idle" → "downloading" (first run only) → "summarizing" → "done".
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const abortRef = useRef(null);
  const sessionRef = useRef(null);

  const text = useMemo(() => lessonSummaryText(doc), [doc]);
  const worthSummarizing = text.length >= MIN_SUMMARY_CHARS;

  // Probe once, with the default options. Availability turns on the browser and
  // its hardware, not on the type/length the reader picks, so re-probing on every
  // dropdown change would only risk yanking the card out from under them; if a
  // particular combination really is unsupported, create() throws and we say so.
  useEffect(() => {
    if (!worthSummarizing) return;
    let cancelled = false;
    (async () => {
      const probe = await summarizerAvailability({
        type: DEFAULT_SUMMARY_TYPE,
        length: DEFAULT_SUMMARY_LENGTH,
      });
      if (cancelled) return;
      setAvailability(probe.availability);
      setEngine(probe.engine);
    })();
    return () => {
      cancelled = true;
    };
  }, [worthSummarizing]);

  // Drop any in-flight run and free the model session when we leave the page.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      sessionRef.current?.destroy();
    },
    [],
  );

  const running = phase === "downloading" || phase === "summarizing";

  const summarize = async () => {
    // Supersede whatever was running, and free the previous session — each run
    // gets a session built for its own type/length.
    abortRef.current?.abort();
    sessionRef.current?.destroy();
    sessionRef.current = null;

    const controller = new AbortController();
    abortRef.current = controller;

    // Whether the reader has seen the fallback's 760 MB warning: the idle
    // notice and the progress line both carry it whenever the engine on
    // record is LFM. A run that only discovers LFM mid-flight (see
    // onEngine below) must not start that download behind wording about the
    // built-in engine.
    const warnedOfLfm = engine === "lfm";

    setError("");
    setSummary("");
    setTruncated(false);
    setProgress(0);
    // A first run on a machine that hasn't got the model yet downloads it; say so
    // up front, because that wait is much longer than the summary itself.
    setPhase(availability === "available" ? "summarizing" : "downloading");

    try {
      const session = await createSummarizer(
        // The text too, so the built-in engine can answer in the lesson's
        // own language.
        { type, length, text },
        {
          signal: controller.signal,
          onDownloadProgress: (loaded) => setProgress(loaded),
          // The engine the run actually opens, reported before it does any
          // heavy work. The case that matters: the built-in engine passed
          // the probe but refused the create, and the next engine in line is
          // LFM, whose first run is a 760 MB download nobody should trigger
          // unwarned. If the reader hasn't seen the LFM notice, stop the
          // run here (createSummarizer checks the signal before the download
          // starts) and re-offer the button with the honest wording, so the
          // next click is an informed one.
          onEngine: (nextEngine) => {
            if (nextEngine === "lfm" && !warnedOfLfm) {
              controller.abort();
              setEngine("lfm");
              setAvailability("downloadable");
              setPhase("idle");
              return;
            }
            setEngine(nextEngine);
            if (nextEngine === "lfm") {
              // The fallback's first run downloads, so the progress bar
              // (with the LFM wording) is what belongs on screen, not the
              // summarising skeleton.
              setProgress(0);
              setPhase("downloading");
            }
          },
        },
      );
      if (controller.signal.aborted) {
        session.destroy();
        return;
      }
      sessionRef.current = session;
      // The session knows which engine it really is; a built-in session
      // carries no engine property.
      setEngine(session.engine || "browser");
      setPhase("summarizing");

      // A long lesson can overrun the model's input budget; trim it rather than
      // fail, and tell the reader below when we did.
      const { text: input, truncated: wasCut } = await fitToQuota(
        session,
        text,
      );
      if (controller.signal.aborted) return;
      setTruncated(wasCut);

      let out = "";
      for await (const chunk of summarizeStream(session, input, {
        signal: controller.signal,
      })) {
        out += chunk;
        setSummary(out);
      }
      if (controller.signal.aborted) return;
      setPhase("done");
      // The model is downloaded now, so a re-run goes straight to summarising.
      setAvailability("available");
    } catch (err) {
      // An abort is us superseding or unmounting the run, not a failure.
      if (controller.signal.aborted || err?.name === "AbortError") return;
      setError(summarizerErrorMessage(err));
      setPhase("idle");
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setPhase("idle");
  };

  // Changing the shape of the summary invalidates the one on screen, so clear it
  // and let the reader ask again — the button is also what gives us the transient
  // activation the next create() needs.
  const changeOption = (setter) => (value) => {
    abortRef.current?.abort();
    setter(value);
    setSummary("");
    setError("");
    setPhase("idle");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the text is selectable on screen anyway */
    }
  };

  if (!worthSummarizing || availability === "unavailable") return null;

  return (
    <div className="mb-4 rounded-md border border-border p-3">
      <div
        className={cn(
          "flex flex-col gap-2 sm:flex-row sm:items-center",
          (summary || running || error) && "mb-3",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SparklesIcon className="size-4 shrink-0 text-primary" />
          <p className="text-base font-semibold">
            {t("lessonSummary.heading")}
          </p>
          <Badge variant="outline">{t("lessonSummary.onDeviceAiBadge")}</Badge>
        </div>

        <Select
          value={type}
          onValueChange={changeOption(setType)}
          disabled={running}
        >
          <SelectTrigger
            size="sm"
            className="w-[130px]"
            aria-label={t("lessonSummary.styleAriaLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUMMARY_TYPES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={length}
          onValueChange={changeOption(setLength)}
          disabled={running}
        >
          <SelectTrigger
            size="sm"
            className="w-[110px]"
            aria-label={t("lessonSummary.lengthAriaLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUMMARY_LENGTHS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {running ? (
          <Button variant="ghost" onClick={cancel}>
            {t("lessonSummary.cancel")}
          </Button>
        ) : (
          <Button onClick={summarize}>
            <SparklesIcon data-icon="inline-start" />
            {summary
              ? t("lessonSummary.regenerate")
              : t("lessonSummary.summarise")}
          </Button>
        )}
      </div>

      {/* First run on this device: the model has to be fetched before it can
          summarise. `loaded` is a 0–1 fraction, so show real progress. Until
          the first real progress arrives the bar is full and pulsing, so the
          line says the download is starting rather than showing "0%". */}
      {phase === "downloading" && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground">
            {progress > 0
              ? t(
                  engine === "lfm"
                    ? "lessonSummary.downloadingModelLfm"
                    : "lessonSummary.downloadingModel",
                  { percent: Math.round(progress * 100) },
                )
              : t(
                  engine === "lfm"
                    ? "lessonSummary.startingDownloadLfm"
                    : "lessonSummary.startingDownload",
                )}
          </p>
          <Progress
            value={progress > 0 ? progress * 100 : 100}
            className={cn("mt-1", progress === 0 && "animate-pulse")}
          />
        </div>
      )}

      {/* Between the click and the model's first chunk. Once chunks arrive we
          render them as they stream, so the skeleton only covers the gap. */}
      {phase === "summarizing" && !summary && <SummarySkeleton />}

      {summary && <SummaryMarkdown text={summary} />}

      {error && (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {(summary || truncated) && phase !== "summarizing" && (
        <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
          <p className="flex-1 text-xs text-muted-foreground">
            {truncated
              ? t("lessonSummary.truncatedNotice")
              : t(
                  engine === "lfm"
                    ? "lessonSummary.generatedNoticeLfm"
                    : "lessonSummary.generatedNotice",
                )}
          </p>
          {summary && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={copy}
                  aria-label={t("lessonSummary.copySummaryAriaLabel")}
                >
                  {copied ? (
                    <CheckIcon className="text-success" />
                  ) : (
                    <CopyIcon />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {copied
                  ? t("lessonSummary.copied")
                  : t("lessonSummary.copySummary")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Nothing generated yet, and the model isn't on this machine — warn before
          the click, not after it starts a large download. The fallback's notice
          names the size: 760 MB is a download nobody should trigger unwarned. */}
      {phase === "idle" &&
        !summary &&
        !error &&
        availability !== "available" && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t(
              engine === "lfm"
                ? "lessonSummary.idleNoticeLfm"
                : "lessonSummary.idleNotice",
            )}
          </p>
        )}
    </div>
  );
}
