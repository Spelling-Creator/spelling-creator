// Commenting on and rating a lesson, signed in.
import { expect, test } from "@playwright/test";
import { lessonByTitle, signedIn, unique } from "./fixtures.ts";

test("a signed-in reader posts a comment and rates the lesson", async ({
  browser,
  request,
}) => {
  const penguins = await lessonByTitle(request, "Penguins");
  const context = await signedIn(browser, "sam");
  const page = await context.newPage();
  await page.goto(`/hub/${penguins.id}/discussion`);

  const heading = page.getByRole("heading", { name: /^Comments \(\d+\)$/ });
  await expect(heading).toBeVisible();
  const before = Number((await heading.textContent())!.match(/\((\d+)\)/)![1]);

  const text = unique("The huddle section was a hit with my spellers.");
  const box = page.getByRole("textbox", { name: "Add a comment" });
  await box.click();
  await page.keyboard.type(text);
  await page.getByRole("radio", { name: "4 stars" }).click();
  await page.getByRole("button", { name: "Post comment" }).click();

  await expect(heading).toHaveText(`Comments (${before + 1})`);
  await expect(page.getByText(text)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sam Carter" }).first(),
  ).toBeVisible();
  // The lesson's rating now counts theirs.
  await expect(page.getByText(/\d\.\d · \d+ ratings/)).toBeVisible();

  await context.close();
});
