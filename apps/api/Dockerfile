# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @workforce-competency/api...

FROM deps AS build
COPY apps/api ./apps/api
RUN pnpm --filter @workforce-competency/api run build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --prod --filter @workforce-competency/api...

FROM node:20-alpine AS runtime
WORKDIR /app/apps/api

RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/apps/api/data \
    && chown -R app:app /app

COPY --from=prod-deps --chown=app:app /app/node_modules /app/node_modules
COPY --from=prod-deps --chown=app:app /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build --chown=app:app /app/apps/api/dist /app/apps/api/dist
COPY --chown=app:app apps/api/package.json /app/apps/api/package.json
# Assessment catalogue CSVs, seeded into an empty database on first start.
COPY --chown=app:app apps/api/seed-data /app/apps/api/seed-data

USER app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/apps/api/data/workforce.db

EXPOSE 3000
CMD ["node", "dist/server.js"]
