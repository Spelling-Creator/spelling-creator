// Live collaboration between two browsers through the stub's room: the host
// starts a session, the guest asks in and waits, the host admits them, and
// edits then sync both ways.
import { expect, test } from "@playwright/test";
import {
  addSection,
  escapeRe,
  signedIn,
  startLesson,
  unique,
} from "./fixtures.ts";

test("a guest is admitted by the host and edits sync both ways", async ({
  browser,
}) => {
  const hostContext = await signedIn(browser, "maya");
  const guestContext = await signedIn(browser, "daniel");
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const title = unique("Shared lesson");
  await startLesson(host, title);
  await addSection(host, "Together");

  // The host starts a session and gets a code.
  await host.getByRole("button", { name: "Collaborate" }).click();
  const hostDialog = host.getByRole("dialog", {
    name: "Collaborate on this lesson",
  });
  await hostDialog
    .getByRole("button", { name: "Start a collaboration session" })
    .click();
  await expect(hostDialog.getByText("Your session is live")).toBeVisible();
  const code = await hostDialog.getByRole("textbox").first().inputValue();
  expect(code).not.toBe("");

  // The guest, in a lesson of their own, joins with it and waits.
  const guestsOwn = unique("Daniel's own lesson");
  await startLesson(guest, guestsOwn);
  await guest.getByRole("button", { name: "Collaborate" }).click();
  const guestDialog = guest.getByRole("dialog", {
    name: "Collaborate on this lesson",
  });
  await guestDialog.getByRole("textbox", { name: "Session code" }).fill(code);
  await guestDialog.getByRole("button", { name: "Join", exact: true }).click();
  await expect(
    guestDialog.getByText("Waiting for the host to add you to the lesson."),
  ).toBeVisible();

  // The host sees them waiting and adds them.
  await expect(hostDialog.getByText("Waiting to join (1)")).toBeVisible();
  await expect(hostDialog.getByText("Daniel Okafor")).toBeVisible();
  await hostDialog.getByRole("button", { name: "Add to lesson" }).click();
  await expect(hostDialog.getByText("In this lesson (2)")).toBeVisible();
  await expect(
    hostDialog.getByRole("button", { name: "Remove from lesson" }),
  ).toBeVisible();
  await expect(
    guestDialog.getByText("You're collaborating live."),
  ).toBeVisible();

  // The guest's editor now holds the host's lesson, not the one they had open.
  await guestDialog.getByRole("button", { name: "Close" }).first().click();
  await expect(
    guest.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await expect(
    guest.getByRole("textbox", { name: "Section name" }),
  ).toHaveValue("Together");
  await expect(guest.getByRole("button", { name: "Open chat" })).toBeVisible();

  // An edit by either side reaches the other.
  await hostDialog.getByRole("button", { name: "Close" }).first().click();
  await guest
    .getByRole("textbox", { name: "Section name" })
    .fill("Together, says Daniel");
  await expect(host.getByRole("textbox", { name: "Section name" })).toHaveValue(
    "Together, says Daniel",
    { timeout: 10_000 },
  );
  const retitled = `${title}, says Maya`;
  await host.getByRole("textbox", { name: "Untitled Lesson" }).fill(retitled);
  await expect(
    guest.getByRole("heading", { level: 1, name: retitled }),
  ).toBeVisible({
    timeout: 10_000,
  });

  // The guest's own lesson is untouched by any of it, and the session's
  // lesson sits beside it in their library as the one open in the editor.
  await guest.getByRole("link", { name: "On this device" }).click();
  await expect(
    guest.getByRole("button", {
      name: new RegExp(`^${escapeRe(guestsOwn)} 0 sections · 0 blocks`),
    }),
  ).toBeVisible();
  await expect(
    guest.getByRole("button", {
      name: new RegExp(
        `^${escapeRe(retitled)} \\(open in the editor\\) 1 section`,
      ),
    }),
  ).toBeVisible();

  await guestContext.close();
  await hostContext.close();
});
