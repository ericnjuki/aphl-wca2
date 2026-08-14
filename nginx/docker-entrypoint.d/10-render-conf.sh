#!/bin/sh
set -eu

: "${TLS_MODE:=internal}"
: "${DOMAIN:=_}"
: "${DOMAIN_WWW:=www.${DOMAIN}}"

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

export DOMAIN DOMAIN_WWW

envsubst '${DOMAIN} ${DOMAIN_WWW}' < "$template" > /etc/nginx/conf.d/default.conf

echo "10-render-conf.sh: rendered $template -> /etc/nginx/conf.d/default.conf (TLS_MODE=$TLS_MODE, DOMAIN=$DOMAIN)"
