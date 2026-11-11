// The content column every page inside AppShell renders into.
//
// There are two widths, and the difference between them is real:
//
//   wide     listings, dashboards, and a lesson with its side rail. 64rem.
//   reading  prose people actually read or write: comments, a proposal's
//            description, a commit list. 48rem, because a line of text set
//            to the full width of a desktop screen is harder to read, not
//            easier.
//
// Anything that needs neither (the marketing hero's full-bleed gradient, the
// editor's panes) doesn't use this and says why where it opts out.

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Exported so the handful of things that need the column's width but can't
 * be the column (the lesson's sticky tab bar, a loading placeholder) line up
 * with it by reference instead of restating the number.
 */
export const PAGE_WIDTHS = {
  wide: "max-w-5xl",
  reading: "max-w-3xl",
};

/**
 * The side padding of every content column: 1rem, plus the safe-area inset
 * on each side (the notch, on a phone turned sideways; see globals.css). Use
 * this rather than a bare `px-4` on anything that holds content and can
 * reach the sides of the screen. It's a constant rather than padding on
 * AppShell's <main> because <main> also holds things that have to reach the
 * edge of the screen: PageBar's card background, the tab bar's full-width
 * rule, the hero's gradient.
 */
export const PAGE_GUTTER = "px-safe-4";

export default function PageBody({
  width = "wide",
  flush = false,
  className,
  children,
  ...rest
}: ComponentProps<"div"> & {
  width?: keyof typeof PAGE_WIDTHS;
  /** Drop the top padding, for a page whose first child brings its own. */
  flush?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full",
        PAGE_GUTTER,
        PAGE_WIDTHS[width] ?? PAGE_WIDTHS.wide,
        // pb-16 is the same on every page so a page's last element never
        // ends up flush against the bottom of the viewport, and so the
        // editor's floating + button has something to sit over.
        flush ? "pb-16" : "pt-6 pb-16",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
