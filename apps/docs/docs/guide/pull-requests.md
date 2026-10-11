---
title: Proposing changes
---

# Proposing changes

Anyone can **fork** a published lesson, which makes a copy of their own to
change however they like. But nobody can change somebody else's lesson
directly. To offer your changes back, you send a **proposal** to the original
lesson, and its author (or a trusted collaborator they've named) reads it and
decides whether to merge it in. (Developers call these pull requests.)

A lesson only ever changes because someone responsible for it chose to change
it, and every change from outside arrives as something they can read first.

## See it in action

<DemoVideo name="hub-follow-and-merge" title="Following someone, then merging a proposal">
A practitioner followed from one of her lessons, then a notification about a
proposed change to one of your own lessons: the proposal read, reviewed in the
editor, and merged. The people are made up; the lessons are real ones from the
hub.
</DemoVideo>

## Sending a proposal

1. **Fork** the lesson from its page (the **Fork** button beside the lesson).
   Your copy keeps the original's full version history, which is what lets your
   changes be merged back later.
2. **Edit** your copy as much as you like. You can save it, publish it, or keep
   it as a draft.
3. In the editor, press **Propose changes to** _the lesson's name_. Say in one
   line what your changes do ("What does this change?"), add a note if you want
   to, and press **Propose these changes**. Nothing in the original changes.

The lesson's author gets a notification, and your proposal appears on the
lesson's **Proposals** tab.

You need to be signed in and to have chosen a
[display name](./profiles.md) first, so the author sees your name rather than
your email address.

**If you made your changes on a [variation](./variations.md)**, that variation
is what gets proposed, and only that one. Your other variations stay yours. The
proposal says which variation it came from.

**A proposal is a snapshot.** It holds your copy as it was when you sent it.
You can keep editing afterwards without changing what the author is reading.

### Updating a proposal

Once you have a proposal open, the editor button changes to **Update your
proposal**. Pressing it replaces what the proposal contains with your work as
it stands now. Its title, note and any discussion stay where they are. The
proposal's page shows that it was updated (for example "Version 3 · updated 4
March") and what the last update changed, and the author is notified.

A proposal can be updated up to 20 times. After that, close it and open a new
one.

### Keeping your copy up to date

While you work, the original may change too. **Sync with** _the lesson's name_
in the editor brings in the changes made to the original since you forked it,
merged block by block, so your proposal is built on the latest version.

## Reviewing a proposal

If you're the lesson's author or a trusted collaborator, open the lesson's
**Proposals** tab and click a proposal. Its page shows **What this changes**,
block by block, and tells you whether merging would need any decisions from
you:

- "This merges cleanly. There's nothing to decide."
- "2 blocks have been changed here and in the lesson, so merging will ask you
  which to keep."
- "These changes are already part of the lesson."

The changes are compared with the version of the lesson the proposal started
from, so edits you've made to the lesson since then aren't shown as if the
proposer had undone them. The proposal's title and note appear first and the
changes load a moment later. If they can't be read, the page says so and the
rest of it still works.

From there you have three choices:

- **Review & merge** opens the lesson in your editor with the proposal ready to
  merge. A dialog lists everything that combined on its own, and asks you to
  choose for any block that was changed in the same place on both sides (often
  there are none). Nothing is written until you press **Merge these changes
  in**. Then the lesson is saved with the changes, the proposal is marked
  **Merged**, and whoever proposed it is notified.
- **Try it in a variation** puts the changes into a
  [variation](./variations.md) of your own, so you can look through the whole
  lesson with them in place before deciding. The lesson everyone reads doesn't
  change, and the proposal stays open.
- **Close** declines it. Whoever proposed it is notified.

If someone else saves the lesson while you're merging, your save is refused
rather than overwriting their work. Nothing is lost: bring in their changes
first, then merge again.

You can also read and settle a proposal from an AI assistant's conversation;
see [What an AI assistant can do](./ai-assistants/what-it-can-do.md). A block
that both sides rewrote is sent back to the editor to decide.

## Closing and withdrawing

The person who opened a proposal can **Withdraw** it. The author or a trusted
collaborator can close it, and so can a moderator. A closed proposal stays
listed, so the conversation is still visible, but the changes it carried are no
longer stored.

## Who can do what

| You are                  | Send a proposal                   | Merge | Close          |
| ------------------------ | --------------------------------- | ----- | -------------- |
| Anyone signed in         | Yes                               | No    | No             |
| The person who opened it | Yes                               | No    | Yes (withdraw) |
| The lesson's author      | Only from an AI assistant (below) | Yes   | Yes (decline)  |
| A trusted collaborator   | Yes                               | Yes   | Yes            |
| A moderator              | Yes                               | No    | Yes            |

"Trusted collaborator" means someone on the lesson's **Trusted collaborators**
list, the same list that lets people straight into a
[live session](./live-collaboration.md).

Moderators can close a proposal, the same power they have over any comment, but
can't merge one. Merging is authorship, and a moderator's job is removing
things, not writing under someone else's name.

### Proposals to your own lesson

You don't need to propose changes to your own lesson; you can just save them.
The exception is an **AI assistant**: it works as the account it's signed in
with, so when it proposes changes to your lesson they come from you. They wait
on the **Proposals** tab like anyone's, and your lesson is untouched until you
read them and merge. The notification says "Changes are waiting for your
review" rather than naming someone.

## Limits

- Up to 5 open proposals from one person to one lesson at a time.
- A title of up to 200 characters, and a note of up to 4,000.
- The title and note are plain text, and go through the same language filter
  as comments. A proposal that fails it is rejected as a whole, not censored.
- People banned from posting can't send proposals.

## Who can see a proposal

A proposal is as public as the lesson it's for. On a published lesson, the
proposals and the changes in them are public, like comments on it. On a private
draft, they're as private as the draft. The proposal form says so before you
send it ("Everyone can see what you propose").

For the review flow, permissions and endpoints in detail, see the
[developer notes on pull requests](../developers/web-app/pull-requests.md).
