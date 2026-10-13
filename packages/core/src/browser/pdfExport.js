// Print a lesson to PDF by way of the Word document: build the docx, convert it
// to HTML with mammoth, then render that HTML with html2pdf.js. Going through
// the docx is what makes the PDF match the exported .docx page for page.
//
// This is the only path in the app that does so. The editor's preview dialog and
// the public lesson page both render the lesson model directly (LessonView), so
// `docx` + `mammoth` are reachable only from Export, Save to Drive and this
// file — never from simply looking at a lesson.
import html2pdf from "html2pdf.js";
import mammoth from "mammoth";
import { Packer } from "docx";
import { buildDocument } from "./docxExport.js";
import {
  LEGEND_SEPARATOR,
  QUESTION_LINE_CLASS,
  QUESTION_LINE_STYLE_NAME,
  SOURCE_ENTRY_CLASS,
  SOURCE_ENTRY_STYLE_NAME,
  SOURCES_HEADING_CLASS,
  SOURCES_HEADING_STYLE_NAME,
  TITLE_CLASS,
  TITLE_LINE_CLASS,
  TITLE_LINE_STYLE_NAME,
  TITLE_STYLE_NAME,
  lessonCopyright,
} from "../lessonLayout.js";
import {
  BESIDES_LINE_CLASS,
  QUESTION_TAG_STYLE_CLASS,
  QUESTION_TYPE_LIST,
  besidesStyleMap,
  questionLegendFor,
  questionLegendText,
  questionStyleClass,
  questionStyleMap,
  questionTagStyleMap,
} from "../questions.js";
import { HEADING_STYLE_CLASS, headingStyleMap } from "../heading.js";
import { VAKT_COLOR, VAKT_STYLE_CLASS, vaktStyleMap } from "../vakt.js";

// Text destined for an HTML string we build ourselves. The PDF container is
// filled with innerHTML, so anything interpolated into it has to arrive as text.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// mammoth converts each image to a natural-size <img> in its own <p> and drops the
// block's picked size + alignment (and the caption's alignment). Re-apply both by
// wrapping each image, and its caption and credit if it has them, in a
// fixed-width <figure>:
//
//   - The figure's width is the SAME px size the docx used — not recomputed
//     here, but reported by buildDocument as it embedded each picture — so the
//     image is identical in the PDF and in the Word file, not stretched to the
//     container.
//   - max-width:100% lets it shrink on a narrow page; the image fills the figure.
//   - The figure is aligned via auto side-margins (it's block-level with a set
//     width), and the caption lives inside it, so the caption always tracks the
//     image instead of floating left across the full width.
//
// `embedded` is what the exporter ACTUALLY put in the document, not every block
// that holds a picture — the two differ, and the difference matters. An image
// whose bytes can't be fetched is written as "[image could not be embedded]"
// text and produces no <img> at all, so listing it here would frame the next
// real image with the wrong width and alignment and shift every image after it.
//
// The caption and credit are taken from that list and escaped, NOT copied out
// of mammoth's HTML: the text is ours either way, and taking it from the model
// means nothing that came back through the converter is re-inserted as markup.
// buildDocument emits a caption paragraph and a credit paragraph only for a
// picture that has them, so only that many trailing paragraphs are consumed
// and following content is left untouched.
//
// Those optional trailing paragraphs must not be image paragraphs. `replace`
// resumes scanning after the whole match, so a swallowed `<p><img></p>` is
// re-emitted verbatim and never matched again: with two images in a row the
// second would keep mammoth's natural size, lose its alignment and caption, and
// throw the block pairing off by one for every image after it. The lookahead
// leaves an image paragraph for the next iteration to claim.
export function layoutImageFigures(html, embedded) {
  let index = 0;
  return html.replace(
    /<p>\s*(<img\b[^>]*>)\s*<\/p>(\s*<p>(?!\s*<img\b)[\s\S]*?<\/p>)?(\s*<p>(?!\s*<img\b)[\s\S]*?<\/p>)?/g,
    (match, imgTag, firstTrailing, secondTrailing) => {
      const picture = embedded[index++];
      if (!picture) return match;

      const {
        width,
        align,
        caption: captionText,
        credit: creditText,
      } = picture;
      const figMargin =
        align === "left"
          ? "16px auto 16px 0"
          : align === "right"
            ? "16px 0 16px auto"
            : "16px auto";

      // Strip mammoth's own width/height/style so the figure controls the size.
      const img = imgTag.replace(/\s(?:width|height|style)="[^"]*"/g, "");

      const caption = captionText
        ? `<div style="text-align:center;font-style:italic;color:#555;font-size:12px;margin-top:6px;">${escapeHtml(
            captionText,
          )}</div>`
        : "";
      const credit = creditText
        ? `<div style="text-align:center;color:#777;font-size:9px;margin-top:2px;">${escapeHtml(
            creditText,
          )}</div>`
        : "";
      const figcaption =
        caption || credit ? `<figcaption>${caption}${credit}</figcaption>` : "";
      const figure = `<figure style="display:block;width:${Math.round(
        width,
      )}px;max-width:100%;margin:${figMargin};">${img}${figcaption}</figure>`;

      // Any trailing paragraph beyond the caption and credit lines is real
      // content (the next block): put it back rather than swallowing it.
      const consumed = (captionText ? 1 : 0) + (creditText ? 1 : 0);
      const trailing = [firstTrailing, secondTrailing].filter(Boolean);
      return figure + trailing.slice(consumed).join("");
    },
  );
}

// mammoth drops run colours and paragraph alignment, so neither the question
// colour coding nor the centred title lines survive the conversion on their own.
// The docx marks both with named Word styles for exactly this reason; mapping
// those styles onto classes here lets PRINT_STYLES put the formatting back.
const STYLE_MAP = [
  ...questionStyleMap(),
  ...questionTagStyleMap(),
  ...besidesStyleMap(),
  ...headingStyleMap(),
  ...vaktStyleMap(),
  `p[style-name='${TITLE_STYLE_NAME}'] => p.${TITLE_CLASS}:fresh`,
  `p[style-name='${TITLE_LINE_STYLE_NAME}'] => p.${TITLE_LINE_CLASS}:fresh`,
  `p[style-name='${QUESTION_LINE_STYLE_NAME}'] => p.${QUESTION_LINE_CLASS}:fresh`,
  `p[style-name='${SOURCES_HEADING_STYLE_NAME}'] => p.${SOURCES_HEADING_CLASS}:fresh`,
  `p[style-name='${SOURCE_ENTRY_STYLE_NAME}'] => p.${SOURCE_ENTRY_CLASS}:fresh`,
  // mammoth drops underlining unless asked to keep it.
  "u => u",
];

// What the footnotes are headed with once they become a list at the end.
const NOTES_HEADING_TEXT = "Notes";

// mammoth turns the docx's footnotes into an <ol> at the very end of the HTML,
// after the Sources list, with a "back to the text" arrow on each. A page has no
// foot to put them at, so they print as endnotes: moved above the Sources list,
// headed "Notes", and without the arrows, which link nowhere on paper.
export function layoutNotes(html) {
  const match = html.match(
    /<ol>(?:(?!<ol>)[\s\S])*?<li id="footnote-1">[\s\S]*<\/ol>\s*$/,
  );
  if (!match) return html;
  const list = match[0].replace(
    /\s*<a href="#footnote-ref-\d+">[^<]*<\/a>/g,
    "",
  );
  const notes = `<p class="s2c-notes-heading"><strong>${NOTES_HEADING_TEXT}</strong></p>${list.replace(
    "<ol>",
    '<ol class="s2c-notes">',
  )}`;
  const body = html.slice(0, match.index);
  const sourcesAt = body.indexOf(`<p class="${SOURCES_HEADING_CLASS}">`);
  return sourcesAt === -1
    ? body + notes
    : body.slice(0, sourcesAt) + notes + body.slice(sourcesAt);
}

// Build the docx in memory and convert it to HTML with mammoth, so the PDF
// matches what the docx export produces. Returns an HTML string.
async function docToHtml(doc, meta) {
  // Filled in as the document is built, with one entry per picture that really
  // made it in — see layoutImageFigures for why "really" is load-bearing.
  const embedded = [];
  const document = await buildDocument(doc, meta, embedded);
  const blob = await Packer.toBlob(document);
  const arrayBuffer = await blob.arrayBuffer();
  // mammoth inlines images as base64 data URIs by default; layoutImageFigures then
  // restores each image's picked size + alignment (and its caption's placement).
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer },
    { styleMap: STYLE_MAP },
  );
  return layoutNotes(layoutImageFigures(html, embedded));
}

// Print styles applied to the mammoth-generated HTML before rendering to PDF.
// The question-type colours are restored here from the classes STYLE_MAP asked
// mammoth to emit, and the type tag in front of each prompt is set small and
// grey so it reads as a mark rather than as the first word of the question.
const PRINT_STYLES = `
  .s2c-pdf-root {
    font-family: 'Roboto', 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a1a;
    line-height: 1.45;
    font-size: 14px;
  }
  .s2c-pdf-root .${TITLE_CLASS}, .s2c-pdf-root h1 {
    text-align: center;
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 4px;
    color: #1a1a1a;
  }
  .s2c-pdf-root .${TITLE_LINE_CLASS} {
    text-align: center;
    margin: 0 0 2px;
  }
  .s2c-pdf-root .${TITLE_LINE_CLASS}:last-of-type { margin-bottom: 16px; }
  .s2c-pdf-root p { margin: 0 0 6px; }
  /* Questions run tight against one another, the way the printed lesson sets
     them — the colour, not the spacing, is what separates one from the next. */
  .s2c-pdf-root .${QUESTION_LINE_CLASS} { margin: 0 0 1px; }
  /* The Besides line under a three-board question, indented like its working
     would be. Its label comes through in the question's own character style,
     so the type rule below colours it; the answers after it stay in the body
     colour, as in Word. */
  .s2c-pdf-root .${BESIDES_LINE_CLASS} {
    margin: 0 0 1px;
    padding-left: 24px;
  }
  .s2c-pdf-root .${HEADING_STYLE_CLASS} {
    margin: 10px 0 3px;
    font-weight: 700;
  }
  .s2c-pdf-root figure { margin: 0; }
  .s2c-pdf-root img {
    display: block;
    width: 100%;
    height: auto;
  }
  ${QUESTION_TYPE_LIST.map(
    (type) =>
      `.s2c-pdf-root .${questionStyleClass(type.key)} { color: ${type.color};` +
      `${type.italic ? " font-style: italic;" : ""} }`,
  ).join("\n  ")}
  .s2c-pdf-root .${QUESTION_TAG_STYLE_CLASS} {
    color: #555555;
    font-weight: 700;
    font-size: 11px;
  }
  .s2c-pdf-root .${VAKT_STYLE_CLASS} { color: ${VAKT_COLOR}; }
  .s2c-pdf-root sup { font-size: 9px; line-height: 0; }
  .s2c-pdf-root sup a { color: inherit; text-decoration: none; }
  .s2c-pdf-root .s2c-notes-heading,
  .s2c-pdf-root .${SOURCES_HEADING_CLASS} { margin: 18px 0 4px; }
  .s2c-pdf-root .s2c-notes { margin: 0; padding-left: 22px; font-size: 11px; }
  .s2c-pdf-root .s2c-notes p { margin: 0 0 2px; }
  .s2c-pdf-root .${SOURCE_ENTRY_CLASS} {
    margin: 0 0 3px;
    padding-left: 22px;
    text-indent: -22px;
    font-size: 12px;
  }
  .s2c-pdf-root .${SOURCE_ENTRY_CLASS} a { color: inherit; }
`;

// Page geometry, shared by the html2pdf options and the footer drawing below.
const PAGE_WIDTH = 794; // A4 at 96dpi
const PAGE_HEIGHT = 1123;
const MARGIN = 38; // ~10mm
// The bottom margin is deeper than the others to leave the copyright line and
// the legend a strip of their own, clear of the body text.
const FOOTER_MARGIN = 60;

function hexToRgb(color) {
  const value = parseInt(color.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// The legend naming each question type the lesson uses in its own colour,
// centred on `y`. Drawn segment by segment because each entry needs its own
// colour, so the line has to be measured first to know where to start.
function drawLegend(pdf, centerX, y, legendTypes) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);

  const parts = [];
  legendTypes.forEach((type, i) => {
    if (i > 0) parts.push({ text: LEGEND_SEPARATOR, rgb: [110, 110, 110] });
    parts.push({
      text: questionLegendText(type),
      rgb: hexToRgb(type.color),
      // Two types share the amber, and the italic is what separates them in the
      // body — so the legend entry has to be set the same way to name them.
      italic: Boolean(type.italic),
    });
  });

  // Measured with each part's own face selected: an italic entry is not the
  // same width as the upright one, and the line is centred on the total.
  const width = (part) => {
    pdf.setFont("helvetica", part.italic ? "italic" : "normal");
    return pdf.getTextWidth(part.text);
  };
  const total = parts.reduce((sum, p) => sum + width(p), 0);
  let x = centerX - total / 2;
  for (const part of parts) {
    pdf.setTextColor(part.rgb[0], part.rgb[1], part.rgb[2]);
    pdf.setFont("helvetica", part.italic ? "italic" : "normal");
    pdf.text(part.text, x, y);
    x += pdf.getTextWidth(part.text);
  }
  pdf.setFont("helvetica", "normal");
}

// The page number (top right) and the footer, on every page — the furniture
// html2pdf doesn't carry over from the docx's own header and footer, since
// mammoth converts only the document body.
function drawPageFurniture(pdf, meta, legendTypes) {
  const copyright = lessonCopyright(meta);
  const pageCount = pdf.internal.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(80, 80, 80);
    pdf.text(String(page), PAGE_WIDTH - MARGIN, MARGIN - 12, {
      align: "right",
    });

    if (copyright) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(26, 26, 26);
      pdf.text(copyright, PAGE_WIDTH / 2, PAGE_HEIGHT - 34, {
        align: "center",
      });
    }
    if (legendTypes.length) {
      drawLegend(pdf, PAGE_WIDTH / 2, PAGE_HEIGHT - 20, legendTypes);
    }
  }
}

function safeFileName(title) {
  const base = (title || "lesson")
    .trim()
    .replace(/[^a-z0-9\-_ ]/gi, "")
    .replace(/\s+/g, "-");
  return `${base || "lesson"}.pdf`;
}

// Build the docx, convert to HTML (mammoth), then render to a PDF (html2pdf.js).
// Resolves to the finished jsPDF document, which the two entry points below
// either save or print.
async function renderPdf(doc, meta) {
  // docToHtml builds the docx, converts it to HTML via mammoth and re-applies
  // each image's picked size + alignment, so the PDF mirrors the docx output.
  const html = await docToHtml(doc, meta);

  const container = window.document.createElement("div");
  container.className = "s2c-pdf-root";
  container.innerHTML = `<style>${PRINT_STYLES}</style>${html}`;
  // Size the content box to the printable width html2pdf renders into:
  // pageSize.inner.width = the A4-in-px page (794px) minus the 38px L/R page
  // margins set below = 718px. `border-box` keeps the padding *inside* that
  // width instead of adding to it, otherwise the box (718 + 2×40 = 798px)
  // overflows html2pdf's 718px container, gets clipped on the right by the
  // overlay's `overflow: hidden`, and every line is cut off / shifted right.
  container.style.boxSizing = "border-box";
  container.style.width = "718px";
  // Side padding, plus a few px at the foot. The page margins above already hold
  // the content clear of the paper edges, so a full 40px band here would sit
  // *inside* the flowed content and spill past the last page's end — enough on
  // its own to push out a trailing page carrying nothing but the footer. Drop it
  // to zero, though, and html2canvas captures the container at exactly its
  // content height, slicing the descenders off the document's very last line.
  // 10px clears them while staying well under a line's height.
  container.style.padding = "0 40px 10px";
  container.style.background = "#ffffff";

  // html2pdf renders by cloning the element we pass to `.from()` (cloneNode
  // copies inline styles) and re-hosting that clone inside its own on-screen,
  // opacity:0 overlay container. So the off-screen positioning has to live on
  // a *wrapper*, never on `container` itself. If `container` carried
  // `position: absolute; left: -10000px`, the clone would inherit it, drop out
  // of flow inside html2pdf's container (collapsing it to ~0 height) and shift
  // off-screen, so html2canvas would capture an empty box → a blank PDF.
  const offscreen = window.document.createElement("div");
  offscreen.style.position = "absolute";
  offscreen.style.left = "-10000px";
  offscreen.style.top = "0";
  offscreen.appendChild(container);
  window.document.body.appendChild(offscreen);

  try {
    const pdf = await html2pdf()
      .set({
        // Pixel units (not mm) on purpose. html2pdf places page breaks using a
        // page height it derives by rounding mm→px (floor(277mm) = 1046px), but
        // it slices the rendered canvas at a *separately* computed height
        // (floor(canvas.width × inner ratio) = 1046.5px). That ½px-per-page
        // mismatch makes the top sliver of each page's first line bleed onto the
        // bottom of the previous page — text cut off at the page edge — and it
        // grows with page count. Driving jsPDF in px with an integer A4 format
        // (794×1123px @96dpi) and integer 38px (~10mm) margins makes both
        // computations use the identical integer inner height (1047px), so the
        // break positions and the slice positions line up exactly.
        margin: [MARGIN, MARGIN, FOOTER_MARGIN, MARGIN],
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: {
          unit: "px",
          format: [PAGE_WIDTH, PAGE_HEIGHT],
          orientation: "portrait",
        },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      })
      .from(container)
      .toPdf()
      .get("pdf");
    // The page number and footer are drawn straight onto the finished pages:
    // they repeat on every one, so they can't come from the flowed HTML, and
    // the docx's own header/footer never reach mammoth.
    drawPageFurniture(pdf, meta, questionLegendFor(doc));
    return pdf;
  } finally {
    window.document.body.removeChild(offscreen);
  }
}

/**
 * Render the lesson to a PDF and download it.
 * @param {object} doc
 * @param {{author?: string, published?: string|number|Date}} [meta]
 *   the by-line and copyright metadata (see buildDocument).
 */
export async function exportPdf(doc, meta = {}) {
  const pdf = await renderPdf(doc, meta);
  pdf.save(safeFileName(doc.title));
}

// The frame the last print went through. It can't be removed as soon as
// print() returns: in Chrome the dialog opens after print() has already
// returned, and taking the frame away first cancels the print. So it stays in
// the page until the next print replaces it.
let printFrame = null;

function clearPrintFrame() {
  if (!printFrame) return;
  URL.revokeObjectURL(printFrame.src);
  printFrame.remove();
  printFrame = null;
}

// How long to wait for the browser's PDF viewer to load the file before giving
// up and downloading it instead.
const PRINT_LOAD_TIMEOUT = 15000;

// Load the PDF into a hidden frame and open the print dialog on it, so what
// prints is the PDF itself, page numbers and footer included.
function printBlob(blob) {
  clearPrintFrame();
  return new Promise((resolve, reject) => {
    const frame = window.document.createElement("iframe");
    // Hidden but still laid out. A display:none frame never starts the PDF
    // viewer, so there would be nothing to print.
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;

    const timer = setTimeout(() => {
      clearPrintFrame();
      reject(new Error("The PDF viewer didn't load in time."));
    }, PRINT_LOAD_TIMEOUT);

    frame.addEventListener(
      "load",
      () => {
        clearTimeout(timer);
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
          resolve();
        } catch (err) {
          clearPrintFrame();
          reject(err);
        }
      },
      { once: true },
    );

    frame.src = URL.createObjectURL(blob);
    printFrame = frame;
    window.document.body.appendChild(frame);
  });
}

// Whether this browser can print a PDF straight from a page. It needs a
// built-in PDF viewer (without one, loading the file into a frame would
// download it instead). Safari has one, and printing from the frame does pick
// the PDF, but it zooms into the first page and crops it (Safari 26), however
// the frame is sized and however long it waits. A downloaded PDF opened in
// Preview prints properly, so Safari gets that instead.
function canPrintPdfInPlace() {
  if (!navigator.pdfViewerEnabled) return false;
  const ua = navigator.userAgent;
  const isSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
  return !isSafari;
}

/**
 * Render the lesson to a PDF and open the browser's print dialog on it. Where
 * the browser can't print a PDF from the page, the PDF is downloaded instead.
 * @param {object} doc
 * @param {{author?: string, published?: string|number|Date}} [meta]
 *   the by-line and copyright metadata (see buildDocument).
 * @returns {Promise<"printed" | "downloaded">} which of the two happened.
 */
export async function printPdf(doc, meta = {}) {
  const pdf = await renderPdf(doc, meta);
  if (canPrintPdfInPlace()) {
    try {
      await printBlob(pdf.output("blob"));
      return "printed";
    } catch (err) {
      console.warn("Printing the PDF in place failed, downloading it.", err);
    }
  }
  pdf.save(safeFileName(doc.title));
  return "downloaded";
}
