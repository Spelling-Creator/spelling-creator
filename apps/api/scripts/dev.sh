#!/bin/sh
#
# `pnpm dev`: wrangler dev, run through portless (see "Local URLs" in
# apps/docs/docs/developers/getting-started.md).
#
# wrangler doesn't read PORT, so the port and address portless picked are passed
# on as flags. portless's proxy also talks plain http to wrangler, so without
# more the Worker would see http:// request URLs and build http:// links from
# them: in robots.txt, the sitemap and, worst, the OAuth metadata, whose issuer
# then no longer matches the https:// address it was fetched from.
# --local-upstream rewrites every request URL to start with the host portless
# serves it on (worktree prefix included), and --upstream-protocol makes that
# https. The protocol has to be given: wrangler's help says it defaults to
# https, but in local mode it defaults to the protocol wrangler listens on.
#
# With PORTLESS=0 there is no PORTLESS_URL, and wrangler runs on its own port
# (8787) as before.

if [ -n "$PORTLESS_URL" ]; then
  exec wrangler dev --port "$PORT" --ip "$HOST" \
    --local-upstream "${PORTLESS_URL#https://}" --upstream-protocol https
fi
exec wrangler dev
