// The Workers half of `#proposal-diff-html` (see package.json's "imports" and
// views.js). wrangler's Text module rule (apps/api/wrangler.jsonc) turns the
// built view into a default-exported string at bundle time.
//
// The rule matches on the import specifier, so the HTML has to be named by a
// literal relative path — importing `#proposal-diff-html` directly would resolve
// to the file but never match the rule. Hence this one-line shim, exactly as
// imagePicker.workerd.js does for the picker.
import html from "./proposalDiff.html";

export default html;
