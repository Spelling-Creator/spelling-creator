// What the end-to-end specs share: a browser that starts out signed in to the
// stub, the stub's hub as data, and the editor's first steps.

import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
// Reached by path rather than as a workspace dependency: depending on the
// stub package would put it, and the API and MCP packages behind it, into
// turbo's dependency graph for the web app, so an edit to either would rerun
// the web app's build and tests. These two functions need nothing but the
// stub's list of people.
import { sessionFor, storageKey } from "../../stub-api/src/sessions.js";
import { STUB_URL } from "../playwright.config.ts";

/**
 * A browser context signed in as one of the stub's people (`maya`, `daniel`,
 * `priya`, `lars`, `jordan` or `sam`), by seeding the session where
 * supabase-js looks for it rather than going through the login page.
 */
export async function signedIn(
  browser: Browser,
  who: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [storageKey(STUB_URL), JSON.stringify(sessionFor(who))],
  );
  return context;
}

/** A published lesson as the stub's `GET /lessons` lists it. */
export interface HubLesson {
  id: string;
  title: string;
  author: string;
  /** The author's user id, which is their profile's path (/users/:id). */
  authorId: string;
  sectionCount: number;
}

export async function hubLessons(
  request: APIRequestContext,
): Promise<HubLesson[]> {
  const res = await request.get(`${STUB_URL}/lessons`);
  if (!res.ok()) throw new Error(`GET /lessons answered ${res.status()}`);
  const { lessons } = (await res.json()) as { lessons: HubLesson[] };
  return lessons;
}

/**
 * One of the stub's lessons by title. The stub reads real published lessons
 * from the live hub and credits a few, by title, to its made-up people
 * (`OWNERS` in apps/stub-api/src/seed.js); "Penguins" is Maya's, with a
 * comment and a proposal on it, which is what makes it the one to test with.
 */
export async function lessonByTitle(
  request: APIRequestContext,
  title: string,
): Promise<HubLesson> {
  const lesson = (await hubLessons(request)).find((l) => l.title === title);
  if (!lesson)
    throw new Error(`The stub's hub has no lesson called "${title}"`);
  return lesson;
}

/**
 * A name no other run has used. The stub keeps what a test publishes or
 * comments until it restarts, and the browser keeps what the editor saves,
 * so a test that writes gives its writing a name of its own.
 */
export function unique(label: string): string {
  return `${label} ${Date.now().toString(36)}`;
}

/**
 * A new lesson in the editor with this title, the first-lesson guide out of
 * the way. The heading follows the title, which is how the test knows the
 * editor has taken it.
 */
export async function startLesson(page: Page, title: string): Promise<void> {
  await page.goto("/editor?new=1");
  const titleBox = page.getByRole("textbox", { name: "Untitled Lesson" });
  await titleBox.waitFor();
  // The guide opens for every fresh browser, a moment after the editor does.
  // Closed when it comes, and not waited for forever in case it stops coming.
  const guide = page
    .getByRole("complementary", { name: "How to create a lesson" })
    .getByRole("button", { name: "close" });
  await guide.waitFor({ timeout: 5000 }).then(
    () => guide.click(),
    () => {},
  );
  await titleBox.fill(title);
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
}

/** Add a section through the editor's "New section" dialog. */
export async function addSection(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Add section" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New section" });
  await dialog.getByRole("textbox", { name: "Section name" }).fill(name);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Section name" })).toHaveValue(
    name,
  );
}

/** Add a text block to the (only) section and type into it. */
export async function addText(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "Add text" }).click();
  const box = page.getByRole("textbox", { name: "Lesson text" });
  await box.click();
  await page.keyboard.type(text);
  await expect(box).toHaveText(text);
}
