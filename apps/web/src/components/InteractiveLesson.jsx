// Interactive mode — working through a published lesson one step at a time
// instead of reading it as a page.
//
// A section's material pops up as its own step, then that section's questions
// pop up one at a time, each with a text field. The walkthrough is derived from
// the lesson document by buildInteractiveSteps — nothing is stored in a lesson to
// make it playable, so every lesson ever published works here, including ones
// written before this existed and ones with no questions at all.
//
// It takes over the whole viewport. A lesson step is one thing to read or one
// question to answer, and a dialog floating over the page you just left keeps
// that page in the corner of the eye competing for attention.
//
// The blocks are re-rendered here rather than reusing LessonView. LessonView
// follows the theme too, but it keeps the export's document proportions — page
// text sizes, the export's section rules — which is right for reading a lesson
// as a page and wrong for a full-screen surface you read and answer on one step
// at a time. So this file draws text, images and spelling words itself, at its
// own scale, from the same block shapes; only the *presentation* differs, never
// the content.
//
// What the learner types is theirs. The finished run-through is sent once, at
// the end, to their own account (see core/lessonResponses.js and the privacy
// note in the Worker's routes/lessonResponses.js). The lesson's author never
// sees it.
//
// Until then it is also written to this browser as they type (see
// core/browser/interactiveProgress.js), so a lesson closed half-way reopens
// where it was left, answers and all. That local copy never leaves the device
// and is dropped as soon as the run-through it belongs to is finished and filed.
//
// A question block carries the author's own answer, and the eye button in the
// top bar reveals it — for whoever is running the lesson at the front of a room,
// who otherwise has to keep the lesson open in a second window to see what they
// are walking a class towards. It starts off every time interactive mode opens,
// so a learner's own run-through never begins with the answers on screen.
//
// One thing this deliberately does NOT do: mark answers. Revealing the author's
// answer is a presenter putting it on screen deliberately; it is never compared
// against what the learner typed and no verdict is ever drawn. Spelling lessons
// are about the learner producing the response, and a right/wrong verdict from a
// string comparison would be both wrong a lot of the time and the wrong shape of
// feedback.
//
// Speech is optional and off until asked for; see lib/useSpeech.js.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleCheckIcon,
  EyeIcon,
  EyeOffIcon,
  HistoryIcon,
  PlayIcon,
  RotateCcwIcon,
  SettingsIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
} from "lucide-react";
import { Button } from "./ui/button.jsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.jsx";
import { Field, FieldLabel } from "./ui/field.jsx";
import { Progress } from "./ui/progress.jsx";
import { Skeleton } from "./ui/skeleton.jsx";
import { Spinner } from "./ui/spinner.jsx";
import { Textarea } from "./ui/textarea.jsx";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.jsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.jsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.jsx";
import { fitWithin } from "@spelling-creator/core/image";
import {
  MAX_RESPONSE_LENGTH,
  answerKey,
  buildInteractiveSteps,
  collectResponses,
  hasRevealableAnswers,
  questionAnswer,
  stepSpeechText,
} from "@spelling-creator/core/interactive";
import {
  clearInteractiveProgress,
  loadInteractiveProgress,
  saveInteractiveProgress,
} from "@spelling-creator/core/browser/interactiveProgress";
import { questionMeta } from "@spelling-creator/core/questions";
import { saveLessonResponses } from "@spelling-creator/core/lessonResponses";
import { hasApi } from "@spelling-creator/core/config";
import { cn } from "../lib/utils.js";
import { useImageSrc } from "../lib/useImageSrc.js";
import { SPEECH_RATES, useSpeech } from "../lib/useSpeech.js";
import { useAuth } from "../lib/auth.jsx";

// The speaker toggle, a replay button, and a popover for voice and pace. Renders
// nothing at all when the browser has no speech synthesis — a reader on a browser
// without it never learns the feature exists, which beats a dead button.
function SpeechControls({ speech, onReplay }) {
  const { t } = useTranslation("interactive");
  if (!speech.supported) return null;

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={speech.enabled ? "secondary" : "ghost"}
            size="icon-sm"
            aria-pressed={speech.enabled}
            aria-label={
              speech.enabled ? t("speech.turnOff") : t("speech.turnOn")
            }
            onClick={() => speech.setEnabled(!speech.enabled)}
          >
            {speech.enabled ? <Volume2Icon /> : <VolumeXIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {speech.enabled ? t("speech.turnOff") : t("speech.turnOn")}
        </TooltipContent>
      </Tooltip>

      {speech.enabled && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={
                  speech.speaking ? t("speech.stop") : t("speech.readAgain")
                }
                onClick={speech.speaking ? speech.stop : onReplay}
              >
                {speech.speaking ? <VolumeXIcon /> : <PlayIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {speech.speaking ? t("speech.stop") : t("speech.readAgain")}
            </TooltipContent>
          </Tooltip>

          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("speech.settings")}
                  >
                    <SettingsIcon />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("speech.settings")}</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-72">
              <div className="flex flex-col gap-3">
                <Field>
                  <FieldLabel htmlFor="tts-voice">
                    {t("speech.voice")}
                  </FieldLabel>
                  <Select
                    value={speech.voiceURI || "default"}
                    onValueChange={(next) =>
                      speech.setVoiceURI(next === "default" ? "" : next)
                    }
                  >
                    <SelectTrigger id="tts-voice" className="w-full">
                      <SelectValue placeholder={t("speech.defaultVoice")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        {t("speech.defaultVoice")}
                      </SelectItem>
                      {speech.voices.map((voice) => (
                        <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                          {voice.name} ({voice.lang})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>{t("speech.pace")}</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={String(speech.rate)}
                    onValueChange={(next) =>
                      next && speech.setRate(Number(next))
                    }
                  >
                    {SPEECH_RATES.map((rate) => (
                      <ToggleGroupItem
                        key={rate}
                        value={String(rate)}
                        // `count` picks the plural form, so 1× reads "Normal
                        // speed" rather than "1 times normal speed".
                        aria-label={t("speech.paceOption", {
                          count: rate,
                          rate,
                        })}
                      >
                        {rate}×
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}

// The presenter's reveal, sat beside the speech controls in the top bar. Only
// rendered when the lesson has an answer to reveal somewhere — a lesson of
// open-ended questions has nothing behind this button, and the same reasoning
// that keeps SpeechControls off a browser without speech keeps it off here.
function AnswerToggle({ shown, onToggle }) {
  const { t } = useTranslation("interactive");
  const label = shown ? t("answers.hide") : t("answers.show");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={shown ? "secondary" : "ghost"}
          size="icon-sm"
          aria-pressed={shown}
          aria-label={label}
          onClick={() => onToggle(!shown)}
        >
          {shown ? <EyeIcon /> : <EyeOffIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// The author's answer to one question, while the reveal is on. Framed and
// labelled rather than dropped in under the prompt: this often goes up on a
// projector next to the learner's own field, and which of the two is which has
// to be obvious from the back of the room. A question with nothing to reveal
// says so — an open-ended question has no set answer, and leaving a blank space
// would read as the reveal being broken.
function AnswerReveal({ block, className }) {
  const { t } = useTranslation("interactive");
  const revealed = questionAnswer(block);

  const label = (text) => (
    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {text}
    </p>
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-panel border border-dashed border-primary/60 bg-primary/5 px-4 py-3",
        className,
      )}
    >
      {!revealed && (
        <p className="text-muted-foreground italic">{t("answers.none")}</p>
      )}
      {revealed?.answer && (
        <div>
          {label(t("answers.label"))}
          <p className="mt-1 text-lg font-medium">{revealed.answer}</p>
        </div>
      )}
      {revealed?.answers.length > 0 && (
        <div>
          {label(t("answers.labelPlural"))}
          <ul className="mt-1 list-disc pl-5">
            {revealed.answers.map((answer, index) => (
              <li key={index} className="text-lg font-medium">
                {answer}
              </li>
            ))}
          </ul>
        </div>
      )}
      {revealed?.steps.length > 0 && (
        <div>
          {label(t("answers.working"))}
          <ol className="mt-1 list-decimal pl-5">
            {revealed.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// Shown on the step a resumed run-through picks up at, and only until the
// learner moves on: it answers "why am I in the middle of this lesson?" once,
// and the answer stops being interesting the moment they carry on. It carries
// the way back out too — a shared classroom machine will hand someone a
// half-finished lesson they don't want now and then, and starting over shouldn't
// mean finishing first.
function ResumeNotice({ onRestart }) {
  const { t } = useTranslation("interactive");

  return (
    <Alert className="mb-6">
      <HistoryIcon />
      <AlertTitle>{t("resume.title")}</AlertTitle>
      <AlertDescription>
        <p>{t("resume.body")}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={onRestart}
        >
          <RotateCcwIcon data-icon="inline-start" />
          {t("resume.startAgain")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

// A text block, at reading size. Each newline is its own paragraph, matching how
// the lesson page and the export both treat a text block.
function TextBlock({ block }) {
  return (block.text || "").split("\n").map((line, index) => (
    <p key={index} className="mb-4 text-lg leading-relaxed last:mb-0">
      {line || " "}
    </p>
  ));
}

// An image block, sized from the picture's own aspect ratio so nothing jumps as
// it loads, and framed in the app's border/radius rather than the export's.
function ImageBlock({ block }) {
  const { t } = useTranslation("interactive");
  const src = useImageSrc(block);
  // The stored intrinsic size only decides the shape of the box here — the width
  // comes from the column, so a picture fills the reading width on a phone.
  const { width, height } = fitWithin(block.width, block.height, 1000);

  return (
    <figure className="mb-4 last:mb-0">
      {src ? (
        <img
          src={src}
          alt={block.caption || t("step.imageAlt")}
          width={Math.round(width)}
          height={Math.round(height)}
          loading="lazy"
          decoding="async"
          className="mx-auto max-h-[50vh] w-auto max-w-full rounded-panel border border-border object-contain"
        />
      ) : (
        <Skeleton
          className="mx-auto w-full rounded-panel"
          style={{ aspectRatio: `${width} / ${height}` }}
        />
      )}
      {block.caption && (
        <figcaption className="mt-2 text-center text-sm text-muted-foreground">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}

// The spelling words a section teaches, as cards rather than a numbered list:
// they are the point of the lesson, and at this size they can be read across a
// room. With speech on, each word gets its own button — hearing one word is a
// different job from hearing the whole step, and the commonest thing a learner
// wants to replay.
function SpellingBlock({ block, speech }) {
  const { t } = useTranslation("interactive");
  const words = (block.words || [])
    .map((word) => (word.text || "").trim())
    .filter(Boolean);

  if (words.length === 0) return null;

  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
        {t("step.spellingWords")}
      </p>
      <ul className="grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
        {words.map((word, index) => (
          <li
            key={index}
            className="flex items-center justify-between gap-2 rounded-panel border border-border bg-muted/40 px-4 py-3"
          >
            <span className="text-xl font-semibold tracking-wide">{word}</span>
            {speech.supported && speech.enabled && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("step.speakWord", { word })}
                onClick={() => speech.speak(word)}
              >
                <Volume2Icon />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// A section's material for one step.
function ContentStep({ step, speech }) {
  return (
    <div>
      {step.blocks.map((block, index) => {
        const key = block.id || index;
        if (block.type === "text") return <TextBlock key={key} block={block} />;
        if (block.type === "image" && (block.image || block.src)) {
          return <ImageBlock key={key} block={block} />;
        }
        if (block.type === "spelling") {
          return <SpellingBlock key={key} block={block} speech={speech} />;
        }
        return null;
      })}
    </div>
  );
}

// One question, with the field the learner types into — and, under it, the
// author's answer while the presenter's reveal is on.
function QuestionStep({ step, value, onChange, showAnswers }) {
  const { t } = useTranslation("interactive");
  const meta = questionMeta(step.block.questionType);
  const fieldId = `interactive-answer-${answerKey(step)}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span
          className="text-xs font-semibold tracking-wide uppercase"
          style={{ color: meta.color }}
        >
          {meta.label}
        </span>
        <p className="mt-2 text-2xl leading-snug font-semibold">
          {step.block.prompt || t("step.noQuestionText")}
        </p>
      </div>
      <Field>
        <FieldLabel htmlFor={fieldId} className="sr-only">
          {t("step.yourAnswer")}
        </FieldLabel>
        <Textarea
          id={fieldId}
          autoFocus
          value={value}
          maxLength={MAX_RESPONSE_LENGTH}
          placeholder={t("step.answerPlaceholder")}
          className="min-h-32 text-lg md:text-lg"
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      {showAnswers && <AnswerReveal block={step.block} />}
    </div>
  );
}

// The end of a run-through: everything the learner wrote, and what happened to
// it. With the reveal on, each answer the author wrote sits under the one the
// learner did — going back over the questions as a class is the other half of
// the job the reveal exists for. Still no marking: the two are put side by side,
// never compared.
function SummaryStep({
  responses,
  saveState,
  error,
  onRetry,
  signedIn,
  ownerChanged,
  showAnswers,
  blockFor,
}) {
  const { t } = useTranslation("interactive");
  const answered = responses.filter((response) =>
    response.answer.trim(),
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <CircleCheckIcon className="size-6 text-primary" />
        <p className="text-lg font-medium">
          {responses.length === 0
            ? t("summary.readThrough")
            : t("summary.answered", { answered, total: responses.length })}
        </p>
      </div>

      {responses.length > 0 && (
        <div className="flex flex-col divide-y divide-border rounded-panel border border-border">
          {responses.map((response, index) => (
            <div key={response.blockId || index} className="px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {response.prompt || t("step.noQuestionText")}
              </p>
              <p className="mt-1 whitespace-pre-wrap">
                {response.answer.trim() || (
                  <span className="text-muted-foreground italic">
                    {t("summary.skipped")}
                  </span>
                )}
              </p>
              {showAnswers && blockFor(response.blockId) && (
                <AnswerReveal
                  block={blockFor(response.blockId)}
                  className="mt-3"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* What became of the answers. Saving is only possible with an account and
          a backend — without either, the run-through still worked, and saying so
          plainly beats a failure the learner can't act on. */}
      {responses.length > 0 && (
        <>
          {saveState === "saving" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t("summary.saving")}
            </p>
          )}
          {saveState === "saved" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckIcon className="size-4" />
              {t("summary.saved")}
            </p>
          )}
          {saveState === "error" && (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-2">
                {error}
                <Button variant="ghost" size="sm" onClick={onRetry}>
                  {t("summary.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {saveState === "unavailable" && (
            <Alert>
              <AlertDescription>
                {/* Three different reasons there is no account to file this to,
                    and which one it is decides what the learner can do about
                    it — so they are not collapsed into one apology. */}
                {ownerChanged
                  ? t("summary.signedInSince")
                  : signedIn
                    ? t("summary.notConfigured")
                    : t("summary.signInToSave")}
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}

// Write (or drop) the unfinished run-through this browser is holding. Dropping
// it once nothing has been done — step one, nothing typed — is what stops a
// lesson someone opened and immediately closed from being offered back to them
// as work in progress.
//
// Returns whether the browser actually kept it: a browser that refuses us
// storage still gets a working walkthrough, and the only thing that changes is
// what we promise on the way out.
function writeProgress(lessonId, owner, { started, stepKey, answers }) {
  if (!lessonId) return false;
  return started
    ? saveInteractiveProgress(lessonId, owner, { stepKey, answers })
    : clearInteractiveProgress(lessonId, owner);
}

/**
 * The interactive-mode surface for one lesson.
 *
 * @param {object}   props.lesson        The full lesson ({ id, title, doc, … }).
 * @param {boolean}  props.open
 * @param {Function} props.onOpenChange
 * @param {Function} [props.onSaved]     Called once a run-through is stored, so the
 *                                       page can refresh the learner's saved answers.
 */
export default function InteractiveLesson({
  lesson,
  open,
  onOpenChange,
  onSaved,
}) {
  const { t } = useTranslation("interactive");
  const { user, accessToken, loading: authLoading } = useAuth();
  const speech = useSpeech();

  const steps = useMemo(
    () => buildInteractiveSteps(lesson?.doc),
    [lesson?.doc],
  );

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  // "running" — working through the steps
  // "summary" — finished, showing what was written and where it went
  // "quit"    — confirming that leaving means losing the answers
  const [phase, setPhase] = useState("running");
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");
  // The presenter's reveal — see the note at the top of this file for why it is
  // plain state rather than a remembered preference like the speech settings.
  const [showAnswers, setShowAnswers] = useState(false);
  // Whether this run picked up an unfinished one, and whether this browser is
  // actually able to hold on to it. The second is only ever false where storage
  // is refused outright (private browsing, a full quota), and all it changes is
  // what the walkthrough claims on the way out.
  const [resumed, setResumed] = useState(false);
  const [progressStored, setProgressStored] = useState(true);

  // Progress is kept per learner as well as per lesson: a shared classroom
  // machine is the normal case here, and resuming into the answers of whoever
  // used the browser before you is worse than not resuming at all.
  //
  // `owner` is who is signed in *now*; `runOwner` is who this run-through
  // started as, pinned when it began and used for everything it writes. The two
  // differ only when the session changes with the walkthrough open — a sign-in
  // in another tab, a sign-out — and a run belongs to the one person who started
  // it. Following `owner` instead would file whatever is on screen into whoever
  // just signed in: their browser record gets someone else's half-written
  // answers, and Finish sends them to their account under their token.
  const owner = user?.id || "";
  const [runOwner, setRunOwner] = useState(null);
  // Not a rejection of the new session, just a refusal to file one person's work
  // to another person's account. The run itself carries on, and its answers keep
  // going to the record they started in.
  const ownerChanged = runOwner !== null && runOwner !== owner;

  // Whether the reveal has anywhere to go, and the block behind each answer, so
  // the summary can reveal alongside a stored response (which carries a snapshot
  // of the prompt, deliberately, but never the author's answer).
  const revealable = useMemo(() => hasRevealableAnswers(steps), [steps]);
  const questionBlocks = useMemo(() => {
    const blocks = new Map();
    for (const s of steps) {
      if (s.kind === "question") blocks.set(answerKey(s), s.block);
    }
    return blocks;
  }, [steps]);

  const step = steps[index] || null;
  const questionSteps = steps.filter((s) => s.kind === "question");
  const questionsAnswered = questionSteps.filter((s) =>
    (answers[answerKey(s)] || "").trim(),
  ).length;
  const isLastStep = index >= steps.length - 1;
  const dirty = Object.values(answers).some((answer) => answer.trim());
  const stepKey = step?.key || "";
  // Whether there is anything to come back to. Being past the first step counts
  // on its own: a lesson with no questions is still somewhere you got to.
  const started = index > 0 || dirty;

  // Pick up where this learner left off, once per opening.
  //
  // Guarded by a token rather than a plain "have we started" flag because
  // `steps` has to be in the dependencies — the lesson page re-fetches the
  // lesson underneath us, which rebuilds the walkthrough — and re-running this
  // mid-lesson would reset a run-through in progress to its stored state.
  //
  // The token is the lesson, not the lesson and the learner: a session that
  // resolves late, or a sign-in in another tab, changes `owner` underneath an
  // open walkthrough, and answering that by wiping the screen and loading the
  // other account's record would be indefensible. What is on screen carries on,
  // under the owner it started as — see `runOwner`.
  const runToken = useRef(null);
  useEffect(() => {
    if (!open) {
      runToken.current = null;
      setRunOwner(null);
      return;
    }
    // Wait for the session first. A server-rendered link straight to /practice
    // mounts this before the session is restored from storage, and resuming as
    // "signed out" there would hand a signed-in learner an empty lesson and then
    // refuse to correct itself.
    if (authLoading) return;
    const token = lesson?.id || "";
    if (runToken.current === token) return;
    runToken.current = token;

    const saved = loadInteractiveProgress(lesson?.id, owner);
    // The step is found by key, not by number: a lesson edited between two
    // sittings shifts every index after the edit, and coming back to the wrong
    // question is the one thing resuming must not do. A step that has since been
    // deleted resolves to nothing and the run starts at the top — with the
    // answers still restored, since those are keyed by block id and survive a
    // re-ordering intact.
    const savedStep = saved
      ? steps.findIndex((s) => s.key === saved.stepKey)
      : -1;
    const savedAnswers = saved?.answers || {};

    setIndex(savedStep > 0 ? savedStep : 0);
    setAnswers(savedAnswers);
    setResumed(savedStep > 0 || Object.keys(savedAnswers).length > 0);
    // Whose run this is, for as long as it lasts.
    setRunOwner(owner);
    setPhase("running");
    setSaveState("idle");
    setSaveError("");
    setShowAnswers(false);
    setProgressStored(true);
    savedFingerprint.current = null;
  }, [open, authLoading, lesson?.id, owner, steps]);

  // Autosave. Debounced so typing doesn't hit storage on every keystroke, but
  // briefly enough that closing a laptop mid-sentence keeps the sentence.
  // Moving between steps saves too: resuming to the wrong place is the other
  // half of what this is for.
  // It writes to `runOwner`, not to whoever is signed in now, which is what
  // keeps one run-through in one record: the first keystrokes and the last
  // belong together even if the session changed in between, and they certainly
  // don't belong to a second person who signed in halfway through.
  useEffect(() => {
    if (!open || runOwner === null || phase !== "running") return;
    const timer = setTimeout(() => {
      setProgressStored(
        writeProgress(lesson?.id, runOwner, { started, stepKey, answers }),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [open, runOwner, phase, lesson?.id, started, stepKey, answers]);

  // Read the current step aloud when speech is on. Keyed on which step was last
  // spoken rather than on the effect's inputs: changing voice or pace mid-step
  // should take effect on the *next* thing said, not restart the sentence the
  // learner is listening to.
  const spokenKey = useRef(null);
  useEffect(() => {
    if (!open || !speech.enabled || phase !== "running" || !step) return;
    if (spokenKey.current === step.key) return;
    spokenKey.current = step.key;
    speech.speak(stepSpeechText(step));
  }, [open, phase, speech, step]);

  // Nothing should still be talking once it's closed.
  useEffect(() => {
    if (open) return;
    spokenKey.current = null;
    speech.stop();
  }, [open, speech]);

  const responses = useMemo(
    () => collectResponses(steps, answers),
    [steps, answers],
  );

  // What has actually been stored, so finishing twice doesn't file the same
  // run-through twice. Reaching the summary, going Back to fix nothing, and
  // pressing Finish again is a normal thing to do, and it would otherwise spend
  // the learner's saved-run-through allowance on duplicates. Written only on a
  // successful save, so a failed or impossible one leaves the next Finish free
  // to try again.
  const savedFingerprint = useRef(null);

  // Drop the browser's copy of the run-through. Called once it has been filed to
  // the learner's account, and when they choose to throw it away — either by
  // starting again or by discarding on the way out.
  const forgetProgress = () => {
    if (lesson?.id) clearInteractiveProgress(lesson.id, runOwner);
  };

  // Write out whatever hasn't been autosaved yet. The debounce above is still
  // pending when someone presses Esc mid-word, and its cleanup would drop it.
  // The result is kept for the same reason the debounced write keeps it: this is
  // usually the last write a run-through makes, and it is the one the quit
  // confirmation is about to make a promise about.
  const flushProgress = () => {
    if (phase !== "running" || runOwner === null) return;
    setProgressStored(
      writeProgress(lesson?.id, runOwner, { started, stepKey, answers }),
    );
  };

  // Store the finished run-through. Called on reaching the summary, and again by
  // the retry button. Requires a signed-in session and a configured hub; without
  // either, the summary says so rather than failing.
  const save = async (payload) => {
    // Whoever is signed in now is not who started this. Filing it would put one
    // learner's answers in another's account, so it stays where it is — in the
    // browser, under the owner who typed it, resumable by them.
    if (ownerChanged) {
      setSaveState("unavailable");
      return;
    }
    if (!hasApi() || !accessToken || !lesson?.id) {
      // Nothing to file it to, so the browser's copy is the only copy there is
      // and it stays. Reopening the lesson comes back to the last step with
      // everything typed still there, one press from this summary again.
      setSaveState("unavailable");
      return;
    }
    setSaveState("saving");
    setSaveError("");
    try {
      await saveLessonResponses(lesson.id, payload, accessToken);
      savedFingerprint.current = JSON.stringify(payload);
      setSaveState("saved");
      // Filed. It is a finished run-through now, not one in progress, and
      // leaving it in the resume cache would offer the lesson back as unfinished
      // work. A *failed* save deliberately leaves it, so closing the dialog and
      // coming back is a way to try again rather than a way to lose it.
      forgetProgress();
      onSaved?.();
    } catch (err) {
      setSaveState("error");
      setSaveError(err.message || t("summary.couldNotSave"));
    }
  };

  const finish = () => {
    speech.stop();
    spokenKey.current = null;
    setPhase("summary");
    // A read-through of a lesson with no questions has nothing to store, and
    // answers already stored unchanged have nothing to store again. Either way
    // the run-through is over, so there is nothing to come back to.
    if (responses.length === 0) {
      forgetProgress();
      return;
    }
    if (savedFingerprint.current === JSON.stringify(responses)) {
      forgetProgress();
      return;
    }
    save(responses);
  };

  const goNext = () => {
    setResumed(false);
    if (isLastStep) finish();
    else setIndex((current) => current + 1);
  };

  const goBack = () => {
    setResumed(false);
    if (phase === "summary") {
      setPhase("running");
      setIndex(steps.length - 1);
      return;
    }
    setIndex((current) => Math.max(0, current - 1));
  };

  const restart = () => {
    setIndex(0);
    setAnswers({});
    setResumed(false);
    setPhase("running");
    setSaveState("idle");
    setSaveError("");
    setProgressStored(true);
    spokenKey.current = null;
    savedFingerprint.current = null;
    forgetProgress();
  };

  const close = () => {
    speech.stop();
    flushProgress();
    onOpenChange(false);
  };

  // Leaving with the browser's copy thrown away as well — the way out for
  // someone who wants the lesson to start clean next time, and the reason the
  // confirmation still has a destructive button on it.
  const discardAndClose = () => {
    speech.stop();
    forgetProgress();
    onOpenChange(false);
  };

  // Leaving mid-run no longer loses anything: the answers are already in this
  // browser and the lesson reopens where it was left. The confirmation stays
  // anyway, because that is exactly what it now exists to say — plus it is the
  // one place to discard the work deliberately. Where storage was refused it
  // reverts to the warning it used to be, which by then is the truth.
  const requestClose = () => {
    if (phase === "running" && dirty) {
      flushProgress();
      setPhase("quit");
    } else close();
  };

  const empty = steps.length === 0;
  const progress =
    empty || phase === "summary" ? 100 : ((index + 1) / steps.length) * 100;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
      <DialogContent
        // Full-bleed: the walkthrough is the whole screen, not a card floating
        // over the page the learner just left. Every class here overrides one of
        // DialogContent's centred-card defaults (position, size, radius, the
        // translucent glass surface), so it reads as a place rather than a popup.
        // (`rounded-none!` / `shadow-none!` are marked important on purpose:
        // DialogContent's own radius and its two-layer glass shadow are custom
        // theme values that tailwind-merge won't reconcile away, and left alone
        // they draw a rounded card outline around a full-bleed screen.)
        className="top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none! border-0 bg-background p-0 shadow-none! backdrop-blur-none sm:max-w-none"
        // Esc and a stray click are the two easiest ways to leave a half-typed
        // run-through by accident, so both route through the same confirmation
        // as the close button rather than dropping out of it silently.
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onInteractOutside={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        <header className="shrink-0 border-b border-border bg-card/60">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">
                {lesson?.title || t("untitledLesson")}
              </DialogTitle>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {phase === "quit"
                  ? progressStored
                    ? t("quit.title")
                    : t("quit.noStorageTitle")
                  : phase === "summary"
                    ? t("progress.finished")
                    : step?.sectionName || t("untitledSection")}
              </p>
            </div>
            {revealable && (
              <AnswerToggle shown={showAnswers} onToggle={setShowAnswers} />
            )}
            <SpeechControls
              speech={speech}
              onReplay={() => step && speech.speak(stepSpeechText(step))}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("close")}
                  onClick={requestClose}
                >
                  <XIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("close")}</TooltipContent>
            </Tooltip>
          </div>
          {!empty && phase !== "quit" && (
            <div className="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6">
              <Progress value={progress} />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t("progress.stepCount", {
                  current: phase === "summary" ? steps.length : index + 1,
                  total: steps.length,
                })}
                {questionSteps.length > 0 &&
                  ` · ${t("progress.questionsAnswered", {
                    answered: questionsAnswered,
                    total: questionSteps.length,
                  })}`}
              </p>
            </div>
          )}
        </header>

        {/* A step is usually a paragraph or a single question, which would sit in
            the top strip of a full-screen page and look abandoned there. `m-auto`
            centres it — and unlike `items-center`, it still scrolls from the top
            when a step is taller than the viewport instead of clipping its head. */}
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="m-auto w-full max-w-3xl px-4 py-8 sm:px-6">
            {empty ? (
              <p className="text-muted-foreground">{t("emptyLesson")}</p>
            ) : phase === "quit" ? (
              <p className="text-muted-foreground">
                {progressStored ? t("quit.body") : t("quit.noStorageBody")}
              </p>
            ) : phase === "summary" ? (
              <SummaryStep
                responses={responses}
                saveState={saveState}
                error={saveError}
                onRetry={() => save(responses)}
                signedIn={Boolean(user)}
                ownerChanged={ownerChanged}
                showAnswers={showAnswers}
                blockFor={(blockId) => questionBlocks.get(blockId)}
              />
            ) : (
              <>
                {resumed && <ResumeNotice onRestart={restart} />}
                {step.kind === "content" ? (
                  <ContentStep step={step} speech={speech} />
                ) : (
                  <QuestionStep
                    step={step}
                    showAnswers={showAnswers}
                    value={answers[answerKey(step)] || ""}
                    onChange={(value) =>
                      setAnswers((current) => ({
                        ...current,
                        [answerKey(step)]: value,
                      }))
                    }
                  />
                )}
              </>
            )}
          </div>
        </div>

        <footer className="shrink-0 border-t border-border bg-card/60">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
            {empty ? (
              <Button variant="outline" onClick={close}>
                {t("close")}
              </Button>
            ) : phase === "quit" ? (
              <>
                <Button variant="outline" onClick={() => setPhase("running")}>
                  {t("quit.keepGoing")}
                </Button>
                <div className="flex gap-2">
                  {/* Only worth offering where there is something kept to throw
                      away. With storage refused, leaving *is* discarding, and a
                      second button saying so twice would be noise. */}
                  {progressStored && (
                    <Button variant="destructive" onClick={discardAndClose}>
                      {t("quit.discard")}
                    </Button>
                  )}
                  <Button
                    variant={progressStored ? "default" : "destructive"}
                    onClick={close}
                  >
                    {t("quit.leave")}
                  </Button>
                </div>
              </>
            ) : phase === "summary" ? (
              <>
                <Button variant="outline" onClick={goBack}>
                  <ArrowLeftIcon data-icon="inline-start" />
                  {t("nav.back")}
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={restart}>
                    <RotateCcwIcon data-icon="inline-start" />
                    {t("summary.startAgain")}
                  </Button>
                  <Button onClick={close}>{t("summary.done")}</Button>
                </div>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={goBack}
                  disabled={index === 0}
                >
                  <ArrowLeftIcon data-icon="inline-start" />
                  {t("nav.back")}
                </Button>
                <Button size="lg" onClick={goNext}>
                  {isLastStep ? t("nav.finish") : t("nav.next")}
                  {isLastStep ? <CheckIcon /> : <ArrowRightIcon />}
                </Button>
              </>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
