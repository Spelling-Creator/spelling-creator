// The view behind review_proposal (see ../src/views.js for the server half, and
// reviewProposal/mergeProposal in ../src/git.js for what it renders).
//
// Reading a proposal in chat used to mean being handed a URL: propose_changes
// tells the assistant to stop and give the reviewer a link, and finding out what
// happened next meant polling. This is that whole exchange in one card — what
// the proposal changes, whether it would go in cleanly, and the decision itself,
// resolved by a click.
//
// The decision stays the reviewer's, which is the point rather than a caveat.
// merge_proposal and decline_proposal are `visibility: ["app"]`: the model never
// sees them, so the only thing that can call them is a button on this card.
//
// It runs in a sandboxed iframe with no session and no cookies, and calls no API
// directly — `callServerTool` goes back out through the host to this same
// authenticated MCP connection, where the Worker re-checks that the person
// merging is allowed to (the lesson's author or a trusted collaborator).
//
// Bundled into src/views/proposalDiff.html by ../scripts/build-views.mjs.

import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

const panelEl = document.getElementById("panel");

const app = new App(
  { name: "Spelling Creator proposal diff", version: "1.0.0" },
  { availableDisplayModes: ["inline"] },
);

let state = null;
let settled = false;
// Whether the handshake has finished. Nothing may be drawn before it does: the
// card's buttons depend on what the host said it can proxy, and a host is free
// to deliver the tool result before the view has finished connecting — do it in
// that order without this and the diff renders with no way to decide it, which
// is indistinguishable from a host that genuinely can't carry the call.
let ready = false;

// How many change lines the card shows before it stops. A proposal that rewrites
// a lesson can carry dozens, and an inline view must not grow without bound or
// scroll inside itself — so the rest becomes a count, and the whole thing is a
// click away in the web app either way.
const MAX_LINES = 8;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function statusLine(message, kind = "") {
  const node = el("p", `status${kind ? ` ${kind}` : ""}`, message);
  return node;
}

/**
 * Whether a click can actually decide anything. Proxying `tools/call` is a
 * capability the host declares and not every one does — without it the buttons
 * would be decoration, so they are not drawn and the card offers the web app
 * instead. Everything above them still reads, which is most of the value.
 */
function canDecide() {
  return Boolean(app.getHostCapabilities()?.serverTools);
}

/** "3 added · 1 changed" — the shape of the change, matching the web app's chips. */
function chips(counts) {
  const row = el("div", "chips");
  for (const [key, label] of [
    ["added", "added"],
    ["changed", "changed"],
    ["removed", "removed"],
    ["moved", "moved"],
  ]) {
    const n = counts?.[key] || 0;
    if (n > 0) row.append(el("span", `chip ${key}`, `${n} ${label}`));
  }
  return row.childElementCount ? row : null;
}

function changeList(lines) {
  const list = el("ul", "changes");
  for (const line of lines.slice(0, MAX_LINES)) {
    // describeOp writes "- edit text block <id>"; the list provides its own
    // marker, so the leading one goes.
    list.append(el("li", null, line.replace(/^- /, "")));
  }
  const rest = lines.length - MAX_LINES;
  if (rest > 0) list.append(el("li", "more", `+ ${rest} more`));
  return list;
}

/** Tell the model what the reviewer just decided, so its next turn knows. */
function report(text) {
  return app
    .updateModelContext({ content: [{ type: "text", text }] })
    .catch(() => {});
}

async function decide(button, others, { name, verb, done, tell }) {
  for (const b of [button, ...others]) b.disabled = true;
  const status = document.getElementById("status");
  status.className = "status";
  status.textContent = `${verb}…`;
  try {
    const result = await app.callServerTool({
      name,
      arguments: { lessonId: state.lessonId, pullId: state.proposal.id },
    });
    if (result.isError) {
      const detail = result.content?.find((c) => c.type === "text")?.text;
      throw new Error(detail || "That didn't work.");
    }
    settled = true;
    status.className = "status done";
    status.textContent = result.structuredContent?.message || done;
    await report(tell);
  } catch (err) {
    button.disabled = false;
    for (const b of others) b.disabled = false;
    status.className = "status error";
    status.textContent = err?.message || String(err);
  }
}

function actions() {
  const row = el("div", "actions");
  const { proposal, canReview, mergeable, url } = state;

  const open = el("button", "secondary", "Open in the web app");
  open.addEventListener("click", () => {
    app.openLink({ url }).catch(() => {});
  });

  // Nothing to decide: it is already resolved, or nobody here may resolve it.
  if (proposal.status !== "open" || !canReview || !canDecide()) {
    row.append(open);
    return row;
  }

  const merge = el("button", "primary", "Merge");
  const decline = el("button", "danger", "Decline");

  merge.disabled = !mergeable;
  if (!mergeable) {
    merge.title = state.conflicts?.length
      ? "This one needs a decision block by block — merge it in the web app."
      : "There is nothing here to merge yet.";
  }
  merge.addEventListener("click", () =>
    decide(merge, [decline], {
      name: "merge_proposal",
      verb: "Merging",
      done: "Merged into the lesson.",
      tell:
        `The user merged proposal ${proposal.id} ("${proposal.title}") into lesson ${state.lessonId} ` +
        "from the proposal view. It is done — don't merge it again, and don't tell them to go and merge it.",
    }),
  );
  decline.addEventListener("click", () =>
    decide(decline, [merge], {
      name: "decline_proposal",
      verb: "Declining",
      done: "Declined. Its changes are gone.",
      tell:
        `The user declined proposal ${proposal.id} ("${proposal.title}") on lesson ${state.lessonId} from the ` +
        "proposal view. Its changes are dropped and the lesson is unchanged.",
    }),
  );

  row.append(merge, decline, open);
  return row;
}

function render() {
  const { proposal, changes, counts, conflicts, contained, canReview } = state;

  const parts = [el("div", "title", proposal.title || "Proposed changes")];

  const by = [
    proposal.author ? `by ${proposal.author}` : "",
    proposal.revision > 1 ? `revision ${proposal.revision}` : "",
    proposal.status !== "open"
      ? proposal.status === "merged"
        ? "merged"
        : "closed"
      : "",
  ].filter(Boolean);
  if (by.length) parts.push(el("div", "byline", by.join(" · ")));

  const counted = chips(counts);
  if (counted) parts.push(counted);

  if (changes?.length) parts.push(changeList(changes));

  // What stands between this and a merge, when something does. Each of these is
  // a different reason and reads as one — the reviewer should never be left
  // looking at a greyed-out Merge with no explanation for it.
  if (conflicts?.length) {
    parts.push(
      el(
        "p",
        "note warn",
        `${conflicts.length} block${conflicts.length === 1 ? "" : "s"} changed on both sides. ` +
          "Merging those means choosing between two versions, which the web app does block by block.",
      ),
    );
  } else if (contained) {
    parts.push(
      el(
        "p",
        "note",
        "Everything this proposes is already in the lesson. Merging just records that.",
      ),
    );
  } else if (proposal.status === "open" && !canReview) {
    parts.push(
      el(
        "p",
        "note",
        "Only this lesson's author or a trusted collaborator can merge or decline it.",
      ),
    );
  } else if (proposal.status === "open" && !canDecide()) {
    parts.push(
      el(
        "p",
        "note",
        "This client can't carry the decision back, so merging and declining happen in the web app.",
      ),
    );
  }

  parts.push(actions());

  const status = statusLine("");
  status.id = "status";
  parts.push(status);

  panelEl.replaceChildren(...parts);
}

app.ontoolresult = (result) => {
  const data = result.structuredContent;
  // A decision already taken in this card outranks a re-delivered result: hosts
  // may replay the tool result (a reconnect, a re-render), and redrawing a live
  // Merge button over a merge that already happened invites doing it twice.
  if (settled) return;
  if (!data || !data.proposal) {
    panelEl.replaceChildren(
      statusLine(data?.note || "There is no proposal to show.", "error"),
    );
    return;
  }
  state = data;
  if (ready) render();
};

function applyHostContext(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  const insets = ctx.safeAreaInsets;
  if (insets) {
    document.body.style.padding =
      `${insets.top || 0}px ${insets.right || 0}px ` +
      `${insets.bottom || 0}px ${insets.left || 0}px`;
  }
}

app.onhostcontextchanged = applyHostContext;
app.onerror = (err) => {
  const status = document.getElementById("status");
  if (status) {
    status.className = "status error";
    status.textContent = err?.message || String(err);
  }
};

app.connect().then(() => {
  ready = true;
  applyHostContext(app.getHostContext());
  // Keeps the host's container in step with the card's real height.
  app.setupSizeChangedNotifications();
  // The result may already have arrived, in which case it was held until now.
  if (state && !settled) render();
});
