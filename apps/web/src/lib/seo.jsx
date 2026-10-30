// Per-page document metadata (title + Open Graph / Twitter tags) and JSON-LD.
//
// These used to be hooks that reached into `document.head` from an effect,
// because the app was client-rendered and React 18 had no notion of document
// metadata. React 19 hoists `<title>`, `<meta>` and `<link>` into `<head>` from
// anywhere in the tree, so they are now ordinary JSX — which is what makes them
// work under SSR: a crawler receives the real tags in the served HTML rather
// than tags an effect writes after the bundle has run.
//
// (JSON-LD is deliberately *not* hoisted. React only hoists `<script>` when it
// is `async`, and an async JSON-LD block would be meaningless — the type isn't
// executable. It renders in place instead, which search engines accept: the
// spec allows `application/ld+json` anywhere in the document.)

import {
  hasPicture,
  imageCaptionParts,
} from "@spelling-creator/core/imageCredit";
import { useLocation } from "react-router-dom";
import { useSiteOrigin } from "./ssr.jsx";

// One brand everywhere: the domain, the app header, the docs and the PWA
// manifest all say "Spelling Creator", so search results must too, since split
// naming dilutes which name Google shows for the site. The old "Spelling
// Lesson Maker" survives as the WebSite schema's alternateName below.
const SITE_NAME = "Spelling Creator";
const DEFAULT_DESCRIPTION =
  "Write, share and run lessons for Spelling: communication by pointing to letters on a letterboard or keyboard. Print them or run them on screen with your speller.";
const GITHUB_URL = "https://github.com/Spelling-Creator/spelling-creator";

// The site as one schema.org Organization, shared by everything that names a
// publisher (the WebSite block, each lesson's markup). The @id marks every
// copy as the same entity, so a consumer that reads several pages can merge
// them. Each page still embeds the full object rather than a bare reference,
// because an @id only resolves against nodes on the same page.
function organizationObject(origin) {
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

/**
 * Document title and social/SEO meta tags for the current page. Render it
 * anywhere in a page's tree; React puts the tags in `<head>`.
 *
 * @param {object}  props
 * @param {string} [props.title]        Page title; appended to the site name.
 * @param {string} [props.description]  Meta/OG description (falls back to the site default).
 * @param {string} [props.image]        Absolute URL for the OG/Twitter preview
 *   image. Leave undefined to default to a live screenshot of the canonical page
 *   (rendered by the Worker's /og-image endpoint); pass null to opt out entirely.
 * @param {string} [props.type]         OG type: "website" (default) or "article".
 * @param {string} [props.path]         The canonical path, when it isn't the one
 *   being viewed: a lesson's tabs are all views of one lesson, and pointing their
 *   canonical link and og:url at /hub/:id keeps them from competing with each
 *   other in search results.
 * @param {boolean} [props.noindex]     Ask crawlers to keep the page out of the
 *   index. For the signed-in and tool pages, whose content is the visitor's
 *   own. A noindexed page gets no canonical link and no og:url; either would
 *   name it as the page's real address, which contradicts noindex.
 */
export function DocumentMeta({
  title,
  description,
  image,
  type = "website",
  path,
  noindex = false,
}) {
  const origin = useSiteOrigin();
  const { pathname } = useLocation();

  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  const desc = description || DEFAULT_DESCRIPTION;
  // The routes accept a trailing slash (/hub/, /users/:id/), and the sitemap
  // lists them without one. Dropping it here keeps the two spellings of a page
  // from each claiming to be canonical.
  const canonicalPath = (path || pathname).replace(/(.)\/+$/, "$1");
  const canonical = `${origin}${canonicalPath}`;

  // Default the preview image to a screenshot of the canonical page: the
  // Worker's /og-image endpoint renders the path with headless Chromium. Pass
  // `null` to opt out.
  const ogImage =
    image === undefined
      ? `${origin}/og-image?path=${encodeURIComponent(canonicalPath)}`
      : image;

  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      {noindex ? (
        <meta name="robots" content="noindex" />
      ) : (
        <link rel="canonical" href={canonical} />
      )}

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      {!noindex && <meta property="og:url" content={canonical} />}
      {ogImage && (
        <>
          <meta property="og:image" content={ogImage} />
          {/* The screenshot is a fixed-size PNG; advertise its dimensions/type
              so scrapers can lay out the large-image card without fetching it. */}
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:type" content="image/png" />
        </>
      )}

      <meta
        name="twitter:card"
        content={ogImage ? "summary_large_image" : "summary"}
      />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      {ogImage && <meta name="twitter:image" content={ogImage} />}
    </>
  );
}

/**
 * A single JSON-LD block for the current page, or nothing when there's no data.
 * @param {object} props
 * @param {object|null} [props.data]  A schema.org object to serialise.
 */
export function JsonLd({ data }) {
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      // JSON.stringify escapes nothing HTML-significant on its own, so close
      // the one hole that matters: a "</script>" inside any string value would
      // otherwise end the block early. Escaping every "<" keeps the JSON
      // identical to a parser while making the sequence inert to the HTML one.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

// A lesson's (and later a comment's) author as a schema.org Person. With a
// user id it carries the same @id as the profile page's mainEntity, so pages
// about this person (/users/:id) and pages by them read as one entity.
function personObject({ name, userId, origin }) {
  const person = { "@type": "Person", name };
  if (userId) {
    person["@id"] = `${origin}/users/${encodeURIComponent(userId)}#person`;
    person.url = `${origin}/users/${encodeURIComponent(userId)}`;
  }
  return person;
}

/**
 * Build schema.org `ProfilePage` JSON-LD for /users/:id: Google's markup for
 * "a user profile on a forum or social media site", which is what these pages
 * are. The mainEntity Person carries the @id that lesson markup points its
 * author at. No `image`: the page shows an initials placeholder, and Google's
 * guidelines rule out placeholder images.
 *
 * @param {object} opts
 * @param {string} opts.id              The user's id (also the page's path segment).
 * @param {string} opts.name            Display name, with any fallback already applied.
 * @param {string} [opts.description]   The bio, flattened to plain text.
 * @param {number} [opts.followerCount]
 * @param {number} [opts.followingCount]
 * @param {number} [opts.lessonCount]   Published lessons shown on the page.
 * @param {string} opts.origin
 * @returns {object|null}
 */
export function buildProfileSchema({
  id,
  name,
  description,
  followerCount,
  followingCount,
  lessonCount,
  origin,
}) {
  if (!id) return null;
  const interaction = (type, count) => ({
    "@type": "InteractionCounter",
    interactionType: `https://schema.org/${type}`,
    userInteractionCount: count,
  });
  const person = personObject({ name, userId: id, origin });
  person.identifier = id;
  if (description) person.description = description;
  // The counts the page itself shows: this person's followers, then their own
  // activity (who they follow, lessons they wrote).
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

// Build the bare schema.org `LearningResource` object (no top-level @context,
// so it can either stand alone or be embedded inside an ItemList).
//
// LearningResource, not Course: a lesson here is one passage with questions,
// not a curriculum, and Google's course markup guidelines want actual courses.
// Markup that misdescribes the page risks a structured-data manual action,
// while the Course rich results it used to aim for are gone anyway (Course info
// was retired in September 2025, and the course carousel expects real courses).
// LearningResource says what the page is; isAccessibleForFree is accurate (and
// replaces the zero-price Offer the Course markup carried, which only the
// course guidelines asked for).
function lessonObject({ lesson, description, url, origin }) {
  const resource = {
    "@type": "LearningResource",
    learningResourceType: "Lesson",
    name: lesson.title || "Untitled Lesson",
    description: description || summaryDescription(lesson),
    inLanguage: "en",
    isAccessibleForFree: true,
    publisher: organizationObject(origin),
  };
  if (url) resource.url = url;
  // A nameless author with an account still links to their profile, under the
  // "Anonymous" the page shows for them.
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

// Fallback description from a lesson summary (which carries no body text),
// used on the hub list where the full rendered text isn't available.
function summaryDescription(lesson) {
  const sections =
    typeof lesson.sectionCount === "number"
      ? ` with ${lesson.sectionCount} section${lesson.sectionCount === 1 ? "" : "s"}`
      : "";
  return `A free lesson for Spelling practice${sections}, to print, copy or run on screen.`;
}

/**
 * Build standalone schema.org `LearningResource` JSON-LD for a single lesson's
 * page: accurate semantic data that helps a search engine understand the page,
 * and the per-lesson detail markup the hub's ItemList points at.
 *
 * @param {object}  opts
 * @param {object}  opts.lesson       Lesson summary/doc ({ title, author, createdAt }).
 * @param {string} [opts.description] Plain-text summary (1 to 500 chars).
 * @param {string}  opts.url          Canonical URL of this lesson's page.
 * @param {string}  opts.origin       Site origin, used as the publisher URL.
 * @returns {object|null}
 */
export function buildLessonSchema(opts) {
  if (!opts.lesson) return null;
  const resource = lessonObject(opts);
  const images = imageObjects(opts.lesson.doc, opts.origin);
  if (images.length > 0) resource.image = images;
  return { "@context": "https://schema.org", ...resource };
}

// Every picture in the lesson (image blocks, and VAKT blocks that carry one),
// as ImageObjects carrying the stored credit. contentUrl plus creditText is
// what makes an image eligible for credit details in Google Images; a picture
// without a credit still rides along as plain semantics. The caption/credit
// split is the same one the page renders with (imageCaptionParts), so the
// markup matches what a reader sees, legacy credit-in-caption blocks included.
// Hub lessons address images by content hash, served at /images/<hash>; a
// block without one (a local image that never reached the hub) has no public
// URL and is skipped.
function imageObjects(doc, origin) {
  const images = [];
  for (const section of doc?.sections || []) {
    for (const block of section?.blocks || []) {
      if (!hasPicture(block) || !block.image?.hash) continue;
      const image = {
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
 * Build a schema.org `ItemList` of LearningResources for the hub. Each
 * ListItem embeds the full named resource rather than a bare URL, so the list
 * is meaningful on its own.
 *
 * @param {object}        opts
 * @param {Array<object>} opts.lessons  Published lesson summaries, in display order.
 * @param {string}        opts.origin   Site origin, for publisher + per-lesson URLs.
 * @returns {object|null}
 */
export function buildLessonListSchema({ lessons, origin }) {
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
 * Build schema.org `BreadcrumbList` JSON-LD matching a page's visible crumb
 * trail (the PageBar). Google shows breadcrumbs in place of the raw URL on
 * desktop results. The last crumb is the page itself, which carries no item
 * URL per Google's guidelines: the canonical link already names it.
 *
 * @param {object} opts
 * @param {Array<{name: string, path?: string}>} opts.crumbs  In order, root first.
 * @param {string} opts.origin
 * @returns {object|null}
 */
export function buildBreadcrumbSchema({ crumbs, origin }) {
  if (!Array.isArray(crumbs) || crumbs.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => {
      const item = { "@type": "ListItem", position: i + 1, name: crumb.name };
      if (crumb.path) item.item = `${origin}${crumb.path}`;
      return item;
    }),
  };
}

/**
 * Build the homepage's schema.org `WebSite` JSON-LD, the markup Google reads
 * the site name from. The old name rides along as alternateName so anything
 * that knew the site by it keeps matching.
 *
 * @param {object} opts
 * @param {string} opts.origin  Site origin.
 */
export function buildWebSiteSchema({ origin }) {
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

// Collapse rendered HTML to a short plain-text summary suitable for a meta
// description. Strips tags/entities, squashes whitespace, and truncates.
export function htmlToDescription(html, max = 160) {
  if (!html) return "";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
}
