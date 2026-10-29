---
title: Connect an AI assistant
description: "Three ways to connect an AI assistant to Spelling Creator: the hosted MCP connector, the Claude Desktop bundle, and running the server yourself."
---

# Connect an AI assistant

There are three ways to connect an assistant to Spelling Creator. They're listed
easiest first, and most people only need the first one.

## Before you start

You need a Spelling Creator account with a **display name**. Your assistant
saves lessons under that name, so the connection is refused until you've chosen
one. You can set it in **Settings**, under **Display name**. See
[Profiles](../profiles.md) for more.

## Option 1: Add Spelling Creator as a connector (recommended)

This works with any assistant that can connect to a remote MCP server. In
Claude these are called custom connectors. There is no password or token to
copy: you approve the connection in your browser.

The address to use is:

```
https://spellingcreator.org/mcp
```

1. **Add the connector in your assistant.** Find the place in your assistant's
   settings for adding a connector or MCP server, and paste in the address
   above. In Claude, look for the option to add a custom connector; Claude's
   menus move around from time to time, so if you can't find it, see
   Anthropic's article
   [Getting started with custom connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp).
2. **Sign in, if you aren't already.** Your browser opens a Spelling Creator
   page called **Connect an app**. If you're not signed in, it shows **Sign in
   to connect**. Enter your **Email address** and click **Send magic link**.
   Open the link from the email on the same device and you come straight back
   to this page, or type the code from the same email instead.
3. **Approve.** The page now shows **Connect** followed by the assistant's name.
   It tells you which account you're signed in as and that the assistant will be
   able to publish, update, and delete lessons on your behalf, the same as you
   can in the editor. Click **Approve** to connect, or **Deny** to cancel.
4. **Go back to your assistant.** It's connected and ready to use.

If you wait more than ten minutes on the sign-in page, the request expires and
you'll see "This sign-in request has expired. Reconnect from your MCP client."
Start again from your assistant. If you see "Set a display name in the web app
before connecting an MCP client.", choose a display name first (see
[Before you start](#before-you-start)) and try again.

## Option 2: Install the bundle in Claude Desktop

Claude Desktop can also install Spelling Creator from a single file ending in
`.mcpb`, called Spelling Creator Hub. Opening the file in Claude Desktop shows an
install dialog with two settings:

- **Supabase refresh token** (required): your sign-in token. Claude Desktop keeps
  it in your computer's secure password storage.
- **Hub API URL** (optional): leave this as it is unless you run your own copy of
  Spelling Creator.

Getting that token is a technical step: it means running a small helper from
the Spelling Creator source code, or copying a value out of your browser's
developer tools. The bundle also isn't offered as a public download right now,
so it has to be built from the source code. If Option 1 works in your
assistant, use that instead. The steps for building the bundle and getting a
token are in [Packaging the bundle](../../developers/mcp-server/packaging.md)
and [Local setup](../../developers/mcp-server/setup.md).

## Option 3: Run it yourself

Developers, and anyone whose assistant only supports servers that run on their
own computer, can run the server locally and point the assistant at it. See
[Local setup](../../developers/mcp-server/setup.md).

## Try it out

Once you're connected, ask for something like:

> Make a lesson about domestic cats with a short reading passage, a few
> spelling words and some questions, and save it as a draft.

The new lesson appears on the **Lesson hub** under **Your drafts**, visible
only to you until you publish it. If the assistant
reports a permission problem, ask it to check which account it's signed in as.

## Disconnecting

To stop an assistant using your account, remove or turn off the Spelling
Creator connector in your assistant's settings. Spelling Creator doesn't yet
have a page listing the assistants you've connected.

For how the connection works, see
[Remote (hosted) mode](../../developers/mcp-server/remote-mode.md) in the
developer docs.
