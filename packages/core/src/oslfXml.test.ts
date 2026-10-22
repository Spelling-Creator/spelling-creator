// The OSLF XML form: what toOslfXml writes has to pass the format's own XSD,
// and converting between the two forms has to lose nothing. The format's
// example lesson exists in both forms (oslf-examples/, copied from the
// format's repository), so each must turn into the other exactly.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { validateXML } from "xmllint-wasm";

import { normalizeLessonFile } from "./jsonImport.ts";
import { markupToContent } from "./lessonText.ts";
import { OslfImportError, fromOslf, toOslf } from "./oslf.ts";
import {
  OSLF_XML_EXTENSION,
  fromOslfXml,
  oslfXmlFileName,
  toOslfXml,
} from "./oslfXml.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const XSD = read("./oslf.xsd");
const EXAMPLE_JSON = JSON.parse(read("./oslf-examples/lighthouses.oslf.json"));
const EXAMPLE_XML = read("./oslf-examples/lighthouses.oslf.xml");
const validateJson = new Ajv2020({ allErrors: true, strict: false }).compile(
  JSON.parse(read("./oslf.schema.json")),
);

async function xsdErrors(xml) {
  const result = await validateXML({
    xml: [{ fileName: "lesson.oslf.xml", contents: xml }],
    schema: [{ fileName: "oslf.xsd", contents: XSD }],
  });
  return result.valid ? [] : result.errors.map((e) => e.rawMessage);
}

describe("the format's example lesson", () => {
  it("reads the XML form as the JSON form", () => {
    expect(fromOslfXml(EXAMPLE_XML)).toEqual(EXAMPLE_JSON);
  });

  it("writes the JSON form as XML the XSD accepts, which reads back the same", async () => {
    const xml = toOslfXml(EXAMPLE_JSON);
    expect(await xsdErrors(xml)).toEqual([]);
    expect(fromOslfXml(xml)).toEqual(EXAMPLE_JSON);
  });

  it("holds the example's XML to the XSD too, so the copy is the right one", async () => {
    expect(await xsdErrors(EXAMPLE_XML)).toEqual([]);
  });
});

describe("a lesson from the app", () => {
  const doc = {
    title: "Lenses & <Lights>",
    ageRange: "11-14 years",
    sources: [
      {
        id: "fresnel",
        title: "Fresnel lens",
        url: "https://example.org/a?b=1&c=2",
      },
    ],
    sections: [
      {
        id: "s1",
        name: "Telling Lights Apart",
        blocks: [
          {
            id: "t1",
            type: "text",
            content: markupToContent(
              'Augustin **[FRESNEL]{ipa: freɪˈnɛl}** wrote "a < b" & *more*.^[@fresnel, p. 3 | A note.]{pause: long}The [WWF]{say: World Wide Fund} and [REEF]{spell}{pause}end.',
            ),
          },
          {
            id: "q1",
            type: "question",
            questionType: "number",
            prompt: "How many flashes in a minute?",
            answer: "12",
            steps: [{ id: "st1", text: "60 divided by 5 is 12." }],
          },
        ],
      },
    ],
  };

  it("survives JSON to XML to JSON, and the XML is valid", async () => {
    const file = toOslf(doc);
    expect(validateJson(file)).toBe(true);
    const xml = toOslfXml(file);
    expect(await xsdErrors(xml)).toEqual([]);
    expect(fromOslfXml(xml)).toEqual(file);
    // And on into the app, as the same lesson the JSON form gives.
    expect(fromOslf(fromOslfXml(xml))).toEqual(fromOslf(file));
  });

  it("escapes what an author writes, so it can't become markup", () => {
    const xml = toOslfXml(toOslf(doc));
    expect(xml).toContain("<title>Lenses &amp; &lt;Lights&gt;</title>");
    expect(xml).toContain("url>https://example.org/a?b=1&amp;c=2</url>");
    expect(xml).toContain(
      '<b><phoneme alphabet="ipa" ph="freɪˈnɛl">FRESNEL</phoneme></b>',
    );
    expect(xml).toContain('<break strength="strong"/>');
    expect(xml).toContain('<sub alias="World Wide Fund">WWF</sub>');
    expect(xml).toContain('<say-as interpret-as="characters">REEF</say-as>');
  });
});

describe("reading", () => {
  const wrap = (body) =>
    `<?xml version="1.0"?><lesson xmlns="urn:oslf:lesson" version="0.1"><title>T</title><section>${body}</section></lesson>`;

  it("collapses whitespace in text, and trims it at an element's edges", () => {
    const file = fromOslfXml(
      wrap(`<passage><p>
        One   line
        wrapped <b> over </b>  two.
      </p></passage>`),
    );
    expect(file.sections[0].blocks[0].paragraphs).toEqual([
      ["One line wrapped ", { text: "over ", bold: true }, "two."],
    ]);
  });

  it("reads marks in any nesting, and keeps a hint innermost", () => {
    const file = fromOslfXml(
      wrap(
        '<passage><p><u><b><phoneme alphabet="ipa" ph="ˈbuːi">buoy</phoneme></b></u></p></passage>',
      ),
    );
    expect(file.sections[0].blocks[0].paragraphs).toEqual([
      [{ text: "buoy", bold: true, underline: true, ipa: "ˈbuːi" }],
    ]);
  });

  it("keeps the words of an element it doesn't know, and skips other namespaces' blocks", () => {
    const file = fromOslfXml(
      wrap(
        '<passage><p>a <emphasis>b</emphasis> c</p></passage><x:extra xmlns:x="https://example.org/x"/>',
      ),
    );
    expect(file.sections[0].blocks).toEqual([
      { type: "passage", paragraphs: ["a b c"] },
    ]);
  });

  it("refuses a DOCTYPE, and never expands its entities", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE lesson [<!ENTITY x SYSTEM "file:///etc/passwd">]><lesson xmlns="urn:oslf:lesson" version="0.1"><title>&x;</title><section/></lesson>`;
    expect(() => fromOslfXml(xml)).toThrow(OslfImportError);
  });

  it("refuses what isn't XML, or isn't an OSLF lesson", () => {
    expect(() => fromOslfXml("{}")).toThrow(/isn't valid XML/);
    expect(() => fromOslfXml("<lesson><title>T</title>")).toThrow(
      /isn't valid XML/,
    );
    expect(() => fromOslfXml('<lesson version="0.1"/>')).toThrow(
      /isn't an OSLF lesson/,
    );
  });
});

describe("the import door and the file's name", () => {
  it("lets the lesson-file importer read the XML form", () => {
    const viaJson = normalizeLessonFile(EXAMPLE_JSON);
    expect(normalizeLessonFile(fromOslfXml(EXAMPLE_XML)).title).toBe(
      viaJson.title,
    );
  });

  it("names the file with the format's XML extension", () => {
    expect(oslfXmlFileName("Lighthouses")).toMatch(
      new RegExp(`${OSLF_XML_EXTENSION.replace(".", "\\.")}$`),
    );
  });
});
