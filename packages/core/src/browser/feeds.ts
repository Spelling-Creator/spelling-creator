// Reading the Worker's Atom feeds in the browser.
//
// Both the hub's "latest lessons" feed and a user's activity feed are the very
// same feed.xml endpoints the "RSS" buttons point at, parsed client-side rather
// than duplicated as a second JSON route — so the Worker maintains one feed per
// subject, not two representations of it.
//
// This lives in the browser tier because DOMParser is a browser global. It is
// deliberately a real XML parser: the alternative is regex over untrusted markup,
// and the feeds carry user-written titles and summaries.
//
// lessons.ts and users.ts keep the URL builders (they are runtime-neutral, and
// the Worker and MCP server may want them); only the reading is here.

import { lessonsFeedUrl } from "../lessons.ts";
import { userFeedUrl } from "../users.ts";

// Pull the trimmed text of the first descendant with the given local name
// (namespace-agnostic, so the Atom default xmlns doesn't get in the way).
function entryText(el: Element, tag: string) {
  const node = el.getElementsByTagNameNS("*", tag)[0];
  return node ? (node.textContent || "").trim() : "";
}

/** One entry of an Atom feed, flattened. */
export interface FeedEntry {
  id: string;
  title: string;
  author: string;
  summary: string;
  updated: string;
  link: string;
}

/**
 * Fetch an Atom feed and flatten its entries. Error wording is injected so each
 * caller keeps the message its UI already showed.
 *
 * @param messages.unreachable  Network failure.
 * @param messages.unparsable   Served, but not valid XML.
 * @returns Newest first, as the feed orders them.
 */
async function fetchAtomEntries(
  url: string,
  messages: { unreachable: string; unparsable: string },
): Promise<FeedEntry[]> {
  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch {
    throw new Error(messages.unreachable);
  }
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);

  const doc = new DOMParser().parseFromString(
    await res.text(),
    "application/xml",
  );
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error(messages.unparsable);
  }

  return Array.from(doc.getElementsByTagNameNS("*", "entry")).map((entry) => {
    const links = Array.from(entry.getElementsByTagNameNS("*", "link"));
    const alternate =
      links.find((l) => l.getAttribute("rel") === "alternate") || links[0];
    return {
      id: entryText(entry, "id"),
      title: entryText(entry, "title"),
      author: entryText(entry, "author"),
      summary: entryText(entry, "summary"),
      updated: entryText(entry, "updated"),
      link: alternate ? alternate.getAttribute("href") || "" : "",
    };
  });
}

/**
 * The hub's "latest lessons" feed, rendered on the signed-in homepage dashboard.
 * Each entry's `<link rel="alternate">` points at the lesson's /hub/:id page.
 * @returns Newest first.
 */
export async function fetchLatestLessons(): Promise<FeedEntry[]> {
  const url = lessonsFeedUrl();
  if (!url) throw new Error("The lesson hub is not configured.");
  return fetchAtomEntries(url, {
    unreachable: "Could not reach the lesson hub.",
    unparsable: "Could not read the latest-lessons feed.",
  });
}

/**
 * A user's recent activity, for the in-page activity menu.
 * @param id  The user's Supabase id.
 * @returns Newest first.
 */
export async function fetchUserActivity(id: string): Promise<FeedEntry[]> {
  const url = userFeedUrl(id);
  if (!url) throw new Error("Profiles are not configured.");
  return fetchAtomEntries(url, {
    unreachable: "Could not reach the server.",
    unparsable: "Could not read the activity feed.",
  });
}
