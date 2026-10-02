// The Worker's suite (apps/api/src/lib/richtext.test.js) covers the sanitizer and
// the flattening it depends on. This covers the rest of the shared policy — the
// link-safety check and the browser-side helpers, which had no tests of their own
// while they lived in apps/web.

import { describe, expect, it } from "vitest";

import {
  MEDIA_TAGS,
  RICH_TEXT_TAGS,
  isRichTextEmpty,
  isRichTextHtml,
  isSafeLink,
  isSafeLinkCandidate,
  richTextLength,
  richTextToLine,
  richTextToPlain,
} from "./richText.js";

describe("isSafeLink", () => {
  it("accepts the two schemes users may link with", () => {
    expect(isSafeLink("https://example.com")).toBe(true);
    expect(isSafeLink("http://example.com")).toBe(true);
    expect(isSafeLink("mailto:a@b.com")).toBe(true);
  });

  it("rejects scripting and smuggling schemes", () => {
    expect(isSafeLink("javascript:alert(1)")).toBe(false);
    expect(isSafeLink("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeLink("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects relative and protocol-relative hrefs", () => {
    expect(isSafeLink("/admin")).toBe(false);
    expect(isSafeLink("//evil.com")).toBe(false);
  });

  it("sees through control characters browsers ignore in a scheme", () => {
    // `java\tscript:` navigates fine in a browser, so a naive prefix check on the
    // raw string would pass it straight through.
    expect(isSafeLink("java\tscript:alert(1)")).toBe(false);
    expect(isSafeLink("java\nscript:alert(1)")).toBe(false);
    expect(isSafeLink("\u0000javascript:alert(1)")).toBe(false);
    expect(isSafeLink(" javascript:alert(1)")).toBe(false);
  });

  it("rejects non-strings and blanks rather than throwing", () => {
    expect(isSafeLink(undefined)).toBe(false);
    expect(isSafeLink(null)).toBe(false);
    expect(isSafeLink("")).toBe(false);
    expect(isSafeLink("   ")).toBe(false);
  });
});

describe("isSafeLinkCandidate", () => {
  it("accepts full URLs on the allowed schemes, like isSafeLink", () => {
    expect(isSafeLinkCandidate("https://example.com")).toBe(true);
    expect(isSafeLinkCandidate("http://example.com")).toBe(true);
    expect(isSafeLinkCandidate("mailto:a@b.com")).toBe(true);
  });

  it("accepts scheme-less autolink candidates, judged with the default protocol prefixed", () => {
    // tiptap's autolink validates the matched text ("example.com"), then stores
    // it with the default protocol prefixed — so that is what gets judged.
    expect(isSafeLinkCandidate("example.com")).toBe(true);
    expect(isSafeLinkCandidate("example.com/path?q=1")).toBe(true);
    expect(isSafeLinkCandidate("example.com", "https")).toBe(true);
  });

  it("rejects schemes the sanitizer would strip on save", () => {
    expect(isSafeLinkCandidate("ftp://example.com")).toBe(false);
    expect(isSafeLinkCandidate("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkCandidate("data:text/html,x")).toBe(false);
    expect(isSafeLinkCandidate("tel:+123456")).toBe(false);
  });

  it("is not fooled by control characters hiding a scheme", () => {
    // Without the strip, `java\tscript:` would look scheme-less, get the
    // default protocol test, and sail through.
    expect(isSafeLinkCandidate("java\tscript:alert(1)")).toBe(false);
    expect(isSafeLinkCandidate(" javascript:alert(1)")).toBe(false);
  });

  it("rejects protocol-relative values and blanks", () => {
    // "//evil.com" is stored as itself, never as an http URL, so prefixing
    // must not launder it into looking safe.
    expect(isSafeLinkCandidate("//evil.com")).toBe(false);
    expect(isSafeLinkCandidate("")).toBe(false);
    expect(isSafeLinkCandidate(undefined)).toBe(false);
  });
});

describe("the allow-list", () => {
  it("names no media tag", () => {
    for (const tag of MEDIA_TAGS) {
      expect(RICH_TEXT_TAGS).not.toContain(tag);
    }
  });

  it("carries no tag that can execute or embed", () => {
    for (const tag of ["script", "style", "iframe", "object", "embed"]) {
      expect(RICH_TEXT_TAGS).not.toContain(tag);
    }
  });
});

describe("richTextLength", () => {
  it("measures what was written, not the markup it was written in", () => {
    expect(richTextLength("<p><strong>hello</strong></p>")).toBe(5);
    expect(richTextLength("hello")).toBe(5);
  });

  it("counts a decoded entity as one character", () => {
    expect(richTextLength("<p>a&amp;b</p>")).toBe(3);
  });

  it("is zero for an empty editor", () => {
    expect(richTextLength("<p></p>")).toBe(0);
    expect(richTextLength("")).toBe(0);
  });
});

describe("richTextToLine", () => {
  it("collapses block breaks to spaces", () => {
    expect(richTextToLine("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("truncates with an ellipsis past the limit", () => {
    const out = richTextToLine("<p>abcdefghij</p>", 5);
    expect(out).toBe("ab...");
    expect(out).toHaveLength(5);
  });

  it("leaves a value at exactly the limit alone", () => {
    expect(richTextToLine("<p>abcde</p>", 5)).toBe("abcde");
  });

  it("does not leave a dangling space before the ellipsis", () => {
    expect(richTextToLine("<p>ab cdefg</p>", 6)).toBe("ab...");
  });
});

describe("isRichTextHtml", () => {
  it("recognises what the editor produces", () => {
    expect(isRichTextHtml("<p>hi</p>")).toBe(true);
    expect(isRichTextHtml("  <blockquote>hi</blockquote>")).toBe(true);
  });

  it("treats pre-rich-text plain strings as plain", () => {
    expect(isRichTextHtml("just a comment")).toBe(false);
    expect(isRichTextHtml("I <3 this")).toBe(false);
    expect(isRichTextHtml("")).toBe(false);
  });

  it("rejects non-strings rather than throwing", () => {
    expect(isRichTextHtml(null)).toBe(false);
    expect(isRichTextHtml(undefined)).toBe(false);
    expect(isRichTextHtml(42)).toBe(false);
  });
});

describe("richTextToPlain / isRichTextEmpty parity", () => {
  // The editor's counter and the Worker's limit must measure the same thing, or
  // the editor shows "498/500" for a comment the server then rejects.
  it("treats a whitespace-only document as empty", () => {
    expect(isRichTextEmpty("<p>   </p>")).toBe(true);
    expect(isRichTextEmpty("<p><br></p>")).toBe(true);
    expect(richTextToPlain("<p>&nbsp;</p>")).toBe("");
  });
});
