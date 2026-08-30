// Interactive mode's *unfinished* run-through: where the learner had got to and
// what they had typed, kept on the device so closing the lesson — or the tab, or
// the laptop lid — doesn't throw the work away.
//
// This is not the same thing as a saved run-through (lessonResponses.js), and
// the difference is worth being clear about:
//
//   a saved run-through   is finished, lives in the learner's account, needs an
//                         account to exist at all, and is kept until deleted.
//   progress (here)       is unfinished, lives in this browser, needs nothing —
//                         a signed-out learner gets it too — and is dropped the
//                         moment the run-through it belongs to is completed.
//
// So this never travels: no Worker call, no endpoint, nothing to scope by user
// id server-side, and no new way for a lesson's author to learn anything about
// who worked through it. The one consequence is that progress does not follow a
// learner between devices — starting on a school desktop and finishing on a
// phone still starts over. Syncing it would mean storing half-written answers on
// the server, which is a far bigger promise than "your tab remembers".
//
// Records are keyed by *owner and lesson*: a shared classroom machine is the
// normal case for this app, and resuming into the answers of whoever used the
// browser before you is worse than not resuming at all. Signing in mid-lesson
// therefore starts a fresh record; the signed-out one is left to expire.
//
// localStorage rather than the IndexedDB the editor uses (see storage.js): this
// is a few kilobytes of text that must be readable and writable synchronously as
// someone types and as a dialog closes, and losing it to a cleared browser is a
// disappointment rather than a disaster. Everything here is best-effort — a
// browser that refuses us storage gets a walkthrough that simply doesn't
// remember, and the caller is told so it can say as much.

import { MAX_RESPONSES, MAX_RESPONSE_LENGTH } from "../interactive.js";

const STORAGE_KEY = "spelling-creator:interactive-progress";

/** How many lessons' worth of progress one browser keeps. Past that the least
 * recently touched is dropped: this is a resume cache, not the learner's own
 * copy of anything, so pruning it is ours to do (unlike MAX_STORED_RESPONSES,
 * where the cap is enforced by refusing to save). */
export const MAX_PROGRESS_RECORDS = 20;

/** How long an untouched run-through stays resumable. Long enough to cover a
 * school holiday, short enough that a lesson abandoned last year doesn't reopen
 * half-answered. */
export const PROGRESS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** The record key for one learner's attempt at one lesson. `owner` is the signed-in
 * user's id, or absent for a signed-out learner — see the note above on why the
 * two are kept apart. */
function recordKey(lessonId, owner) {
  return `${owner || "anon"}:${lessonId}`;
}

// Every record in one localStorage entry rather than a key each: pruning and
// expiry are then one read and one write, and there is no way to leave a browser
// littered with keys nothing knows how to enumerate.
function readAll() {
  try {
    // Property access, not a bare global: this module is only loaded in a browser,
    // but a server render importing it transitively must not throw a ReferenceError.
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed;
  } catch {
    // Unavailable, or something else wrote nonsense under our key. Either way
    // there is nothing to resume.
    return {};
  }
}

function writeAll(records) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    // Private browsing, a full quota, storage switched off. The walkthrough
    // still works; it just won't remember. The caller uses the `false` to say so
    // rather than promising something it can't deliver.
    return false;
  }
}

/**
 * Whether a stored record is still worth offering, i.e. it is the shape we write
 * and it hasn't gone stale.
 * @param {unknown} record
 * @param {number} now
 * @returns {boolean}
 */
function isLive(record, now) {
  if (!record || typeof record !== "object") return false;
  if (!record.answers || typeof record.answers !== "object") return false;
  if (typeof record.updatedAt !== "number") return false;
  return now - record.updatedAt < PROGRESS_MAX_AGE_MS;
}

/**
 * Drop what has expired or is malformed, then keep only the most recently
 * touched records. Exported for its own test — the pruning is the part of this
 * module with a rule in it, and it shouldn't need a fake localStorage to check.
 *
 * @param {Record<string, object>} records
 * @param {number} [now]
 * @returns {Record<string, object>} A new map; the input is not modified.
 */
export function pruneProgress(records, now = Date.now()) {
  const live = Object.entries(records || {}).filter(([, record]) =>
    isLive(record, now),
  );
  live.sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
  return Object.fromEntries(live.slice(0, MAX_PROGRESS_RECORDS));
}

/**
 * The answers as they are stored: text only, within the same per-answer limit a
 * submission has, and no blanks. Dropping blanks is what makes clearing a field
 * stick — a resumed run-through that helpfully restored an answer the learner had
 * deleted would be worse than one that restored nothing.
 */
function normaliseAnswers(answers) {
  const out = {};
  if (!answers || typeof answers !== "object") return out;
  for (const [blockId, value] of Object.entries(answers)) {
    if (typeof value !== "string" || !value.trim()) continue;
    out[blockId] = value.slice(0, MAX_RESPONSE_LENGTH);
    if (Object.keys(out).length >= MAX_RESPONSES) break;
  }
  return out;
}

/**
 * The unfinished run-through this browser is holding for a lesson, or null if
 * there isn't one (or it has expired, or storage is unavailable).
 *
 * @param {string} lessonId
 * @param {?string} [owner]  The signed-in user's id, if any.
 * @returns {{ stepKey: string, answers: Record<string, string>, updatedAt: number } | null}
 */
export function loadInteractiveProgress(lessonId, owner) {
  if (!lessonId) return null;
  const record = readAll()[recordKey(lessonId, owner)];
  if (!isLive(record, Date.now())) return null;
  return {
    // The *step*, not its index: a lesson edited between sittings shifts every
    // index after the edit, and coming back to the wrong question is the one
    // thing resuming must not do. A step that has since been deleted resolves to
    // nothing and the caller starts at the top, with the answers still restored.
    stepKey: typeof record.stepKey === "string" ? record.stepKey : "",
    answers: normaliseAnswers(record.answers),
    updatedAt: record.updatedAt,
  };
}

/**
 * Remember where a learner has got to. Called as they type and as they move
 * between steps, so it is deliberately cheap and deliberately silent about
 * failure — bar the return value.
 *
 * @param {string} lessonId
 * @param {?string} owner
 * @param {{ stepKey?: string, answers?: Record<string, string> }} progress
 * @returns {boolean} Whether it was actually stored.
 */
export function saveInteractiveProgress(lessonId, owner, progress) {
  if (!lessonId) return false;
  const records = pruneProgress(readAll());
  records[recordKey(lessonId, owner)] = {
    stepKey: String(progress?.stepKey || ""),
    answers: normaliseAnswers(progress?.answers),
    updatedAt: Date.now(),
  };
  return writeAll(pruneProgress(records));
}

/**
 * Forget a lesson's progress — because the run-through finished, because the
 * learner started it again, or because they chose to throw it away.
 *
 * @param {string} lessonId
 * @param {?string} owner
 * @returns {boolean} Whether storage was writable (true when there was nothing to forget).
 */
export function clearInteractiveProgress(lessonId, owner) {
  if (!lessonId) return false;
  const records = readAll();
  const key = recordKey(lessonId, owner);
  if (!(key in records)) return true;
  delete records[key];
  return writeAll(pruneProgress(records));
}

/**
 * Whether a lesson has an unfinished run-through waiting — what the lesson page
 * asks to decide between "Start lesson" and "Continue lesson". A read-only peek:
 * it never writes, so a page that merely renders a lesson doesn't touch storage.
 *
 * @param {string} lessonId
 * @param {?string} [owner]
 * @returns {boolean}
 */
export function hasInteractiveProgress(lessonId, owner) {
  const progress = loadInteractiveProgress(lessonId, owner);
  if (!progress) return false;
  return Boolean(progress.stepKey) || Object.keys(progress.answers).length > 0;
}
