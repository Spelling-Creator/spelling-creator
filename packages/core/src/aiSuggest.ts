// Calls the apps/api Worker to generate suggested lesson text.
//
// The Worker validates the Turnstile token server-side (verifying both that the
// challenge passed and that it was solved on an allowed domain) before doing any
// AI work, so every request must carry a fresh token.
import { apiUrl, hasApi } from "./config.ts";
import type { LessonDoc, QuestionType } from "./types.ts";

/** A lesson topic the Worker suggests. */
export interface LessonIdea {
  /** Short enough to use as the lesson's title. */
  title: string;
  /** One sentence on what the lesson would cover. */
  description: string;
}

/**
 * Ask the Worker for a block of text about `subject`.
 * @param subject  Topic to write about.
 * @param token    Turnstile token from the widget's callback.
 * @param context  Extra context to help the model.
 * @param context.documentName  Title of the overall lesson/document.
 * @returns The generated text.
 */
export async function suggestText(
  subject: string,
  token: string,
  context: { documentName?: string } = {},
): Promise<string> {
  if (!hasApi()) {
    throw new Error("The API is not configured.");
  }
  if (!token) {
    throw new Error("Please complete the verification challenge first.");
  }

  let res;
  try {
    res = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        token,
        documentName: context.documentName || "",
      }),
    });
  } catch (e) {
    throw new Error("Could not reach the suggestion service.", { cause: e });
  }

  if (!res.ok) {
    // The Worker returns a plain-text reason for 4xx/5xx (e.g. rate limit,
    // failed verification). Surface it directly when present.
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Request failed (${res.status}).`);
  }

  const data: { text?: string } = await res.json().catch(() => ({}));
  return data.text || "";
}

/**
 * "Thumbs down" a suggested block of text: ask the Worker to evict it from its
 * cache so the next request for the same subject regenerates a fresh answer.
 *
 * Unlike `suggestText`, this is gated by a signed-in Supabase session (sent as
 * a Bearer credential the Worker verifies) rather than a Turnstile token — it
 * mutates server state on behalf of an account, so it requires sign-in.
 *
 * @param subject      The same subject the text was generated for.
 * @param accessToken  Supabase session JWT (from the auth context).
 * @param context      Extra context that shaped the text.
 * @param context.documentName  Title of the overall lesson/document.
 */
export async function dislikeText(
  subject: string,
  accessToken: string,
  context: { documentName?: string } = {},
): Promise<void> {
  if (!hasApi()) {
    throw new Error("The API is not configured.");
  }
  if (!accessToken) {
    throw new Error("Please sign in to give feedback.");
  }

  let res;
  try {
    res = await fetch(`${apiUrl()}/ai-text/dislike`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        subject,
        documentName: context.documentName || "",
      }),
    });
  } catch (e) {
    throw new Error("Could not reach the suggestion service.", { cause: e });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Request failed (${res.status}).`);
  }
}

/**
 * Ask the Worker to suggest a quiz question about `subject`.
 * @param subject  Topic for the question (the section title).
 * @param token    Turnstile token from the widget's callback.
 * @param context  Extra context to help the model.
 * @param context.questionType  One of the question type keys (default "single").
 * @param context.documentName  Title of the overall lesson/document.
 * @param context.sectionText   Existing section text to ground the question in.
 * @param context.existingQuestions  Prompts of questions already in the section, so the model can avoid repeats.
 * @returns The suggested question data (shape depends on type).
 */
export async function suggestQuestion(
  subject: string,
  token: string,
  context: {
    questionType?: QuestionType;
    documentName?: string;
    sectionText?: string;
    existingQuestions?: string[];
  } = {},
): Promise<unknown> {
  if (!hasApi()) {
    throw new Error("The API is not configured.");
  }
  if (!token) {
    throw new Error("Please complete the verification challenge first.");
  }

  let res;
  try {
    res = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "question",
        subject,
        token,
        questionType: context.questionType || "single",
        documentName: context.documentName || "",
        sectionText: context.sectionText || "",
        existingQuestions: Array.isArray(context.existingQuestions)
          ? context.existingQuestions
          : [],
      }),
    });
  } catch (e) {
    throw new Error("Could not reach the suggestion service.", { cause: e });
  }

  if (!res.ok) {
    // The Worker returns a plain-text reason for 4xx/5xx (e.g. rate limit,
    // failed verification). Surface it directly when present.
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Request failed (${res.status}).`);
  }

  const data: { question?: unknown } = await res.json().catch(() => ({}));
  return data.question || {};
}

/**
 * Ask the Worker to suggest a batch of lesson topic ideas for an age range.
 * @param ageRange  The age range the lesson is pitched at (may be empty).
 * @param token     Turnstile token from the widget's callback.
 * @returns Suggested ideas.
 */
export async function suggestLessonIdeas(
  ageRange: string,
  token: string,
): Promise<LessonIdea[]> {
  if (!hasApi()) {
    throw new Error("The API is not configured.");
  }
  if (!token) {
    throw new Error("Please complete the verification challenge first.");
  }

  let res;
  try {
    res = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "lessonIdea",
        ageRange: ageRange || "",
        token,
      }),
    });
  } catch (e) {
    throw new Error("Could not reach the suggestion service.", { cause: e });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Request failed (${res.status}).`);
  }

  const data: { ideas?: LessonIdea[] } = await res.json().catch(() => ({}));
  return Array.isArray(data.ideas) ? data.ideas : [];
}

/**
 * Ask the Worker for a fix to one lesson check finding. The Worker finds the
 * finding again by its key, asks a model, and only answers with a fix that
 * passes the checks (see apps/api/src/lib/lessonFix.js).
 * @param doc         The lesson as it is now.
 * @param findingKey  The finding's `key`.
 * @param token       Turnstile token from the widget's callback.
 * @returns `operations` are replace_block operations for ./lessonAiFixes.ts
 *   applyFixOperations, which checks them.
 */
export async function suggestFix(
  doc: LessonDoc,
  findingKey: string,
  token: string,
): Promise<{
  operations: unknown[];
  explanation: string;
  newWarnings: number;
}> {
  if (!hasApi()) {
    throw new Error("The API is not configured.");
  }
  if (!token) {
    throw new Error("Please complete the verification challenge first.");
  }

  let res;
  try {
    res = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "fix",
        doc: {
          title: doc.title || "",
          sources: doc.sources || [],
          // The checks never read an image, and an old lesson can hold one
          // inline as a data URL, so only its place is sent.
          sections: (doc.sections || []).map((section) => ({
            id: section.id,
            name: section.name,
            blocks: (section.blocks || []).map((block) =>
              block?.type === "image" ? { id: block.id, type: "image" } : block,
            ),
          })),
        },
        findingKey,
        documentName: doc.title || "",
        token,
      }),
    });
  } catch (e) {
    throw new Error("Could not reach the suggestion service.", { cause: e });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Request failed (${res.status}).`);
  }

  const data: {
    operations?: unknown;
    explanation?: unknown;
    newWarnings?: unknown;
  } = await res.json().catch(() => ({}));
  return {
    operations: Array.isArray(data.operations) ? data.operations : [],
    explanation: typeof data.explanation === "string" ? data.explanation : "",
    newWarnings: Number(data.newWarnings) || 0,
  };
}

/**
 * Ask the Worker to check a lesson's numbers and dates against Wikidata.
 * @param passages  The lesson's text blocks, in order (see lessonPassages in
 *   ./factCheck.ts).
 * @param token  Turnstile token from the widget's callback.
 * @param context.documentName  Title of the lesson.
 * @returns One result per fact found, each carrying the `blockId` of the
 *   passage it is in (see ./factCheck.ts for the rest).
 */
export async function checkFacts(
  passages: { blockId: string; text: string }[],
  token: string,
  context: { documentName?: string } = {},
): Promise<unknown[]> {
  if (!hasApi()) {
    throw new Error("The API is not configured.");
  }
  if (!token) {
    throw new Error("Please complete the verification challenge first.");
  }

  let res;
  try {
    res = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "factCheck",
        passages: passages.map(({ blockId, text }) => ({ blockId, text })),
        documentName: context.documentName || "",
        token,
      }),
    });
  } catch (e) {
    throw new Error("Could not reach the fact checking service.", {
      cause: e,
    });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Request failed (${res.status}).`);
  }

  const data: { facts?: unknown } = await res.json().catch(() => ({}));
  return Array.isArray(data.facts) ? data.facts : [];
}
