// The DOCX exporter's `embedded` out-parameter — the list the PDF path pairs
// mammoth's `<img>` tags against, by position.
//
// The pairing is positional and there is nothing in the HTML tying a tag back to
// its block, so the list has to hold exactly the pictures the document really
// carries, in order. A picture the exporter could not fetch bytes for is written
// as "[image could not be embedded]" text and produces no tag at all — count it
// here and every image after it in the lesson is framed with the wrong block's
// width, alignment and caption.
//
// A `src` data URL decodes with no browser at all, and a hash ref needs an image
// store this environment doesn't have, so the two together give us a working
// picture and a failing one without stubbing anything.

import { describe, expect, it } from "vitest";

import { buildDocument } from "./docxExport.js";
import { VAKT_DEFAULT_IMAGE_SIZE } from "../vakt.js";
import { DOCX_MAX_IMAGE_WIDTH } from "../lessonLayout.js";
import { imageSizeScale } from "../image.js";

// A 1x1 PNG, small enough to sit in the source.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// A picture whose bytes cannot be fetched: the hash is in no image store, and
// there is no API to fall back to.
const MISSING = { hash: "0".repeat(40), mime: "image/png", ext: "png" };

function lesson(blocks) {
  return { title: "t", sections: [{ id: "s1", name: "One", blocks }] };
}

async function embeddedFor(blocks) {
  const embedded = [];
  await buildDocument(lesson(blocks), {}, embedded);
  return embedded;
}

describe("the embedded-picture list", () => {
  it("records an image block's own width, alignment, caption and credit", async () => {
    const embedded = await embeddedFor([
      {
        id: "b1",
        type: "image",
        src: PNG,
        width: 200,
        height: 100,
        size: "full",
        align: "right",
        caption: "A caption",
        credit: "Image from Pixabay",
      },
    ]);
    expect(embedded).toEqual([
      {
        width: 200,
        align: "right",
        caption: "A caption",
        credit: "Image from Pixabay",
      },
    ]);
  });

  it("splits a credit out of an older block's caption", async () => {
    const embedded = await embeddedFor([
      {
        id: "b1",
        type: "image",
        src: PNG,
        width: 200,
        height: 100,
        size: "full",
        caption: "A lion. Image by jdoe from Pixabay",
      },
    ]);
    expect(embedded).toEqual([
      {
        width: 200,
        align: "center",
        caption: "A lion.",
        credit: "Image by jdoe from Pixabay",
      },
    ]);
  });

  it("records an unframed VAKT picture at the VAKT defaults", async () => {
    // The block carries no size or alignment of its own, so the exporter prints
    // it centred at the VAKT default size and reports what it actually used.
    const embedded = await embeddedFor([
      {
        id: "b1",
        type: "vakt",
        text: "Do 3 wall pushes",
        links: [],
        src: PNG,
        width: 2000,
        height: 1000,
        caption: "Wall push",
      },
    ]);
    expect(embedded).toEqual([
      {
        width: Math.round(
          DOCX_MAX_IMAGE_WIDTH * imageSizeScale(VAKT_DEFAULT_IMAGE_SIZE),
        ),
        align: "center",
        caption: "Wall push",
        credit: "",
      },
    ]);
  });

  it("honours a VAKT picture's own size and alignment", async () => {
    const embedded = await embeddedFor([
      {
        id: "b1",
        type: "vakt",
        text: "Do 3 wall pushes",
        links: [],
        src: PNG,
        width: 2000,
        height: 1000,
        size: "small",
        align: "left",
      },
    ]);
    expect(embedded).toEqual([
      {
        width: Math.round(DOCX_MAX_IMAGE_WIDTH * imageSizeScale("small")),
        align: "left",
        caption: "",
        credit: "",
      },
    ]);
  });

  it("leaves out a picture whose bytes could not be fetched", async () => {
    expect(
      await embeddedFor([
        { id: "b1", type: "image", image: MISSING, width: 40, height: 40 },
      ]),
    ).toEqual([]);
  });

  it("keeps the following images aligned with their own blocks", async () => {
    // The regression: a VAKT picture that fails to embed, then a real image.
    // Listing the failed one would hand the real image the VAKT block's framing
    // and shift every image after it.
    const embedded = await embeddedFor([
      {
        id: "b1",
        type: "vakt",
        text: "Do 3 wall pushes",
        links: [],
        image: MISSING,
        width: 40,
        height: 40,
        caption: "VAKT caption",
      },
      {
        id: "b2",
        type: "image",
        src: PNG,
        width: 300,
        height: 150,
        size: "full",
        align: "left",
        caption: "Real caption",
      },
    ]);
    expect(embedded).toEqual([
      { width: 300, align: "left", caption: "Real caption", credit: "" },
    ]);
  });

  it("is not collected at all when no caller asks for it", async () => {
    // The plain DOCX download passes nothing, and must not pay for the list or
    // trip over its absence.
    await expect(
      buildDocument(lesson([{ id: "b1", type: "image", src: PNG }])),
    ).resolves.toBeTruthy();
  });
});

describe("formatted text, footnotes and sources", () => {
  // Read back through mammoth, the converter the PDF path uses, so this checks
  // what both the Word file and the printout end up carrying.
  async function html(doc) {
    const { Packer } = await import("docx");
    const { default: mammoth } = await import("mammoth");
    const buffer = await Packer.toBuffer(await buildDocument(doc));
    const { value } = await mammoth.convertToHtml(
      { buffer },
      { styleMap: ["u => u"] },
    );
    return value;
  }

  it("writes marks, real footnotes in reading order, and the Sources list", async () => {
    const { markupToContent } = await import("../lessonText.js");
    const out = await html({
      title: "t",
      sources: [{ id: "smith", title: "Cats of Egypt", author: "Jane Smith" }],
      sections: [
        {
          id: "s1",
          name: "One",
          blocks: [
            {
              id: "b1",
              type: "text",
              content: markupToContent("**Bold**^[First note.]"),
            },
            {
              id: "b2",
              type: "text",
              content: markupToContent("*Italic* <u>under</u>^[@smith, p. 12]"),
            },
          ],
        },
      ],
    });
    expect(out).toContain("<strong>Bold</strong>");
    expect(out).toContain("<em>Italic</em>");
    expect(out).toContain("<u>under</u>");
    expect(out.indexOf('href="#footnote-1"')).toBeLessThan(
      out.indexOf('href="#footnote-2"'),
    );
    expect(out).toContain("<strong>Sources</strong>");
    expect(out).toContain("Jane Smith. <em>Cats of Egypt</em>.");
    expect(out).toMatch(/<li id="footnote-1"><p>First note\./);
    expect(out).toMatch(
      /<li id="footnote-2"><p>Jane Smith, <em>Cats of Egypt<\/em>, p\. 12\./,
    );
  });

  it("prints a picture's caption and credit as two paragraphs", async () => {
    const out = await html(
      lesson([
        {
          id: "b1",
          type: "image",
          src: PNG,
          width: 20,
          height: 10,
          caption: "A lion",
          credit: "Image from Pixabay",
        },
        { id: "b2", type: "text", text: "Next" },
      ]),
    );
    expect(out).toMatch(
      /<img[^>]*\/?><\/p><p><em>A lion<\/em><\/p><p>Image from Pixabay<\/p><p>Next<\/p>/,
    );
  });

  it("adds no Sources list to a lesson without sources", async () => {
    const out = await html(lesson([{ id: "b1", type: "text", text: "Plain" }]));
    expect(out).not.toContain("Sources");
    expect(out).not.toContain("footnote");
  });
});
