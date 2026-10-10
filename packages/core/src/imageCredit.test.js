import { describe, expect, it } from "vitest";

import {
  imageCaptionParts,
  splitLegacyCredit,
  withImageCaptionParts,
  withSeparateCredit,
} from "./imageCredit.js";

const COMMONS = "Image (by Jane Doe, CC BY-SA 4.0) via Wikimedia Commons";

describe("splitLegacyCredit", () => {
  it("takes a whole caption that is one of our credit lines as the credit", () => {
    expect(splitLegacyCredit(COMMONS)).toEqual({
      caption: "",
      credit: COMMONS,
    });
    expect(splitLegacyCredit("Image via Wikimedia Commons")).toEqual({
      caption: "",
      credit: "Image via Wikimedia Commons",
    });
    expect(splitLegacyCredit("Image by Someone via Wikimedia Commons")).toEqual(
      { caption: "", credit: "Image by Someone via Wikimedia Commons" },
    );
    expect(splitLegacyCredit("Image by jdoe from Pixabay")).toEqual({
      caption: "",
      credit: "Image by jdoe from Pixabay",
    });
    expect(splitLegacyCredit("Image from Pixabay")).toEqual({
      caption: "",
      credit: "Image from Pixabay",
    });
  });

  it("splits a caption the author wrote in front of the credit", () => {
    expect(splitLegacyCredit(`A red panda resting. ${COMMONS}`)).toEqual({
      caption: "A red panda resting.",
      credit: COMMONS,
    });
    expect(splitLegacyCredit(`Mount Etna - ${COMMONS}`)).toEqual({
      caption: "Mount Etna",
      credit: COMMONS,
    });
  });

  it("copes with parentheses in the author's name", () => {
    const credit =
      "Image (by John Smith (NASA), Public domain) via Wikimedia Commons";
    expect(splitLegacyCredit(`Saturn. ${credit}`)).toEqual({
      caption: "Saturn.",
      credit,
    });
  });

  it("doesn't swallow a caption that opens with its own parentheses", () => {
    const credit = "Image (by X, CC BY 4.0) via Wikimedia Commons";
    expect(splitLegacyCredit(`Image (cute) of a dog. ${credit}`)).toEqual({
      caption: "Image (cute) of a dog.",
      credit,
    });
  });

  it("splits a credit the author wrapped in brackets", () => {
    expect(splitLegacyCredit("Lions (Image from Pixabay)")).toEqual({
      caption: "Lions",
      credit: "Image from Pixabay",
    });
    expect(splitLegacyCredit(`Saturn [${COMMONS}].`)).toEqual({
      caption: "Saturn",
      credit: COMMONS,
    });
  });

  it("leaves a caption that only looks a bit like a credit alone", () => {
    for (const caption of [
      "Image of a lion",
      "Image of a lion via Wikimedia Commons",
      "Photo by Jane Doe from Pixabay",
      "An Image (by me) of my cat",
    ]) {
      expect(splitLegacyCredit(caption)).toEqual({ caption, credit: "" });
    }
  });

  it("treats a missing caption as empty", () => {
    expect(splitLegacyCredit(undefined)).toEqual({ caption: "", credit: "" });
  });
});

describe("imageCaptionParts", () => {
  it("reads a block with a credit field as it is", () => {
    expect(imageCaptionParts({ caption: "A lion", credit: COMMONS })).toEqual({
      caption: "A lion",
      credit: COMMONS,
    });
  });

  it("never re-derives a credit that was removed on purpose", () => {
    expect(imageCaptionParts({ caption: COMMONS, credit: "" })).toEqual({
      caption: COMMONS,
      credit: "",
    });
  });

  it("splits an older block's caption", () => {
    expect(imageCaptionParts({ caption: `A lion. ${COMMONS}` })).toEqual({
      caption: "A lion.",
      credit: COMMONS,
    });
  });
});

describe("withImageCaptionParts", () => {
  it("writes both fields out, applying the change", () => {
    const block = { id: "i1", type: "image", caption: `A lion. ${COMMONS}` };
    expect(
      withImageCaptionParts(block, { caption: "A sleeping lion" }),
    ).toEqual({
      id: "i1",
      type: "image",
      caption: "A sleeping lion",
      credit: COMMONS,
    });
    expect(withImageCaptionParts(block, { credit: "" })).toEqual({
      id: "i1",
      type: "image",
      caption: "A lion.",
      credit: "",
    });
  });
});

describe("withSeparateCredit", () => {
  it("splits pictures and leaves every other block alone", () => {
    const caption = `A lion. ${COMMONS}`;
    expect(withSeparateCredit({ type: "image", caption })).toEqual({
      type: "image",
      caption: "A lion.",
      credit: COMMONS,
    });
    expect(
      withSeparateCredit({ type: "vakt", text: "Jump", src: "x", caption }),
    ).toMatchObject({ caption: "A lion.", credit: COMMONS });
    const bare = { type: "vakt", text: "Jump", links: [] };
    expect(withSeparateCredit(bare)).toBe(bare);
    const text = { type: "text", text: caption };
    expect(withSeparateCredit(text)).toBe(text);
  });
});
