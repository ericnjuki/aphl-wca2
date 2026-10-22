#!/bin/sh
# Entry point of the certbot service in docker-compose.yml.
# Requests the first Let's Encrypt certificate for DOMAIN (plus DOMAIN_ALIASES)
# and then renews it twice a day. nginx serves the HTTP-01 challenge files
# from the shared /var/www/certbot webroot; see nginx/docker-entrypoint.d.
set -u

WEBROOT=/var/www/certbot
trap 'exit 0' TERM INT

pause() {
    sleep "$1" &
    wait $!
}

if [ -z "${DOMAIN:-}" ] || [ -z "${LETSENCRYPT_EMAIL:-}" ]; then
    echo "[certbot] DOMAIN or LETSENCRYPT_EMAIL is not set; HTTPS is off, nothing to do."
    while :; do pause 86400; done
fi

domains="-d $DOMAIN"
for alias in ${DOMAIN_ALIASES:-}; do
    domains="$domains -d $alias"
done

# Give nginx time to start before the first challenge.
pause 15
until [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; do
    echo "[certbot] requesting a certificate for $DOMAIN ${DOMAIN_ALIASES:-}"
    # shellcheck disable=SC2086 # $domains is a list of -d flags
    if certbot certonly --webroot -w "$WEBROOT" --cert-name "$DOMAIN" $domains \
        --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email --non-interactive; then
        break
    fi
    echo "[certbot] request failed; retrying in 1 hour. Check that $DOMAIN resolves to this server and port 80 is reachable."
    pause 3600
done

while :; do
    certbot renew --webroot -w "$WEBROOT" --quiet
    pause 43200
done
