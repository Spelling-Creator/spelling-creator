// The text of a file someone wants to import a lesson from. A Word file is read
// as raw text through mammoth (the same converter docxImport.ts uses, but with
// no interest in styles: a hand-written document has none we know). Anything
// else is taken as plain text.

import mammoth from "mammoth";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function documentFileText(file: File): Promise<string> {
  const isDocx = file.type === DOCX_TYPE || /\.docx$/i.test(file.name || "");
  if (!isDocx) return file.text();
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value;
}
