---
title: Tools
---

# Tools

| Tool                    | What it does                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `whoami`                | Confirm the session is valid and show the publishing display name.                              |
| `validate_lesson`       | Check lesson content against the authoring standard, saving nothing.                            |
| `create_lesson`         | Build and save a new lesson (draft by default; `published: true` to share).                     |
| `create_lesson_file`    | Build an importable lesson file offline, with no account or network.                            |
| `patch_lesson`          | Edit a lesson with a small diff (id-addressed ops) instead of a full replace.                   |
| `update_lesson`         | Replace a lesson's whole title/content (author only).                                           |
| `fork_lesson`           | Copy a lesson into a private draft of your own, keeping its version history.                    |
| `propose_changes`       | Offer a fork's changes back to the original, for a human to review and merge.                   |
| `list_lesson_proposals` | List the proposals against a lesson, and whether yours have been resolved.                      |
| `review_proposal`       | Read what a proposal changes — as a diff with merge and decline, where a client can show one.   |
| `merge_proposal`        | Merge a proposal (the reviewer's own click in that view — not the assistant's to call).         |
| `decline_proposal`      | Close a proposal without merging it (likewise the reviewer's own click).                        |
| `get_lesson`            | Fetch one lesson with its full content (read before editing / as a template).                   |
| `list_my_lessons`       | List your own lessons (drafts + published).                                                     |
| `list_hub_lessons`      | Browse published lessons for inspiration / de-duplication.                                      |
| `set_lesson_published`  | Toggle a lesson between public and private draft.                                               |
| `delete_lesson`         | Permanently delete one of your lessons.                                                         |
| `search_images`         | Search Wikimedia Commons for freely-licensed images — as a picker, where a client can show one. |
| `add_image`             | Download a searched image and insert it as an image block in a lesson.                          |

Plus five more on the stdio transport, for joining a lesson the user is editing live:
`join_collab_session`, `read_collab_doc`, `edit_collab_doc`, `send_collab_chat` and
`leave_collab_session`. See [Live sessions](/mcp-server/live-sessions).

## Every edit is a version

A lesson is a [real git repository](/monorepo/version-history), and the web editor
commits as you type. The MCP server does the same: `create_lesson`, `update_lesson`,
`patch_lesson` and `add_image` each save the document **and** commit it, so an
assistant's work turns up in the lesson's **History** tab beside your own — one entry
per tool call, with the diff, and revertable from there if you don't like it.

Every write returns a `history` object saying what was recorded:

```json
{ "recorded": true, "commit": "8f1c…", "summary": "Edit 1 text block" }
```

Some things worth knowing:

- **The commit says an assistant made it.** The hub attributes writes to the account
  whose token the server is using — yours — so a commit that said nothing more would
  put your name against changes you didn't write. The message carries a line naming the
  connecting client (`Made by an AI assistant via Claude Desktop`), the same provenance
  a proposal's body gets.
- **A lesson whose document had run ahead of its history catches up first**, in a commit
  of its own labelled as such. That happens to a lesson last saved when a history push
  failed, and to every lesson edited over MCP before this existed: the row holds content
  no commit accounts for. Committing it separately keeps it out of the assistant's diff
  rather than attributing it there. A lesson with no history at all gets one started the
  same way, from its previous content.
- **A failed commit never fails the write.** The document and the repository are two
  stores, and the document is saved first. If the history push is refused — most often
  because you saved the lesson from the editor in between, which the
  [compare-and-swap](/monorepo/version-history) is there to catch — the edit still
  stands, and `history.recorded` comes back `false` with the reason, for the assistant
  to pass on.
- **Nothing is committed when nothing changed.** An edit that leaves the stored content
  identical records no version, rather than an empty one.
- **The assistant can name the version.** `patch_lesson` and `update_lesson` take a
  `summary`, which becomes the version's title instead of the mechanical description of
  what changed. See [Building a lesson in passes](#building-a-lesson-in-passes).

## Decisions that are the user's

Three things this server does are the user's call rather than the assistant's: **deleting a
lesson**, which cannot be undone; **publishing one**, which puts it in front of strangers
under their name; and **overriding the authoring standard** with `skipValidation`, which is
meant for a user who deliberately wants what the standard forbids.

All three were governed only by prose in the tool descriptions — "ask the user first" —
which is advice the model may or may not follow, and which neither the server nor the user
can check after the fact. On a client that supports **elicitation**, the server now asks
them directly, mid-tool-call, and their answer decides it:

- **`delete_lesson`** names the lesson and says what goes with it, and points at
  unpublishing as the reversible alternative. Say no and nothing is deleted.
- **Publishing** — `set_lesson_published(true)`, or `published: true` on `create_lesson`,
  `update_lesson` or `patch_lesson`. See below.
- **`skipValidation`** lists the defects that would be waived before waiving them. See
  [Lesson validation](/mcp-server/lesson-validation#skipvalidation).

### Publishing

Publishing is asked about only **on the way out**, and only when public is a change:
unpublishing is never confirmed (it only ever makes a lesson less visible), and neither is
`published: true` on a lesson that is already public.

A refusal never costs the work. On the editing tools `published` rides along with a content
change, so the content is written either way and only the visibility is held back; on
`create_lesson` the lesson is created as a private draft rather than not at all. The result
carries a `note` saying so, because the assistant asked for something it didn't get and
would otherwise assume the field was ignored:

```json
{
  "id": "…",
  "note": "The content changes were saved, but the user was asked about publishing and said no, so the lesson is still a PRIVATE DRAFT. …"
}
```

This is the same principle as the [image picker](./interactive-views.md): where a choice is
genuinely the user's, an assistant that makes it takes it away from them.

A refusal is not an error. `delete_lesson` returns a normal result saying the user declined
and telling the assistant not to ask again unprompted; a refused `skipValidation` fails the
write, because a write that was never permitted didn't happen.

**On a client that can't ask, both tools behave exactly as they did before** — elicitation
is optional in the MCP spec and most clients don't implement it, so failing closed would
make `delete_lesson` unusable for most people. Both tool descriptions say so, and tell the
assistant to ask in the conversation regardless.

## Proposing changes instead of making them

An assistant can change a lesson two ways, and which one it should use is a question
about **who decides**, not about the size of the edit.

`patch_lesson` writes straight to the lesson. It's right for a correction the user has
asked for outright — a typo, a wrong answer — where a review step is only friction.

**`fork_lesson` + `propose_changes`** leaves the lesson untouched and puts the changes in
its [Proposals](/web-app/pull-requests) tab instead, where a person reads the diff and
merges or declines it:

```text
fork_lesson({ lessonId })          -> a private draft fork you own
patch_lesson({ id: fork.id, … })   -> edit THE FORK
propose_changes({ forkLessonId })  -> a proposal, with a URL to review it
```

That's the only available route for a lesson somebody else wrote — nobody can save over
another person's lesson — and it's the better route whenever the user wants to look over
the assistant's work before it goes live. `propose_changes` returns the proposal's `url`;
the assistant is expected to hand that over and stop, rather than report the change as
done.

Some mechanics worth knowing:

- **A fork is a real clone.** It carries the original's git history, so the reviewer's
  merge is a true three-way merge against the commit the two diverged from, block by
  block. A lesson with no stored history can still be forked, but the fork shares no
  ancestor with it, so the whole document reads as the change. `fork_lesson` says which
  happened.
- **A proposal carries the fork's history**, which is the commits the edits to it made
  (see above) against the commit the fork and the lesson last shared. So the reviewer
  reads the change as a sequence, not as one lump, and `changes` in the result is stated
  against the lesson rather than against whatever the last edit happened to do.
- **Proposing after the fork stopped moving is refused.** There is nothing to add to a
  proposal that already holds exactly these changes, and bumping its revision would send
  the reviewer back to a diff that hasn't changed.
- **Proposing again updates the proposal already open** from that fork, rather than
  stacking a second one beside it — same request, same discussion, new contents, with
  the version number recorded. That's what you want after the human asks for a change;
  the `title` and `body` passed are then ignored, since the ones already there are what
  they have been reading. `updated` in the result says which happened. (At most 5 open
  against one lesson, and at most 20 updates to one proposal.)
- **Images aren't copied.** Blocks reference them by content hash and the bytes are
  already stored, so forking is cheap.
- **Forks are private drafts** and count against the draft cap, so `delete_lesson` the
  fork once its proposal has been resolved.
- **Merging is never the assistant's.** It is the reviewer's decision, taken in the web
  app or by clicking Merge in `review_proposal`'s view — see
  [Deciding a proposal in the conversation](#deciding-a-proposal-in-the-conversation).
  There is no path by which the assistant settles one itself; `list_lesson_proposals` is
  how it finds out what the reviewer decided.

Because the assistant acts as the account it's signed in with, a proposal against your
_own_ lesson is opened by _you_ — so its body carries a note saying an assistant wrote
it, and the notification you get reads "Changes are waiting for your review".

## Reading a proposal

`list_lesson_proposals` gives titles and status and nothing about the contents.
**`review_proposal`** is what reads one: the block-by-block diff, a tally of it, and
whether it would merge cleanly.

```text
review_proposal({ lessonId })            -> the newest open proposal's diff
review_proposal({ lessonId, pullId })    -> a particular one
```

It writes nothing at all — no merge, no commit, no status change — and works on every
client, text or rendered.

Two things about what it computes are worth stating, because getting either wrong
misleads a reviewer rather than failing:

- **The diff is measured from the merge base**, the commit the proposal and the lesson
  last shared — that is what the proposal is _asking for_. Measured against the lesson's
  current tip instead, every change the lesson's own author made since the fork left
  would appear in it, reversed, as though the proposer wanted them undone.
- **Conflicts are judged against the lesson's saved document**, not against the doc at
  its stored git tip. Those can differ (an edit whose history push failed), and this is
  the tool where the difference is felt: `merge_proposal` merges the saved document, so
  judging conflicts against the tip could offer a live Merge button on a proposal that
  then refuses.

`conflicts` names the blocks both sides have rewritten. Those are the ones a merge cannot
decide on its own, and they're why `mergeable` in the result can be false while the diff
reads perfectly well.

## Deciding a proposal in the conversation

Reading a proposal is the assistant's job. Deciding one is the reviewer's, and it used to
mean leaving the conversation: `propose_changes` hands over a URL, and finding out what
happened meant asking or polling.

On a client that renders [interactive views](./interactive-views.md), `review_proposal`'s
diff arrives with **Merge** and **Decline** on it, and the same human decision is taken in
place. Nothing about who decides has changed — only where they can click.

That is enforced rather than asked for. `merge_proposal` and `decline_proposal` are
declared `visibility: ["app"]`: a host that reads that keeps them out of the model's
tool list entirely, so the only thing that can call them is a button on the card. For a
host that ignores it, both tools check for themselves whether a view was ever drawn —
where none was, nobody pressed anything, and the call is refused with a pointer to the
proposal's `url`. Their descriptions say the same in plain words, since a model that can
see them is exactly the case the metadata failed to cover.

**The assistant is told to stop when the diff is showing**, the same way it is for the
[image picker](#letting-the-user-pick-the-picture) and for the same reason: the result
leads with an instruction to end the turn — don't merge it, don't decline it, and don't
send them to the web app for something the buttons already do — with the payload behind
it. On a text-only client the result says the opposite thing, because there the assistant
relaying the diff and handing over the URL is all that can happen.

What a merge does, in this order, because the hub accepts no other:

1. **Push the merged history.** A three-way merge of the lesson's saved document and the
   proposal's, joined by a commit with two parents. If the lesson has moved on underneath,
   the push is refused rather than overwriting it, and the proposal stays open.
2. **Save the merged document** to the lesson.
3. **Record the proposal as merged.** The hub refuses this unless the merge commit is what
   the lesson's stored history already points at — so the first two steps are not
   bookkeeping around the third, they are what makes it true.

The merge commit lands under the reviewer's own name, since they decided it, with a note
saying it was merged from the proposal view rather than in the web app.

**Conflicts are not merged here.** A block both sides have rewritten is a question for a
human with the two versions side by side, and the web app has the dialog for it. Rather
than guess — or build a second conflict UI into an inline card — `merge_proposal` refuses,
names the contested blocks, and gives the proposal's URL. The lesson is untouched when it
does.

Declining drops the proposal's changes, keeps its row and title so the conversation stays
visible, and notifies its author — exactly as declining in the web app does.

## Editing a lesson: patch vs. replace

For tweaks, prefer **`patch_lesson`** — `get_lesson` to read the current section/block
**ids**, then send a small list of operations that address those ids, e.g.:

```json
{
  "id": "…",
  "operations": [
    { "op": "set_section_name", "sectionId": "…", "name": "Volcano basics" },
    {
      "op": "replace_block",
      "blockId": "…",
      "block": { "type": "text", "text": "Magma RISES." }
    },
    {
      "op": "add_block",
      "sectionId": "…",
      "block": {
        "type": "question",
        "questionType": "single",
        "prompt": "What rises?",
        "answer": "magma"
      }
    }
  ]
}
```

Ops: `set_title`, `set_section_name`, `add_section`, `remove_section`, `move_section`,
`add_block`, `replace_block` (keeps the block id), `remove_block`, `move_block`. The
server fetches the lesson, applies the ops in order, and saves the result (the hub API
itself only does full replaces, so the diff is applied server-side). Use `update_lesson`
when you're rewriting the whole lesson anyway.

## Building a lesson in passes

`patch_lesson` isn't only for tweaks. A six-section lesson is a lot to get right in one
`create_lesson` call, and that call is all-or-nothing — one grounding failure anywhere and
nothing is saved. The alternative is to create the first section or two and add the rest a
pass at a time:

```text
validate_lesson({ sections: [ … ] })        -> check the section you just wrote
create_lesson({ title, sections: [ … ] })   -> the lesson exists after one section
validate_lesson({ id, operations: [ … ] })  -> check the next pass before sending it
patch_lesson({ id, operations, summary })   -> add it
```

Each pass is checked on its own, reversible on its own, and named on its own. Composing the
whole document locally and writing it in one `create_lesson` is equally fine — the thing to
avoid is writing six sections blind and hoping, which is what the tools used to require.

**Name each pass with `summary`.** `patch_lesson` and `update_lesson` both take one, and it
becomes the version's title in the **History** tab:

```json
{ "id": "…", "operations": [ … ], "summary": "Add section 3: volcanic ash" }
```

Without it the version is named after what mechanically changed ("Add 15 question blocks"),
which is accurate and says nothing about why — fine for a one-off tweak, and poor for six
passes the user has to open one by one to tell apart. The summary replaces the subject line
only: the itemised operations and the "made by an AI assistant" note still follow in the
commit body. It's clamped to 72 characters.

One reason to prefer `patch_lesson` over `update_lesson` for this: `update_lesson` rebuilds
every section and block id, so its diff reads as a wholesale add-and-remove even for a
one-word change. `patch_lesson` addresses blocks by id, so the history records what actually
moved.

There is a second reason to prefer patching. Both tools check the result against the
authoring standard, but `patch_lesson` holds the caller only to the defects its edit
introduced, whereas `update_lesson` replaces the whole document and so owns everything in
it — including problems inherited from the lesson it fetched. See
[Lesson validation](/mcp-server/lesson-validation).

## Lesson shape the assistant fills

By default (unless you ask for something different), the assistant builds **6 sections**, each
one an optional image, 2 text paragraphs, 4 spelling words, and 15 questions in a fixed order —
covering verbatim-in-text, fill-in-the-blank, word-problem, list-retrieval,
background-knowledge, and open-ended question types. This default (and the rest of the authoring conventions — spelling-
word rules, math `steps`, image placement, tone) is sent to the connecting assistant as the
server's MCP `instructions`, so most clients apply it automatically. Not every client surfaces
server `instructions` to the model — notably claude.ai's connector UI doesn't — so the full
standard is also embedded directly in `create_lesson`'s tool description (`create_lesson_file`
just points to it, rather than repeating it) to make sure it reaches the model either way.

The half of the standard a script can decide doesn't rely on the model having read anything:
every tool that writes a lesson validates it first and **rejects** the write on a grounding,
spelling-word or uniqueness failure, with a message naming the section, the value and the fix.
Softer shape problems come back as a `warnings` array on the saved result. `skipValidation: true`
turns the errors off for a user who deliberately wants something the standard forbids. See
[Lesson validation](/mcp-server/lesson-validation) for every code.

Because a rejected write is all-or-nothing, an assistant composing six sections in one call
has to get every one of them right first time. **`validate_lesson`** runs the same checks
without saving, so it can build a section, check it, fix what the messages name, and only
call `create_lesson` once the whole thing comes back clean. See
[Checking before you write](/mcp-server/lesson-validation#checking-before-you-write).

A lesson is **sections** of **blocks**. Block types:

- **`text`** — a paragraph. Put words you're teaching the spelling of in **ALL
  CAPS**; the app highlights them as spelling words.
- **`spelling`** — an explicit word list: `{ "type": "spelling", "words": ["BECAUSE", "FRIEND"] }`.
- **`question`** — a quiz question with a `questionType`:
  - `number` → `answer` (numeric), plus optional `steps` (array of worked-solution steps, in order)
  - `single` → `answer` (one text answer)
  - `multiple` → `answers` (array of accepted answers — the items of a list the passage
    states explicitly, with the prompt quoting that sentence with the list blanked out)
  - `paraphrase` → free response restating the passage in the speller's own words
    (no answer field; just the `prompt`)
  - `open` → free response (no answer field; just the `prompt`)
  - `background` → `background` + `answer` (needs prior knowledge)

- **`image`** — a picture. Don't write these by hand; use `search_images` to find a
  freely-licensed Wikimedia Commons image, then `add_image` with its `ref` to download
  the bytes, store them, and insert the block. The licence attribution is set as the
  caption automatically.

## Placing an image

`add_image` needs somewhere to put the block. In order of precedence:

1. **`afterBlockId`** — insert directly after a specific block id (from `get_lesson`).
   This is the most reliable way to place an image next to the content it illustrates,
   since it pins both the section and the position without any index arithmetic.
2. **`sectionId`** / **`sectionIndex`** + optional **`index`** — target a section
   explicitly and, optionally, a 0-based position within it.
3. If none of the above are given, the image is inserted at the end of the **last**
   section's prose, just before any trailing question block(s) — never buried after
   the quiz.

The standard puts a section's image **first**, above both paragraphs, so a lesson written
to it passes `sectionId`/`sectionIndex` with `index: 0` rather than relying on the default.

## Letting the user pick the picture

Candidates are photographs, and an assistant can only describe them. On a client that
renders [interactive views](./interactive-views.md), `search_images` shows them instead:
the results come back as a row of cards the user scrolls, and choosing one is a click.

Pass **`lessonId`** (and **`sectionIndex`**, when the picture belongs to a particular
section) whenever the assistant already knows where the image is going. The button on each
card then calls `add_image` itself — over the same authenticated connection, placing the
picture first in that section as the standard asks — so the user's choice becomes an image
in the lesson without another turn. Without a `lessonId` — or on a client that won't carry
a tool call on the view's behalf — the card still works: picking one tells the assistant
which `ref` to use, and it places the image as usual.

**The assistant is told to stop when the picker is showing.** This is the one place the
server says different things to different clients, and it has to: the same result means
"choose one" to a text client and "stand back" to a rendered one. `search_images` checks
whether the connected host negotiated the MCP Apps extension, and when it did, the result
leads with an instruction to end the turn — don't call `add_image`, don't pick from the
descriptions — and the payload follows behind it. Without that, the assistant reads a list
of candidates, does the obvious thing with it, and adds a picture of its own choosing while
the user is still looking at the cards; the choice the picker exists to hand over is taken
back before they can make it.

A client that renders nothing at all gets exactly the text result it always did, list and
"choose the best `ref`" alike; the picker reads the identical payload either way.

`add_image` downloads a **downscaled rendering** (Commons is asked for a thumbnail ~1600px
wide, and again at ~1000px if that one is still heavy) rather than the original file, so
the assistant chooses a candidate on its content and never on its file size. This is not
only bandwidth: the hub re-encodes PNG/JPEG uploads to WEBP inside a Worker, and a
full-size scan used to exhaust that Worker's resources — a failure no retry could fix. A
file that stays over the 8 MB upload limit even at the smallest rendering Commons will
produce is refused with a message saying to pick a different candidate.
