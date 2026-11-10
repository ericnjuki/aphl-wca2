#!/bin/sh
# Entry point of the certbot service in docker-compose.yml.
# Requests a Let's Encrypt certificate for DOMAIN (plus DOMAIN_ALIASES), expands
# it when names are added to DOMAIN_ALIASES, and then renews it twice a day.
# nginx serves the HTTP-01 challenge files from the shared /var/www/certbot
# webroot; see nginx/docker-entrypoint.d.
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

CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"

domains="-d $DOMAIN"
for alias in ${DOMAIN_ALIASES:-}; do
    domains="$domains -d $alias"
done

# Configured names the current certificate does not cover, one per line.
missing_names() {
    openssl x509 -in "$CERT" -noout -ext subjectAltName 2>/dev/null \
        | tr ',' '\n' | sed -n 's/^ *DNS://p' > /tmp/cert-names
    printf '%s\n' $DOMAIN ${DOMAIN_ALIASES:-} | sort -u | grep -vxF -f /tmp/cert-names
}

# Give nginx time to start before the first challenge.
pause 15
while :; do
    if [ ! -f "$CERT" ]; then
        echo "[certbot] requesting a certificate for $DOMAIN ${DOMAIN_ALIASES:-}"
    elif missing=$(missing_names) && [ -n "$missing" ]; then
        echo "[certbot] certificate does not cover: $(echo $missing); requesting an expanded one"
    else
        break
    fi
    # shellcheck disable=SC2086 # $domains is a list of -d flags
    if certbot certonly --webroot -w "$WEBROOT" --cert-name "$DOMAIN" $domains --expand \
        --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email --non-interactive; then
        break
    fi
    echo "[certbot] request failed; retrying in 1 hour. Check that every name resolves to this server and port 80 is reachable."
    pause 3600
done

while :; do
    certbot renew --webroot -w "$WEBROOT" --quiet
    pause 43200
done
