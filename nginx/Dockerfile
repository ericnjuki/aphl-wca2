# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS web-builder
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @workforce-competency/web...

COPY apps/web ./apps/web

ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --filter @workforce-competency/web run build

FROM nginx:1.27-alpine AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/conf.d/templates /etc/nginx/conf.d/templates
COPY nginx/docker-entrypoint.d/10-render-conf.sh /docker-entrypoint.d/10-render-conf.sh
RUN chmod +x /docker-entrypoint.d/10-render-conf.sh
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80 443
