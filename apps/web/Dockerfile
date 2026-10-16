# Build context is the repo root (see docker-compose.prod.yml) — same
# reasoning as apps/api/Dockerfile: this is a pnpm workspace.

FROM node:22.22.0-bookworm-slim AS base
# pnpm is installed from npm at the exact version in package.json's "packageManager" field. Corepack is not
# used: the corepack bundled with older node 22 images carries outdated signing keys and fails with
# "Cannot find matching keyid" when it tries to download pnpm.
# (pnpm 11 itself needs node >= 22.13, hence the base image pin above.)
RUN npm install -g pnpm@11.18.0

FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# Cache-mounted so a retry after a flaky-network failure doesn't re-download every package from scratch. The
# second mount keeps pnpm's registry metadata between attempts, and the generous timeouts/retries let a slow link
# finish instead of failing the whole build (pnpm's release-age check reads metadata for every package).
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --fetch-timeout 900000 --fetch-retries 8 --network-concurrency 8

FROM deps AS build
WORKDIR /repo
# Next.js inlines NEXT_PUBLIC_* values into the client bundle at build time,
# so this has to be a build ARG, not a runtime env var on the container.
# See docker-compose.prod.yml for where the actual value comes from.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY apps/web apps/web
RUN NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter web build

# --- Runtime: Next.js "standalone" output — a minimal server.js plus only
# the node_modules it actually traced as needed, not the whole workspace ---
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# Phase 22: unprivileged user; the standalone output is read-only at runtime.
USER node
EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
