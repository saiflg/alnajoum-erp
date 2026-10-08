# Build context is the repo root (see docker-compose.prod.yml), because this
# is a pnpm workspace and the api package needs its workspace siblings'
# package.json files present to resolve the lockfile during install.
#
# node:22-bookworm-slim (glibc, not Alpine/musl) is used throughout so the
# native modules this project depends on (argon2, sharp) have prebuilt
# binaries available for both amd64 and arm64 — Oracle Cloud's Always Free
# Ampere A1 shape is arm64, and glibc images have far more reliable native
# module support there than Alpine.

FROM node:22.11.0-bookworm-slim AS base
# postgresql-client-16 provides pg_dump/pg_restore, used by BackupService
# (Phase 11 "backup management") to shell out to a real, restorable
# dump rather than a JS reimplementation — see that service's own doc
# comment. Debian bookworm's own default "postgresql-client" package is
# v15 (caught live: pg_dump refuses to dump a newer server by default —
# "aborting because of server version mismatch"), so this pulls the
# versioned package from the official PGDG apt repo to match
# postgres:16-alpine in docker-compose.prod.yml exactly, rather than
# whatever version Debian's own repos happen to default to.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates gnupg wget \
  && wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y --auto-remove gnupg wget \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

FROM base AS deps
# Build tools are only needed to compile argon2/sharp's native bindings
# during install; they're not copied into the runtime stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# Cache-mounted so a retry after a flaky-network failure doesn't
# re-download every package from scratch.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /repo
COPY apps/api apps/api
RUN pnpm --filter api prisma:generate
RUN pnpm --filter api build

# --- Runtime: only the built app + its resolved node_modules, no build tools ---
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api ./apps/api
WORKDIR /repo/apps/api
# Phase 22: do not run as root. The only places the app writes are the uploads and backups folders; they
# are created and handed to the unprivileged `node` user BEFORE the volumes are mounted, so a fresh named
# volume inherits that ownership. (A volume created by an earlier root-owned image keeps root ownership:
# run `chown -R 1000:1000` on it once - see DEPLOYMENT.md.)
RUN mkdir -p uploads backups && chown -R node:node uploads backups
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
