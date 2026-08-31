---
title: Design system (surfaces, borders, boxes)
---

# Design system (surfaces, borders, boxes)

Every colour, radius and shadow in the web app comes from a token in
[`apps/web/src/styles/globals.css`](https://github.com/Spelling-Creator/spelling-creator/blob/main/apps/web/src/styles/globals.css).
Components reference tokens; they don't hard-code colours. That file has four
theme blocks — `:root` (light), `@media (prefers-color-scheme: dark)`, and an
explicit `[data-theme="dark"]` / `[data-theme="light"]` pair so a chosen theme
beats the OS preference — and the three colour blocks restate the same values
rather than sharing them, because a single combined selector can't win in both
directions.

## Surfaces are opaque, and borders do the separating

Three surfaces carry the app — the page, the boxes on it, and the chrome around
it — plus a tint for a box's header strip and the line that separates any of
them:

| Role                                | Token             | Light     | Dark      |
| ----------------------------------- | ----------------- | --------- | --------- |
| The page, as a tinted well          | `--background`    | `#f3f5fc` | `#0c0d16` |
| Content boxes sitting on it         | `--card`          | `#ffffff` | `#161829` |
| App chrome (sidebar, `PageBar`)     | `--sidebar`       | `#ffffff` | `#12131f` |
| The strip at the top of a box       | `--surface-muted` | `#eff2fb` | `#1c1f33` |
| The line that separates any of them | `--border`        | `#d5daed` | `#2c3050` |

All of these were translucent, over a tinted gradient, with a `backdrop-blur`.
That is worth knowing because it explains most of the rules below:

- **`--border` is a real edge.** It used to be white at 85% _on_ a white card,
  which draws nothing. A page could hold any number of surfaces and none of them
  had a boundary — the only thing separating two panels was a drop shadow. This
  is the single change that lets a long list stay legible, and it is what the
  rest of the system is built on.
- **`--card` is flat.** In dark, a translucent card took its colour from
  whatever happened to be behind it, so two identical panels on one page were
  different greys. A panel is now the same panel wherever it lands.
- **There is no `--glass-blur`.** `backdrop-filter` composites a layer per
  overlay, and with opaque surfaces it was filtering a background nobody could
  see through. The sticky `PageBar` and `LessonTabs` are opaque instead of
  translucent-plus-blur, which is cheaper and needs no filter at all.

## `--shadow-panel` means "this floats"

One shadow token, and it is not for cards. Anything in the page's own flow gets
a border and nothing else. `--shadow-panel` belongs only to things genuinely
above the page: `Dialog`, `Popover`, `DropdownMenu`, `Select`, toasts, the
mobile sidebar sheet, the collab chat and its bubble, and the editor's FAB.

If you are adding a surface and reaching for a shadow, the question to ask is
whether it floats. If it scrolls with the page, it doesn't.

## Radii: one value, everywhere a border is drawn

`--radius` and `--radius-panel` are both `0.5rem` (8px); `--radius-tile` is 6px
and `--radius-pill` is a pill. There used to be an 8 → 14 → 20px scale that grew
with the surface, which read as softness at button size and as an unfinished
edge at panel size — and made a card nested in a panel step visibly against its
parent's corner.

## The bordered box with a header strip

The app's main structural pattern, and the shape every listing uses:

```jsx
<div className="overflow-hidden rounded-panel border border-border bg-card">
  <div className="flex items-center gap-3 border-b border-border bg-surface-muted px-4 py-2.5">
    <Icon className="size-4 text-muted-foreground" />
    <h2 className="text-sm font-semibold">What's in here</h2>
    <span className="text-xs text-muted-foreground">how many</span>
  </div>
  <div className="flex flex-col divide-y divide-border">{rows}</div>
</div>
```

The strip is the part that earns its keep. It gives the box somewhere to say
what it holds **and how much**, which is usually the question the reader arrives
with, and which the rows can only answer by being counted. Where a count is
shown next to a filtered list, count what's on screen — the hub's listing counts
`visibleLessons`, so it stays true while a search narrows it rather than
reporting a total nobody can see.

Used by: `HubPage`'s drafts and published listings, `ProfilePage`'s lessons,
`PullRequestsSection`, and `SectionCard` — whose strip is also `sticky`, which
carries one extra constraint (see
[Navigating large lessons](./navigating-large-lessons.md)): **the card around a
sticky strip must not set `overflow-hidden`**, or it becomes the nearest scroll
container and the strip stops sticking.

## State pills

A proposal's state is a solid filled pill, not a tinted outline — down a column
of rows a 10% tint doesn't read at a glance. The colours follow the convention
every repository host uses:

| State  | Token         | Why                                                                                                                                                                                                           |
| ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open   | `--success`   | Green is open, as it is everywhere else this shape appears                                                                                                                                                    |
| Merged | `--primary`   | The brand indigo, kept for the outcome the flow aims at                                                                                                                                                       |
| Closed | `--secondary` | Grey. Deliberately **not** the red a repo host would use: closing a proposal here is a routine outcome, not a failure, and nobody using this should have to know GitHub's colour vocabulary to read it as one |

## Fields are defined by their border, not a fill

`Input`, `Textarea` and `SelectTrigger` have no background of their own in
either theme — stock shadcn gives them a `dark:bg-input/30`, and this app
doesn't. Two reasons: light mode has no fill either, so a dark-only one makes
the themes disagree about what a field is; and the app has several deliberately
text-like inputs (the document title, a section's name) that pass
`bg-transparent` and got a filled bar in dark anyway, because `tailwind-merge`
keeps a `dark:`-prefixed fill and an unprefixed one side by side and the dark
one then wins.

Buttons keep their dark fill. A thing you press should read as raised; a thing
you type into shouldn't.

## Adding to this

- Style through tokens. A literal colour in a component works in one theme.
- Don't define a colour only inside a `@media` or `[data-theme]` block — most
  viewers are in the un-stamped default state, and it won't apply to them.
- New surface? Border first, and reach for a shadow only if it floats.
