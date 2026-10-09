import { describe, expect, it } from "vitest";

import {
  QUESTION_TYPE_KEYS,
  SCHEMA,
  parseModelJson,
  parseModelReply,
  sectionMessages,
  sectionPromptText,
  systemPrompt,
} from "./documentImportModel.js";
import { lessonFromSections } from "./documentImport.js";

describe("the prompt", () => {
  it("lists the types in the order the model was trained on", () => {
    expect(
      JSON.parse(SCHEMA).properties.questions.items.properties.type.enum,
    ).toEqual(QUESTION_TYPE_KEYS);
    expect(QUESTION_TYPE_KEYS[0]).toBe("single");
  });

  it("lays a section out with its heading on top and blank lines between", () => {
    expect(sectionPromptText({ heading: "Cats", lines: ["a", "b"] })).toBe(
      "Cats\n\na\n\nb",
    );
    expect(sectionPromptText({ heading: "", lines: ["a", "b"] })).toBe(
      "a\n\nb",
    );
  });

  it("puts the schema in the system turn and the section in the user turn", () => {
    const [system, user] = sectionMessages({ heading: "", lines: ["x"] });
    expect(system).toEqual({ role: "system", content: systemPrompt() });
    expect(system.content.startsWith("Return data as a JSON object")).toBe(
      true,
    );
    expect(user).toEqual({ role: "user", content: "x" });
  });
});

describe("parseModelJson", () => {
  it("reads a clean reply and one in a code fence", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("closes a reply cut off mid-way and keeps what was finished", () => {
    const cut =
      '{"name":"","paragraphs":["one","two"],"spellingWords":["A"],"questions":[{"prompt":"Q1?","type":"single","answers":["X"]},{"prompt":"Q2';
    const json = parseModelJson(cut);
    expect(json.paragraphs).toEqual(["one", "two"]);
    expect(json.questions[0].prompt).toBe("Q1?");
  });

  it("gives null when there is no object at all", () => {
    expect(parseModelJson("no json here")).toBeNull();
  });
});

describe("parseModelReply", () => {
  it("maps drifted keys back and keeps a real type", () => {
    const reply = JSON.stringify({
      section_title: "Cats",
      paragraph: "The passage.",
      spelling_words: ["ONE", "TWO"],
      questions: [
        { question: "What?", kind: "single", answer: "IT" },
        { prompt: "Name a cat.", type: "animal", answers: [] },
        { prompt: "", type: "open", answers: [] },
      ],
    });
    expect(parseModelReply(reply)).toEqual({
      name: "Cats",
      paragraphs: ["The passage."],
      spellingWords: ["ONE", "TWO"],
      questions: [
        { prompt: "What?", type: "single", answers: ["IT"], steps: [] },
        { prompt: "Name a cat.", type: "", answers: [], steps: [] },
      ],
      vakt: [],
    });
  });

  it("turns objects where strings were asked for into their text", () => {
    const reply = JSON.stringify({
      name: "",
      paragraphs: [{ text: "P" }],
      spellingWords: [],
      questions: [{ prompt: "Q?", type: "single", answers: [{ text: "A" }] }],
    });
    expect(parseModelReply(reply).paragraphs).toEqual(["P"]);
    expect(parseModelReply(reply).questions[0].answers).toEqual(["A"]);
  });

  it("is null for an empty section", () => {
    expect(
      parseModelReply(
        '{"name":"","paragraphs":[],"spellingWords":[],"questions":[]}',
      ),
    ).toBeNull();
  });
});

describe("lessonFromSections with model output", () => {
  it("keeps the model's type and derives one where it gave none", () => {
    const doc = lessonFromSections("T", [
      {
        name: "S",
        paragraphs: ["The crust and the mantle."],
        spellingWords: ["WORD"],
        questions: [
          {
            prompt: "Which layer?",
            type: "background",
            answers: ["THE CRUST"],
            steps: [],
          },
          {
            prompt: "Which layer?",
            type: "",
            answers: ["THE CRUST"],
            steps: [],
          },
        ],
      },
    ]);
    const questions = doc.sections[0].blocks.filter(
      (b) => b.type === "question",
    );
    expect(questions.map((q) => q.questionType)).toEqual([
      "background",
      "single",
    ]);
  });
});
