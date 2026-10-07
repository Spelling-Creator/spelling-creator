---
title: Live sessions
---

# Live sessions

An assistant can join a [live collaboration session](/web-app/live-collaboration) as a
participant, the same way a second teacher would: it gets a slot in the room, its edits
appear on everyone's screen as it makes them, and the host can remove it at any moment.

Its edits are credited in the lesson's version history like anyone else's: the host's
next commit names the account the assistant is signed in as in a `Co-authored-by`
trailer. When that is the host's own account there is nobody new to credit, so the
commit is simply the host's. See
[who gets credit](/web-app/live-collaboration#who-gets-credit-in-version-history).

## Why not just edit the lesson

Because while a session is running, **the lesson on the hub is not the lesson**. A
session's document lives in the room until somebody saves it, so the stored copy is
whatever it was before the session started. An assistant using `patch_lesson` during a
session is editing a stale copy, and the host's next save overwrites whatever it did.

The other half is that a room is two-way. An API write is a statement; a session is a
conversation: the assistant edits under a participant of its own, the teacher watches
each change land, and the session chat is a channel for asking rather than guessing.

## The tools

| Tool                   | What it does                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `join_collab_session`  | Ask to join by share code and wait for the host to admit you. Call it again to keep waiting. |
| `read_collab_doc`      | The lesson as the session holds it now, plus any chat since you last asked.                  |
| `edit_collab_doc`      | Apply `patch_lesson`-shaped operations to the shared document.                               |
| `send_collab_chat`     | Say something to the room.                                                                   |
| `leave_collab_session` | Leave, freeing the slot and leaving the lesson as it is.                                     |

A typical flow:

```text
(the user clicks Collaborate in the editor and reads out the code)
join_collab_session({ code: "…" })    -> waits most of a minute for them to admit you;
                                         if they haven't yet, says so and keeps the
                                         request open for the next call to resume
read_collab_doc()                     -> the live lesson, with ids
send_collab_chat({ text: "Adding section 3 now." })
edit_collab_doc({ operations: [ … ] })
leave_collab_session()
```

## Asking, not listening

The web app takes part in a session over a WebSocket. The MCP server can't: between two
tool calls it may not exist. On the [remote transport](/mcp-server/remote-mode) it runs
inside a Durable Object that is built to hibernate between requests and rebuild its tool
server on the way back, so a socket opened by one tool call would be gone by the next. A
"proxy" that held the socket open on the server's behalf would have to keep that object
awake for the whole session, against the grain of the platform, and still invent a
reconnect story for the eviction it couldn't prevent.

So the assistant is not a connection. It is a **record in the room**. `CollabRoom`
(`apps/api/src/collab-room.js`), the Durable Object that already holds the session's
authoritative Yjs document and roster, keeps one row per assistant and answers questions
about it over plain HTTP:

| Request                           | What it does                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /collab/:code/agent`        | Ask to join. A pending request the host sees in the Collaborate dialog; returns a participant token.                                          |
| `GET /collab/:code/agent?wait=s`  | The session now: admitted or not, roster, chat since the last ask, where every caret is, the document. Waits up to `s` seconds for admission. |
| `POST /collab/:code/agent/update` | A Yjs update to merge, as raw bytes.                                                                                                          |
| `POST /collab/:code/agent/chat`   | `{ text }`: say something to everyone.                                                                                                        |
| `DELETE /collab/:code/agent`      | Leave.                                                                                                                                        |

Every ask after the join carries the participant token in `X-Collab-Agent`, next to the
same `Authorization: Bearer` the rest of the API takes. The Worker (`handleCollabAgent` in
`apps/api/src/routes/collab.js`) verifies the account on each one and forwards the
verified identity exactly as it does for a socket; the room checks the record exists and
belongs to that account.

Each tool call is therefore one request, or two. `read_collab_doc` is one `GET`.
`edit_collab_doc` is a `GET` for the current document and cursors, then an update built
on a replica of what came back (`updateFor` in `apps/mcp/src/collab.js`), reconciled the
same way the browser reconciles, so it carries only the fields that changed and merges
with whatever the teacher typed in between. Nothing is pushed to the assistant; what a
socket would have been told as it happened, an agent is told on its next ask. The room
keeps a bounded inbox of chat for it, remembers the latest cursor per participant, and
hands over the whole document each time, which is the same bytes however many edits
preceded.

All the server carries between calls is a small handle: the share code, the participant
token, and its slot. `registerTools` takes a `sessionStore` for it. The default is a
variable, which suits stdio (one process per client); the remote transport passes
`durableSessionStore(this.ctx.storage)` from `HubMcp`, so the handle lives in the
connection's Durable Object storage and a server rebuilt after hibernation is back in the
session without asking the host anything.

## Admission

The host has to admit an assistant, as they would anyone. The join returns at once with
the request pending, and `join_collab_session` then waits inside the call for most of a
minute (`JOIN_WAIT_MS`), as a few long asks the room holds open rather than a tight loop.
It stops well short of a minute so it never collides with an MCP client's own request
timeout. If the host hasn't clicked by then, the tool says so and the request **stays in
their dialog**: calling `join_collab_session` again with the same code resumes that
request rather than sending a second one. A request nobody answers is withdrawn by the
room after five minutes.

A decline is final. If the room says the host declined (or removed the assistant), the
tool reports that and clears the handle; it does not quietly ask again, and the tool
description tells the model not to rejoin unless the user asks.

## Who the host sees

An assistant joins on the user's own account; it holds their token, because that is the
only identity it has. Left alone that puts two participants in the room with the same
name, and the host has no way to tell which one is a person.

So the join declares itself: `join_collab_session` sends `{ assistant: "<client name>" }`,
taking the name from the connecting MCP client's own account of itself, and the Worker
renders the participant as:

```text
Ms Kelly · Claude        [AI]
```

The decorated name flows into the chat labels automatically, since they read from the
presence roster; the roster entry also carries `bot: true`, which is what the **AI** badge
in the Collaborate dialog reads. An agent has no caret, so it draws no floating cursor.

**This is self-declared, and deliberately not a security control.** The account is
authenticated; the label is not. A connection that lies can only make itself _look_ like an
assistant, or decline to admit that it is one (neither of which grants it anything), and
the room still gates what matters on the host admitting a participant they can see. What
it buys is that the honest case, which is every case shipped here, is legible.

The label is bounded to 40 characters and stripped of control characters, line breaks and
the `·` separator, so it cannot crowd out or impersonate the display name that _was_
verified.

## What the design leans on

Three properties of the room, none of them new and none changed by asking instead of
listening: the session tools are built on the collaboration model the web app already had.

- **Admission is the host's.** A joining participant waits until the host adds them, so
  nothing here can put an assistant into a session uninvited. That gate already existed for
  people; the assistant is subject to it unchanged, through the same `ADMIT` frame.
- **Edits merge.** The room is a CRDT, so an assistant writing section 3 while the teacher
  writes section 5 costs neither of them their work.
- **Removal is instant.** The host can eject a participant mid-edit with the same `REMOVE`
  frame, and the assistant's very next request is answered `410 Gone` with the reason.

## What does not merge

Text within **one field** is still last-write-wins: `reconcile` stores it as a plain
string (see `packages/core/src/ydoc.js`), so two people typing in the same paragraph means
one of them loses a sentence.

`edit_collab_doc` therefore refuses any operation addressing a block another participant's
cursor is currently in, and names who is there:

```text
Someone else's cursor is in a block this edit would rewrite: b7 (Ms Kelly). Text in a
single field doesn't merge — one of you would lose the sentence. Edit somewhere else, or
ask in the chat for them to move off it and try again.
```

Cursors come back with the state read at the moment of the edit, not from a cache. They
are advisory and go stale, so this is a guard against the common case, not a lock.

## Validation is reported, not enforced

`edit_collab_doc` runs the [authoring standard](/mcp-server/lesson-validation) over the
result and reports what the edit breaks, but it does **not** reject. This is the user's
live document with the user watching: refusing a change they just asked for, because a
different section is off-standard, would be worse than telling them about it. The writing
tools that save to the hub still reject, as they always did.

## Nothing is saved

`edit_collab_doc` changes the session's document and nothing else. The lesson is the host's
to keep (they save it from the editor), so an assistant should **not** follow up with
`update_lesson` or `patch_lesson` to "finish the job": that writes to the stale stored copy
and the host's next save discards it.

## Availability and lifetime

- **Both transports.** The tools are registered on stdio and on the remote endpoint alike,
  because nothing is held open on either. (They used to be stdio-only, when the assistant
  was a socket.)
- **No runtime requirement.** The server no longer needs a WebSocket implementation, so the
  Node 22 floor the session tools once carried is gone; they work wherever the rest of the
  server does.
- **One session at a time.** An assistant in two sessions has no way to say which one an
  edit is meant for. `join_collab_session` refuses a second code while one is open or
  pending.
- **Idle expiry.** A participant with no socket can't disconnect by vanishing, so the room
  sweeps once a minute and lets go of an admitted assistant that has made no request for
  thirty minutes, and a pending request nobody has answered after five. The assistant's
  next call is told so and told to join again. The record is kept as a tombstone for ten
  minutes after it ends, so that late call learns _why_ rather than finding nothing.
- **Same limits.** An agent counts toward the room's ten participants and is held to the
  same per-participant edit and chat budgets as a socket; one that keeps ignoring them is
  let go the way a socket would be closed.

## The wire protocol

The room (`apps/api/src/collab-room.js`) and the browser (`apps/web/src/lib/collab.js`)
speak the frame format defined once in `packages/core/src/collabFrames.js`. It used to live
as two copies joined by a comment reading "must match T in collab-room.js", which is a
convention rather than a guarantee; a renumbered frame is not a crash but a silent misread,
on a byte array nobody can eyeball.

The assistant speaks none of it. Its side is the handful of HTTP requests above and the
JSON they answer with; the only binary it handles is the Yjs update, which is opaque to
everyone but Yjs at both ends.
