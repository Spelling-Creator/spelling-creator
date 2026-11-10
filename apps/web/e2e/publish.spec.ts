// Publishing a lesson to the hub, signed in.
import { expect, test } from "@playwright/test";
import {
  addSection,
  addText,
  hubLessons,
  lessonByTitle,
  signedIn,
  startLesson,
  unique,
} from "./fixtures.ts";

test("a signed-in author publishes a lesson to the hub", async ({
  browser,
  request,
}) => {
  const context = await signedIn(browser, "maya");
  const page = await context.newPage();

  const title = unique("Published penguins");
  await startLesson(page, title);
  await addSection(page, "Penguins");
  await addText(page, "Penguins are birds that cannot fly.");

  await page.getByRole("button", { name: "Save to cloud" }).click();
  await page.getByRole("menuitem", { name: /^Publish to hub/ }).click();

  // The hub has it, under her name.
  await expect
    .poll(
      async () =>
        (await hubLessons(request)).find((l) => l.title === title)?.author,
      { timeout: 20_000 },
    )
    .toBe("Maya Rivera");

  const published = await lessonByTitle(request, title);
  expect(published.sectionCount).toBe(1);
  await page.goto(`/hub/${published.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: title }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Penguins are birds that cannot fly."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Maya Rivera" }).first(),
  ).toBeVisible();

  // And the hub lists it.
  await page.goto("/hub");
  await expect(
    page.getByRole("link", { name: title, exact: true }),
  ).toBeVisible();

  await context.close();
});

test("an empty lesson can't be published", async ({ browser }) => {
  const context = await signedIn(browser, "maya");
  const page = await context.newPage();
  await startLesson(page, unique("Nothing here"));

  await page.getByRole("button", { name: "Save to cloud" }).click();
  await page.getByRole("menuitem", { name: /^Publish to hub/ }).click();
  await expect(
    page.getByText("Add at least one section before saving."),
  ).toBeVisible();

  await context.close();
});
