// @vitest-environment happy-dom

// The editor words every finding itself (see lessonChecks.js), so a check added
// to core without a string in checks.json would show the panel a bare i18n key.
// These keep the two in step, and cover how often the checks rerun.

import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18next from "i18next";
import {
  markupToContent,
  withTextBlockContent,
} from "@spelling-creator/core/lessonText";
import { QUICK_FIX_CODES } from "@spelling-creator/core/lessonFixes";

// The source as text, through Vite: under happy-dom, import.meta.url isn't a
// file URL that node:fs can read.
import coreSource from "../../../../packages/core/src/lessonChecks.js?raw";
import checks from "../locales/en/checks.json";
import {
  CONTEXTS,
  checkLesson,
  describeFinding,
  useLessonChecks,
} from "./lessonChecks.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const codesInCore = [...new Set(coreSource.match(/"[EW]_[A-Z_]+"/g))].map(
  (quoted) => quoted.slice(1, -1),
);

// Whether checks.json can word `key`: as written, or through its plural forms.
const keys = new Set(Object.keys(checks.codes));
const hasWording = (key) => keys.has(key) || keys.has(`${key}_other`);

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
    // The base wording, which is what a finding falls back to whenever none of
    // its contexts apply, so a context variant alone is not enough.
    expect(codesInCore.filter((code) => !hasWording(code))).toEqual([]);
    // And one for every context CONTEXTS can pick.
    const contexts = Object.entries(CONTEXTS).flatMap(([code, rules]) =>
      Object.keys(rules).map((context) => `${code}_${context}`),
    );
    expect(contexts.filter((key) => !hasWording(key))).toEqual([]);
  });

  it("labels every quick fix, and only those", () => {
    expect(Object.keys(checks.quickFix).sort()).toEqual(
      [...QUICK_FIX_CODES].sort(),
    );
  });

  it("has no wording left over for a code core no longer reports", () => {
    const stale = [...keys].filter(
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

describe("useLessonChecks", () => {
  afterEach(() => vi.useRealTimers());

  it("reruns once editing pauses, and re-renders only when a finding changed", () => {
    vi.useFakeTimers();
    // Filled in from an effect, which runs once per commit: the count of
    // commits is the count of renders that reached the page.
    const seen = { commits: 0, checks: null };
    function Harness({ doc }) {
      const checks = useLessonChecks(doc);
      useEffect(() => {
        seen.commits += 1;
        seen.checks = checks;
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const render = (doc) =>
      act(() => root.render(createElement(Harness, { doc })));

    render(messy);
    act(() => vi.advanceTimersByTime(300));
    const first = seen.checks;
    expect(first.problems.length).toBeGreaterThan(0);

    // Three quick edits that change no finding: no rerun until they stop, and
    // then no new result, so nothing renders beyond the edits themselves.
    const before = seen.commits;
    const retitled = (title) => ({ ...messy, title });
    render(retitled("A"));
    act(() => vi.advanceTimersByTime(100));
    render(retitled("AB"));
    act(() => vi.advanceTimersByTime(100));
    render(retitled("ABC"));
    act(() => vi.advanceTimersByTime(300));
    expect(seen.commits - before).toBe(3);
    expect(seen.checks).toBe(first);

    // An edit that fixes something does come through.
    const fixed = structuredClone(messy);
    fixed.sections[0].blocks[2].words = [{ id: "w1", text: "meadow" }];
    render(fixed);
    act(() => vi.advanceTimersByTime(300));
    expect(seen.checks).not.toBe(first);
    expect(seen.checks.problems.length).toBeLessThan(first.problems.length);

    act(() => root.unmount());
  });
});
