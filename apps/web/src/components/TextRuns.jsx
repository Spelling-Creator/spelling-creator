// Draws formatted lesson text as React elements: a text block's runs (see
// textBlockParagraphs in @spelling-creator/core/lessonText) and the citation
// parts of a footnote or a source (see @spelling-creator/core/sources).
//
// Nothing here goes near innerHTML. Each run is a string with a few flags, so
// the formatting a lesson can carry is exactly the set of tags written below,
// whatever a stored document claims to contain. That is also what lets the
// server render a lesson page: there is no sanitiser waiting for a DOM.

// One run of a text block. Footnotes are handed to `renderFootnote`, which
// decides whether and how to mark them (interactive mode leaves them out).
export function TextRuns({ runs, renderFootnote = () => null }) {
  return runs.map((run, i) => {
    if (run.type === "footnote") return renderFootnote(run, i);
    let node = run.text;
    if (run.underline) node = <u>{node}</u>;
    if (run.italic) node = <em>{node}</em>;
    if (run.bold) node = <strong>{node}</strong>;
    return <span key={i}>{node}</span>;
  });
}

// A citation or Sources list entry: italic titles, and addresses as links that
// open away from the lesson. sources.js only emits a `url` part for an address
// that passed isSafeLink, so a stored `javascript:` never reaches an href.
export function CitationParts({ parts }) {
  return parts.map((part, i) => {
    if (part.url) {
      return (
        <a
          key={i}
          href={part.url}
          target="_blank"
          rel="nofollow noopener noreferrer"
          className="break-words"
        >
          {part.text}
        </a>
      );
    }
    if (part.italic) return <em key={i}>{part.text}</em>;
    return <span key={i}>{part.text}</span>;
  });
}
