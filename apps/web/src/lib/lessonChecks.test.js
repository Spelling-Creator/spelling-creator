// The editor words every finding itself (see lessonChecks.js), so a check added
// to core without a string in checks.json would show the panel a bare i18n key.
// These keep the two in step.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import i18next from "i18next";
import {
  markupToContent,
  withTextBlockContent,
} from "@spelling-creator/core/lessonText";

import checks from "../locales/en/checks.json";
import { checkLesson, describeFinding } from "./lessonChecks.js";

const coreSource = readFileSync(
  new URL("../../../../packages/core/src/lessonChecks.js", import.meta.url),
  "utf8",
);
const codesInCore = [...new Set(coreSource.match(/"[EW]_[A-Z_]+"/g))].map(
  (quoted) => quoted.slice(1, -1),
);

const t = await (async () => {
  const instance = i18next.createInstance();
  await instance.init({
    lng: "en",
    resources: { en: { checks } },
    ns: ["checks"],
    defaultNS: "checks",
    interpolation: { escapeValue: false },
  });
  return instance.getFixedT("en", "checks");
})();

const text = (id, markup) =>
  withTextBlockContent({ id, type: "text" }, markupToContent(markup));
const question = (id, questionType, fields) => ({
  id,
  type: "question",
  questionType,
  ...fields,
});

// A lesson with something wrong in most places, including each of the codes
// that has more than one wording.
const messy = {
  title: "Messy",
  sources: [],
  sections: [
    {
      id: "s1",
      name: "Rivers",
      blocks: [
        { id: "v1", type: "vakt", text: "Stretch." },
        text(
          "t1",
          "A river carries **gravel and stones down to the sea** past DELTA towns. " +
            "It drops boulder, cobble, and silt. ^[@nowhere]",
        ),
        {
          id: "sp1",
          type: "spelling",
          words: [
            { id: "w1", text: "ash" },
            { id: "w2", text: "ash" },
          ],
        },
        question("q1", "single", { prompt: "Name a delta.", answer: "delta" }),
        question("q2", "single", {
          prompt: "What do delta towns sit by?",
          answer: "delta towns",
        }),
        question("q3", "multiple", {
          prompt: "Name one.",
          answers: [{ id: "a1", text: "boulder" }],
        }),
        question("q4", "multiple_open", { prompt: "Give a synonym." }),
        question("q5", "wyr", { prompt: "A or B or C or D?" }),
        question("q6", "background", { prompt: "Where?", answer: "sea" }),
      ],
    },
  ],
};

describe("lesson checks in the editor", () => {
  it("has wording for every code core can report", () => {
    expect(codesInCore.length).toBeGreaterThan(30);
    const keys = Object.keys(checks.codes);
    const missing = codesInCore.filter(
      (code) => !keys.some((key) => key === code || key.startsWith(`${code}_`)),
    );
    expect(missing).toEqual([]);
  });

  it("has no wording left over for a code core no longer reports", () => {
    const stale = Object.keys(checks.codes).filter(
      (key) =>
        !codesInCore.some((code) => key === code || key.startsWith(`${code}_`)),
    );
    expect(stale).toEqual([]);
  });

  it("words every finding without leaving a placeholder or a bare key", () => {
    const { problems, suggestions } = checkLesson(messy);
    const all = [...problems, ...suggestions];
    expect(all.length).toBeGreaterThan(10);
    for (const finding of all) {
      const words = describeFinding(t, finding, "en");
      expect(words, finding.code).not.toMatch(/\{\{|codes\.|undefined/);
    }
  });

  it("picks the right wording for codes with more than one", () => {
    const { problems, suggestions } = checkLesson(messy);
    const wording = (code) =>
      [...problems, ...suggestions]
        .filter((f) => f.code === code)
        .map((f) => describeFinding(t, f, "en"));
    expect(wording("E_SPELLING_DUPLICATE")).toContain('"ash" is listed twice.');
    expect(wording("E_FORMAT_LONG_EMPHASIS")[0]).toMatch(/is bold across/);
    expect(wording("W_ORANGE_ANSWER_COUNT").join(" ")).toMatch(
      /no suggested answers/,
    );
    expect(wording("W_WYR_SHAPE")[0]).toMatch(/strings together 3 uses/);
    expect(wording("E_ANSWER_WORD_REUSED").join(" ")).toMatch(
      /turns up inside "delta towns", the answer to question 2\./,
    );
  });

  it("counts problems and suggestions per section", () => {
    const { problems, suggestions, bySection } = checkLesson(messy);
    const inSection = (list) => list.filter((f) => f.sectionId === "s1");
    expect(bySection.get("s1")).toEqual({
      problems: inSection(problems).length,
      suggestions: inSection(suggestions).length,
    });
  });

  it("has nothing to say about an empty lesson", () => {
    const { problems, suggestions } = checkLesson({ title: "", sections: [] });
    expect(problems).toEqual([]);
    expect(suggestions).toEqual([]);
  });
});
