// The Open Spelling Lesson Format round trip: what toOslf writes has to be a
// file the format's own schema accepts, and what fromOslf reads back has to
// be the lesson that was written, bar the two things the header of oslf.js
// says don't survive.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";

import { normalizeLessonFile } from "./jsonImport.js";
import { lessonFileName } from "./lessonFile.js";
import { markupToContent } from "./lessonText.js";
import {
  OSLF_VERSION,
  OslfExportError,
  fromOslf,
  isOslfFile,
  oslfFileName,
  toOslf,
} from "./oslf.js";

const schema = JSON.parse(
  readFileSync(new URL("./oslf.schema.json", import.meta.url), "utf8"),
);
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
  schema,
);

// A lesson using every block and question type, the way the editor stores
// them: formatted text with a footnote, every answer shape, a three-board
// question with a Besides line, a picture with a credit, a VAKT activity with
// a link and a heading. One legacy `open` question, to be sorted on the way
// out.
const question = (id, questionType, fields) => ({
  id,
  type: "question",
  questionType,
  ...fields,
});
const DOC = {
  title: "Lighthouses",
  ageRange: "11-14 years",
  sources: [
    {
      id: "lighthouse",
      title: "Lighthouse",
      author: "",
      publisher: "Wikipedia",
      year: "",
      url: "https://en.wikipedia.org/wiki/Lighthouse",
    },
  ],
  sections: [
    {
      id: "s1",
      name: "The First Lighthouses",
      blocks: [
        {
          id: "img1",
          type: "image",
          image: { hash: "abc123", mime: "image/png", ext: "png" },
          width: 640,
          height: 480,
          caption: "The tower at Pharos.",
          credit: "Image (by Example Author, CC0) via Wikimedia Commons",
          size: "large",
          align: "center",
        },
        {
          id: "t1",
          type: "text",
          content: markupToContent(
            "Sailors looked for *fires* on **towers**.^[@lighthouse, p. 3 | A note.]\nThe tower stood on PHAROS.",
          ),
        },
        {
          id: "sp1",
          type: "spelling",
          words: [
            { id: "w1", text: "BEACON" },
            { id: "w2", text: "HARBOR" },
          ],
        },
        question("q1", "single", {
          prompt: "The tower stood on the island of ______.",
          answer: "PHAROS",
        }),
        question("q2", "background", {
          prompt: "On which continent is Egypt?",
          answer: "AFRICA",
        }),
        question("q3", "number", {
          prompt: "How many steps in three climbs of 120?",
          answer: "360",
          steps: [{ id: "st1", text: "120 times 3 is 360." }],
        }),
        question("q4", "multiple", {
          prompt: "Ships avoided ______. Name one.",
          answers: [
            { id: "a1", text: "ROCKS" },
            { id: "a2", text: "REEFS" },
          ],
          threeBoard: true,
          besides: "ROCKS",
        }),
        question("q5", "multiple_open", {
          prompt: "Give a word that means the same as beam.",
          answers: [{ id: "a3", text: "RAY" }],
        }),
        question("q6", "tight_open", {
          prompt: "Name something that gives off light.",
          answers: [{ id: "a4", text: "LAMP" }],
        }),
        question("q7", "tight_open", { prompt: "Name a color.", answers: [] }),
        question("q8", "paraphrase", {
          prompt: "In your own words, explain why it was built.",
        }),
        { id: "h1", type: "heading", text: "WOULD YOU RATHER" },
        question("q9", "wyr", {
          prompt: "Would you rather keep a lighthouse or a harbor?",
        }),
        question("q10", "broad_open", {
          prompt: "Why do you think people built lighthouses?",
        }),
        question("q11", "open", { prompt: "Name something made of glass." }),
        {
          id: "v1",
          type: "vakt",
          text: "Turn slowly in a full circle.",
          links: [{ id: "l1", label: "A video", url: "https://example.org/v" }],
        },
      ],
    },
  ],
};

const imageSrc = (block) => `https://example.org/images/${block.image.hash}`;

describe("toOslf", () => {
  it("writes a file the format's schema accepts", () => {
    const file = toOslf(DOC, { imageSrc });
    const ok = validate(file);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    expect(file.oslf).toBe(OSLF_VERSION);
  });

  it("maps every type onto the format's ids and answer keys", () => {
    const file = toOslf(DOC, { imageSrc });
    const questions = file.sections[0].blocks.filter(
      (b) => b.type === "question",
    );
    expect(questions.map((q) => [q.questionType, q.answerKey])).toEqual([
      ["known", undefined],
      ["prior-knowledge", undefined],
      ["math", undefined],
      ["semi-open", undefined],
      ["semi-open", "suggested"],
      ["tight-open", "suggested"],
      ["tight-open", undefined],
      ["paraphrase", undefined],
      ["would-you-rather", undefined],
      ["broad-open", undefined],
      // The legacy open, sorted by its wording.
      ["tight-open", undefined],
    ]);
    expect(questions[2].working).toEqual(["120 times 3 is 360."]);
    expect(questions[3]).toMatchObject({
      answers: ["ROCKS", "REEFS"],
      threeBoard: true,
      besides: "ROCKS",
    });
    expect("answers" in questions[6]).toBe(false);
  });

  // An old lesson asked every pink question as `open`, the retelling among
  // them. The export reads each the way the lesson checks do, so a lesson
  // that passes the shape check still passes it after a round trip.
  it("writes a legacy open as the type the lesson checks read it as", () => {
    const legacy = (id, prompt) => question(id, "open", { prompt });
    const file = toOslf({
      title: "T",
      sections: [
        {
          blocks: [
            legacy("o1", "Name something made of glass."),
            legacy("o2", "In your own words, explain why it was built."),
            legacy("o3", "In your own words, explain why you prefer towers."),
            legacy("o4", "Why do you think people built lighthouses?"),
          ],
        },
      ],
    });
    expect(validate(file)).toBe(true);
    expect(file.sections[0].blocks.map((b) => b.questionType)).toEqual([
      "tight-open",
      "paraphrase",
      "broad-open",
      "broad-open",
    ]);
    const back = fromOslf(file).sections[0].blocks;
    expect(back.map((b) => b.questionType)).toEqual([
      "tight_open",
      "paraphrase",
      "broad_open",
      "broad_open",
    ]);
  });

  it("writes rich text as runs and notes, and plain paragraphs as strings", () => {
    const file = toOslf(DOC, { imageSrc });
    const passage = file.sections[0].blocks.find((b) => b.type === "passage");
    expect(passage.paragraphs).toEqual([
      [
        "Sailors looked for ",
        { text: "fires", italic: true },
        " on ",
        { text: "towers", bold: true },
        ".",
        { note: { source: "lighthouse", locator: "p. 3", text: "A note." } },
      ],
      "The tower stood on PHAROS.",
    ]);
  });

  it("refers to a picture by the URL the caller gives, with its credit apart", () => {
    const file = toOslf(DOC, { imageSrc });
    expect(file.sections[0].blocks[0]).toEqual({
      id: "img1",
      type: "image",
      src: "https://example.org/images/abc123",
      alt: "The tower at Pharos.",
      caption: "The tower at Pharos.",
      credit: { text: "Image (by Example Author, CC0) via Wikimedia Commons" },
      width: 640,
      height: 480,
      size: "large",
      align: "center",
    });
    // No way to reach the bytes, no picture: the format needs a src.
    const without = toOslf(DOC);
    expect(without.sections[0].blocks.some((b) => b.type === "image")).toBe(
      false,
    );
  });

  it("leaves out the fields a source doesn't fill in", () => {
    expect(toOslf(DOC).sources).toEqual([
      {
        id: "lighthouse",
        title: "Lighthouse",
        publisher: "Wikipedia",
        url: "https://en.wikipedia.org/wiki/Lighthouse",
      },
    ]);
  });

  // The format requires an answer on a known, prior-knowledge, math or
  // semi-open question, so a draft with one still blank can't become a valid
  // file. Writing it anyway would hand over a file every reader rejects.
  it("refuses a question the format needs an answer for, and names it", () => {
    const blank = (questionType, fields) => ({
      title: "T",
      sections: [
        {
          blocks: [
            question("q1", "tight_open", { prompt: "Name a color." }),
            question("q2", questionType, { prompt: "Which way?", ...fields }),
          ],
        },
      ],
    });
    expect(() => toOslf(blank("single", { answer: "" }))).toThrow(
      OslfExportError,
    );
    expect(() => toOslf(blank("single", { answer: "  " }))).toThrow(
      /Section 1, question 2 \("Which way\?"\) has no answer.*Known question/,
    );
    expect(() => toOslf(blank("background", { answer: "" }))).toThrow(
      /Prior knowledge question/,
    );
    expect(() => toOslf(blank("number", { answer: "", steps: [] }))).toThrow(
      /Math question/,
    );
    expect(() =>
      toOslf(blank("multiple", { answers: [{ id: "a", text: "" }] })),
    ).toThrow(/Semi-open question/);
    expect(() => toOslf(blank("multiple_open", { answers: [] }))).toThrow(
      /Suggested answers question/,
    );
    // The types with no key, or an optional one, go out unanswered as they
    // should.
    for (const type of [
      "tight_open",
      "broad_open",
      "paraphrase",
      "wyr",
      "open",
    ]) {
      expect(() => toOslf(blank(type, {}))).not.toThrow();
    }
  });

  it("writes a line break in a one-line field as a space", () => {
    const file = toOslf({
      title: "T",
      sections: [
        {
          blocks: [
            {
              id: "t1",
              type: "text",
              content: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "A line\nand " },
                      {
                        type: "text",
                        text: "the next",
                        marks: [{ type: "bold" }],
                      },
                      { type: "text", text: "." },
                    ],
                  },
                ],
              },
            },
            question("q1", "single", {
              prompt: "Name one.\nBe quick.",
              answer: "ROCKS",
            }),
            { id: "h1", type: "heading", text: "WOULD\r\nYOU RATHER" },
            {
              id: "img1",
              type: "image",
              src: "data:image/png;base64,AAAA",
              caption: "Two\nlines",
            },
          ],
        },
      ],
    });
    expect(validate(file)).toBe(true);
    const [passage, q, heading, image] = file.sections[0].blocks;
    expect(passage.paragraphs).toEqual([
      ["A line and ", { text: "the next", bold: true }, "."],
    ]);
    expect(q.prompt).toBe("Name one. Be quick.");
    expect(heading.text).toBe("WOULD YOU RATHER");
    expect(image.caption).toBe("Two lines");
  });
});

describe("fromOslf", () => {
  it("reads back the lesson toOslf wrote", () => {
    const back = normalizeLessonFile(toOslf(DOC, { imageSrc }));
    expect(back.title).toBe("Lighthouses");
    expect(back.ageRange).toBe("11-14 years");
    expect(back.sources).toEqual([
      {
        id: "lighthouse",
        title: "Lighthouse",
        author: "",
        publisher: "Wikipedia",
        year: "",
        url: "https://en.wikipedia.org/wiki/Lighthouse",
      },
    ]);
    const section = back.sections[0];
    expect(section.name).toBe("The First Lighthouses");
    expect(section.blocks.map((b) => b.type)).toEqual(
      DOC.sections[0].blocks.map((b) => b.type),
    );
    // Ids survive, so a lesson that goes out and comes back keeps its keys.
    expect(section.blocks.map((b) => b.id)).toEqual(
      DOC.sections[0].blocks.map((b) => b.id),
    );
    const [image, text, spelling, ...rest] = section.blocks;
    expect(image).toMatchObject({
      src: "https://example.org/images/abc123",
      caption: "The tower at Pharos.",
      credit: "Image (by Example Author, CC0) via Wikimedia Commons",
      size: "large",
      align: "center",
    });
    expect(text.content).toEqual(DOC.sections[0].blocks[1].content);
    expect(spelling.words.map((w) => w.text)).toEqual(["BEACON", "HARBOR"]);
    const questions = rest.filter((b) => b.type === "question");
    expect(questions.map((q) => q.questionType)).toEqual([
      "single",
      "background",
      "number",
      "multiple",
      "multiple_open",
      "tight_open",
      "tight_open",
      "paraphrase",
      "wyr",
      "broad_open",
      // What went out as a legacy open comes back as what it was sorted to.
      "tight_open",
    ]);
    expect(questions[0].answer).toBe("PHAROS");
    expect(questions[2].steps.map((s) => s.text)).toEqual([
      "120 times 3 is 360.",
    ]);
    expect(questions[3]).toMatchObject({ threeBoard: true, besides: "ROCKS" });
    expect(questions[5].answers.map((a) => a.text)).toEqual(["LAMP"]);
    expect(questions[6].answers).toEqual([]);
    const vakt = rest.find((b) => b.type === "vakt");
    expect(vakt.text).toBe("Turn slowly in a full circle.");
    expect(vakt.links.map((l) => [l.label, l.url])).toEqual([
      ["A video", "https://example.org/v"],
    ]);
    expect(rest.find((b) => b.type === "heading").text).toBe(
      "WOULD YOU RATHER",
    );
  });

  it("flattens a rich prompt to its words and keeps an unknown type as an open question", () => {
    const back = fromOslf({
      oslf: "0.1",
      title: "T",
      sections: [
        {
          blocks: [
            {
              type: "question",
              questionType: "known",
              prompt: ["Give a word for ", { text: "beam", italic: true }, "."],
              answers: ["RAY"],
            },
            {
              type: "question",
              questionType: "choice",
              prompt: "Pick one.",
            },
          ],
        },
      ],
    });
    expect(back.sections[0].blocks[0].prompt).toBe("Give a word for beam.");
    expect(back.sections[0].blocks[1]).toMatchObject({
      questionType: "open",
      prompt: "Pick one.",
    });
  });

  it("drops a picture given as a relative file, and keeps one with an address", () => {
    const back = fromOslf({
      oslf: "0.1",
      title: "T",
      sections: [
        {
          blocks: [
            { type: "image", src: "media/pharos.png", caption: "Lost" },
            { type: "image", src: "https://example.org/pharos.png" },
            { type: "passage", paragraphs: ["Kept."] },
          ],
        },
      ],
    });
    expect(back.sections[0].blocks.map((b) => b.type)).toEqual([
      "image",
      "text",
    ]);
    expect(back.sections[0].blocks[0].src).toBe(
      "https://example.org/pharos.png",
    );
  });

  it("refuses a file of a version it can't read, through the usual import error", () => {
    expect(() =>
      normalizeLessonFile({ oslf: "2.0", title: "T", sections: [] }),
    ).toThrow(/OSLF 2.0/);
    // This module reads the 0.x drafts; a 1.0 may move fields it would
    // otherwise read as 0.1's and quietly drop.
    expect(() =>
      normalizeLessonFile({ oslf: "1.0", title: "T", sections: [] }),
    ).toThrow(/OSLF 1.0/);
    expect(() =>
      fromOslf({ oslf: "0.2", title: "T", sections: [] }),
    ).not.toThrow();
  });
});

describe("the file's name and marker", () => {
  it("tells an OSLF file from the app's own", () => {
    expect(isOslfFile({ oslf: "0.1", title: "T", sections: [] })).toBe(true);
    expect(isOslfFile({ format: "spelling-creator-lesson" })).toBe(false);
    expect(isOslfFile(null)).toBe(false);
  });

  it("names the file as the app's own lesson file is named, with the format's extension", () => {
    expect(oslfFileName("The First Lighthouses!")).toBe(
      "The-First-Lighthouses.oslf.json",
    );
    expect(oslfFileName("")).toBe("lesson.oslf.json");
    expect(oslfFileName("Lighthouses")).toBe(
      lessonFileName("Lighthouses").replace(/\.json$/, ".oslf.json"),
    );
  });
});

describe("read-aloud hints", () => {
  const hinted = {
    title: "Lenses",
    sections: [
      {
        name: "Telling Lights Apart",
        blocks: [
          {
            id: "t1",
            type: "text",
            content: markupToContent(
              "Augustin *[Fresnel]{ipa: freɪˈnɛl}* worked with the [WWF]{say: World Wide Fund}.{pause: long}Spell [REEF]{spell}{pause}now.",
            ),
          },
        ],
      },
    ],
  };

  it("writes pronunciations, substitutions, spell-outs and pauses as the format's runs", () => {
    const file = toOslf(hinted);
    expect(validate(file)).toBe(true);
    expect(file.sections[0].blocks[0].paragraphs).toEqual([
      [
        "Augustin ",
        { text: "Fresnel", italic: true, ipa: "freɪˈnɛl" },
        " worked with the ",
        { text: "WWF", alias: "World Wide Fund" },
        ".",
        { pause: "long" },
        "Spell ",
        { text: "REEF", sayAs: "characters" },
        { pause: "short" },
        "now.",
      ],
    ]);
  });

  it("reads them back as they were", () => {
    const back = fromOslf(toOslf(hinted));
    expect(back.sections[0].blocks[0].content).toEqual(
      hinted.sections[0].blocks[0].content,
    );
  });

  it("reads math working given as rich text as its words", () => {
    const back = fromOslf({
      oslf: OSLF_VERSION,
      title: "T",
      sections: [
        {
          blocks: [
            {
              type: "question",
              questionType: "math",
              prompt: "How many?",
              answers: ["12"],
              working: [
                "There are 60 seconds.",
                ["Then ", { text: "sixty", ipa: "ˈsɪksti" }, " over 5."],
              ],
            },
          ],
        },
      ],
    });
    expect(back.sections[0].blocks[0].steps).toEqual([
      "There are 60 seconds.",
      "Then sixty over 5.",
    ]);
  });
});
