// The framing an image block built for the MCP server keeps.

import { describe, expect, it } from "vitest";

import { buildBlock } from "./lessonBuild.ts";

const image = { hash: "abc", mime: "image/png", ext: "png" };

describe("an image block's framing", () => {
  it("keeps a size and an alignment the editor offers", () => {
    expect(
      buildBlock({ type: "image", image, size: "small", align: "left" }, "b"),
    ).toMatchObject({ size: "small", align: "left" });
  });

  it("leaves out a size or an alignment the editor doesn't offer", () => {
    const block = buildBlock(
      { type: "image", image, size: "huge", align: "middle" },
      "b",
    );
    expect(block).not.toHaveProperty("size");
    expect(block).not.toHaveProperty("align");
  });
});
