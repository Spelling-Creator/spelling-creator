// A formula as a Word equation: MathJax's MathML tree turned into the `docx`
// library's math components, which it writes as OMML (Office Math), the
// native equation Word, LibreOffice and Google Docs all edit.
//
// This is a translation of the MathML that lessons produce, not of all of
// MathML: fractions, superscripts and subscripts, roots, and tokens. Anything
// else is flattened to its text, so a formula always comes through readable,
// if sometimes less elegantly than on the page.

import {
  Math as DocxMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
} from "docx";

// The invisible operators TeX and AsciiMath put between tokens (invisible
// times, function application), which Word would show as nothing anyway but
// which some readers show as boxes.
const INVISIBLE = /[⁡-⁤]/g;

function textOf(node) {
  if (node.isKind("text")) return node.getText();
  if (typeof node.getText === "function" && node.isToken) {
    return node.getText();
  }
  return (node.childNodes || []).map(textOf).join("");
}

// A node's children as math components, each child in turn.
function childComponents(node) {
  return (node.childNodes || []).flatMap(components);
}

// The components for one MathML node.
function components(node) {
  if (!node || !node.childNodes) return [];
  switch (node.kind) {
    case "mfrac": {
      const [num, den] = node.childNodes;
      return [
        new MathFraction({
          numerator: nonEmpty(components(num)),
          denominator: nonEmpty(components(den)),
        }),
      ];
    }
    case "msup": {
      const [base, sup] = node.childNodes;
      return [
        new MathSuperScript({
          children: nonEmpty(components(base)),
          superScript: nonEmpty(components(sup)),
        }),
      ];
    }
    case "msub": {
      const [base, sub] = node.childNodes;
      return [
        new MathSubScript({
          children: nonEmpty(components(base)),
          subScript: nonEmpty(components(sub)),
        }),
      ];
    }
    case "msubsup": {
      const [base, sub, sup] = node.childNodes;
      return [
        new MathSubSuperScript({
          children: nonEmpty(components(base)),
          subScript: nonEmpty(components(sub)),
          superScript: nonEmpty(components(sup)),
        }),
      ];
    }
    case "msqrt":
      return [new MathRadical({ children: nonEmpty(childComponents(node)) })];
    case "mroot": {
      const [base, degree] = node.childNodes;
      return [
        new MathRadical({
          children: nonEmpty(components(base)),
          degree: nonEmpty(components(degree)),
        }),
      ];
    }
    case "mn":
    case "mi":
    case "mo":
    case "mtext":
    case "ms": {
      const text = textOf(node).replace(INVISIBLE, "");
      return text ? [new MathRun(text)] : [];
    }
    case "mspace":
      return [new MathRun(" ")];
    default:
      // mrow, mstyle, mpadded, TeXAtom, munderover and the rest: their
      // children in order, which keeps the words even where the layout is
      // lost.
      return childComponents(node);
  }
}

// Word rejects an empty equation part, so a part with nothing in it (an
// empty group in the source) gets a space.
function nonEmpty(list) {
  return list.length ? list : [new MathRun(" ")];
}

/**
 * A formula as a `docx` Math component, from the MathML tree MathJax parsed
 * it into (the `root` a formula renderer gives).
 * @param {object} root  A MathJax MmlNode (the <math> element).
 * @returns {import("docx").Math}
 */
export function formulaToDocx(root) {
  return new DocxMath({ children: nonEmpty(components(root)) });
}
