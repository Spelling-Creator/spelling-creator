// Covers the parts of the question model the printed lesson leans on: the
// inline answer text, the footer legend, and the Word style names the DOCX
// round trip uses to recover a question's type now that nothing in the visible
// text names it.

import { describe, expect, it } from "vitest";

import {
  ANSWER_GAP,
  QUESTION_LEGEND,
  QUESTION_TAG_PREFIX,
  readQuestionTag,
  QUESTION_TYPES,
  QUESTION_TYPE_LIST,
  QUESTION_TYPE_MENU,
  besidesAnswers,
  createQuestionBlock,
  isThreeBoard,
  questionAnswerItems,
  questionAnswerPlain,
  questionAnswerText,
  questionBesides,
  resolveOpenType,
  questionLegendFor,
  questionLegendText,
  questionMeta,
  questionStyleClass,
  questionStyleMap,
  questionStyleName,
  type QuestionFields,
} from "./questions.ts";
import { normalizeLessonFile } from "./jsonImport.ts";

let counter = 0;
const newId = () => `id-${(counter += 1)}`;

describe("questionAnswerText", () => {
  it("returns the stored answer for the single-answer types", () => {
    for (const type of ["single", "background"]) {
      expect(
        questionAnswerText({ questionType: type, answer: "FLOODING" }),
      ).toBe("FLOODING");
    }
    expect(
      questionAnswerText({
        questionType: "number",
        answer: "1928 - 1902 = 26",
      }),
    ).toBe("1928 - 1902 = 26");
  });

  it("joins several accepted answers with the printed gap", () => {
    expect(
      questionAnswerText({
        questionType: "multiple",
        answers: [{ text: "NEVADA" }, { text: " ARIZONA " }, { text: "" }],
      }),
    ).toBe(`NEVADA${ANSWER_GAP}ARIZONA`);
  });

  it("prints a multiple_open question's suggestions like any other answers", () => {
    // On paper the two semi-open types read the same; what marks the loose one
    // is the italic prompt above the answers, not the answers themselves.
    expect(
      questionAnswerText({
        questionType: "multiple_open",
        answers: [{ text: "THANKS" }, { text: "APPRECIATION" }],
      }),
    ).toBe(`THANKS${ANSWER_GAP}APPRECIATION`);
  });

  it("gives the free-response types nothing to print after the prompt", () => {
    expect(questionAnswerText({ questionType: "open" })).toBe("");
    expect(questionAnswerText({ questionType: "broad_open" })).toBe("");
    expect(questionAnswerText({ questionType: "paraphrase" })).toBe("");
    expect(questionAnswerText({ questionType: "wyr" })).toBe("");
  });

  // A tight open has no key. Its examples, when it has any, print after
  // "e.g." so whoever is scoring reads them as examples.
  it("prints a tight open's examples after e.g., and nothing without them", () => {
    expect(questionAnswerText({ questionType: "tight_open" })).toBe("");
    expect(
      questionAnswerText({
        questionType: "tight_open",
        answers: [{ text: "WINDOW" }, { text: "BOTTLE" }],
      }),
    ).toBe(`e.g. WINDOW${ANSWER_GAP}BOTTLE`);
  });

  // A lesson saved before tight and broad opens were separate carries `open`,
  // which is never rewritten on load; its wording decides which kind the
  // checks and the file export read it as.
  it("sorts a legacy open question by its wording", () => {
    const open = (prompt: string) => ({ questionType: "open", prompt });
    expect(resolveOpenType(open("Name something found in a kitchen."))).toBe(
      "tight_open",
    );
    expect(resolveOpenType(open("Give a synonym for praise."))).toBe(
      "tight_open",
    );
    // A tight stem wins over a broad word further along the prompt.
    expect(
      resolveOpenType(open("Name something you should bring camping.")),
    ).toBe("tight_open");
    expect(
      resolveOpenType(open("Why do you think the dam was built there?")),
    ).toBe("broad_open");
    expect(resolveOpenType(open("Explain why you think so."))).toBe(
      "broad_open",
    );
    expect(
      resolveOpenType(
        open("What would life in the Southwest look like today without it?"),
      ),
    ).toBe("broad_open");
    // Explicit types pass through untouched.
    expect(
      resolveOpenType({ questionType: "broad_open", prompt: "Name a cat." }),
    ).toBe("broad_open");
    expect(resolveOpenType({ questionType: "single" })).toBe("single");
  });

  // A retelling of the passage is the paraphrase, which the old lessons asked
  // as `open` too, unless the prompt opens with a tight stem.
  it("reads a legacy open as the paraphrase when it asks for a retelling", () => {
    const open = (prompt: string) => ({ questionType: "open", prompt });
    expect(resolveOpenType(open("In your own words, explain why."))).toBe(
      "paraphrase",
    );
    expect(resolveOpenType(open("Summarize how the canyon formed."))).toBe(
      "paraphrase",
    );
    expect(
      resolveOpenType(open("Give one word to summarize the passage.")),
    ).toBe("tight_open");
    // Asking for the speller's own view is an opinion, whatever the stem.
    expect(
      resolveOpenType(
        open("In your own words, explain why you prefer rivers."),
      ),
    ).toBe("broad_open");
    expect(
      resolveOpenType(open("Summarize what you think the builders wanted.")),
    ).toBe("broad_open");
    expect(
      resolveOpenType({
        questionType: "broad_open",
        prompt: "In your own words, explain why.",
      }),
    ).toBe("broad_open");
  });

  it("prints nothing for an unanswered question", () => {
    expect(questionAnswerText({ questionType: "single", answer: "" })).toBe("");
    expect(questionAnswerText({ questionType: "multiple", answers: [] })).toBe(
      "",
    );
    expect(questionAnswerText(null)).toBe("");
  });

  it("separates answers with a gap HTML will not collapse", () => {
    // The PDF renders the docx as HTML, which folds a run of ordinary spaces
    // down to one; the non-breaking space is what survives that.
    expect(ANSWER_GAP).toContain(" ");
  });
});

// A Besides line names one accepted answer and asks for another. Both halves
// come from the answer list, so a name the list no longer has means no line.
describe("questionAnswerPlain", () => {
  const richAnswer = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "1884 or " },
          { type: "math", attrs: { format: "asciimath", source: "3/4" } },
        ],
      },
    ],
  };

  it("reads a string, a number and nothing", () => {
    expect(questionAnswerPlain("BASTET")).toBe("BASTET");
    expect(questionAnswerPlain(1884)).toBe("1884");
    expect(questionAnswerPlain(null)).toBe("");
    expect(questionAnswerPlain(undefined)).toBe("");
  });

  it("reads an answer stored in the inline-text shape as its words", () => {
    expect(questionAnswerPlain(richAnswer)).toBe("1884 or 3/4");
    expect(
      questionAnswerItems({ questionType: "number", answer: richAnswer }),
    ).toEqual(["1884 or 3/4"]);
    expect(questionAnswerItems({ questionType: "single", answer: {} })).toEqual(
      [],
    );
  });

  it("is what the importer stores for such an answer", () => {
    const file = normalizeLessonFile({
      title: "T",
      sections: [
        {
          id: "s1",
          name: "S",
          blocks: [
            {
              id: "q",
              type: "question",
              questionType: "number",
              prompt: "How tall?",
              answer: richAnswer,
            },
            {
              id: "k",
              type: "question",
              questionType: "single",
              prompt: "Who?",
              answer: richAnswer,
            },
          ],
        },
      ],
    });
    expect(
      file.sections[0].blocks.map((b: { answer?: unknown }) => b.answer),
    ).toEqual(["1884 or 3/4", "1884 or 3/4"]);
  });
});

describe("three-board questions", () => {
  const block = (fields: QuestionFields) => ({
    questionType: "multiple",
    answers: [{ text: "ROCKS" }, { text: "REEFS" }, { text: "SANDBARS" }],
    ...fields,
  });

  it("marks only a multiple question as three-board", () => {
    expect(isThreeBoard(block({ threeBoard: true }))).toBe(true);
    expect(isThreeBoard(block({}))).toBe(false);
    expect(
      isThreeBoard({
        ...block({ threeBoard: true }),
        questionType: "multiple_open",
      }),
    ).toBe(false);
  });

  it("names the Besides answer as the list spells it, and the rest as what is asked for", () => {
    const b = block({ besides: "rocks" });
    expect(questionBesides(b)).toBe("ROCKS");
    expect(besidesAnswers(b)).toEqual(["REEFS", "SANDBARS"]);
  });

  it("has no Besides line when the named answer left the list, or on another type", () => {
    expect(questionBesides(block({ besides: "GRAVEL" }))).toBeNull();
    expect(besidesAnswers(block({ besides: "GRAVEL" }))).toEqual([]);
    expect(questionBesides(block({}))).toBeNull();
    expect(
      questionBesides({
        ...block({ besides: "ROCKS" }),
        questionType: "multiple_open",
      }),
    ).toBeNull();
  });
});

describe("paraphrase questions", () => {
  it("is a type of its own, in its own colour", () => {
    expect(QUESTION_TYPES.paraphrase.color).not.toBe(
      QUESTION_TYPES.multiple.color,
    );
    expect(QUESTION_TYPES.paraphrase.color).not.toBe(QUESTION_TYPES.open.color);
  });

  it("builds with no answer field, like an open question", () => {
    expect(createQuestionBlock(newId, "paraphrase")).toEqual({
      id: expect.any(String),
      type: "question",
      questionType: "paraphrase",
      prompt: "",
    });
  });

  it("survives a lesson-file import", () => {
    const doc = normalizeLessonFile({
      title: "T",
      sections: [
        {
          name: "S",
          blocks: [
            {
              type: "question",
              questionType: "paraphrase",
              prompt: "In your own words, explain why.",
            },
          ],
        },
      ],
    });
    expect(doc.sections[0].blocks).toHaveLength(1);
    expect(doc.sections[0].blocks[0].questionType).toBe("paraphrase");
  });
});

describe("W.Y.R. questions", () => {
  it("is a type of its own, in its own colour", () => {
    expect(QUESTION_TYPES.wyr.color).not.toBe(QUESTION_TYPES.number.color);
    expect(QUESTION_TYPES.wyr.color).not.toBe(QUESTION_TYPES.open.color);
  });

  it("abbreviates its legend entry, and only its own", () => {
    // "WOULD YOU RATHER" would crowd an eight-entry footer line, so the legend
    // prints the short form the source lessons use. Each entry opens with the
    // type's tag, since the legend is where a reader looks the tag up.
    expect(questionLegendText(QUESTION_TYPES.wyr)).toBe("WYR W.Y.R.");
    expect(questionLegendText(QUESTION_TYPES.open)).toBe("O OPEN ENDED");
  });

  it("builds with no answer field, like an open question", () => {
    expect(createQuestionBlock(newId, "wyr")).toEqual({
      id: expect.any(String),
      type: "question",
      questionType: "wyr",
      prompt: "",
    });
  });

  it("survives a lesson-file import", () => {
    const doc = normalizeLessonFile({
      title: "T",
      sections: [
        {
          name: "S",
          blocks: [
            {
              type: "question",
              questionType: "wyr",
              prompt: "Would you rather watch an opera or a movie?",
            },
          ],
        },
      ],
    });
    expect(doc.sections[0].blocks).toHaveLength(1);
    expect(doc.sections[0].blocks[0].questionType).toBe("wyr");
  });
});

describe("the footer legend", () => {
  it("names every question type exactly once", () => {
    expect(QUESTION_LEGEND).toHaveLength(QUESTION_TYPE_LIST.length);
    expect(new Set(QUESTION_LEGEND.map((q) => q.key)).size).toBe(
      QUESTION_TYPE_LIST.length,
    );
  });

  // Two types that look identical on the page are two types a reader cannot
  // tell apart. The marking is the tag, the colour and the italic together:
  // `multiple` and `multiple_open` deliberately share the amber and the SO
  // tag, and the italic is the whole of what separates an exhaustive answer
  // key from an advisory one on paper; the three open types share the pink,
  // and their tags (TO, BO, O) are what tell them apart.
  it("gives every type a marking no other type has", () => {
    const markings = QUESTION_TYPE_LIST.map(
      (q) => `${q.tag}|${q.color}|${q.italic ? "italic" : "upright"}`,
    );
    expect(new Set(markings).size).toBe(markings.length);
  });

  it("keeps the legacy open type out of the menus but in the legend", () => {
    expect(QUESTION_TYPES.open.legacy).toBe(true);
    expect(QUESTION_TYPE_MENU.map((q) => q.key)).not.toContain("open");
    expect(QUESTION_TYPE_MENU.map((q) => q.key)).toEqual(
      expect.arrayContaining(["tight_open", "broad_open"]),
    );
    expect(QUESTION_LEGEND.map((q) => q.key)).toContain("open");
  });

  it("sets the one type that shares a colour in italic", () => {
    expect(QUESTION_TYPES.multiple_open.color).toBe(
      QUESTION_TYPES.multiple.color,
    );
    expect(QUESTION_TYPES.multiple_open.italic).toBe(true);
    expect(QUESTION_TYPES.multiple.italic).toBeUndefined();
  });

  // The printed legend explains the colours on the page, so it lists the types
  // the lesson asks and nothing else, in the legend's own order rather than the
  // order the lesson happened to ask them in.
  it("lists only the types a lesson uses, in legend order", () => {
    const question = (questionType: string) => ({
      type: "question",
      questionType,
    });
    const doc = {
      sections: [
        { blocks: [question("open"), { type: "text", text: "" }] },
        { blocks: [question("single"), question("open"), question("wyr")] },
      ],
    };
    expect(questionLegendFor(doc).map((q) => q.key)).toEqual([
      "single",
      "wyr",
      "open",
    ]);
  });

  it("names the colour an unknown type was printed in", () => {
    const doc = {
      sections: [{ blocks: [{ type: "question", questionType: "mystery" }] }],
    };
    expect(questionLegendFor(doc).map((q) => q.key)).toEqual(["open"]);
  });

  it("is empty for a lesson with no questions", () => {
    expect(questionLegendFor({ sections: [{ blocks: [] }] })).toEqual([]);
    expect(questionLegendFor(undefined)).toEqual([]);
  });
});

// The tag is the marking that has to work when the colour doesn't: on a grey
// photocopy, or for a reader who can't tell the colours apart.
describe("the type tags", () => {
  it("gives every type a short tag", () => {
    for (const type of QUESTION_TYPE_LIST) {
      expect(type.tag).toMatch(/^[A-Z]{1,3}$/);
    }
  });

  // The two semi-open types are one family on paper and share the tag; the
  // italic separates them. Every other tag belongs to one type alone.
  it("shares a tag only between the two semi-open types", () => {
    const byTag = new Map();
    for (const type of QUESTION_TYPE_LIST) {
      byTag.set(type.tag, [...(byTag.get(type.tag) || []), type.key]);
    }
    for (const [tag, keys] of byTag) {
      if (tag === QUESTION_TYPES.multiple.tag) {
        expect(keys.sort()).toEqual(["multiple", "multiple_open"]);
      } else {
        expect(keys).toHaveLength(1);
      }
    }
  });

  it("recognises a printed tag at the start of a line, case-sensitively", () => {
    expect("K Name the island.".replace(QUESTION_TAG_PREFIX, "")).toBe(
      "Name the island.",
    );
    expect("WYR Would you rather...".replace(QUESTION_TAG_PREFIX, "")).toBe(
      "Would you rather...",
    );
    expect("So the fire was lit.".replace(QUESTION_TAG_PREFIX, "")).toBe(
      "So the fire was lit.",
    );
    expect("K".replace(QUESTION_TAG_PREFIX, "")).toBe("K");
  });

  it("takes the three-board mark off with the tag and keeps it on the side", () => {
    expect(readQuestionTag("SO (3B)  Ships avoided ______. Name one.")).toEqual(
      { text: "Ships avoided ______. Name one.", threeBoard: true },
    );
    expect(readQuestionTag("SO  Ships avoided ______.")).toEqual({
      text: "Ships avoided ______.",
      threeBoard: false,
    });
    expect(readQuestionTag("Ships avoided (3B) rocks.")).toEqual({
      text: "Ships avoided (3B) rocks.",
      threeBoard: false,
    });
  });
});

describe("the Word styles the DOCX round trip rides on", () => {
  it("maps every type onto its own class", () => {
    const classes = QUESTION_TYPE_LIST.map((q) => questionStyleClass(q.key));
    expect(new Set(classes).size).toBe(classes.length);
  });

  it("emits a mammoth rule per type naming its style and class, plus one per old name", () => {
    const map = questionStyleMap();
    const aliases = QUESTION_TYPE_LIST.flatMap((q) => q.styleAliases || []);
    expect(map).toHaveLength(QUESTION_TYPE_LIST.length + aliases.length);
    for (const type of QUESTION_TYPE_LIST) {
      expect(map).toContainEqual(
        expect.stringContaining(questionStyleClass(type.key)),
      );
      expect(map).toContainEqual(expect.stringContaining(type.label));
    }
  });

  // A Word style is matched by name, and the name carries the label. Four
  // labels changed when the app took the format's names, so a document
  // exported under an old name has to map onto the same class or it imports
  // as plain text.
  it("still maps the style names exported under the old labels", () => {
    const map = questionStyleMap();
    expect(map).toContain(
      "r[style-name='S2C Question Single answer'] => span.s2c-q-single",
    );
    expect(map).toContain(
      "r[style-name='S2C Question Number answer'] => span.s2c-q-number",
    );
    expect(map).toContain(
      "r[style-name='S2C Question Multiple answers'] => span.s2c-q-multiple",
    );
    expect(map).toContain(
      "r[style-name='S2C Question Background knowledge'] => span.s2c-q-background",
    );
    // And a new export writes only the current name.
    expect(questionStyleName("single")).toBe("S2C Question Known");
  });
});

describe("questionMeta", () => {
  it("falls back to open for a type it doesn't know", () => {
    expect(questionMeta("nonsense")).toBe(QUESTION_TYPES.open);
  });
});
