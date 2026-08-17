# Build context is the repo root (see docker-compose.prod.yml) — same
# reasoning as apps/api/Dockerfile: this is a pnpm workspace.

FROM node:22-bookworm-slim AS base
RUN corepack enable

FROM base AS deps
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
# Next.js inlines NEXT_PUBLIC_* values into the client bundle at build time,
# so this has to be a build ARG, not a runtime env var on the container.
# See docker-compose.prod.yml for where the actual value comes from.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY apps/web apps/web
RUN pnpm --filter web build

# --- Runtime: Next.js "standalone" output — a minimal server.js plus only
# the node_modules it actually traced as needed, not the whole workspace ---
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
