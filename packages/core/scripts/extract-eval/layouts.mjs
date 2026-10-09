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

// The layouts below are ones the rules cannot read. They exist to train the
// on-device model on what actually reaches it: the import only sends a section
// to the model when the rules find no questions in it, keep lines they cannot
// place, leave an answer glued on, or read several questions as one. Each is
// modelled on how a real document loses its structure.

// A worksheet typed without question marks or numbers, the answer tacked on
// after a space, and the spelling line unlabelled. Lines that start with a
// question word are read by the rules with their answer still attached; the
// rest are short lines the rules cannot place at all.
export function nomarks(doc) {
  const out = [doc.title || "Untitled lesson", ""];
  for (const s of sections(doc)) {
    out.push(s.name, "");
    for (const p of s.paragraphs) out.push(para(p), "");
    out.push(`Words to learn ${s.spellingWords.join(" ")}`, "");
    for (const q of s.questions) {
      const suffix = q.answers.length ? ` ${q.answers.join(" / ")}` : "";
      out.push(`${PROMPT_AS_WRITTEN.nomarks(q.prompt)}${suffix}`);
    }
    out.push("");
  }
  return out.join("\n");
}

// A list that lost its line breaks, as when it is copied out of a web page or
// a PDF: the passage paragraphs survive on their own lines, but the numbered
// questions run together on one line.
export function runon(doc) {
  const out = [doc.title || "Untitled lesson", ""];
  for (const s of sections(doc)) {
    out.push(s.name, "");
    for (const p of s.paragraphs) out.push(para(p), "");
    out.push(`Spelling words: ${s.spellingWords.join(", ")}`, "");
    out.push(
      s.questions
        .map((q, i) => {
          const suffix = q.answers.length
            ? ` (Answer: ${q.answers.join("; ")})`
            : "";
          return `${i + 1}. ${q.prompt}${suffix}`;
        })
        .join(" "),
      "",
    );
  }
  return out.join("\n");
}

// How a layout writes a prompt, where that differs from the lesson's own: the
// model is trained to copy what the document says, so its target is the prompt
// as written.
export const PROMPT_AS_WRITTEN = {
  nomarks: (prompt) => prompt.replace(/\?/g, "").replace(/\s+$/, ""),
};

export const LAYOUTS = {
  plain,
  qa,
  caps,
  bullets,
  colon,
  worked,
  nomarks,
  runon,
};

// The layouts the rules cannot read. A training example from one of these is
// kept only for a section the import would actually send to the model.
export const HARD_LAYOUTS = new Set(["nomarks", "runon"]);
