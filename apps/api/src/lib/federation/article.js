// A lesson as the fediverse sees it: an Article by its author, with the lesson
// page as its URL and, as attachments, the two links another instance of this
// app needs to fork it (the lesson's JSON and its packed git history).
//
// A reader on Mastodon gets the title, who published it, how big it is, and the
// first few lines of the passage. Nothing more travels: the lesson itself is
// read on its page, and copied through the attachments.

import {
  Article,
  Create,
  Delete,
  Link,
  PUBLIC_COLLECTION,
  Update,
} from "@fedify/vocab";
import { textBlockPlain } from "@spelling-creator/core/lessonText";
import { Temporal } from "temporal-polyfill";

import { xmlEscape } from "../xml.js";

// How much of the passage a post carries. Enough to tell what a lesson is
// about; short enough not to be the lesson.
const EXCERPT_CHARS = 280;

/** The first words of the lesson's passage, or '' when the document is absent. */
export function lessonExcerpt(doc) {
  if (!doc || !Array.isArray(doc.sections)) return "";
  for (const section of doc.sections) {
    for (const block of section?.blocks || []) {
      if (!block || block.type !== "text") continue;
      const text = textBlockPlain(block).replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (text.length <= EXCERPT_CHARS) return text;
      const cut = text.slice(0, EXCERPT_CHARS);
      const atWord = cut.lastIndexOf(" ");
      return `${cut.slice(0, atWord > EXCERPT_CHARS / 2 ? atWord : EXCERPT_CHARS).trimEnd()}...`;
    }
  }
  return "";
}

/**
 * The post body, as the small subset of HTML every fediverse client renders:
 * paragraphs and a link.
 *
 * @param {{ title: string, author: string, sectionCount: number, url: string, excerpt?: string }} lesson
 */
export function lessonContentHtml({
  title,
  author,
  sectionCount,
  url,
  excerpt,
}) {
  const sections =
    sectionCount === 1 ? "1 section" : `${sectionCount} sections`;
  const parts = [
    `<p>${xmlEscape(author)} published a lesson: <a href="${xmlEscape(url)}">${xmlEscape(title)}</a> (${sections}).</p>`,
  ];
  if (excerpt) parts.push(`<p>${xmlEscape(excerpt)}</p>`);
  return parts.join("");
}

/**
 * The Article for a lesson row.
 *
 * @param {import('@fedify/fedify').Context<any>} ctx
 * @param {object} row  A `lessons` row: id, author_id, author, title,
 *   section_count, created_at, and optionally doc.
 */
export function lessonArticle(ctx, row) {
  const origin = ctx.canonicalOrigin;
  const url = new URL(`/hub/${encodeURIComponent(row.id)}`, origin);
  const title = (row.title || "").toString().trim() || "Untitled Lesson";
  const author = (row.author || "").toString().trim() || "Anonymous";
  return new Article({
    id: ctx.getObjectUri(Article, { id: row.id }),
    attribution: ctx.getActorUri(row.author_id),
    name: title,
    content: lessonContentHtml({
      title,
      author,
      sectionCount: row.section_count ?? 0,
      url: url.href,
      excerpt: lessonExcerpt(row.doc),
    }),
    mediaType: "text/html",
    url,
    published: row.created_at
      ? Temporal.Instant.from(new Date(row.created_at).toISOString())
      : undefined,
    to: PUBLIC_COLLECTION,
    cc: ctx.getFollowersUri(row.author_id),
    // What another instance of this app follows to fork the lesson: its
    // document, and the git history that makes the fork a real clone (see
    // /docs/developers/version-history). Both are public on this origin.
    attachments: [
      new Link({
        href: new URL(`/lessons/${encodeURIComponent(row.id)}`, origin),
        mediaType: "application/json",
        name: "Lesson document",
      }),
      new Link({
        href: new URL(`/git/${encodeURIComponent(row.id)}/pack`, origin),
        mediaType: "application/x-git-packfile",
        name: "Version history",
      }),
    ],
  });
}

/**
 * The activity that tells followers about a change to a lesson.
 *
 * `kind` is `create` when a lesson becomes public, `update` when a public
 * lesson is saved, and `delete` when it stops being public: deleted,
 * unpublished, or hidden by a moderator. Every activity gets a fresh id, since
 * a lesson is updated many times and a receiver drops an id it has seen.
 */
export function lessonActivity(ctx, row, kind) {
  const actor = ctx.getActorUri(row.author_id);
  const articleId = ctx.getObjectUri(Article, { id: row.id });
  const id = new URL(`#${kind}/${crypto.randomUUID()}`, articleId);
  const audience = {
    to: PUBLIC_COLLECTION,
    cc: ctx.getFollowersUri(row.author_id),
  };
  if (kind === "delete")
    return new Delete({ id, actor, object: articleId, ...audience });
  const object = lessonArticle(ctx, row);
  return kind === "update"
    ? new Update({ id, actor, object, ...audience })
    : new Create({ id, actor, object, ...audience });
}
