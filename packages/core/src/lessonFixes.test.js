// Each quick fix, run against a lesson with its finding: the finding has to be
// gone afterwards, nothing else in the lesson may change, and a fix with
// nothing left to do says so with null.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateLesson } from "./lessonChecks.js";
import { QUICK_FIX_CODES, applyQuickFix, hasQuickFix } from "./lessonFixes.js";
import {
  markupToContent,
  textBlockMarkup,
  withTextBlockContent,
} from "./lessonText.js";

const text = (id, markup) =>
  withTextBlockContent({ id, type: "text" }, markupToContent(markup));
const question = (id, questionType, fields) => ({
  id,
  type: "question",
  questionType,
  ...fields,
});
const section = (id, blocks) => ({ id, name: id, blocks });

const findingsOf = (doc) => {
  const { errors, warnings } = validateLesson(doc);
  return [...errors, ...warnings];
};
const find = (doc, code) => findingsOf(doc).find((f) => f.code === code);

// Run a code's fix and check the finding went away.
function fixes(doc, code) {
  const finding = find(doc, code);
  expect(finding, `${code} should be found`).toBeTruthy();
  expect(hasQuickFix(finding)).toBe(true);
  const fixed = applyQuickFix(doc, finding);
  expect(fixed).not.toBeNull();
  expect(findingsOf(fixed).some((f) => f.key === finding.key)).toBe(false);
  // Running it again finds nothing to do.
  expect(applyQuickFix(fixed, finding)).toBeNull();
  return fixed;
}

describe("formatting fixes", () => {
  it("removes bold and keeps the italics", () => {
    const doc = {
      title: "T",
      sections: [
        section("s1", [
          text("t1", "Cats came from **EGYPT**, says *The Cat Book*."),
          text("t2", "The rest is plain."),
        ]),
      ],
    };
    const fixed = fixes(doc, "W_FORMAT_BOLD");
    expect(textBlockMarkup(fixed.sections[0].blocks[0])).toBe(
      "Cats came from EGYPT, says *The Cat Book*.",
    );
    // A block with nothing to change is the same object.
    expect(fixed.sections[0].blocks[1]).toBe(doc.sections[0].blocks[1]);
  });

  it("removes underlining", () => {
    const doc = {
      title: "T",
      sections: [section("s1", [text("t1", "A <u>long</u> river.")])],
    };
    const fixed = fixes(doc, "W_FORMAT_UNDERLINE");
    expect(textBlockMarkup(fixed.sections[0].blocks[0])).toBe("A long river.");
  });

  it("unformats only the ALL-CAPS spans", () => {
    const doc = {
      title: "T",
      sections: [
        section("s1", [text("t1", "The *DELTA* is in *Lower Egypt* today.")]),
      ],
    };
    const fixed = fixes(doc, "W_FORMAT_CAPS");
    expect(textBlockMarkup(fixed.sections[0].blocks[0])).toBe(
      "The DELTA is in *Lower Egypt* today.",
    );
  });

  it("makes a long bold span plain, italics inside it included", () => {
    const doc = {
      title: "T",
      sections: [
        section("s1", [
          text(
            "t1",
            "Rivers matter. **Every river *runs* to the sea eventually.** And *Nile* is long, with plenty more words to keep the share of formatting low enough here.",
          ),
        ]),
      ],
    };
    const fixed = fixes(doc, "E_FORMAT_LONG_EMPHASIS");
    // The whole quoted span goes plain, so no long-italic finding takes the
    // long-emphasis one's place; the separate short italic stays.
    expect(textBlockMarkup(fixed.sections[0].blocks[0])).toContain(
      "Every river runs to the sea eventually. And *Nile*",
    );
    expect(
      findingsOf(fixed).some((f) => f.code === "E_FORMAT_LONG_ITALIC"),
    ).toBe(false);
  });

  it("takes all formatting out of a heavily formatted section", () => {
    const doc = {
      title: "T",
      sections: [
        section("s1", [
          text("t1", "*One* and *two* and *three* and *four* and five."),
        ]),
      ],
    };
    const fixed = fixes(doc, "E_FORMAT_HEAVY");
    expect(textBlockMarkup(fixed.sections[0].blocks[0])).toBe(
      "One and two and three and four and five.",
    );
  });
});

describe("placement fixes", () => {
  it("moves a VAKT activity to the end of its section", () => {
    const vakt = { id: "v1", type: "vakt", text: "Jumping jacks.", links: [] };
    const doc = {
      title: "T",
      sections: [
        section("s1", [
          text("t1", "Plain."),
          vakt,
          question("q1", "open", { prompt: "Name a fruit." }),
        ]),
      ],
    };
    const fixed = fixes(doc, "W_VAKT_NOT_LAST");
    expect(fixed.sections[0].blocks.map((b) => b.id)).toEqual([
      "t1",
      "q1",
      "v1",
    ]);
  });

  it("puts the tight orange question first, in the same slots", () => {
    const doc = {
      title: "T",
      sections: [
        section("s1", [
          text("t1", "It drops boulder, cobble, and silt."),
          question("q1", "multiple_open", {
            prompt: "Give a synonym for drop.",
            answers: [{ id: "a1", text: "release" }],
          }),
          question("q2", "multiple", {
            prompt: "It drops ______. Name one.",
            answers: [
              { id: "a2", text: "boulder" },
              { id: "a3", text: "cobble" },
              { id: "a4", text: "silt" },
            ],
          }),
          question("q3", "open", { prompt: "Name a fruit." }),
        ]),
      ],
    };
    const fixed = fixes(doc, "W_ORANGE_ORDER");
    expect(fixed.sections[0].blocks.map((b) => b.id)).toEqual([
      "t1",
      "q2",
      "q1",
      "q3",
    ]);
  });
});

describe("answer fixes", () => {
  it("accepts the item the passage's list goes on to", () => {
    const doc = {
      title: "T",
      sections: [
        section("s1", [
          text("t1", "It drops boulder, cobble, and silt."),
          question("q1", "multiple", {
            prompt: "It drops ______. Name one.",
            answers: [
              { id: "a1", text: "boulder" },
              { id: "a2", text: "cobble" },
            ],
          }),
        ]),
      ],
    };
    const fixed = fixes(doc, "E_ORANGE_PARTIAL_LIST");
    const answers = fixed.sections[0].blocks[1].answers;
    expect(answers.map((a) => a.text)).toEqual(["boulder", "cobble", "silt"]);
    expect(answers[2].id).toEqual(expect.any(String));
  });

  it("accepts the noun of a two-word item, not the whole phrase", () => {
    const doc = {
      title: "T",
      sections: [
        section("s1", [
          text("t1", "It drops boulder, cobble, and fine silt as it slows."),
          question("q1", "multiple", {
            prompt: "It drops ______. Name one.",
            answers: [
              { id: "a1", text: "boulder" },
              { id: "a2", text: "cobble" },
            ],
          }),
        ]),
      ],
    };
    const fixed = fixes(doc, "E_ORANGE_PARTIAL_LIST");
    const answers = fixed.sections[0].blocks[1].answers;
    expect(answers.map((a) => a.text)).toEqual(["boulder", "cobble", "silt"]);
  });
});

describe("hasQuickFix", () => {
  it("is false for codes a script can't fix", () => {
    expect(hasQuickFix({ code: "E_GROUNDING_SINGLE" })).toBe(false);
    expect(
      applyQuickFix({ sections: [] }, { code: "E_GROUNDING_SINGLE" }),
    ).toBe(null);
  });

  it("covers only codes the checks produce", () => {
    const source = readFileSync(
      new URL("./lessonChecks.js", import.meta.url),
      "utf8",
    );
    for (const code of QUICK_FIX_CODES) {
      expect(source).toContain(`"${code}"`);
    }
  });
});
