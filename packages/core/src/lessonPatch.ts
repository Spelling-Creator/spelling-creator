// Apply a small list of edit operations to a lesson document, instead of
// resending the whole thing. The Worker only offers a full-replace PUT, so the
// MCP server's patch_lesson tool fetches the current doc, runs it through
// applyPatch here, and PUTs the result, while the assistant only has to send
// the diff.
//
// Operations address sections and blocks by their stable `id` (the ones
// get_lesson returns), not by array position — far more robust for a model than
// index- or JSON-pointer-based diffs, which drift as soon as anything shifts.
//
// New blocks reuse the canonical builder from lessonBuild.ts, so a patched
// block is validated exactly like one created from scratch.

import { removeSourceCitations } from "./lessonText.ts";
import {
  type BlockInput,
  type SourceInput,
  buildBlock,
  buildSources,
  newId,
} from "./lessonBuild.ts";
import type { LessonDoc, Source } from "./types.ts";

/**
 * One edit operation, as patch_lesson takes it (operationSchema in
 * apps/mcp/src/tools.js). An `index` is a 0-based target position; leaving it
 * out appends.
 */
export type PatchOperation =
  | { op: "set_title"; title: string }
  | { op: "set_section_name"; sectionId: string; name: string }
  | { op: "add_section"; name?: string; index?: number; blocks?: BlockInput[] }
  | { op: "remove_section"; sectionId: string }
  | { op: "move_section"; sectionId: string; index: number }
  | { op: "add_block"; sectionId: string; block: BlockInput; index?: number }
  | { op: "replace_block"; blockId: string; block: BlockInput }
  | { op: "remove_block"; blockId: string }
  | {
      op: "move_block";
      blockId: string;
      /** The section to move it to; it stays in its own otherwise. */
      sectionId?: string;
      index?: number;
    }
  | { op: "add_source"; source: SourceInput }
  | {
      op: "replace_source";
      sourceId: string;
      /** The source's id is `sourceId`, whatever this says. */
      source: Omit<SourceInput, "id">;
    }
  | { op: "remove_source"; sourceId: string };

type Unchecked<O> = O extends { op: string }
  ? { op: O["op"] } & Partial<Omit<O, "op">>
  : never;

/**
 * An operation as applyPatch takes it, before it is checked. The MCP server's
 * schema leaves every field but `op` optional, so applyPatch is what refuses
 * an operation that is missing one.
 */
export type PatchOperationInput = Unchecked<PatchOperation>;

const OPS = [
  "set_title",
  "set_section_name",
  "add_section",
  "remove_section",
  "move_section",
  "add_block",
  "replace_block",
  "remove_block",
  "move_block",
  "add_source",
  "replace_source",
  "remove_source",
] as const satisfies readonly PatchOperation["op"][];

// The lesson's source list and where the source is in it. The list is the
// doc's own, so changing it changes the doc.
function findSource(
  doc: LessonDoc,
  sourceId: string | undefined,
  where: string,
): { sources: Source[]; idx: number } {
  const sources = doc.sources || [];
  const idx = sources.findIndex((s) => s.id === sourceId);
  if (idx === -1) {
    throw new Error(
      `${where}: no source with id "${sourceId}". Call get_lesson to see the lesson's sources.`,
    );
  }
  return { sources, idx };
}

// One source from an operation, built and checked the way create_lesson builds
// a lesson's list, with the error naming the operation.
function buildOneSource(raw: unknown, where: string): Source {
  try {
    return buildSources([raw])[0];
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    throw new Error(`${where}: ${err.message.replace(/^Source 1:?\s*/, "")}`);
  }
}

function findSectionIndex(
  doc: LessonDoc,
  sectionId: string | undefined,
  where: string,
): number {
  const idx = doc.sections.findIndex((s) => s.id === sectionId);
  if (idx === -1) {
    throw new Error(
      `${where}: no section with id "${sectionId}". Call get_lesson to see the current ids.`,
    );
  }
  return idx;
}

export function findBlock(
  doc: Pick<LessonDoc, "sections">,
  blockId: string | undefined,
  where: string,
): { sectionIndex: number; blockIndex: number } {
  for (let s = 0; s < doc.sections.length; s++) {
    const b = doc.sections[s].blocks.findIndex((blk) => blk.id === blockId);
    if (b !== -1) return { sectionIndex: s, blockIndex: b };
  }
  throw new Error(
    `${where}: no block with id "${blockId}". Call get_lesson to see the current ids.`,
  );
}

// Clamp an insertion index into [0, length]; a missing index means "append".
function insertAt(index: number | null | undefined, length: number): number {
  if (index == null) return length;
  if (index < 0) return 0;
  return Math.min(index, length);
}

/**
 * Apply `operations` to a copy of `originalDoc` and return the new doc.
 * Throws a descriptive Error (naming the operation) on any invalid op, leaving
 * the caller's lesson untouched since we only ever mutate the clone.
 */
export function applyPatch(
  originalDoc: Partial<LessonDoc> | null | undefined,
  operations: readonly PatchOperationInput[],
): LessonDoc {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("Provide a non-empty list of operations.");
  }

  const clone = structuredClone(originalDoc || {});
  const doc: LessonDoc = Object.assign(clone, {
    title: typeof clone.title === "string" ? clone.title : "Untitled Lesson",
    sections: Array.isArray(clone.sections) ? clone.sections : [],
  });

  operations.forEach((op, i) => {
    const where = `operation ${i + 1} (${op?.op || "?"})`;
    if (!op || typeof op !== "object") {
      throw new Error(`${where}: each operation must be an object.`);
    }

    switch (op.op) {
      case "set_title": {
        if (typeof op.title !== "string" || !op.title.trim()) {
          throw new Error(`${where}: needs a non-empty "title".`);
        }
        doc.title = op.title;
        break;
      }

      case "set_section_name": {
        const idx = findSectionIndex(doc, op.sectionId, where);
        if (typeof op.name !== "string" || !op.name.trim()) {
          throw new Error(`${where}: needs a non-empty "name".`);
        }
        doc.sections[idx].name = op.name;
        break;
      }

      case "add_section": {
        const given: BlockInput[] = Array.isArray(op.blocks) ? op.blocks : [];
        const blocks = given.map((b, j) =>
          buildBlock(b, `${where}, block ${j + 1}`),
        );
        const section = {
          id: newId(),
          name: (op.name || `Section ${doc.sections.length + 1}`).toString(),
          blocks,
        };
        doc.sections.splice(
          insertAt(op.index, doc.sections.length),
          0,
          section,
        );
        break;
      }

      case "remove_section": {
        const idx = findSectionIndex(doc, op.sectionId, where);
        doc.sections.splice(idx, 1);
        break;
      }

      case "move_section": {
        const idx = findSectionIndex(doc, op.sectionId, where);
        if (typeof op.index !== "number") {
          throw new Error(`${where}: needs a numeric "index".`);
        }
        const [section] = doc.sections.splice(idx, 1);
        doc.sections.splice(
          insertAt(op.index, doc.sections.length),
          0,
          section,
        );
        break;
      }

      case "add_block": {
        const idx = findSectionIndex(doc, op.sectionId, where);
        if (!op.block) throw new Error(`${where}: needs a "block".`);
        const block = buildBlock(op.block, where);
        const blocks = doc.sections[idx].blocks;
        blocks.splice(insertAt(op.index, blocks.length), 0, block);
        break;
      }

      case "replace_block": {
        const { sectionIndex, blockIndex } = findBlock(doc, op.blockId, where);
        if (!op.block) throw new Error(`${where}: needs a "block".`);
        const block = buildBlock(op.block, where);
        const blocks = doc.sections[sectionIndex].blocks;
        // The id the operation named, which is the replaced block's: keep
        // identity stable for later patches.
        block.id = blocks[blockIndex].id;
        blocks[blockIndex] = block;
        break;
      }

      case "remove_block": {
        const { sectionIndex, blockIndex } = findBlock(doc, op.blockId, where);
        doc.sections[sectionIndex].blocks.splice(blockIndex, 1);
        break;
      }

      case "move_block": {
        const { sectionIndex, blockIndex } = findBlock(doc, op.blockId, where);
        const [block] = doc.sections[sectionIndex].blocks.splice(blockIndex, 1);
        // `index` is the target position *after* removal. Target section
        // defaults to the block's current one.
        const targetIdx =
          op.sectionId != null
            ? findSectionIndex(doc, op.sectionId, where)
            : sectionIndex;
        const blocks = doc.sections[targetIdx].blocks;
        blocks.splice(insertAt(op.index, blocks.length), 0, block);
        break;
      }

      case "add_source": {
        const source = buildOneSource(op.source, where);
        doc.sources = Array.isArray(doc.sources) ? doc.sources : [];
        if (doc.sources.some((s) => s.id === source.id)) {
          throw new Error(
            `${where}: the lesson already has a source "${source.id}". Use replace_source to change it.`,
          );
        }
        doc.sources.push(source);
        break;
      }

      case "replace_source": {
        const { sources, idx } = findSource(doc, op.sourceId, where);
        const source = buildOneSource({ ...op.source, id: op.sourceId }, where);
        sources[idx] = source;
        break;
      }

      // The source goes, and so do footnotes that only cited it; one that also
      // carries a note keeps the note. The same as removing it in the editor.
      case "remove_source": {
        const { sources, idx } = findSource(doc, op.sourceId, where);
        const { sections } = removeSourceCitations(doc, sources[idx].id);
        doc.sections = sections;
        sources.splice(idx, 1);
        if (!sources.length) delete doc.sources;
        break;
      }

      default: {
        // Only an untyped caller gets here, and it can send anything.
        const unknownOp: { op?: unknown } = op;
        throw new Error(
          `${where}: unknown op "${unknownOp.op}". Valid ops: ${OPS.join(", ")}.`,
        );
      }
    }
  });

  if (doc.sections.length === 0) {
    throw new Error(
      "The patch would leave the lesson with no sections; a lesson needs at least one.",
    );
  }
  return doc;
}

export const PATCH_OPS = OPS;
