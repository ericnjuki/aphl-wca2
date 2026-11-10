#!/bin/sh
# Picks the nginx site config at container start and keeps it current.
#
# - DOMAIN unset, or no certificate for it yet: plain HTTP on port 80, which
#   also serves the ACME challenge so certbot can issue the first certificate.
# - Certificate present: port 80 redirects to HTTPS and 443 serves the app.
#
# A background loop switches to HTTPS within a minute of certbot writing the
# first certificate, and reloads nginx within a minute of the certificate
# being renewed or expanded.
#
# - TLS_MODE=external: TLS is terminated by a proxy in front of this container.
#   Plain HTTP on port 80 only; no certificate checks, no HTTPS switch.
#
# BASE_PATH (e.g. "/wca", no trailing slash) serves the app under a subpath;
# empty serves it at the root. With BASE_PATH set, ROOT_REDIRECT_URL (e.g.
# "https://apps.example.org/wca") 301-redirects every other path there.
set -u

TEMPLATES=/etc/nginx/wca-templates
TARGET=/etc/nginx/conf.d/default.conf
SNIPPET_TEMPLATE=/etc/nginx/wca-snippets/wca-app.conf.template
SNIPPET=/etc/nginx/snippets/wca-app.conf
LIVE=/etc/letsencrypt/live

desired_mode() {
    if [ "${TLS_MODE:-}" = external ]; then
        echo external
    elif [ -n "${DOMAIN:-}" ] \
        && [ -f "$LIVE/$DOMAIN/fullchain.pem" ] \
        && [ -f "$LIVE/$DOMAIN/privkey.pem" ]; then
        echo https
    else
        echo http
    fi
}

render() {
    SERVER_NAMES=$(echo "${DOMAIN:-} ${DOMAIN_ALIASES:-}" | xargs)
    export SERVER_NAMES
    envsubst '${DOMAIN} ${SERVER_NAMES}' < "$TEMPLATES/$1.conf.template" > "$TARGET"
}

log() {
    echo "[wca-config] $*"
}

# The app locations depend only on BASE_PATH and ROOT_REDIRECT_URL, which
# cannot change while the container runs, so the snippet is rendered once.
render_snippet() {
    if [ -n "${BASE_PATH:-}" ] && [ -n "${ROOT_REDIRECT_URL:-}" ]; then
        ROOT_REDIRECT_BLOCK="location / {
    return 301 ${ROOT_REDIRECT_URL}\$request_uri;
}"
    else
        ROOT_REDIRECT_BLOCK=""
    fi
    BASE_PATH=${BASE_PATH:-}
    export BASE_PATH ROOT_REDIRECT_BLOCK
    mkdir -p "$(dirname "$SNIPPET")"
    envsubst '${BASE_PATH}' < "$SNIPPET_TEMPLATE" \
        | awk 'index($0, "ROOT_REDIRECT_BLOCK") { print ENVIRON["ROOT_REDIRECT_BLOCK"]; next } { print }' \
        > "$SNIPPET"
}

# Modification time of the live certificate (follows certbot's symlink), or 0.
cert_mtime() {
    stat -L -c %Y "$LIVE/${DOMAIN:-none}/fullchain.pem" 2>/dev/null || echo 0
}

watch_certificate() {
    current=$1
    stamp=$(cert_mtime)
    while :; do
        sleep 60
        mode=$(desired_mode)
        if [ "$mode" != "$current" ]; then
            render "$mode"
            if nginx -t -q; then
                nginx -s reload && log "switched to $mode" && current=$mode
            else
                log "new $mode config failed nginx -t; staying on $current"
                render "$current"
            fi
            stamp=$(cert_mtime)
        elif [ "$mode" = https ] && [ "$(cert_mtime)" != "$stamp" ]; then
            changed=$(cert_mtime)
            if nginx -s reload; then
                stamp=$changed
                log "certificate changed; reloaded"
            else
                log "certificate changed but reload failed; retrying in a minute"
            fi
        fi
    done
}

case "${TLS_MODE:-}" in
    ""|internal|external) ;;
    *) log "unknown TLS_MODE '${TLS_MODE}' (expected empty, 'internal' or 'external')"; exit 1 ;;
esac

render_snippet
log "app served at ${BASE_PATH:-/}${BASE_PATH:+${ROOT_REDIRECT_URL:+ (other paths redirect to $ROOT_REDIRECT_URL)}}"
mode=$(desired_mode)
render "$mode"
if [ "$mode" = external ]; then
    log "TLS_MODE=external; serving HTTP only, TLS is terminated in front of this container"
    exit 0
elif [ "$mode" = https ]; then
    log "serving HTTPS for ${DOMAIN}"
elif [ -n "${DOMAIN:-}" ]; then
    log "no certificate for ${DOMAIN} yet; serving HTTP until certbot issues one"
else
    log "DOMAIN not set; serving HTTP only"
fi

watch_certificate "$mode" </dev/null &
