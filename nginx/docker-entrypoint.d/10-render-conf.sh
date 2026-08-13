#!/bin/sh
set -eu

: "${TLS_MODE:=own}"
: "${DOMAIN:?DOMAIN environment variable is required}"
: "${DOMAIN_WWW:=www.${DOMAIN}}"

case "$TLS_MODE" in
  own)
    template=/etc/nginx/conf.d/templates/own-tls.conf.template
    ;;
  external)
    template=/etc/nginx/conf.d/templates/external-tls.conf.template
    ;;
  *)
    echo "10-render-conf.sh: unknown TLS_MODE '$TLS_MODE' (expected 'own' or 'external')" >&2
    exit 1
    ;;
esac

export DOMAIN DOMAIN_WWW

envsubst '${DOMAIN} ${DOMAIN_WWW}' < "$template" > /etc/nginx/conf.d/default.conf

echo "10-render-conf.sh: rendered $template -> /etc/nginx/conf.d/default.conf (TLS_MODE=$TLS_MODE, DOMAIN=$DOMAIN)"
