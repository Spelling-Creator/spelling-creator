// Version history for every lesson, built with the same git code the editor and
// the MCP server use, so the History tab, forking and proposals all work on real
// packfiles. Each lesson's history is made up (it grows a section or two at a
// time over a few days); the documents in it are the real ones.

import crypto from "node:crypto";
import { memRepo } from "@spelling-creator/core/git/memfs";
import { commitDoc } from "@spelling-creator/core/git/repo";
import { packRepo, cloneFromPack } from "@spelling-creator/core/git/pack";
import { PEOPLE, byId } from "./people.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;

// commitDoc stamps commits with Date.now(). Backdating them is the point here.
async function at(ms, fn) {
  const realNow = Date.now;
  Date.now = () => ms;
  try {
    return await fn();
  } finally {
    Date.now = realNow;
  }
}

const authorOf = (uid) => ({ uid, name: byId[uid].displayName });

async function packed(ctx) {
  const p = await packRepo(ctx);
  return { packfile: Buffer.from(p.packfile), head: p.head, refs: p.refs };
}

/** A history for one lesson: the first section, then half, then nearly all, then all. */
export async function buildHistory(lesson) {
  const ctx = memRepo();
  const sections = lesson.doc.sections;
  const born = Date.parse(lesson.createdAt);
  const steps = [
    [sections.slice(0, 1), born - 4 * DAY],
    [sections.slice(0, Math.ceil(sections.length / 2)), born - 3 * DAY],
    [sections.slice(0, Math.max(1, sections.length - 1)), born - 2 * DAY],
    [sections, born - DAY + 5 * HOUR],
  ];
  for (const [part, when] of steps) {
    await at(when, () =>
      commitDoc({
        ...ctx,
        doc: { ...lesson.doc, sections: part },
        author: authorOf(lesson.authorId),
      }),
    );
  }
  return packed(ctx);
}

/**
 * Jordan's proposal to Maya's Penguins lesson: a clone of its history with two
 * questions about the huddle added to the end of one section. Returns the pull
 * request record and its pack, or null when the snapshot has no Penguins.
 */
export async function buildProposal(state, packs) {
  const penguins = state.find("Penguins");
  if (!penguins) return null;
  const base = packs.get(penguins.id);
  const ctx = memRepo();
  await cloneFromPack({
    ...ctx,
    packfile: base.packfile,
    head: base.head,
    refs: base.refs,
  });

  const doc = structuredClone(penguins.doc);
  const section =
    doc.sections.find((s) => /huddle|cold|warm|emperor/i.test(s.name)) ??
    doc.sections.at(-1);
  // Appended, so the proposal reads as two additions rather than a reshuffle.
  section.blocks.push(
    {
      id: crypto.randomUUID(),
      type: "question",
      questionType: "open",
      prompt:
        "Emperor penguins take turns standing on the cold outside edge of the huddle. Why do you think they share the coldest spot?",
    },
    {
      id: crypto.randomUUID(),
      type: "question",
      questionType: "single",
      prompt:
        "Which parent keeps the emperor penguin egg warm through the winter?",
      answer: "The father",
    },
  );
  const when = state.now - 4 * HOUR;
  const commit = await at(when, () =>
    commitDoc({
      ...ctx,
      doc,
      author: authorOf(PEOPLE.jordan.id),
      message: "Add two questions about the huddle\n",
    }),
  );

  const pull = {
    id: crypto.randomUUID(),
    lessonId: penguins.id,
    sourceLessonId: null,
    authorId: PEOPLE.jordan.id,
    title: "Add two questions about the huddle",
    body: "Theo kept asking about the huddle, so I added an open question about sharing the cold edge and a quick one about who keeps the egg warm. Happy to change the wording.",
    head: commit.oid,
    base: base.head,
    headRef: null,
    revision: 1,
    previousHead: null,
    updatedAt: null,
    ready: true,
    status: "open",
    mergeCommit: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(when).toISOString(),
  };
  return { pull, pack: { ...(await packed(ctx)), head: commit.oid } };
}

/** Histories for every lesson, plus the proposal and its notification. */
export async function buildGit(state) {
  const packs = new Map();
  for (const lesson of state.lessons.values())
    packs.set(lesson.id, await buildHistory(lesson));

  const pullPacks = new Map();
  const proposal = await buildProposal(state, packs);
  if (proposal) {
    state.pulls.push(proposal.pull);
    pullPacks.set(proposal.pull.id, proposal.pack);
    state.notifications.push({
      id: crypto.randomUUID(),
      userId: PEOPLE.maya.id,
      type: "pull_request",
      title: "Jordan Ellis proposed changes to Penguins",
      body: proposal.pull.title,
      link: `/hub/${proposal.pull.lessonId}/proposals`,
      read: false,
      createdAt: proposal.pull.createdAt,
    });
  }
  return { packs, pullPacks };
}
