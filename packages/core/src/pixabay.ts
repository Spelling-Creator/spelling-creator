// Talks to the apps/api Worker for Pixabay image search.
//
// Searching and downloading happen on the Worker rather than in the browser for
// three reasons: the Pixabay API key stays secret, the Worker can enforce
// Pixabay's 100 requests/minute limit centrally, and Pixabay's image CDN sends
// no CORS headers — so the browser can't read an image's bytes to embed it in
// the DOCX/PDF export. The Worker fetches the bytes and returns a data URL we
// can drop straight into an image block.
//
// As with the AI features, every request carries a fresh Turnstile token that
// the Worker verifies server-side before doing any work.
import { apiUrl, hasApi } from "./config.ts";

/** One search result, as the Worker trims it from Pixabay's. */
export interface PixabayHit {
  id: number;
  previewURL: string;
  webformatURL: string;
  webformatWidth: number;
  webformatHeight: number;
  /** Comma-separated. */
  tags: string;
  /** The uploader's name. */
  user: string;
  pageURL: string;
}

/**
 * Search Pixabay for images matching `query`.
 * @param query  Free-text search terms.
 * @param token  Turnstile token from the widget's callback.
 * @param opts.page     1-based page number (default 1).
 * @param opts.perPage  Results per page (default 20).
 */
export async function searchPixabayImages(
  query: string,
  token: string,
  opts: { page?: number; perPage?: number } = {},
): Promise<{ hits: PixabayHit[]; total: number; totalHits: number }> {
  if (!hasApi()) {
    throw new Error("The API is not configured.");
  }
  if (!token) {
    throw new Error("Please complete the verification challenge first.");
  }
  const q = (query || "").trim();
  if (!q) {
    throw new Error("Type something to search for first.");
  }

  let res;
  try {
    res = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "imageSearch",
        query: q,
        token,
        page: opts.page || 1,
        perPage: opts.perPage || 20,
      }),
    });
  } catch (e) {
    throw new Error("Could not reach the image search service.", { cause: e });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Search failed (${res.status}).`);
  }

  const data: { hits?: PixabayHit[]; total?: number; totalHits?: number } =
    await res.json().catch(() => ({}));
  return {
    hits: Array.isArray(data.hits) ? data.hits : [],
    total: data.total || 0,
    totalHits: data.totalHits || 0,
  };
}

/**
 * Download a Pixabay image (by its webformat URL) through the Worker and get it
 * back as a data URL, ready to embed in an image block.
 * @param url    The hit's webformatURL.
 * @param token  A fresh Turnstile token.
 * @returns A `data:` URL for the image bytes.
 */
export async function fetchPixabayImage(
  url: string,
  token: string,
): Promise<string> {
  if (!hasApi()) {
    throw new Error("The API is not configured.");
  }
  if (!token) {
    throw new Error("Please complete the verification challenge first.");
  }

  let res;
  try {
    res = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "imageFetch", url, token }),
    });
  } catch (e) {
    throw new Error("Could not download the selected image.", { cause: e });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Download failed (${res.status}).`);
  }

  const data: { dataUrl?: string } = await res.json().catch(() => ({}));
  if (!data.dataUrl) {
    throw new Error("The image could not be downloaded.");
  }
  return data.dataUrl;
}
