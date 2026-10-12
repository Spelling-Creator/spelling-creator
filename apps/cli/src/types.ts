// The lesson document as the CLI sees it: the normalized shape jsonImport
// produces and the hub stores. Core is plain JavaScript with no published
// types, so these are written here from its code and tests, and core.d.ts
// gives its modules signatures in terms of them. Keep both in step with
// packages/core/src/jsonImport.js when a block gains a field.

export type QuestionType =
  | "number"
  | "single"
  | "multiple"
  | "multiple_open"
  | "paraphrase"
  | "open"
  | "wyr"
  | "background";

/** A spelling word, an accepted answer or a working-out step. */
export interface TextItem {
  id: string;
  text: string;
}

export interface TextBlock {
  id: string;
  type: "text";
  /** Plain prose. A formatted block carries a tiptap document in `content` instead. */
  text?: string;
  content?: unknown;
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
  prompt: string;
  answer?: string;
  answers?: TextItem[];
  steps?: TextItem[];
}

export interface VaktLink {
  id: string;
  label: string;
  url: string;
}

export interface VaktBlock {
  id: string;
  type: "vakt";
  text: string;
  links: VaktLink[];
  image?: unknown;
  src?: string;
  width?: number;
  height?: number;
  caption?: string;
  credit?: string;
  size?: string;
  align?: string;
}

export interface ImageBlock {
  id: string;
  type: "image";
  image?: unknown;
  src?: string;
  width?: number;
  height?: number;
  caption?: string;
  credit?: string;
  size: string;
  align: string;
}

export type Block =
  | TextBlock
  | SpellingBlock
  | QuestionBlock
  | VaktBlock
  | ImageBlock;

export interface Section {
  id: string;
  name: string;
  blocks: Block[];
}

export interface Source {
  id: string;
  [key: string]: unknown;
}

export interface LessonDoc {
  title: string;
  ageRange?: string;
  sources?: Source[];
  sections: Section[];
}

/** The importable .json envelope (see core's lessonFile.js). */
export interface LessonFile {
  format: string;
  version: number;
  doc: LessonDoc;
}
