import { describe, expect, it } from "vitest";

import {
  contentToMarkup,
  footnoteParts,
  footnoteStarts,
  isPlainContent,
  lessonFootnotes,
  markupSourceIds,
  markupToContent,
  normalizeTextContent,
  removeSourceCitations,
  textBlockContent,
  textBlockFootnotes,
  textBlockFormattedSpans,
  textBlockLines,
  textBlockParagraphs,
  textBlockPlain,
  textToContent,
  withTextBlockContent,
  withTextBlockDocument,
  UNTITLED_SOURCE_TEXT,
  MISSING_SOURCE_TEXT,
} from "./lessonText.js";
import { sourcesById } from "./sources.js";

const text = (t, marks = []) =>
  marks.length
    ? { type: "text", text: t, marks: marks.map((type) => ({ type })) }
    : { type: "text", text: t };
const para = (...content) => ({ type: "paragraph", content });
const doc = (...content) => ({ type: "doc", content });
const note = (attrs) => ({
  type: "footnote",
  attrs: { sourceId: null, locator: "", note: "", ...attrs },
});

describe("the two block shapes", () => {
  it("reads a plain block as one paragraph per line", () => {
    const block = { id: "b", type: "text", text: "One\n\nThree" };
    expect(textBlockLines(block)).toEqual(["One", "", "Three"]);
    expect(textBlockPlain(block)).toBe("One\n\nThree");
  });

  it("reads a formatted block's words without markers", () => {
    const block = {
      id: "b",
      type: "text",
      content: doc(
        para(
          text("Cats came to "),
          text("Egypt", ["italic"]),
          note({ note: "n" }),
        ),
        para(text("Then home.")),
      ),
    };
    expect(textBlockPlain(block)).toBe("Cats came to Egypt\nThen home.");
  });

  it("prefers content over a stale text field", () => {
    const block = {
      type: "text",
      text: "old",
      content: doc(para(text("new"))),
    };
    expect(textBlockPlain(block)).toBe("new");
  });

  it("falls back to text when content isn't a document", () => {
    expect(
      textBlockPlain({ type: "text", text: "kept", content: "junk" }),
    ).toBe("kept");
  });

  it("stores unformatted content as a plain string", () => {
    const block = withTextBlockContent(
      { id: "b", type: "text", content: doc(para(text("x", ["bold"]))) },
      doc(para(text("Just words")), { type: "paragraph" }),
    );
    expect(block).toEqual({ id: "b", type: "text", text: "Just words\n" });
  });

  it("stores formatted content as a document and drops the text field", () => {
    const block = withTextBlockContent(
      { id: "b", type: "text", text: "old" },
      doc(para(text("Bold", ["bold"]))),
    );
    expect(block.text).toBeUndefined();
    expect(block.content).toEqual(doc(para(text("Bold", ["bold"]))));
  });

  it("round-trips plain text through content", () => {
    const value = "First\nSecond\n\nFourth";
    expect(textBlockPlain({ content: textToContent(value) })).toBe(value);
    expect(isPlainContent(textToContent(value))).toBe(true);
  });
});

describe("normalizeTextContent", () => {
  it("rejects anything that isn't a document", () => {
    expect(normalizeTextContent(null)).toBeNull();
    expect(normalizeTextContent({ type: "paragraph" })).toBeNull();
    expect(normalizeTextContent("<p>hi</p>")).toBeNull();
  });

  it("keeps the words of nodes outside the schema", () => {
    const out = normalizeTextContent(
      doc(
        { type: "heading", content: [text("Title")] },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [para(text("Item"))] }],
        },
        { type: "image", attrs: { src: "x" } },
      ),
    );
    expect(out).toEqual(doc(para(text("Title")), para(text("Item"))));
  });

  it("drops unknown marks, orders the rest and merges equal runs", () => {
    const out = normalizeTextContent(
      doc(
        para(
          {
            type: "text",
            text: "a",
            marks: [{ type: "underline" }, { type: "link" }, { type: "bold" }],
          },
          {
            type: "text",
            text: "b",
            marks: [{ type: "bold" }, { type: "underline" }],
          },
        ),
      ),
    );
    expect(out).toEqual(doc(para(text("ab", ["bold", "underline"]))));
  });

  it("drops a footnote that says nothing and cleans one that does", () => {
    const out = normalizeTextContent(
      doc(
        para(
          note({}),
          note({ sourceId: "bad id!", note: "  spaced\n out  " }),
          note({ sourceId: "s1", locator: " p. 3 ", extra: 1 }),
          note({ sourceId: null, locator: "ignored", note: "n" }),
        ),
      ),
    );
    expect(out.content[0].content).toEqual([
      note({ note: "spaced out" }),
      note({ sourceId: "s1", locator: "p. 3" }),
      note({ note: "n" }),
    ]);
  });

  it("is stable, so equal formatting hashes the same", () => {
    const a = normalizeTextContent(
      doc(
        para({
          type: "text",
          text: "x",
          marks: [{ type: "italic" }, { type: "bold" }],
        }),
      ),
    );
    const b = normalizeTextContent(
      doc(
        para({
          type: "text",
          text: "x",
          marks: [{ type: "bold" }, { type: "italic" }],
        }),
      ),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(normalizeTextContent(a)).toEqual(a);
  });

  it("gives an empty document one empty paragraph", () => {
    expect(normalizeTextContent(doc())).toEqual(doc({ type: "paragraph" }));
  });
});

describe("runs and footnotes", () => {
  const block = {
    id: "b1",
    type: "text",
    content: doc(
      para(text("A "), text("b", ["bold", "italic"]), note({ note: "first" })),
      { type: "paragraph" },
      para(note({ sourceId: "s1", locator: "p. 2" })),
    ),
  };

  it("hands renderers flagged runs and indexed footnotes", () => {
    expect(textBlockParagraphs(block)).toEqual([
      [
        {
          type: "text",
          text: "A ",
          bold: false,
          italic: false,
          underline: false,
        },
        { type: "text", text: "b", bold: true, italic: true, underline: false },
        {
          type: "footnote",
          sourceId: null,
          locator: "",
          note: "first",
          index: 0,
        },
      ],
      [],
      [
        {
          type: "footnote",
          sourceId: "s1",
          locator: "p. 2",
          note: "",
          index: 1,
        },
      ],
    ]);
  });

  it("numbers footnotes across the lesson in reading order", () => {
    const lesson = {
      sections: [
        { blocks: [block, { id: "q", type: "question" }] },
        {
          blocks: [
            { id: "b2", type: "text", text: "no notes" },
            {
              id: "b3",
              type: "text",
              content: doc(para(note({ note: "third" }))),
            },
          ],
        },
      ],
    };
    expect([...footnoteStarts(lesson)]).toEqual([
      ["b1", 0],
      ["b2", 2],
      ["b3", 2],
    ]);
    expect(
      lessonFootnotes(lesson).map((f) => [
        f.number,
        f.blockId,
        f.si,
        f.bi,
        f.index,
      ]),
    ).toEqual([
      [1, "b1", 0, 0, 0],
      [2, "b1", 0, 0, 1],
      [3, "b3", 1, 1, 0],
    ]);
  });

  it("prints a citation, then the note", () => {
    const sources = sourcesById({
      sources: [
        { id: "s1", title: "Cats", author: "Jane Smith", year: "2020" },
      ],
    });
    const parts = footnoteParts(
      { sourceId: "s1", locator: "p. 4", note: "See also chapter 2." },
      sources,
    );
    expect(parts.map((p) => p.text).join("")).toBe(
      "Jane Smith, Cats (2020), p. 4. See also chapter 2.",
    );
    expect(parts.find((p) => p.italic)?.text).toBe("Cats");
  });

  it("lets a translated note replace the written one", () => {
    const parts = footnoteParts({ sourceId: null, note: "Hello" }, new Map(), {
      note: "Bonjour",
    });
    expect(parts).toEqual([{ text: "Bonjour", role: "note" }]);
  });

  it("says so when a cited source is gone and there is no note", () => {
    expect(footnoteParts({ sourceId: "gone", note: "" }, new Map())).toEqual([
      { text: MISSING_SOURCE_TEXT },
    ]);
  });
});

describe("removeSourceCitations", () => {
  it("drops bare citations, keeps notes, and leaves other blocks alone", () => {
    const untouched = { id: "b2", type: "text", text: "plain" };
    const lesson = {
      sources: [{ id: "s1" }],
      sections: [
        {
          id: "sec",
          blocks: [
            {
              id: "b1",
              type: "text",
              content: doc(
                para(
                  text("x", ["bold"]),
                  note({ sourceId: "s1" }),
                  note({ sourceId: "s1", locator: "p. 1", note: "kept" }),
                  note({ sourceId: "s2" }),
                ),
              ),
            },
          ],
        },
        { id: "other", blocks: [untouched] },
      ],
    };
    const out = removeSourceCitations(lesson, "s1");
    expect(textBlockFootnotes(out.sections[0].blocks[0])).toEqual([
      { sourceId: null, locator: "", note: "kept" },
      { sourceId: "s2", locator: "", note: "" },
    ]);
    expect(out.sections[1]).toBe(lesson.sections[1]);
  });
});

describe("markup", () => {
  it("parses marks and every footnote form", () => {
    const content = markupToContent(
      "**Bold** *it* <u>under</u> x^[A note.]^[@smith]^[@smith, p. 12]^[@smith, p. 12 | More.]^[@smith | Also.]",
    );
    const [runs] = textBlockParagraphs({ content });
    expect(runs.filter((r) => r.type === "text")).toEqual([
      {
        type: "text",
        text: "Bold",
        bold: true,
        italic: false,
        underline: false,
      },
      { type: "text", text: " ", bold: false, italic: false, underline: false },
      { type: "text", text: "it", bold: false, italic: true, underline: false },
      { type: "text", text: " ", bold: false, italic: false, underline: false },
      {
        type: "text",
        text: "under",
        bold: false,
        italic: false,
        underline: true,
      },
      {
        type: "text",
        text: " x",
        bold: false,
        italic: false,
        underline: false,
      },
    ]);
    expect(textBlockFootnotes({ content })).toEqual([
      { sourceId: null, locator: "", note: "A note." },
      { sourceId: "smith", locator: "", note: "" },
      { sourceId: "smith", locator: "p. 12", note: "" },
      { sourceId: "smith", locator: "p. 12", note: "More." },
      { sourceId: "smith", locator: "", note: "Also." },
    ]);
  });

  it("reads unpaired markers as the characters they are", () => {
    const content = markupToContent(
      "5 * 3 is 15, and ^[ never closes, <u>open",
    );
    expect(isPlainContent(content)).toBe(true);
    expect(textBlockPlain({ content })).toBe(
      "5 * 3 is 15, and ^[ never closes, <u>open",
    );
  });

  it("keeps a line per paragraph", () => {
    expect(
      textBlockLines({ content: markupToContent("One\n\n**Three**") }),
    ).toEqual(["One", "", "Three"]);
  });

  it("round-trips content through markup, escapes and all", () => {
    const content = normalizeTextContent(
      doc(
        para(
          text("Stars * and \\ slashes, ^[not a note], <u>not a tag</u> "),
          text("bold ", ["bold"]),
          text("both", ["bold", "italic"]),
          text(" under", ["underline"]),
          note({ note: "Has [brackets] and | pipes" }),
          note({ note: "@not a citation" }),
          note({ sourceId: "s-1", locator: "pp. 3, 5", note: "Why." }),
        ),
        { type: "paragraph" },
      ),
    );
    const markup = contentToMarkup(content);
    expect(markupToContent(markup)).toEqual(content);
  });

  it("lists the sources a piece of markup cites", () => {
    expect(markupSourceIds("a^[@one] b^[@two, p. 1]^[@one]^[note]")).toEqual([
      "one",
      "two",
    ]);
  });

  it("serializes a plain block with its specials escaped", () => {
    expect(contentToMarkup(textBlockContent({ text: "2*3" }))).toBe("2\\*3");
  });
});

describe("textBlockFormattedSpans", () => {
  it("lists each formatted span with its marks", () => {
    const { spans, totalChars } = textBlockFormattedSpans({
      content: markupToContent("A **long bold run** and *one*\n<u>two</u>"),
    });
    expect(spans).toEqual([
      { text: "long bold run", marks: ["bold"] },
      { text: "one", marks: ["italic"] },
      { text: "two", marks: ["underline"] },
    ]);
    expect(totalChars).toBe("A long bold run and one".length + 3);
  });

  it("counts neighbouring runs with different marks as one span", () => {
    const { spans } = textBlockFormattedSpans({
      content: markupToContent("**bold *and italic*** plain"),
    });
    expect(spans).toEqual([
      { text: "bold and italic", marks: ["bold", "italic"] },
    ]);
  });

  it("finds nothing in plain text", () => {
    expect(textBlockFormattedSpans({ text: "Plain" })).toEqual({
      spans: [],
      totalChars: 5,
    });
  });
});

describe("withTextBlockDocument", () => {
  it("stores content even when nothing is formatted", () => {
    const block = withTextBlockDocument(
      { id: "b", type: "text", text: "old" },
      textToContent("Plain words"),
    );
    expect(block.text).toBeUndefined();
    expect(textBlockPlain(block)).toBe("Plain words");
  });
});

describe("footnote parts for the Word export", () => {
  const sources = sourcesById({
    sources: [
      { id: "s1", title: "Cats", author: "Jane Smith" },
      { id: "empty" },
    ],
  });

  it("tags the locator and the note, and keeps the locator's text exact", () => {
    const parts = footnoteParts(
      { sourceId: "s1", locator: "fol.", note: "A note." },
      sources,
    );
    expect(parts.find((p) => p.role === "locator").text).toBe(", fol.");
    expect(parts.find((p) => p.role === "note").text).toBe(" A note.");
  });

  it("names a cited source that is still empty, rather than calling it missing", () => {
    const text = (footnote) =>
      footnoteParts(footnote, sources)
        .map((p) => p.text)
        .join("");
    expect(text({ sourceId: "empty", locator: "", note: "" })).toBe(
      `${UNTITLED_SOURCE_TEXT}.`,
    );
    expect(text({ sourceId: "empty", locator: "p. 3", note: "" })).toBe(
      `${UNTITLED_SOURCE_TEXT}, p. 3.`,
    );
  });
});
