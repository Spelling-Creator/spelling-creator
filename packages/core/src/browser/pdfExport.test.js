// Framing mammoth's pictures for the PDF: each image takes its own caption and
// credit lines into its figure, and nothing after them.

import { describe, expect, it, vi } from "vitest";

// html2pdf.js wants a browser the moment it loads; nothing here prints.
vi.mock("html2pdf.js", () => ({ default: () => {} }));

const { layoutImageFigures } = await import("./pdfExport.js");

const IMG = '<p><img src="a.png" width="10" height="10" /></p>';

function picture(caption, credit) {
  return { width: 100, align: "center", caption, credit };
}

describe("layoutImageFigures", () => {
  it("takes the caption and credit paragraphs into the figure", () => {
    const out = layoutImageFigures(
      `${IMG}<p><em>A lion</em></p><p>Image from Pixabay</p><p>Next</p>`,
      [picture("A lion", "Image from Pixabay")],
    );
    expect(out).toContain(">A lion</div>");
    expect(out).toContain(">Image from Pixabay</div>");
    expect(out).toMatch(/<\/figure><p>Next<\/p>$/);
    expect(out).not.toContain("<em>A lion</em>");
  });

  it("takes a lone credit and leaves the next block alone", () => {
    const out = layoutImageFigures(
      `${IMG}<p>Image from Pixabay</p><p>Next</p><p>After</p>`,
      [picture("", "Image from Pixabay")],
    );
    expect(out).toMatch(/<\/figure><p>Next<\/p><p>After<\/p>$/);
  });

  it("puts back both following paragraphs for a bare picture", () => {
    const out = layoutImageFigures(`${IMG}<p>Next</p><p>After</p>`, [
      picture("", ""),
    ]);
    expect(out).not.toContain("figcaption");
    expect(out).toMatch(/<\/figure><p>Next<\/p><p>After<\/p>$/);
  });

  it("frames two pictures in a row with their own lines", () => {
    const out = layoutImageFigures(
      `${IMG}<p>Credit one</p>${IMG}<p><em>Two</em></p><p>Credit two</p>`,
      [picture("", "Credit one"), picture("Two", "Credit two")],
    );
    expect(out.match(/<figure/g)).toHaveLength(2);
    expect(out.indexOf("Credit one")).toBeLessThan(out.indexOf(">Two<"));
    expect(out).toMatch(/Credit two<\/div><\/figcaption><\/figure>$/);
  });
});
