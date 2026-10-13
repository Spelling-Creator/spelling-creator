// The Open Spelling Lesson Format's XML form: an OSLF lesson file written as
// XML, and read back.
//
// OSLF is one data model with two serializations, JSON and XML, and the spec
// (XML-FORMAT.md in the format's repository) says converting between them loses
// nothing but collapsible whitespace. So this module converts between the two
// forms of the *file*, never the app's lesson: toOslfXml takes what toOslf in
// oslf.js writes, and fromOslfXml gives what fromOslf reads. The mapping from
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

import { DOMParser } from "@xmldom/xmldom";
import { lessonFileBase } from "./lessonFile.js";
import { OslfImportError } from "./oslf.js";

/** The namespace every element of an OSLF lesson file is in. */
export const OSLF_NAMESPACE = "urn:oslf:lesson";

/** The file name extension the format recommends for its XML form. */
export const OSLF_XML_EXTENSION = ".oslf.xml";

/**
 * A file name for a lesson exported as OSLF XML, from its title.
 * @param {string} [title]
 * @returns {string}
 */
export function oslfXmlFileName(title) {
  return `${lessonFileBase(title)}${OSLF_XML_EXTENSION}`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function escapeText(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text) {
  return escapeText(text).replace(/"/g, "&quot;");
}

// ` name="value"` for each attribute that has a value, in the order given.
function attrs(pairs) {
  return pairs
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join("");
}

function element(name, pairs, content) {
  const open = `<${name}${attrs(pairs)}`;
  return content ? `${open}>${content}</${name}>` : `${open}/>`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runsOf(value) {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value : [];
}

// A text run's words with its hint innermost, then <u>, <i> and <b> outside
// it, the order the spec asks producers to write.
function textRunXml(run) {
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

function pauseXml(pause) {
  return element("break", [
    ["strength", pause === "long" ? "strong" : "medium"],
  ]);
}

// Spoken text: words, the three hints and pauses (no formatting, no notes).
function spokenXml(value) {
  return runsOf(value)
    .map((run) => {
      if (typeof run === "string") return escapeText(run);
      if (!isObject(run)) return "";
      if (run.pause) return pauseXml(run.pause);
      if (typeof run.text === "string") return textRunXml(run);
      return "";
    })
    .join("");
}

function mathXml(math) {
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
 * @param {unknown} value  A string or a list of runs.
 * @returns {string}
 */
export function richTextXml(value) {
  return runsOf(value)
    .map((run) => {
      if (typeof run === "string") return escapeText(run);
      if (!isObject(run)) return "";
      if (isObject(run.note)) {
        return element(
          "note",
          [
            ["source", run.note.source],
            ["locator", run.note.locator],
          ],
          escapeText(run.note.text ?? ""),
        );
      }
      if (isObject(run.math)) return mathXml(run.math);
      if (run.pause) return pauseXml(run.pause);
      if (typeof run.text === "string") return textRunXml(run);
      return "";
    })
    .join("");
}

// An element holding text, on one line, or nothing when there is no text.
function textElement(name, text, pairs = []) {
  if (typeof text !== "string") return null;
  return element(name, pairs, escapeText(text));
}

function richElement(name, value, pairs = []) {
  return element(name, pairs, richTextXml(value));
}

function bool(value) {
  return value === true ? "true" : value === false ? "false" : undefined;
}

function imageXml(image, name = "image") {
  const children = [];
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
function blockTree(block) {
  const id = ["id", block.id];
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
function render(tree, depth) {
  const pad = "  ".repeat(depth);
  if (tree.inline !== undefined) {
    return [`${pad}${element(tree.name, tree.pairs, tree.inline)}`];
  }
  const children = tree.children.filter(Boolean);
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

function sourceTree(source) {
  return {
    name: "source",
    pairs: [["id", source.id]],
    children: ["title", "author", "publisher", "year", "url"].map((field) =>
      textElement(field, source[field]),
    ),
  };
}

/**
 * An OSLF lesson file (the object toOslf writes) as its XML form.
 * @param {object} file
 * @returns {string}
 */
export function toOslfXml(file) {
  const root = {
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
      ...(file.sections || []).map((section) => ({
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

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

function isOslf(node) {
  return node.nodeType === ELEMENT_NODE && node.namespaceURI === OSLF_NAMESPACE;
}

function childElements(node, name) {
  const out = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (isOslf(child) && (!name || child.localName === name)) out.push(child);
  }
  return out;
}

function child(node, name) {
  return childElements(node, name)[0] ?? null;
}

function attr(node, name) {
  return node.hasAttribute(name) ? node.getAttribute(name) : undefined;
}

function boolAttr(node, name) {
  const value = attr(node, name);
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function numberAttr(node, name) {
  const value = attr(node, name);
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function collapse(text) {
  return text.replace(/[ \t\r\n]+/g, " ");
}

// An element's text, its whitespace collapsed and trimmed.
function textOf(node) {
  return node
    ? collapse(node.textContent ?? "").replace(/^ | $/g, "")
    : undefined;
}

// Set the fields that are present, so a missing one stays missing.
function assign(target, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) target[key] = value;
  }
  return target;
}

// The words of a mixed-content element and the marks around them, as a flat
// list of { text, marks, hint } pieces and the other runs, in order.
function readInline(node, marks, hint, out, { spoken }) {
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === TEXT_NODE || n.nodeType === CDATA_SECTION_NODE) {
      out.push({ text: collapse(n.data), marks, hint });
      continue;
    }
    if (!isOslf(n)) continue;
    const name = n.localName;
    if (!spoken && (name === "b" || name === "i" || name === "u")) {
      const mark = { b: "bold", i: "italic", u: "underline" }[name];
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

function sameFlags(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Pieces into runs: whitespace collapsed across neighbouring words, trimmed
// at the element's edges, neighbouring words with the same marks joined, and
// plain words as plain strings.
function runsFrom(pieces) {
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
  const runs = [];
  let last = null;
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
function compact(runs) {
  if (!runs.length) return "";
  if (runs.length === 1 && typeof runs[0] === "string") return runs[0];
  return runs;
}

function richFrom(node) {
  return compact(
    runsFrom(readInline(node, {}, undefined, [], { spoken: false })),
  );
}

function spokenFrom(node) {
  return compact(
    runsFrom(readInline(node, {}, undefined, [], { spoken: true })),
  );
}

function mathFrom(node) {
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

function imageFrom(node) {
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

function blockFrom(node) {
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

function sourceFrom(node) {
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
 * fromOslf's to apply.
 * @param {string} text
 * @returns {object}
 */
export function fromOslfXml(text) {
  const problems = [];
  let doc;
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
      { blocks: childElements(node).map(blockFrom).filter(Boolean) },
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
