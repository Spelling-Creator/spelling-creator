// Formulas in the browser: MathJax on the page's own document, the speech
// rule engine fed from the app's own assets, and a formula as a picture.
//
// This module is HEAVY (see formulaEngine.ts and formulaSpeech.ts). Nothing
// may static-import it: it is reached only through the dynamic import() in
// formulas.ts. vite.config.js additionally stubs it out of the Worker's SSR
// build.

import { browserAdaptor } from "@mathjax/src/mjs/adaptors/browserAdaptor.js";
import { mathjax } from "@mathjax/src/mjs/mathjax.js";
import baseRulesUrl from "speech-rule-engine/lib/mathmaps/base.json?url";
import englishRulesUrl from "speech-rule-engine/lib/mathmaps/en.json?url";
import {
  createFormulaRenderer,
  type FormulaInput,
  type FormulaRenderer,
  type RenderedFormula,
} from "./formulaEngine.ts";
import { createFormulaSpeech, type FormulaSpeech } from "./formulaSpeech.ts";

/**
 * A formula as a PNG. `width` and `height` are the size to show it at, in
 * CSS pixels.
 */
export interface FormulaImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

// The glyphs MathJax's font keeps in files of their own (double-struck,
// script, fraktur, less common symbols and alphabets), each a chunk of the
// build that is fetched the first time a formula needs it. MathJax asks for
// them by the package's module name; this maps that onto the chunk.
const dynamicFonts = import.meta.glob(
  "../../node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js",
);
mathjax.asyncLoad = (name) => {
  const file = name.split("/").pop();
  const entry = Object.entries(dynamicFonts).find(([path]) =>
    path.endsWith(`/dynamic/${file}`),
  );
  return entry
    ? entry[1]()
    : Promise.reject(new Error(`No font file for ${name}`));
};

let renderer: FormulaRenderer<HTMLElement> | null = null;

function rendererForPage(): FormulaRenderer<HTMLElement> {
  if (!renderer) {
    renderer = createFormulaRenderer(browserAdaptor(), { document });
    // The SVG output's few rules (how a container sits in a line, and a
    // display one on its own), once for the page.
    document.head.appendChild(renderer.styleSheet());
  }
  return renderer;
}

/** A formula rendered on this page: see createFormulaRenderer's `render`. */
export function renderFormula(
  formula: FormulaInput,
): Promise<RenderedFormula<HTMLElement> | null> {
  return rendererForPage().render(formula);
}

// A second renderer for pictures: the page's one cuts an inline formula into
// pieces where a line may wrap, and a picture needs it whole.
let pictureRenderer: FormulaRenderer<HTMLElement> | null = null;

function rendererForPictures() {
  pictureRenderer ??= createFormulaRenderer(browserAdaptor(), {
    document,
    inlineBreaks: false,
  });
  return pictureRenderer;
}

const RULE_FILES: Partial<Record<string, string>> = {
  base: baseRulesUrl,
  en: englishRulesUrl,
};

async function loadLocale(locale: string) {
  const url = RULE_FILES[locale];
  if (!url) throw new Error(`No speech rules for the locale "${locale}".`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`The speech rules for "${locale}" couldn't be fetched.`);
  }
  return response.text();
}

let speech: Promise<FormulaSpeech> | null = null;

/** MathML read out in words. The engine and its rules load on the first call. */
export function speakMathml(mathml: string): Promise<string> {
  speech ??= createFormulaSpeech({ loadLocale }).catch((err) => {
    speech = null;
    throw err;
  });
  return speech.then((engine) => engine.speak(mathml));
}

// A formula's SVG is sized in ex, the x-height of the surrounding text. The
// exports' body text is 14pt Calibri, whose x-height is about this many CSS
// pixels, so a formula comes out the size of the words around it.
const EX_PX = 8.4;

// Drawn at twice its size, so it stays sharp where the PDF is zoomed.
const IMAGE_SCALE = 2;

function exToPx(value: string | null) {
  const ex = parseFloat(value ?? "");
  return Number.isFinite(ex) ? ex * EX_PX : 0;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The formula's picture didn't load."));
    img.src = url;
  });
}

/** A formula as a PNG, for a file that can't hold an equation. */
export async function formulaImage(
  formula: FormulaInput,
): Promise<FormulaImage> {
  const rendered = await rendererForPictures().render(formula);
  const svg = rendered?.node.querySelector("svg");
  if (!svg) throw new Error("The formula has no picture to draw.");
  const width = Math.max(1, exToPx(svg.getAttribute("width")));
  const height = Math.max(1, exToPx(svg.getAttribute("height")));
  // Sized in pixels for the image, whose ex is nobody's font. (The DOM types
  // give any clone as a plain Node.)
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("width", `${width}px`);
  copy.setAttribute("height", `${height}px`);
  copy.removeAttribute("style");
  const xml = new XMLSerializer().serializeToString(copy);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * IMAGE_SCALE);
    canvas.height = Math.ceil(height * IMAGE_SCALE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The formula's picture couldn't be drawn.");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("No PNG was made.")),
        "image/png",
      );
    });
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: Math.round(width),
      height: Math.round(height),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
