// Build a printed lesson as a Word document.
//
// The layout is the one a finished lesson is published in: a centred title
// block, then the lesson's blocks running straight down the page with no section
// headings, and a footer on every page carrying the copyright line above the
// question-type legend. A question prints as its prompt in the colour of its
// type followed, in black, by its answer — the colour is the only thing marking
// the type, so nothing is bracketed or labelled in the text.
//
// Text blocks keep their bold, italics and underlining, and their footnotes
// become real Word footnotes, numbered in reading order at the foot of each
// page. When the lesson lists sources they close the document under a
// "Sources" line.
//
// pdfExport.js converts this document to HTML with mammoth and renders that, so
// the PDF matches page for page; docxImport.js reads the same shape back.
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  ExternalHyperlink,
  HeadingLevel,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  FootnoteReferenceRun,
} from "docx";
import { footnoteParts, textBlockParagraphs } from "../lessonText.js";
import { lessonSources, sourceEntryParts, sourcesById } from "../sources.js";
import { fitWithin, imageSizeScale } from "../image.js";
import { imageCaptionParts } from "../imageCredit.js";
import { getImageBytes } from "./imageRef.js";
import {
  CAPTION_STYLE_ID,
  CAPTION_STYLE_NAME,
  CREDIT_STYLE_ID,
  CREDIT_STYLE_NAME,
  DOCX_MAX_IMAGE_WIDTH,
  FOOTNOTE_LOCATOR_STYLE_ID,
  FOOTNOTE_LOCATOR_STYLE_NAME,
  FOOTNOTE_NOTE_STYLE_ID,
  FOOTNOTE_NOTE_STYLE_NAME,
  LEGEND_SEPARATOR,
  QUESTION_LINE_STYLE_ID,
  QUESTION_LINE_STYLE_NAME,
  SOURCE_ENTRY_STYLE_ID,
  SOURCE_ENTRY_STYLE_NAME,
  SOURCES_HEADING_STYLE_ID,
  SOURCES_HEADING_STYLE_NAME,
  SOURCES_HEADING_TEXT,
  TITLE_LINE_STYLE_ID,
  TITLE_LINE_STYLE_NAME,
  lessonCopyright,
  lessonTitleLines,
} from "../lessonLayout.js";
import {
  ANSWER_GAP,
  QUESTION_LEGEND,
  QUESTION_TYPE_LIST,
  questionAnswerText,
  questionLegendText,
  questionMeta,
  questionStyleId,
  questionStyleName,
} from "../questions.js";
import {
  SPELLING_COLOR,
  SPELLING_LABEL,
  SPELLING_WORD_SEPARATOR,
} from "../spelling.js";
import {
  VAKT_COLOR,
  VAKT_LABEL,
  VAKT_STYLE_ID,
  VAKT_STYLE_NAME,
  vaktImageBlock,
  vaktLinkText,
  vaktLinks,
  vaktText,
} from "../vakt.js";

// Re-exported for callers that already reach for it here. New code that wants
// only the constant should import ../lessonLayout.js directly — this module
// pulls in the whole `docx` library.
export { DOCX_MAX_IMAGE_WIDTH };

// Body text size, in docx half-points (28 = 14pt).
const BODY_SIZE = 28;

const ALIGNMENT_MAP = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
};

function imageAlignment(block) {
  return ALIGNMENT_MAP[block.align] || AlignmentType.CENTER;
}

// `docx` wants colours as bare hex, without the leading '#'.
function hex(color) {
  return color.replace("#", "");
}

// The character style a footnote run carries, by its role (see footnoteParts).
const ROLE_STYLES = {
  locator: FOOTNOTE_LOCATOR_STYLE_ID,
  note: FOOTNOTE_NOTE_STYLE_ID,
};

// Runs ({ text, italic?, url?, role? }, from sources.js and lessonText.js) as
// docx children: a link becomes a real hyperlink, everything else a plain run.
function partRuns(parts, size) {
  return parts.map((part) =>
    part.url
      ? new ExternalHyperlink({
          link: part.url,
          children: [
            new TextRun({ text: part.text, style: "Hyperlink", size }),
          ],
        })
      : new TextRun({
          text: part.text,
          italics: Boolean(part.italic),
          style: ROLE_STYLES[part.role],
          size,
        }),
  );
}

// Footnotes are collected as the body is built: each one takes the next number,
// and its text goes into the document's footnotes part under that number.
function createNotes(doc) {
  return { sources: sourcesById(doc), footnotes: {}, next: 1 };
}

function footnoteRun(footnote, notes) {
  const id = notes.next++;
  notes.footnotes[id] = {
    children: [
      new Paragraph({
        children: partRuns(footnoteParts(footnote, notes.sources), 20),
      }),
    ],
  };
  return new FootnoteReferenceRun(id);
}

function textBlockDocxParagraphs(block, notes) {
  return textBlockParagraphs(block).map(
    (runs) =>
      new Paragraph({
        spacing: { after: 120 },
        children: runs.length
          ? runs.map((run) =>
              run.type === "footnote"
                ? footnoteRun(run, notes)
                : new TextRun({
                    text: run.text,
                    bold: run.bold,
                    italics: run.italic,
                    underline: run.underline ? {} : undefined,
                    size: BODY_SIZE,
                  }),
            )
          : [new TextRun({ text: "", size: BODY_SIZE })],
      }),
  );
}

// The Sources list that closes the lesson, when it has any.
function sourcesParagraphs(doc) {
  const sources = lessonSources(doc);
  if (!sources.length) return [];
  return [
    new Paragraph({
      style: SOURCES_HEADING_STYLE_ID,
      spacing: { before: 360, after: 80 },
      children: [
        new TextRun({
          text: SOURCES_HEADING_TEXT,
          bold: true,
          size: BODY_SIZE,
        }),
      ],
    }),
    ...sources.map(
      (source) =>
        new Paragraph({
          style: SOURCE_ENTRY_STYLE_ID,
          spacing: { after: 60 },
          indent: { left: 360, hanging: 360 },
          children: partRuns(sourceEntryParts(source), 22),
        }),
    ),
  ];
}

// `embedded` is an optional out-parameter: every picture that actually makes it
// into the document appends its framing to it, in document order. The PDF path
// pairs mammoth's `<img>` tags with these by position, and mammoth emits a tag
// only for an image the document really carries — so an image whose bytes could
// not be fetched (the catch below, which writes text instead) must NOT be in
// this list, or every image after it in the lesson is framed with the wrong
// block's width and alignment.
async function imageBlockParagraphs(block, embedded) {
  const paragraphs = [];
  const alignment = imageAlignment(block);
  const align = block.align || "center";
  const { caption, credit } = imageCaptionParts(block);
  try {
    const { bytes, ext } = await getImageBytes(block);
    const { width, height } = fitWithin(
      block.width,
      block.height,
      DOCX_MAX_IMAGE_WIDTH * imageSizeScale(block.size),
    );
    paragraphs.push(
      new Paragraph({
        alignment,
        spacing: { before: 120, after: 60 },
        children: [
          new ImageRun({
            type: ext,
            data: bytes,
            transformation: { width, height },
          }),
        ],
      }),
    );
    // The width the docx itself used, rather than the inputs to re-derive it
    // from: the PDF then matches the Word file by construction instead of by
    // two copies of the same arithmetic agreeing.
    embedded?.push({ width, align, caption, credit });
  } catch {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: "[image could not be embedded]", italics: true }),
        ],
      }),
    );
  }
  if (caption) {
    paragraphs.push(
      new Paragraph({
        style: CAPTION_STYLE_ID,
        alignment,
        spacing: { after: credit ? 20 : 160 },
        children: [
          new TextRun({
            text: caption,
            italics: true,
            size: 22,
            color: "555555",
          }),
        ],
      }),
    );
  }
  // The licence credit, smaller and quieter than the caption above it: it has
  // to be there, but it isn't part of the lesson.
  if (credit) {
    paragraphs.push(
      new Paragraph({
        style: CREDIT_STYLE_ID,
        alignment,
        spacing: { after: 160 },
        children: [new TextRun({ text: credit, size: 16, color: "777777" })],
      }),
    );
  }
  return paragraphs;
}

// One question: the prompt in its type's colour, then the answer in black on the
// same line. Consecutive questions sit directly under one another, so the run of
// them reads as a block of colour-coded lines rather than a list of headings.
function questionBlockParagraphs(block) {
  const meta = questionMeta(block.questionType);
  const answer = questionAnswerText(block);
  const steps = (block.steps || [])
    .map((s) => (s.text || "").trim())
    .filter(Boolean);

  const children = [
    // The named character style is what carries the type through mammoth to the
    // PDF and the importer; the explicit colour is what Word itself renders.
    new TextRun({
      text: block.prompt || "(no question text)",
      style: questionStyleId(meta.key),
      color: hex(meta.color),
      italics: Boolean(meta.italic),
      size: BODY_SIZE,
    }),
  ];
  if (answer) {
    children.push(
      new TextRun({
        text: `${ANSWER_GAP}${answer}`,
        size: BODY_SIZE,
        color: "000000",
      }),
    );
  }

  const paragraphs = [
    new Paragraph({
      style: QUESTION_LINE_STYLE_ID,
      spacing: { after: steps.length ? 40 : 20 },
      children,
    }),
  ];

  // Working-out for a number question, when the author recorded any. The scanned
  // layout has no separate steps line, so these stay indented and out of the way
  // of the question run above.
  steps.forEach((text, i) => {
    paragraphs.push(
      new Paragraph({
        spacing: { after: i === steps.length - 1 ? 60 : 40 },
        indent: { left: 360 },
        children: [new TextRun({ text: `${i + 1}. ${text}`, size: 24 })],
      }),
    );
  });

  return paragraphs;
}

// The spelling words as one running line: "Spell: FIRST SECOND THIRD".
function spellingBlockParagraphs(block) {
  const words = (block.words || [])
    .map((w) => (w.text || "").trim())
    .filter(Boolean);

  return [
    new Paragraph({
      spacing: { before: 160, after: 60 },
      children: [
        new TextRun({
          text: `${SPELLING_LABEL} `,
          bold: true,
          color: hex(SPELLING_COLOR),
          size: BODY_SIZE,
        }),
        new TextRun({
          text: words.length
            ? words.join(SPELLING_WORD_SEPARATOR)
            : "(no spelling words yet)",
          italics: words.length === 0,
          size: BODY_SIZE,
        }),
      ],
    }),
  ];
}

// A VAKT activity: the "VAKT:" label and the activity itself, all in red, then
// its picture and its links underneath. The whole line is coloured rather than
// just the label — a regulation break is an instruction to whoever is running
// the lesson, not one more prompt in the colour-coded run above it, and it has
// to be findable at a glance on a page of black body text.
async function vaktBlockParagraphs(block, embedded) {
  const text = vaktText(block);
  const paragraphs = [
    new Paragraph({
      spacing: { before: 160, after: 60 },
      children: [
        // Same trick as a question prompt: the named character style is what
        // carries the colour through mammoth to the PDF, the explicit colour is
        // what Word itself renders.
        new TextRun({
          text: `${VAKT_LABEL} `,
          bold: true,
          style: VAKT_STYLE_ID,
          color: hex(VAKT_COLOR),
          size: BODY_SIZE,
        }),
        new TextRun({
          text: text || "(no activity yet)",
          italics: !text,
          style: VAKT_STYLE_ID,
          color: hex(VAKT_COLOR),
          size: BODY_SIZE,
        }),
      ],
    }),
  ];

  // A VAKT image prints exactly as an image block's does — the bytes, the
  // caption and credit, the aspect-ratio fit, the picked size and alignment — hence the
  // reuse; vaktImageBlock supplies only the VAKT defaults for a block that was
  // never framed by hand.
  if (block.image || block.src) {
    paragraphs.push(
      ...(await imageBlockParagraphs(vaktImageBlock(block), embedded)),
    );
  }

  // Links print as one indented line each, address and all: on paper a link is
  // read and typed rather than clicked, so the label alone would be a dead end.
  // They are still real hyperlinks in the Word file, for whoever opens it there.
  for (const link of vaktLinks(block)) {
    paragraphs.push(
      new Paragraph({
        spacing: { after: 40 },
        indent: { left: 360 },
        children: [
          new ExternalHyperlink({
            link: link.url,
            children: [
              new TextRun({
                text: vaktLinkText(link),
                style: "Hyperlink",
                size: BODY_SIZE,
              }),
            ],
          }),
        ],
      }),
    );
  }

  return paragraphs;
}

// A section's blocks, with no heading of its own. Section names are an
// organising device inside the editor; a printed lesson runs straight through.
async function sectionParagraphs(section, embedded, notes) {
  const paragraphs = [];
  for (const block of section.blocks) {
    if (block.type === "text") {
      paragraphs.push(...textBlockDocxParagraphs(block, notes));
    } else if (block.type === "image" && (block.image || block.src)) {
      paragraphs.push(...(await imageBlockParagraphs(block, embedded)));
    } else if (block.type === "question") {
      paragraphs.push(...questionBlockParagraphs(block));
    } else if (block.type === "spelling") {
      paragraphs.push(...spellingBlockParagraphs(block));
    } else if (block.type === "vakt") {
      paragraphs.push(...(await vaktBlockParagraphs(block, embedded)));
    }
  }
  return paragraphs;
}

// Title, by-line and the age/release lines, all centred.
function titleParagraphs(doc, meta) {
  const lines = lessonTitleLines(doc, meta);
  const paragraphs = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: lines.length ? 60 : 240 },
      children: [
        new TextRun({ text: doc.title || "Untitled Lesson", bold: true }),
      ],
    }),
  ];
  lines.forEach((line, i) => {
    paragraphs.push(
      new Paragraph({
        style: TITLE_LINE_STYLE_ID,
        alignment: AlignmentType.CENTER,
        spacing: { after: i === lines.length - 1 ? 240 : 40 },
        children: [
          new TextRun({ text: line.text, bold: line.bold, size: BODY_SIZE }),
        ],
      }),
    );
  });
  return paragraphs;
}

// The page footer: the copyright line, then the legend naming every question
// type in its own colour. The legend is what makes the colour coding above it
// readable, so it repeats on every page.
function pageFooter(meta) {
  const children = [];

  const copyright = lessonCopyright(meta);
  if (copyright) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: [new TextRun({ text: copyright, bold: true, size: 18 })],
      }),
    );
  }

  const legend = [];
  QUESTION_LEGEND.forEach((type, i) => {
    if (i > 0) {
      legend.push(
        new TextRun({ text: LEGEND_SEPARATOR, size: 16, color: "555555" }),
      );
    }
    legend.push(
      new TextRun({
        text: questionLegendText(type),
        size: 16,
        color: hex(type.color),
        // Two types share the amber (see questions.js), so the legend has to
        // repeat the italic that tells them apart in the body above it —
        // otherwise it prints the same swatch twice under two names.
        italics: Boolean(type.italic),
      }),
    );
  });
  children.push(
    new Paragraph({ alignment: AlignmentType.CENTER, children: legend }),
  );

  return new Footer({ children });
}

// The page number, top right, as the scanned lessons carry it.
function pageHeader() {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })],
      }),
    ],
  });
}

// One Word character style per question type, plus one for VAKT activities, so
// the colour coding survives the round trip through mammoth (see questions.js
// for why these exist at all).
function colourCharacterStyles() {
  return [
    ...QUESTION_TYPE_LIST.map((type) => ({
      id: questionStyleId(type.key),
      name: questionStyleName(type.key),
      basedOn: "DefaultParagraphFont",
      quickFormat: false,
      run: { color: hex(type.color), italics: Boolean(type.italic) },
    })),
    {
      id: VAKT_STYLE_ID,
      name: VAKT_STYLE_NAME,
      basedOn: "DefaultParagraphFont",
      quickFormat: false,
      run: { color: hex(VAKT_COLOR) },
    },
    // Unformatted on purpose: only the importer looks at these.
    {
      id: FOOTNOTE_LOCATOR_STYLE_ID,
      name: FOOTNOTE_LOCATOR_STYLE_NAME,
      basedOn: "DefaultParagraphFont",
      quickFormat: false,
    },
    {
      id: FOOTNOTE_NOTE_STYLE_ID,
      name: FOOTNOTE_NOTE_STYLE_NAME,
      basedOn: "DefaultParagraphFont",
      quickFormat: false,
    },
  ];
}

/**
 * Build an in-memory docx Document from the lesson state. Async because image
 * bytes may need fetching from R2 for a lesson whose images aren't held locally.
 *
 * @param {object} doc   the lesson document ({ title, ageRange, sources, sections })
 * @param {{author?: string, published?: string|number|Date}} [meta]
 *   who the lesson is by and when it was published — used for the by-line and
 *   the footer's copyright line. Both lines are omitted when not supplied.
 * @param {Array<{width: number, align: string, caption: string, credit: string}>} [embedded]
 *   an out-parameter the PDF path passes in: each picture this document really
 *   ends up carrying appends its framing, in document order, so the converted
 *   HTML's `<img>` tags can be matched to them one for one. See pdfExport.js.
 *   Omit it (the DOCX download does) and nothing is collected.
 */
export async function buildDocument(doc, meta = {}, embedded = undefined) {
  const children = titleParagraphs(doc, meta);
  const notes = createNotes(doc);

  for (const section of doc.sections) {
    children.push(...(await sectionParagraphs(section, embedded, notes)));
  }
  children.push(...sourcesParagraphs(doc));

  return new Document({
    creator: meta.author || "Spelling Lesson Maker",
    title: doc.title || "Untitled Lesson",
    footnotes: notes.footnotes,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: BODY_SIZE },
        },
      },
      paragraphStyles: [
        {
          id: TITLE_LINE_STYLE_ID,
          name: TITLE_LINE_STYLE_NAME,
          basedOn: "Normal",
          quickFormat: false,
          paragraph: { alignment: AlignmentType.CENTER },
        },
        {
          id: QUESTION_LINE_STYLE_ID,
          name: QUESTION_LINE_STYLE_NAME,
          basedOn: "Normal",
          quickFormat: false,
        },
        {
          id: CAPTION_STYLE_ID,
          name: CAPTION_STYLE_NAME,
          basedOn: "Normal",
          quickFormat: false,
        },
        {
          id: CREDIT_STYLE_ID,
          name: CREDIT_STYLE_NAME,
          basedOn: "Normal",
          quickFormat: false,
        },
        {
          id: SOURCES_HEADING_STYLE_ID,
          name: SOURCES_HEADING_STYLE_NAME,
          basedOn: "Normal",
          quickFormat: false,
        },
        {
          id: SOURCE_ENTRY_STYLE_ID,
          name: SOURCE_ENTRY_STYLE_NAME,
          basedOn: "Normal",
          quickFormat: false,
        },
      ],
      characterStyles: colourCharacterStyles(),
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 },
          },
        },
        headers: { default: pageHeader() },
        footers: { default: pageFooter(meta) },
        children,
      },
    ],
  });
}

function safeFileName(title) {
  const base = (title || "lesson")
    .trim()
    .replace(/[^a-z0-9\-_ ]/gi, "")
    .replace(/\s+/g, "-");
  return `${base || "lesson"}.docx`;
}

/**
 * Generate and download the .docx file.
 * @param {object} doc
 * @param {{author?: string, published?: string|number|Date}} [meta]
 */
export async function exportDocx(doc, meta = {}) {
  const document = await buildDocument(doc, meta);
  const blob = await Packer.toBlob(document);
  triggerDownload(blob, safeFileName(doc.title));
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
