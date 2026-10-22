import { describe, expect, it } from "vitest";

import {
  inlineTextContent,
  inlineTextMarkup,
  inlineTextPlain,
  inlineTextRuns,
  isPlainInlineText,
  markupToInlineText,
  normalizeInlineText,
} from "./inlineText.ts";
import { inlineTextSpeech } from "./speech.ts";

const text = (t: string, marks: string[] = []) =>
  marks.length
    ? { type: "text", text: t, marks: marks.map((type) => ({ type })) }
    : { type: "text", text: t };
const para = (...content: object[]) => ({ type: "paragraph", content });
const doc = (...content: object[]) => ({ type: "doc", content });
const math = (source: string, extra: Record<string, unknown> = {}) => ({
  type: "math",
  attrs: { format: "tex", source, display: false, spoken: null, ...extra },
});

describe("the two shapes", () => {
  it("keeps a plain string as it is", () => {
    expect(normalizeInlineText("How many?")).toBe("How many?");
    expect(inlineTextPlain("How many?")).toBe("How many?");
    expect(isPlainInlineText("How many?")).toBe(true);
    expect(normalizeInlineText(undefined)).toBe("");
    expect(normalizeInlineText(null)).toBe("");
    expect(normalizeInlineText(42)).toBe("");
  });

  it("stores a document that needs nothing more than a string as the string", () => {
    expect(normalizeInlineText(doc(para(text("How "), text("many?"))))).toBe(
      "How many?",
    );
    expect(isPlainInlineText(doc(para(text("How many?"))))).toBe(true);
    expect(normalizeInlineText(doc(para()))).toBe("");
  });

  it("keeps a document with a formula, a mark or a hint", () => {
    const value = doc(para(text("Work out "), math("\\frac{60}{5}")));
    const stored = normalizeInlineText(value);
    expect(typeof stored).toBe("object");
    expect(stored).toEqual(value);
    expect(isPlainInlineText(value)).toBe(false);
    expect(normalizeInlineText(doc(para(text("Felis", ["italic"]))))).toEqual(
      doc(para(text("Felis", ["italic"]))),
    );
  });

  it("shows a document as one paragraph, whatever came in", () => {
    expect(inlineTextContent("A question")).toEqual(
      doc(para(text("A question"))),
    );
    expect(inlineTextContent("")).toEqual(doc({ type: "paragraph" }));
    expect(inlineTextContent(null)).toEqual(doc({ type: "paragraph" }));
  });

  it("folds several paragraphs into one line with a space between them", () => {
    const value = doc(para(text("Name one.")), para(), para(text("Be quick.")));
    expect(normalizeInlineText(value)).toBe("Name one. Be quick.");
    expect(inlineTextContent("Name one.\nBe quick.")).toEqual(
      doc(para(text("Name one. Be quick."))),
    );
  });

  it("drops a footnote and sets a display formula in the line", () => {
    const value = doc(
      para(
        text("See "),
        {
          type: "footnote",
          attrs: { sourceId: null, locator: "", note: "n" },
        },
        math("x^2", { display: true }),
      ),
    );
    expect(normalizeInlineText(value)).toEqual(
      doc(para(text("See "), math("x^2"))),
    );
  });
});

describe("reading", () => {
  const value = doc(
    para(
      text("The "),
      text("Fresnel"),
      text(" lens: "),
      math("\\frac{60}{5} = 12"),
      { type: "pause", attrs: { length: "short" } },
    ),
  );

  it("reads the plain words, with a formula as its source", () => {
    expect(inlineTextPlain(value)).toBe("The Fresnel lens: \\frac{60}{5} = 12");
  });

  it("gives runs a renderer can draw", () => {
    expect(inlineTextRuns(value)).toEqual([
      {
        type: "text",
        text: "The Fresnel lens: ",
        bold: false,
        italic: false,
        underline: false,
      },
      {
        type: "math",
        format: "tex",
        source: "\\frac{60}{5} = 12",
        display: false,
        spoken: null,
      },
      { type: "pause", length: "short" },
    ]);
    expect(inlineTextRuns("Plain")).toEqual([
      {
        type: "text",
        text: "Plain",
        bold: false,
        italic: false,
        underline: false,
      },
    ]);
    expect(inlineTextRuns("")).toEqual([]);
  });

  it("speaks a prompt with its hints and formulas", () => {
    const hinted = doc(
      para(
        {
          type: "text",
          text: "Fresnel",
          marks: [{ type: "speech", attrs: { ipa: "freɪˈnɛl" } }],
        },
        text(" made "),
        math("x^2", { spoken: "x squared" }),
        text(", then "),
        math("y^2"),
      ),
    );
    expect(inlineTextSpeech(hinted)).toEqual([
      { text: "Fresnel", ipa: "freɪˈnɛl" },
      " made x squared, then ",
      { text: "y^2", formula: { format: "tex", source: "y^2" } },
    ]);
    expect(inlineTextSpeech("Why?")).toEqual(["Why?"]);
    expect(inlineTextSpeech("")).toEqual([]);
    expect(inlineTextSpeech(undefined)).toEqual([]);
  });
});

describe("markup", () => {
  it("round trips through the MCP server's markup on one line", () => {
    const markup =
      "Work out {tex: \\frac{60}{5}} for *Felis* now{pause}, [REEF]{spell}";
    const stored = markupToInlineText(markup);
    expect(typeof stored).toBe("object");
    expect(inlineTextMarkup(stored)).toBe(markup);
    expect(inlineTextPlain(stored)).toBe(
      "Work out \\frac{60}{5} for Felis now, REEF",
    );
  });

  it("stores plain markup as a plain string, escaping what needs it", () => {
    expect(markupToInlineText("Name one.")).toBe("Name one.");
    expect(markupToInlineText("A \\* star")).toBe("A * star");
    expect(inlineTextMarkup("A * star")).toBe("A \\* star");
    expect(markupToInlineText("Name one.\nBe quick.")).toBe(
      "Name one. Be quick.",
    );
  });

  it("drops a footnote written into a prompt", () => {
    expect(markupToInlineText("Why?^[A note.]")).toBe("Why?");
  });
});
