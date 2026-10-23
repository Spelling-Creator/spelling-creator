// Download a lesson as a .json file. The envelope itself lives in
// ../lessonFile.ts, which the importer and the MCP server share; this is only
// the part that needs a document to click an <a> for the user.

import { buildLessonFile, lessonFileName } from "../lessonFile.ts";
import { type OslfFile, oslfFileName, toOslf } from "../oslf.ts";
import type { LessonDoc } from "../types.ts";
import { imagePublicUrl } from "./imageRef.ts";

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Serialise the doc and download it as a .json file.
export function exportJson(doc: LessonDoc): void {
  const json = JSON.stringify(buildLessonFile(doc), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  triggerDownload(blob, lessonFileName(doc.title));
}

// Download the lesson as an Open Spelling Lesson Format file, for tools that
// aren't this app. Pictures are referred to by their public URL on the hub,
// so one that was never uploaded (a draft kept on this device) won't show
// for whoever opens the file elsewhere.
export function exportOslf(doc: LessonDoc): void {
  const json = JSON.stringify(oslfOf(doc), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  triggerDownload(blob, oslfFileName(doc.title));
}

// The same file in the format's XML form. The XML writer is only loaded when
// someone asks for one.
export async function exportOslfXml(doc: LessonDoc): Promise<void> {
  const file = oslfOf(doc);
  const { oslfXmlFileName, toOslfXml } = await import("../oslfXml.ts");
  const blob = new Blob([toOslfXml(file)], { type: "application/xml" });
  triggerDownload(blob, oslfXmlFileName(doc.title));
}

function oslfOf(doc: LessonDoc): OslfFile {
  return toOslf(doc, {
    imageSrc: (block) =>
      block.image?.hash ? imagePublicUrl(block.image.hash) : null,
  });
}
