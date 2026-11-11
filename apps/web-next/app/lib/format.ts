// The small formatting helpers the listings share.
//
// Dates are formatted in the reader's own locale and time zone, which the
// server cannot know. A page that shows one on first render has to show the
// same string on the server and in the hydrating pass, so these are called
// from effects or on values the page fetched itself, never on a value in the
// server-rendered markup unless the page accepts the mismatch.

/** A date as "Nov 10, 2026", or "" for a value that isn't one. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** A date and time as "Nov 10, 3:04 PM", or "" for a value that isn't one. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The first letter of a name, for an avatar with no picture. */
export function initial(name: string | null | undefined): string {
  const s = (name || "").trim();
  return s ? s[0].toUpperCase() : "?";
}
