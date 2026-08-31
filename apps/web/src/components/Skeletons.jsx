// Shared loading skeletons. Skeletons stand in for content while it loads, miming
// the eventual layout — they read as "the page is nearly here" rather than the
// open-ended "still working" of a spinner, so they feel faster and nag less. We use
// them for content regions (lists, cards, a lesson's body); small in-button and
// transient overlay spinners stay as <Spinner>, where a skeleton makes no sense.
// Each export mirrors the real markup it replaces so the swap to real content
// doesn't shift the layout.

import { Skeleton } from "./ui/skeleton.jsx";

// A single lesson row placeholder, matching a row in the hub/profile listing: the
// leading file icon, a title line, and a short meta line under it.
//
// The heights are the real row's, not approximations of it: `h-5` is the 20px
// line box of the title's `text-sm`, `h-4` the 16px of the meta line's
// `text-xs`, and `mt-0.5` the gap between them. Same `px-4 py-3` as the row.
function LessonRowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
      <div className="flex-1">
        <Skeleton className="h-5 w-[55%]" />
        <Skeleton className="mt-0.5 h-4 w-[35%]" />
      </div>
    </div>
  );
}

/**
 * A placeholder lesson listing: the bordered box the hub and profile draw their
 * lessons in, header strip and all, with divided rows inside it. Was a 3-across
 * grid of cards, and changed with the listings themselves — a skeleton whose
 * shape doesn't match what lands is worse than none, since the layout jumps at
 * the moment the content arrives.
 *
 * The strip is placeholdered rather than skipped for exactly that reason: every
 * listing that shows this has one, so leaving it out would insert ~41px above
 * the rows the instant the fetch landed and push the whole list down.
 */
export function LessonListSkeleton({ count = 6 }) {
  return (
    <div className="overflow-hidden rounded-panel border border-border bg-card">
      {/* Mirrors the real strip's metrics: `px-4 py-2.5` around a 20px `text-sm`
          heading, so this is 41px with its border, the same as the one that
          replaces it. */}
      <div className="flex items-center gap-3 border-b border-border bg-surface-muted px-4 py-2.5">
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <Skeleton className="h-5 w-36" />
      </div>
      <div className="flex flex-col divide-y divide-border">
        {Array.from({ length: count }, (_, i) => (
          <LessonRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * Placeholder for a single lesson's page: the title + author line, then the lesson
 * body as a block of text lines inside the same outlined frame the real preview uses.
 */
export function LessonContentSkeleton() {
  return (
    <>
      <div className="mb-4 flex flex-col gap-1.5">
        <Skeleton className="h-9 w-3/5" />
        <Skeleton className="h-4 w-[35%]" />
      </div>
      <div className="rounded-md border border-border p-4 sm:p-6">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="my-4 h-[180px] w-full rounded-md" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-4/5" />
      </div>
    </>
  );
}

// A single comment placeholder: a round avatar beside a name line and two body lines,
// matching the comment row in CommentsSection.
function CommentSkeleton() {
  return (
    <div className="flex items-start gap-3">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-4 w-[30%]" />
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-[85%]" />
      </div>
    </div>
  );
}

/** A short stack of placeholder comments, used while a lesson's comments load. */
export function CommentsSkeleton({ count = 3 }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, i) => (
        <CommentSkeleton key={i} />
      ))}
    </div>
  );
}

// A single editor section placeholder, matching SectionCard: a numbered-circle +
// title header, a divider, and a content block. Mirrors the real card so the
// hydrated sections don't shift the layout when they replace it.
function SectionSkeleton() {
  return (
    <div className="rounded-panel border border-border bg-card p-4">
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="size-[30px] shrink-0 rounded-full" />
        <Skeleton className="h-5 w-[40%]" />
      </div>
      <hr className="mb-4 border-border" />
      <Skeleton className="h-[72px] w-full rounded-md" />
    </div>
  );
}

/**
 * A stack of placeholder section cards, shown in the editor while the saved draft
 * hydrates from storage (or a hub lesson is fetched into an empty editor) — so the
 * "No sections yet" empty state never flashes before the real sections load in.
 */
export function SectionsSkeleton({ count = 2 }) {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: count }, (_, i) => (
        <SectionSkeleton key={i} />
      ))}
    </div>
  );
}

// A single feed-row placeholder, matching a row in HomePage's <FeedList>: a title
// line, a wrapped summary, and a short meta line.
function FeedRowSkeleton() {
  return (
    <div className="px-2 py-2.5">
      <Skeleton className="h-4 w-[65%]" />
      <Skeleton className="mt-2 h-4 w-[90%]" />
      <Skeleton className="mt-2 h-3 w-[35%]" />
    </div>
  );
}

/**
 * A short stack of placeholder feed rows separated by dividers, mirroring the
 * dashboard's <FeedList>. Used while the home-page feeds (latest lessons, your
 * activity, people you follow, notifications) load.
 */
export function FeedListSkeleton({ count = 4 }) {
  return (
    <div className="flex flex-col divide-y divide-border">
      {Array.from({ length: count }, (_, i) => (
        <FeedRowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Placeholder for an on-device AI summary (LessonSummary.jsx), shown between the
 * click and the model's first streamed chunk. Ragged lines, because a summary is
 * a short block of prose or bullets and we don't know how long it will be.
 */
export function SummarySkeleton() {
  return (
    <div>
      <Skeleton className="h-4 w-[92%]" />
      <Skeleton className="mt-2 h-4 w-[85%]" />
      <Skeleton className="mt-2 h-4 w-[60%]" />
    </div>
  );
}

// A single commit placeholder for the version-history timeline: the dot on the
// rail, then the summary line and a shorter meta line beside it.
function CommitSkeleton() {
  return (
    <div className="flex items-start gap-3 py-2">
      <Skeleton className="mt-1 size-3 shrink-0 rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-4 w-[70%]" />
        <Skeleton className="mt-2 h-4 w-[40%]" />
      </div>
    </div>
  );
}

/**
 * A stack of placeholder commits, shown while a lesson's history is read out of
 * its git repository (HistoryDialog). Mirrors the real timeline rows, dot and all.
 */
export function HistorySkeleton({ count = 5 }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: count }, (_, i) => (
        <CommitSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * A short stack of single-line placeholders, for the moderation panels' simple row
 * lists (bans, shadowbanned lessons, pending requests, moderators).
 */
export function ListRowsSkeleton({ count = 3 }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          style={{ width: `${85 - i * 10}%` }}
        />
      ))}
    </div>
  );
}
