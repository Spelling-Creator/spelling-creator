// Covers the VAKT block's shared rules: the label that is added rather than
// stored, the link filter that keeps an unsafe destination out of a published
// page, and the walkthrough's treatment of an activity as material rather than
// as something the speller answers.

import { describe, expect, it } from "vitest";

import {
  VAKT_LABEL,
  createVaktBlock,
  vaktHasContent,
  vaktImageAlign,
  vaktImageBlock,
  vaktImageSize,
  vaktLinkText,
  vaktLinks,
  vaktText,
} from "./vakt.js";
import {
  buildInteractiveSteps,
  countInteractiveQuestions,
  stepSpeechText,
} from "./interactive.js";
import { normalizeLessonFile } from "./jsonImport.js";

let counter = 0;
const newId = () => `id-${(counter += 1)}`;

describe("vaktText", () => {
  it("returns the activity as written", () => {
    expect(
      vaktText({ text: "Bob likes to do jumping jacks. Let's do 3 of those." }),
    ).toBe("Bob likes to do jumping jacks. Let's do 3 of those.");
  });

  it("strips a label the author typed themselves, so it is never doubled", () => {
    // Every renderer puts VAKT_LABEL in front of this text; an author who typed
    // it too would otherwise print "VAKT: VAKT: …".
    for (const written of ["VAKT: Do 3 wall pushes", "vakt:Do 3 wall pushes"]) {
      expect(vaktText({ text: written })).toBe("Do 3 wall pushes");
    }
    expect(VAKT_LABEL).toBe("VAKT:");
  });

  it("tolerates a missing block or missing text", () => {
    expect(vaktText(undefined)).toBe("");
    expect(vaktText({})).toBe("");
  });
});

describe("vaktLinks", () => {
  it("keeps http, https and mailto links, trimmed", () => {
    const links = vaktLinks({
      links: [
        { id: "a", label: " Video ", url: " https://example.org/clip " },
        { id: "b", label: "", url: "http://example.org" },
        { id: "c", label: "Ask", url: "mailto:teacher@example.org" },
      ],
    });
    expect(links.map((l) => l.url)).toEqual([
      "https://example.org/clip",
      "http://example.org",
      "mailto:teacher@example.org",
    ]);
    expect(links[0].label).toBe("Video");
  });

  it("drops anything that isn't a real, safe destination", () => {
    // These become real <a href> in a published page and in a Word document, so
    // the same rule the comment sanitizer enforces applies here.
    expect(
      vaktLinks({
        links: [
          { id: "a", url: "javascript:alert(1)" },
          { id: "b", url: "data:text/html,<script>" },
          { id: "c", url: "/relative" },
          { id: "d", url: "" },
          null,
        ],
      }),
    ).toEqual([]);
  });
});

describe("vaktLinkText", () => {
  it("spells the address out beside the label, for print", () => {
    expect(vaktLinkText({ label: "Video", url: "https://example.org" })).toBe(
      "Video — https://example.org",
    );
  });

  it("falls back to the bare address when there is no label", () => {
    expect(vaktLinkText({ url: "https://example.org" })).toBe(
      "https://example.org",
    );
  });
});

describe("vaktHasContent", () => {
  it("is false for the empty block the editor creates", () => {
    expect(vaktHasContent(createVaktBlock(newId))).toBe(false);
  });

  it("is true once it holds an activity, a link or a picture", () => {
    expect(vaktHasContent({ text: "Do 3 wall pushes" })).toBe(true);
    expect(
      vaktHasContent({ links: [{ id: "a", url: "https://example.org" }] }),
    ).toBe(true);
    expect(vaktHasContent({ image: { hash: "abc" } })).toBe(true);
  });
});

describe("a VAKT picture's framing", () => {
  it("defaults to medium and centred, not to an image block's full width", () => {
    expect(vaktImageSize({ type: "vakt" })).toBe("medium");
    expect(vaktImageAlign({ type: "vakt" })).toBe("center");
  });

  it("keeps a size and an alignment the author picked", () => {
    expect(vaktImageSize({ size: "large" })).toBe("large");
    expect(vaktImageAlign({ align: "left" })).toBe("left");
  });

  it("falls back to the VAKT default rather than to full width", () => {
    // imageSizeScale treats an unknown size as full, which would make a
    // corrupted value the biggest a picture can be. A VAKT picture that has
    // lost its framing should look the way an unframed one does instead.
    expect(vaktImageSize({ size: "enormous" })).toBe("medium");
    expect(vaktImageAlign({ align: "justify" })).toBe("center");
  });

  it("hands the renderers a block they can treat as an image block", () => {
    expect(vaktImageBlock({ id: "b1", type: "vakt", size: "small" })).toEqual({
      id: "b1",
      type: "vakt",
      size: "small",
      align: "center",
    });
  });
});

describe("a VAKT block in the walkthrough", () => {
  const doc = {
    sections: [
      {
        id: "s1",
        name: "Volcanoes",
        blocks: [
          { id: "b1", type: "text", text: "Magma rises." },
          { id: "b2", type: "question", questionType: "open", prompt: "Why?" },
          {
            id: "b3",
            type: "vakt",
            text: "Bob likes to do jumping jacks. Let's do 3 of those.",
            links: [{ id: "l1", label: "Clip", url: "https://example.org" }],
          },
        ],
      },
    ],
  };

  it("appears with the section's material, not as a step of its own", () => {
    const steps = buildInteractiveSteps(doc);
    expect(steps.map((s) => s.kind)).toEqual(["content", "question"]);
    expect(steps[0].blocks.map((b) => b.id)).toEqual(["b1", "b3"]);
  });

  it("is never counted as a question", () => {
    expect(countInteractiveQuestions(doc)).toBe(1);
  });

  it("is read aloud without its label or its links", () => {
    const [content] = buildInteractiveSteps(doc);
    expect(stepSpeechText(content)).toBe(
      "Volcanoes\nMagma rises.\nBob likes to do jumping jacks. Let's do 3 of those.",
    );
  });
});

describe("importing a VAKT block from a lesson file", () => {
  it("normalises the text, the links and the picture", () => {
    const { sections } = normalizeLessonFile({
      title: "Volcanoes",
      sections: [
        {
          id: "s1",
          name: "One",
          blocks: [
            {
              id: "b1",
              type: "vakt",
              text: "VAKT: Do 3 wall pushes",
              links: [
                { id: "l1", label: "Clip", url: "https://example.org" },
                "https://example.org/two",
                { id: "l3", url: "javascript:alert(1)" },
              ],
              image: { hash: "abc", mime: "image/png", ext: "png" },
              width: 100,
              height: 50,
              caption: "A wall push",
            },
          ],
        },
      ],
    });

    const [block] = sections[0].blocks;
    expect(block.type).toBe("vakt");
    expect(block.text).toBe("Do 3 wall pushes");
    expect(block.links.map((l) => l.url)).toEqual([
      "https://example.org",
      "https://example.org/two",
    ]);
    expect(block.image).toEqual({ hash: "abc", mime: "image/png", ext: "png" });
    expect(block.caption).toBe("A wall push");
    // Unframed in the file, so the block comes back carrying the VAKT defaults.
    expect(block.size).toBe("medium");
    expect(block.align).toBe("center");
  });

  it("keeps the framing the file carried", () => {
    const { sections } = normalizeLessonFile({
      title: "Volcanoes",
      sections: [
        {
          id: "s1",
          name: "One",
          blocks: [
            {
              id: "b1",
              type: "vakt",
              text: "Do 3 wall pushes",
              image: { hash: "abc", mime: "image/png", ext: "png" },
              width: 100,
              height: 50,
              size: "full",
              align: "right",
            },
          ],
        },
      ],
    });
    const [block] = sections[0].blocks;
    expect(block.size).toBe("full");
    expect(block.align).toBe("right");
  });

  it("keeps a picture that is still a legacy inline src", () => {
    // A DOCX import produces `src` and only becomes a hash ref once
    // convertDocImages has run, so a file written in between carries one.
    // Dropping it would lose the picture — and, here, the whole block with it.
    const { sections } = normalizeLessonFile({
      title: "Volcanoes",
      sections: [
        {
          id: "s1",
          name: "One",
          blocks: [
            {
              id: "b1",
              type: "vakt",
              text: "",
              src: "data:image/png;base64,iVBORw0KGgo=",
              width: 10,
              height: 10,
            },
          ],
        },
      ],
    });
    expect(sections[0].blocks[0].src).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });

  it("drops a block that holds nothing at all", () => {
    // A section left with no blocks is dropped by the importer, so an otherwise
    // empty lesson file is rejected rather than opening a blank red card.
    expect(() =>
      normalizeLessonFile({
        title: "Volcanoes",
        sections: [
          {
            id: "s1",
            name: "One",
            blocks: [{ id: "b1", type: "vakt", text: "  ", links: [] }],
          },
        ],
      }),
    ).toThrow(/no readable sections/i);
  });
});
