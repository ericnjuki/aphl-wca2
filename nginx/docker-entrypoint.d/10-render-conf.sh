#!/bin/sh
set -eu

: "${TLS_MODE:=internal}"
: "${DOMAIN:=_}"
: "${DOMAIN_WWW:=www.${DOMAIN}}"
# Subpath to mount the app under (e.g. "/wca"), no trailing slash. Empty
# string means serve at domain root
: "${BASE_PATH:=}"
# Optional: when set (and BASE_PATH is non-empty), the domain's root path
# 301-redirects here instead of 404ing — used when this same container is
# also reachable at another domain that used to serve the app at "/" and now
# only serves it under BASE_PATH. Include the scheme, e.g.
# "https://apps.example.com/wca".
: "${ROOT_REDIRECT_URL:=}"

case "$TLS_MODE" in
  internal)
    # internal TLS needs a real domain — it's used for both server_name and
    # the certbot cert path, so a placeholder "_" would silently look for
    # certs in the wrong place.
    if [ "$DOMAIN" = "_" ]; then
      echo "10-render-conf.sh: DOMAIN is required when TLS_MODE=internal" >&2
      exit 1
    fi
    template=/etc/nginx/conf.d/templates/internal-tls.conf.template
    ;;
  external)
    # external mode never terminates TLS itself, so a real domain is only a
    # nicety for server_name/logging — "_" (nginx's catch-all) is fine for a
    # plain-HTTP deploy with no domain at all.
    template=/etc/nginx/conf.d/templates/external-tls.conf.template
    ;;
  *)
    echo "10-render-conf.sh: unknown TLS_MODE '$TLS_MODE' (expected 'internal' or 'external')" >&2
    exit 1
    ;;
esac

if [ -n "$BASE_PATH" ] && [ -n "$ROOT_REDIRECT_URL" ]; then
  ROOT_REDIRECT_BLOCK="location / {
        return 301 ${ROOT_REDIRECT_URL}\$request_uri;
    }"
else
  ROOT_REDIRECT_BLOCK=""
fi

export DOMAIN DOMAIN_WWW BASE_PATH ROOT_REDIRECT_BLOCK

envsubst '${DOMAIN} ${DOMAIN_WWW} ${BASE_PATH}' < "$template" | \
  awk 'index($0, "ROOT_REDIRECT_BLOCK") { print ENVIRON["ROOT_REDIRECT_BLOCK"]; next } { print }' \
  > /etc/nginx/conf.d/default.conf

echo "10-render-conf.sh: rendered $template -> /etc/nginx/conf.d/default.conf (TLS_MODE=$TLS_MODE, DOMAIN=$DOMAIN, BASE_PATH=${BASE_PATH:-/}, ROOT_REDIRECT_URL=${ROOT_REDIRECT_URL:-<unset>})"
