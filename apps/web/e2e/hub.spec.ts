// The lesson hub: the public gallery and its client-side search.
import { expect, test } from "@playwright/test";
import { hubLessons } from "./fixtures.ts";

test.describe("the lesson hub", () => {
  test("lists the published lessons and finds one by title or author", async ({
    page,
    request,
  }) => {
    const lessons = await hubLessons(request);
    await page.goto("/hub");
    await expect(
      page.getByRole("heading", { level: 1, name: "Lesson hub" }),
    ).toBeVisible();
    await expect(page.getByText(`${lessons.length} lessons`)).toBeVisible();
    for (const lesson of lessons.slice(0, 3)) {
      await expect(
        page.getByRole("link", { name: lesson.title, exact: true }),
      ).toBeVisible();
    }

    // By title: "Penguins" stays, a lesson that isn't about them goes.
    const other = lessons.find(
      (l) => !/penguin/i.test(l.title) && l.author !== "Maya Rivera",
    )!;
    const search = page.getByRole("textbox", { name: "Search lessons" });
    await search.fill("Penguins");
    await expect(
      page.getByRole("link", { name: "Penguins", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: other.title, exact: true }),
    ).toBeHidden();

    // By author: every one of Maya's, and none of the others'.
    await search.fill("Maya Rivera");
    for (const lesson of lessons) {
      const link = page.getByRole("link", { name: lesson.title, exact: true });
      if (lesson.author === "Maya Rivera") await expect(link).toBeVisible();
      else await expect(link).toBeHidden();
    }
  });

  test("opens a lesson from the hub", async ({ page, request }) => {
    const penguins = (await hubLessons(request)).find(
      (l) => l.title === "Penguins",
    )!;
    await page.goto("/hub");
    await page.getByRole("link", { name: "Penguins", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/hub/${penguins.id}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Penguins" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Maya Rivera" }).first(),
    ).toBeVisible();
    for (const tab of [
      "Lesson",
      "Practice",
      "Discussion",
      "Proposals",
      "History",
    ]) {
      await expect(
        page.getByRole("link", { name: tab, exact: true }),
      ).toBeVisible();
    }
  });
});
