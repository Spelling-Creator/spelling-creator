// GET /split: the app twice, side by side, signed in as two different people.
// Made for showing live collaboration. The left pane loads the app from its own
// origin and the right from a second one, so each keeps its own storage and its
// own session. Under portless the second is https://peer.stub.spelling-creator.localhost,
// an alias apps/web/vite.config.js registers for the same dev server. Without
// it, the pair is localhost and 127.0.0.1 on the same port.
//
//   /split?left=/editor&right=/editor&leftName=Maya%20Rivera&rightName=Daniel%20Okafor
//
// Each side still has to be signed in: sign in on each, or seed the sessions
// (see sessions.js).

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");

export function splitPage(url, appOrigin, peerOrigin) {
  const param = (name, fallback) => url.searchParams.get(name) || fallback;
  const left = new URL(appOrigin).origin + param("left", "/editor");
  const right = new URL(peerOrigin).origin + param("right", "/editor");
  const pane = (who, color) =>
    `<div class="who"><span class="dot" style="background:${color}"></span>${esc(who)}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Collaborate</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@600&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; height: 100%; background: #e4e6f3; font-family: "Public Sans", system-ui, sans-serif; }
  .stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 0 6px;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }
  .who { display: flex; align-items: center; gap: 10px; padding: 9px 18px; font-size: 17px; font-weight: 600; color: #3b3f5c; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
</style>
</head>
<body>
<div class="stage">
  ${pane(param("leftName", "Maya Rivera"), "#4f46e5")}
  ${pane(param("rightName", "Daniel Okafor"), "#0d9488")}
  <iframe id="left" src="${esc(left)}" allow="clipboard-read; clipboard-write"></iframe>
  <iframe id="right" src="${esc(right)}" allow="clipboard-read; clipboard-write"></iframe>
</div>
</body>
</html>`;
}
