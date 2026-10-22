// The Open Spelling Lesson Format's XML form: an OSLF lesson file written as
// XML, and read back.
//
// OSLF is one data model with two serializations, JSON and XML, and the spec
// (XML-FORMAT.md in the format's repository) says converting between them loses
// nothing but collapsible whitespace. So this module converts between the two
// forms of the *file*, never the app's lesson: toOslfXml takes what toOslf in
// oslf.ts writes, and fromOslfXml gives what fromOslf reads. The mapping from
// the app's lesson to the format stays in one place.
//
// The mapping in short, from the spec's correspondence table:
//
//   - The root is <lesson xmlns="urn:oslf:lesson" version="0.1">. Every OSLF
//     element is in that namespace; anything from another namespace is an
//     extension, which this app neither writes nor reads.
//   - Names: camelCase becomes lowercase with hyphens (ageRange, age-range).
//     Short machine values are attributes, human text is element content.
//   - A block's `type` is its element's name, a question's `questionType` its
//     `type` attribute, and math working is <step> elements.
//   - Rich text mixes text with <b>, <i>, <u>, a read-aloud hint innermost
//     (<phoneme alphabet="ipa" ph>, <sub alias> or <say-as
//     interpret-as="characters">), <note>, <m> for a formula and <break> for a
//     pause, whose `strength` is "medium" for a short pause and "strong" for a
//     long one. The hints and the break are SSML's elements of the same names,
//     moved into the OSLF namespace.
//
// Reading follows the spec's whitespace rule: in an element that holds text,
// each run of whitespace reads as one space, and whitespace at the very start
// and end of its content is dropped. Writing therefore keeps rich text on one
// line inside its element, and indents only between elements.
//
// Security (XML-FORMAT.md section 10): a file with a DOCTYPE is refused, and
// the parser (@xmldom/xmldom) never resolves external entities or fetches
// anything. Text is escaped on the way out, so nothing an author wrote can
// become markup.

import {
  type Document,
  type Element,
  type Node,
  type Text,
  DOMParser,
} from "@xmldom/xmldom";
import { lessonFileBase } from "./lessonFile.ts";
import {
  type OslfBlock,
  type OslfFile,
  type OslfImage,
  type OslfMath,
  type OslfPauseRun,
  type OslfRichText,
  type OslfSource,
  type OslfSpokenText,
  type OslfTextRun,
  OslfImportError,
} from "./oslf.ts";

/** The namespace every element of an OSLF lesson file is in. */
export const OSLF_NAMESPACE = "urn:oslf:lesson";

/** The file name extension the format recommends for its XML form. */
export const OSLF_XML_EXTENSION = ".oslf.xml";

/** A file name for a lesson exported as OSLF XML, from its title. */
export function oslfXmlFileName(title?: string): string {
  return `${lessonFileBase(title)}${OSLF_XML_EXTENSION}`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

type AttrValue = string | number | null | undefined;
type Pairs = ReadonlyArray<readonly [string, AttrValue]>;

// An element waiting to be written: its children, or `inline` content that
// stays on one line (see blockTree and render).
type Tree =
  | {
      name: string;
      pairs: Pairs;
      children: Array<string | Tree | null>;
      inline?: undefined;
    }
  | { name: string; pairs: Pairs; inline: string; children?: undefined };

function escapeText(text: string | number): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string | number): string {
  return escapeText(text).replace(/"/g, "&quot;");
}

// ` name="value"` for each attribute that has a value, in the order given.
function attrs(pairs: Pairs): string {
  return pairs
    .filter(
      (pair): pair is readonly [string, string | number] =>
        pair[1] !== undefined && pair[1] !== null && pair[1] !== "",
    )
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join("");
}

function element(name: string, pairs: Pairs, content?: string): string {
  const open = `<${name}${attrs(pairs)}`;
  return content ? `${open}>${content}</${name}>` : `${open}/>`;
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runsOf<T>(
  value: string | readonly T[] | undefined,
): Array<string | T> {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value : [];
}

// A text run's words with its hint innermost, then <u>, <i> and <b> outside
// it, the order the spec asks producers to write.
function textRunXml(run: OslfTextRun): string {
  let out = escapeText(run.text);
  if (run.ipa)
    out = element(
      "phoneme",
      [
        ["alphabet", "ipa"],
        ["ph", run.ipa],
      ],
      out,
    );
  else if (run.alias) out = element("sub", [["alias", run.alias]], out);
  else if (run.sayAs) {
    out = element("say-as", [["interpret-as", run.sayAs]], out);
  }
  if (run.underline) out = `<u>${out}</u>`;
  if (run.italic) out = `<i>${out}</i>`;
  if (run.bold) out = `<b>${out}</b>`;
  return out;
}

function pauseXml(pause: OslfPauseRun["pause"]): string {
  return element("break", [
    ["strength", pause === "long" ? "strong" : "medium"],
  ]);
}

// Spoken text: words, the three hints and pauses (no formatting, no notes).
function spokenXml(value: OslfSpokenText): string {
  return runsOf(value)
    .map((run) => {
      if (typeof run === "string") return escapeText(run);
      if (!isObject(run)) return "";
      if ("pause" in run && run.pause) return pauseXml(run.pause);
      if ("text" in run && typeof run.text === "string") return textRunXml(run);
      return "";
    })
    .join("");
}

function mathXml(math: OslfMath): string {
  const children = [element("source", [], escapeText(math.source ?? ""))];
  if (math.spoken !== undefined) {
    children.push(`<spoken>${spokenXml(math.spoken)}</spoken>`);
  }
  return element(
    "m",
    [
      ["format", math.format],
      ["display", bool(math.display)],
    ],
    children.join(""),
  );
}

/**
 * OSLF rich text as XML content (what goes between an element's tags).
 * @param value  A string or a list of runs.
 */
export function richTextXml(value: OslfRichText): string {
  return runsOf(value)
    .map((run) => {
      if (typeof run === "string") return escapeText(run);
      if (!isObject(run)) return "";
      if ("note" in run && isObject(run.note)) {
        return element(
          "note",
          [
            ["source", run.note.source],
            ["locator", run.note.locator],
          ],
          escapeText(run.note.text ?? ""),
        );
      }
      if ("math" in run && isObject(run.math)) return mathXml(run.math);
      if ("pause" in run && run.pause) return pauseXml(run.pause);
      if ("text" in run && typeof run.text === "string") return textRunXml(run);
      return "";
    })
    .join("");
}

// An element holding text, on one line, or nothing when there is no text.
function textElement(
  name: string,
  text: string | undefined,
  pairs: Pairs = [],
): string | null {
  if (typeof text !== "string") return null;
  return element(name, pairs, escapeText(text));
}

function richElement(
  name: string,
  value: OslfRichText,
  pairs: Pairs = [],
): string {
  return element(name, pairs, richTextXml(value));
}

function bool(value: boolean | undefined): "true" | "false" | undefined {
  return value === true ? "true" : value === false ? "false" : undefined;
}

function imageXml(image: OslfImage & { id?: string }, name = "image"): Tree {
  const children: Array<string | null> = [];
  if (typeof image.alt === "string")
    children.push(textElement("alt", image.alt));
  if (image.caption !== undefined) {
    children.push(richElement("caption", image.caption));
  }
  if (isObject(image.credit)) {
    const credit = image.credit;
    children.push(
      element(
        "credit",
        [
          ["author", credit.author],
          ["license", credit.license],
          ["license-url", credit.licenseUrl],
          ["source-url", credit.sourceUrl],
        ],
        typeof credit.text === "string" ? escapeText(credit.text) : "",
      ),
    );
  }
  return {
    name,
    pairs: [
      ["src", image.src],
      ["size", image.size],
      ["align", image.align],
      ["width", image.width],
      ["height", image.height],
      ["id", name === "image" ? image.id : undefined],
    ],
    children,
  };
}

// One block as a tree: { name, pairs, children } where children are lines
// already written (a child that is itself a tree is indented by `render`).
function blockTree(block: OslfBlock): Tree | null {
  const id = ["id", block.id] as const;
  switch (block.type) {
    case "passage":
      return {
        name: "passage",
        pairs: [id],
        children: runsOf(block.paragraphs).map((p) => richElement("p", p)),
      };
    case "spelling":
      return {
        name: "spelling",
        pairs: [id],
        children: (block.words || []).map((w) => textElement("word", w)),
      };
    case "image":
      return imageXml(block);
    case "question":
      return {
        name: "question",
        pairs: [
          ["type", block.questionType],
          ["answer-key", block.answerKey],
          ["three-board", bool(block.threeBoard)],
          ["besides", block.besides],
          id,
        ],
        children: [
          richElement("prompt", block.prompt ?? ""),
          ...(block.answers || []).map((a) => textElement("answer", a)),
          ...(block.working || []).map((step) => richElement("step", step)),
        ],
      };
    case "vakt":
      return {
        name: "vakt",
        pairs: [id],
        children: [
          textElement("text", block.text ?? ""),
          ...(block.links || []).map((link) =>
            element("link", [["url", link.url]], escapeText(link.label ?? "")),
          ),
          ...(isObject(block.image) ? [imageXml(block.image)] : []),
        ],
      };
    case "heading":
      return {
        name: "heading",
        pairs: [id],
        inline: richTextXml(block.text ?? ""),
      };
    default:
      return null;
  }
}

// A tree as indented lines. A tree with `inline` content is one line.
function render(tree: Tree, depth: number): string[] {
  const pad = "  ".repeat(depth);
  if (tree.inline !== undefined) {
    return [`${pad}${element(tree.name, tree.pairs, tree.inline)}`];
  }
  const children = tree.children.filter((child): child is string | Tree =>
    Boolean(child),
  );
  if (!children.length) return [`${pad}${element(tree.name, tree.pairs)}`];
  return [
    `${pad}<${tree.name}${attrs(tree.pairs)}>`,
    ...children.flatMap((child) =>
      typeof child === "string"
        ? [`${pad}  ${child}`]
        : render(child, depth + 1),
    ),
    `${pad}</${tree.name}>`,
  ];
}

function sourceTree(source: OslfSource): Tree {
  return {
    name: "source",
    pairs: [["id", source.id]],
    children: (["title", "author", "publisher", "year", "url"] as const).map(
      (field) => textElement(field, source[field]),
    ),
  };
}

/** An OSLF lesson file (the object toOslf writes) as its XML form. */
export function toOslfXml(file: OslfFile): string {
  const root: Tree = {
    name: "lesson",
    pairs: [
      ["xmlns", OSLF_NAMESPACE],
      ["version", file.oslf],
      ["id", file.id],
      ["language", file.language],
      ["license", file.license],
      ["created", file.created],
      ["modified", file.modified],
      ["age-range", file.ageRange],
    ],
    children: [
      textElement("title", file.title ?? ""),
      ...(file.authors || []).map((person) =>
        element("author", [["url", person.url]], escapeText(person.name ?? "")),
      ),
      ...(file.profiles || []).map((ref) => element("profile", [["ref", ref]])),
      ...(file.sources || []).map(sourceTree),
      ...(file.sections || []).map((section): Tree => ({
        name: "section",
        pairs: [["id", section.id]],
        children: [
          textElement("title", section.title),
          ...(section.blocks || []).map(blockTree),
        ],
      })),
    ],
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(root, 0).join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

// What the reader builds: JSON objects in the file's shape, holding whatever
// the XML said. Checking the values is fromOslf's job.
type Fields = Record<string, unknown>;

type Marks = Partial<Record<"bold" | "italic" | "underline", true>>;
type Hint = Record<string, string>;

// A run of words with the marks and hint around it, or one of the other runs.
interface Words {
  text: string;
  marks: Marks;
  hint: Hint | undefined;
}
type OtherRun = { pause: string } | { note: Fields } | { math: Fields };
type Piece =
  | (Words & { run?: undefined })
  | { run: OtherRun; text?: undefined };

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

function isOslf(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE && node.namespaceURI === OSLF_NAMESPACE;
}

function isText(node: Node): node is Text {
  return node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE;
}

function childElements(node: Node, name?: string): Element[] {
  const out: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (isOslf(child) && (!name || child.localName === name)) out.push(child);
  }
  return out;
}

function child(node: Node, name: string): Element | null {
  return childElements(node, name)[0] ?? null;
}

function attr(node: Element, name: string): string | undefined {
  return node.hasAttribute(name)
    ? (node.getAttribute(name) ?? undefined)
    : undefined;
}

function boolAttr(node: Element, name: string): boolean | undefined {
  const value = attr(node, name);
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function numberAttr(node: Element, name: string): number | undefined {
  const value = attr(node, name);
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function collapse(text: string): string {
  return text.replace(/[ \t\r\n]+/g, " ");
}

// An element's text, its whitespace collapsed and trimmed.
function textOf(node: Element | null): string | undefined {
  return node
    ? collapse(node.textContent ?? "").replace(/^ | $/g, "")
    : undefined;
}

// Set the fields that are present, so a missing one stays missing.
function assign(target: Fields, fields: Fields): Fields {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) target[key] = value;
  }
  return target;
}

// The words of a mixed-content element and the marks around them, as a flat
// list of { text, marks, hint } pieces and the other runs, in order.
function readInline(
  node: Node,
  marks: Marks,
  hint: Hint | undefined,
  out: Piece[],
  { spoken }: { spoken: boolean },
): Piece[] {
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (isText(n)) {
      out.push({ text: collapse(n.data), marks, hint });
      continue;
    }
    if (!isOslf(n)) continue;
    const name = n.localName;
    if (!spoken && (name === "b" || name === "i" || name === "u")) {
      const mark = ({ b: "bold", i: "italic", u: "underline" } as const)[name];
      readInline(n, { ...marks, [mark]: true }, hint, out, { spoken });
    } else if (name === "phoneme") {
      const ph = attr(n, "ph");
      readInline(n, marks, ph ? { ipa: ph } : hint, out, { spoken });
    } else if (name === "sub") {
      const alias = attr(n, "alias");
      readInline(n, marks, alias ? { alias } : hint, out, { spoken });
    } else if (name === "say-as") {
      const sayAs = attr(n, "interpret-as");
      readInline(n, marks, sayAs ? { sayAs } : hint, out, { spoken });
    } else if (name === "break") {
      out.push({
        run: { pause: attr(n, "strength") === "strong" ? "long" : "short" },
      });
    } else if (!spoken && name === "note") {
      const note = assign(
        {},
        {
          source: attr(n, "source"),
          locator: attr(n, "locator"),
          text: textOf(n) || undefined,
        },
      );
      out.push({ run: { note } });
    } else if (!spoken && name === "m") {
      out.push({ run: { math: mathFrom(n) } });
    } else {
      // An element this version doesn't define: keep its words.
      readInline(n, marks, hint, out, { spoken });
    }
  }
  return out;
}

function sameFlags(a: Marks | Hint | undefined, b: Marks | Hint | undefined) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Pieces into runs: whitespace collapsed across neighboring words, trimmed
// at the element's edges, neighboring words with the same marks joined, and
// plain words as plain strings.
function runsFrom(pieces: Piece[]): Array<string | OtherRun | Fields> {
  // The element's leading and trailing whitespace, however many pieces of
  // words it is spread over before the first (or after the last) real word.
  for (const piece of pieces) {
    if (piece.text === undefined) break;
    piece.text = piece.text.replace(/^ /, "");
    if (piece.text) break;
  }
  for (const piece of [...pieces].reverse()) {
    if (piece.text === undefined) break;
    piece.text = piece.text.replace(/ $/, "");
    if (piece.text) break;
  }
  const runs: Array<OtherRun | Words> = [];
  let last: Words | null = null;
  for (const piece of pieces) {
    if (piece.run) {
      runs.push(piece.run);
      last = null;
      continue;
    }
    let { text } = piece;
    if (last && last.text.endsWith(" ") && text.startsWith(" ")) {
      text = text.slice(1);
    }
    if (!text) continue;
    if (
      last &&
      sameFlags(last.marks, piece.marks) &&
      sameFlags(last.hint, piece.hint)
    ) {
      last.text += text;
      continue;
    }
    last = { text, marks: piece.marks, hint: piece.hint };
    runs.push(last);
  }
  return runs.map((run) => {
    if (!("marks" in run)) return run;
    const marks = Object.keys(run.marks).length || run.hint;
    return marks ? { text: run.text, ...run.marks, ...run.hint } : run.text;
  });
}

// Rich text in the JSON form's smallest shape: a string when it is only words.
function compact<T>(runs: Array<string | T>): string | Array<string | T> {
  if (!runs.length) return "";
  if (runs.length === 1 && typeof runs[0] === "string") return runs[0];
  return runs;
}

function richFrom(node: Element) {
  return compact(
    runsFrom(readInline(node, {}, undefined, [], { spoken: false })),
  );
}

function spokenFrom(node: Element) {
  return compact(
    runsFrom(readInline(node, {}, undefined, [], { spoken: true })),
  );
}

function mathFrom(node: Element): Fields {
  const spoken = child(node, "spoken");
  return assign(
    {
      format: attr(node, "format") ?? "",
      source: textOf(child(node, "source")) ?? "",
    },
    {
      display: boolAttr(node, "display"),
      spoken: spoken ? spokenFrom(spoken) : undefined,
    },
  );
}

function imageFrom(node: Element): Fields {
  const credit = child(node, "credit");
  const caption = child(node, "caption");
  return assign(
    { src: attr(node, "src") ?? "" },
    {
      size: attr(node, "size"),
      align: attr(node, "align"),
      width: numberAttr(node, "width"),
      height: numberAttr(node, "height"),
      alt: textOf(child(node, "alt")),
      caption: caption ? richFrom(caption) : undefined,
      credit: credit
        ? assign(
            {},
            {
              text: textOf(credit) || undefined,
              author: attr(credit, "author"),
              license: attr(credit, "license"),
              licenseUrl: attr(credit, "license-url"),
              sourceUrl: attr(credit, "source-url"),
            },
          )
        : undefined,
    },
  );
}

function blockFrom(node: Element): Fields | null {
  const id = attr(node, "id");
  switch (node.localName) {
    case "passage":
      return assign(
        { type: "passage", paragraphs: childElements(node, "p").map(richFrom) },
        { id },
      );
    case "spelling":
      return assign(
        { type: "spelling", words: childElements(node, "word").map(textOf) },
        { id },
      );
    case "image":
      return assign({ type: "image" }, { id, ...imageFrom(node) });
    case "question": {
      const answers = childElements(node, "answer").map(textOf);
      const working = childElements(node, "step").map(richFrom);
      const prompt = child(node, "prompt");
      return assign(
        {
          type: "question",
          questionType: attr(node, "type") ?? "",
          prompt: prompt ? richFrom(prompt) : "",
        },
        {
          id,
          answerKey: attr(node, "answer-key"),
          answers: answers.length ? answers : undefined,
          working: working.length ? working : undefined,
          threeBoard: boolAttr(node, "three-board"),
          besides: attr(node, "besides"),
        },
      );
    }
    case "vakt": {
      const links = childElements(node, "link").map((link) =>
        assign(
          { url: attr(link, "url") ?? "" },
          { label: textOf(link) || undefined },
        ),
      );
      const image = child(node, "image");
      return assign(
        { type: "vakt", text: textOf(child(node, "text")) ?? "" },
        {
          id,
          links: links.length ? links : undefined,
          image: image ? imageFrom(image) : undefined,
        },
      );
    }
    case "heading":
      return assign({ type: "heading", text: richFrom(node) }, { id });
    default:
      return null;
  }
}

function sourceFrom(node: Element): Fields {
  return assign(
    { id: attr(node, "id") ?? "" },
    Object.fromEntries(
      ["title", "author", "publisher", "year", "url"].map((field) => [
        field,
        textOf(child(node, field)),
      ]),
    ),
  );
}

/**
 * An OSLF XML lesson as the OSLF lesson file (the JSON form's object), for
 * fromOslf to read. Throws OslfImportError for something that isn't one: XML
 * that doesn't parse, a file with a DOCTYPE, or a root that isn't an OSLF
 * <lesson>. It reads what the structure holds; the data model's own rules are
 * fromOslf's to apply, so the object is in the file's shape but nothing in
 * it is checked, which is why it comes back as `unknown`.
 */
export function fromOslfXml(text: string): unknown {
  const problems: string[] = [];
  let doc: Document | null;
  try {
    doc = new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") problems.push(message);
      },
    }).parseFromString(String(text ?? ""), "application/xml");
  } catch {
    doc = null;
  }
  if (!doc || problems.length || !doc.documentElement) {
    throw new OslfImportError(
      "This file isn't valid XML. It may be corrupted or not a lesson file.",
    );
  }
  // A DOCTYPE is how an XML file reaches for local files and the network
  // (external entities and DTDs), so the format forbids one outright.
  if (doc.doctype) {
    throw new OslfImportError(
      "This XML file has a DOCTYPE, which an OSLF lesson file must not have.",
    );
  }
  const root = doc.documentElement;
  if (!isOslf(root) || root.localName !== "lesson") {
    throw new OslfImportError("This XML file isn't an OSLF lesson.");
  }

  const authors = childElements(root, "author").map((node) =>
    assign({ name: textOf(node) ?? "" }, { url: attr(node, "url") }),
  );
  const profiles = childElements(root, "profile")
    .map((node) => attr(node, "ref"))
    .filter(Boolean);
  const sources = childElements(root, "source").map(sourceFrom);
  const sections = childElements(root, "section").map((node) =>
    assign(
      {
        blocks: childElements(node)
          .map(blockFrom)
          .filter((block) => block !== null),
      },
      { id: attr(node, "id"), title: textOf(child(node, "title")) },
    ),
  );

  // In the JSON form's field order, so the two forms of one lesson compare
  // equal field for field.
  const file = assign(
    {},
    {
      oslf: attr(root, "version") ?? "",
      title: textOf(child(root, "title")) ?? "",
      id: attr(root, "id"),
      language: attr(root, "language"),
      license: attr(root, "license"),
      authors: authors.length ? authors : undefined,
      created: attr(root, "created"),
      modified: attr(root, "modified"),
      ageRange: attr(root, "age-range"),
      profiles: profiles.length ? profiles : undefined,
      sources: sources.length ? sources : undefined,
    },
  );
  file.sections = sections;
  return file;
}
