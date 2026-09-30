---
title: AI question suggestions
---

# AI question suggestions

Press **AI question** on any section to open a dialog that suggests a structured
question block. It uses the same Turnstile-verified Worker as the text
suggester, just in a different mode. The flow:

1. Pick a question type (the same seven types as the **Add question** menu).
2. The section title is used as the subject; the section's existing text is sent
   as context so the question is answerable from the lesson.
3. Turnstile verifies the request, then the verified token, subject, type, and
   context are POSTed to the Worker with `mode: "question"`.
4. The Worker asks the model for JSON matching that question type (prompt,
   options, answer, etc.) and returns it.
5. The suggestion is inserted as a new, fully editable question block of that
   type, with option indexes mapped back onto option ids in
   `packages/core/src/questions.js`.

Every type in the **Add question** menu has an entry in `QUESTION_SCHEMAS`,
`QUESTION_LABELS` and `QUESTION_INSTRUCTIONS` (`apps/api/src/lib/ai/schemas.js`);
the Worker refuses a `questionType` it has no schema for with a 400, so a type
in the menu without one is a button that only returns an error. Add all three
entries whenever a question type is added.
