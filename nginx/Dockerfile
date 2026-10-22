# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS web-builder
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

# The site config is rendered at start-up from nginx/templates by
# 40-wca-config.sh: HTTP until a certificate exists for DOMAIN, then HTTPS.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/snippets/wca-app.conf /etc/nginx/snippets/wca-app.conf
COPY nginx/templates/ /etc/nginx/wca-templates/
COPY nginx/docker-entrypoint.d/40-wca-config.sh /docker-entrypoint.d/40-wca-config.sh
# Strip CR in case the files were checked out with Windows line endings.
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-wca-config.sh /etc/nginx/wca-templates/* /etc/nginx/snippets/wca-app.conf \
    && chmod +x /docker-entrypoint.d/40-wca-config.sh
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80 443
