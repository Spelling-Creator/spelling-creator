// The lesson hub: the public gallery and its client-side search.
import { expect, test } from "@playwright/test";
import {
  buildLessonIndex,
  searchLessons,
} from "@spelling-creator/core/lessonSearch";
import { hubLessons } from "./fixtures.ts";

test.describe("the lesson hub", () => {
  test("lists the published lessons and finds them by title or author", async ({
    page,
    request,
  }) => {
    const lessons = await hubLessons(request);
    await page.goto("/hub");
    await expect(
      page.getByRole("heading", { level: 1, name: "Lesson hub" }),
    ).toBeVisible();
    // A count, not the count: another test may publish while this one runs.
    await expect(page.getByText(/^\d+ lessons$/)).toBeVisible();
    for (const lesson of lessons.slice(0, 3)) {
      await expect(
        page.getByRole("link", { name: lesson.title, exact: true }),
      ).toBeVisible();
    }

    // The search is fuzzy, and the page builds its index with the same
    // function (core/lessonSearch), so what each query should show is worked
    // out the same way rather than guessed from the titles.
    const index = buildLessonIndex(lessons);
    expect(searchLessons(index, "Penguins")!.map((l) => l.title)).toContain(
      "Penguins",
    );
    const search = page.getByRole("textbox", { name: "Search lessons" });
    for (const query of ["Penguins", "Maya Rivera"]) {
      const found = new Set(searchLessons(index, query)!.map((l) => l.id));
      expect(found.size).toBeGreaterThan(0);
      expect(found.size).toBeLessThan(lessons.length);
      await search.fill(query);
      for (const lesson of lessons) {
        const link = page.getByRole("link", {
          name: lesson.title,
          exact: true,
        });
        if (found.has(lesson.id)) await expect(link).toBeVisible();
        else await expect(link).toBeHidden();
      }
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
