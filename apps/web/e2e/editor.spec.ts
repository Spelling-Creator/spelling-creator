// Building a lesson in the editor, with no account: it is kept in the
// browser, with a version taken whenever the writer pauses.
import { expect, test } from "@playwright/test";
import { addSection, addText, startLesson, unique } from "./fixtures.ts";

test("builds a lesson on this device and keeps its versions", async ({
  page,
}) => {
  const title = unique("Playwright penguins");
  await startLesson(page, title);
  await addSection(page, "Penguins");
  await expect(page.getByText("1 section · 0 content blocks")).toBeVisible();

  await addText(page, "Penguins are birds that cannot fly.");
  await expect(page.getByText("1 section · 1 content block")).toBeVisible();
  await expect(
    page
      .getByRole("complementary")
      .getByRole("button", { name: /^1 Penguins 1$/ }),
  ).toBeVisible();

  // A version is taken once the writer pauses; the chip says so.
  const chip = page.getByRole("button", {
    name: /unsaved change|Version saved/,
  });
  await expect(chip).toHaveText(/unsaved change/);
  await expect(chip).toHaveText(/^Version saved/, { timeout: 20_000 });

  await chip.click();
  const history = page.getByRole("dialog", { name: "Version history" });
  await expect(
    history.getByRole("button", { name: /Current · just now/ }),
  ).toBeVisible();
  await expect(
    history.getByRole("listitem").filter({ hasText: `"${title}"` }),
  ).toBeVisible();
  await expect(
    history.getByRole("listitem").filter({ hasText: 'add section "Penguins"' }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(history).toBeHidden();

  // The library lists it, and opens it again as it was left.
  await page.getByRole("link", { name: "On this device" }).click();
  await expect(
    page.getByRole("heading", { name: "Lessons on this device" }),
  ).toBeVisible();
  const entry = page.getByRole("button", {
    name: new RegExp(
      `^${RegExp.escape(title)} \\(open in the editor\\) 1 section · 1 block`,
    ),
  });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Section name" })).toHaveValue(
    "Penguins",
  );
  await expect(page.getByRole("textbox", { name: "Lesson text" })).toHaveText(
    "Penguins are birds that cannot fly.",
  );
});
