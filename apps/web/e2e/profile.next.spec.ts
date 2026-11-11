// A profile nobody has, on the new app: a 404 in both the status and the
// page. Only the new app answers it this way (its loader throws the status
// and the not-found page renders inside the shell); the old app's dev server
// answers every path with its shell under a 200 and shows an alert.
import { expect, test } from "@playwright/test";

test("a profile nobody has is a 404", async ({ page }) => {
  const response = await page.goto(
    "/users/00000000-0000-4000-8000-000000000000",
  );
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "There's nothing at this address",
    }),
  ).toBeVisible();
});
