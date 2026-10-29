---
title: Live sessions with an assistant
description: How to bring an AI assistant into a live editing session, watch its edits land in your editor, work alongside it, and remove it when you're done.
---

# Live sessions with an assistant

You can bring an AI assistant into a lesson while you're editing it, the same way you'd
invite another person to [collaborate live](../live-collaboration.md). It joins your
session as a participant: its edits appear on your screen as it makes them, it can talk to
you in the session chat, and you can remove it at any moment.

## Why use a session

While a live session is running, the lesson in your editor is ahead of the saved copy on
the hub. If the assistant edited the saved copy in the usual way, your next save would
overwrite its work. Inside the session, it edits the same lesson you're looking at, and you
can watch every change land and answer its questions as it goes.

## Bring an assistant in

1. Sign in, open the lesson in the editor, and click **Collaborate**. Then click
   **Start a collaboration session**.
2. Click **Copy code** next to the **Session code**, paste the code to your assistant, and
   ask it to join.
3. The assistant's request appears in the Collaborate dialog under **Waiting to join**,
   marked with an **AI** badge. Press the add button (a person with a plus sign; its
   tooltip says **Add to lesson**) to let it in, or the X (**Decline**) to turn it away.

The assistant waits about 50 seconds for you to let it in. If you miss that, its request
stays in the dialog: press the add button and tell the assistant to keep waiting, and it
picks up the same request rather than sending a new one. A request nobody answers is
withdrawn after five minutes.

If the assistant is connected through the account of someone on the lesson's
**Trusted collaborators** list, it's let in straight away, just as that person would be.

## What you'll see

The assistant shows in the **In this lesson** list under the name of the account it's
using, followed by the name of the app it came through (for example "Alex Rivera ·
Claude"), with the **AI** badge. It has no floating cursor.

Its edits appear in your editor as it makes them. It usually says in the **Chat** what
it's about to do before a larger change, and asks there when it isn't sure (which section
you want next, whether a passage reads right). It doesn't see your replies the instant you
send them; it reads them the next time it checks the lesson, which it does before each
edit.

## Working side by side

Edits in different places merge, so you can work on one section while the assistant works
on another. Two people typing in the same paragraph at the same moment is different: one
of them loses their text. To avoid that, the assistant won't edit a block your cursor is
in. It will work somewhere else or ask you in the chat to move.

The assistant tells you if an edit breaks the app's default
[lesson standards](./what-it-can-do.md#it-checks-lessons-before-saving), but it doesn't
refuse to make it. This is your live lesson, and you can see what's happening.

## Saving

Nothing the assistant does in a session is saved on its own. Save the lesson from the
editor when you're happy with it, the same as always. The assistant is told not to save a
separate copy, since that copy would be out of date and your next save would replace it.

When you save, its edits are credited in the lesson's version history to the account it's
using. If that's your own account, the changes are simply yours.

## Removing it or ending the session

- Click **Remove from lesson** next to the assistant in the **In this lesson** list. It's
  removed right away and won't try to rejoin unless you ask.
- **End session** ends the session for everyone, the assistant included.
- An assistant that sits idle for half an hour is let go automatically. Ask it to join
  again if you still want it.

When the assistant leaves, the lesson stays exactly as it is, and its changes are still
there for you to save. An assistant can be in one session at a time, and it counts toward
the session's limit of ten people.

For how this works under the hood, see the
[developer notes on live sessions](../../developers/mcp-server/live-sessions.md).
