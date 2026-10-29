---
title: Internationalization
description: How every string routes through react-i18next, the namespace layout, what stays untranslated, and the steps for adding a language.
---

# Internationalization

Every user-facing string in the web app is routed through
[react-i18next](https://react.i18next.com), so a new language is mostly a matter
of adding translation files, not touching component code. Only English ships
today, but the app is wired for more.

## The pieces

| File                                                                                              | Role                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/i18n.js`                                                                                 | i18next setup: imports every namespace's English resources and exports `namespaces`, `resources` and `baseConfig` (`fallbackLng`, `supportedLngs`, `defaultNS: "common"`). |
| `src/lib/languages.js`                                                                            | `LANGUAGES` registry backing the switcher on the [settings page](./pages-and-routing.md#the-routes); today lists only English. Also exports `DEFAULT_LANGUAGE`.            |
| `src/locales/<lng>/*.json`                                                                        | One JSON file per namespace, per language. Only `en/` exists today.                                                                                                        |
| [`i18next-browser-languagedetector`](https://github.com/i18next/i18next-browser-languageDetector) | Picks the visitor's language from `localStorage` then the browser, falling back to English.                                                                                |

`main.jsx` imports `./lib/i18n.js` once, before `App` renders, so every component can
call `useTranslation()` immediately.

## Namespaces

Strings are split into namespaces roughly by page or feature area, not lumped into
one file; that keeps each JSON file a manageable size and lets a translator work on one
area without wading through the whole app. The list below matches
`src/locales/en/` and the `namespaces` array in `i18n.js`:

| Namespace        | Covers                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common`         | `AppHeader`, `NotFoundPage`, the notification bell, the display-name dialog, the install button and service-worker update toast, the voice picker, shared `ui/` primitives (dialog, spinner, star rating) |
| `home`           | `HomePage` (marketing splash + signed-in dashboard)                                                                                                                                                       |
| `hub`            | `HubPage`                                                                                                                                                                                                 |
| `lesson`         | The routed lesson page and its tabs (`pages/lesson/`), `LessonView`, `LessonSummary`, `LessonTranslation`, `CommentsSection`, `PullRequestsSection`                                                       |
| `interactive`    | `InteractiveLesson` (the full-screen walkthrough and its speech controls), `MyLessonAnswers`                                                                                                              |
| `library`        | `LibraryPage` (the lessons on this device)                                                                                                                                                                |
| `login`          | `LoginPage`, `EmailCodeForm`                                                                                                                                                                              |
| `moderation`     | `ModerationPage`                                                                                                                                                                                          |
| `oauth`          | `OAuthAuthorizePage`                                                                                                                                                                                      |
| `profile`        | `ProfilePage`, `BioDialog`, `FollowListDialog`                                                                                                                                                            |
| `settings`       | `SettingsPage`                                                                                                                                                                                            |
| `editor`         | `EditorPage`, `SectionOutline`, `LessonPreview`, `DocumentImportDialog`                                                                                                                                   |
| `editorSections` | `SectionCard`, `ContentBlock`, `LessonTextInput`, `LessonTextToolbar`, `SourcesPanel`                                                                                                                     |
| `editorTools`    | `HistoryDialog` (incl. its `timeAgo` helper), `ChangeSummary`, `MergeDialog`, `VariationsDialog`, `ProposeChangesDialog`, `ImageSearchDialog`                                                             |
| `checks`         | The **Check lesson** panel: `LessonChecksSheet`, `FactCheckSection`, `AiFixDialog`, plus the check counts in `EditorPage` and `SectionOutline`                                                            |
| `richText`       | `RichTextInput`, `RichTextToolbar`                                                                                                                                                                        |
| `collab`         | `CollaborateDialog`, `CollabChat`, `CollabCursors`                                                                                                                                                        |
| `aiDialogs`      | `FirstLessonWizard`, `AiLessonIdeaDialog`, `AiQuestionDialog`, `AiTextDialog`                                                                                                                             |

A component can use more than one namespace (the editor reads `editor` and
`checks`); a new namespace must be added to both `namespaces` and `resources` in
`i18n.js`, or `useTranslation("yourNs")` silently renders missing-key
fallbacks.

## Usage in a component

```jsx
import { useTranslation } from "react-i18next";

function Example() {
  const { t } = useTranslation("hub");
  return <h1>{t("header.title")}</h1>;
}
```

Keys are nested and namespaced by component/section (`{"header": {"title": "..."}}`),
not flat, so a namespace's JSON mirrors the shape of the UI it backs.

Counted values use i18next's plural key suffixes rather than hand-rolled `... === 1 ?`
logic:

```jsx
t("list.count", { count }); // list.count_one / list.count_other in hub.json
```

A plain (non-component) helper, `HistoryDialog.jsx`'s exported `timeAgo()`, can't call
`useTranslation`, so it imports the shared `i18n` instance directly and calls
`i18n.t("editorTools:timeAgo.minutes", { count })`, with the namespace prefixed
explicitly since there's no `useTranslation` scoping it.

## What isn't translated

Not every string in a migrated file goes through `t()`. Left as is, deliberately:

- Debug-only `console.*` output and code comments.
- CSS class names, `data-*`/technical `aria-*` values, internal state-machine string
  literals (e.g. `"idle"`, `"docx"`, `"ours"`).
- User-authored content (lesson text, comments, bios, display names), which is data,
  not app copy. (A reader can still have a comment or a whole published lesson
  machine-translated into their own language, on their device: see
  [Comment translation](./comment-translation.md) and
  [Lesson translation](./lesson-translation.md). Those are separate features from
  this page's locale files, though both use `i18n.resolvedLanguage` as the
  target language.)
- Third-party attribution text supplied by an API (e.g. a Wikimedia image's
  [credit](./images.md)). Pixabay's credit line is the exception: it's
  built from a template in `editorTools.json`
  (`imageSearch.providers.pixabay.creditWithUser` / `creditNoUser`).

## Adding a language

1. Copy `src/locales/en/` to `src/locales/<lng>/` and translate every value (keep the
   keys and any `{{placeholders}}`/`_one`/`_other` suffixes identical).
2. In `src/lib/i18n.js`, import the new namespace files and add the language under
   `resources`, and add its code to `supportedLngs`.
3. Add `{ code: "<lng>", label: "..." }` to `LANGUAGES` in `src/lib/languages.js`.
4. Decide what the [server render](#the-server-render) should do for a visitor
   whose language isn't English (see below).

No component changes are needed: every string already resolves through `t()`, and the
switcher renders whatever `LANGUAGES` holds.

## The server render

`src/entry-server.jsx` builds a fresh i18next instance for every render from
`baseConfig`, with `lng: "en"` and `initImmediate: false`. A fresh instance
because module scope in a Worker is shared by concurrent requests, so a shared
mutable instance would let one request's language leak into another's.
`initImmediate: false` works because every namespace is compiled into the
bundle, so i18next initializes synchronously; adding a backend later would fail
loudly there rather than render missing keys into the HTML.

The server always renders English, which today is also what every client
resolves to, so hydration matches. Once a second language ships, a visitor whose
detector picks it would hydrate English markup with different text; the server
would need to learn the visitor's language (or the client would need to switch
after hydrating). See [Server rendering](./server-rendering.md).

## The switcher

The **Language** section of the settings page (labeled **Display language**)
reads `LANGUAGES` and calls `i18n.changeLanguage()`. While the registry holds a
single entry the control is disabled and says so ("English is the only language
available so far."), rather than offering a choice that isn't one; a second
entry turns it into a real select with no code change.

The choice persists itself: the language detector is configured with
`caches: ["localStorage"]`, so nothing in the page has to store it.
