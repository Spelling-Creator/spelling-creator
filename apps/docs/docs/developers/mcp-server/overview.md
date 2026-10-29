---
title: MCP server overview
description: An MCP server that lets AI assistants author, validate and publish lessons through the hub's normal API, with three ways to connect.
---

# MCP server overview

For what this means for the people using it, see
[Using an AI assistant](../../guide/ai-assistants/overview.md).

`@spelling-creator/mcp` (in `apps/mcp`) is an [MCP](https://modelcontextprotocol.io)
server for the Spelling Creator hub. It lets any MCP-capable AI assistant
(Claude on the web, desktop and mobile, Claude Code, Cursor and others)
**author and publish lessons** to the hub on a user's behalf.

The assistant writes the content; the server gives it a structured, validated
path to a real lesson. It publishes through the **same Worker endpoints the web
app uses** (`/lessons`, `/git`, `/images`, `/lessons/:id/pulls` for proposals, and
`/collab/:code/agent` for live sessions), authenticating as the user with a Supabase
token, so every lesson goes through the existing validation, ban checks and
author attribution. Nothing here bypasses the normal API.

Every write is also a **version**. A lesson is a real git repository, and the
server commits each edit the way the web editor does, so what an assistant did
turns up in the lesson's History tab with the diff, under the user's name with a
note that an AI assistant made it, and revertable. See [Tools](./tools.md).

It can also **fork** a lesson and open a **proposal** against it, rather than
writing to it: the assistant edits a copy, and a human reads the diff and
decides. That's the only route into a lesson somebody else wrote, and the one to
use when the user would rather check the assistant's work before it goes live.
See [Tools](./tools.md).

On a client that renders [MCP Apps](./interactive-views.md) (Claude on web,
desktop and mobile), some results come back as a small interface rather than as
text: `search_images` shows the Commons candidates as pictures, the assistant
stands back rather than choosing, and the one the user clicks goes into the
lesson; `review_proposal` shows a proposal as a diff with Merge and Decline.
Everywhere else the same tools answer in text.

An assistant can also take part in a [live session](./live-sessions.md), editing
the unsaved lesson alongside the people in the room.

## Ways to connect

The tool layer (`src/tools.js`) and API client (`src/api.js`) are
transport-agnostic, and three entry points sit on top of them:

| Route                             | Entry point                                                                         | Auth                                                                  | Page                                     |
| --------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------- |
| Remote (hosted), recommended      | `apps/api` mounts the server at `https://spellingcreator.org/mcp` (Streamable HTTP) | OAuth 2.1 with a browser consent screen; no token handled by the user | [Remote (hosted) mode](./remote-mode.md) |
| `.mcpb` bundle for Claude Desktop | `src/stdio.js`, launched by Claude Desktop                                          | Supabase refresh token entered in the install dialog                  | [Packaging the bundle](./packaging.md)   |
| Local stdio                       | `src/stdio.js` (the package's `bin`, `spelling-creator-mcp`)                        | `login` helper session file or env tokens                             | [Local setup](./setup.md)                |

The remote route needs Cloudflare (Durable Objects), so a
[self-hosted](../self-hosting.md) Node deployment of the API doesn't serve
`/mcp`; the stdio server works against any deployment.

## Pages in this section

- [Local setup](./setup.md): running the stdio server and pointing a client at it.
- [Configuration](./configuration.md): environment variables for the stdio server.
- [Remote (hosted) mode](./remote-mode.md): the OAuth route in `apps/api`.
- [Tools](./tools.md): the tool surface.
- [Lesson validation](./lesson-validation.md): what the write path enforces.
- [Interactive views](./interactive-views.md): the MCP Apps views.
- [Live sessions](./live-sessions.md): taking part in live collaboration.
- [Development](./development.md): code layout, tests, building views.
- [Packaging the bundle](./packaging.md): building and releasing the `.mcpb`.
