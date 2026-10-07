// The tools that put an assistant into a live collaboration session.
//
// Nothing here is held open. The room keeps the assistant as a participant it
// can be asked about (see collab.js), so each tool call is one request, and
// the only thing carried between calls is a handle naming the session: its
// share code, the participant token the room issued, and our slot. That handle
// lives in a store the transport provides. On stdio it is a variable in this
// process; on the remote transport it is the connection's Durable Object
// storage, because that object hibernates between tool calls and rebuilds this
// server on the way back. Either way the tools read it fresh every call.
//
// One session at a time. An assistant with two sessions open has no way to say
// which one it means, and the room caps a session at ten participants anyway;
// the tools all speak about "the session" for that reason.
//
// collab.js holds the document arithmetic; this file is the MCP surface over
// it: schemas, the authoring standard, and results written for a model that
// cannot see the teacher's screen.

import { z } from "zod";

import { presentDoc } from "@spelling-creator/core/lessonBuild";
import { applyPatch } from "@spelling-creator/core/lessonPatch";
import { docFromY } from "@spelling-creator/core/ydoc";
import {
  JOIN_WAIT_MS,
  busyBlocks,
  chatOf,
  docOf,
  replicaOf,
  updateFor,
  waitForAdmission,
} from "./collab.js";

/** The blocks a set of patch operations would touch, by id. */
function touchedBlocks(operations) {
  const ids = [];
  for (const op of operations) {
    if (typeof op?.blockId === "string") ids.push(op.blockId);
  }
  return ids;
}

/**
 * The default session store: one variable, for a transport that is one
 * process per client and dies with it.
 */
export function memorySessionStore() {
  let handle = null;
  return {
    get: async () => handle,
    set: async (next) => {
      handle = next;
    },
    clear: async () => {
      handle = null;
    },
  };
}

/**
 * Attach the session tools.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ api: any, text: Function, tool: Function, standardFindings: Function, clientName: Function,
 *   sessionStore?: { get: Function, set: Function, clear: Function }, joinWaitMs?: number }} ctx
 */
export function registerCollabTools(server, ctx) {
  const {
    api,
    text,
    tool,
    clientName,
    standardFindings,
    joinWaitMs = JOIN_WAIT_MS,
  } = ctx;
  const store = ctx.sessionStore || memorySessionStore();

  const NOT_IN_SESSION =
    "Not in a collaboration session. Call join_collab_session with the host's share code first. To edit a " +
    "lesson that is saved on the hub instead, use patch_lesson.";

  const endedMessage = (code, reason) =>
    reason === "removed"
      ? `The host removed you from session "${code}". That is their decision; don't rejoin unless they ask. To ` +
        "edit the saved lesson instead, use patch_lesson."
      : `The collaboration session "${code}" ended (${reason}). Join again with join_collab_session if the host ` +
        "is still hosting one, or edit the saved lesson through the hub with patch_lesson.";

  const forgottenMessage = (code) =>
    `Session "${code}" no longer knows this participant. Join again with join_collab_session if the host is ` +
    "still hosting; otherwise edit the saved lesson with patch_lesson.";

  const stillWaitingMessage = (code) =>
    `The request to join session "${code}" is still waiting for the host to admit it. Ask them to click Add in ` +
    "the Collaborate dialog, then call join_collab_session again with the same code to keep waiting; it picks " +
    "this request back up rather than sending a new one.";

  // Run one ask of the room on the session's behalf. A 410 means the room has
  // let us go, and says why; a 404 means it has forgotten us outright. Both
  // end the session here too, so the next call starts clean.
  const ask = async (handle, fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err?.gone) {
        await store.clear();
        throw new Error(endedMessage(handle.code, err.gone));
      }
      if (err?.status === 404) {
        await store.clear();
        throw new Error(forgottenMessage(handle.code));
      }
      throw err;
    }
  };

  /**
   * The session we're in and its state now, or a clear error naming what to
   * do. `doc: false` skips the document, for a call that doesn't need it.
   */
  const current = async ({ doc = true } = {}) => {
    const handle = await store.get();
    if (!handle) throw new Error(NOT_IN_SESSION);
    const state = await ask(handle, () =>
      api.collabState(handle.code, handle.token, { doc }),
    );
    if (!state.admitted) throw new Error(stillWaitingMessage(handle.code));
    return { handle, state };
  };

  // Reading the state drains the room's chat inbox for us, so anything said
  // since the last look is in `state` and nowhere else now. An error raised
  // after that point must carry it, or the teacher's reply to the assistant's
  // last question is lost in the very call that fetched it.
  const withChat = (err, state) => {
    const chat = chatOf(state);
    if (chat.length) {
      err.message +=
        "\n\nSaid in the session since you last looked (delivered now, it won't repeat): " +
        JSON.stringify(chat);
    }
    return err;
  };

  // The roster and any chat waiting, folded into every result. Several
  // envelopes may have arrived in one tool call (a read, then a write); the
  // roster is the latest one's and the chat is all of it, in order.
  const roomState = (...states) => {
    const last = states[states.length - 1];
    const chat = states.flatMap(chatOf);
    return {
      participants: (last.participants || []).map((p) => ({
        name: p.name,
        host: Boolean(p.host),
      })),
      ...(chat.length ? { chat } : {}),
    };
  };

  const joinedSummary = (code, state, note) => {
    const doc = docOf(state);
    return {
      joined: code,
      title: doc.title,
      sections: (doc.sections || []).map((s, i) => ({
        number: i + 1,
        id: s.id,
        name: s.name,
        blocks: (s.blocks || []).length,
      })),
      ...roomState(state),
      note:
        note ||
        "You are in the session and this is the live lesson. Anything you change with edit_collab_doc appears " +
          "on their screen as you make it, so make one deliberate edit at a time rather than rewriting in a " +
          "burst, and say what you are doing in the chat.",
    };
  };

  server.registerTool(
    "join_collab_session",
    {
      title: "Join a live collaboration session",
      description:
        "Join a lesson the user is editing live in the web app, as a participant in the session — the same way " +
        "another teacher would. Ask them to click Collaborate in the editor and read you the share code.\n\n" +
        "WHY THIS AND NOT get_lesson: a live session's document exists only in the session until somebody saves " +
        "it, so the copy on the hub is whatever it was before they started. While a session is running this is the " +
        "real lesson, and patch_lesson would be editing a stale copy that their next save overwrites.\n\n" +
        "THE HOST HAS TO ADMIT YOU. This waits most of a minute for them to accept the request in the " +
        "collaboration dialog, so tell them to expect it. If they haven't by then, the result says so and the " +
        "request stays in their dialog: call this again with the same code to keep waiting (it resumes that " +
        "request, it doesn't send another). If they decline, that is their answer; don't rejoin unless they " +
        "ask.\n\n" +
        "Once in, you are a visible participant: your edits appear live under their own name, the user watches " +
        "them land, and they can remove you at any moment. Read the lesson with read_collab_doc, change it with " +
        "edit_collab_doc, and talk to the room with send_collab_chat — ask there rather than guessing, since the " +
        "user is right there.",
      inputSchema: {
        code: z
          .string()
          .describe(
            "The session's share code, from the Collaborate dialog in the web editor.",
          ),
      },
    },
    tool(async ({ code }) => {
      // Declare what this is. The room shows an assistant as a participant of
      // its own rather than as a second cursor wearing the account holder's
      // name (see handleCollabAgent in apps/api/src/routes/collab.js). The label
      // is the connecting MCP client's own account of itself ("Claude Desktop"),
      // which is the most useful thing the teacher could be told about who is
      // typing.
      const assistant = clientName() || "AI assistant";

      // Already in, or waiting on, a session? The store says which; the room
      // says whether that is still true.
      let handle = await store.get();
      if (handle) {
        let state = null;
        try {
          state = await api.collabState(handle.code, handle.token);
        } catch (err) {
          if (!err?.gone && err?.status !== 404) throw err;
          await store.clear();
          // A decline found out about here is still a decline. Quietly sending
          // the host a second request would be exactly the rejoin the
          // description rules out; the next call starts clean if they ask.
          if (err.gone === "removed") {
            throw new Error(
              `The host declined the request to join session "${handle.code}" (or removed you from it). That ` +
                "is their answer; don't rejoin unless they ask. To edit the saved lesson instead, use patch_lesson.",
            );
          }
          handle = null;
        }
        if (handle && handle.code !== code) {
          throw new Error(
            state.admitted
              ? `Already in session "${handle.code}". Call leave_collab_session before joining another: one at ` +
                  "a time, so there is never a question about which session an edit is going to."
              : `A request to join session "${handle.code}" is still waiting for the host. Call ` +
                  "leave_collab_session to withdraw it before asking to join a different session.",
          );
        }
        if (handle && state.admitted) {
          return text(
            joinedSummary(
              code,
              state,
              "Already in this session; nothing new was sent to the host. This is the live lesson as it stands.",
            ),
          );
        }
        // Same code, still pending: fall through and keep waiting on it.
      }

      if (!handle) {
        let joined;
        try {
          joined = await api.collabJoin(code, assistant);
        } catch (err) {
          if (err?.status === 404) {
            throw new Error(
              `No live session is running under the code "${code}". Ask the host to start collaborating in the ` +
                "web editor and give you the code it shows.",
            );
          }
          throw err;
        }
        handle = { code, token: joined.token, slot: joined.slot };
        await store.set(handle);
      }

      let state;
      try {
        state = await waitForAdmission(api, handle, { budgetMs: joinWaitMs });
      } catch (err) {
        if (err?.status === 404) {
          // The room forgot the request mid-wait (swept, or a new session took
          // over the room). Nothing to resume; the next call starts clean.
          await store.clear();
          throw new Error(forgottenMessage(code));
        }
        if (!err?.gone) throw err;
        await store.clear();
        throw new Error(
          err.gone === "removed"
            ? `The host declined the request to join session "${code}". That is their answer; don't rejoin ` +
                "unless they ask."
            : `Couldn't join session "${code}": ${err.gone}`,
        );
      }

      if (!state.admitted) {
        return text({
          waiting: code,
          note:
            "The host hasn't admitted you yet. The request is still showing in their Collaborate dialog: ask " +
            "them to click Add, then call join_collab_session again with the same code to keep waiting (it " +
            "resumes this request rather than sending a new one). A request nobody answers is withdrawn on its " +
            "own after five minutes.",
        });
      }
      return text(joinedSummary(code, state));
    }),
  );

  server.registerTool(
    "read_collab_doc",
    {
      title: "Read the live lesson",
      description:
        "The lesson as the session holds it right now, including edits the user has just made and anything not " +
        "yet saved. Read this before editing rather than trusting an earlier copy — in a live session the " +
        "document moves under you. Also returns anything said in the session's chat since you last looked.",
      inputSchema: {},
    },
    tool(async () => {
      const { state } = await current();
      return text({ doc: presentDoc(docOf(state)), ...roomState(state) });
    }),
  );

  server.registerTool(
    "edit_collab_doc",
    {
      title: "Edit the live lesson",
      description:
        "Change the lesson in the session, with the same operations as patch_lesson (call read_collab_doc first " +
        "for the current section and block ids). The edit is merged into the shared document and appears on " +
        "everyone's screen immediately.\n\n" +
        "The session is a CRDT, so your edits and the user's merge as long as they are in different places — but " +
        "two people writing the SAME field is still last-write-wins, and the loser is whoever typed first. So " +
        "this refuses a block another participant's cursor is sitting in: leave it, or ask them in the chat to " +
        "move off it.\n\n" +
        "Nothing here is saved to the hub. The session's document is the user's to keep — they save it from the " +
        "editor — so don't call update_lesson or patch_lesson to 'finish the job'; that writes to the stale copy " +
        "and their next save discards it.\n\n" +
        "The result is checked against the authoring standard and reports what your edit breaks, but it does NOT " +
        "reject: this is the user's live document, and refusing to make a change they asked for because a " +
        "different section is off-standard would be worse than telling them about it.",
      inputSchema: {
        operations: z
          .array(z.record(z.any()))
          .min(1)
          .describe(
            "patch_lesson's operations, applied in order (set_title, set_section_name, add_section, " +
              "remove_section, move_section, add_block, replace_block, remove_block, move_block).",
          ),
      },
    },
    tool(async ({ operations }) => {
      // The state is read at the moment of the edit, not cached: a cursor a
      // second old is a guess about where somebody is now, and so is the
      // document.
      const { handle, state } = await current();

      let doc;
      let update;
      let after;
      try {
        const busy = busyBlocks(state);
        const clashes = touchedBlocks(operations)
          .filter((id) => busy.has(id))
          .map((id) => ({ blockId: id, editedBy: busy.get(id) }));
        if (clashes.length) {
          throw new Error(
            `Someone else's cursor is in ${clashes.length === 1 ? "a block" : "blocks"} this edit would rewrite: ` +
              `${clashes.map((c) => `${c.blockId} (${c.editedBy})`).join(", ")}. Text in a single field doesn't ` +
              "merge, so one of you would lose the sentence. Edit somewhere else, or ask in the chat for them to " +
              "move off it and try again.",
          );
        }

        // One replica serves both the document the patch is applied to and the
        // update that results; decoding a large lesson twice would be the
        // slowest part of the call.
        const replica = replicaOf(state);
        doc = applyPatch(docFromY(replica), operations);
        update = updateFor(replica, doc);
        // An edit that changes nothing sends nothing: the room would relay it
        // anyway, and credit nobody, but there is no reason to make it.
        after = update
          ? await ask(handle, () =>
              api.collabUpdate(handle.code, handle.token, update),
            )
          : state;
      } catch (err) {
        throw withChat(err, state);
      }

      const { failures, flags } = standardFindings({ doc });
      return text({
        applied: operations.length,
        changed: Boolean(update),
        title: doc.title,
        sections: (doc.sections || []).length,
        ...roomState(state, after),
        // Reported, never enforced. See the tool description.
        ...(failures.length
          ? {
              standardProblems: failures.map(({ code, section, message }) => ({
                code,
                section,
                message,
              })),
            }
          : {}),
        ...(flags.length
          ? {
              standardWarnings: flags.map(({ code, section, message }) => ({
                code,
                section,
                message,
              })),
            }
          : {}),
        note:
          "The edit is live on everyone's screen. It is NOT saved — the user saves the session from the editor " +
          "when they're happy with it.",
      });
    }),
  );

  server.registerTool(
    "send_collab_chat",
    {
      title: "Say something in the session",
      description:
        "Send a message to everyone in the session. This is the channel for asking rather than assuming — which " +
        "section they want next, whether a passage is pitched right, whether you should change something you're " +
        "unsure about. The user is in the room and can answer; their replies come back with your next " +
        "read_collab_doc or edit_collab_doc.\n\n" +
        "Say what you are about to do before a large edit, so nobody watches text rewrite itself with no " +
        "explanation. About one message a second is the room's limit; there is no reason to go near it.",
      inputSchema: {
        text: z.string().min(1).max(2000).describe("The message to send."),
      },
    },
    tool(async ({ text: body }) => {
      // Saying something needs the roster and the chat, not the document.
      const { handle, state } = await current({ doc: false });
      let after;
      try {
        after = await ask(handle, () =>
          api.collabChat(handle.code, handle.token, body),
        );
      } catch (err) {
        throw withChat(err, state);
      }
      return text({ sent: body, ...roomState(state, after) });
    }),
  );

  server.registerTool(
    "leave_collab_session",
    {
      title: "Leave the session",
      description:
        "Leave the collaboration session. The lesson stays exactly as it is, since leaving changes nothing the " +
        "session holds, and frees the participant slot (a room holds ten). Say goodbye in the chat first.",
      inputSchema: {},
    },
    tool(async () => {
      const handle = await store.get();
      if (!handle) {
        return text("Not in a collaboration session; nothing to leave.");
      }
      // Leaving a session that has already let us go is still leaving: the
      // room's answer doesn't change what happens here.
      try {
        await api.collabLeave(handle.code, handle.token);
      } catch (err) {
        if (!err?.gone && err?.status !== 404) throw err;
      }
      await store.clear();
      return text(
        `Left session "${handle.code}". The lesson is untouched and whatever you changed is still in the ` +
          "session for the host to save.",
      );
    }),
  );
}
