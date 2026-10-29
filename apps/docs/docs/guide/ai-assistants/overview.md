---
title: AI assistants
description: What connecting an AI assistant such as Claude to your Spelling Creator account makes possible, from drafting lessons to fact checks, and what stays in your hands.
---

# Using an AI assistant with Spelling Creator

You can connect an AI assistant, such as Claude, to your Spelling Creator
account. Once it's connected, you can ask it in plain words to draft a lesson,
change one you already have, or find pictures for it, and it does the work in
your account for you. You stay in charge of what gets published.

Connecting works through MCP (Model Context Protocol), an open standard many
assistants use to talk to other apps. You don't need to know anything about it
beyond whether your assistant supports it. See
[Connect an AI assistant](./connect.md) for how.

## What it's good for

- **Drafting a lesson.** Describe the topic and paste in any sources you want
  it to use. The assistant writes the reading passages, picks the spelling
  words, writes the questions, and adds footnotes citing your sources. You then
  open the draft in the editor and change whatever you like.
- **Checking facts.** Before numbers, dates and animal facts go into a lesson,
  it can compare them with Wikidata, the Smithsonian and Wikipedia and tell you
  where they disagree.
- **Finding pictures.** It searches Wikimedia Commons for freely licensed
  images and adds the one you choose, with its credit. In Claude you see the
  candidates as pictures and click the one you want.
- **Changing an existing lesson.** Ask for a reworded passage, an extra
  question or a new section. By default it makes its own copy, changes that,
  and offers the changes back as a proposal, so you read them and decide before
  your lesson changes. Tell it to edit the lesson directly if you'd rather skip
  that step.
- **Suggesting changes to someone else's lesson.** It can't edit a lesson
  another person wrote, so a proposal is the only way, and the lesson's author
  reads it and decides.
- **Helping during a live session.** If you're editing a lesson live, you can
  let the assistant join the session as a participant and work alongside you.
  See [Live sessions with an assistant](./live-sessions.md).

For the full list, see [What an assistant can do](./what-it-can-do.md).

## What stays in your hands

- **It works as you.** Everything it saves appears under your display name and
  goes through the same rules as a lesson you save yourself in the editor.
- **New lessons start as private drafts.** Nothing is published unless you ask
  for it, and in assistants that can ask you directly (such as Claude), it
  checks with you before publishing or deleting a lesson.
- **Every change is a version.** Each edit the assistant makes shows up in the
  lesson's **History** tab under your name, with a note saying an AI assistant
  made it, so you can see exactly what changed and go back to an earlier
  version.
- **It is held to the lesson checks.** The assistant follows the same rules the
  editor's [lesson checks](../lesson-checks.md) use, so its lessons arrive in
  the shape the app expects. Those rules are the app's defaults, not the only
  way of doing Spelling. If you
  want something they rule out, such as a lesson with fewer sections or a
  different question order, say so and the assistant can save it anyway; in
  assistants that can ask you directly, it lists what would be skipped and
  checks with you first. You can also change anything in the editor afterward.

## Which assistants work

Any assistant that supports MCP can connect. That includes Claude (on the web,
on desktop and mobile, and Claude Code) and other tools such as Cursor.
Assistants that can't show pictures or buttons in the chat still work; they
just describe the results in text instead.

## Next steps

- [Connect an AI assistant](./connect.md)
- [What an assistant can do](./what-it-can-do.md)
- [Live sessions with an assistant](./live-sessions.md)

For how the connection works under the hood, see the
[developer overview](../../developers/mcp-server/overview.md).
