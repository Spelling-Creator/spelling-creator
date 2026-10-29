---
title: Navigating large lessons
description: "How the editor keeps a 37-screen lesson navigable: sticky section headers, question numbers, collapsible sections, the outline and find in lesson."
---

# Navigating large lessons

For how to use this, see [Navigating large lessons](../../guide/navigating-large-lessons.md).

A finished lesson is long. The editor is a single scrolling column, and past a
certain size that column stops being navigable: you scroll, you lose track of
which section you're in, and the block you were fixing becomes unfindable.

This page records what that costs, measured, and the mechanisms that answer it.

## How long "long" actually is

Measured against a lesson built to the standard shape the MCP server documents:
6 sections x (2 text paragraphs + 4 spelling words + 15 questions), 108 blocks:

|                 | desktop 1280x800 | phone 390x844 |
| --------------- | ---------------- | ------------- |
| Page height     | ~29,700px        | ~45,700px     |
| In screenfuls   | **37**           | **54**        |
| One section     | ~4,900px         | ~8.9 screens  |
| Scrollbar thumb | 21px             | 16px          |

Where the height goes, by block type (desktop):

| Block type            | Count | Each      | Total    | Share   |
| --------------------- | ----- | --------- | -------- | ------- |
| Questions (all types) | 90    | 159-359px | 23,094px | **77%** |
| Text                  | 12    | 192px     | 2,304px  | 8%      |
| Spelling              | 6     | 278px     | 1,668px  | 6%      |

Question blocks are three quarters of the scroll. Anything that compresses them
buys more than anything else can; see [What isn't solved yet](#what-isnt-solved-yet).

## Sticky section headers

Each section's header row (number, name, block count) is `sticky` and pins
directly below the app bar, so the section you're in is named on screen the
whole time you're inside it. It hands off to the next section's header the way
any sticky list does.

Two details make it work:

- **It pins to `--header-h`, not to `0`.** `globals.css` publishes the chrome's
  heights as tokens: `--header-row-h` (`AppHeader`'s row) and `--pagebar-row-h`
  (`PageBar`'s; each bar applies its own as `h-(...)`, so the tokens are the
  single source of truth), `--appheader-h` (the header plus `--safe-top`, the
  status-bar inset the header pads itself by on an iPhone, most visibly in the
  [installed app](./pwa-and-offline.md); it's where `PageBar` pins its top, see
  the safe areas part of [Mobile layout & touch targets](./mobile-layout.md)),
  and `--header-h`, the sum of all of it: the real distance from the
  top of the viewport to the first pixel of page content on a page with a
  `PageBar`, which is every page that pins anything. Use it for whatever has to
  sit clear of the chrome, including `scroll-mt-(--header-h)` on anything
  scrolled to programmatically.
- **The row bleeds out of the card's padding.** It lives inside `SectionCard`'s
  `p-4`, so it carries `-mx-4 -mt-4 px-4 pt-4` to reach the card's edges;
  otherwise blocks would scroll visibly through the gap beside it. It takes
  `bg-surface-muted` rather than the card's own `bg-card`, which is what makes
  it read as the card's **header strip**, a tinted bar naming the section,
  instead of a row of content that happens to be pinned. (It used to be
  `bg-card` plus `backdrop-blur-(--glass-blur)`, because `--card` was
  translucent and content would otherwise show through the pinned row. Both went
  when the surfaces went opaque.) `z-30` keeps it under the app bar's `z-40`.
- **`SectionCard` must not set `overflow-hidden`.** However much the strip's
  rounded top corners invite it, it would make the card the nearest scroll
  container and this header would stop sticking. The strip rounds its own
  corners with `rounded-t-panel` instead.

Nothing between the header and `<body>` sets `overflow` to anything but
`visible`, which is the usual thing that silently breaks `position: sticky`. Keep
it that way.

### Only the identity is pinned

The section header holds two things: identity (number, name, size) and controls
(move up, move down, delete). Below `sm` the controls wrap onto a second row
(see [Mobile layout & touch targets](./mobile-layout.md) for why they can't share
the first), and pinning that second row made the sticky header **113px, 13% of
an 844px screen**, on top of the app bar's own 64px.

So only the identity row is sticky. The controls are rendered twice, once inside
the identity row (`hidden sm:flex`) and once below it (`sm:hidden`), with a
breakpoint hiding whichever copy doesn't apply; `display: none` takes the
hidden copy out of the accessibility tree too, so only one is ever exposed. On a
phone the sticky header is 65px (8%) and the controls scroll away with the top
of the section.

The rule this encodes: **permanent screen space is for knowing where you are,
not for controls you go looking for when you want them.**

## Question numbering

A question block used to show its type badge and nothing else, so ten "Open
ended" cards in a row were visually interchangeable and scrolling back to the
one you were fixing was a guess. Each now shows its 1-based position among its
section's questions, `Q7`, which makes it nameable.

Numbered **per section, not per lesson**, because that's how questions are
authored and read (the MCP authoring standard specifies fifteen per section, in
a fixed order). `SectionCard` computes the numbering and passes it down as a
plain number; it stays a stable prop, so inserting a question mid-section
re-renders only the blocks whose number actually changed.

The section header shows `18 blocks` alongside the name for the same reason:
it gives the section a length that isn't just a scrollbar. Desktop only; on a
phone the name needs that row.

## Collapsing sections

Every section folds to its header, from the chevron at the left of that header
or all at once from **Collapse all** next to the lesson's section/block counts.
Measured on the same 108-block lesson:

| State                         | Page height | Screens (800px) |
| ----------------------------- | ----------- | --------------- |
| Everything expanded           | 29,667px    | 37              |
| One section open, five folded | 5,933px     | 7.4             |
| Everything folded             | **1,186px** | **1.5**         |

A folded card keeps its number, name, block count and move/delete controls, and
shows what's inside (`2 paragraphs · 1 spelling list · 15 questions`) because
a section reduced to a name alone says nothing about what it holds or how far
along it is.

### The state is local, and per tab

Collapsed state lives in `EditorPage`, **not** in the document. It isn't
content, it must never reach the exporters, and it is never sent to
collaborators; the same reasoning as `SectionCard`'s `activeBlockId`. What one
person folds away to get some screen back is theirs, not everyone's.

It's held there rather than per-card so that "collapse all" is possible, and
reaches each card as a plain boolean so folding one section doesn't re-render
the others. It persists to `sessionStorage` (key
`s2c-lesson-maker:editor-collapsed`), per tab, like the focus position
below.

### Find-in-page still works

A folded body is hidden with **`hidden="until-found"`**, not unmounted, so the
browser can still search it; when Cmd-F lands on a match inside, the browser
reveals the content and fires `beforematch`, which the card listens for and
adopts into React state.

The attribute is set imperatively from a `useLayoutEffect`, deliberately not
through JSX, because **React treats `hidden` as a boolean attribute** (still
true on React 19, which the app uses):
`hidden="until-found"` renders as a plain `hidden=""`, which is `display: none`
and not searchable at all. This was verified in the browser; it is not a
one-line prop. Since React never renders the attribute, the two can't disagree,
including when the browser removes it on a match.

Browsers without `until-found` support fall back to hiding the content
outright, which is what unmounting it would have given us anyway.

### Consequences of `content-visibility: hidden`

`hidden="until-found"` is `content-visibility: hidden` underneath, and its
descendants **still report a full-size `getBoundingClientRect()`**. Anything
that measures elements has to account for that; measuring alone will not tell
you the content is hidden.

`CollabCursors` is the case in the codebase today: it pins a caret and avatar to
`[data-collab-field]` elements, and a field inside a folded section measured
perfectly reasonably, so a collaborator's avatar would be drawn floating over
the collapsed card. It now skips fields that fail `Element.checkVisibility()`,
falling back to `closest("[hidden]")` where that API is missing. A collaborator
editing inside a section you've folded is simply not shown; their edits still
arrive as normal.

### Folding never loses your place

Three interactions would otherwise leave the user somewhere arbitrary:

- **Folding a section you're inside** pulls thousands of pixels out from under
  the viewport. If the card's header has already scrolled past, the card is
  scrolled back to just under the app bar first. Verified: collapsing from
  3,000px deep inside a section leaves that card's top at exactly the app bar's
  bottom edge.
- **Collapse all / expand all** changes the page height by ~25x, which on the
  way down means the browser clamps you to the bottom of a suddenly-short
  document. The section you were in is pinned to the top of the viewport
  instead, in both directions.
- **Restoring a position** into a section you'd folded scrolls to the section's
  card rather than expanding it behind your back. A collapsed section is a
  decision; its header still gets you to the right place.

### Dragging into a folded section

Cross-section drag-and-drop still reaches a collapsed section: dwell over one
with a block in flight and it **springs open** after 500ms, on a dwell rather
than on the first `dragover` so that dragging _past_ a folded card on the way
somewhere else doesn't keep re-flowing the page under the pointer. While it's
still folded, its summary line becomes the drop zone, and dropping there before
the spring fires expands the card and appends the block, the same thing an
empty section does, rather than swallowing the block into a card you can't see.

## Position is preserved across edits

Three things used to throw away the user's place.

**Reordering.** `moveSection` and `moveBlock` reorder elements that are
screenfuls tall. Under a fixed `scrollY` that flings the thing you just moved
(and the button you just pressed) far off screen: "move section down" landed you
in the middle of a _different_ section.

`lib/useScrollAnchor.js` fixes this. Call the returned `anchor(selector)`
immediately **before** the state update that reorders the DOM; after React
commits, the hook re-measures that element and scrolls by the difference, so it
ends up back under the same pixel. It anchors the _moved_ element rather than
the page, which is what makes the move buttons repeatable: they stay under the
pointer, so a block can be walked up a section one click at a time. Measured
drift after a section move: **0px** (previously ~4,900px).

The correction runs in `useLayoutEffect`, not `useEffect`, so it lands in the
same frame as the reorder; otherwise the page paints once at the wrong offset
and visibly jumps.

It's bounded by the scroll range: reordering inside a document only a screen or
two tall (every section collapsed, say) can leave some drift (measured: 131px,
with the page already clamped at its maximum scroll) because there is nowhere
left to scroll. Unavoidable rather than a defect, and in a document that short
whatever moved is still on screen.

**Deletes deliberately don't use it.** Deleting only changes layout _below_ the
deleted element, and you can only delete something you can see, so nothing above
the viewport shifts and there's nothing to correct.

**Adding a section.** A new section is appended to the end of the document,
which in a six-section lesson is ~30,000px below wherever the user is standing:
the dialog closed and, as far as the screen showed, nothing happened. The editor
now scrolls to the new card and puts the cursor in its name field. The focus
call passes `preventScroll: true`, or it would jump the viewport there instantly
and cancel the smooth scroll that had just started.

**Leaving and coming back.** The editor records the last block that held focus
and returns there on the next mount, so a reload or a trip to the hub doesn't
drop you at the top of a 54-screen document.

It stores a **block id, not a scroll offset**: block heights change as the
lesson is edited and as images load, so a pixel position points at something
else by the time it's used, while an id still means the thing you were working
on. It's written by a `focusin` listener straight to `sessionStorage` (key
`s2c-lesson-maker:editor-focus`; the `s2c-` prefix is a historical name kept so
existing keys still work), entirely
outside React; lifting `SectionCard`'s local `activeBlockId` up to `EditorPage`
would re-render every section on each focus change, the exact cost keeping it
local avoids on a 108-block document.

`sessionStorage`, not the IndexedDB draft store, because this should expire with
the tab: coming back to a lesson tomorrow ought to start at the beginning;
coming back from the hub five minutes later ought not to. Restore runs once per
mount, so it can never yank the page from someone who has already started
scrolling, and it scrolls instantly rather than smoothly: this is where you
already were, so it shouldn't play as a journey.

## Scrolling to something, generally

`lib/useScrollAnchor.js` exports two helpers alongside the hook:

- `scrollToElement(el, { block, smooth })` honors the OS "reduce motion"
  setting. A smooth scroll is worth it for a deliberate jump (you see where
  you're being taken) but never for restoring a position on load. Restores pass
  `smooth: false`.
- `idSelector(attr, id)` builds `[data-block-id=…]` through `CSS.escape`. Ids
  are not always ours: `jsonImport`'s `keepId()` passes any string in a lesson
  file through verbatim, and one containing a quote would make `querySelector`
  throw.

Scroll targets align with `block: "center"` when the target is a block:
aligning a block to the top of the page would put it underneath its own
section's sticky header.

## The section outline

`src/components/editor/SectionOutline.jsx`, from 52rem of page column: a
numbered list of the lesson's sections down the left of the editor, with each
section's block count beside it. Clicking one scrolls to it.

Sticky headers answer _where am I_; this answers _where is everything else_. At
37 screenfuls those are different questions, and the scrollbar (a 21px thumb)
answers neither. Getting to section 5 from section 1 was a scroll of roughly
20,000px or a collapse-all followed by a hunt; it is now one click.

Three deliberate limits:

- **It navigates, and does not reorder.** Moving sections stays on the cards,
  where the move buttons and drag targets already are, and where the scroll
  anchor (see [Position is preserved across edits](#position-is-preserved-across-edits)) keeps the page still
  through the move. An outline you could also drag would be a second, subtly
  different way to do the same thing.
- **It scrolls via `scrollToElement`** from `lib/useScrollAnchor.js` (the same
  helper collapsing, collapse-all, restoring a position and adding a section
  use; the move buttons use its sibling `idSelector` with the scroll anchor)
  and relies on `SectionCard`'s own
  `scroll-mt-(--header-h)` to land clear of the bar, rather than computing an
  offset of its own.
- **It appears at 52rem of _page column_, not of viewport.** The measurement is
  against `AppShell`'s `@container/page`, so anything that ever narrows the page
  column takes the outline away without the window changing size; see the part
  on laying out against the container in
  [Pages & routing](./pages-and-routing.md).
  Below that threshold the editor is a single column and the outline would be
  spending width the document needs. **Collapse all**, which is the cheap way to
  see a lesson's shape on any screen, therefore stays on the document panel (as
  a labeled button) as well as in the outline header (as an icon button whose
  "Collapse all" / "Expand all" is its accessible name).

A collapsed section shows "hidden" instead of its block count: folded away in
the document, the outline is the only place it appears at all.

A section the [lesson checks](./lesson-checks.md) found problems in shows how
many, in red, before the block count. Problems only: suggestions describe the
usual shape of a lesson, and a count on every section of a deliberately short
lesson would make the outline look broken when nothing is.

The same outline stands beside the editor's **Preview**, with `readOnly` set:
collapse-all and add-section drop away, and the list keeps working unchanged.
It can, because it addresses a section by `data-section-id` and `LessonView`
publishes that attribute, with the same `scroll-mt-(--header-h)`, on each
`<section>` it renders, exactly as `SectionCard` does in the editor. The two
surfaces never coexist (preview replaces the panes rather than sitting beside
them), so one id always matches one element. A 37-screen lesson is no easier to
move around in when you are reading it back than when you are writing it, which
is the whole reason the preview gets an outline at all.

## Find in lesson

`src/components/LessonFind.jsx`, over `@spelling-creator/core/lessonFind`.
Find-in-page (above) tells you a word is on the page; this tells you where. A
37-screen document has ninety questions that all look alike, and the browser
scrolling to a highlighted word in the middle of one of them doesn't say it
was Q7 of section 3. The find names each hit by its section and its place in
it, shows the words around the match, and goes there on a click.

### The matching is lexical, on purpose

`lessonFindEntries(doc, translation)` flattens the lesson into one entry per
searchable place: each section's name, and each block's words (a text
block's paragraphs, a spelling list, a question's prompt with its answers
and steps, a picture's caption but not its credit, a VAKT activity with its
link labels, a heading). Every field is read through the text helpers
(`textBlockLines`, `inlineTextPlain`), so a formatted passage, a formula or
a read-aloud hint matches by what shows on the page. When the page shows a
translation, the entries are built from it: `translation` is the same Map
from `lessonSegmentKey` keys to strings that `LessonView` draws from, and
every segment it covers is indexed translated, the rest as written, which is
exactly what is on screen (and still so while a translation is arriving
section by section). Spelling words and link labels never translate, there
or here. Entries carry the section's id and index and the block's id, plus a
per-section `number` for text blocks and questions, which is what the row
label ("Paragraph 2", "Q7") is made from; the question numbering is the same
count `SectionCard` draws. Each entry also carries its text folded for
matching, so the lesson is folded once per open of the popover rather than
once per keystroke.

`findInLesson(doc, query, entries)` keeps the entries whose text holds every
whitespace-separated term of the query. Matching folds case and marks on
both sides (NFD, every combining mark stripped with `\p{M}`, so Hebrew
niqqud and Arabic harakat go the way Latin accents do, then lowercased) and
keeps a map from each folded UTF-16 code unit to the original offset of the
character it came from, so a hit is reported as ranges in the original string
even where folding changed a character's length: an accented letter loses a
unit, an astral character (an emoji) is two units either way, and a
precomposed Hangul syllable decomposes into two or three jamo, in which case
a match ending inside the jamo runs to the end of the syllable. There is no
fuzziness and no query syntax: a lesson is a thousand
words whose author knows the word they want, and "any part of a word, case
and accents ignored" is what a browser's find does, which is the behavior a
reader expects from a box called Find. The hub's search is fuzzy
(`lessonSearch`, Fuse.js) because its field is a title someone half
remembers; that is a different problem. Each result carries a `snippet`: a
window of about 150 characters around the first match, started and ended on
a word where it can be, as runs with the matches marked, which the component
draws with `<mark>`.

An on-device embedding model was considered for this and turned down. The
text weights alone are about 175 MB per device, the capability gate would
hide the feature from phones and from any browser without WebGPU, and a
single lesson is too small for semantic retrieval to find anything a
substring doesn't. If semantic search is ever wanted, the place for it is
across the hub's lessons, not within one.

### The component

A popover (`Popover` from the UI kit) off a **Find in lesson** button: an
input, a count line, and a `listbox` of hits. The input keeps the keyboard
(`role="combobox"`, `aria-activedescendant`); the arrow keys move the
selection (and scroll the list to keep it in view, since focus never leaves
the input) and Enter chooses it, and the rows are clickable with
`tabIndex={-1}` so Tab never walks the list. It shows the first 50 hits and
says so (`shownOf`): a query matching more than that wants another word, not
a longer list. Nothing is indexed while the popover is closed: in the editor
the lesson changes on every keystroke and two copies of the component sit on
the page, so the entries are built on open and the matching runs per
keystroke in the box.

Choosing a hit closes the popover first, because the page is about to scroll
a long way and a popover anchored to a button that has scrolled off the top
is no use, then goes there through `scrollToLessonTarget` (below) and draws
a brief ring around the block with the Web Animations API, so the eye lands
on it rather than on the middle of the screen. Focus goes with it: the
block's first field in the editor (a section-name hit lands in the section's
name), the way the Check panel's findings do, or the block itself on the
lesson page, where nothing is editable (the wrapper gets `tabIndex=-1`), so
the next Tab starts from the hit and a screen reader is told where it is.
That is also why `onCloseAutoFocus` is prevented for that close and only
that one: Radix would otherwise return focus to the trigger, and focusing
it scrolls the page straight back, against the scroll that has just started.
Escape and a click outside keep the usual return to the trigger. The query
and results survive the close, so going to the next hit is one click and one
key.

`scrollToLessonTarget({ blockId, sectionId }, then)` in
`lib/useScrollAnchor.js` is the one anchor contract the lesson surfaces
share, used by the Check panel's `goToFinding` and by this. It waits two
animation frames (one for whatever the caller changed, a section unfolding
or preview closing, to render, one for layout), finds the block by
`data-block-id` or, failing that, its section by `data-section-id`, hands it
to `then`, and scrolls to it (`block: "center"` for a block, so it doesn't
land under its section's sticky header; `"start"` for a section, as the
outline does). `then` runs before the scroll, not after: focusing a
rich-text field puts its caret into view on its own, even with
`preventScroll`, which cut a smooth scroll started just before it short and
left the block at the bottom of the screen. Done first, that jump happens and
the deliberate scroll has the last word.
`SectionCard`'s `BlockRow` already published `data-block-id` for drop
targeting; `LessonView` now publishes it too, on a plain wrapper `<div>`
around each block, so the same code works in the editor, in the editor's
preview and on the public lesson page without knowing which of them it is
on. The wrapper is a div with no class: the document's own styles are
descendant rules (`.s2c-lesson-root p` and the like) and apply through it
unchanged.

`onSelect` is the one hook the host gets, called with the hit before the
scroll. The editor passes `revealFindHit`, which expands the hit's section
through `toggleCollapse(id, false)`, for the reason `goToFinding` does: a
block has to be on the page to be scrolled to. (It doesn't leave preview,
since the preview answers to the same block ids.) The lesson page passes
`translation` instead: `TranslatableLesson` reports the map it is showing
through `onTranslation`, `LessonOverview` keeps it, and the find searches
what the reader can see rather than the English underneath it.

### Where the button is

In the editor it is at the top of the section outline, which is the one part
of the editor that stays on screen: the search for the next hit is always one
click away, however far the last one scrolled the page. Below 52rem of page
column there is no outline, so the document panel's stats row carries a
second copy (`@min-[52rem]/page:hidden`, the complement of the outline's own
`@min-[52rem]/page:block`), and since preview replaces the document panel,
`LessonPreview`'s header row carries that copy's seat in preview. The copies
are separate instances with separate queries, which only shows if the window
is resized mid-search; sharing the state would mean lifting it into
`EditorPage` for a case nobody hits.

The lesson page (`LessonOverview`) does the same: a copy in the About rail,
which is sticky beside the lesson from 52rem, and a copy above the lesson
for the widths where the rail is stacked under it.

## What isn't solved yet

The section outline above was one of the answers this page called for. One
further step the measurements point at, still not built:

- **Collapsing inactive question blocks** to a single line, expanding on focus.
  This is where the 77% lives: measured at **10,354px** (-65%) _with every
  section still expanded_, so it compounds with section collapse rather than
  competing with it, and it needs no navigation UI at all. It's also the most
  invasive change to how editing feels, which is why section collapse came
  first; that may well be enough.

One further idea, worth considering only if the outline and collapse-all turn
out not to be enough between them: a jump-to-section dropdown on the sticky
header, for the widths where the outline isn't shown.

Two approaches were considered and rejected: rendering one section at a time
(`Tabs`) and virtualizing the block list. Both break cross-section
drag-and-drop, which the [user guide](../../guide/overview.md) lists as a
headline feature, and both break find-in-page.
