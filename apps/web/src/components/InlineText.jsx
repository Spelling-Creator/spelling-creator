// Draws inline text (a question's prompt, a working step; see
// @spelling-creator/core/inlineText) the way TextRuns draws a paragraph: its
// formatting and its formulas, nothing for a pause or a read-aloud hint.
// `fallback` is what shows for an empty field, such as "(no question text)".

import {
  inlineTextPlain,
  inlineTextRuns,
} from "@spelling-creator/core/inlineText";
import { TextRuns } from "./TextRuns.jsx";

export default function InlineText({ value, fallback = null }) {
  if (!inlineTextPlain(value).trim()) return fallback;
  return <TextRuns runs={inlineTextRuns(value)} />;
}
