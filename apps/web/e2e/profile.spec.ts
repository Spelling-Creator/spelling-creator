// A person's public profile, and following them.
import { expect, test } from "@playwright/test";
import { lessonByTitle, signedIn } from "./fixtures.ts";

test("shows a person's profile and their lessons, and lets a reader follow them", async ({
  browser,
  request,
}) => {
  // "Penguins" is Maya's, so its author's profile is hers.
  const penguins = await lessonByTitle(request, "Penguins");
  const context = await signedIn(browser, "daniel");
  const page = await context.newPage();
  await page.goto(`/users/${penguins.authorId}`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Maya Rivera" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Penguins", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^\d+ published lessons?$/)).toBeVisible();

  // Follow her, or unfollow her first if Daniel already does (the stub seeds
  // a few follows): either way the count moves with the button and comes
  // back where it started, so the stub is left as it was found.
  const followers = page.getByRole("button", { name: /^\d+ followers?$/ });
  const count = async () =>
    Number((await followers.textContent())!.match(/\d+/)![0]);
  // Exact names: "Following" the state is next to "3 following" the count.
  const follow = page.getByRole("button", { name: "Follow", exact: true });
  const following = page.getByRole("button", {
    name: "Following",
    exact: true,
  });
  const before = await count();
  if (await following.isVisible()) {
    await following.click();
    await expect(follow).toBeVisible();
    await expect.poll(count).toBe(before - 1);
    await follow.click();
    await expect(following).toBeVisible();
    await expect.poll(count).toBe(before);
  } else {
    await follow.click();
    await expect(following).toBeVisible();
    await expect.poll(count).toBe(before + 1);
    await following.click();
    await expect(follow).toBeVisible();
    await expect.poll(count).toBe(before);
  }

  await context.close();
});
