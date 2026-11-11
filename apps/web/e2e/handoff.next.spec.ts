// The new app's hand-over of a path it doesn't serve yet.
//
// While the two apps share the site, a link in the new app to a page the old
// app still serves must leave as a document load, so the Worker can answer
// it with the old app, rather than render the new app's 404 client-side (see
// routes/not-found.tsx in apps/web-next). Only the new app does this, so the
// spec runs against it alone. Its dev server has no Worker in front of it,
// so what the document load lands on here is the new app's own not-found
// page; what matters is that the browser loaded a document at all.
import { expect, test } from "@playwright/test";

test("a link to a page the old app serves leaves as a document load", async ({
  page,
}) => {
  await page.goto("/hub");
  await expect(
    page.getByRole("heading", { level: 1, name: "Lesson hub" }),
  ).toBeVisible();

  // A client-side navigation never fires `load`; a document one does.
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("link", { name: "New lesson" }).click(),
  ]);
  await expect(page).toHaveURL(/\/editor\?new=1$/);
});
