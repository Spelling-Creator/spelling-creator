// The proposal view's surface (review_proposal, merge_proposal,
// decline_proposal — see src/views.js and reviewProposal/mergeProposal in
// src/git.js).
//
// The card itself can't be rendered from here, so what's pinned down is
// everything a host doesn't need to render: the wiring (the `ui://` resource,
// the tool pointing at it, the visibility metadata), the diff the view draws,
// and the merge it performs. The last of those is worth real coverage rather
// than a stub — a merge writes to three places in a fixed order, and the Worker
// rejects the last one unless the first two landed, so the order IS the
// behaviour. These build actual packfiles for a lesson and a fork of it, exactly
// as core's review.test.js does, so the ancestry the diff and the merge base
// depend on is real ancestry and not a fixture.

import assert from "node:assert/strict";
import test from "node:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { memRepo } from "@spelling-creator/core/git/memfs";
import { cloneFromPack, packRepo } from "@spelling-creator/core/git/pack";
import { commitDoc } from "@spelling-creator/core/git/repo";

import { registerTools, SERVER_INFO } from "../src/tools.js";
import { PROPOSAL_DIFF_URI } from "../src/views.js";

const CONFIG = { apiUrl: "https://example.test" };
const AUTHOR = { name: "Test", email: "test@example.com" };

// A client that renders MCP Apps, declared the way the extension negotiates.
const RENDERS_VIEWS = {
  extensions: {
    "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
  },
};

async function connected(api = {}, capabilities = {}) {
  const server = new McpServer(SERVER_INFO);
  registerTools(server, { api, config: CONFIG });
  const client = new Client({ name: "test", version: "0" }, { capabilities });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

/** A lesson of two text blocks, each addressable so a test can change one. */
function doc(one, two) {
  return {
    title: "Volcanoes",
    sections: [
      {
        id: "s1",
        name: "One",
        blocks: [
          { id: "b1", type: "text", text: one },
          { id: "b2", type: "text", text: two },
        ],
      },
    ],
  };
}

const PULL = {
  id: "P1",
  title: "Fix the second paragraph",
  body: "It was wrong.",
  author: "A Proposer",
  status: "open",
  ready: true,
  revision: 1,
  sourceLessonId: "F1",
  createdAt: "2026-01-01T00:00:00Z",
  // Null rather than absent, as the hub sends it (rowToPull in the Worker) —
  // an undefined field would vanish from the JSON text block and make it
  // disagree with structuredContent for a reason nothing real produces.
  updatedAt: null,
};

/**
 * A stub hub holding one lesson, one fork of it, and a proposal carrying the
 * fork's changes — with both histories as real packfiles, so they share the
 * ancestry a three-way merge needs.
 *
 * `lessonDoc` is what the lesson's ROW says, which is not always what its
 * history says: pass one that differs to exercise the drift the merge has to
 * commit before it can merge anything.
 */
async function hub({ lessonDoc, forkDoc, canReview = true } = {}) {
  const lesson = memRepo("lesson");
  await commitDoc({ ...lesson, doc: doc("first", "second"), author: AUTHOR });
  const lessonPack = await packRepo(lesson);

  const fork = memRepo("fork");
  await cloneFromPack({ ...fork, ...lessonPack });
  await commitDoc({
    ...fork,
    doc: forkDoc || doc("first", "SECOND, corrected"),
    author: AUTHOR,
  });
  const pullPack = await packRepo(fork);

  const calls = { pushed: [], updated: [], merged: [], closed: [] };
  const api = {
    calls,
    // The signature a merge commit is stamped with: the hub attributes
    // everything to the account whose token this is, and the reviewer merging
    // is that account.
    async whoami() {
      return { id: "u1", displayName: "A Reviewer", email: "r@example.test" };
    },
    async listPulls() {
      return { pulls: [PULL], canReview };
    },
    async getLesson() {
      return {
        id: "L1",
        title: "Volcanoes",
        doc: lessonDoc || doc("first", "second"),
      };
    },
    async fetchLessonPack() {
      return lessonPack;
    },
    async fetchPullPack() {
      return pullPack;
    },
    async pushLessonPack(lessonId, args) {
      calls.pushed.push({ lessonId, ...args });
      return {};
    },
    async updateLesson(id, args) {
      calls.updated.push({ id, ...args });
      return {};
    },
    async mergePull(lessonId, pullId, mergeCommit) {
      calls.merged.push({ lessonId, pullId, mergeCommit });
      return { ...PULL, status: "merged", mergeCommit };
    },
    async closePull(lessonId, pullId) {
      calls.closed.push({ lessonId, pullId });
      return { ...PULL, status: "closed" };
    },
  };
  return { api, calls, lessonPack, pullPack };
}

const review = (client, args = { lessonId: "L1" }) =>
  client.callTool({ name: "review_proposal", arguments: args });

test("the proposal view is offered as a ui:// resource a host can render", async () => {
  const { api } = await hub();
  const client = await connected(api);

  const { resources } = await client.listResources();
  const view = resources.find((r) => r.uri === PROPOSAL_DIFF_URI);
  assert.ok(view, "the view is listed");
  assert.equal(view.mimeType, "text/html;profile=mcp-app");

  const { contents } = await client.readResource({ uri: PROPOSAL_DIFF_URI });
  const [content] = contents;
  assert.match(content.text, /<!doctype html>/i);
  // Self-contained: a sandboxed view may not fetch a script at runtime.
  assert.ok(!/<script[^>]+src=/i.test(content.text), "no external script");
  // The origin Claude renders nothing at all without.
  assert.match(
    content._meta.ui.domain,
    /^[0-9a-f]{32}\.claudemcpcontent\.com$/,
  );
});

test("review_proposal points at the view; the decisions are the app's alone", async () => {
  const { api } = await hub();
  const client = await connected(api);
  const { tools } = await client.listTools();
  const by = (name) => tools.find((t) => t.name === name);

  assert.equal(by("review_proposal")._meta.ui.resourceUri, PROPOSAL_DIFF_URI);
  // registerAppTool mirrors the nested key to the flat one older hosts read.
  assert.equal(
    by("review_proposal")._meta["ui/resourceUri"],
    PROPOSAL_DIFF_URI,
  );

  // The whole basis for merging over MCP at all: a host that reads this keeps
  // both tools away from the model, so the only caller is a button in the view.
  for (const name of ["merge_proposal", "decline_proposal"]) {
    assert.deepEqual(by(name)._meta.ui.visibility, ["app"]);
  }
});

test("the diff is measured from where the histories diverged", async () => {
  // The lesson's author has edited the OTHER block since the fork left. That
  // edit is not something this proposal is asking for, and must not appear in
  // its diff — measured against the lesson's tip instead of the merge base, it
  // would show up reversed, as though the proposer wanted it undone.
  const { api } = await hub({ lessonDoc: doc("FIRST, revised", "second") });
  const client = await connected(api);

  const res = await review(client);
  const { changes, counts, conflicts } = res.structuredContent;

  assert.deepEqual(changes, ["- edit text block b2 (text)"]);
  assert.deepEqual(counts, { added: 0, changed: 1, removed: 0, moved: 0 });
  assert.deepEqual(conflicts, []);
});

test("blocks both sides rewrote come back as conflicts, not as a diff to merge", async () => {
  // Same block, different words, on both sides: the one thing a merge here
  // refuses to guess at.
  const { api } = await hub({
    lessonDoc: doc("first", "SECOND, per the author"),
  });
  const client = await connected(api);

  const res = await review(client);
  assert.deepEqual(res.structuredContent.conflicts, [
    { blockId: "b2", kind: "edit/edit", fields: ["text"] },
  ]);
  assert.equal(res.structuredContent.mergeable, false);
});

test("a rendered proposal is the reviewer's to settle; a text one is relayed", async () => {
  const { api } = await hub();

  const rendered = await review(await connected(api, RENDERS_VIEWS));
  // Ahead of the diff, not buried in it — the model meets the instruction
  // before it meets something that looks like a decision to take.
  assert.match(rendered.content[0].text, /STOP HERE/);
  assert.match(rendered.content[0].text, /the decision is the USER's/);
  assert.match(rendered.content[0].text, /don't send them to the web app/);
  assert.deepEqual(
    JSON.parse(rendered.content[1].text),
    rendered.structuredContent,
  );

  const textOnly = await review(await connected(api));
  assert.match(textOnly.structuredContent.note, /Relay what this changes/);
  assert.doesNotMatch(textOnly.content[0].text, /STOP HERE/);
  // Either way the diff travels, and so does the page it can be settled on.
  assert.equal(
    textOnly.structuredContent.url,
    "https://example.test/hub/L1/proposals/P1",
  );
});

test("mergeable says what the buttons need, and canReview gates it", async () => {
  const { api } = await hub();
  const mine = await review(await connected(api, RENDERS_VIEWS));
  assert.equal(mine.structuredContent.mergeable, true);
  assert.equal(mine.structuredContent.canReview, true);

  const { api: theirs } = await hub({ canReview: false });
  const other = await review(await connected(theirs, RENDERS_VIEWS));
  assert.equal(other.structuredContent.mergeable, false);
});

test("merging pushes the history, saves the lesson, then records the merge", async () => {
  const { api, calls, lessonPack } = await hub();
  const client = await connected(api, RENDERS_VIEWS);

  const res = await client.callTool({
    name: "merge_proposal",
    arguments: { lessonId: "L1", pullId: "P1" },
  });
  assert.equal(res.isError, undefined, res.content?.[0]?.text);
  assert.equal(res.structuredContent.ok, true);

  // The order is the contract, not a convention: the Worker refuses to mark a
  // proposal merged unless the lesson's stored history already points at the
  // merge commit, so recording it can only come last.
  assert.equal(calls.pushed.length, 1);
  assert.equal(calls.updated.length, 1);
  assert.equal(calls.merged.length, 1);
  assert.equal(calls.merged[0].mergeCommit, calls.pushed[0].head);
  assert.equal(res.structuredContent.commit, calls.pushed[0].head);

  // The proposer's text landed in the document that was saved.
  const saved = calls.updated[0].doc;
  assert.equal(saved.sections[0].blocks[1].text, "SECOND, corrected");

  // A compare-and-swap against the tip we read, so a save that lands in between
  // is refused rather than overwritten. Against THIS hub's pack: a second hub()
  // builds its own commits, and they only carry the same oids while the two are
  // made in the same second — an assertion that passes on the clock is worse
  // than none.
  assert.equal(calls.pushed[0].parent, lessonPack.head);
});

test("a merge takes the lesson's row with it, not just the commit it had", async () => {
  // The row is ahead of the history — an edit whose history push failed. The
  // merge has to carry that content forward; merging from the stored tip would
  // write the result over it and silently revert somebody's save.
  const { api, calls } = await hub({
    lessonDoc: doc("FIRST, saved but never committed", "second"),
  });
  const client = await connected(api, RENDERS_VIEWS);

  const res = await client.callTool({
    name: "merge_proposal",
    arguments: { lessonId: "L1", pullId: "P1" },
  });
  assert.equal(res.isError, undefined, res.content?.[0]?.text);

  const saved = calls.updated[0].doc;
  assert.equal(
    saved.sections[0].blocks[0].text,
    "FIRST, saved but never committed",
  );
  assert.equal(saved.sections[0].blocks[1].text, "SECOND, corrected");
});

test("a merge refuses when the lesson was saved under it, writing nothing", async () => {
  // PUT /lessons/:id has no compare-and-swap, and a save that moved the row
  // without moving its history slips past the push's. So the row is re-read at
  // the last moment: here it changes between the merge being prepared and being
  // written, which has to end with nothing done rather than with that save
  // reverted by the merged document.
  const { api, calls } = await hub();
  const first = api.getLesson;
  let reads = 0;
  api.getLesson = async (...args) => {
    const lesson = await first(...args);
    reads += 1;
    // Every read after the one the merge is based on sees somebody else's save.
    return reads === 1
      ? lesson
      : { ...lesson, doc: doc("first", "SECOND, saved by the author") };
  };

  const res = await (
    await connected(api, RENDERS_VIEWS)
  ).callTool({
    name: "merge_proposal",
    arguments: { lessonId: "L1", pullId: "P1" },
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /saved by someone else/);
  assert.deepEqual(calls.pushed, []);
  assert.deepEqual(calls.updated, []);
  assert.deepEqual(calls.merged, []);
});

test("a history that can't be read is an error, not a lesson without one", async () => {
  // fetchLessonPack answers null only for a lesson that genuinely has no pack.
  // Flattening a failure into that would tell a reviewer the proposal adds the
  // whole lesson — and would let a merge build a root history of its own.
  const { api, calls } = await hub();
  api.fetchLessonPack = async () => {
    throw new Error("Could not download the history.");
  };
  const client = await connected(api, RENDERS_VIEWS);

  const read = await review(client);
  assert.equal(read.isError, true);
  assert.match(read.content[0].text, /Could not download the history/);

  const merge = await client.callTool({
    name: "merge_proposal",
    arguments: { lessonId: "L1", pullId: "P1" },
  });
  assert.equal(merge.isError, true);
  assert.deepEqual(calls.pushed, []);
  assert.deepEqual(calls.merged, []);
});

test("an open proposal that never uploaded reads as unready, not as declined", async () => {
  // Same "no pack" shape as a resolved proposal, and the opposite meaning:
  // telling someone their proposal was closed when nobody has looked at it is
  // the one wrong answer here.
  const { api } = await hub();
  api.listPulls = async () => ({
    pulls: [{ ...PULL, ready: false }],
    canReview: true,
  });
  api.fetchPullPack = async () => null;

  const res = await review(await connected(api), {
    lessonId: "L1",
    pullId: "P1",
  });
  assert.equal(res.isError, undefined);
  assert.equal(res.structuredContent.proposal, null);
  assert.match(res.structuredContent.note, /never finished uploading/);
  assert.doesNotMatch(res.structuredContent.note, /closed|merged/);
});

test("a conflicted merge changes nothing and says where to settle it", async () => {
  const { api, calls } = await hub({
    lessonDoc: doc("first", "SECOND, per the author"),
  });
  const client = await connected(api, RENDERS_VIEWS);

  const res = await client.callTool({
    name: "merge_proposal",
    arguments: { lessonId: "L1", pullId: "P1" },
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /choosing between two versions/);
  assert.match(res.content[0].text, /example\.test\/hub\/L1\/proposals\/P1/);
  assert.match(res.content[0].text, /b2/);
  // Nothing written anywhere: not the history, not the row, not the status.
  assert.deepEqual(calls.pushed, []);
  assert.deepEqual(calls.updated, []);
  assert.deepEqual(calls.merged, []);
});

test("declining closes the proposal and leaves the lesson alone", async () => {
  const { api, calls } = await hub();
  const client = await connected(api, RENDERS_VIEWS);

  const res = await client.callTool({
    name: "decline_proposal",
    arguments: { lessonId: "L1", pullId: "P1" },
  });
  assert.equal(res.isError, undefined);
  assert.deepEqual(calls.closed, [{ lessonId: "L1", pullId: "P1" }]);
  assert.deepEqual(calls.pushed, []);
  assert.deepEqual(calls.updated, []);
});

// The backstop for a host that ignores `visibility: ["app"]` and lets the model
// call these anyway. Where no view was ever drawn, nobody can have pressed
// anything, so the call is the model settling a proposal that isn't its to
// settle — and the answer is the web app, which is where every merge happened
// before this view existed.
for (const name of ["merge_proposal", "decline_proposal"]) {
  test(`${name} refuses a client that cannot show the reviewer the diff`, async () => {
    const { api, calls } = await hub();
    const client = await connected(api);

    const res = await client.callTool({
      name,
      arguments: { lessonId: "L1", pullId: "P1" },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /the reviewer's decision, not yours/);
    assert.deepEqual(calls.pushed, []);
    assert.deepEqual(calls.merged, []);
    assert.deepEqual(calls.closed, []);
  });
}

test("merging refuses when this reviewer may not, and when it is already settled", async () => {
  const { api: notMine } = await hub({ canReview: false });
  const res = await (
    await connected(notMine, RENDERS_VIEWS)
  ).callTool({
    name: "merge_proposal",
    arguments: { lessonId: "L1", pullId: "P1" },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /author or a trusted collaborator/);

  const { api } = await hub();
  api.listPulls = async () => ({
    pulls: [{ ...PULL, status: "merged" }],
    canReview: true,
  });
  const again = await (
    await connected(api, RENDERS_VIEWS)
  ).callTool({
    name: "merge_proposal",
    arguments: { lessonId: "L1", pullId: "P1" },
  });
  assert.equal(again.isError, true);
  assert.match(again.content[0].text, /already merged/);
});

test("a proposal whose changes are gone reads as settled, not as an error", async () => {
  // Closing a proposal drops its pack, so this is what a resolved one looks
  // like from here — and the reviewer needs telling, not a stack trace.
  const { api } = await hub();
  api.listPulls = async () => ({
    pulls: [{ ...PULL, status: "closed" }],
    canReview: true,
  });
  api.fetchPullPack = async () => null;

  const res = await review(await connected(api), {
    lessonId: "L1",
    pullId: "P1",
  });
  assert.equal(res.isError, undefined);
  assert.equal(res.structuredContent.proposal, null);
  assert.match(res.structuredContent.note, /no changes any more/);
});

test("review_proposal picks the open proposal when it isn't told which", async () => {
  const { api } = await hub();
  api.listPulls = async () => ({
    pulls: [{ ...PULL, id: "P2", status: "closed", ready: true }, PULL],
    canReview: true,
  });
  const res = await review(await connected(api));
  assert.equal(res.structuredContent.proposal.id, "P1");
});

test("asking for a proposal a lesson hasn't got says so plainly", async () => {
  const { api } = await hub();
  api.listPulls = async () => ({ pulls: [], canReview: true });
  const client = await connected(api);

  const missing = await review(client, { lessonId: "L1", pullId: "NOPE" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /no proposal NOPE/);

  const none = await review(client);
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /no open proposal to review/);
});
