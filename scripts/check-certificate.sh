#!/usr/bin/env bash
# Checks the HTTPS certificate this server is actually serving.
#
# Usage: scripts/check-certificate.sh [domain] [minimum-days]
#   domain        defaults to DOMAIN in the repository's .env
#   minimum-days  defaults to 21
#   CHECK_TIMEOUT (environment) seconds allowed for the TLS connection, default 30
#
# Prints the expiry date and days left, and exits 1 when the certificate
# expires within minimum-days, does not cover every name in DOMAIN and
# DOMAIN_ALIASES, or cannot be read within CHECK_TIMEOUT. certbot renews about 30 days before
# expiry, so fewer than 21 days left means renewal is failing.
# Run it from cron and alert on a non-zero exit, for example:
#   0 8 * * * /root/workforce-competency/scripts/check-certificate.sh || <your alert command>
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

env_value() {
    [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r"'"'"
}

domain=${1:-$(env_value DOMAIN)}
min_days=${2:-21}
timeout_s=${CHECK_TIMEOUT:-30}
aliases=$(env_value DOMAIN_ALIASES)

if [ -z "$domain" ]; then
    echo "No domain given and DOMAIN is not set in .env" >&2
    exit 1
fi

raw=$(echo | timeout "$timeout_s" openssl s_client -connect "$domain:443" -servername "$domain" 2>/dev/null)
if [ $? -eq 124 ]; then
    echo "FAIL: no answer from https://$domain within $timeout_s seconds" >&2
    exit 1
fi
pem=$(openssl x509 2>/dev/null <<<"$raw") || true
if [ -z "$pem" ]; then
    echo "FAIL: could not read a certificate from https://$domain" >&2
    exit 1
fi

end=$(openssl x509 -noout -enddate <<<"$pem" | cut -d= -f2)
days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
names=$(openssl x509 -noout -ext subjectAltName <<<"$pem" | tr ',' '\n' | sed -n 's/^ *DNS://p')

status=0
echo "Certificate for $domain expires $end ($days days left)"
if [ "$days" -lt "$min_days" ]; then
    echo "FAIL: fewer than $min_days days left; check 'docker compose logs certbot'" >&2
    status=1
fi
for name in $domain $aliases; do
    if ! grep -qxF "$name" <<<"$names"; then
        echo "FAIL: certificate does not cover $name" >&2
        status=1
    fi
done
[ "$status" -eq 0 ] && echo "OK"
exit "$status"
