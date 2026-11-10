// A published lesson's page and its tabs, as a visitor sees them.
import { expect, test } from "@playwright/test";
import { lessonByTitle } from "./fixtures.ts";

test.describe("a published lesson", () => {
  test("shows the lesson with its sections, spelling words and questions", async ({
    page,
    request,
  }) => {
    const penguins = await lessonByTitle(request, "Penguins");
    await page.goto(`/hub/${penguins.id}`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Penguins" }).first(),
    ).toBeVisible();
    // Its rating, whatever other tests have made of it by now.
    await expect(page.getByText(/^\d\.\d · \d+ ratings?$/)).toBeVisible();

    // One spelling list per section, and the question-type key beside them.
    await expect(page.getByText("Spell:")).toHaveCount(penguins.sectionCount);
    const key = page.getByRole("complementary", { name: "Question types" });
    await expect(key.getByRole("term").first()).toHaveText("K");
    await expect(key.getByRole("definition").first()).toHaveText("Known");

    // The About rail, with every way to take the lesson away.
    const about = page.getByRole("complementary").filter({ hasText: "About" });
    await expect(
      about.getByText(`Sections: ${penguins.sectionCount} sections`),
    ).toBeVisible();
    for (const action of ["Print", "Download PDF", "Download Word", "Fork"]) {
      await expect(about.getByRole("button", { name: action })).toBeVisible();
    }
  });

  test("steps through the lesson in interactive mode", async ({
    page,
    request,
  }) => {
    const penguins = await lessonByTitle(request, "Penguins");
    await page.goto(`/hub/${penguins.id}/practice`);

    const walkthrough = page.getByRole("dialog", { name: "Penguins" });
    await expect(walkthrough).toBeVisible();
    const position = walkthrough.getByText(/^Step \d+ of \d+/);
    await expect(position).toHaveText(/^Step 1 of \d+ · 0\/\d+ answered$/);
    await expect(
      walkthrough.getByRole("button", { name: "Back" }),
    ).toBeDisabled();

    await walkthrough.getByRole("button", { name: "Next" }).click();
    await expect(position).toHaveText(/^Step 2 of/);
    await expect(
      walkthrough.getByRole("button", { name: "Back" }),
    ).toBeEnabled();
    await walkthrough.getByRole("button", { name: "Back" }).click();
    await expect(position).toHaveText(/^Step 1 of/);

    // The first step is the first section's material: its words are there.
    await expect(walkthrough.getByText("Spelling words")).toBeVisible();
    await expect(walkthrough.getByRole("listitem").first()).toBeVisible();

    await walkthrough.getByRole("button", { name: "Close" }).click();
    await expect(walkthrough).toBeHidden();
  });

  test("lists the lesson's published history", async ({ page, request }) => {
    const penguins = await lessonByTitle(request, "Penguins");
    await page.goto(`/hub/${penguins.id}/history`);

    const entries = page.getByRole("main").getByRole("listitem");
    await expect(entries.first()).toBeVisible();
    await expect(entries.first()).toContainText("Maya Rivera");
    await expect(entries.first().locator("code")).toHaveText(/^[0-9a-f]{7}$/);
  });

  test("asks a visitor to sign in before commenting", async ({
    page,
    request,
  }) => {
    const penguins = await lessonByTitle(request, "Penguins");
    await page.goto(`/hub/${penguins.id}/discussion`);

    await expect(
      page.getByRole("heading", { name: /^Comments \(\d+\)$/ }),
    ).toBeVisible();
    await expect(
      page.getByText("Theo loved the emperor penguin section"),
    ).toBeVisible();
    await expect(
      page.getByText("Sign in to join the conversation."),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Add a comment" }),
    ).toBeHidden();
  });
});
