# Spelling Creator, as a single self-hosted image.
#
# Builds the SPA and the docs site, then runs the Node API (apps/api/src/node/
# server.js), which serves both from disk alongside the API itself. See
# /docs/developers/self-hosting for what this host does and does not provide, and
# docker-compose.yml for a worked example with Postgres, PostgREST, GoTrue and
# RustFS around it.
#
# Most people never build this: .github/workflows/image.yml publishes it as
# ghcr.io/spelling-creator/spelling-creator. To build it yourself:
#
#   docker build -t spelling-creator .
#
# Nothing instance-specific goes in. The server writes the SPA's settings into
# the page as it serves it, from its own environment (SUPABASE_ANON_KEY,
# AUTH_MODE and the rest; see apps/api/src/node/browserConfig.js), so one image
# runs with anyone's configuration. The VITE_* build arguments below still work
# and act as fallbacks for anything the environment leaves unset, but nothing
# needs them.

# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build: install the workspace, build the SPA and the docs into apps/web/dist.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# A build has no terminal, and pnpm asks before it removes a modules directory —
# which the --prod install below has to do, since it is switching the installed
# set rather than adding to it. Without this it aborts with
# ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. Set once for the whole stage
# because none of these steps can answer a prompt.
ENV CI=true

RUN corepack enable

WORKDIR /app

# Manifests first, so the install layer is cached independently of the source and
# a code-only change doesn't reinstall the world. The patches directory is copied
# with them because pnpm applies patchedDependencies during install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/docs/package.json ./apps/docs/
COPY apps/stub-api/package.json ./apps/stub-api/
COPY packages/core/package.json ./packages/core/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .

# Images and videos are stored in Git LFS. A checkout made without Git LFS has
# small text pointers where they should be, and the build would happily ship
# those as broken images. Stop here instead, with the fix.
RUN if find apps/web/public apps/docs/docs/public -type f -size -1k \
      \( -name '*.jpg' -o -name '*.png' -o -name '*.mp4' \) \
      -exec grep -l '^version https://git-lfs' {} + | grep -q .; then \
      echo "Images are Git LFS pointers. Install Git LFS, run 'git lfs pull', and build again." >&2; \
      exit 1; \
    fi

# Read by Vite at build time and substituted into the bundle. Vite exposes any
# environment variable with the VITE_ prefix, so these need no .env file. All
# optional: the runtime configuration overrides them (see the top of this file).
ARG VITE_API_URL=""
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_TURNSTILE_SITE_KEY=""
ARG VITE_GOOGLE_CLIENT_ID=""
# 'magic-link' (default), 'password', or 'both'. An instance with no mail server
# needs 'password', since a magic link it cannot send is not a way in.
ARG VITE_AUTH_MODE=""
# The domain usernames become addresses under. The default is a reserved
# .invalid one and almost never needs changing.
ARG VITE_USERNAME_DOMAIN=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_AUTH_MODE=$VITE_AUTH_MODE \
    VITE_USERNAME_DOMAIN=$VITE_USERNAME_DOMAIN

# The web app has two halves: dist (the SPA) and dist-ssr (the server bundle
# routes/ssr.js imports). The docs are copied into dist/docs last, because the
# SPA build empties dist. These are the steps `pnpm build:docs` runs through
# Turborepo, spelled out, since the image has no .git and no use for a cache.
RUN pnpm --filter @spelling-creator/web build \
 && pnpm --filter @spelling-creator/web build:ssr \
 && pnpm --filter @spelling-creator/docs build \
 && pnpm --filter @spelling-creator/docs copy-to-web

# Drop the build-only dependencies now that the bundles exist — wrangler pulls in
# workerd, and vite, vitepress and the rest are several hundred megabytes the
# runtime never opens. Done here rather than by reinstalling in the runtime stage
# so the workspace's symlink layout is built once and copied whole.
#
# This is a purge and reinstall, not a trim: pnpm empties node_modules and lays
# down the production set. Two consequences. The store is mounted again, or every
# package being *kept* would be refetched over the network to relink it. And
# install scripts are deliberately NOT skipped — with a purge, --ignore-scripts
# would leave a kept dependency unbuilt, and `allowBuilds` in pnpm-workspace.yaml
# already constrains which packages may run one.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Run.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime

# `source` is what links the published package to the repository on GitHub, so
# its page shows the README and its permissions follow the repository's.
LABEL org.opencontainers.image.title="Spelling Creator" \
      org.opencontainers.image.description="Make Spelling lessons, self-hosted: the lesson editor, hub and API in one image." \
      org.opencontainers.image.source="https://github.com/Spelling-Creator/spelling-creator" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    WEB_DIST=/app/apps/web/dist

WORKDIR /app

# `node` is a non-root user the base image already provides. Nothing here is
# written to at runtime — the process is stateless — so it needs no ownership
# beyond read access.
COPY --from=builder --chown=node:node /app /app

USER node
EXPOSE 8787

# /robots.txt is generated by the API but needs neither the database nor object
# storage, so it answers 200 exactly when the process is up and routing — which
# is what a liveness check should mean, rather than also failing when Postgres
# is briefly unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/src/node/server.js"]
