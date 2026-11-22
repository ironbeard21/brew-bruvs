# syntax=docker/dockerfile:1
FROM node:26-bookworm-slim AS workspace
WORKDIR /workspace
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global "$(node -p 'require("./package.json").packageManager')"
COPY apps/app/package.json apps/app/
COPY apps/server/package.json apps/server/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/brew-math/package.json packages/brew-math/
COPY packages/catalog-seed/package.json packages/catalog-seed/
COPY packages/db/package.json packages/db/

FROM workspace AS build
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .
RUN pnpm --filter '@brew-bruvs/server...' build
RUN pnpm --filter @brew-bruvs/app build \
  && test -f apps/app/dist/index.html

FROM workspace AS production-dependencies
RUN --mount=type=cache,target=/pnpm/store pnpm --filter '@brew-bruvs/server...' install \
  --prod --frozen-lockfile --store-dir /pnpm/store

FROM node:26-bookworm-slim AS runtime
WORKDIR /srv/brew-bruvs
ENV NODE_ENV=production PORT=8080 WEB_DIR=/srv/brew-bruvs/web
COPY --from=production-dependencies /workspace/ ./
COPY --from=build /workspace/packages/db/src/ packages/db/src/
COPY --from=build /workspace/packages/db/drizzle/ packages/db/drizzle/
COPY --from=build /workspace/apps/server/dist/ apps/server/dist/
COPY --from=build /workspace/apps/app/dist/ web/
USER node
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e 'fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["sh", "-c", "node packages/db/src/migrate.ts && exec node apps/server/dist/index.js"]
