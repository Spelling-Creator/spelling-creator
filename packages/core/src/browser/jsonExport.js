// Download a lesson as a .json file. The envelope itself lives in
// ../lessonFile.js, which the importer and the MCP server share; this is only
// the part that needs a document to click an <a> for the user.

import { buildLessonFile, lessonFileName } from "../lessonFile.js";
import { oslfFileName, toOslf } from "../oslf.js";
import { imagePublicUrl } from "./imageRef.js";

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

// Serialise the doc and download it as a .json file.
export function exportJson(doc) {
  const json = JSON.stringify(buildLessonFile(doc), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  triggerDownload(blob, lessonFileName(doc.title));
}

// Download the lesson as an Open Spelling Lesson Format file, for tools that
// aren't this app. Pictures are referred to by their public URL on the hub,
// so one that was never uploaded (a draft kept on this device) won't show
// for whoever opens the file elsewhere.
export function exportOslf(doc) {
  const file = toOslf(doc, {
    imageSrc: (block) => imagePublicUrl(block.image.hash),
  });
  const json = JSON.stringify(file, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  triggerDownload(blob, oslfFileName(doc.title));
}
