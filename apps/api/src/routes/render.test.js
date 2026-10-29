// Which requests the crawler prerenderer takes. A snapshot is always answered
// 200, so the rule that matters is the one that keeps unknown paths away from
// it: a crawler asking for a page the app doesn't have must get serveApp's real
// 404, the same answer a browser gets, not a 200 snapshot of the not-found page.

import { describe, expect, it } from "vitest";

import { shouldPrerender } from "./render.js";

const GOOGLEBOT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36";

const ask = (path, ua = GOOGLEBOT) => {
  const url = new URL(`https://spelling.test${path}`);
  return shouldPrerender(
    new Request(url, {
      headers: { accept: "text/html", "user-agent": ua },
    }),
    url,
  );
};

describe("shouldPrerender", () => {
  it("takes a crawler's request for one of the app's pages", () => {
    expect(ask("/")).toBe(true);
    expect(ask("/hub")).toBe(true);
    expect(ask("/users/00000000-0000-0000-0000-000000000001")).toBe(true);
  });

  it("leaves an unknown path to the real 404", () => {
    expect(ask("/some-junk-path")).toBe(false);
    expect(ask("/hub/abc/not-a-tab")).toBe(false);
  });

  it("leaves browsers, the docs and files alone", () => {
    expect(ask("/", CHROME)).toBe(false);
    expect(ask("/docs/intro")).toBe(false);
    expect(ask("/assets/app.js")).toBe(false);
  });
});
