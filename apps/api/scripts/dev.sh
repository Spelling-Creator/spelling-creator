#!/bin/sh
#
# `pnpm dev`: wrangler dev, run through portless (see "Local URLs" in
# apps/docs/docs/developers/getting-started.md).
#
# wrangler doesn't read PORT or HOST, so the port and address portless picked
# are passed on as flags. HOST is normally 127.0.0.1, which is also the
# fallback.
#
# portless's proxy talks plain http to wrangler whatever the browser used, so
# without more the Worker would see http:// request URLs and build http://
# links from them: in robots.txt, the sitemap and, worst, the OAuth metadata,
# whose issuer then no longer matches the address it was fetched from.
# --local-upstream rewrites every request URL to the host portless serves it
# on (worktree prefix included), and --upstream-protocol to its scheme. Both
# come from PORTLESS_URL, so a proxy run with --no-tls gets http:// links, as
# it should. The protocol has to be given: wrangler's help says it defaults to
# https, but in local mode it defaults to the protocol wrangler listens on.
#
# ALLOWED_HOSTNAMES is the Worker's CORS allowlist. Locally the page calling it
# is `pnpm dev:web`, so that is the hostname let in (`portless get` names it,
# worktree prefix included), in place of the production one.
#
# FEDERATION_ORIGIN is the address that goes into every ActivityPub id this
# Worker mints. wrangler.jsonc sets the production one, so it has to be
# overridden with the local address or a local actor would claim to live on
# the real site. Federation only runs on an https origin, so it is on under
# portless and off with PORTLESS=0, whose plain http address it refuses.
#
# With PORTLESS=0 there is no PORTLESS_URL, and wrangler runs on its own port
# (8787) as before.

if [ -z "$PORTLESS_URL" ]; then
  exec wrangler dev --var "FEDERATION_ORIGIN:http://localhost:8787"
fi

scheme="${PORTLESS_URL%%://*}"
upstream="${PORTLESS_URL#*://}"
upstream="${upstream%/}"
app="$(portless get spelling-creator)"
app_host="${app#*://}"
app_host="${app_host%%[:/]*}"

exec wrangler dev --port "${PORT:-8787}" --ip "${HOST:-127.0.0.1}" \
  --local-upstream "$upstream" --upstream-protocol "$scheme" \
  --var "ALLOWED_HOSTNAMES:$app_host" \
  --var "FEDERATION_ORIGIN:$PORTLESS_URL"
