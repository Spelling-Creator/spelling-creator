---
title: Live collaboration
---

# Live collaboration

Live collaboration lets you edit a lesson together with other people at the
same time. Everyone sees the others' changes as they happen, can see where the
others are working, and can talk in a chat panel beside the lesson.

You need to be signed in to start or join a session.

## See it in action

<DemoVideo name="live-collaboration" title="Two practitioners editing one lesson">
Maya, on the left, starts a session and sends Daniel the invite link. It
arrives in his notifications, he asks to join, and she adds him. Then each
sees the other's edits as they type, and they talk in the session chat. Both
people are made up; the lesson is a real one from the hub.
</DemoVideo>

## Starting a session

Whoever starts a session is its **host**. Everyone else is a guest.

1. Open the lesson in the editor and press **Collaborate** in the toolbar.
2. Press **Start a collaboration session**. You get a **session code**, with
   **Copy code** and **Copy invite link** buttons. **Send link** sends the
   invite to someone by their email address, with an optional message. It
   appears in their [notifications](./notifications.md) the next time they're
   signed in.
3. When someone joins, they appear under **Waiting to join**. Press the add
   button beside them (a person with a plus sign; its tooltip says **Add to
   lesson**) to let them in, or the X (**Decline**) to turn them away. An AI
   assistant's request is marked **AI**. Nobody sees the lesson, or anyone's
   edits, until you add them.
4. Everyone you've added is listed under **In this lesson**. You can **Remove
   from lesson** at any time.
5. Press **End session** when you're done.

### Trusted collaborators

The **Trusted collaborators** list in the same panel is a list of email
addresses saved with the lesson. Each time you start a session, everyone on it
is sent the invite link automatically (it arrives in their notifications), and
when they join they're let straight in without waiting for you. The list itself
is never shown to anyone else in the session.

Being on the list matters outside live sessions too. A trusted collaborator can
save changes to the lesson, and can review and merge
[proposed changes](./pull-requests.md) to it, alongside the author.

## Joining a session

Open the invite link you were sent, or press **Collaborate**, paste the code
under **Join someone's lesson**, and press **Join**. You'll see "Connected.
Waiting for the host to add you to the lesson." until the host adds you.

Once you're added, the editor saves the lesson you had open and opens the
host's lesson as a new lesson in your [library](./local-lessons.md). Your own
lesson is never overwritten or mixed with the host's. The session's copy stays
in your library after the session ends. It's a copy of your own, so publishing
it makes a new lesson in the hub rather than updating the host's.

If you open or start a different lesson while that is still saving, your
choice wins and you leave the session with a message saying so, rather than
have the host's lesson land in the lesson you just opened.

## Editing together

- **Changes are merged.** Two people working on different sections, blocks or
  fields both keep their work.
- **The same field at the same time.** If two people type into the same field
  at once (the same question, say, or the same text block), one version wins
  and everyone ends up seeing that one. A whole text block counts as one field,
  formatting and all. Working on different blocks, which is the usual case,
  always merges.
- **Cursors.** You can see where each person is working, as a colored marker
  with their name. Inside a text block a marker can sit a few characters off
  for a moment while someone is mid-word.
- **Folded sections.** You won't see someone's marker inside a section you've
  [folded away](./navigating-large-lessons.md), though their edits still
  arrive. Folding only changes your own view, never anyone else's.
- **AI assistants.** An AI assistant can join a session through someone's
  account. It's listed with an **AI** badge, and the host adds or removes it
  like anyone else. See
  [Live sessions with an AI assistant](./ai-assistants/live-sessions.md).

## Chat

Once you're in a session, a chat button sits at the bottom left of the screen
(**Open chat**). It appears for the host as soon as the session is live, and
for a guest once the host has added them. A badge on the button counts unread
messages while the panel is closed.

Chat isn't saved anywhere. The messages last only as long as the session.

## Who gets credit

Changes made in a session go into the lesson's version history like any other
edit. Everyone whose edits made it into a version is credited on it, so the
history reads something like "Alex, with Sam and Priya". Someone who only
watched isn't credited.

## Limits

- Up to 10 people in one session, host included.
- You can host up to 6 sessions at once, and join or start at most 5 a minute.
- Chat allows up to 2 messages a second, each up to 2,000 characters.
- Very fast bursts of edits or cursor moves are slowed down, and a connection
  that keeps flooding a session is closed. Normal editing never comes close.

For how live collaboration works underneath, see the
[developer notes on live collaboration](../developers/web-app/live-collaboration.md).
