---
title: Mobile layout & touch targets
---

# Mobile layout & touch targets

The editor is the one part of the app that was built desktop-first, and it
shows most on a phone. This page records the conventions that keep it usable
there, so new blocks and controls follow the same rules instead of
re-introducing the same problems.

## The problem being solved

Every content block is _content plus a stack of controls_ (drag, move up, move
down, delete, and a couple of block-specific extras). Those controls used to sit
in a fixed column down the right-hand side at every viewport width. The column
costs the same number of pixels whatever the screen, and on a 360px phone
there aren't many to spare:

|                             | width   |
| --------------------------- | ------- |
| viewport                    | 360     |
| less `EditorPage`'s `px-4`  | 328     |
| less `SectionCard`'s `p-4`  | 296     |
| less the block card's `p-4` | **264** |

Out of that 264px the control stack took 128px (text, image, question blocks)
or 164px (spelling blocks, which have two extra buttons). Subtract the `gap-2`
between the content and the controls and what remained was a ~128px box for
typing a 60-110 word lesson paragraph. A spelling word is worse than the 92px
that leaves suggests: each word sits in its own row with a delete button beside
it (`gap-1` + 32px), so the field itself came out at a **~56px box for typing a
6-9 letter word**.

## Rule 1: controls become a footer below `sm`

`ContentBlock.jsx` defines one shared layout class and uses it for every block
type:

```js
const BLOCK_LAYOUT = "flex flex-col gap-2 sm:flex-row sm:items-start";
```

Below `sm` the row becomes a column: content takes the full width and the
controls wrap underneath, right-aligned, with a hairline (`border-t … sm:border-t-0`)
that makes the row read as a footer rather than as more content. From `sm` up
it's the original corner column, unchanged.

`SectionCard`'s section header splits the same way: the section number and name
keep the first row and the move/delete buttons drop below them. It does this by
rendering the control group twice, once inside the header row (`hidden sm:flex`)
and once beneath it (`sm:hidden`), rather than by wrapping, because the header
row is sticky and the controls must **not** be pinned with it. Pinning them cost
113px, 13% of an 844px screen. See
[Navigating large lessons](./navigating-large-lessons.md#only-the-identity-is-pinned).

**If you add a new block type, use `BLOCK_LAYOUT`** rather than a bare
`flex items-start gap-2`.

## Rule 2: 40px touch targets, shrinking to 32px only for a mouse

The editor's icon buttons were `size="icon-sm"` (32px) and its inline buttons
`size="sm"` (h-8, 32px). Both are under Apple's 44pt and Material's 48dp
minimums, and they sit in rows of three to five with 4px between them.

- `IconActionButton` now applies `size-10 sm:pointer-fine:size-8` itself, so
  every block and section control gets this for free.
- Inline `size="sm"` buttons use the `TOUCH_SM_BUTTON` constant
  (`h-10 sm:pointer-fine:h-8`), defined in both `ContentBlock.jsx` and
  `SectionCard.jsx`.
- `ToggleGroup` passes no sizing down to its items, so the alignment/size toggles
  an image block and a [VAKT activity](./vakt-activities.md)'s picture share use
  `TOUCH_TOGGLES`, which reaches them by their `data-slot`.

**The shrink is gated on the pointer, not only on the width.** A tablet is
`sm` and up and still driven by a finger, so keying off the breakpoint alone
handed every tablet exactly the 32px targets this rule exists to avoid. The
variants are stacked (shrink only where the screen is wide _and_ the pointer
is fine) rather than written as a `pointer-coarse:` override competing with
`sm:`, because those two are equally specific and which one wins would come
down to the order Tailwind emits the media queries in.

This is the same signal that hides the drag handle (see
[Drag-and-drop is desktop-only](#drag-and-drop-is-desktop-only));
`pointer-coarse` and `pointer-fine` are the two halves of it.

## Rule 3: `tooltip` is also the accessible name

`IconActionButton` takes a `tooltip` prop and now forwards it as `aria-label`
too. A tooltip labels these buttons for a mouse user and nobody else: touch
devices have no hover, so on a phone each control was an unlabelled icon, and
assistive technology got nothing either. Pass `aria-label` explicitly only when
you want a longer spoken name than the tooltip's text.

## Drag-and-drop is desktop-only

Block reordering uses the HTML5 Drag and Drop API (`draggable` plus
`dragstart`/`dragover`/`drop`, see [Overview & features](./overview.md)).
Android Chrome never synthesises drag events from touch, and iOS Safari only
does so for a long-press in some cases, so on a phone the grab handle was a
control that mostly did nothing, and its `touch-none` meant touching it
swallowed the page scroll as well.

The handle is therefore hidden on coarse pointers
(`pointer-coarse:hidden` in `SectionCard.jsx`). Nothing is lost: the move
up/down buttons sitting next to it reorder blocks without a drag, and they work
across the whole lesson the same way. `useDragAutoScroll` is likewise inert on
touch, which is fine: it only runs while a drag is in flight.

## Safe areas: notch, status bar and home indicator

`index.html`'s viewport meta sets `viewport-fit=cover`, which lets the page draw
under the status bar, the notch, the rounded corners and the home indicator, and
is what makes `env(safe-area-inset-*)` resolve to anything other than zero. In
the [installed app](./pwa-and-offline.md) iOS also draws under the status bar on
purpose (`apple-mobile-web-app-status-bar-style: black-translucent`), so the
app's own chrome fills the top of the screen instead of a mismatched strip.

The catch is that **anything pinned to a screen edge has to step back by the
inset itself**, or it ends up under the clock and battery icons, under the
notch in landscape, or in the ~34px home-indicator strip where the swipe
gesture wins and a tap doesn't land. The side sheets (the nav menu and the
lesson checks) used to do exactly that: they were flush with the top of the
screen, so their headers and close buttons sat behind the status bar.

### The tokens

`globals.css` reads each inset once, into a token per edge:

```css
--safe-top: env(safe-area-inset-top, 0px);
--safe-right: env(safe-area-inset-right, 0px);
--safe-bottom: env(safe-area-inset-bottom, 0px);
--safe-left: env(safe-area-inset-left, 0px);
```

Use the tokens (or the utilities below), not `env()` directly. Besides keeping
one place that knows where the values come from, it means a layout can be
checked in a desktop browser, which has no notch to report, by setting them by
hand in the console:

```js
const s = document.documentElement.style;
s.setProperty("--safe-top", "59px"); // iPhone 15, portrait
s.setProperty("--safe-bottom", "34px");
// Landscape: --safe-left / --safe-right 59px, --safe-bottom 21px.
```

### The utilities

| Utility                                    | Use it for                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe` | An element whose padding on that edge is otherwise zero: sheets, the practice view's header and footer, `AppHeader`'s top |
| `mb-safe`, `ml-safe`, `mr-safe`, `mx-safe` | A floating element that already has an offset, like the add-section FAB's `right-4 bottom-4 sm:right-8 sm:bottom-8`       |
| `px-safe-<n>`                              | A content column or bar that already has side padding: `px-safe-4` is `px-4` plus the inset                               |

**Paddings for things that reach the edge.** Padding rather than margin, so the
background still runs to the edge of the screen while the contents drop clear
of it. That's how `AppHeader` handles the status bar, and how `ui/sheet.jsx`
handles every side: a sheet pads by the insets of the edges it touches (a
left sheet gets `pt-safe pb-safe pl-safe`) and moves its close button by the
same amounts, since an absolutely positioned child is measured from the padding
edge and the padding alone wouldn't move it. `PageBar` needs no top inset
because it pins at `--appheader-h`, which already includes `--safe-top`.

**Margins for floating things.** A margin composes with whatever `bottom-*` or
`right-*` offset an element already uses instead of having to restate it at
every breakpoint. The FAB, the collapsed collab-chat launcher and its corner
panel from `sm` up, and the first-lesson wizard all use them.

**`px-safe-<n>` for side padding.** In landscape the notch is on one side, and
the header, `PageBar`, `PageBody`, the editor's panes and the lesson tabs all
run the full width of the screen. Writing `px-4 px-safe` wouldn't work: both
set `padding-left`, so whichever Tailwind emits last replaces the other rather
than adding to it, and `tailwind-merge` doesn't know to drop either. The
functional utility takes the spacing step and adds the inset in one
declaration (`calc(var(--spacing) * 4 + var(--safe-left))`).

Toasts get the same treatment through sonner's `offset` and `mobileOffset`
props in `ui/sonner.jsx`, which add the tokens to sonner's default 24px and 16px
gaps.

Every inset is zero where nothing is in the way, so none of this changes the
layout on a desktop or on a phone without a notch.

## Dialogs scroll on short screens

`DialogContent` caps itself at `max-h-[calc(100dvh-2rem)]` with
`overflow-y-auto`. A phone turned sideways is about 390px tall, and before the
cap a dialog taller than that ran off both ends of the screen with no way to
reach its buttons. The tall dialogs that scroll a list inside themselves
(history, merge, collaborate, variations) pass their own `max-h-[85dvh]`,
which replaces the default through `tailwind-merge`.

## The breadcrumb yields to the page's actions

`PageBar`'s trail (everything before the current page's title) only shows when
the crumbs have at least 16rem to themselves. That's a container query on the
crumb row (`@container/crumbs`), not a viewport breakpoint, because the room
left depends on the page's actions as much as on the screen: the editor's take
about 640px. Keyed off `sm`, the trail showed on a phone turned sideways,
squeezed the lesson's own title down to nothing, and then spilled out under the
buttons once the header made room for the notch.

## The nav is a sheet below `md`

`AppHeader` shows its destinations as inline links on desktop and moves them
behind a menu button into a `Sheet` below `md`. Following a link out of the
sheet closes it: a sheet covers the page you just navigated to, so it can't
stay put the way inline links do. The sheet also carries a **Settings** row,
because the gear it normally shares the utility cluster with is hidden at that
width (the whole cluster is, below `sm`; the notification bell and the account
menu are what stay, since an unread notification is worth a slot at any width).

The header holds one copy of each control at any width. The old `--primary`
header couldn't fit text buttons on a narrow screen, so most controls existed
twice (an icon-only copy under `md:hidden` and a labelled copy under
`hidden md:inline-flex`), and the lesson page kept a whole second copy of its
actions in an overflow menu.

## `dvh`, not `vh`

`100vh` is the _large_ viewport: it ignores the browser's retractable address
bar, so a `max-h-[90vh]` dialog can be taller than what's actually on screen.
Page wrappers use `min-h-dvh` and the tall dialogs (history, merge,
collaborate) use `max-h-[85dvh]`/`max-h-[90dvh]`.

`HomePage`'s hero deliberately keeps `min-h-[70vh] md:min-h-[78vh]`: `dvh` there
would resize the hero as the address bar hides and shows during scroll, which
is visible jank on a marketing page and worse than the problem it fixes.

## The collab chat is a bottom sheet on mobile

`CollabChat`'s expanded panel used to be a 420px-tall floating window inset 16px
from the bottom-left at `w-[calc(100vw-32px)]`, which on a phone covered most
of the screen _and_ sat on top of the editor's add-section FAB, while still
looking like a window that wasn't meant to.

Below `sm` it's now a proper bottom sheet: flush to the bottom edge, full width,
rounded at the top only, `h-[60dvh] max-h-[70dvh]`, with `pb-safe` so the
composer clears the home indicator. From `sm` up every one of those is reverted
and it's the original corner panel, with `sm:ml-safe sm:mb-safe` so a phone
turned sideways (which is `sm` and up) still keeps it off the notch and the
home indicator.

## Known gaps

- **Initial JS payload.** Routes are code-split and the export/import libraries
  (`docx`, `mammoth`, `html2pdf.js`) load on demand behind
  `src/lib/exports/load.js`, so a phone that only reads lessons never downloads
  them; previewing and viewing a lesson render through `LessonView` instead.
  What's left to watch is the editor chunk itself; see
  [How the export pipeline works](./export-pipeline.md).

## Installing to a Home Screen

The app ships a web app manifest and a service worker, so on a phone it can be
installed and opened in its own full-screen window, and the editor (already
local-first, see [Version history](../monorepo/version-history.md)) keeps
working with no network. The header's install button and the iOS Share menu's "Add to
Home Screen" instructions are covered in
[Installable app & offline use](./pwa-and-offline.md).
