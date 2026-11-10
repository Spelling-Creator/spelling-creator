// Live collaboration, as React sees it.
//
// The session itself (the WebSocket to the CollabRoom Durable Object, the Yjs
// document, the slot-to-identity roster, admission, cursors, chat and the
// co-author list) is createCollabSession in
// @spelling-creator/core/browser/collabSession, which knows nothing about
// React. What is left here is the wiring: one session per editor, the document
// and the identity fed to it as they change, its snapshot read as state, and
// the session left when the editor unmounts. See
// apps/docs/docs/developers/web-app/live-collaboration.md.

import { useEffect, useState } from "react";
import { createCollabSession } from "@spelling-creator/core/browser/collabSession";
import { useStore } from "./useStore.js";

/**
 * Collaboration controller hook.
 *
 * @param {object}   opts
 * @param {object}   opts.doc          The current editor document (watched for changes to broadcast).
 * @param {Function} opts.onRemoteDoc  Called with a document received from the room; should replace local state.
 * @param {Function} [opts.onAdmitted] Guest only: called once the host admits us, before the room's
 *                                     document reaches `onRemoteDoc`, to give the session a lesson of its
 *                                     own. May return a promise; nothing is synced until it settles.
 * @param {object}   [opts.identity]   { uid, name, email, avatarUrl } describing the local user (used for our own chat bubbles, and so we never credit ourselves as a collaborator).
 * @param {string}   [opts.accessToken] The signed-in user's Supabase JWT; required to host or join.
 * @returns Collaboration state and actions (see the returned object).
 */
export function useCollaboration({
  doc,
  onRemoteDoc,
  onAdmitted,
  identity,
  accessToken,
}) {
  const [session] = useState(() =>
    createCollabSession({ doc, identity, onRemoteDoc, onAdmitted }),
  );

  // The latest document, identity and callbacks, for frames that arrive on a
  // later render. The document is what gets broadcast: the session debounces
  // it into the Y.Doc, and only once it is syncing.
  useEffect(() => {
    session.setDoc(doc);
  }, [session, doc]);
  useEffect(() => {
    session.setIdentity(identity);
  }, [session, identity]);
  useEffect(() => {
    session.setCallbacks({ onRemoteDoc, onAdmitted });
  }, [session, onRemoteDoc, onAdmitted]);

  // Tear the socket down with the component using this hook.
  useEffect(() => () => session.leave(), [session]);

  const {
    status,
    role,
    myCode,
    participants,
    requests,
    error,
    selections,
    messages,
    myId,
  } = useStore(session);

  return {
    status,
    role,
    myCode,
    participants,
    requests,
    error,
    active:
      status === "hosting" || status === "joined" || status === "connecting",
    selections,
    messages,
    myId,
    coAuthors: session.coAuthors,
    startHosting: () => session.startHosting(accessToken),
    joinSession: (code) => session.joinSession(code, accessToken),
    admit: session.admit,
    removeParticipant: session.removeParticipant,
    leave: session.leave,
    setLocalSelection: session.setLocalSelection,
    sendChat: session.sendChat,
    clearError: session.clearError,
  };
}
