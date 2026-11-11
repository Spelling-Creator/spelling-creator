// Per-page document metadata (title, Open Graph and Twitter tags) and the
// JSON-LD each kind of page carries.
//
// A route describes its metadata from its `meta` export, which React Router
// calls with the route's loader data and renders into <head>, on the server
// and after every client navigation alike. `pageMeta` builds the common set;
// the `build*Schema` functions build the schema.org objects, which a route
// adds as `script:ld+json` descriptors through `jsonLd`.

import type { MetaDescriptor } from "react-router";
import type { LessonComment } from "@spelling-creator/core/comments";
import {
  hasPicture,
  imageCaptionParts,
} from "@spelling-creator/core/imageCredit";
import { richTextToPlain } from "@spelling-creator/core/richText";
import type { LessonDoc } from "@spelling-creator/core/types";

// One brand everywhere: the domain, the app header, the docs and the PWA
// manifest all say "Spelling Creator", so search results must too, since
// split naming dilutes which name Google shows for the site. The old
// "Spelling Lesson Maker" survives as the WebSite schema's alternateName.
export const SITE_NAME = "Spelling Creator";
export const DEFAULT_DESCRIPTION =
  "Write, share and run lessons for Spelling: communication by pointing to letters on a letterboard or keyboard. Print them or run them on screen with your speller.";
const GITHUB_URL = "https://github.com/Spelling-Creator/spelling-creator";

type Schema = Record<string, unknown>;

export interface PageMetaOptions {
  /** The site origin, from the root loader. */
  origin: string;
  /** The path being viewed. */
  pathname: string;
  /** Page title; appended to the site name. */
  title?: string;
  /** Meta and OG description (falls back to the site default). */
  description?: string;
  /**
   * Absolute URL for the OG and Twitter preview image. Leave undefined to
   * default to a live screenshot of the canonical page (rendered by the
   * Worker's /og-image endpoint); pass null to opt out entirely.
   */
  image?: string | null;
  /** OG type. */
  type?: "website" | "article";
  /**
   * The canonical path, when it isn't the one being viewed: a lesson's tabs
   * are all views of one lesson, and pointing their canonical link at
   * /hub/:id keeps them from competing with each other in search results.
   */
  path?: string;
  /**
   * Ask crawlers to keep the page out of the index: the signed-in and tool
   * pages, whose content is the visitor's own. A noindexed page gets no
   * canonical link and no og:url; either would name it as the page's real
   * address, which contradicts noindex.
   */
  noindex?: boolean;
}

/** The document title and the social tags for a page. */
export function pageMeta({
  origin,
  pathname,
  title,
  description,
  image,
  type = "website",
  path,
  noindex = false,
}: PageMetaOptions): MetaDescriptor[] {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  const desc = description || DEFAULT_DESCRIPTION;
  // The routes accept a trailing slash (/hub/, /users/:id/), and the sitemap
  // lists them without one. Dropping it here keeps the two spellings of a
  // page from each claiming to be canonical.
  const canonicalPath = (path || pathname).replace(/(.)\/+$/, "$1");
  const canonical = `${origin}${canonicalPath}`;
  const ogImage =
    image === undefined
      ? `${origin}/og-image?path=${encodeURIComponent(canonicalPath)}`
      : image;

  const tags: MetaDescriptor[] = [
    { title: fullTitle },
    { name: "description", content: desc },
    noindex
      ? { name: "robots", content: "noindex" }
      : { tagName: "link", rel: "canonical", href: canonical },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: type },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: desc },
  ];
  if (!noindex) tags.push({ property: "og:url", content: canonical });
  if (ogImage) {
    tags.push(
      { property: "og:image", content: ogImage },
      // The screenshot is a fixed-size PNG; advertise its dimensions and
      // type so scrapers can lay out the large-image card without fetching.
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:type", content: "image/png" },
    );
  }
  tags.push(
    {
      name: "twitter:card",
      content: ogImage ? "summary_large_image" : "summary",
    },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: desc },
  );
  if (ogImage) tags.push({ name: "twitter:image", content: ogImage });
  return tags;
}

/** A JSON-LD block as a meta descriptor, or none when there is no data. */
export function jsonLd(data: Schema | null): MetaDescriptor[] {
  return data ? [{ "script:ld+json": data }] : [];
}

// The site as one schema.org Organization, shared by everything that names a
// publisher (the WebSite block, each lesson's markup). The @id marks every
// copy as the same entity, so a consumer that reads several pages can merge
// them. Each page still embeds the full object rather than a bare reference,
// because an @id only resolves against nodes on the same page.
function organizationObject(origin: string): Schema {
  return {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: SITE_NAME,
    url: origin,
    logo: {
      "@type": "ImageObject",
      url: `${origin}/icons/apple-touch-icon.png`,
    },
    sameAs: [GITHUB_URL],
  };
}

// A lesson's (or a comment's) author as a schema.org Person. With a user id
// it carries the same @id as the profile page's mainEntity, so pages about
// this person (/users/:id) and pages by them read as one entity.
function personObject({
  name,
  userId,
  origin,
}: {
  name: string;
  userId?: string | null;
  origin: string;
}): Schema {
  const person: Schema = { "@type": "Person", name };
  if (userId) {
    person["@id"] = `${origin}/users/${encodeURIComponent(userId)}#person`;
    person.url = `${origin}/users/${encodeURIComponent(userId)}`;
  }
  return person;
}

/**
 * schema.org `ProfilePage` for /users/:id: Google's markup for "a user
 * profile on a forum or social media site". The mainEntity Person carries
 * the @id that lesson markup points its author at. No `image`: the page
 * shows an initials placeholder, and Google's guidelines rule those out.
 */
export function buildProfileSchema({
  id,
  name,
  description,
  followerCount,
  followingCount,
  lessonCount,
  origin,
}: {
  id: string;
  name: string;
  description?: string;
  followerCount?: number;
  followingCount?: number;
  lessonCount?: number;
  origin: string;
}): Schema | null {
  if (!id) return null;
  const interaction = (type: string, count: number) => ({
    "@type": "InteractionCounter",
    interactionType: `https://schema.org/${type}`,
    userInteractionCount: count,
  });
  const person = personObject({ name, userId: id, origin });
  person.identifier = id;
  if (description) person.description = description;
  // The counts the page itself shows: this person's followers, then their
  // own activity (who they follow, lessons they wrote).
  person.interactionStatistic = [
    interaction("FollowAction", followerCount ?? 0),
  ];
  person.agentInteractionStatistic = [
    interaction("FollowAction", followingCount ?? 0),
    interaction("WriteAction", lessonCount ?? 0),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: person,
  };
}

/** What the lesson markup reads: a summary, or a full lesson with its doc. */
export interface LessonLike {
  title?: string | null;
  author?: string | null;
  authorId?: string | null;
  createdAt?: string | null;
  sectionCount?: number;
  doc?: LessonDoc;
}

// Fallback description from a lesson summary (which carries no body text),
// used on the hub list where the full rendered text isn't available.
function summaryDescription(lesson: LessonLike): string {
  const sections =
    typeof lesson.sectionCount === "number"
      ? ` with ${lesson.sectionCount} section${lesson.sectionCount === 1 ? "" : "s"}`
      : "";
  return `A free lesson for Spelling practice${sections}, to print, copy or run on screen.`;
}

// The bare schema.org `LearningResource` object (no top-level @context, so
// it can stand alone or be embedded inside an ItemList).
//
// LearningResource, not Course: a lesson here is one passage with questions,
// not a curriculum, and Google's course markup guidelines want actual
// courses. Markup that misdescribes the page risks a structured-data manual
// action. isAccessibleForFree is accurate, and replaces the zero-price Offer
// the Course markup used to carry.
function lessonObject({
  lesson,
  description,
  url,
  origin,
}: {
  lesson: LessonLike;
  description?: string;
  url?: string;
  origin: string;
}): Schema {
  const resource: Schema = {
    "@type": "LearningResource",
    learningResourceType: "Lesson",
    name: lesson.title || "Untitled Lesson",
    description: description || summaryDescription(lesson),
    inLanguage: "en",
    isAccessibleForFree: true,
    publisher: organizationObject(origin),
  };
  if (url) resource.url = url;
  // A nameless author with an account still links to their profile, under
  // the "Anonymous" the page shows for them.
  if (lesson.author || lesson.authorId) {
    resource.author = personObject({
      name: lesson.author || "Anonymous",
      userId: lesson.authorId,
      origin,
    });
  }
  if (lesson.createdAt) {
    // schema.org dateCreated expects ISO 8601; skip an unparseable value.
    const d = new Date(lesson.createdAt);
    if (!Number.isNaN(d.getTime())) resource.dateCreated = d.toISOString();
  }
  return resource;
}

/**
 * The JSON-LD for a single lesson's page, under a two-type `@type`:
 * `LearningResource` says what the piece is, `Article` says it is a written
 * piece whose comments belong to it, which is the shape search engines read
 * a `comment` thread from. Pass `comments` only where the thread is on the
 * page, since markup must describe what a reader can see; omitted, the
 * markup says nothing about comments rather than claiming zero.
 */
export function buildLessonSchema(opts: {
  lesson: LessonLike | null;
  description?: string;
  url: string;
  origin: string;
  comments?: LessonComment[];
}): Schema | null {
  if (!opts.lesson) return null;
  const resource = lessonObject({ ...opts, lesson: opts.lesson });
  resource["@type"] = ["Article", "LearningResource"];
  resource.headline = resource.name;
  // No datePublished: a lesson can sit as a private draft before it goes on
  // the hub, and nothing records when that happened, so dateCreated (the
  // date the page shows) is the only date the markup can vouch for.
  const images = imageObjects(opts.lesson.doc, opts.origin);
  if (images.length > 0) resource.image = images;
  if (Array.isArray(opts.comments)) {
    const { thread, count } = commentObjects(opts.comments, opts.origin);
    resource.commentCount = count;
    if (thread.length > 0) resource.comment = thread;
  }
  return { "@context": "https://schema.org", ...resource };
}

// The lesson's comments as schema.org Comment objects, replies nested under
// the comment they answer, exactly as the discussion tab draws the thread.
// `count` is how many made it into the thread, so a reply whose parent is
// gone (which the tab can't place either) isn't counted. Bodies are
// sanitized rich-text HTML; markup wants the plain text a reader sees.
function commentObjects(
  comments: LessonComment[],
  origin: string,
): { thread: Schema[]; count: number } {
  const replies = new Map<string, LessonComment[]>();
  const top: LessonComment[] = [];
  for (const comment of comments) {
    if (!comment?.id) continue;
    if (comment.parentId) {
      const siblings = replies.get(comment.parentId) || [];
      siblings.push(comment);
      replies.set(comment.parentId, siblings);
    } else {
      top.push(comment);
    }
  }
  let count = 0;
  const toObject = (comment: LessonComment): Schema => {
    count += 1;
    const object: Schema = {
      "@type": "Comment",
      text: richTextToPlain(comment.body),
      author: personObject({
        name: comment.author || "Anonymous",
        userId: comment.authorId,
        origin,
      }),
    };
    const d = new Date(comment.createdAt);
    if (!Number.isNaN(d.getTime())) object.dateCreated = d.toISOString();
    const kids = replies.get(comment.id);
    if (kids) object.comment = kids.map(toObject);
    return object;
  };
  const thread = top.map(toObject);
  return { thread, count };
}

// Every picture in the lesson (image blocks, and VAKT blocks that carry one),
// as ImageObjects carrying the stored credit. contentUrl plus creditText is
// what makes an image eligible for credit details in Google Images; a
// picture without a credit still rides along as plain semantics. Hub lessons
// address images by content hash, served at /images/<hash>; a block without
// one (a local image that never reached the hub) has no public URL and is
// skipped.
function imageObjects(doc: LessonDoc | undefined, origin: string): Schema[] {
  const images: Schema[] = [];
  for (const section of doc?.sections || []) {
    for (const block of section?.blocks || []) {
      if (block.type !== "image" && block.type !== "vakt") continue;
      if (!hasPicture(block) || !block.image?.hash) continue;
      const image: Schema = {
        "@type": "ImageObject",
        contentUrl: `${origin}/images/${block.image.hash}`,
      };
      const { caption, credit } = imageCaptionParts(block);
      if (caption) image.caption = caption;
      if (credit) image.creditText = credit;
      images.push(image);
    }
  }
  return images;
}

/**
 * A schema.org `ItemList` of LearningResources for the hub. Each ListItem
 * embeds the full named resource rather than a bare URL, so the list is
 * meaningful on its own.
 */
export function buildLessonListSchema({
  lessons,
  origin,
}: {
  lessons: Array<LessonLike & { id: string }> | null | undefined;
  origin: string;
}): Schema | null {
  if (!Array.isArray(lessons) || lessons.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: lessons.map((lesson, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: lessonObject({
        lesson,
        url: `${origin}/hub/${lesson.id}`,
        origin,
      }),
    })),
  };
}

/**
 * schema.org `BreadcrumbList` matching a page's visible crumb trail (the
 * PageBar). The last crumb is the page itself, which carries no item URL per
 * Google's guidelines: the canonical link already names it.
 */
export function buildBreadcrumbSchema({
  crumbs,
  origin,
}: {
  crumbs: Array<{ name: string; path?: string }>;
  origin: string;
}): Schema | null {
  if (!Array.isArray(crumbs) || crumbs.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => {
      const item: Schema = {
        "@type": "ListItem",
        position: i + 1,
        name: crumb.name,
      };
      if (crumb.path) item.item = `${origin}${crumb.path}`;
      return item;
    }),
  };
}

/**
 * The homepage's schema.org `WebSite`, the markup Google reads the site name
 * from. The old name rides along as alternateName so anything that knew the
 * site by it keeps matching.
 */
export function buildWebSiteSchema({ origin }: { origin: string }): Schema {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: "Spelling Lesson Maker",
    url: origin,
    description: DEFAULT_DESCRIPTION,
    publisher: organizationObject(origin),
  };
}

/**
 * Collapse rendered HTML to a short plain-text summary suitable for a meta
 * description: strips tags and entities, squashes whitespace, truncates.
 */
export function htmlToDescription(html: string, max = 160): string {
  if (!html) return "";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
}
