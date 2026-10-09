import { describe, expect, it } from "vitest";

import {
  DocumentImportError,
  classifyLine,
  deriveQuestionType,
  importLessonText,
  previewLessonText,
  splitSections,
} from "./documentImport.js";

const PASSAGE_1 =
  "Every pet cat curled up on a sofa today is descended from a single wild species: the AFRICAN WILDCAT. This sandy-coloured hunter still roams the deserts, grasslands, and plains of North Africa and the Near East, and it looks so much like a tabby that the two can be hard to tell apart at a glance.";
const PASSAGE_2 =
  "The story of how this shy WILDCAT became a house cat began with farming. When people first stored harvests of grain, the great piles drew mice, birds, and insects in enormous numbers. The wildcats followed that easy prey into human VILLAGES, and the boldest simply chose to stay, which took about 10,000 years.";

// A hand-typed lesson: headings, a labelled spelling line, numbered questions
// with the answer in brackets.
const TYPED = `The History of Domestic Cats

The Wildcat Ancestor

${PASSAGE_1}

${PASSAGE_2}

Spelling words: FELINE, CREATURE, PROWLED, NATURAL

1. From which single wild species is every pet cat descended? (Answer: THE AFRICAN WILDCAT)
2. Cats had joined human settlements almost ___ years ago. (Answer: 10000)
3. The great piles drew ______ in enormous numbers. Name one creature the piles attracted. (Answer: MICE; BIRDS; INSECTS)
4. What class of warm-blooded animals does a cat belong to? (Answer: A MAMMAL)
5. Name a wild animal that hunts.
6. Would you rather hunt by night or by day?
7. In your own words, explain how storing grain led wildcats to live near people.

Worshipped in Egypt

In ancient Egypt the cat rose from useful hunter to sacred animal, and the goddess BASTET was shown with a cat's head. Families mourned a cat's death by shaving their eyebrows, and a dead cat was carried to the city of Bubastis to be buried.

Spelling words: PHARAOH, DIVINE, REVERED, BLESSED

1. What was the name of the Egyptian goddess shown as a cat? (Answer: BASTET)
2. Name a country you would like to visit.

VAKT: Stretch like a cat waking up.
`;

// The same lesson the way this app's Word export reads back: no headings,
// "Spell:" with gaps, answers after a gap, working-out as numbered lines.
const EXPORTED = `The History of Domestic Cats
By Admin
${PASSAGE_1}
${PASSAGE_2}
Spell: FELINE   CREATURE   PROWLED   NATURAL
From which single wild species is every pet cat descended?   THE AFRICAN WILDCAT
Suppose one wildcat caught 8 small animals a week. Roughly how many in a year of 52 weeks?   400
1. Multiply the weekly catch by the number of weeks: 8 × 52
2. Round to the nearest hundred: about 400
The great piles drew ______ in enormous numbers. Name one creature the piles attracted.   MICE   BIRDS   INSECTS
Name a wild animal that hunts.
Would you rather hunt by night or by day?
In ancient Egypt the cat rose from useful hunter to sacred animal, and the goddess BASTET was shown with a cat's head. Families mourned a cat's death by shaving their eyebrows, and a dead cat was carried to the city of Bubastis to be buried.
Spell: PHARAOH   DIVINE   REVERED   BLESSED
What was the name of the Egyptian goddess shown as a cat?   BASTET
Sources
Wikipedia, Cat. https://en.wikipedia.org/wiki/Cat
`;

describe("classifyLine", () => {
  it("tells the kinds of line apart", () => {
    expect(classifyLine("Spelling words: A, B")).toBe("spelling");
    expect(classifyLine("Spell: A   B")).toBe("spelling");
    expect(classifyLine("Working out: 1. x 2. y")).toBe("steps");
    expect(classifyLine("The Wildcat Ancestor")).toBe("heading");
    expect(classifyLine("1. What is it? (Answer: X)")).toBe("question");
    expect(classifyLine("Name a wild animal that hunts.")).toBe("question");
    expect(
      classifyLine("Should we judge the past? Explain your thinking."),
    ).toBe("question");
    expect(classifyLine(PASSAGE_1)).toBe("prose");
    expect(classifyLine("https://example.com/source")).toBe("source");
  });
});

describe("splitSections", () => {
  it("finds the sections of a typed document by structure", () => {
    const { title, sections } = splitSections(TYPED);
    expect(title).toBe("The History of Domestic Cats");
    expect(sections.map((s) => s.heading)).toEqual([
      "The Wildcat Ancestor",
      "Worshipped in Egypt",
    ]);
  });

  it("finds them with no headings at all and drops the sources", () => {
    const { sections } = splitSections(EXPORTED);
    expect(sections).toHaveLength(2);
    expect(sections[1].lines.some((l) => l.startsWith("Sources"))).toBe(false);
    expect(sections[1].lines.some((l) => l.includes("wikipedia"))).toBe(false);
  });
});

describe("importLessonText", () => {
  it("rebuilds a typed lesson, with the type derived per question", () => {
    const doc = importLessonText(TYPED);
    expect(doc.title).toBe("The History of Domestic Cats");
    expect(doc.sections).toHaveLength(2);
    const [first, second] = doc.sections;
    expect(first.name).toBe("The Wildcat Ancestor");
    expect(first.blocks.map((b) => b.type)).toEqual([
      "text",
      "text",
      "spelling",
      ...Array(7).fill("question"),
    ]);
    expect(first.blocks[2].words.map((w) => w.text)).toEqual([
      "FELINE",
      "CREATURE",
      "PROWLED",
      "NATURAL",
    ]);
    const questions = first.blocks.filter((b) => b.type === "question");
    expect(questions.map((q) => q.questionType)).toEqual([
      "single",
      "number",
      "multiple",
      "background",
      "open",
      "wyr",
      "paraphrase",
    ]);
    expect(questions[0].prompt).toBe(
      "From which single wild species is every pet cat descended?",
    );
    expect(questions[0].answer).toBe("THE AFRICAN WILDCAT");
    expect(questions[1].answer).toBe("10000");
    expect(questions[2].answers.map((a) => a.text)).toEqual([
      "MICE",
      "BIRDS",
      "INSECTS",
    ]);
    expect(questions[4].prompt).toBe("Name a wild animal that hunts.");
    expect(second.name).toBe("Worshipped in Egypt");
    expect(second.blocks.filter((b) => b.type === "question")).toHaveLength(2);
    expect(second.blocks.at(-1)).toMatchObject({
      type: "vakt",
      text: "Stretch like a cat waking up.",
    });
  });

  it("reads this app's own export as plain text, working-out included", () => {
    const doc = importLessonText(EXPORTED);
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0].name).toBe("Section 1");
    const questions = doc.sections[0].blocks.filter(
      (b) => b.type === "question",
    );
    expect(questions.map((q) => q.questionType)).toEqual([
      "single",
      "number",
      "multiple",
      "open",
      "wyr",
    ]);
    expect(questions[1].answer).toBe("400");
    expect(questions[1].steps.map((s) => s.text)).toEqual([
      "Multiply the weekly catch by the number of weeks: 8 × 52",
      "Round to the nearest hundred: about 400",
    ]);
    expect(doc.sections[0].blocks[2].words).toHaveLength(4);
  });

  it("reads an answer on its own line, in brackets, and as bare capitals", () => {
    const doc = importLessonText(`Title

${PASSAGE_2}

Words: ONE TWO

Q: What did people store?
A: harvests of grain
* What followed the prey into villages? [the wildcats]
What did the boldest cats do. STAYED
`);
    const questions = doc.sections[0].blocks.filter(
      (b) => b.type === "question",
    );
    expect(questions.map((q) => q.answer)).toEqual([
      "harvests of grain",
      "the wildcats",
      "STAYED",
    ]);
    expect(questions.map((q) => q.questionType)).toEqual([
      "single",
      "single",
      "background",
    ]);
  });

  it("refuses text with no passage and questions in it", () => {
    expect(() => importLessonText("Just a title\n\nAnd a line.")).toThrow(
      DocumentImportError,
    );
    expect(() => importLessonText("")).toThrow(DocumentImportError);
  });

  it("reads a long exported question as a question, and a stray no-break space as nothing", () => {
    const gap = "   ";
    const long = `The great piles drew mice, birds, insects and many other small creatures from the fields, the marshes and the riverbanks in enormous numbers, and the wildcats followed that easy prey into the farming villages and stayed there. Name every kind of creature the piles attracted.${gap}MICE${gap}BIRDS${gap}INSECTS`;
    expect(long.length).toBeGreaterThan(280);
    expect(classifyLine(long)).toBe("question");
    const prose = PASSAGE_1.replace("10,000", "10 000");
    expect(classifyLine(`${prose} ${PASSAGE_2}`)).toBe("prose");

    const doc = importLessonText(`Title\n${PASSAGE_1}\n${long}`);
    const [question] = doc.sections[0].blocks.filter(
      (b) => b.type === "question",
    );
    expect(question.answers.map((a) => a.text)).toEqual([
      "MICE",
      "BIRDS",
      "INSECTS",
    ]);
  });

  it("attaches an Answer: line to the question above it", () => {
    const doc = importLessonText(`Title

${PASSAGE_2}

Words: ONE TWO

1. What did people store?
Answer: harvests of grain
2. What followed the prey into villages?
Answers: the wildcats; the boldest cats`);
    const questions = doc.sections[0].blocks.filter(
      (b) => b.type === "question",
    );
    expect(questions).toHaveLength(2);
    expect(questions[0].answer).toBe("harvests of grain");
    expect(questions[1].answers.map((a) => a.text)).toEqual([
      "the wildcats",
      "the boldest cats",
    ]);
  });

  it("keeps the opening paragraph of a lesson pasted without a title", () => {
    const { title, sections } = splitSections(
      `${PASSAGE_1}\n\n${PASSAGE_2}\n\n1. What drew the wildcats? (Answer: PREY)`,
    );
    expect(title).toBe("");
    expect(sections[0].lines.slice(0, 2)).toEqual([PASSAGE_1, PASSAGE_2]);
    expect(importLessonText(`${PASSAGE_1}\n1. Why? (Answer: X)`).title).toBe(
      "Imported lesson",
    );
  });
});

describe("deriveQuestionType", () => {
  const passage = "The crust, the mantle, and the core. It is 30 km deep.";
  it("uses the wording for the answerless types", () => {
    expect(
      deriveQuestionType(
        { prompt: "Would you rather x or y?", answers: [] },
        passage,
      ),
    ).toBe("wyr");
    expect(
      deriveQuestionType(
        { prompt: "In your own words, explain it.", answers: [] },
        passage,
      ),
    ).toBe("paraphrase");
    expect(
      deriveQuestionType(
        { prompt: "Name something hot.", answers: [] },
        passage,
      ),
    ).toBe("open");
  });
  it("uses the answers for the rest", () => {
    expect(
      deriveQuestionType({ prompt: "How deep?", answers: ["30"] }, passage),
    ).toBe("number");
    expect(
      deriveQuestionType(
        { prompt: "Name a layer.", answers: ["CRUST", "MANTLE", "CORE"] },
        passage,
      ),
    ).toBe("multiple");
    expect(
      deriveQuestionType(
        { prompt: "Name a layer.", answers: ["CRUST", "SKY"] },
        passage,
      ),
    ).toBe("multiple_open");
    expect(
      deriveQuestionType(
        { prompt: "What is the middle layer?", answers: ["THE MANTLE"] },
        passage,
      ),
    ).toBe("single");
    expect(
      deriveQuestionType(
        { prompt: "What pulls things down?", answers: ["GRAVITY"] },
        passage,
      ),
    ).toBe("background");
  });
});

describe("previewLessonText", () => {
  it("counts what an import would produce", () => {
    const preview = previewLessonText(TYPED);
    expect(preview.title).toBe("The History of Domestic Cats");
    expect(preview.sections).toEqual([
      {
        name: "The Wildcat Ancestor",
        paragraphs: 2,
        spellingWords: 4,
        questions: 7,
        answered: 4,
      },
      {
        name: "Worshipped in Egypt",
        paragraphs: 1,
        spellingWords: 4,
        questions: 2,
        answered: 1,
      },
    ]);
  });
});
