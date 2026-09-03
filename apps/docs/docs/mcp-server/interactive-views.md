---
title: Interactive views (MCP Apps)
---

# Interactive views (MCP Apps)

Everything the [tools](./tools.md) do happens in the assistant's chat window. The
assistant describes the lesson it wrote, lists image candidates as text, hands over a
URL to a proposal and asks the user to go read it. The maker itself — the thing with the
editor, the section layout, the picture — is somewhere the user has to go **next**, in
another tab, after the conversation.

[MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) closes that gap. It
is the first official MCP extension (SEP-1865, stable 2026-01-26), and it lets a server
return a small **interactive interface** alongside a tool's result: the host fetches an
HTML resource the server declares and renders it inline in the conversation — in a
sandboxed iframe on web and desktop, and in a native WebView on mobile, which is the same
sandbox from the view's side but not the same renderer. Claude supports it for custom
connectors as well as directory ones, and over both of this server's transports: a
[remote](./remote-mode.md) connection, and a local stdio one in the desktop app.

The point is not decoration. It's that the parts of authoring that are genuinely visual —
choosing a photograph, reading a diff, seeing which of fifteen questions failed
validation — stop being described and start being **shown, in place**, without leaving
the conversation the lesson is being written in.

## Where this stands

Two tools ship a view:

- **`search_images`** — the candidates come back as a picker instead of a text list, and
  choosing one calls `add_image` directly.
- **`review_proposal`** — a proposal's diff, with **Merge** and **Decline** on it for the
  lesson's reviewer. See [The proposal view](#the-proposal-view), which is the more
  interesting of the two: it is where a view changes what is _possible_ rather than only
  what things look like.

Everything else is text-only and works exactly as documented in [Tools](./tools.md). See
[The rest of the surface](#the-rest-of-the-surface) for what's next and why.

Nothing here is required. A host that doesn't do MCP Apps — Claude Code in a terminal,
say — never reads the `ui://` resource and gets the same text result it always did; the
`_meta.ui` a tool carries is simply inert to it. That's why the server registers views
unconditionally rather than branching on the capability. The text path stays the
contract; views are an enhancement on top of it.

What a tool **says** does branch, and it's worth knowing why. See
[Say the right thing to each client](#say-the-right-thing-to-each-client).

## How it fits together

```text
   MCP server                    Host (Claude)                  View (iframe)
   ──────────                    ─────────────                  ─────────────
   tool + ui:// resource   ──▶   fetches the resource     ──▶   renders
                                 renders the sandbox
   tools/call              ◀──   proxies the call         ◀──   user picks something
```

Three things follow from that shape, and they're the whole design:

**The view is a bundle this server ships**, not the maker in an iframe. That's not a
preference — Claude's sandbox applies `frame-src 'self' blob: data:` and the spec's
`frameDomains` escape hatch is
[restricted in Claude pending security review](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines#content-security-policy).
So a view is a self-contained HTML document served from a `ui://` URI, built here and
inlined into the server the same way [`standards.md`](./overview.md) is.

**The view calls tools, not the API.** It has no Supabase session and no cookies — it's a
sandboxed frame on an opaque origin. But the MCP connection it hangs off is already
authenticated ([remote mode](./remote-mode.md)'s OAuth grant, or the stdio server's
token), so a `tools/call` from the view runs as the same user with the same validation
and attribution as one from the model. Nothing new to authorise, and no second auth path
to keep safe. The picker calls the ordinary `add_image` this way. A tool that exists
only to serve a view can go further and declare `visibility: ["app"]`, which hides it from
the model altogether so it never takes up room in the context — which is what
`merge_proposal` and `decline_proposal` do, and the reason the reviewer's decision can be
offered in the conversation without being handed to the assistant. See
[Who may call what](#who-may-call-what).

Proxying is a capability the host declares (`serverTools`), though, and a view has to read
it rather than assume it — the picker checks before it offers a button that would place an
image, and falls back to telling the assistant which file was chosen when the host won't
carry the call.

**What the user does in the view goes back to the model.** A view can push a note into
the model's context (`ui/update-model-context`) or send a follow-up turn
(`ui/message`), so a choice made by clicking is a thing the assistant knows about and can
build on — rather than a silent side effect it then contradicts. It can also ask the host
to open a link (`ui/open-link`), which is how a view hands off to the real maker for work
that belongs there.

## Say the right thing to each client

A view changes who is doing the work, and a tool result that ignores that fights it.

`search_images` returns a list of photographs. In a terminal that list is addressed to the
assistant, because the assistant is the only one who can act on it — "choose the best
`ref` and call `add_image`" is the correct and only useful thing to say. Send those same
words to a host that just drew twelve cards and the assistant does what it was told: it
picks from prose descriptions of images it cannot see, adds one, and reports it — while
the user is still reading the picker. The picker didn't fail; it was talked over. The
choice it existed to hand across was taken back a second before the user could make it.

So the tool asks who is looking, through `rendersViews()` in `src/views.js`:

```js
const ui = getUiCapability(server.server.getClientCapabilities());
return Boolean(ui?.mimeTypes?.includes(RESOURCE_MIME_TYPE));
```

That reads the `io.modelcontextprotocol/ui` entry the host declared at initialisation —
the same negotiation that decides whether the view is fetched at all — and when the host
named the mime type the views are served under, `search_images` leads its result with an
instruction to stop: end the turn, add nothing, wait to be told what the user clicked. The
candidates still follow, in the text block and in `structuredContent` alike, so the model
can still answer "the fox one, please" without searching again. Only the instruction
changes.

Three things about the shape of that, all learned the hard way:

- **The instruction goes first, as its own content block.** A rule appended to a JSON blob
  is a rule read after the model has already met the list and decided what to do with it.
- **It has to be blunt.** "The user may pick one" reads as permission to pick first. What
  works is naming the stop and the reason: they can see the pictures, you cannot.
- **An uncertain answer is `false`.** Both halves of that check are required — a host that
  declared the extension but named no mime types takes the text path. The two ways of
  guessing wrong are not equally bad. Saying "text" to a host that renders leaves the old
  behaviour: the assistant picks over the user, rude but undone in one sentence. Saying
  "renders" to a host that doesn't ends the turn waiting for a click on a picker nobody
  drew, and nothing will ever arrive — the conversation just stops, with no clue why.

`review_proposal` does the same thing one step further on, and it is the same sentence in
both directions: rendered, the diff is on screen with both decisions on it, so the result
tells the assistant to stop — and specifically not to send the user to the web app for
something the buttons already do. Text-only, relaying the diff and handing over the URL is
the only thing that _can_ happen, so that is what it asks for.

The rule generalises: what the model is told has to match what the user can already see, or
the two race. Registration stays unconditional — the branch belongs in the words, not in
the wiring.

## The proposal view

The picker replaced a list of prose descriptions with the pictures they described — a
better way to do something the assistant could already do. The proposal view is a
different kind of change: it moves a decision that was **only** available in another tab
into the conversation, without moving it to the model.

`propose_changes` hands over a URL, tells the assistant to stop, and offers polling as the
way to find out what the human decided. `review_proposal` renders the diff instead, with
Merge and Decline on it, and the reviewer settles it where they are reading it.

### Who may call what

Merging has always been the reviewer's decision, and the reason was never that the server
couldn't do it — it is that an assistant merging on their behalf settles somebody else's
lesson. So the view gets the buttons and the model does not:

```js
_meta: {
  ui: {
    visibility: ["app"];
  }
}
```

A host that reads that keeps `merge_proposal` and `decline_proposal` out of the model's
tool list altogether — they never take up room in its context — and proxies them only for
the view. That is the case
[`visibility`](https://modelcontextprotocol.io/extensions/apps/overview) exists for, and
this server's first use of it.

Not every host honours it, so both tools also check `rendersViews()` for themselves. If no
view was ever drawn, nobody can have pressed anything, and the call can only be the model
deciding something that isn't its decision — so it's refused, with the proposal's URL,
which is where every merge happened until this view existed. That leaves one gap worth
naming: a host that renders views **and** ignores `visibility` could still let a model call
them. Nothing in the protocol distinguishes a proxied click from a model's own call, so the
mitigation there is the wording of the tool descriptions rather than a check.

### What a click actually does

The view calls tools; the tools do the work, server-side, over the same authenticated
connection (see [Tools](./tools.md#deciding-a-proposal-in-the-conversation) for the
sequence, and why the hub accepts no other order). Two boundaries are deliberate:

- **Conflicts stop here.** A block both sides have rewritten needs a human looking at two
  versions, and the web app has that dialog. The view names the contested blocks and
  offers to open it rather than growing a second conflict UI into a card that also must
  not scroll.
- **The diff shows the shape of the change, not its full text** — one line per operation,
  in the same words the merge commit will carry, matching `ChangeSummary.jsx` on the web
  app's own proposal page. A proposal that read differently in the two places would be
  worse than no summary at all. Long lists are truncated with a count; nothing inside the
  card scrolls, because on mobile a vertical drag there belongs to the conversation.

## Writing a view

A view's source is `apps/mcp/views/<name>.{html,js}`, built by
`pnpm --filter @spelling-creator/mcp build:views` into one self-contained
`src/views/<name>.html` — bundle inlined, nothing left to fetch. That output is committed,
so the server keeps having no build step of its own; see
[Development](./development.md) for why and when to rebuild. Registration uses
[`@modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps)'s
server helpers rather than raw `_meta`:

- `registerAppTool` registers the tool and links it to its UI with
  `_meta.ui.resourceUri`.
- `registerAppResource` serves the HTML under a `ui://` URI with the
  `text/html;profile=mcp-app` mime type.

A few host-specific requirements are worth stating plainly, because getting them wrong
fails **silently** — Claude reports that a widget rendered and then shows nothing:

- **Set `_meta.ui.domain`** to
  `sha256("<the /mcp endpoint URL>").slice(0, 32) + ".claudemcpcontent.com"`. It's
  deterministic and self-computed, not a credential — it gives the view a stable origin,
  which is also what an API would allowlist for CORS if a view ever needed to fetch one
  directly. The documented purpose is that CORS case, but Claude is widely reported to
  fetch the resource, announce that a widget rendered, and then show nothing when the
  field is missing, so treat it as required.
- **Inline everything.** Scripts pulled from a CDN at runtime are blocked unless their
  origin is declared in `_meta.ui.csp.resourceDomains`, and have been observed to crash
  the view mid-load even then. The build produces one file with no external references.
- **Version the `ui://` URI** when a view's markup changes shape. Hosts cache resources
  independently of the server, and an old client holding an old template must keep
  working — so serve the old URI as well as the new one rather than mutating one in
  place.

Beyond that, Claude's
[design guidelines](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines)
are worth following closely, since they're what makes a view feel like part of the
product rather than an embedded web page: use the host's CSS custom properties
(`--color-background-primary`, `--font-text-md-size`, `--border-radius-md`, …) instead of
hardcoded colours so light and dark mode both work; keep inline cards to their content
height with no nested vertical scrolling, since on mobile a vertical drag inside a view
scrolls the conversation rather than the view; prefer visible controls to dropdowns and
popovers, which get clipped by the container; and use skeletons rather than spinners
while loading — the same rule the [web app](/web-app/overview) follows.

## Trying one without a host

A view can't be exercised from the test suite — that needs something to render it. So
`test/views.test.js` (the picker) and `test/proposalView.test.js` (the proposal diff) cover
the half that a connection can see, through an in-memory MCP client: that the `ui://`
resource is listed and readable, under the mime type hosts look for, self-contained,
carrying the origin and the CSP entry, with the tool's `_meta` pointing at it. That's the
wiring a host silently refuses to render without, and all of it is checkable without ever
rendering anything.

The capability branch is checkable there too, and is: a client that declares
`io.modelcontextprotocol/ui` gets the hands-off result, a plain one still gets "choose the
best `ref`". Both are only what a `tools/call` returns, so neither needs a renderer.

The proposal view's tests go further, because what its buttons call is not a rendering
concern at all: they build real packfiles for a lesson and a fork of it — as
`packages/core/src/git/review.test.js` does — so the ancestry the diff and the merge base
depend on is real ancestry. That's what pins down the things a stub would hide: that the
diff is taken from the merge base, that a merge pushes, saves and records in that order and
with a compare-and-swap, that it carries the lesson's saved document forward rather than
the doc at its stored tip, that a conflicted merge writes nothing anywhere, and that both
app-only tools refuse a client that never drew the view.

A view's own behaviour — that it draws what it was sent, that a click calls the right tool
with the right arguments, that it degrades when the host won't proxy that call — is checked
by hand against a host. The two ways to get one:

- **A stub host.** A page that iframes the built HTML, answers `ui/initialize` with a
  `hostContext`, then sends the tool result as a `ui/notifications/tool-result`
  notification is enough to render the view and watch the `tools/call` it sends back. Fast
  to throw together, and it will catch the things that actually break — a corrupted
  bundle, a card that wraps, a click that sends the wrong arguments.
  `AppBridge` from `@modelcontextprotocol/ext-apps/app-bridge` is the host half, over a
  `PostMessageTransport` built on `iframe.contentWindow`; with `null` for the MCP client,
  register your own `CallToolRequestSchema` handler and log what arrives. Two ordering
  traps, both of which look exactly like a broken view:
  - **Connect the bridge before the view's script runs**, i.e. leave the iframe blank and
    set `src` afterwards. The transport only starts listening at `connect()`, and the
    `ui/initialize` the view sends on load is otherwise dropped — leaving it waiting
    forever on a response, with nothing drawn and nothing logged.
  - **Send the tool result on the `initialized` notification**, not straight after setting
    `src`. A notification posted into a frame whose script hasn't run yet goes nowhere,
    and the view then renders its skeleton and stops.
- **A real one.** The [ext-apps repo](https://github.com/modelcontextprotocol/ext-apps)
  ships `examples/basic-host`, and Claude Desktop renders a local stdio server directly
  (or a remote one through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote)).

## The rest of the surface

`search_images` went first because it is the interaction chat is worst at: picking a
photograph from prose descriptions of photographs. The proposal diff went second because
it was the one whose text version a view could delete outright. The rest, roughly in order
of how much a view would buy:

| Tool                                      | View                                                           |
| ----------------------------------------- | -------------------------------------------------------------- |
| `list_my_lessons` / `list_hub_lessons`    | A browsable card list rather than a text table                 |
| `validate_lesson`                         | Findings grouped per section, clickable to the offending block |
| `create_lesson` / `patch_lesson`          | The lesson as the maker lays it out                            |
| `join_collab_session` / `read_collab_doc` | The live document, its participants and its chat               |

The lesson browser is the cheapest of these: every action it needs is already a tool
(`get_lesson` to open, `set_lesson_published` to toggle, `ui/open-link` to hand off to the
maker), so it is a rendering job and nothing else.

`validate_lesson`'s is worth noting for how it differs from the two that ship: the audience
inverts. Validation is a tool the **model** uses while composing, so a view there is for
the human watching rather than for anyone choosing — which means no
[capability branch](#say-the-right-thing-to-each-client) at all, since nothing about what
the model should do next changes.

A collaboration view is the only one on the list that would need no new server surface
whatsoever, and it is missing from this table's earlier versions: the
[live session](./live-sessions.md) tools already hold the document, the participants and
the chat between calls.

## Alternatives considered

**Deep links that arrive signed in.** Tools already return a `url` for the lesson or
proposal they touched, but following one can land on a login wall, and lands on the
lesson's page rather than at the thing that just changed. A short-lived signed ticket on
that URL would open the maker at the right place, already authenticated. It doesn't
compete with views — it's what makes leaving the conversation cheap, and it's the only
lever available in a client that renders no UI at all.

**Pairing with a live maker tab.** The web app already has
[live collaboration](/web-app/live-collaboration): a `CollabRoom` Durable Object,
server-verified Supabase identity, and CRDT merging per field. An MCP server that joined
that room as a participant would let a user keep the maker open and watch the
assistant's edits land while they type alongside them — the strongest "built in" feeling
available here, and the one that needs no view bundle at all. It is also the largest
piece of work, since it means speaking the room's binary protocol from the server side.

**Bringing the assistant into the maker.** The inverse: an agent loop in `apps/api` over
this same tool layer, driving a chat panel in the editor. That's a different product
decision, not a protocol one — it changes who pays for the model, where the existing
Turnstile-gated [AI helpers](/web-app/ai-text-suggestions) fit, and how much of the
assistant's behaviour this repo owns.
