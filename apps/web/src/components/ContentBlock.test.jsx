// @vitest-environment happy-dom

// The editor has to draw whatever a stored lesson holds. Importing checks a
// file's values, but a lesson saved before those checks, or a block mid-edit,
// reaches these components as it is.

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import ContentBlock from "./ContentBlock.jsx";
import { TooltipProvider } from "./ui/tooltip.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;

function draw(block) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ContentBlock, {
          block,
          onChange: vi.fn(),
          onDelete: vi.fn(),
          onMoveUp: vi.fn(),
          onMoveDown: vi.fn(),
        }),
      ),
    );
  });
  return host;
}

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("an image block's framing toggles", () => {
  const pressed = (host) =>
    host.querySelectorAll('[data-slot="toggle-group-item"][data-state="on"]')
      .length;
  const image = (fields) => ({
    id: "i1",
    type: "image",
    src: "data:image/png;base64,AA==",
    ...fields,
  });

  it("presses one size and one alignment for values the editor offers", () => {
    expect(pressed(draw(image({ size: "small", align: "left" })))).toBe(2);
  });

  it("still presses one of each for a value it doesn't offer", () => {
    expect(pressed(draw(image({ size: "huge", align: "middle" })))).toBe(2);
  });
});

describe("a question's answer list", () => {
  it("draws a block mid-edit with a null row", () => {
    const host = draw({
      id: "q1",
      type: "question",
      questionType: "multiple",
      prompt: "Name one.",
      answers: [null, { id: "a1", text: "cat" }],
    });
    const inputs = [...host.querySelectorAll("input")].map((i) => i.value);
    expect(inputs).toContain("cat");
  });
});
