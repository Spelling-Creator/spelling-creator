---
title: End-to-end tests
description: "The browser tests under apps/web/e2e: what they cover, how they run against the stub API, how to run and write one, and why they exist ahead of the app's rewrite."
---

# End-to-end tests

`apps/web/e2e` holds the app's browser tests: [Playwright](https://playwright.dev)
driving a real Chromium through the hub, a lesson page, interactive mode, the
editor and a live collaboration session, against the
[stub API](../stub-api.md) rather than a real backend. They are the one kind of
test here that exercises the app the way a person does, pages and all, and
they are the spec the app's rewrite has to pass: every flow below has to work
the same in the new app before the old one goes.

## Running them

```bash
pnpm --filter @spelling-creator/web test:e2e
```

`playwright.config.ts` starts both servers itself, without portless, at the
addresses `apps/web/.env.stub` and the stub's defaults agree on: the stub on
`http://localhost:8787` and the app, in stub mode, on `http://localhost:5180`.
A server already running at either address is reused outside CI, which is how
to watch a test against your own dev servers (`PORTLESS=0 pnpm dev:stub` and
`PORTLESS=0 pnpm dev:web:stub`). The first start of the stub snapshots the
live hub's lessons into `apps/stub-api/.cache`, which is why its startup
timeout is generous.

The browser comes from
`pnpm --filter @spelling-creator/web exec playwright install chromium` the
first time (Playwright is a dependency of the web app only).
`pnpm test` leaves these tests out: they take a minute or two, and CI runs them
in a job of their own (`e2e` in `.github/workflows/ci.yml`), which keeps the
stub's snapshot of the hub between runs and uploads the HTML report when a run
fails.

## What they cover

| Spec                 | Flow                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hub.spec.ts`        | The hub lists the published lessons; search finds them by title or author; a lesson opens from the list with its tabs.                                                                                                            |
| `lesson.spec.ts`     | A published lesson shows its sections, spelling lists, question-type key and the About rail; interactive mode steps forward and back; the History tab lists commits; a visitor is asked to sign in before commenting.             |
| `discussion.spec.ts` | A signed-in reader posts a comment and rates the lesson.                                                                                                                                                                          |
| `editor.spec.ts`     | A lesson built with no account: title, a section, a text block; a version is taken once the writer pauses and shows in the history dialog; the library lists the lesson and opens it as it was left.                              |
| `collab.spec.ts`     | Two browsers: the host starts a session, the guest asks in from a lesson of their own and waits, the host admits them, the guest's editor takes the host's lesson, edits sync both ways, and the guest's own lesson is untouched. |
| `publish.spec.ts`    | A signed-in author saves a lesson to the hub, where it appears under their name.                                                                                                                                                  |

Every test is its own browser context with its own storage. The stub keeps
what a test publishes or comments until it restarts, and the browser keeps
what the editor saves, so a test that writes gives its writing a name no other
run has used (`unique` in `fixtures.ts`) and checks counts relative to what it
found rather than assuming a clean hub.

## Writing one

`e2e/fixtures.ts` is what the specs share:

- `signedIn(browser, "maya")` gives a context signed in as one of the stub's
  people, by seeding the session where supabase-js looks for it (see
  [From a script](../stub-api.md#from-a-script)) rather than going through the
  login page.
- `hubLessons(request)` and `lessonByTitle(request, "Penguins")` read the
  stub's hub. The stub credits a few of the live hub's lessons, by title, to
  its made-up people, and "Penguins" is Maya's, with a comment and a proposal
  on it, which is what makes it the one to test with.
- `startLesson`, `addSection` and `addText` are the editor's first steps, with
  the first-lesson guide out of the way.

Find elements by role and accessible name (`getByRole("button", { name: "Add
to lesson" })`), never by class or structure: the names are what a person
sees, they survive a restyle, and they are the names the rewrite has to keep.
When a page's names are not obvious, `page.locator("body").ariaSnapshot()`
prints the accessibility tree, which is how these specs were written.

A few of the app's own timings show through. The editor commits a version
after a four-second pause, so the version chip is awaited with a longer
timeout; a text block's editor and the title field commit a moment after
typing stops, so an assertion on what reached the other side of a live session
allows for that; and the "Save to cloud" and "Post comment" buttons answer
from the stub, which replays saved answers with a short delay.
