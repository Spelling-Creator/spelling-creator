---
title: Letterboard sync
description: "The hub side of a letterboard session: the PracticeRoom Durable Object, the WebSocket messages between host and board, and the limits on both."
---

# Letterboard sync

For how to use this, see
[Interactive mode: with a letterboard](../../guide/interactive-mode.md#with-a-letterboard).

A letterboard session keeps a tablet running
[Spelling Creator Board](https://github.com/playforge-coding/spelling-creator-board),
the companion letterboard app, in step with the Practice page. The partner runs
the lesson on a computer; the speller answers on the tablet. The step on the
tablet follows the computer, and the sentence being spelled appears in the
computer's answer box as it is spelled.

The contract both sides follow is `docs/live-sync.md` in the board's repository.
The board side was built first, against a fake socket; this page is the hub side
of that contract, which the board's own tests play the host against.

## Roles

- **Host**: the Practice page in a browser, signed in to the hub. It owns the
  lesson and the step, shows a share code, and records the answers through the
  existing [responses endpoint](./interactive-mode.md#worker-endpoints), since it
  is the signed-in side.
- **Board**: the tablet. It joins with the code only, no account, and follows.
  It may ask to move a step; the host decides and tells everyone where they are.

## Is it available here?

Only the Cloudflare Worker can host a session, since the room is a Durable
Object. Before interactive mode offers its letterboard button it asks the hub:

| Request         | Answer                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `GET /practice` | `200 { "available": true }`, or `false` on a Worker deployed without the `PRACTICE_ROOM` binding |

A self-hosted Node API doesn't register the route, so the request reaches the
frontend fall-through and answers `404`. The page treats that, a `false` and a
network failure alike: no button. The answer is kept for the page load
(`checkPracticeAvailable` in `apps/web/src/lib/practiceLink.js`), except a
network failure, which is asked again the next time a walkthrough opens.

## Transport

One WebSocket per participant at `wss://<hub>/practice/<code>`, served by the
Worker next to `/collab/<code>` (`handlePractice` in `apps/api/src/routes/practice.js`).
The host opens it with `?create=1&token=<jwt>`, like a collaboration host; the
board opens it with no query string. The Worker verifies the host's Supabase JWT,
applies the join limits, and forwards the upgrade to the `PracticeRoom` Durable
Object for that code with the role in an `X-Practice-Role` header. The token
never reaches the room, and a client-supplied copy of the header is dropped.
`practiceRoom(env, code)` is the one place a code becomes a room address, and it
folds case again, so no path can split one session across two objects.

The token is in the query because a browser can't set a header on a WebSocket,
the same trade `/collab` makes. It is a Supabase access token, which expires
within the hour, and it travels over TLS to Cloudflare's edge, which terminates
the connection itself. Anyone running a proxy in front of a hub should keep
query strings out of its access logs for `/practice` and `/collab`.

Messages are JSON text frames, one object each, with a `type`. Every other field
is optional, so either side can add fields later without breaking the other, and
an unknown `type` is ignored on both sides. Anything the room relays is rebuilt
from the fields listed below rather than forwarded as received, so a participant
can't pass extra fields to the other side.

The room keeps the sockets alive with Cloudflare's auto-response: the board sends
a WebSocket ping every 25 seconds, which the runtime answers itself, and the host
(a browser, which can't send a protocol ping from JavaScript) sends a text `ping`
that is answered with `pong` without waking the object, exactly as the
collaboration client does.

### Codes

A code matches the collaboration rule `[A-Za-z0-9_-]{1,128}` (`SESSION_CODE_RE`,
exported from `routes/collab.js` and imported here, so the two can't drift), and the Worker
folds it to capitals before addressing the room, so a partner typing a code on
a tablet doesn't have to hold shift. The Practice page issues six characters from
an alphabet with no letters that look like digits and no digits that look like
letters (`newPracticeCode` in `apps/web/src/lib/practiceLink.js`), about 887
million codes. The code is the only secret: the room refuses a second host rather
than letting whoever holds the code take a session over, and boards' joins are
limited by address (below).

## Messages

Board to host (relayed to the host only):

| Type     | Fields            | When                                                                                                                        |
| -------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `join`   | `client: "board"` | Right after the socket opens. The room has already answered it: `hello` goes out when the socket is accepted.               |
| `text`   | `text`            | Every time the sentence on the board changes, including when it clears. Interactive mode puts it in the answer box.         |
| `answer` | `text`            | The partner tapped Done on a question. Interactive mode records it as the answer to the current step and moves on.          |
| `step`   | `step`            | The partner tapped Previous or Next on the board. Interactive mode moves if it agrees; the `state` that follows says where. |

Host to board:

| Type      | Fields                        | When                                                                                                                    |
| --------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `hello`   | `lessonId?`, `step?`, `text?` | When the board's socket is accepted, with the host's last `state`. No `lessonId` means no lesson is open yet.           |
| `state`   | `lessonId?`, `step?`, `text?` | Whenever the lesson, the step or the answer box changes, including after every `answer` or `step` from a board.         |
| `removed` | `message?`                    | The host ended the session (its socket closed). The board's socket is then closed with code 1000.                       |
| `error`   | `message?`                    | The room refused the join: no session with that code, or the session is full. The socket is then closed with code 1008. |

The room sends the host two messages of its own, which are not part of the board
contract and never reach a board: `hello` with `boards`, the number of boards
listening when the host connected, and `boards` with `count` every time one joins
or leaves. The Practice page shows the count beside the code.

`step` is the index, from 0, in the walkthrough `buildInteractiveSteps` produces
(see [Interactive mode](./interactive-mode.md#derived-from-the-document)): a
section's material as one step, then each question as its own. The board computes
the same walkthrough from the same document, so an index means the same screen on
both. While the summary is showing, the host reports the last step's index.

`text` in a host message is the answer box's content, which is empty on a content
step. The board takes it only onto an empty board (a board that just joined
mid-answer); otherwise the board's own words are the source, and `text` from the
board replaces the answer box rather than adding to it.

## What the room validates

| Field      | Rule                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `lessonId` | A non-empty string of at most 100 characters; anything else is left out of the stored state.                      |
| `step`     | A non-negative integer up to 100,000; anything else is dropped (from a board) or left out (from the host).        |
| `text`     | A string, cut to `MAX_RESPONSE_LENGTH` (5,000 characters, the same cap as a saved answer); anything else dropped. |
| A frame    | Text only, at most 32 KB, valid JSON with a string `type`.                                                        |

A `state` keeps only the fields the host sent and the room accepted, so a host
that omits `text` doesn't clear a board's sentence, and a late board's `hello`
carries exactly what the host last said.

## Lifetime

- **One host.** A second `create=1` on a live code is refused with `409`. When a
  host connects to a code a previous session used, the stored state is cleared
  first, so nothing of the old session reaches the new one's boards.
- **The room dies with its host.** When the host's socket closes, every board is
  sent `removed` and closed, and the state is deleted. A board that joins the code
  afterwards is told there is no session. The lesson stays open on the board, so
  the speller can carry on alone.
- **A board leaving** only changes the host's `boards` count.
- **A socket on its way out is retired at once.** A refused board, the boards of
  a host who has left, and that host are marked (`retire`) the moment the room
  is done with them, and nothing counts or addresses a marked socket. A socket
  stays in the room's list until its close handshake finishes, and without the
  mark a board from an ended session could be counted for, or sent the state of,
  a new host who took the code over in that window.
- **The last state is in storage**, not memory, so a board that joins after the
  object has been evicted while its sockets hibernated is still caught up. It is
  a row in the object's SQLite database, written synchronously, so storing it
  doesn't put an await in front of the broadcast on every keystroke. The output
  gate still holds the broadcast until the write is durable.

## Limits

| Limit                         | Value                                                    | Where                                                                                         |
| ----------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Sessions started, per user    | 5 per minute (token bucket)                              | `takeJoinToken` in `lib/joinLimit.js`, keyed `practice-rl:user:<uid>` by `routes/practice.js` |
| Board joins, per address      | 10 per minute (token bucket)                             | the same, keyed `practice-rl:ip:<ip>` from the platform seam's `clientIp`                     |
| Boards per session            | 10                                                       | `MAX_BOARDS` in `practice-room.js`                                                            |
| Messages per connection       | 30 `text` or `state`, 5 `answer` and 5 `step` per second | `RATE` in `practice-room.js`                                                                  |
| Anything else, per connection | 10 per second, shared                                    | `RATE.other`: `join`, unknown types and frames that aren't JSON                               |
| One frame                     | 32 KB                                                    | `MAX_MESSAGE_BYTES`                                                                           |

Over-budget messages are dropped, and a connection that exceeds its budget 100
times (`MAX_VIOLATIONS`) is closed as abusive. Boards are anonymous, which is why
their joins are limited by address where a collaboration join is limited by user;
the limit is what keeps guessing a code from being cheap. A board join with no
address is refused with `400` rather than put in a bucket shared with every other
such join, where one client could spend everyone's. Cloudflare's edge always sets
the address, so in practice this only turns away a request that bypassed it.

A stored bucket that doesn't parse is treated as no bucket, so a corrupt row
starts a fresh one instead of failing every join until it expires.

Refusals the Worker makes before the upgrade (an invalid code, a host who isn't
signed in, a rate limit, a missing binding) are HTTP statuses (`400`, `401`,
`429`, `500`), which a board sees as a connection that failed. Refusals the room
makes (no session, full) are an `error` message over the socket it opened, which
the board can show.

A browser isn't told the status of a refused upgrade either, so the Practice
page can't say which of those it was. It reports a socket that closed before
`hello` as `refused` ("The hub turned the session down"), suggesting a minute's
wait for the commonest cause, and one that dropped after `hello` as
`disconnected`.

## The host in the browser

`usePracticeHost` (`apps/web/src/lib/practiceLink.js`) owns the socket. It
takes the lesson id, the step index and the answer box's text as props, and
sends a `state` whenever any of them changes, coalesced over 50 ms so a burst of
keystrokes is one message. The first `state` goes out on `hello`, so a board
that was waiting on the code is caught up at once; from then on the room's
stored copy of the last `state` does that for later boards. What the board sends
comes back as three callbacks, `onText`, `onAnswer` and `onStep`, and the hook
reports `status` (`idle`, `connecting`, `live`), the `code`, the number of
`boards` and an `error` key the component translates.

`InteractiveLesson` wires those callbacks to its own state:

- `onText` replaces the current question's answer. On a content step there is no
  answer box, so it is ignored.
- `onAnswer` records the text as the current question's answer and moves on, as
  **Next** does; on the last step that finishes the lesson, with the responses
  rebuilt from the answers as they will be rather than from the render that
  hasn't happened yet (`finish(answersNow)`). On a content step, Done just moves on.
- `onStep` moves to the step named if it exists, stopping at the last step for
  anything past it, and from the summary goes back into the lesson as **Back**
  does. Nothing is echoed: the `state` the hook sends on the resulting change is
  the answer.

The session ends with the walkthrough: closing interactive mode stops the hook,
and so does unmounting it. The letterboard button and its popover are
`LetterboardLink.jsx`, rendered only once the hub has said it can host one
(`usePracticeAvailable`, above), and the start button only for a signed-in
user, since the host files the answers. The WebSocket base comes from
`apiWsUrl()` in `@spelling-creator/core/config`, the same helper live
collaboration uses.

## Deploying

The room needs the `PRACTICE_ROOM` binding and the `v3` migration in
`apps/api/wrangler.jsonc`, both of which ship with the code. Wrangler applies
the migration on the next `wrangler deploy` (`pnpm deploy`), with nothing to run
by hand. Three things follow from it being a Durable Object migration:

- **Use `wrangler deploy`.** A gradual rollout made with
  `wrangler versions upload` can't apply a Durable Object migration.
- **Leave an applied migration alone.** Cloudflare records which tags have run,
  so editing or removing `v3` later makes the next deploy fail. A later change to
  the classes is a new tag.
- **Roll forward, not back.** A rollback to a version from before the migration
  isn't offered, so undoing this release means deploying a fix.

## Where the code lives

| File                                            | What it does                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/api/src/practice-room.js`                 | The `PracticeRoom` Durable Object: roles, the stored state, relay, validation, limits                    |
| `apps/api/src/routes/practice.js`               | `handlePractice`, `handlePracticeInfo`, `parsePracticeCode` and `practiceRoom`: gate, limits, forwarding |
| `apps/api/src/lib/joinLimit.js`                 | The join token bucket, shared with `/collab`                                                             |
| `apps/web/src/lib/practiceLink.js`              | `usePracticeHost`, `usePracticeAvailable` and `newPracticeCode`                                          |
| `apps/web/src/components/LetterboardLink.jsx`   | The tablet button and popover in interactive mode's top bar                                              |
| `apps/web/src/components/InteractiveLesson.jsx` | Where the board's text, answers and moves are applied                                                    |
| `apps/stub-api/src/practice.js`                 | The same room on the local [stub API](../stub-api.md), so a session can be tried without Cloudflare      |
