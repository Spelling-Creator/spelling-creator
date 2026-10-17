// The share code in a session socket's path, held to the same rule the Worker
// uses (SESSION_CODE_RE in apps/api/src/routes/collab.js), for both rooms the
// stub serves.
//
// It runs before the upgrade, inside the server's 'upgrade' listener, where a
// thrown error has nothing to catch it and would take the whole stub down. So a
// malformed escape (`/practice/%ZZ`) is answered 400 like any other bad code,
// never thrown.

const CODE_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * @param {string} pathname  The request path, e.g. `/practice/K7PM2X`.
 * @param {string} prefix    The room's path prefix, e.g. `/practice/`.
 * @returns {string|null}    The decoded code, or null when it isn't one.
 */
export function sessionCode(pathname, prefix) {
  let code;
  try {
    code = decodeURIComponent(pathname.slice(prefix.length)).trim();
  } catch {
    return null;
  }
  return CODE_RE.test(code) ? code : null;
}

/** Refuse an upgrade with a bad code, as the Worker does, before any socket. */
export function refuseUpgrade(socket) {
  socket.end(
    "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nInvalid session code.",
  );
}
