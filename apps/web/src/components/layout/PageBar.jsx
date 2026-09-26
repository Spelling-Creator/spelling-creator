// The contextual bar under AppHeader: where you are, and what you can do here.
//
// It used to be the app's whole top bar (with the sidebar toggle on its left),
// and every page rendered one even when its crumb just restated the page's own
// title. Now that AppHeader carries the app-level chrome, this bar appears only
// where it earns its row: pages that are *inside* something — a lesson under
// the hub, a document in the editor — and that carry page-level actions. Plain
// pages (home, hub, settings…) put their title in their body instead.
//
// It pins directly beneath the header, on the same --card surface, so the two
// read as one piece of chrome. Heights come from --pagebar-row-h / --header-h
// in globals.css, which remain the single source of truth — the editor's
// sticky section headers and the lesson's tab bar pin to --header-h (header +
// this bar) and anything scrolled to programmatically offsets by it. See
// docs/web-app/navigating-large-lessons.md.

import { Fragment } from "react";
import { Link as RouterLink } from "react-router-dom";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "../../lib/utils.js";

/**
 * @param {object} props
 * @param {Array<{label: string, to?: string}>} props.crumbs  Trail from the
 *   section down to this page. The last entry is the current page and renders
 *   as text however it's given; earlier ones need a `to` to be links. All but
 *   the last are hidden below `sm`, where there isn't room for a trail.
 * @param {React.ReactNode} [props.children]  Page actions, right-aligned.
 */
export default function PageBar({ crumbs = [], children }) {
  const last = crumbs.length - 1;

  return (
    // top-(--appheader-h) rather than top-0: the bar pins under AppHeader,
    // which already pads itself by the iOS status-bar inset, so this needs no
    // pt-safe of its own.
    <header className="sticky top-(--appheader-h) z-40 border-b border-border bg-card">
      <div className="flex h-(--pagebar-row-h) items-center gap-1 px-3 sm:px-4">
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          {crumbs.map((crumb, i) => (
            <Fragment key={`${crumb.label}-${i}`}>
              {i > 0 && (
                <ChevronRightIcon className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
              )}
              {i === last ? (
                <h1 className="min-w-0 truncate text-base font-semibold">
                  {crumb.label}
                </h1>
              ) : (
                <span className={cn("hidden shrink-0 sm:block", "max-w-48")}>
                  {crumb.to ? (
                    <RouterLink
                      to={crumb.to}
                      className="block truncate text-muted-foreground no-underline hover:text-foreground hover:underline"
                    >
                      {crumb.label}
                    </RouterLink>
                  ) : (
                    <span className="block truncate text-muted-foreground">
                      {crumb.label}
                    </span>
                  )}
                </span>
              )}
            </Fragment>
          ))}
        </nav>

        {children && (
          <div className="flex shrink-0 items-center gap-1.5">{children}</div>
        )}
      </div>
    </header>
  );
}
