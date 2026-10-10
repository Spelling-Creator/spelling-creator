// Merging = comparing block ids.
//
// Two people fork a lesson from a common ancestor and both edit it. To merge, we
// don't diff text — we line up the three docs (base, ours, theirs) by block id
// and decide each block independently:
//
//   changed on one side only   -> take that side          (no question to ask)
//   changed on both, same way  -> take it                 (they agree)
//   changed on both, different fields of the block
//                              -> merge the fields        (auto — one edited the
//                                                          caption, the other the
//                                                          width; both survive)
//   changed on both, same field, different values
//                              -> CONFLICT, ask the user
//   deleted one side, edited the other
//                              -> CONFLICT, ask the user  (deleting someone's
//                                                          edit is never safe to
//                                                          assume)
//
// Structure (which section a block sits in, and in what order) is merged
// separately and never raises a dialog: order is cheap for a human to fix and
// expensive for one to adjudicate, so a reorder on both sides resolves to ours
// and is reported in the summary instead.
//
// The lesson's sources merge the same quiet way, by id and field by field: a
// source one side added or edited comes through, and where both sides changed
// the same field of the same source, ours stands. A source is a reference, not
// prose, so a disagreement over its year is not worth a dialog.
//
// This module is pure — no git, no fs, no React. It takes three docs and returns
// a merged doc plus the conflicts. The caller (useLessonGit) fetches base/ours/
// theirs out of git and commits the result with two parents.

import { docBlocks } from "./doc.js";
import { sameValue } from "./ops.js";
import { hasPicture, withSeparateCredit } from "../imageCredit.js";
import {
  isPlainContent,
  textBlockContent,
  textBlockPlain,
  withTextBlockContent,
} from "../lessonText.js";

/** Fields that identify a block rather than describe it — never merged. */
const IDENTITY_FIELDS = new Set(["id", "type"]);

/**
 * Merge one block three ways, field by field.
 * @returns {{ block: object, conflicts: Array<{field, ours, theirs, base}> }}
 *          `block` holds every auto-resolvable field already merged; contested
 *          fields are left at *our* value so the block is always renderable.
 */
export function mergeBlockFields(base, ours, theirs) {
  // A picture from before credits had their own field keeps its credit inside
  // `caption`. Edited on one side, it comes back as a caption and a credit,
  // so a caption edit there and a credit fix on the other would both touch
  // `caption` and both add `credit`: two conflicts over two edits that never
  // met. Every side is compared with the two fields split (see
  // ../imageCredit.js), which also leaves the merged block split.
  if ([base, ours, theirs].some(hasPicture)) {
    const split = (b) => (b ? withSeparateCredit(b) : b);
    return mergeFields(split(base), split(ours), split(theirs));
  }
  // A text block keeps its words in `text` or in `content` depending on whether
  // any of them are formatted (see lessonText.js), so one side formatting a word
  // while the other fixes a typo would otherwise touch two different fields,
  // merge "cleanly", and lose the typo fix behind the formatted copy. Merged as
  // the one field they are, that is a conflict the user gets to see.
  if ([base, ours, theirs].some((b) => b?.type === "text")) {
    const asContent = (b) => (b ? withContentField(b) : b);
    const merged = mergeFields(
      asContent(base),
      asContent(ours),
      asContent(theirs),
    );
    return {
      block: withTextBlockContent(merged.block, merged.block.content),
      conflicts: merged.conflicts.map(asTextConflict),
    };
  }
  return mergeFields(base, ours, theirs);
}

// Two plain versions of the words are still a disagreement about `text`, and
// are reported as one, with the strings themselves to choose between.
function asTextConflict(conflict) {
  if (conflict.field !== "content") return conflict;
  const sides = [conflict.ours, conflict.theirs, conflict.base];
  if (!sides.every((side) => side === undefined || isPlainContent(side))) {
    return conflict;
  }
  const plain = (side) =>
    side === undefined ? undefined : textBlockPlain({ content: side });
  return {
    field: "text",
    ours: plain(conflict.ours),
    theirs: plain(conflict.theirs),
    base: plain(conflict.base),
  };
}

function withContentField(block) {
  const out = { ...block, content: textBlockContent(block) };
  delete out.text;
  return out;
}

function mergeFields(base, ours, theirs) {
  const fields = new Set([
    ...Object.keys(ours || {}),
    ...Object.keys(theirs || {}),
  ]);

  const block = {};
  const conflicts = [];

  for (const field of fields) {
    const o = ours?.[field];
    const t = theirs?.[field];
    const b = base?.[field];

    if (IDENTITY_FIELDS.has(field)) {
      block[field] = o !== undefined ? o : t;
      continue;
    }

    if (sameValue(o, t)) {
      block[field] = o; // both sides agree (including "neither touched it")
    } else if (sameValue(o, b)) {
      block[field] = t; // only they changed it
    } else if (sameValue(t, b)) {
      block[field] = o; // only we changed it
    } else {
      // Both changed it, to different things. Keep ours so the block stays
      // renderable, and surface the choice.
      block[field] = o;
      conflicts.push({ field, ours: o, theirs: t, base: b });
    }
  }

  return { block, conflicts };
}

/**
 * Three-way merge a list of ids (a section's block ids, or the doc's section
 * ids). Ours is the spine; ids the other side added are spliced in after the id
 * that precedes them there, and ids either side deleted drop out.
 *
 * Deliberately not a conflict source — see the note at the top of the file.
 *
 * `placeRest` appends whatever `keep` holds that neither list placed. That is
 * only right when `keep` describes this one list. A section's block list is
 * merged against the kept blocks of the whole lesson, so it passes false, or
 * every other section's blocks would land in the first one.
 */
function mergeIdList(base, ours, theirs, keep, { placeRest = true } = {}) {
  const baseSet = new Set(base);
  const ourSet = new Set(ours);
  const theirSet = new Set(theirs);

  // Start from our order, dropping anything they deleted that we didn't touch.
  const merged = ours.filter((id) => {
    const deletedByThem = baseSet.has(id) && !theirSet.has(id);
    return keep.has(id) && !deletedByThem;
  });

  // Splice in what they added, anchored to the id it follows on their side so a
  // block they appended to the middle doesn't jump to the end.
  for (let i = 0; i < theirs.length; i++) {
    const id = theirs[i];
    if (ourSet.has(id) || baseSet.has(id) || !keep.has(id)) continue;
    if (merged.includes(id)) continue;

    let at = merged.length;
    for (let j = i - 1; j >= 0; j--) {
      const anchor = merged.indexOf(theirs[j]);
      if (anchor !== -1) {
        at = anchor + 1;
        break;
      }
    }
    merged.splice(at, 0, id);
  }

  // Anything the resolution kept that neither list places (e.g. a section we
  // deleted that they still have) lands at the end rather than being lost.
  if (placeRest) {
    for (const id of keep) if (!merged.includes(id)) merged.push(id);
  }

  return merged;
}

function sectionsById(doc) {
  const map = new Map();
  for (const section of doc?.sections || []) map.set(section.id, section);
  return map;
}

function blockIdsOf(doc, sectionId) {
  const section = sectionsById(doc).get(sectionId);
  return (section?.blocks || []).map((block) => block.id);
}

/**
 * Merge two documents that share a common ancestor.
 *
 * @param {object|null} base    The doc at the merge base (null = unrelated histories).
 * @param {object} ours         Our doc.
 * @param {object} theirs       Theirs.
 * @returns {{
 *   doc: object,                the merged doc, with contested blocks left at OUR value
 *   conflicts: Array<object>,   one per contested block — resolve with applyResolutions()
 *   auto: { merged: string[], tookTheirs: string[], added: string[], removed: string[] }
 * }}
 */
export function mergeDocs(base, ours, theirs) {
  const baseBlocks = docBlocks(base);
  const ourBlocks = docBlocks(ours);
  const theirBlocks = docBlocks(theirs);

  const ids = new Set([
    ...ourBlocks.keys(),
    ...theirBlocks.keys(),
    ...baseBlocks.keys(),
  ]);

  /** blockId -> the resolved block, or null when the merge deletes it. */
  const resolved = new Map();
  const conflicts = [];
  const auto = { merged: [], tookTheirs: [], added: [], removed: [] };

  for (const id of ids) {
    const b = baseBlocks.get(id);
    const o = ourBlocks.get(id);
    const t = theirBlocks.get(id);

    // Present on neither side any more: both deleted it. Agreed — it's gone.
    if (!o && !t) {
      resolved.set(id, null);
      auto.removed.push(id);
      continue;
    }

    // Only we have it.
    if (o && !t) {
      if (!b) {
        resolved.set(id, o); // we added it
        continue;
      }
      if (sameValue(o, b)) {
        resolved.set(id, null); // they deleted it, we didn't touch it
        auto.removed.push(id);
      } else {
        // They deleted a block we edited. Never guess.
        resolved.set(id, o);
        conflicts.push({
          blockId: id,
          kind: "delete/edit",
          deletedBy: "theirs",
          ours: o,
          theirs: null,
          base: b,
          fields: [],
          merged: o,
        });
      }
      continue;
    }

    // Only they have it.
    if (!o && t) {
      if (!b) {
        resolved.set(id, t); // they added it
        auto.added.push(id);
        continue;
      }
      if (sameValue(t, b)) {
        resolved.set(id, null); // we deleted it, they didn't touch it
        auto.removed.push(id);
      } else {
        resolved.set(id, t);
        conflicts.push({
          blockId: id,
          kind: "delete/edit",
          deletedBy: "ours",
          ours: null,
          theirs: t,
          base: b,
          fields: [],
          merged: t,
        });
      }
      continue;
    }

    // Both have it.
    if (sameValue(o, t)) {
      resolved.set(id, o); // identical — nothing to decide
      continue;
    }
    if (b && sameValue(o, b)) {
      resolved.set(id, t); // only they changed it
      auto.tookTheirs.push(id);
      continue;
    }
    if (b && sameValue(t, b)) {
      resolved.set(id, o); // only we changed it
      continue;
    }

    // Both changed it. Try to merge field by field.
    const { block, conflicts: fieldConflicts } = mergeBlockFields(b, o, t);
    if (fieldConflicts.length === 0) {
      resolved.set(id, block); // disjoint fields — both edits survive
      auto.merged.push(id);
      continue;
    }

    resolved.set(id, block);
    conflicts.push({
      blockId: id,
      kind: "edit/edit",
      ours: o,
      theirs: t,
      base: b,
      fields: fieldConflicts,
      // Every auto-resolvable field already merged, contested ones left at ours.
      merged: block,
    });
  }

  return {
    doc: assemble(base, ours, theirs, resolved),
    conflicts,
    auto,
  };
}

/**
 * Rebuild a doc from the resolved blocks, merging structure (section list,
 * section names, block order) around them.
 */
function assemble(base, ours, theirs, resolved) {
  const kept = new Set();
  for (const [id, block] of resolved) if (block) kept.add(id);

  const baseSections = sectionsById(base);
  const ourSections = sectionsById(ours);
  const theirSections = sectionsById(theirs);

  const sectionIds = mergeIdList(
    (base?.sections || []).map((s) => s.id),
    (ours?.sections || []).map((s) => s.id),
    (theirs?.sections || []).map((s) => s.id),
    // A section survives if either side still has it. Dropping a section would
    // orphan the blocks the block-level merge decided to keep.
    new Set([...ourSections.keys(), ...theirSections.keys()]),
  );

  // Blocks are placed in the first merged section that claims them, so a block
  // moved between sections on one side can't end up duplicated.
  const placed = new Set();
  /** sectionId -> its merged block ids, in order. */
  const layout = new Map();

  for (const sectionId of sectionIds) {
    const blockIds = mergeIdList(
      blockIdsOf(base, sectionId),
      blockIdsOf(ours, sectionId),
      blockIdsOf(theirs, sectionId),
      kept,
      { placeRest: false },
    ).filter((id) => !placed.has(id));

    for (const id of blockIds) placed.add(id);
    layout.set(sectionId, blockIds);
  }

  // A block one side deleted and the other edited is kept, but neither order
  // places it: the deleting side no longer lists it, and the other side's copy
  // is in the base, so it doesn't count as an addition. Put it back in the
  // section that still holds it, after the block it follows there.
  for (const id of kept) {
    if (placed.has(id)) continue;
    for (const doc of [ours, theirs]) {
      const home = (doc?.sections || []).find((section) =>
        (section.blocks || []).some((b) => b.id === id),
      );
      const blockIds = home && layout.get(home.id);
      if (!blockIds) continue;

      const order = home.blocks.map((b) => b.id);
      let at = 0;
      for (let j = order.indexOf(id) - 1; j >= 0; j--) {
        const anchor = blockIds.indexOf(order[j]);
        if (anchor !== -1) {
          at = anchor + 1;
          break;
        }
      }
      blockIds.splice(at, 0, id);
      placed.add(id);
      break;
    }
  }

  const sections = sectionIds.map((sectionId) => ({
    id: sectionId,
    name: mergeName(
      baseSections.get(sectionId)?.name,
      ourSections.get(sectionId)?.name,
      theirSections.get(sectionId)?.name,
    ),
    blocks: layout.get(sectionId).map((id) => resolved.get(id)),
  }));

  // A kept block whose every section disappeared would otherwise be dropped.
  const orphans = [...kept].filter((id) => !placed.has(id));
  if (orphans.length > 0) {
    sections.push({
      id: `recovered-${orphans[0]}`,
      name: "Recovered blocks",
      blocks: orphans.map((id) => resolved.get(id)),
    });
  }

  const doc = {
    title: mergeName(base?.title, ours?.title, theirs?.title) || "",
    sections,
  };
  const ageRange = mergeName(base?.ageRange, ours?.ageRange, theirs?.ageRange);
  if (ageRange) doc.ageRange = ageRange;
  const sources = mergeSources(base, ours, theirs);
  if (sources.length) doc.sources = sources;
  return doc;
}

function sourcesOf(doc) {
  const map = new Map();
  for (const source of Array.isArray(doc?.sources) ? doc.sources : []) {
    if (source && typeof source.id === "string") map.set(source.id, source);
  }
  return map;
}

/**
 * Three-way merge of the lesson's source lists. Never a conflict: see the note
 * at the top of the file.
 */
function mergeSources(base, ours, theirs) {
  const b = sourcesOf(base);
  const o = sourcesOf(ours);
  const t = sourcesOf(theirs);

  const resolved = new Map();
  for (const id of new Set([...o.keys(), ...t.keys()])) {
    const before = b.get(id);
    const mine = o.get(id);
    const other = t.get(id);
    if (mine && other) {
      const fields = new Set([...Object.keys(mine), ...Object.keys(other)]);
      const source = {};
      for (const field of fields) {
        source[field] = mergeName(before?.[field], mine[field], other[field]);
      }
      resolved.set(id, source);
    } else if (mine) {
      // Deleted on their side: gone, unless we edited it since.
      if (!before || !sameValue(mine, before)) resolved.set(id, mine);
    } else if (!before || !sameValue(other, before)) {
      resolved.set(id, other);
    }
  }

  const order = mergeIdList(
    [...b.keys()],
    [...o.keys()],
    [...t.keys()],
    new Set(resolved.keys()),
  );
  return order.map((id) => resolved.get(id));
}

/** Three-way merge of a scalar, preferring ours when both sides changed it. */
function mergeName(base, ours, theirs) {
  if (sameValue(ours, theirs)) return ours;
  if (sameValue(ours, base)) return theirs;
  return ours;
}

/**
 * Apply the user's choices from the conflict dialog to a merge result.
 *
 * @param {object} merged   The `doc` from mergeDocs (contested blocks at our value).
 * @param {object[]} conflicts  The conflicts from the same call.
 * @param {Record<string, "ours"|"theirs"|"both">} choices  Keyed by blockId.
 * @param {Function} newId  Id factory, for the clone a "both" choice creates.
 */
export function applyResolutions(merged, conflicts, choices, newId) {
  let doc = { ...merged, sections: merged.sections.map((s) => ({ ...s })) };

  for (const conflict of conflicts) {
    const choice = choices[conflict.blockId] || "ours";
    const { blockId, kind } = conflict;

    if (kind === "delete/edit") {
      // "ours"/"theirs" here mean "keep the surviving edit" or "honour the
      // delete" — whichever side still has the block is the one that edited it.
      const survivor = conflict.ours || conflict.theirs;
      const keep = choice === "both" || choice === keptSide(conflict);
      doc = replaceBlock(doc, blockId, keep ? survivor : null, null, newId);
      continue;
    }

    // edit/edit. `merged` already holds every auto-resolved field; a choice only
    // settles the contested ones.
    const base = conflict.merged;
    if (choice === "ours") {
      doc = replaceBlock(
        doc,
        blockId,
        withFields(base, conflict, "ours"),
        null,
        newId,
      );
    } else if (choice === "theirs") {
      doc = replaceBlock(
        doc,
        blockId,
        withFields(base, conflict, "theirs"),
        null,
        newId,
      );
    } else {
      // Keep both: ours stays put, theirs is cloned in beside it under a fresh
      // id (a new id, because the old one now belongs to our copy).
      doc = replaceBlock(
        doc,
        blockId,
        withFields(base, conflict, "ours"),
        withFields(base, conflict, "theirs"),
        newId,
      );
    }
  }

  return doc;
}

/** Which side of a delete/edit conflict still holds the block. */
function keptSide(conflict) {
  return conflict.deletedBy === "theirs" ? "ours" : "theirs";
}

/** The merged block with its contested fields set from one side. */
function withFields(merged, conflict, side) {
  const block = { ...merged };
  for (const field of conflict.fields) block[field.field] = field[side];
  // A contested text block was merged with its words in `content`; store it
  // back in whichever shape fits what was chosen.
  if (
    block.type === "text" &&
    conflict.fields.some((f) => f.field === "content")
  ) {
    return withTextBlockContent(block, block.content);
  }
  return block;
}

/**
 * Put `block` in place of `blockId` (or remove it when null), optionally
 * inserting `clone` right after it under a fresh id.
 */
function replaceBlock(doc, blockId, block, clone, newId) {
  return {
    ...doc,
    sections: doc.sections.map((section) => {
      if (!section.blocks.some((b) => b && b.id === blockId)) return section;
      const blocks = [];
      for (const existing of section.blocks) {
        if (!existing || existing.id !== blockId) {
          blocks.push(existing);
          continue;
        }
        if (block) blocks.push(block);
        if (clone) blocks.push({ ...clone, id: newId() });
      }
      return { ...section, blocks };
    }),
  };
}
