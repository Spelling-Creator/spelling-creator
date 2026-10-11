---
title: Stub API (local backend)
---

# Stub API (local backend)

`apps/stub-api` stands in for the real API on your own machine. It answers
the routes the hub, profiles, notifications, version history, live
collaboration and the AI features use, with a populated hub and a handful of
made-up people, so you can work on (or record, or screenshot) the signed-in side
of the app without a Supabase project, a Cloudflare account or production data.

It was built to record the demo videos in these docs, and it's the quickest way
to see any hub feature end to end.

## Running it

```bash
pnpm dev:stub           # the stub, on http://localhost:8787
pnpm dev:web:stub       # the app, on http://localhost:5180, pointed at it
```

Then open `http://localhost:5180/login` and sign in as anyone below, with any
password. The username alone is enough (`maya`), and so is `maya@example.com`.

`dev:web:stub` runs Vite with `--mode stub`, which reads `apps/web/.env.stub`
(committed, since it holds nothing but local URLs). That file also sets
`VITE_AUTH_MODE=both`, which is what lets the sign-in field take a username or an
email address. It uses port 5180 rather than Vite's usual 5173 so it never
collides with an ordinary `pnpm dev:web`, and it fails rather than drifting to
another port (`--strictPort`), because the stub builds links to that address.

## Who's in it

| Sign in as | Name          | Who they are                                                                            |
| ---------- | ------------- | --------------------------------------------------------------------------------------- |
| `maya`     | Maya Rivera   | Practitioner. Owns two published lessons and a draft.                                   |
| `daniel`   | Daniel Okafor | Practitioner. Maya follows him.                                                         |
| `priya`    | Priya Shah    | Practitioner with the most lessons and followers.                                       |
| `lars`     | Lars Nielsen  | Practitioner who writes in Danish and English.                                          |
| `jordan`   | Jordan Ellis  | Parent and communication partner to Theo. Has a proposal open on one of Maya's lessons. |
| `sam`      | Sam Carter    | Practitioner. Mostly comments.                                                          |

None of them is a real account. They live in `apps/stub-api/src/people.js`.

## What's in the hub

The lessons are **real published lessons**, read from the live hub's public API
the first time the stub starts and cached in `apps/stub-api/.cache/`. That
directory is gitignored: the lessons are other people's work and are never
committed. Refresh the copy with:

```bash
pnpm --filter @spelling-creator/stub-api snapshot
```

Each lesson is credited to one of the people above instead of its real author
(see `OWNERS` in `src/seed.js`, matched by title; a lesson the live hub has
gained since is shared out among Daniel, Priya and Lars), and given a git
history that grows it a few sections at a time, built with the same git code the
editor uses. On top of that the stub seeds ratings, a few discussions, follows,
and Maya's notifications, and Jordan's proposal to Maya's _Penguins_, built as a
real branch of its history so the review and merge work. Lesson images are
fetched from the live hub on first use and cached alongside the lessons.

Everything you do (comments, follows, publishing, merges) is kept in memory.
Restarting the stub puts the hub back the way it started.

## What works, and what doesn't

Works: the hub and search, lesson pages and all their tabs, comments and
ratings, publishing and drafts, forking, version history, proposals and merging,
profiles and following, the home page's feeds, notifications including **Send
link**, sign-in and sign-out, live collaboration with cursors and chat, and the
AI features: lesson ideas, suggested text and questions, **Fix with AI** and
fact checking (see [AI and Turnstile](#ai-and-turnstile) below). Wikimedia image
search works too, since it talks to Wikimedia directly.

Doesn't, by design: Save to Google Docs (it needs a real OAuth client),
moderation (everyone is an ordinary user), and anything that needs real email.
Pixabay image search only works if you give the stub a key of your own
(`PIXABAY_API_KEY=... pnpm dev:stub`); without one, searching it says the
server isn't configured.

Where the stub knowingly differs from the real API:

- A **Send link** notification pointing into the app is stored as a path, not
  the full URL. The real API stores the URL, and the bell opens a full URL in a
  new tab, which would break a recording.
- Pushing a lesson's history always succeeds. There is no compare-and-swap,
  because nobody else can be editing the same history.
- Image uploads and interactive mode's saved answers are accepted and then
  forgotten.
- The collaboration room leaves out AI assistants joining over HTTP, rate
  limits and persistence.
- Turnstile always passes. The widget is a stand-in and its token is never
  checked (see below).
- The AI rate limit and answer cache are kept in memory, so they reset with the
  stub.

## AI and Turnstile

The AI features are gated by Cloudflare Turnstile, which can't run without a
Cloudflare account, so the stub brings its own stand-in. `apps/web/.env.stub`
sets `VITE_TURNSTILE_SCRIPT_URL`, and `vite.config.js` loads the script from
there (`/turnstile/v0/api.js` on the stub) instead of from Cloudflare. It
defines the `window.turnstile` the app uses and draws each widget as an image:
"Verifying..." for a moment, then "Success!", with no challenge to solve.

The AI requests themselves (`POST /`) go to the Worker's own handler,
`handleAi` in `apps/api/src/routes/ai.js`, so the prompts, the checks a fix has
to pass and the fact check's lookups are the real ones. The stub only swaps
three things: the Turnstile check (it passes), the rate limiter's storage
(memory), and the model. The model is the Worker's `openai-compatible`
provider, pointed back at the stub's own `/stub-model/v1/chat/completions`.

That endpoint answers from saved answers in `apps/stub-api/.cache/ai/`, one
file per prompt. When there isn't one, it can ask Claude:

```bash
STUB_AI=claude pnpm dev:stub                       # ask `claude -p` when nothing is saved
STUB_AI=claude STUB_AI_MODEL=haiku pnpm dev:stub   # a faster model (default sonnet)
```

That needs [Claude Code](https://claude.com/claude-code) installed and signed
in. Each answer is saved as it arrives, so asking the same thing again replays
it, with or without `STUB_AI`. That makes a run repeatable: the first one fills
the saved answers, and every later one gets the same lesson ideas, text, fixes
and facts. Lesson, section and block ids are swapped for placeholders before a
prompt is matched, so a lesson imported or forked again (which gets new ids)
still finds its answers. A saved answer takes 1.2 seconds to arrive, so the
app's loading states show as they would for real. Without `STUB_AI` and with
nothing saved, the AI dialogs say "The stub API has no saved answer for this.
Start it with STUB_AI=claude to ask Claude."

The thumbs down under a suggested text works as on the real API, and also
deletes the saved answer, so the next try is newly written.

Fact checking still looks facts up on Wikidata, the Smithsonian's volcano
records and Wikipedia, so it needs a network connection.

## Two people at once

`http://localhost:8787/split` shows the app twice, side by side: the left pane
from `localhost:5180` and the right from `127.0.0.1:5180`. Those are different
origins, so each pane has its own storage and can be signed in as someone
different. Sign in as Maya on the left and Daniel on the right, and you can try
**Collaborate** with both sides in view. `?left=` and `?right=` set each pane's
starting path, and `?leftName=` and `?rightName=` the labels above them.

## From a script

The server can be started from code, which is how its tests
(`apps/stub-api/test/`) run:

```js
import { startStub } from "@spelling-creator/stub-api";

const stub = await startStub({ port: 0 }); // 0 picks a free port
// ... stub.url, stub.state ...
await stub.close();
```

A browser can also start out signed in, without going through the login page,
by seeding the session where supabase-js looks for it. For example, in
Playwright:

```js
import { sessionFor, storageKey } from "@spelling-creator/stub-api/sessions";

await context.addInitScript(
  ([key, value]) => localStorage.setItem(key, value),
  [storageKey("http://localhost:8787"), JSON.stringify(sessionFor("maya"))],
);
```

`startStub` takes `port` (default 8787), `appOrigin` (where the app runs,
default `http://localhost:5180`), `dataDir` (the snapshot, image cache and saved
AI answers, default `apps/stub-api/.cache`), `hubUrl` (where to snapshot from,
default the live hub at `https://spellingcreator.org`), `now` (the time the
seeded dates count back from, default the real time), `ai` (`"claude"` to ask
Claude when no answer is saved), `aiModel` (default `"sonnet"`),
`aiReplayDelayMs` (how long a saved answer takes, default 1200) and `log`. From
the command line the same settings are the `PORT`, `APP_ORIGIN`,
`STUB_DATA_DIR`, `HUB_URL`, `STUB_AI` and `STUB_AI_MODEL` environment
variables. The package also exports the made-up people as
`@spelling-creator/stub-api/people`.

## Where the code lives

| File               | What it does                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `src/cli.js`       | The `start` and `snapshot` commands, reading the environment variables.     |
| `src/server.js`    | `startStub`: loads the snapshot, seeds the hub, starts HTTP and WebSockets. |
| `src/routes.js`    | The API routes, plus the Supabase Auth endpoints sign-in uses.              |
| `src/seed.js`      | Who wrote what, ratings, comments, follows, notifications.                  |
| `src/git.js`       | Lesson histories and the proposal, as real packfiles.                       |
| `src/collab.js`    | The collaboration room, a trimmed copy of the Worker's `CollabRoom`.        |
| `src/people.js`    | The made-up people.                                                         |
| `src/sessions.js`  | Signed-in sessions for scripts.                                             |
| `src/snapshot.js`  | Reading and caching the live hub's published lessons and images.            |
| `src/split.js`     | The side-by-side page.                                                      |
| `src/ai.js`        | The AI routes: the Worker's handler, saved answers and `claude -p`.         |
| `src/turnstile.js` | The stand-in Turnstile script.                                              |

Reading the hub is public; writing, and anything that is yours, needs a session,
as on the real API, and the stub answers 401 without one. When a route the app
uses is missing, the stub answers 404 and logs `not stubbed: <method> <path>`,
which is the place to start.
