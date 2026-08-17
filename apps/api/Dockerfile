# Build context is the repo root (see docker-compose.prod.yml), because this
# is a pnpm workspace and the api package needs its workspace siblings'
# package.json files present to resolve the lockfile during install.
#
# node:22-bookworm-slim (glibc, not Alpine/musl) is used throughout so the
# native modules this project depends on (argon2, sharp) have prebuilt
# binaries available for both amd64 and arm64 — Oracle Cloud's Always Free
# Ampere A1 shape is arm64, and glibc images have far more reliable native
# module support there than Alpine.

FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
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
EXPOSE 4000
CMD ["node", "dist/main.js"]
