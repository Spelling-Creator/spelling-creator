// Ways someone might type a lesson up. Each layout turns a lesson into text.
// They serve two purposes: documents to test an import against, and the
// document side of (document, lesson JSON) training pairs.
//
// All keep the passage before its questions, which is the one assumption the
// section splitter makes. Within that they vary everything the parser has to
// cope with: headings or none, how the spelling words are labelled, numbered
// or bulleted questions, and above all how an answer is attached to its
// question, from an explicit "(Answer: ...)" to a bare run of capitals.

import { groundTruthSection } from "./score.mjs";

const para = (p) => p.replace(/\n+/g, " ");

function sections(doc) {
  return doc.sections.map((s, i) => ({ ...groundTruthSection(s), index: i }));
}

// Numbered questions with the answer in brackets. The original "plain" style.
export function plain(doc) {
  const out = [doc.title || "Untitled lesson", ""];
  for (const s of sections(doc)) {
    out.push(s.name, "");
    for (const p of s.paragraphs) out.push(para(p), "");
    out.push(`Spelling words: ${s.spellingWords.join(", ")}`, "");
    s.questions.forEach((q, i) => {
      const suffix = q.answers.length
        ? ` (Answer: ${q.answers.join("; ")})`
        : "";
      out.push(`${i + 1}. ${q.prompt}${suffix}`);
    });
    out.push("");
  }
  return out.join("\n");
}

// Question and answer on separate lines, lowercase spelling words.
export function qa(doc) {
  const out = [doc.title || "Untitled lesson", ""];
  for (const s of sections(doc)) {
    out.push(s.name, "");
    for (const p of s.paragraphs) out.push(para(p), "");
    out.push(
      `Spelling: ${s.spellingWords.map((w) => w.toLowerCase()).join(", ")}`,
      "",
      "Questions",
      "",
    );
    for (const q of s.questions) {
      out.push(`Q: ${q.prompt}`);
      if (q.answers.length) out.push(`A: ${q.answers.join(", ")}`);
    }
    out.push("");
  }
  return out.join("\n");
}

// No headings, answers as a bare run of capitals after the question. The
// ambiguous one: nothing but case separates the answer from the prompt.
export function caps(doc) {
  const out = [doc.title || "Untitled lesson", ""];
  for (const s of sections(doc)) {
    for (const p of s.paragraphs) out.push(para(p), "");
    out.push(`Words: ${s.spellingWords.join(" ")}`, "");
    for (const q of s.questions) {
      const suffix = q.answers.length
        ? ` ${q.answers.map((a) => a.toUpperCase()).join(" / ")}`
        : "";
      out.push(`${q.prompt}${suffix}`);
    }
    out.push("");
  }
  return out.join("\n");
}

// Bulleted questions with the answers in square brackets.
export function bullets(doc) {
  const out = [doc.title || "Untitled lesson", ""];
  for (const s of sections(doc)) {
    out.push(`Part ${s.index + 1}: ${s.name}`, "");
    for (const p of s.paragraphs) out.push(para(p), "");
    out.push(`Spelling list - ${s.spellingWords.join(", ")}`, "");
    for (const q of s.questions) {
      const suffix = q.answers.length ? ` [${q.answers.join(", ")}]` : "";
      out.push(`* ${q.prompt}${suffix}`);
    }
    out.push("");
  }
  return out.join("\n");
}

// "1) prompt: answer". A colon is also ordinary punctuation inside a prompt,
// so this one needs judgement too.
export function colon(doc) {
  const out = [doc.title || "Untitled lesson", ""];
  for (const s of sections(doc)) {
    out.push(s.name, "");
    for (const p of s.paragraphs) out.push(para(p), "");
    out.push(`Spell these: ${s.spellingWords.join(", ")}`, "");
    s.questions.forEach((q, i) => {
      const suffix = q.answers.length ? `: ${q.answers.join(", ")}` : "";
      out.push(`${i + 1}) ${q.prompt}${suffix}`);
    });
    out.push("");
  }
  return out.join("\n");
}

// Like plain, but a number question's working-out follows it on one line.
export function worked(doc) {
  const out = [doc.title || "Untitled lesson", ""];
  for (const s of sections(doc)) {
    out.push(s.name, "");
    for (const p of s.paragraphs) out.push(para(p), "");
    out.push(`Spelling words: ${s.spellingWords.join(", ")}`, "");
    s.questions.forEach((q, i) => {
      const suffix = q.answers.length
        ? ` (Answer: ${q.answers.join("; ")})`
        : "";
      out.push(`${i + 1}. ${q.prompt}${suffix}`);
      if (q.steps.length) {
        out.push(
          `Working out: ${q.steps.map((st, j) => `${j + 1}. ${st}`).join("  ")}`,
        );
      }
    });
    out.push("");
  }
  return out.join("\n");
}

export const LAYOUTS = { plain, qa, caps, bullets, colon, worked };
