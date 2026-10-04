// Crediting everyone in a live session, and signing commits without anybody's
// real email address.
//
// Driven through the real engine over the in-memory filesystem, like the other
// git tests: what matters is what a commit says once git has stored it and read
// it back, not what we meant to write.

import * as git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { memRepo } from "./memfs.js";
import {
  COMMIT_EMAIL_DOMAIN,
  authorFrom,
  coAuthorTrailers,
  commitDoc,
  history,
  readCoAuthors,
} from "./repo.js";

const HOST = { uid: "11111111-1111-4111-8111-111111111111", name: "Alex" };
const SAM = { uid: "22222222-2222-4222-8222-222222222222", name: "Sam" };
const PRIYA = { uid: "33333333-3333-4333-8333-333333333333", name: "Priya" };

function doc(text) {
  return {
    title: "Week 1",
    sections: [
      { id: "s1", name: "One", blocks: [{ id: "b1", type: "text", text }] },
    ],
  };
}

describe("authorFrom", () => {
  it("signs with the account id, never the email it is given", () => {
    const author = authorFrom({ ...HOST, email: "alex@school.org" });
    expect(author).toEqual({
      name: "Alex",
      email: `${HOST.uid}@${COMMIT_EMAIL_DOMAIN}`,
    });
  });

  it("falls back to the generic signature without an identity", () => {
    expect(authorFrom(null)).toEqual({
      name: "Spelling Creator",
      email: "lessons@local",
    });
    expect(authorFrom({ email: "alex@school.org" }).email).toBe(
      "lessons@local",
    );
  });

  it("keeps a name to one line with no angle brackets", () => {
    expect(authorFrom({ ...HOST, name: "Al<ex>\nEvil" }).name).toBe(
      "Alex Evil",
    );
  });
});

describe("coAuthorTrailers", () => {
  const author = authorFrom(HOST);

  it("credits each person once, and never the author", () => {
    expect(coAuthorTrailers([SAM, HOST, SAM, PRIYA], author)).toEqual([
      `Co-authored-by: Sam <${SAM.uid}@${COMMIT_EMAIL_DOMAIN}>`,
      `Co-authored-by: Priya <${PRIYA.uid}@${COMMIT_EMAIL_DOMAIN}>`,
    ]);
  });

  it("skips anyone without a usable account id", () => {
    expect(
      coAuthorTrailers(
        [{ name: "Nobody" }, { uid: "x>\nCo-authored-by: Forged", name: "F" }],
        author,
      ),
    ).toEqual([]);
  });
});

describe("readCoAuthors", () => {
  it("reads only the final paragraph", () => {
    const message =
      "Edit 1 text block\n\n- edit text block b1\nCo-authored-by: Not <a@b>\n\n" +
      "Co-authored-by: Sam <s@x.invalid>\n";
    expect(readCoAuthors(message)).toEqual([
      { name: "Sam", email: "s@x.invalid" },
    ]);
  });

  it("finds nothing in a message with no trailers", () => {
    expect(
      readCoAuthors("Edit 1 text block\n\n- edit text block b1\n"),
    ).toEqual([]);
  });
});

describe("commitDoc with co-authors", () => {
  it("writes git trailers that history reads back", async () => {
    const ctx = memRepo();
    await commitDoc({ ...ctx, doc: doc("one"), author: HOST });
    await commitDoc({
      ...ctx,
      doc: doc("two"),
      author: HOST,
      coAuthors: [SAM, PRIYA],
    });

    const [latest, first] = await history(ctx);
    expect(latest.author).toBe("Alex");
    expect(latest.coAuthors).toEqual(["Sam", "Priya"]);
    expect(latest.summary).toBe("Edit 1 text block");
    expect(first.coAuthors).toEqual([]);

    // The trailers are where git itself looks for them: after a blank line,
    // at the very end.
    const { commit } = await git.readCommit({ ...ctx, oid: latest.oid });
    expect(
      commit.message.endsWith(
        `\n\nCo-authored-by: Sam <${SAM.uid}@${COMMIT_EMAIL_DOMAIN}>\n` +
          `Co-authored-by: Priya <${PRIYA.uid}@${COMMIT_EMAIL_DOMAIN}>\n`,
      ),
    ).toBe(true);
    expect(commit.author.email).toBe(`${HOST.uid}@${COMMIT_EMAIL_DOMAIN}`);
  });

  it("adds no trailer block when nobody else edited", async () => {
    const ctx = memRepo();
    await commitDoc({ ...ctx, doc: doc("one"), author: HOST, coAuthors: [] });
    const [latest] = await history(ctx);
    expect(latest.message).not.toMatch(/Co-authored-by/);
  });
});
