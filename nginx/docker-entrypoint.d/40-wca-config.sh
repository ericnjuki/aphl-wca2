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
set -u

TEMPLATES=/etc/nginx/wca-templates
TARGET=/etc/nginx/conf.d/default.conf
LIVE=/etc/letsencrypt/live

desired_mode() {
    if [ -n "${DOMAIN:-}" ] \
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
            stamp=$(cert_mtime)
            nginx -s reload && log "certificate changed; reloaded"
        fi
    done
}

mode=$(desired_mode)
render "$mode"
if [ "$mode" = https ]; then
    log "serving HTTPS for ${DOMAIN}"
elif [ -n "${DOMAIN:-}" ]; then
    log "no certificate for ${DOMAIN} yet; serving HTTP until certbot issues one"
else
    log "DOMAIN not set; serving HTTP only"
fi

watch_certificate "$mode" </dev/null &
