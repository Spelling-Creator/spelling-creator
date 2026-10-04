// What a text block's editor needs to know about the rest of the lesson: the
// lesson's sources (to cite one, or add one from the footnote form) and how
// many footnotes come before it (so its markers carry the numbers the printed
// lesson will).
//
// Handed down through context rather than props because the blocks are
// memoised several levels down (EditorPage > SectionCard > ContentBlock), and
// only text block editors care. A context change re-renders just them.

import { createContext, useContext, useMemo } from "react";
import { footnoteStarts } from "@spelling-creator/core/lessonText";

const NO_SOURCES = [];

const LessonSourcesContext = createContext({
  sources: NO_SOURCES,
  starts: new Map(),
  addSource: () => null,
});

export function useLessonSources() {
  return useContext(LessonSourcesContext);
}

/**
 * @param {object} props
 * @param {object} props.doc        The lesson being edited.
 * @param {(source: object) => string|null} props.addSource
 *   Adds a source to the lesson and returns its id. Must be stable.
 */
export function LessonSourcesProvider({ doc, addSource, children }) {
  // The numbering is recounted on every edit but only changes when a footnote
  // is added, removed or moved. Keying the map on its contents keeps the same
  // map (and context value) otherwise, so typing in one block doesn't re-render
  // every text block in the lesson.
  const startsKey = JSON.stringify([...footnoteStarts(doc)]);
  const starts = useMemo(() => new Map(JSON.parse(startsKey)), [startsKey]);
  const sources = Array.isArray(doc?.sources) ? doc.sources : NO_SOURCES;

  const value = useMemo(
    () => ({ sources, starts, addSource }),
    [sources, starts, addSource],
  );

  return (
    <LessonSourcesContext.Provider value={value}>
      {children}
    </LessonSourcesContext.Provider>
  );
}
