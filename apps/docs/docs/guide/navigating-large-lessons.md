---
title: Navigating large lessons
---

# Navigating large lessons

A finished lesson is long. Six sections, each with a couple of paragraphs, a
spelling list and fifteen questions, comes to about 37 screens on a computer
and about 54 on a phone. The editor has a few things that keep a lesson that
size easy to move around in.

## The section header stays in view

Each section's header (its number, its name and, on a wider screen, how many
blocks it holds, such as "18 blocks") stays pinned under the app bar while you
scroll through that section. When you reach the next section, its header takes
over. You always know which section you're in.

On a phone, only the number and name stay pinned. The **Move section up**,
**Move section down** and **Delete section** buttons scroll away with the top
of the section, so the pinned strip takes as little of the screen as possible.

## Questions are numbered

Every question shows its place in its section next to its type, as `Q1`, `Q2`
and so on. Ten "Tight open" questions in a row would otherwise look the same,
so the number is what lets you find the one you were working on again. The
numbers start over in each section, and they only appear in the editor: they
aren't added to the lesson or printed.

## Folding sections away

Any section can be folded down to its header with the arrow at the left of the
header, and **Collapse all** (next to the lesson's section and block counts,
under the title) folds every section at once. Press it again (it now says
**Expand all**) to open them all back up. With everything folded, a 37-screen
lesson fits on about a screen and a half, which makes it the quickest way to
see the shape of a lesson.

A folded section still shows its name, its controls and what's inside it, for
example "2 paragraphs · 1 spelling list · 15 questions". You can still move it
up or down.

A few things worth knowing:

- **Folding is just for you.** It isn't saved into the lesson, it never affects
  an export, and people editing with you don't see what you've folded. It's
  remembered in that browser tab until you close it.
- **Find in page still works.** Searching the page (Cmd-F or Ctrl-F) finds text
  inside folded sections, and the browser opens the section to show you the
  match. (A few browsers can't do this; there, folded text is simply hidden from
  the search.)
- **You don't lose your place.** Folding the section you're in, or using
  Collapse all or Expand all, keeps the section you were in at the top of the
  screen instead of dropping you somewhere else.
- **You can drag a block into a folded section.** Hold the block over it for a
  moment and the section opens. If you let go sooner, the section opens and the
  block goes at the end of it.
- **People editing with you.** If someone is editing inside a section you've
  folded, their cursor isn't shown there. Their changes still arrive as normal.

## The section list

On a wide enough screen, a numbered list of the lesson's sections, headed
**Sections**, sits down the left side of the editor. Each entry shows how many
blocks the section has, or "hidden" if you've folded it. Click a section to jump
straight to it.

If the [lesson checks](./lesson-checks.md) found problems in a section, the
list shows how many in red next to it. Suggestions aren't counted there, only
problems.

The list is for getting around, not for rearranging. To move a section, use the
buttons on the section itself, or drag its blocks. The list's header also has a
button to collapse or expand every section, and one to add a section.

The same list stays beside the lesson when you press **Preview**, so you can
jump around while reading the lesson back too.

On narrower screens there isn't room for the list, so it's hidden. Collapse all
is the way to get an overview there.

## Your place is kept

- **Moving a section or block** keeps it under your pointer. You can press
  **Move up** or **Move down** again and again without the page jumping away.
- **Adding a section** takes you to the new section and puts the cursor in its
  name, even when it's added at the bottom of a long lesson.
- **Coming back** to the editor after reloading the page or visiting the hub
  puts you back at the block you were last working on. This lasts as long as the
  browser tab is open, so a lesson you come back to the next day starts at the
  top.

For how this works, see the [developer notes](../developers/web-app/navigating-large-lessons.md).
