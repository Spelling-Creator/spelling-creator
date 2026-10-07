---
title: Live collaboration
---

# Live collaboration

Press **Collaborate** in the editor toolbar to edit a lesson together with other
people in real time. Each participant opens **a single WebSocket** to a
server-side **room**, a [Cloudflare Durable Object](https://developers.cloudflare.com/durable-objects/)
(`CollabRoom`) that is the authority and relay for the session. The companion
Worker verifies your **Supabase sign-in** before the connection reaches the room,
so **only logged-in users can host or join**, and your identity is established
server-side (it can't be spoofed by the client).

**Host vs. guest.** Whoever opens the session is the _host_; everyone else is a
_guest_. The room caches the current document so it can hand the latest copy to a
guest the moment they're added.

1. The host clicks **Start a collaboration session** and gets a short **session
   code** plus a one-click **invite link** (`/?join=<code>`, which deep-links a
   recipient straight to the join screen).
2. A guest pastes the code (or opens the invite link) and connects. Connecting
   does **not** yet make them a collaborator.
3. The guest appears in the host's **Waiting to join** list. The host clicks
   **Add to lesson**; this is the gate the feature is built around: only after a
   guest is _added_ does the room send them the lesson and start syncing edits.
   The host can decline a request or remove a collaborator at any time. **Trusted
   collaborators** (an email list saved on the lesson) skip the waiting room and
   are admitted automatically.

   That trusted list carries further privileges outside the live session: a
   trusted collaborator may **save the lesson** (the only non-author who can)
   and may **merge a pull request** into it, deciding alongside the author which
   proposed changes land. See
   [Version history](/monorepo/version-history#what-a-trusted-collaborator-may-not-do)
   for what that does and does not let them do, and
   [Pull requests](./pull-requests.md) for the review flow.

4. Once added, edits sync **both ways**: the room merges each change into the
   session's document, re-broadcasts it to the other admitted collaborators, and a
   presence roster shows everyone in the lesson.

**Where a guest's copy lives.** A guest joins from their own editor, which has
one of their own lessons open, and that lesson's library entry and version
history are tied to whatever the editor holds. So when the host adds them, the
editor first saves and checkpoints the lesson they had open, then moves them
into a new lesson in [their library](./local-lessons.md) for the session (or
reuses the open one if it is untouched), and only then shows the host's
document. Edits that arrive during the move wait in the session's Yjs document,
and the guest sends nothing until the move is done, so their own lesson is
never overwritten and never merged into the host's. The session's copy stays in
their library after the session ends. It isn't attached to the host's hub
lesson: publishing it makes a new lesson rather than updating the host's. If
the move fails, the guest leaves the session with an error instead. That
includes the guest opening or starting another lesson while the move is still
saving: their choice wins, and since the session then has nowhere safe to go,
they leave it rather than have it land in the lesson they just opened.

`useCollaboration` takes this as `onAdmitted`, which `EditorPage` answers with
`openSessionLesson`.

**Conflict handling (CRDT).** Edits are merged with a **CRDT** ([Yjs](https://yjs.dev)),
not applied last-write-wins. Two people working on **different blocks, sections or
fields** both keep their work; previously the document was synced whole, so
whoever typed last silently overwrote the other. Every participant keeps a Yjs
document mirroring the lesson, the room holds the authoritative copy, and only the
**changes** travel over the wire rather than the whole lesson on every keystroke.

The one deliberate limit: text is merged **per field**, not per character. If two
people type into the **same** field at the same time, one of them still wins (both
sides agree on which). Editing different blocks, the normal case, always merges.
A formatted text block is one field too: its whole tiptap document is a single
value, so the same rule applies to it (see
[Formatting, footnotes & sources](./formatting-and-footnotes.md#collaboration-history-and-merging)).
The lesson's sources are a list keyed by id, so two people editing different
sources both keep their work.

**What the room never carries.** The trusted list itself is stripped out of the
document before it is reconciled into the Y.Doc, and so never reaches the room or
anyone in it. Those are email addresses, and the host admits people who aren't on
the list; there is no reason for a guest to receive everyone else's address to
edit a lesson. Nobody in the session needs it: only the host reads it, to
auto-admit trusted guests, from their own copy. The host puts it back on each
document they adopt from the room; a guest doesn't, because their local copy is
a lesson of their own made for the session, not the host's lesson. See
[Version history](/monorepo/version-history#what-is-deliberately-not-versioned-or-shared-at-all).

**Binary wire protocol.** Messages are sent as **binary WebSocket frames** for
speed: a one-byte type tag followed by the payload. Cursor and chat payloads are
UTF-8 JSON; document payloads are opaque Yjs update bytes, which the room relays
without parsing. A participant is identified by a server-assigned numeric **slot**
rather than by name in every packet; the client maps slot to identity from the
presence roster to label cursors and chat. The frame shapes are defined once, in
`@spelling-creator/core/collabFrames`.

**Who gets credit in version history.** Everyone's editor keeps committing the
lesson as usual while a session runs, so the commit that picks up a guest's
edits is taken in the host's editor and signed by the host. To make sure the
guest isn't left out, the room sends an `EDITED` frame naming the sender's slot
just ahead of every update it relays (stamped by the room, like a cursor's slot,
so nobody can claim someone else's edit). The client looks that slot up in the
roster, which carries each participant's account id, and keeps a list of who
has edited since the last commit. The next commit credits each of them with a
standard git `Co-authored-by:` trailer, and the history then reads "Alex, with
Sam and Priya".

Only people whose edits actually arrived are credited. Someone who only watched
isn't, and the room sends `EDITED` only for an update that changed its
document, so re-sending an update the room already holds earns nobody credit. Neither is the author themselves, which also covers an assistant
connected on the author's own account. The trailer holds the account id rather
than an email address, because a published lesson's history is public; see
[Version history](/monorepo/version-history#who-made-a-version).

`EDITED` is a frame of its own rather than a slot added to `UPDATE`, so an
editor or MCP server built before it existed simply skips it and goes on
working; its commits just don't credit anyone.

**Live cursors.** Each collaborator's text selection is relayed to the others, so
you can see where everyone is working. `useSelectionBroadcast`
(`src/lib/useSelectionBroadcast.js`) reports the local selection, the hook exposes
everyone else's via `collab.selections`, and `CollabCursors.jsx` renders the
floating coloured carets/avatars over the editor.

A selection travels as `{ field, start, end }` character offsets whatever kind
of field it is in. Inputs and textareas report `selectionStart`/`selectionEnd`,
and their caret is placed by mirroring the field off screen. A text block's body
is a tiptap editor (a contenteditable) instead, so its offsets are counted over
the block's plain text: each paragraph's words, one character for each break
between paragraphs, and nothing for a footnote marker. Every collaborator holds
the same plain text, so an offset taken on one screen lands on the same
character on another, and the caret is placed with a DOM `Range` at that
character (`contentEditableSelection` and `contentEditableCaretRect` in
`@spelling-creator/core/browser/presence`). Since text blocks commit about 200ms
after a pause, a caret can sit a few characters off for that moment while a
collaborator is mid-word; an offset past the end of the block clamps to it.

A caret is drawn only for a field that's actually on screen. Sections you have
[collapsed](./navigating-large-lessons.md#collapsing-sections) are hidden with
`content-visibility`, whose descendants still measure as full-size, so
`CollabCursors` tests `Element.checkVisibility()` rather than geometry;
otherwise a collaborator editing inside a folded section would have their avatar
pinned over the collapsed card. Their edits still arrive as normal; only the
marker is suppressed. Collapsed state is per-person and never leaves the
browser, so nobody else's view is affected by what you fold away.

**Live chat.** Once you're collaborating, a floating chat panel (`CollabChat.jsx`,
pinned to the bottom-left) lets everyone in the session talk. It appears for the
host as soon as a session is live and for a guest once the host has added them.
The transcript is **ephemeral**: it lives only in memory for the duration of the
session and is not saved anywhere; a launcher badge shows the unread count while
the panel is collapsed.

**Rate limits.** Because the relay is server-side, it is rate-limited to keep it
cheap and abuse-resistant: at most **5 session joins per minute** and **6
concurrent hosted rooms** per user, **10 participants** per room, and per
connection a budget of **30 document updates, 15 cursor moves and 2 chat messages
per second** (a single update is capped at 512 KB, a ceiling that only the host's
opening copy of the lesson ever approaches, since ordinary edits are a few bytes).
Over-budget traffic is dropped, and a connection that keeps flooding is closed.

**Implementation.** `@spelling-creator/core/ydoc` owns the CRDT: it maps the editor's plain
lesson document (`{ title, sections: [...] }`) onto a Yjs document and back. The
editor itself is untouched by any of this: it keeps working on plain objects, and
`ydoc` keeps a Yjs document in step underneath, matching sections, blocks,
spelling words and answers by the stable `id` they already carry. Its `reconcile`
is **idempotent**, which is what stops a received edit from bouncing straight back
to the sender.

`src/lib/collab.js` is a `useCollaboration` hook that owns the WebSocket, the
Yjs document, the slot-to-identity roster, the admission state and the chat
transcript. `src/components/CollaborateDialog.jsx` is the control panel (host/join
landing, invite sharing, the waiting-to-join admission list, and the roster). It
is addressed by URL rather than by component state: `/editor/collaborate` opens
it and leaving the panel closes it, so the back button works and a host can send
someone a link to it. Navigating in or out preserves the query string: an
invite arrives as `?join=<code>`, and dropping it on the way into the panel
would break the very flow that opened it.
`EditorPage` wires the hook's `onRemoteDoc` to its `setDoc`, passes the access
token, and watches `doc` so local edits broadcast automatically.

The server side lives in `apps/api/src/collab-room.js` (the `CollabRoom` Durable
Object, which holds the session's authoritative Yjs document, persists it to
SQLite so it survives hibernation, and relays updates) and `handleCollab` in
`apps/api/src/routes/collab.js` (the JWT gate, connection rate limits, and
forwarding to the room).

Not every participant has a socket. An AI assistant joining through the
[MCP server](/mcp-server/live-sessions) can't hold a connection between tool
calls, so the room keeps it as a record instead: it joins, is admitted and
removed through the same `ADMIT` and `REMOVE` frames, and appears in the roster
like anyone else (badged **AI**), but it reads the document and its chat by
asking over HTTP (`handleCollabAgent`, same file) rather than being pushed
frames. The room keeps a bounded chat inbox and the latest cursor positions for
it between asks, and a once-a-minute sweep lets go of one that stops asking,
since it has no socket to close. Its edits arrive as ordinary Yjs updates, so
`EDITED` credits them to its slot and version history treats them like
anyone's.

`collab.coAuthors` is how the session hands its list of editors to version
history. Every path in `useLessonGit` that commits the live document (the
regular checkpoint, switching or starting a variation, and first publishing)
reads it (`peek`) and then drops the people it checked (`clear`), whether or
not there turned out to be anything to commit: finding nothing means their
edits are already in a commit or were undone. Someone who edits again while
that commit is being written stays on the list for the next one. Moving to
another lesson empties the list (`discard`), and the editor takes a checkpoint
the moment a session ends, so a session's edits are never credited on work done
after it.

Yjs is used **only for the live session**. Lessons are still stored as plain JSON,
so nothing about saving, exporting or forking changes, and version history
changes only in who a commit credits.
