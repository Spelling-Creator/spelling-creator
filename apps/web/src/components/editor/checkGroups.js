// Grouping what the Check panel lists by the section it is in. Shared by the
// lesson checks and the fact check, so both read in the same order under the
// same headings.

/**
 * Findings in document order: lesson-wide ones first, then each section's in
 * the order the sections appear now (which may have moved since the checks
 * last ran, if they are a frame behind).
 * @returns {{ sectionId: string, items: any[] }[]}
 */
export function groupBySection(findings, sections) {
  const order = new Map(sections.map((s, i) => [s.id, i]));
  const groups = new Map();
  for (const finding of findings) {
    const id = finding.sectionId || "";
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(finding);
  }
  return [...groups.entries()]
    .map(([sectionId, items]) => ({ sectionId, items }))
    .sort(
      (a, b) =>
        (a.sectionId ? (order.get(a.sectionId) ?? Infinity) : -1) -
        (b.sectionId ? (order.get(b.sectionId) ?? Infinity) : -1),
    );
}

/**
 * A group's heading: "Section 2: Lava", "Section 3", or "Whole lesson".
 * @param {import("i18next").TFunction} t  Bound to the `checks` namespace.
 * @param {number} [fallbackNumber]  The section number the finding was made
 *   against, for a section that has since been deleted.
 */
export function sectionHeading(t, sections, sectionId, fallbackNumber) {
  if (!sectionId) return t("wholeLesson");
  const index = sections.findIndex((s) => s.id === sectionId);
  const n = index === -1 ? fallbackNumber : index + 1;
  const name = sections[index]?.name?.trim();
  return name ? t("section", { n, name }) : t("untitledSection", { n });
}
