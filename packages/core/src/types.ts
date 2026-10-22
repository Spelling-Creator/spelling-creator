// The lesson document: the normalized shape jsonImport produces, the editor
// edits and the hub stores. Types only, so importing it costs nothing at
// runtime. Keep it in step with jsonImport.js when a block gains a field.

/** A node of a tiptap (ProseMirror) document, as JSON. */
export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

/** `open` is the type lessons carried before tight and broad opens were separate. */
export type QuestionType =
  | "number"
  | "single"
  | "multiple"
  | "multiple_open"
  | "paraphrase"
  | "tight_open"
  | "broad_open"
  | "open"
  | "wyr"
  | "background";

/** A spelling word or an accepted answer. */
export interface TextItem {
  id: string;
  text: string;
}

/**
 * Inline text: a question's prompt or a working-out step. A plain string, or
 * a one-paragraph tiptap document once it carries formatting, a read-aloud
 * hint or a formula (see inlineText.js).
 */
export type InlineText = string | RichNode;

/** A working-out step of a math question. */
export interface StepItem {
  id: string;
  text: InlineText;
}

/** A stored picture, by the hash of its bytes (see browser/imageRef.js). */
export interface ImageRef {
  hash: string;
  mime: string;
  ext: string;
}

export interface TextBlock {
  id: string;
  type: "text";
  /** Plain prose. A formatted block carries a tiptap document in `content` instead. */
  text?: string;
  content?: RichNode;
}

export interface SpellingBlock {
  id: string;
  type: "spelling";
  words: TextItem[];
}

export interface QuestionBlock {
  id: string;
  type: "question";
  questionType: QuestionType;
  /** `multiple` only: printed "(3B)" in front of the question. */
  threeBoard?: boolean;
  /** `multiple` only: the accepted answer a Besides line names. */
  besides?: string;
  prompt: InlineText;
  answer?: string;
  answers?: TextItem[];
  steps?: StepItem[];
}

export interface VaktLink {
  id: string;
  label: string;
  url: string;
}

/**
 * The picture fields an image block and a VAKT activity share. A stored
 * lesson carries `image`; `src` is a data URL a lesson holds only between a
 * DOCX import and the pass that stores its pictures.
 */
export interface Picture {
  image?: ImageRef;
  src?: string;
  width?: number;
  height?: number;
  caption?: string;
  credit?: string;
}

export interface VaktBlock extends Picture {
  id: string;
  type: "vakt";
  text: string;
  links: VaktLink[];
  /** Set when the activity has a picture. */
  size?: string;
  align?: string;
}

export interface ImageBlock extends Picture {
  id: string;
  type: "image";
  /** A key of IMAGE_SIZES in image.js. */
  size: string;
  /** One of IMAGE_ALIGNS in image.js. */
  align: string;
}

/** A short heading inside a section, such as one over a run of W.Y.R. questions. */
export interface HeadingBlock {
  id: string;
  type: "heading";
  text: string;
}

export type Block =
  | TextBlock
  | SpellingBlock
  | QuestionBlock
  | VaktBlock
  | ImageBlock
  | HeadingBlock;

export interface Section {
  id: string;
  name: string;
  blocks: Block[];
}

/** One of a lesson's sources (see sources.js). Every field may be empty. */
export interface Source {
  id: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  url: string;
}

export interface LessonDoc {
  title: string;
  /** One of AGE_RANGES in ageRanges.js. */
  ageRange?: string;
  sources?: Source[];
  sections: Section[];
}

/** The importable .json envelope (see lessonFile.js). */
export interface LessonFile {
  format: string;
  version: number;
  doc: LessonDoc;
}
