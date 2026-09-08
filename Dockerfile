ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION} AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
ARG USE_DOKPLOY_CRON=0
ARG NUXT_PUBLIC_APP_MODE=live
ENV USE_DOKPLOY_CRON=${USE_DOKPLOY_CRON}
ENV NUXT_PUBLIC_APP_MODE=${NUXT_PUBLIC_APP_MODE}
COPY . .
RUN bun run --cwd apps/web postinstall
RUN bun run --cwd apps/web build

FROM oven/bun:${BUN_VERSION} AS runtime
ARG USE_DOKPLOY_CRON=0
ARG NUXT_PUBLIC_APP_MODE=live
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=7341
ENV USE_DOKPLOY_CRON=${USE_DOKPLOY_CRON}
ENV NUXT_PUBLIC_APP_MODE=${NUXT_PUBLIC_APP_MODE}

COPY --from=deps --chown=bun:bun /app/node_modules /app/node_modules
COPY --from=build --chown=bun:bun /app/apps/web/.output /app/apps/web/.output
COPY --from=build --chown=bun:bun /app/apps/web/public /app/apps/web/public
COPY --from=build --chown=bun:bun /app/apps/web/package.json /app/apps/web/package.json
COPY --from=build --chown=bun:bun /app/apps/web/server/workers /app/apps/web/server/workers

EXPOSE 7341

USER bun

CMD ["bun", "apps/web/.output/server/index.mjs"]
